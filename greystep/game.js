import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────── utilities ─────────────────────────
const V3 = THREE.Vector3;
const now = () => performance.now();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const easeIn = t => t * t;
const easeOut = t => 1 - (1 - t) * (1 - t);
function pickW(o) { let s = 0; for (const k in o) s += o[k]; let r = Math.random() * s; for (const k in o) { r -= o[k]; if (r <= 0) return k; } return Object.keys(o)[0]; }
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v);
}
const $ = id => document.getElementById(id);

// ───────────────────────── renderer / scene ─────────────────────────
const glCanvas = $('gl'), fxCanvas = $('fx'), fx2 = fxCanvas.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(DPR);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const FOG = new THREE.Color('#8e979c');
scene.fog = new THREE.FogExp2(FOG.clone(), 0.021);
scene.background = FOG.clone();
const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 500);
camera.position.set(0, 3, 9);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1.2 ? 62 : 48;
  camera.updateProjectionMatrix();
  fxCanvas.width = Math.round(w * DPR); fxCanvas.height = Math.round(h * DPR);
}
addEventListener('resize', resize);
resize();

// ───────────────────────── lights ─────────────────────────
const hemi = new THREE.HemisphereLight('#c7d0d8', '#4a4535', 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe3c0', 2.6);
sun.position.set(-14, 24, 12);
sun.target.position.set(0, 0, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 24, bottom: -14, near: 2, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#a9c2e0', 0.9);
rim.position.set(8, 12, -34);
scene.add(rim);

// ───────────────────────── world ─────────────────────────
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color('#4a535c') }, mid: { value: new THREE.Color('#9aa2a4') }, glow: { value: new THREE.Color('#e9d8b8') } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform vec3 top, mid, glow; varying vec3 vP;
    void main(){ float h = clamp(vP.y, 0., 1.); vec3 c = mix(mid, top, pow(h, .55));
      float s = pow(max(dot(vP, normalize(vec3(-.5,.35,-.6))), 0.), 6.); c += glow * s * .35;
      gl_FragColor = vec4(c, 1.); }`,
}));
scene.add(sky);

function groundHeight(x, z) {
  const r = Math.hypot(x * 0.8, (z + 7) * 0.9);
  let h = (vnoise(x * 0.12, z * 0.12) - 0.5) * 0.9 + (vnoise(x * 0.5, z * 0.5) - 0.5) * 0.15;
  h *= clamp((r - 6) / 10, 0.15, 1);
  h += Math.max(0, r - 24) * 0.35;
  return h;
}
{
  const geo = new THREE.PlaneGeometry(220, 220, 180, 180);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color('#5a6437'), dry = new THREE.Color('#857a4c'), dirt = new THREE.Color('#6a5a44'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const n = vnoise(x * 0.25, z * 0.25), path = clamp(1 - (Math.abs(x) - 3.5) / 3, 0, 1) * (z > -22 && z < 5 ? 1 : 0);
    c.copy(grass).lerp(dry, n * 0.8).lerp(dirt, clamp(path * (0.55 + vnoise(x * 0.7, z * 0.7) * 0.6), 0, 1));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// wind-blown grass
const windU = { value: 0 };
{
  const blade = new THREE.PlaneGeometry(0.07, 0.55, 1, 4);
  blade.translate(0, 0.275, 0);
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * (1 - bp.getY(i) / 0.6));
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = windU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float hk = position.y / .55; vec4 ip = instanceMatrix * vec4(0.,0.,0.,1.);
      transformed.x += sin(uTime * 1.7 + ip.x * .35 + ip.z * .22) * .13 * hk * hk;
      transformed.z += cos(uTime * 1.2 + ip.x * .18) * .07 * hk * hk;`);
  };
  const N = 11000, inst = new THREE.InstancedMesh(blade, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3(), e = new THREE.Euler(), c = new THREE.Color();
  const r = seeded(11); let n = 0;
  for (let tries = 0; n < N && tries < N * 4; tries++) {
    const x = (r() - 0.5) * 70, z = -40 + r() * 52;
    const path = Math.abs(x) < 5 && z > -21 && z < 4;
    if (path && r() < 0.85) continue;
    const dens = vnoise(x * 0.18, z * 0.18);
    if (dens < 0.35 && r() < 0.6) continue;
    p.set(x, groundHeight(x, z), z);
    e.set(rnd(-0.2, 0.2), r() * Math.PI, rnd(-0.2, 0.2)); q.setFromEuler(e);
    const k = 0.6 + r() * 1.1; s.set(k, k * (0.7 + dens), k);
    m.compose(p, q, s); inst.setMatrixAt(n, m);
    c.setHSL(0.16 + r() * 0.06, 0.35 + r() * 0.2, 0.28 + r() * 0.16); inst.setColorAt(n, c);
    n++;
  }
  inst.count = n;
  inst.receiveShadow = true;
  scene.add(inst);
}

// basalt columns: the cliffs, the stumps, and the Warden are all made of the same hexagonal stone
const ROCK = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
function tintGeo(geo, color) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function hexPrism(r, h, color) {
  const g = new THREE.CylinderGeometry(r, r * 0.96, h, 6, 1);
  // bevel-ish: slightly shrink the top cap so columns read as cut stone
  return tintGeo(g.toNonIndexed(), color);
}
function stoneColor(r, base = 0.3) { const l = base + r() * 0.1; const c = new THREE.Color().setHSL(0.58 + r() * 0.05, 0.06, l); if (r() < 0.12) c.setHSL(0.22, 0.25, 0.28); return c; }
{
  const r = seeded(5), geos = [];
  const addCol = (x, z, rad, h) => { const g = hexPrism(rad, h, stoneColor(r, 0.24)); g.rotateY(r() * 1.0); g.translate(x, groundHeight(x, z) + h / 2 - 0.3, z); geos.push(g); };
  // back cliff: packed columns in rows
  for (let row = 0; row < 5; row++) for (let i = -30; i <= 30; i++) {
    const x = i * 1.55 + (row & 1) * 0.78 + rnd(-0.1, 0.1), z = -34 - row * 1.4;
    const base = 8 + row * 3 + Math.sin(i * 0.3) * 3 + Math.abs(i) * 0.2;
    addCol(x, z, 0.85, base + r() * 4);
  }
  // side walls
  for (const side of [-1, 1]) for (let row = 0; row < 3; row++) for (let i = 0; i < 24; i++) {
    const z = -32 + i * 1.5 + (row & 1) * 0.75, x = side * (19 + row * 1.4 + Math.sin(i * 0.5) * 1.5);
    addCol(x, z, 0.8, 4 + row * 3 + r() * 5 + Math.max(0, -z - 10) * 0.3);
  }
  // broken stumps scattered around the clearing
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 9 + r() * 10, x = Math.cos(a) * d * 1.1, z = -8 + Math.sin(a) * d * 0.9;
    if (z > 6 || (Math.abs(x) < 6 && z > -22)) continue;
    const cx = x, cz = z; for (let k = 0; k < 1 + (r() * 5 | 0); k++) addCol(cx + rnd(-1, 1), cz + rnd(-1, 1), 0.35 + r() * 0.35, 0.3 + r() * 1.8);
  }
  const cliff = new THREE.Mesh(mergeGeometries(geos), ROCK);
  cliff.castShadow = true; cliff.receiveShadow = true;
  scene.add(cliff);
}
// pines fading into the mist, and a fence like the edge of an old pasture
{
  const r = seeded(21), geos = [], wood = [];
  const pineCol = new THREE.Color('#2c3a2c');
  for (let i = 0; i < 46; i++) {
    const side = i & 1 ? 1 : -1, x = side * (13 + r() * 20), z = -12 - r() * 30;
    const h = 5 + r() * 6, y = groundHeight(x, z);
    for (let k = 0; k < 3; k++) { const g = tintGeo(new THREE.ConeGeometry(1.6 - k * 0.4, h * 0.45, 7).toNonIndexed(), pineCol); g.translate(x, y + h * 0.3 + k * h * 0.22, z); geos.push(g); }
  }
  const pines = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  pines.castShadow = true; scene.add(pines);
  const wc = new THREE.Color('#5e4b38');
  for (let i = 0; i < 9; i++) {
    const x = 9 + i * 0.4, z = 3 - i * 2.2, y = groundHeight(x, z);
    const post = tintGeo(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6).toNonIndexed(), wc); post.rotateZ(rnd(-0.08, 0.08)); post.translate(x, y + 0.6, z); wood.push(post);
    if (i < 8) for (const hh of [0.5, 1.05]) {
      const nx = 9 + (i + 1) * 0.4, nz = 3 - (i + 1) * 2.2, len = Math.hypot(nx - x, nz - z);
      const rail = tintGeo(new THREE.BoxGeometry(0.07, 0.09, len).toNonIndexed(), wc);
      rail.rotateY(Math.atan2(nx - x, nz - z)); rail.translate((x + nx) / 2, y + hh, (z + nz) / 2); wood.push(rail);
    }
  }
  const fence = new THREE.Mesh(mergeGeometries(wood), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  fence.castShadow = true; scene.add(fence);
}
// low mist + floating motes
function softTex(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const SOFT = softTex();
const mist = [];
for (let i = 0; i < 16; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: '#c9ced0', transparent: true, opacity: 0.16, depthWrite: false }));
  s.scale.set(rnd(14, 26), rnd(3, 5), 1); s.position.set(rnd(-24, 24), rnd(0.6, 1.6), rnd(-30, -2)); s.userData.v = rnd(0.2, 0.5);
  scene.add(s); mist.push(s);
}

// ───────────────────────── particles ─────────────────────────
// one additive point cloud for sparks/embers, one soft normal-blended cloud for dust
function makeCloud(n, additive) {
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3), Sz = new Float32Array(n), A = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(Sz, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(A, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { map: { value: SOFT }, scale: { value: innerHeight * DPR * 0.5 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < .01) discard; }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const items = Array.from({ length: n }, () => ({ life: 0, t0: 0 }));
  return { pts, geo, P, C, Sz, A, items, i: 0, additive };
}
const SPARKS = makeCloud(700, true), DUST = makeCloud(500, false);
function emit(cloud, pos, o) {
  const it = cloud.items[cloud.i]; cloud.i = (cloud.i + 1) % cloud.items.length;
  it.x = pos.x; it.y = pos.y; it.z = pos.z;
  it.vx = o.vx ?? 0; it.vy = o.vy ?? 0; it.vz = o.vz ?? 0; it.g = o.g ?? 0; it.drag = o.drag ?? 0.5;
  it.t0 = now(); it.life = o.life ?? 600; it.size = o.size ?? 0.15; it.grow = o.grow ?? 0;
  it.c = new THREE.Color(o.color ?? '#fff'); it.a = o.alpha ?? 1;
}
function updateCloud(cloud, t, dt) {
  const { P, C, Sz, A, items } = cloud;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], k = (t - it.t0) / it.life;
    if (!it.life || k >= 1) { A[i] = 0; Sz[i] = 0; continue; }
    it.vy -= it.g * dt; const d = Math.exp(-it.drag * dt); it.vx *= d; it.vy *= d; it.vz *= d;
    it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
    P[i * 3] = it.x; P[i * 3 + 1] = it.y; P[i * 3 + 2] = it.z;
    C[i * 3] = it.c.r; C[i * 3 + 1] = it.c.g; C[i * 3 + 2] = it.c.b;
    Sz[i] = it.size * (1 + it.grow * k); A[i] = it.a * (cloud.additive ? 1 - k : Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k));
  }
  cloud.geo.attributes.position.needsUpdate = cloud.geo.attributes.color.needsUpdate = cloud.geo.attributes.size.needsUpdate = cloud.geo.attributes.alpha.needsUpdate = true;
}
function sparks(pos, color = '#ffe2a8', n = 16, sp = 5) {
  for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), b = rnd(-0.6, 1.2), v = rnd(sp * 0.3, sp); emit(SPARKS, pos, { vx: Math.cos(a) * Math.cos(b) * v, vy: Math.sin(b) * v + 1, vz: Math.sin(a) * Math.cos(b) * v, g: 9, drag: 1.5, life: rnd(300, 700), size: rnd(0.06, 0.16), color }); }
}
function dust(pos, n = 10, spread = 1, color = '#b8ad96') {
  for (let i = 0; i < n; i++) emit(DUST, new V3(pos.x + rnd(-spread, spread), pos.y + rnd(0, 0.4), pos.z + rnd(-spread, spread)), { vx: rnd(-1, 1), vy: rnd(0.3, 1.4), vz: rnd(-1, 1), drag: 1.2, life: rnd(900, 1800), size: rnd(1.0, 2.2), grow: 1.2, color, alpha: 0.55 });
}
// motes drifting in the light
for (let i = 0; i < 120; i++) emit(SPARKS, new V3(rnd(-14, 14), rnd(0.3, 6), rnd(-24, 6)), { vx: rnd(-0.1, 0.1), vy: rnd(0.02, 0.12), life: 1e12, size: rnd(0.03, 0.06), color: '#f3e2b8', alpha: 0.5 });

// flying rock chips
const CHIP_N = 80;
const chips = new THREE.InstancedMesh(tintGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 6).toNonIndexed(), new THREE.Color('#55595e')), ROCK, CHIP_N);
chips.castShadow = true; chips.frustumCulled = false; scene.add(chips);
const chipState = Array.from({ length: CHIP_N }, () => ({ life: 0 })); let chipI = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3();
function debris(pos, n = 8, sp = 5, scale = 1) {
  for (let i = 0; i < n; i++) {
    const c = chipState[chipI]; chipI = (chipI + 1) % CHIP_N;
    Object.assign(c, { p: pos.clone(), v: new V3(rnd(-sp, sp) * 0.6, rnd(sp * 0.5, sp * 1.3), rnd(-sp, sp) * 0.6), r: new V3(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: new V3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), t0: now(), life: rnd(1200, 2200), s: rnd(0.6, 1.8) * scale });
  }
}
function updateChips(t, dt) {
  for (let i = 0; i < CHIP_N; i++) {
    const c = chipState[i];
    if (!c.life || t - c.t0 > c.life) { _m.makeScale(0, 0, 0); chips.setMatrixAt(i, _m); continue; }
    c.v.y -= 16 * dt; c.p.addScaledVector(c.v, dt); c.r.addScaledVector(c.w, dt);
    const gy = groundHeight(c.p.x, c.p.z) + 0.06;
    if (c.p.y < gy) { c.p.y = gy; c.v.y *= -0.3; c.v.x *= 0.6; c.v.z *= 0.6; c.w.multiplyScalar(0.6); }
    const fade = clamp((c.life - (t - c.t0)) / 400, 0, 1);
    _e.set(c.r.x, c.r.y, c.r.z); _q.setFromEuler(_e); _s.setScalar(c.s * fade);
    _m.compose(c.p, _q, _s); chips.setMatrixAt(i, _m);
  }
  chips.instanceMatrix.needsUpdate = true;
}

// ───────────────────────── the Basalt Warden ─────────────────────────
const GLOW = new THREE.MeshStandardMaterial({ color: '#2a1406', emissive: '#ff8a3a', emissiveIntensity: 1.7, roughness: 0.4 });
const CRYSTAL = new THREE.MeshStandardMaterial({ color: '#9fd8ff', emissive: '#4fb8ff', emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1, flatShading: true });
const EYE = new THREE.MeshBasicMaterial({ color: '#ffb46a' });
function cluster(r, spec) {
  // spec: n, rMin, rMax, len, lenVar, spread, dir (1 = up from 0, -1 = down from 0), tilt
  const geos = [];
  for (let i = 0; i < spec.n; i++) {
    const rad = lerp(spec.rMin, spec.rMax, r()), len = spec.len * (1 - spec.lenVar * r());
    const g = hexPrism(rad, len, stoneColor(r, spec.shade ?? 0.2));
    g.rotateY(r() * Math.PI);
    g.translate(0, spec.dir * len / 2 + (spec.dir < 0 ? -r() * spec.jag : r() * spec.jag), 0);
    g.rotateX(rnd(-spec.tilt, spec.tilt)); g.rotateZ(rnd(-spec.tilt, spec.tilt));
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    g.translate(Math.cos(a) * d * spec.spread * (spec.sx ?? 1), spec.y0 ?? 0, Math.sin(a) * d * spec.spread * (spec.sz ?? 1));
    geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), ROCK);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function buildBoss() {
  const r = seeded(33);
  const B = { root: new THREE.Group(), hips: new THREE.Group(), torso: new THREE.Group(), head: new THREE.Group(), rock: [] };
  B.root.add(B.hips); B.hips.add(B.torso);
  const add = (parent, mesh) => { parent.add(mesh); B.rock.push(mesh); return mesh; };
  // torso: a knot of columns, taller in the middle, with a glowing seam inside
  add(B.torso, cluster(r, { n: 22, rMin: 0.32, rMax: 0.62, len: 3.5, lenVar: 0.4, spread: 1.3, sx: 1.25, sz: 0.85, dir: 1, tilt: 0.12, jag: 0.3, y0: -0.4 }));
  add(B.torso, cluster(r, { n: 8, rMin: 0.3, rMax: 0.5, len: 1.4, lenVar: 0.3, spread: 1.4, sx: 1.4, sz: 0.6, dir: 1, tilt: 0.5, jag: 0.2, y0: 2.4, shade: 0.26 }));
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.4, 6), GLOW); seam.position.y = 1.3; B.torso.add(seam);
  B.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 0), GLOW);
  B.core.position.set(0, 1.9, 1.08); B.torso.add(B.core);
  B.coreLight = new THREE.PointLight('#ff8a3a', 6, 7, 1.8); B.coreLight.position.set(0, 1.9, 1.7); B.torso.add(B.coreLight);
  // head
  B.head.position.set(0, 3.3, 0.35); B.torso.add(B.head);
  add(B.head, cluster(r, { n: 7, rMin: 0.22, rMax: 0.38, len: 1.1, lenVar: 0.35, spread: 0.45, dir: 1, tilt: 0.15, jag: 0.15 }));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.05), EYE); e.position.set(s * 0.2, 0.55, 0.52); B.head.add(e); B.eyes = (B.eyes || []).concat(e); }
  // arms: shoulder pivot → upper arm → elbow pivot → forearm + fist
  const arm = side => {
    const sh = new THREE.Group(); sh.position.set(side * 2.05, 2.55, 0); B.torso.add(sh);
    add(sh, cluster(r, { n: 5, rMin: 0.28, rMax: 0.46, len: 2.2, lenVar: 0.2, spread: 0.35, dir: -1, tilt: 0.08, jag: 0.1 }));
    add(sh, cluster(r, { n: 5, rMin: 0.3, rMax: 0.5, len: 0.9, lenVar: 0.3, spread: 0.45, dir: 1, tilt: 0.35, jag: 0.1, y0: -0.2, shade: 0.26 }));
    const el = new THREE.Group(); el.position.y = -2.15; sh.add(el);
    add(el, cluster(r, { n: 6, rMin: 0.32, rMax: 0.55, len: 2.3, lenVar: 0.2, spread: 0.4, dir: -1, tilt: 0.08, jag: 0.1 }));
    add(el, cluster(r, { n: 7, rMin: 0.35, rMax: 0.6, len: 0.9, lenVar: 0.3, spread: 0.5, dir: -1, tilt: 0.3, jag: 0.1, y0: -2.2, shade: 0.17 }));
    const fist = new THREE.Object3D(); fist.position.y = -2.9; el.add(fist);
    return { sh, el, fist };
  };
  B.A = arm(1); B.B = arm(-1);
  // boulder carried for throws
  B.boulder = cluster(r, { n: 6, rMin: 0.25, rMax: 0.45, len: 1.0, lenVar: 0.3, spread: 0.3, dir: 1, tilt: 0.8, jag: 0.1, y0: -0.5 });
  B.boulder.position.y = -0.3; B.B.fist.add(B.boulder); B.boulder.visible = false;
  // legs
  const leg = side => {
    const th = new THREE.Group(); th.position.set(side * 0.95, 0, 0); B.hips.add(th);
    add(th, cluster(r, { n: 4, rMin: 0.3, rMax: 0.5, len: 1.75, lenVar: 0.2, spread: 0.35, dir: -1, tilt: 0.06, jag: 0.1 }));
    const kn = new THREE.Group(); kn.position.y = -1.65; th.add(kn);
    add(kn, cluster(r, { n: 4, rMin: 0.3, rMax: 0.5, len: 1.55, lenVar: 0.15, spread: 0.35, dir: -1, tilt: 0.06, jag: 0.05 }));
    add(kn, cluster(r, { n: 4, rMin: 0.3, rMax: 0.45, len: 0.5, lenVar: 0.2, spread: 0.5, sz: 1.3, dir: -1, tilt: 0.05, jag: 0.02, y0: -1.25, shade: 0.17 }));
    return { th, kn };
  };
  B.LL = leg(-1); B.LR = leg(1);
  // shield crystals
  B.crystals = [[1.5, 3.1, 0.2, 0.3], [-1.6, 3.0, 0.1, -0.35], [0.1, 3.4, -0.9, 0.05]].map(([x, y, z, rz]) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), CRYSTAL.clone());
    m.scale.set(0.7, 1.7, 0.7); m.position.set(x, y, z); m.rotation.z = rz; B.torso.add(m); m.userData.crystal = true;
    return m;
  });
  B.root.position.set(0, 0, -15);
  scene.add(B.root);
  return B;
}
const W = buildBoss();

// ───────────────────────── heroes ─────────────────────────
function mat(c, o = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o }); }
function buildHero(id) {
  const H = { root: new THREE.Group(), mats: [] };
  const M = (c, o) => { const m = mat(c, o); H.mats.push(m); return m; };
  const mesh = (geo, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const P = {
    aldric: { coat: '#6e1c24', body: '#8e9daf', skin: '#e6b893', hair: '#3a2a20', boot: '#3b2a20', coatLen: 0.55 },
    wren: { coat: '#23776f', body: '#2d6f6a', skin: '#efcaa6', hair: '#e9e4ef', boot: '#3a2a3e', coatLen: 0.95 },
    sable: { coat: '#6d4429', body: '#3a3148', skin: '#dcae88', hair: '#a4462e', boot: '#2e2420', coatLen: 0.7 },
  }[id];
  const skin = M(P.skin), bodyM = M(P.body, id === 'aldric' ? { metalness: 0.55, roughness: 0.45 } : {}), coat = M(P.coat, { side: THREE.DoubleSide }), boot = M(P.boot), hairM = M(P.hair);
  // legs
  H.legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.12, 0.92, 0); H.root.add(g); mesh(new THREE.CapsuleGeometry(0.08, 0.62, 3, 8), boot, g, 0, -0.42, 0); mesh(new THREE.BoxGeometry(0.14, 0.1, 0.26), boot, g, 0, -0.86, -0.05); return g; });
  // torso pivot at the hips
  H.torso = new THREE.Group(); H.torso.position.y = 0.95; H.root.add(H.torso);
  const len = P.coatLen;
  const coatGeo = new THREE.LatheGeometry([new V3(0.2, 0.12), new V3(0.25, 0.02), new V3(0.29, -len * 0.4), new V3(0.34 + len * 0.08, -len)].map(v => new THREE.Vector2(v.x, v.y)), 9);
  mesh(coatGeo, coat, H.torso);
  mesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 10), bodyM, H.torso, 0, 0.42, 0);
  mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.08, 10), M('#3b2a20'), H.torso, 0, 0.08, 0);
  H.head = new THREE.Group(); H.head.position.y = 0.8; H.torso.add(H.head);
  mesh(new THREE.SphereGeometry(0.155, 14, 10), skin, H.head, 0, 0, 0);
  const eyeM = M('#1d1614'); for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 0.035, 0.02), eyeM, H.head, s * 0.055, 0.015, -0.145);
  // arms
  H.arms = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(s * 0.27, 0.6, 0); H.torso.add(g);
    mesh(new THREE.CapsuleGeometry(0.062, 0.4, 3, 8), s > 0 ? bodyM : bodyM, g, 0, -0.24, 0);
    const hand = new THREE.Group(); hand.position.y = -0.52; g.add(hand);
    mesh(new THREE.SphereGeometry(0.06, 8, 6), skin, hand);
    return { g, hand };
  });
  H.armL = H.arms[0]; H.armR = H.arms[1];
  if (id === 'aldric') {
    mesh(new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), bodyM, H.head, 0, 0.02, 0).rotation.x = 0.55;
    const plume = mesh(new THREE.ConeGeometry(0.05, 0.4, 6), M('#b3262e'), H.head, 0, 0.2, 0.12); plume.rotation.x = 1.9;
    const capeGeo = new THREE.PlaneGeometry(0.5, 1.05, 6, 8), cp = capeGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), f = 0.5 - y / 1.05; const wx = x * (0.85 + f * 0.7); cp.setXYZ(i, wx, y - 0.4, wx * wx * 1.6 + Math.sin(f * 5 + x * 6) * 0.03); }
    capeGeo.computeVertexNormals();
    const cape = mesh(capeGeo, coat, H.torso, 0, 0.62, 0.2); cape.rotation.x = 0.1; H.cape = cape;
    const pad = M('#9fb0c2', { metalness: 0.6, roughness: 0.4 });
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), pad, H.torso, s * 0.3, 0.64, 0);
    const sw = new THREE.Group(); H.armR.hand.add(sw); H.weapon = sw;
    mesh(new THREE.BoxGeometry(0.06, 0.02, 1.05), M('#e8eef4', { metalness: 0.9, roughness: 0.2 }), sw, 0, 0, -0.62);
    mesh(new THREE.BoxGeometry(0.28, 0.04, 0.05), M('#d9b35a', { metalness: 0.8, roughness: 0.3 }), sw, 0, 0, -0.08);
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6), M('#3b2a20'), sw, 0, 0, 0.04).rotation.x = Math.PI / 2;
    H.tip = new THREE.Object3D(); H.tip.position.z = -1.1; sw.add(H.tip);
  } else if (id === 'wren') {
    mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, H.head, 0, 0.02, 0.02).rotation.x = 0.5;
    const tail = mesh(new THREE.ConeGeometry(0.13, 0.62, 8), hairM, H.head, 0, -0.26, 0.1); tail.rotation.x = Math.PI + 0.15;
    const hatM = M('#4a3278');
    mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.03, 18), hatM, H.head, 0, 0.12, 0);
    const cone = mesh(new THREE.ConeGeometry(0.19, 0.55, 12), hatM, H.head, 0, 0.4, 0.04); cone.rotation.x = 0.28;
    const st = new THREE.Group(); H.armR.hand.add(st); H.weapon = st;
    mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.75, 6), M('#6b4a2f'), st, 0, 0.15, 0);
    H.orb = mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshStandardMaterial({ color: '#0d3b36', emissive: '#6ff0dc', emissiveIntensity: 2.2 }), st, 0, 1.06, 0);
    H.tip = H.orb;
  } else {
    mesh(new THREE.SphereGeometry(0.168, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM, H.head, 0, 0, 0.01).rotation.x = 0.5;
    const hatM = M('#2c2533');
    mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.025, 18), hatM, H.head, 0, 0.1, 0);
    mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.18, 12), hatM, H.head, 0, 0.19, 0);
    const scarf = M('#c43d3d');
    mesh(new THREE.TorusGeometry(0.15, 0.05, 6, 12), scarf, H.torso, 0, 0.66, 0).rotation.x = Math.PI / 2;
    const tailS = mesh(new THREE.BoxGeometry(0.1, 0.4, 0.03), scarf, H.torso, 0.08, 0.46, 0.2); tailS.rotation.z = 0.2; H.cape = tailS;
    const rf = new THREE.Group(); H.armR.hand.add(rf); H.weapon = rf;
    const metal = M('#4a4d55', { metalness: 0.8, roughness: 0.35 });
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 8), metal, rf, 0, 0, -0.55).rotation.x = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.07, 0.09, 0.45), M('#7a4d30'), rf, 0, -0.03, 0.05);
    H.tip = new THREE.Object3D(); H.tip.position.z = -1.05; rf.add(H.tip);
  }
  H.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(H.root);
  return H;
}

// ───────────────────────── audio ─────────────────────────
let AC = null, master, musBus, sfxBus, noiseBuf, verb, muted = false;
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
  AC = new A();
  master = AC.createGain(); master.gain.value = muted ? 0 : 0.7;
  const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
  master.connect(comp); comp.connect(AC.destination);
  // a cheap reverb: decaying noise impulse
  verb = AC.createConvolver();
  const len = AC.sampleRate * 2.4, ir = AC.createBuffer(2, len, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  verb.buffer = ir; const vg = AC.createGain(); vg.gain.value = 0.3; verb.connect(vg); vg.connect(master);
  musBus = AC.createGain(); musBus.gain.value = 0.26; musBus.connect(master); musBus.connect(verb);
  sfxBus = AC.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
  const sv = AC.createGain(); sv.gain.value = 0.25; sfxBus.connect(sv); sv.connect(verb);
  noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
}
function osc(type, f, t, dur, vol, o = {}) {
  const v = AC.createOscillator(); v.type = type;
  v.frequency.setValueAtTime(f, t); if (o.f2) v.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  let node = v;
  if (o.lp) { const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; v.connect(fl); node = fl; }
  const gn = AC.createGain(), a = o.a ?? 0.005, r = o.r ?? 0.05;
  gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(vol, t + a);
  if (o.decay) gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  else { gn.gain.setValueAtTime(vol, t + Math.max(a, dur - r)); gn.gain.linearRampToValueAtTime(0, t + dur); }
  node.connect(gn); gn.connect(o.dest || sfxBus); v.start(t); v.stop(t + dur + 0.05);
}
function noise(t, dur, vol, o = {}) {
  const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = AC.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(o.f || 2000, t);
  if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur); fl.Q.value = o.q || 1;
  const gn = AC.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + (o.a || 0.005)); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(fl); fl.connect(gn); gn.connect(o.dest || sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function sfx(n) {
  if (!AC) return; const t = AC.currentTime + 0.004;
  switch (n) {
    case 'blip': osc('triangle', 1400, t, 0.05, 0.1, { decay: 1 }); break;
    case 'ok': osc('triangle', 880, t, 0.08, 0.14, { decay: 1 }); osc('triangle', 1320, t + 0.05, 0.12, 0.12, { decay: 1 }); break;
    case 'back': osc('triangle', 700, t, 0.08, 0.1, { decay: 1 }); break;
    case 'buzz': osc('square', 120, t, 0.14, 0.08, { lp: 800 }); break;
    case 'slash': noise(t, 0.18, 0.5, { type: 'highpass', f: 2000, f2: 6000 }); break;
    case 'hit': noise(t, 0.25, 0.7, { type: 'lowpass', f: 1800, f2: 200 }); osc('sine', 140, t, 0.2, 0.4, { f2: 50, decay: 1 }); noise(t, 0.08, 0.3, { type: 'highpass', f: 4000 }); break;
    case 'big': noise(t, 0.5, 0.9, { type: 'lowpass', f: 2500, f2: 90 }); osc('sine', 110, t, 0.4, 0.6, { f2: 35, decay: 1 }); break;
    case 'block': osc('sine', 2400, t, 0.4, 0.12, { decay: 1 }); osc('sine', 3100, t, 0.5, 0.08, { decay: 1 }); noise(t, 0.1, 0.3, { type: 'highpass', f: 5000 }); break;
    case 'hurt': noise(t, 0.2, 0.6, { type: 'lowpass', f: 1200, f2: 200 }); osc('sine', 220, t, 0.15, 0.3, { f2: 80, decay: 1 }); break;
    case 'parry':
      osc('sine', 1760, t, 0.9, 0.22, { decay: 1 }); osc('sine', 2637, t, 0.7, 0.14, { decay: 1 }); osc('triangle', 880, t, 0.3, 0.2, { decay: 1 });
      noise(t, 0.08, 0.7, { type: 'highpass', f: 4500 }); break;
    case 'dodge': noise(t, 0.2, 0.3, { type: 'bandpass', f: 600, f2: 2600, q: 2, a: 0.03 }); break;
    case 'jump': noise(t, 0.18, 0.25, { type: 'bandpass', f: 400, f2: 1600, q: 1.5, a: 0.02 }); break;
    case 'glint': osc('sine', 3520, t, 0.25, 0.07, { decay: 1 }); break;
    case 'step': osc('sine', 60, t, 0.3, 0.45, { f2: 35, decay: 1 }); noise(t, 0.25, 0.25, { type: 'lowpass', f: 300 }); break;
    case 'slam': osc('sine', 55, t, 0.8, 0.9, { f2: 28, decay: 1 }); noise(t, 0.9, 0.9, { type: 'lowpass', f: 900, f2: 60 }); noise(t, 0.2, 0.4, { type: 'bandpass', f: 1500 }); break;
    case 'whoosh': noise(t, 0.35, 0.4, { type: 'bandpass', f: 200, f2: 900, q: 1.2, a: 0.15 }); break;
    case 'rumble': noise(t, 1.2, 0.5, { type: 'lowpass', f: 180, a: 0.3 }); break;
    case 'crack': noise(t, 0.3, 0.7, { type: 'highpass', f: 1500, f2: 400 }); osc('sine', 90, t, 0.3, 0.4, { f2: 40, decay: 1 }); break;
    case 'shot': noise(t, 0.12, 0.8, { type: 'highpass', f: 900 }); osc('sine', 180, t, 0.15, 0.4, { f2: 60, decay: 1 }); break;
    case 'bigshot': noise(t, 0.6, 1, { type: 'lowpass', f: 3500, f2: 150 }); osc('sine', 90, t, 0.5, 0.7, { f2: 30, decay: 1 }); break;
    case 'fire': noise(t, 0.6, 0.6, { type: 'lowpass', f: 500, f2: 3000, a: 0.08 }); break;
    case 'ice': for (let i = 0; i < 5; i++) osc('sine', 2000 + i * 420, t + i * 0.03, 0.4, 0.05, { decay: 1 }); noise(t, 0.2, 0.3, { type: 'highpass', f: 6000 }); break;
    case 'bolt': osc('sine', 900, t, 0.3, 0.12, { f2: 1800, decay: 1 }); noise(t, 0.15, 0.2, { type: 'bandpass', f: 3000 }); break;
    case 'heal': [0, 4, 7, 12].forEach((s, i) => osc('sine', 523 * 2 ** (s / 12), t + i * 0.07, 0.6, 0.1, { decay: 1 })); break;
    case 'guard': osc('triangle', 330, t, 0.5, 0.2, { f2: 660, decay: 1 }); osc('sine', 990, t + 0.1, 0.6, 0.08, { decay: 1 }); break;
    case 'mark': osc('sine', 1760, t, 0.15, 0.1, { decay: 1 }); osc('sine', 1760, t + 0.1, 0.15, 0.1, { decay: 1 }); break;
    case 'break': noise(t, 1.2, 1, { type: 'lowpass', f: 3000, f2: 70 }); osc('sine', 70, t, 1, 0.8, { f2: 25, decay: 1 }); osc('sine', 1400, t, 0.5, 0.1, { f2: 300, decay: 1 }); break;
    case 'shatter': for (let i = 0; i < 5; i++) osc('sine', 2800 + i * 330, t + i * 0.015, 0.5, 0.06, { decay: 1 }); noise(t, 0.25, 0.5, { type: 'highpass', f: 3500 }); break;
    case 'qteP': osc('sine', 1568, t, 0.3, 0.15, { decay: 1 }); osc('sine', 2349, t + 0.06, 0.4, 0.13, { decay: 1 }); break;
    case 'qteG': osc('sine', 1318, t, 0.3, 0.13, { decay: 1 }); break;
    case 'qteM': osc('triangle', 180, t, 0.2, 0.12, { decay: 1 }); break;
    case 'ring': osc('sine', 1046, t, 0.12, 0.05, { decay: 1 }); break;
    case 'ko': [0, 1, 2].forEach(i => osc('triangle', 330 / (1 + i * 0.35), t + i * 0.12, 0.3, 0.14, { decay: 1 })); break;
    case 'revive': [0, 7, 12, 19].forEach((s, i) => osc('sine', 392 * 2 ** (s / 12), t + i * 0.08, 0.6, 0.1, { decay: 1 })); break;
    case 'roar': noise(t, 1.6, 0.8, { type: 'bandpass', f: 180, f2: 90, q: 3, a: 0.2 }); osc('sawtooth', 55, t, 1.5, 0.12, { f2: 40, lp: 400, a: 0.2 }); break;
    case 'grow': for (let i = 0; i < 3; i++) osc('sine', 1320 + i * 220, t + i * 0.1, 0.6, 0.06, { decay: 1 }); noise(t, 0.4, 0.2, { type: 'highpass', f: 5000, a: 0.1 }); break;
  }
}

// music: plucked minor arpeggios, a bowed bass and hand drums that grow with the fight
const MF = m => 440 * Math.pow(2, (m - 69) / 12);
const PROG = [[50, [62, 65, 69, 74]], [46, [58, 62, 65, 70]], [53, [60, 65, 69, 72]], [48, [60, 64, 67, 72]]];
const THEME = [74, null, 77, 76, 74, null, 69, null, 70, null, 74, 72, 69, null, null, null, 72, null, 76, 77, 79, null, 77, 76, 76, null, 72, null, 74, null, null, null];
const TUNES = { calm: { bpm: 84, drums: 0, lead: 0 }, fight: { bpm: 96, drums: 1, lead: 1 }, rage: { bpm: 108, drums: 2, lead: 1, tr: 0 } };
const Music = { cfg: null, step: 0, nextT: 0, timer: 0 };
function music(name) {
  if (!AC) return;
  const cfg = name && TUNES[name];
  if (!cfg) { Music.cfg = null; clearInterval(Music.timer); Music.timer = 0; return; }
  Music.cfg = cfg;
  if (!Music.timer) { Music.step = 0; Music.nextT = AC.currentTime + 0.1; Music.timer = setInterval(musicTick, 30); }
}
function musicTick() {
  const c = Music.cfg; if (!c || !AC) return;
  const spb = 60 / c.bpm / 2; // eighth notes
  while (Music.nextT < AC.currentTime + 0.2) {
    const s = Music.step, t = Music.nextT, bar = (s >> 3) % 4, e8 = s & 7, [root, ch] = PROG[bar], d = { dest: musBus };
    if (e8 === 0) { osc('sawtooth', MF(root - 12), t, spb * 8, 0.08, { lp: 420, a: 0.4, r: 0.6 }); osc('sawtooth', MF(root), t, spb * 8, 0.04, { lp: 700, a: 0.6, r: 0.8 }); }
    const n = ch[[0, 1, 2, 3, 2, 1, 2, 3][e8]];
    osc('triangle', MF(n), t, 0.6, 0.06, { decay: 1, dest: musBus });
    if (c.lead) { const m = THEME[(s % 32)]; if (m) osc('sawtooth', MF(m - 12), t, spb * 2.6, 0.045, { lp: 1400, a: 0.06, r: 0.2, dest: musBus }); }
    if (c.drums) {
      if (e8 === 0 || e8 === 3 || (c.drums > 1 && e8 === 6)) { osc('sine', 70, t, 0.35, 0.5, { f2: 38, decay: 1, dest: musBus }); noise(t, 0.12, 0.2, { type: 'lowpass', f: 600, dest: musBus }); }
      if (e8 === 4) noise(t, 0.15, 0.22, { type: 'bandpass', f: 900, q: 2, dest: musBus });
      if (c.drums > 1 && (e8 & 1)) noise(t, 0.05, 0.08, { type: 'highpass', f: 6000, dest: musBus });
    }
    void d;
    Music.nextT += spb; Music.step = s + 1;
  }
}

// ───────────────────────── game data ─────────────────────────
const DIFFS = {
  story: { win: 1.7, dmg: 0.6, glint: true, rings: true, qte: 1.5 },
  normal: { win: 1, dmg: 1, glint: true, rings: false, qte: 1 },
  hard: { win: 0.75, dmg: 1.35, glint: false, rings: false, qte: 0.8 },
};
let DIFF = DIFFS.normal;
const WIN = { parry: [120, 70], dodge: [190, 100] };
const JUMP_AIR = [70, 520];
const WSPD = 15;  // shockwave speed, m/s

const SKILLS = {
  aldric: [
    { id: 'cleave', name: 'Cleave', ap: 2, desc: 'A heavy blow. Press J as the ring closes for more damage.' },
    { id: 'sunder', name: 'Sunder', ap: 4, desc: 'Two strikes that crack its guard. Big BREAK damage.' },
    { id: 'bulwark', name: 'Bulwark', ap: 2, desc: 'The party takes 40% less on its next turn, and it comes for Aldric.' },
  ],
  wren: [
    { id: 'ember', name: 'Ember', ap: 2, desc: 'Fire that keeps burning for 3 of its turns.' },
    { id: 'glacier', name: 'Glacier', ap: 3, desc: 'Three ice lances. Pushes its next turn back.' },
    { id: 'mend', name: 'Mend', ap: 2, desc: 'Heal one ally. A perfect ring heals more.', target: 'ally' },
  ],
  sable: [
    { id: 'mark', name: 'Mark', ap: 1, desc: 'The next hit on it deals 60% more.' },
    { id: 'volley', name: 'Volley', ap: 3, desc: 'Four quick shots. Each one can knock off a crystal.' },
    { id: 'deadeye', name: 'Deadeye', ap: 5, desc: 'One huge shot at the core. Only a perfect ring does it justice.' },
  ],
};
const ITEMS = [
  { id: 'tonic', name: 'Tonic', desc: 'Restore half of an ally’s HP.', target: 'ally' },
  { id: 'ether', name: 'Ether', desc: 'Give an ally 3 AP.', target: 'ally' },
  { id: 'feather', name: 'Feather', desc: 'Bring a fallen ally back at 40% HP.', target: 'ko' },
];
const CMDS = [
  { id: 'attack', name: 'Attack', key: '1', desc: 'A basic strike. Earns 1 AP.' },
  { id: 'skill', name: 'Skills', key: '2', desc: 'Spend AP on a skill.' },
  { id: 'item', name: 'Items', key: '3', desc: 'The shared pouch.' },
  { id: 'aim', name: 'Aim', key: '4', desc: 'Free-aim shots, 1 AP each. Blue crystals are its shields; the glowing core is a weak point. Does not end the turn.' },
];

// Boss strings. w = ms since the previous impact. k = slam | throw | stomp (jump it) | sweep (hits everyone)
const MOVES = {
  crush: { name: 'CRUSH', target: 'one', steps: [{ w: 1050, k: 'slam', d: 110 }, { w: 850, k: 'slam', d: 110 }] },
  hurl: { name: 'HURL', target: 'one', steps: [{ w: 1300, k: 'throw', d: 80 }, { w: 700, k: 'throw', d: 80 }, { w: 800, k: 'throw', d: 80 }] },
  quake: { name: 'QUAKE', target: 'all', steps: [{ w: 1500, k: 'stomp', d: 120 }] },
  landslide: { name: 'LANDSLIDE', target: 'all', steps: [{ w: 1300, k: 'sweep', d: 125 }] },
  grind: { name: 'GRINDSTONE', target: 'one', steps: [{ w: 900, k: 'slam', d: 95 }, { w: 1400, k: 'slam', d: 95 }, { w: 560, k: 'slam', d: 95 }, { w: 800, k: 'slam', d: 95 }] },
  aftershock: { name: 'AFTERSHOCK', target: 'all', steps: [{ w: 1450, k: 'stomp', d: 100 }, { w: 800, k: 'stomp', d: 100 }] },
  avalanche: { name: 'AVALANCHE', target: 'one', steps: [{ w: 1200, k: 'throw', d: 85 }, { w: 520, k: 'throw', d: 85 }, { w: 520, k: 'throw', d: 85 }, { w: 1500, k: 'stomp', d: 120 }] },
  cataclysm: { name: 'CATACLYSM', target: 'all', steps: [{ w: 1300, k: 'sweep', d: 90 }, { w: 1000, k: 'sweep', d: 90 }, { w: 1300, k: 'stomp', d: 110 }, { w: 800, k: 'sweep', d: 90 }, { w: 1200, k: 'stomp', d: 110 }] },
  regrow: { name: 'REGROW', special: 'regrow' },
};
const BOSS_HOME = new V3(0, 0, -15);
const REST = { x: 0, z: -15, crouch: 0, pitch: 0.05, twist: 0, aSh: -0.12, aEl: -0.25, aSide: 0.12, bSh: -0.12, bEl: -0.25, bSide: 0.12, rock: 0 };

const HERO_DEFS = [
  { id: 'aldric', name: 'Aldric', hp: 620, spd: 9, atk: 210, home: new V3(-3.0, 0, 0.6) },
  { id: 'wren', name: 'Wren', hp: 440, spd: 11, atk: 150, home: new V3(0, 0, 1.9) },
  { id: 'sable', name: 'Sable', hp: 500, spd: 12, atk: 170, home: new V3(3.0, 0, 0.6) },
];
const HEROES = HERO_DEFS.map(d => ({ ...d, rig: buildHero(d.id) }));

let S = null, ui = null, aim = null, script = null, started = false;
const tmp = new V3(), tmp2 = new V3();

function newBattle() {
  for (const h of HEROES) {
    Object.assign(h, { maxhp: h.hp0 ?? h.hp, ko: false, ap: 2, next: 0, act: null, flash: 0, doom: 0 });
    h.hp0 = h.hp0 ?? h.hp; h.maxhp = h.hp0; h.hp = h.hp0;
    h.pos = h.home.clone(); h.pose = heroTarget(h, 0); h.root = h.rig.root;
    h.next = 100 / h.spd * rnd(0.2, 0.9);
  }
  const boss = { name: 'THE BASALT WARDEN', maxhp: 13000, hp: 13000, brk: 0, broken: false, crystals: [true, true, true], marked: false, burn: 0, spd: 10, next: 0, kf: null, flash: 0, last: null, regrowCD: 2, cataCD: 0, dying: 0, rage: false, pose: { ...REST }, walk: 0, prevX: 0, prevZ: -15 };
  boss.next = 100 / boss.spd * 0.95;
  S = {
    t0: now(), heroes: HEROES, boss, items: { tonic: 3, ether: 2, feather: 2 },
    seq: null, presses: [], lock: { parry: 0, dodge: 0, jump: 0 }, guard: 0, taunt: null,
    nums: [], pops: [], projs: [], waves: [], slashes: [], shots: [], shake: { t: 0, a: 0 }, banner: null, dlg: null, qte: null, results: null,
    tut: {}, stats: { incoming: 0, parried: 0, dodged: 0, jumped: 0, hit: 0, counters: 0, qtes: 0, perfect: 0, turns: 0, ko: 0 },
    active: null, cam: 'intro', camHero: null, camT: now(),
  };
  for (const m of W.crystals) { m.visible = true; m.scale.set(0.7, 1.7, 0.7); }
  setRage(false);
  W.root.visible = true; W.root.position.copy(BOSS_HOME); W.root.rotation.set(0, 0, 0);
  ui = null; aim = null;
}
function setRage(on) {
  const c = on ? '#ff3b2a' : '#ff8a3a';
  GLOW.emissive.set(c); GLOW.emissiveIntensity = on ? 2.6 : 1.7; W.coreLight.color.set(c); EYE.color.set(on ? '#ff4a3a' : '#ffb46a');
}

// ───────────────────────── coroutines ─────────────────────────
function run(gen) { script = { gen, wait: null }; advance(undefined); }
function advance(val) {
  const r = script.gen.next(val);
  if (r.done) { script = null; return; }
  script.wait = typeof r.value === 'number' ? now() + r.value : r.value;
}
function tickScript(t) {
  if (!script) return;
  const w = script.wait;
  if (typeof w === 'number') { if (t >= w) advance(undefined); return; }
  if (typeof w === 'function') { const v = w(t); if (v) advance(v); return; }
  advance(undefined);
}
function* tween(ms, fn) { const t0 = now(); fn(0); yield t => { const k = Math.min(1, (t - t0) / ms); fn(k); return k >= 1; }; }

// ───────────────────────── fx helpers ─────────────────────────
function num(pos, v, c = '#fff', big = false) { S.nums.push({ p: pos.clone(), v: String(v), c, t0: now(), big, dx: rnd(-20, 20) }); }
function pop(pos, v, c = '#fff') { S.pops.push({ p: pos.clone(), v, c, t0: now() }); }
function shake(a) { S.shake = { t: now(), a }; }
const flashEl = $('flash');
function flash(c, dur = 140, a = 0.5) { flashEl.style.transition = 'none'; flashEl.style.background = c; flashEl.style.opacity = a; requestAnimationFrame(() => { flashEl.style.transition = `opacity ${dur}ms ease-out`; flashEl.style.opacity = 0; }); }
function banner(t, c = '#efe6d2', dur = 1300) { S.banner = { text: t, c, t0: now(), dur }; }
function living() { return S.heroes.filter(h => !h.ko); }
function corePos() { return W.core.getWorldPosition(new V3()); }
function chest(h) { return new V3(h.pos.x, h.pos.y + 1.35, h.pos.z); }
function tipPos(h) { return h.rig.tip.getWorldPosition(new V3()); }
function tick(a) { return 100 / a.spd; }
function shards() { return S.boss.crystals.filter(Boolean).length; }

// ───────────────────────── damage ─────────────────────────
function addBreak(v) {
  const b = S.boss; if (b.broken || b.hp <= 0 || !v) return;
  b.brk = Math.min(100, b.brk + v);
  if (b.brk >= 100) { b.broken = true; banner('BREAK', '#f3d68a', 1500); sfx('break'); shake(0.35); flash('#fff', 250, 0.6); sparks(corePos(), '#ffd27a', 50, 9); debris(corePos(), 16, 6); }
}
function breakCrystal(i) {
  const b = S.boss, m = W.crystals[i]; b.crystals[i] = false; m.visible = false;
  const p = m.getWorldPosition(new V3());
  sparks(p, '#a8dcff', 30, 7); sfx('shatter');
  return p;
}
function hurtBoss(amount, o = {}) {
  const b = S.boss; if (b.hp <= 0) return 0;
  const at = o.at || corePos();
  if (!o.pierce && shards() > 0) {
    const i = b.crystals.lastIndexOf(true); const p = breakCrystal(i);
    pop(p, 'BLOCKED', '#9fd0ff'); sfx('block');
    addBreak((o.brk || 0) * 0.5);
    return 0;
  }
  let d = amount * rnd(0.94, 1.06);
  if (b.marked && !o.noMark) { d *= 1.6; b.marked = false; pop(at.clone().add(new V3(0, 0.6, 0)), 'MARKED', '#ff8a7a'); }
  if (b.broken) d *= 1.3;
  d = Math.round(d);
  b.hp = Math.max(0, b.hp - d); b.flash = now();
  num(at, d, o.crit ? '#f3d68a' : '#fff', d > 600);
  shake(d > 800 ? 0.3 : d > 300 ? 0.15 : 0.07);
  sparks(at, '#ffd9a0', 10 + Math.min(30, d / 30 | 0), 6); debris(at, 2 + Math.min(8, d / 150 | 0), 4, 0.8);
  addBreak(o.brk || 0);
  return d;
}
function hurtHero(h, amount, o = {}) {
  if (h.ko) return;
  let d = o.raw ? amount : amount * DIFF.dmg * rnd(0.92, 1.08);
  if (S.guard && !o.raw) d *= 0.6;
  d = Math.round(d);
  h.hp = Math.max(0, h.hp - d); h.flash = now(); h.act = { type: 'hurt', t0: now() };
  num(chest(h), d, '#ff8a7a'); sfx('hurt'); shake(0.12);
  if (h.hp <= 0) { h.ko = true; h.ap = 0; S.stats.ko++; sfx('ko'); pop(chest(h), 'DOWN', '#ff8a7a'); h.act = null; }
}
function heal(h, amount) {
  amount = Math.round(amount); h.hp = Math.min(h.maxhp, h.hp + amount);
  num(chest(h), amount, '#8dffb8'); sfx('heal');
  for (let i = 0; i < 20; i++) emit(SPARKS, new V3(h.pos.x + rnd(-0.4, 0.4), rnd(0.1, 1.8), h.pos.z + rnd(-0.4, 0.4)), { vy: rnd(0.5, 1.5), life: rnd(600, 1100), size: rnd(0.06, 0.12), color: '#8dffb8' });
}
function gainAP(h, n) { h.ap = Math.min(9, h.ap + n); }

// ───────────────────────── turn order ─────────────────────────
function actors() { return [...living(), S.boss]; }
function nextActor() {
  const list = actors(); let m = list[0];
  for (const a of list) if (a.next < m.next) m = a;
  const base = m.next; for (const a of S.heroes) a.next -= base; S.boss.next -= base;
  return m;
}
function forecast(n) {
  const list = actors().map(a => ({ a, v: a.next })), out = [];
  for (let i = 0; i < n && list.length; i++) { let m = list[0]; for (const x of list) if (x.v < m.v) m = x; out.push(m.a); m.v += tick(m.a); }
  return out;
}

// ───────────────────────── battle flow ─────────────────────────
function* battle(intro) {
  S.cam = 'intro'; S.camT = now();
  if (intro) {
    music('calm');
    yield 1200;
    yield* say(['The pass at Greystep is held by stone that remembers how to stand.']);
    sfx('roar'); shake(0.15); W.eyesT = now();
    yield* say(['The Warden rises from the cliff face. Its core burns like a forge.']);
  }
  music('fight');
  for (;;) {
    const a = nextActor();
    S.stats.turns++;
    if (a === S.boss) yield* bossTurn(); else yield* heroTurn(a);
    if (S.boss.hp <= 0) { yield* victory(); return; }
    if (!living().length) { yield* defeat(); return; }
    yield* phaseCheck();
  }
}
function* say(lines) {
  S.dlg = { lines: Array.isArray(lines) ? lines : [lines], adv: false, t0: now() };
  yield () => S.dlg.adv;
  S.dlg = null;
  yield 80;
}
function* phaseCheck() {
  const b = S.boss;
  if (!b.rage && b.hp / b.maxhp <= 0.5) {
    b.rage = true; b.spd = 12; b.cataCD = 0; b.crystals = [true, true, true];
    S.cam = 'boss'; S.camT = now();
    yield 500;
    setRage(true); sfx('roar'); sfx('grow'); shake(0.3); flash('#ff5a3a', 400, 0.35);
    for (const m of W.crystals) { m.visible = true; sparks(m.getWorldPosition(new V3()), '#a8dcff', 20, 4); }
    sparks(corePos(), '#ff5a3a', 60, 8);
    music('rage');
    yield 900;
    yield* say(['The seams split open. The Warden burns red, and the crystals grow back.']);
  }
}

// ───────────────────────── hero turn ─────────────────────────
function* heroTurn(h) {
  S.active = h; S.cam = 'menu'; S.camHero = h; S.camT = now();
  yield* runTo(h, stagePos(h), 360, true);
  h.act = { type: 'ready', t0: now() };
  yield 200;
  if (!S.tut.hero) {
    S.tut.hero = 1;
    yield* say(['Attacks earn AP; skills spend it. When a skill shows a ring, press ' + KEYN.ok + ' as it closes.']);
    yield* say(['Its blue crystals are shields: each one blocks a hit. AIM (1 AP a shot) knocks them off.']);
  }
  let lastIdx = 0;
  for (;;) {
    ui = { hero: h, level: 'cmd', idx: lastIdx, stack: [], result: null };
    const r = yield () => ui.result;
    lastIdx = ui.stack.length ? ui.stack[0].idx : ui.idx;
    ui = null;
    if (r.type === 'aim') { yield* aimMode(h); S.cam = 'menu'; continue; }
    yield* act(h, r);
    break;
  }
  if (!h.ko && h.pos.distanceTo(h.home) > 0.1) yield* runTo(h, h.home, 420);
  h.pos.copy(h.home); h.act = null;
  h.next += tick(h);
  S.active = null;
  yield 150;
}
function* act(h, r) {
  if (r.type === 'attack') { yield* basicAttack(h); gainAP(h, 1); return; }
  if (r.type === 'skill') { const sk = SKILLS[h.id].find(s => s.id === r.id); h.ap -= sk.ap; banner(sk.name.toUpperCase(), '#efe6d2', 900); yield* SK[r.id](h, r.target); return; }
  if (r.type === 'item') {
    const it = ITEMS.find(i => i.id === r.id), t = r.target; S.items[r.id]--; banner(it.name.toUpperCase(), '#efe6d2', 900);
    h.act = { type: 'cast', t0: now() }; yield 350;
    if (r.id === 'tonic') heal(t, t.maxhp * 0.5);
    if (r.id === 'ether') { gainAP(t, 3); pop(chest(t), '+3 AP', '#9fd0ff'); sfx('revive'); }
    if (r.id === 'feather') {
      t.ko = false; t.hp = Math.round(t.maxhp * 0.4); t.ap = 1; t.act = null; sfx('revive');
      t.next = Math.min(...actors().map(a => a.next)) + tick(t) * 0.5;
      sparks(chest(t), '#f3d68a', 40, 4); num(chest(t), t.hp, '#8dffb8');
    }
    yield 600; h.act = null;
  }
}
function stagePos(h) { return h.home.clone().add(new V3(0, 0, -2.2)); }
function meleeSpot(h) { const b = W.root.position; return new V3(b.x + clamp(h.home.x * 0.5, -1.2, 1.2), 0, b.z + 3.2); }
function* runTo(h, to, ms, keepCam) {
  const from = h.pos.clone(); h.act = { type: 'run', t0: now() }; sfx('whoosh');
  if (!keepCam) S.cam = 'follow';
  yield* tween(ms, k => { h.pos.lerpVectors(from, to, easeOut(k)); });
  h.act = null;
}
function* swing(h, big = false) {
  h.act = { type: 'windup', t0: now() }; yield big ? 220 : 150;
  h.act = { type: 'strike', t0: now() }; sfx('slash'); yield 70;
  slashFx(corePos(), big);
}
function slashFx(at, big) {
  const geo = new THREE.RingGeometry(1.4, big ? 1.75 : 1.6, 32, 1, 0, Math.PI * 0.9);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: big ? '#ffe7b0' : '#ffffff', transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(at).add(new V3(0, 0, 0.8)); m.rotation.set(0, 0, rnd(0.2, 0.9) + Math.PI);
  scene.add(m); S.slashes.push({ m, t0: now(), dur: 260 });
}
const PROJ = {
  fire: { color: '#ff8a3a', r: 0.28, emissive: 3 }, ice: { color: '#bff4ff', r: 0.16, emissive: 2.5 },
  bolt: { color: '#8ff5e4', r: 0.14, emissive: 3 }, bullet: { color: '#fff1a8', r: 0.06, emissive: 4 }, big: { color: '#fff1a8', r: 0.16, emissive: 5 },
};
function* projectile(from, to, kind, ms, arc = 0) {
  const d = PROJ[kind];
  const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, 10, 8), new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: d.emissive }));
  m.position.copy(from); scene.add(m);
  const p = { m, from: from.clone(), to: to.clone(), t0: now(), dur: ms, arc, kind, trail: kind === 'bullet' || kind === 'big' };
  S.projs.push(p);
  yield ms;
  sparks(to, d.color, 18, 5);
}
function* basicAttack(h) {
  const cp = corePos();
  if (h.id === 'aldric') {
    yield* runTo(h, meleeSpot(h), 520);
    yield* swing(h); hurtBoss(h.atk, { brk: 7 }); sfx('hit');
    yield 260;
  } else if (h.id === 'wren') {
    h.act = { type: 'cast', t0: now() }; sfx('bolt'); yield 220;
    yield* projectile(tipPos(h), cp, 'bolt', 380); hurtBoss(h.atk, { brk: 7 }); sfx('hit');
    yield 250; h.act = null;
  } else {
    h.act = { type: 'aim', t0: now() }; yield 260;
    sfx('shot'); muzzle(h); yield* projectile(tipPos(h), cp, 'bullet', 110); hurtBoss(h.atk, { brk: 7 }); sfx('hit');
    yield 300; h.act = null;
  }
}
function muzzle(h, big) { const p = tipPos(h); sparks(p, '#fff1a8', big ? 30 : 10, big ? 6 : 3); h.recoil = now(); }

function* qte(pos, dur = 700) {
  const q = { p: pos.clone(), t0: now(), t1: now() + dur, res: null };
  S.qte = q; sfx('ring');
  yield () => q.res;
  S.qte = null; S.stats.qtes++;
  const col = { perfect: '#f3d68a', good: '#9fd0ff', miss: '#a39c8e' }[q.res];
  pop(pos.clone().add(new V3(0, 0.9, 0)), q.res.toUpperCase(), col);
  if (q.res === 'perfect') { S.stats.perfect++; sfx('qteP'); } else sfx(q.res === 'good' ? 'qteG' : 'qteM');
  return q.res === 'perfect' ? 1.5 : q.res === 'good' ? 1.2 : 1;
}
function judgeQte(t) {
  const q = S.qte; if (!q || q.res) return;
  const e = Math.abs(t - q.t1);
  q.res = e <= 60 * DIFF.qte ? 'perfect' : e <= 140 * DIFF.qte ? 'good' : 'miss';
}

const SK = {
  *cleave(h) {
    yield* runTo(h, meleeSpot(h), 520);
    h.act = { type: 'windup', t0: now() };
    const m = yield* qte(corePos(), 700);
    h.act = { type: 'strike', t0: now() }; sfx('slash'); yield 70; slashFx(corePos(), true);
    hurtBoss(430 * m, { brk: 14 }); sfx('big');
    yield 300;
  },
  *sunder(h) {
    yield* runTo(h, meleeSpot(h), 520);
    h.act = { type: 'windup', t0: now() };
    let m = yield* qte(corePos(), 650);
    h.act = { type: 'strike', t0: now() }; sfx('slash'); yield 70; slashFx(corePos(), false); hurtBoss(330 * m, { brk: 16 }); sfx('hit');
    h.act = { type: 'windup', t0: now() };
    m = yield* qte(corePos(), 520);
    h.act = { type: 'strike', t0: now() }; sfx('slash'); yield 70; slashFx(corePos(), true); hurtBoss(330 * m, { brk: 16 }); sfx('big');
    yield 300;
  },
  *bulwark(h) {
    h.act = { type: 'raise', t0: now() }; sfx('guard'); yield 380;
    S.guard = 1; S.taunt = h;
    for (const x of living()) { for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; emit(SPARKS, new V3(x.pos.x + Math.cos(a) * 0.6, rnd(0.2, 1.8), x.pos.z + Math.sin(a) * 0.6), { vy: 0.4, life: 900, size: 0.1, color: '#9fd0ff' }); } }
    pop(chest(h), 'GUARD', '#9fd0ff');
    yield 700; h.act = null;
  },
  *ember(h) {
    h.act = { type: 'cast', t0: now() };
    const m = yield* qte(corePos(), 700);
    sfx('fire'); yield* projectile(tipPos(h), corePos(), 'fire', 480, 2.5);
    hurtBoss(300 * m, { brk: 8 }); S.boss.burn = 3; pop(corePos(), 'BURN', '#ff9a4a');
    yield 350; h.act = null;
  },
  *glacier(h) {
    h.act = { type: 'cast', t0: now() };
    for (let i = 0; i < 3; i++) {
      const tp = corePos().add(new V3((i - 1) * 0.7, (i - 1) * 0.4, 0));
      const m = yield* qte(tp, i ? 470 : 650);
      sfx('ice'); yield* projectile(tipPos(h), tp, 'ice', 260);
      hurtBoss(190 * m, { brk: 6, at: tp });
    }
    S.boss.next += tick(S.boss) * 0.5; pop(corePos(), 'DELAYED', '#bff4ff');
    yield 350; h.act = null;
  },
  *mend(h, t) {
    h.act = { type: 'cast', t0: now() };
    const m = yield* qte(chest(t), 650);
    heal(t, t.maxhp * 0.45 * (m > 1.3 ? 1.35 : m > 1.1 ? 1.15 : 1));
    yield 450; h.act = null;
  },
  *mark(h) {
    h.act = { type: 'aim', t0: now() }; yield 280;
    sfx('mark'); muzzle(h); yield* projectile(tipPos(h), corePos(), 'bullet', 110);
    S.boss.marked = true; pop(corePos(), 'MARKED', '#ff8a7a');
    yield 400; h.act = null;
  },
  *volley(h) {
    h.act = { type: 'aim', t0: now() };
    for (let i = 0; i < 4; i++) {
      const tp = corePos().add(new V3(rnd(-0.8, 0.8), rnd(-0.6, 0.8), 0));
      const m = yield* qte(tp, i ? 430 : 620);
      sfx('shot'); muzzle(h); yield* projectile(tipPos(h), tp, 'bullet', 90);
      hurtBoss(140 * m, { brk: 5, at: tp }); sfx('hit');
    }
    yield 300; h.act = null;
  },
  *deadeye(h) {
    h.act = { type: 'aim', t0: now() }; yield 450;
    const m = yield* qte(corePos(), 520);
    sfx('bigshot'); flash('#fff', 120, 0.5); muzzle(h, true); shake(0.2);
    yield* projectile(tipPos(h), corePos(), 'big', 90);
    hurtBoss(m > 1.3 ? 1300 : m > 1.1 ? 800 : 450, { brk: 20, crit: m > 1.3 });
    yield 450; h.act = null;
  },
};

// ───────────────────────── free aim ─────────────────────────
const ray = new THREE.Raycaster();
function* aimMode(h) {
  const c = toScreen(corePos());
  aim = { h, x: c.x, y: c.y, done: false };
  S.cam = 'aim'; S.camHero = h; h.act = { type: 'aim', t0: now() };
  if (!S.tut.aim) { S.tut.aim = 1; banner('SHOOT THE CRYSTALS', '#9fd0ff', 1600); }
  yield () => aim.done && !S.shots.length;
  aim = null; h.act = { type: 'ready', t0: now() };
}
function aimTargets() { return [...W.crystals.filter(m => m.visible), W.core, ...W.rock]; }
function fire() {
  const h = aim.h;
  if (h.ap < 1) { sfx('buzz'); pop(chest(h).add(new V3(0, 0.6, 0)), 'NO AP', '#a39c8e'); return; }
  h.ap--;
  ray.setFromCamera(new THREE.Vector2(aim.x / innerWidth * 2 - 1, -(aim.y / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(aimTargets(), false)[0];
  const to = hit ? hit.point : ray.ray.at(40, new V3());
  const from = tipPos(h);
  sfx(h.id === 'wren' ? 'bolt' : 'shot'); muzzle(h);
  const kind = h.id === 'wren' ? 'bolt' : 'bullet';
  const s = { h, hit, to }; S.shots.push(s);
  const g = projectile(from, to, kind, 110);
  // run the tiny projectile coroutine inline, independent of the main script
  const p0 = g.next(); void p0;
  setTimeout(() => { g.next(); S.shots.splice(S.shots.indexOf(s), 1); shotLands(s); }, 110);
}
function shotLands(s) {
  const b = S.boss, mult = s.h.id === 'sable' ? 2 : 1;
  if (!s.hit) { return; }
  const o = s.hit.object;
  if (o.userData.crystal) {
    const i = W.crystals.indexOf(o);
    if (b.crystals[i]) { const p = breakCrystal(i); pop(p, 'CRYSTAL', '#9fd0ff'); hurtBoss(30 * mult, { pierce: true, noMark: true, at: p }); }
    return;
  }
  if (o === W.core) { hurtBoss(130 * mult, { pierce: true, noMark: true, brk: 8, crit: true, at: s.to }); pop(s.to.clone().add(new V3(0, 0.5, 0)), 'WEAK POINT', '#f3d68a'); sfx('hit'); return; }
  hurtBoss(55 * mult, { pierce: true, noMark: true, brk: 2, at: s.to }); sfx('hit');
}

// ───────────────────────── boss turn ─────────────────────────
function* bossTurn() {
  const b = S.boss;
  b.next += tick(b);
  b.regrowCD--; b.cataCD--;
  S.cam = 'defend'; S.camT = now();
  if (b.burn > 0) {
    b.burn--; sparks(corePos(), '#ff8a3a', 30, 4); sfx('fire');
    hurtBoss(130, { pierce: true, noMark: true }); yield 700;
    if (b.hp <= 0) return;
  }
  if (b.broken) { banner('STAGGERED', '#f3d68a', 1100); yield 1400; b.broken = false; b.brk = 0; return; }
  const id = chooseMove(), mv = MOVES[id]; b.last = id;
  if (!S.tut.boss) {
    S.tut.boss = 1;
    yield* say(['It attacks in real time. ' + KEYN.parry + ': PARRY right on impact (+1 AP). ' + KEYN.dodge + ': DODGE, a wider window.']);
    yield* say([KEYN.jump + ': JUMP the shockwaves that roll across the ground. Parry or jump a whole string to COUNTER.']);
  }
  banner(mv.name, id === 'cataclysm' ? '#ff8a7a' : '#efe6d2', 1400);
  if (mv.special) { yield* bossSpecial(mv.special); return; }
  const target = S.taunt && !S.taunt.ko ? S.taunt : pick(living());
  const q = buildSeq(mv, target);
  S.seq = q; S.presses = []; b.kf = q.kf;
  yield () => q.done;
  S.seq = null;
  S.guard = 0; S.taunt = null;
  const def = q.ev.filter(e => e.res && e.res !== 'none');
  if (q.counterOK && def.length && b.hp > 0) {
    const who = [...new Set(q.ev.map(e => e.h))].filter(h => !h.ko);
    const perfect = id === 'cataclysm';
    banner(perfect ? 'PERFECT DEFENSE' : 'COUNTER', '#f3d68a', 1100);
    yield 450;
    for (const h of who) {
      S.stats.counters++;
      yield* counter(h, perfect ? 2.2 : 1);
      if (b.hp <= 0) break;
      if (h.pos.distanceTo(h.home) > 0.1) yield* runTo(h, h.home, 380);
      h.pos.copy(h.home); h.act = null;
    }
    S.cam = 'defend';
  }
  yield 400;
}
function chooseMove() {
  const b = S.boss;
  if (b.rage && b.cataCD <= 0) { b.cataCD = 4; return 'cataclysm'; }
  if (shards() === 0 && b.regrowCD <= 0 && Math.random() < 0.55) { b.regrowCD = 4; return 'regrow'; }
  const pool = b.rage ? { grind: 3, aftershock: 2, avalanche: 2, landslide: 2, crush: 1 } : { crush: 3, hurl: 2, quake: 2, landslide: 1 };
  delete pool[b.last];
  return pickW(pool);
}
function* bossSpecial(kind) {
  const b = S.boss, t0 = now(), p = b.pose;
  b.kf = [{ t: t0, ...p }, { t: t0 + 500, ...p, aSh: -2.9, bSh: -2.9, pitch: -0.15, ease: 'out' }, { t: t0 + 1500, ...p, aSh: -2.9, bSh: -2.9, pitch: -0.15 }, { t: t0 + 2000, ...p, ease: 'out' }];
  yield 600;
  if (kind === 'regrow') {
    sfx('roar');
    for (let i = 0; i < 3; i++) { b.crystals[i] = true; const m = W.crystals[i]; m.visible = true; m.scale.set(0.01, 0.01, 0.01); sparks(m.getWorldPosition(new V3()), '#a8dcff', 20, 3); sfx('grow'); yield 260; }
  }
  yield 900;
}
function* counter(h, m) {
  if (h.id === 'aldric') {
    yield* runTo(h, meleeSpot(h), 420);
    yield* swing(h, true); hurtBoss(360 * m, { brk: 12 }); sfx('big'); yield 220;
  } else if (h.id === 'wren') {
    h.act = { type: 'cast', t0: now() }; sfx('bolt'); yield 150;
    yield* projectile(tipPos(h), corePos(), 'bolt', 300); hurtBoss(280 * m, { brk: 12 }); sfx('big'); yield 250; h.act = null;
  } else {
    h.act = { type: 'aim', t0: now() }; yield 180;
    sfx('shot'); muzzle(h); yield* projectile(tipPos(h), corePos(), 'bullet', 100); hurtBoss(300 * m, { brk: 12 }); sfx('big'); yield 250; h.act = null;
  }
}

// Build one string: the impacts the player has to answer, and the keyframes the player reads them from.
function buildSeq(mv, target) {
  const b = S.boss, mul = b.rage ? 0.93 : 1, tn = now();
  const kf = [{ t: tn, ...b.pose, ease: 'lin' }];
  const push = (t, o, ease = 'out') => { const l = kf[kf.length - 1]; kf.push({ ...l, ...o, t: Math.max(t, l.t + 1), ease }); };
  const last = () => kf[kf.length - 1];
  const tg1 = target.ko ? [] : [target];
  const ev = [], vis = [];
  // walk in first if the first strike is up close
  const first = mv.steps[0].k;
  let t0 = tn + 500;
  const walkTo = (x, z) => { const d = Math.hypot(x - last().x, z - last().z); if (d < 0.3) return 0; const ms = d / 9 * 1000 + 250; push(last().t + ms, { x, z, crouch: 0, pitch: 0.12 }, 'lin'); return ms; };
  if (first === 'slam') t0 += walkTo(target.home.x - 2.05, target.home.z - 3.0);
  else if (first === 'sweep') t0 += walkTo(0.8, -5.2);
  else t0 += walkTo(0, -14);
  let T = t0, p = last().t;
  mv.steps.forEach((st, i) => {
    T += st.w * mul;
    const nextW = mv.steps[i + 1] ? mv.steps[i + 1].w * mul : 9999;
    const tg = mv.target === 'one' && st.k !== 'sweep' && st.k !== 'stomp' ? tg1 : living();
    const v = { k: st.k, T, tg, i }; vis.push(v);
    if (st.k === 'slam') {
      const h = tg[0] || target, useA = (i & 1) === 0;
      const x = h.home.x + (useA ? -2.05 : 2.05), z = h.home.z - 3.0;
      const up = useA ? { aSh: -3.3, aEl: -0.6, aSide: 0.15, bSh: -0.2 } : { bSh: -3.3, bEl: -0.6, bSide: 0.15, aSh: -0.2 };
      const dn = useA ? { aSh: -0.55, aEl: 0.05, aSide: 0.05 } : { bSh: -0.55, bEl: 0.05, bSide: 0.05 };
      const fol = nextW < 560 ? 60 : 180;
      push(Math.max(p + 120, Math.min(p + 520, T - 140)), { ...up, x, z, pitch: -0.12, crouch: 0, twist: useA ? 0.25 : -0.25 }, 'out');
      push(T - 110, {}, 'lin');
      push(T, { ...dn, pitch: 0.42, crouch: 0.55, twist: useA ? -0.15 : 0.15 }, 'in');
      push(T + fol, {}, 'lin');
      p = T + fol; v.arm = useA ? 'A' : 'B'; v.glint = T - 330; v.impact = T;
      for (const x2 of tg) ev.push({ h: x2, t: T, jump: false, d: st.d });
    } else if (st.k === 'throw') {
      push(Math.max(p + 100, T - 760), { bSh: -3.25, bEl: -1.3, bSide: 0.2, rock: 1, pitch: -0.12, twist: -0.35 }, 'out');
      push(T - 470, {}, 'lin');
      push(T - 400, { bSh: -1.0, bEl: 0.1, rock: 0, pitch: 0.3, twist: 0.25 }, 'in');
      push(T - 150, { bSh: -0.4, pitch: 0.12, twist: 0 }, 'out');
      p = T - 150; v.launch = T - 400; v.glint = T - 330;
      for (const x2 of tg) ev.push({ h: x2, t: T, jump: false, d: st.d });
    } else if (st.k === 'stomp') {
      const L = last(), ix = L.x, iz = L.z + 2.6;
      const mid = Math.hypot(0 - ix, 0.6 - iz), slam = T - mid / WSPD * 1000;
      push(Math.max(p + 120, slam - 620), { aSh: -3.0, bSh: -3.0, aEl: -0.5, bEl: -0.5, aSide: 0.2, bSide: 0.2, pitch: -0.18, crouch: -0.2, twist: 0 }, 'out');
      push(slam - 110, {}, 'lin');
      push(slam, { aSh: -0.7, bSh: -0.7, aEl: 0, bEl: 0, pitch: 0.62, crouch: 1.2 }, 'in');
      push(slam + 320, {}, 'lin');
      p = slam + 320; v.slam = slam; v.origin = new V3(ix, 0, iz);
      for (const x2 of tg) ev.push({ h: x2, t: slam + Math.hypot(x2.home.x - ix, x2.home.z - iz) / WSPD * 1000, jump: true, d: st.d });
    } else if (st.k === 'sweep') {
      push(Math.max(p + 120, T - 650), { crouch: 1.15, pitch: 0.22, twist: 1.15, aSide: 1.25, aSh: -0.35, aEl: 0, bSh: -0.1 }, 'out');
      push(T - 140, {}, 'lin');
      push(T + 50, { twist: -2.2 }, 'lin');
      push(T + 260, {}, 'lin');
      p = T + 260; v.glint = T - 330; v.arm = 'A';
      for (const x2 of tg) ev.push({ h: x2, t: T, jump: false, d: st.d });
    }
  });
  push(p + 450, { crouch: 0, pitch: 0.08, twist: 0, aSh: REST.aSh, bSh: REST.bSh, aEl: REST.aEl, bEl: REST.bEl, aSide: REST.aSide, bSide: REST.bSide, rock: 0 }, 'out');
  const L = last(); const back = Math.hypot(L.x - BOSS_HOME.x, L.z - BOSS_HOME.z) / 7 * 1000;
  push(L.t + back + 200, { x: BOSS_HOME.x, z: BOSS_HOME.z, pitch: 0.05 }, 'lin');
  const end = Math.max(...ev.map(e => e.t), T) + 450;
  S.stats.incoming += ev.length;
  return { mv, t0, ev, vis, kf, end, done: false, counterOK: true, heroes: [...new Set(ev.map(e => e.h))], cued: new Set() };
}
const POSE_KEYS = Object.keys(REST);
function poseAt(kf, t, out) {
  if (!kf || !kf.length) return Object.assign(out, REST);
  if (t <= kf[0].t) { for (const k of POSE_KEYS) out[k] = kf[0][k]; return out; }
  for (let i = 1; i < kf.length; i++) {
    const b = kf[i]; if (t > b.t) continue;
    const a = kf[i - 1]; let k = (t - a.t) / (b.t - a.t);
    k = b.ease === 'in' ? easeIn(k) : b.ease === 'out' ? easeOut(k) : k;
    for (const key of POSE_KEYS) out[key] = lerp(a[key], b[key], k);
    return out;
  }
  const l = kf[kf.length - 1]; for (const k of POSE_KEYS) out[k] = l[k]; return out;
}

function defend(type, t) {
  const q = S.seq; if (!q || q.done) return;
  if (t < S.lock[type]) return;
  if (type === 'jump') S.lock.jump = t + JUMP_AIR[1] + 60;
  else S.lock[type] = t + 420;
  S.presses.push({ type, t, used: new Set() });
  for (const h of q.heroes) if (!h.ko) h.act = { type, t0: t };
  sfx(type === 'jump' ? 'jump' : type === 'dodge' ? 'dodge' : 'whoosh');
}
function updateSeq(t) {
  const q = S.seq; if (!q) return;
  for (const v of q.vis) {
    if (v.glint && DIFF.glint && t >= v.glint && !q.cued.has(v)) { q.cued.add(v); sfx('glint'); }
    if (v.impact && t >= v.impact && !q.cued.has('i' + v.i)) { q.cued.add('i' + v.i); const f = (v.arm === 'A' ? W.A : W.B).fist.getWorldPosition(new V3()); f.y = 0.1; dust(f, 8, 0.8); debris(f, 5, 4); sfx('slam'); shake(0.25); }
    if (v.slam && t >= v.slam && !q.cued.has('s' + v.i)) { q.cued.add('s' + v.i); S.waves.push({ o: v.origin, t0: v.slam, tg: v.tg }); dust(v.origin, 16, 1.6); debris(v.origin, 12, 6); sfx('slam'); shake(0.4); }
    if (v.launch && t >= v.launch && !q.cued.has('l' + v.i)) {
      q.cued.add('l' + v.i);
      const h = v.tg[0];
      if (h) { const from = W.B.fist.getWorldPosition(new V3()); const rock = W.boulder.clone(); rock.position.copy(from); scene.add(rock); S.projs.push({ m: rock, from, to: chest(h), t0: v.launch, dur: v.T - v.launch, arc: 2.2, kind: 'rock', spin: true }); sfx('whoosh'); }
    }
  }
  const late = Math.max(WIN.parry[1], WIN.dodge[1]) * DIFF.win;
  for (const e of q.ev) if (!e.res && t >= e.t + late) resolveHit(q, e);
  if (!q.done && t >= q.end && q.ev.every(e => e.res)) q.done = true;
}
function resolveHit(q, e) {
  const h = e.h;
  if (h.ko) { e.res = 'none'; return; }
  const P = S.presses, wm = DIFF.win;
  if (e.jump) {
    const p = P.find(p => p.type === 'jump' && e.t >= p.t + JUMP_AIR[0] && e.t <= p.t + JUMP_AIR[1] * Math.min(wm, 1.3));
    if (p) { e.res = 'jump'; S.stats.jumped++; pop(chest(h).add(new V3(0, 0.8, 0)), 'JUMP', '#f3d68a'); return; }
  } else {
    const ok = (p, type) => p.type === type && !p.used.has(h) && e.t - p.t <= WIN[type][0] * wm && p.t - e.t <= WIN[type][1] * wm;
    const pp = P.find(p => ok(p, 'parry'));
    if (pp) {
      pp.used.add(h); S.lock.parry = 0; e.res = 'parry'; S.stats.parried++; gainAP(h, 1);
      sfx('parry'); flash('#fff', 90, 0.22); sparks(chest(h).add(new V3(0, 0.1, -0.6)), '#fff3c8', 40, 8);
      pop(chest(h).add(new V3(0, 0.8, 0)), 'PARRY', '#f3d68a');
      return;
    }
    const dp = P.find(p => ok(p, 'dodge'));
    if (dp) { dp.used.add(h); S.lock.dodge = 0; e.res = 'dodge'; S.stats.dodged++; q.counterOK = false; pop(chest(h).add(new V3(0, 0.8, 0)), 'DODGE', '#9fd0ff'); return; }
  }
  e.res = 'hit'; q.counterOK = false; S.stats.hit++;
  hurtHero(h, e.d);
  sparks(chest(h), '#ff9a7a', 14, 4); dust(new V3(h.pos.x, 0, h.pos.z), 4, 0.5);
}

// ───────────────────────── ending ─────────────────────────
function* victory() {
  const b = S.boss; S.seq = null; ui = null; aim = null;
  b.dying = now(); music(null); sfx('break'); flash('#fff', 500, 0.6);
  S.cam = 'boss'; S.camT = now();
  for (let i = 0; i < 7; i++) { sfx(i & 1 ? 'crack' : 'shatter'); const p = corePos().add(new V3(rnd(-2, 2), rnd(-2, 2), 0)); sparks(p, '#ffd9a0', 30, 7); debris(p, 8, 6); shake(0.25); yield 200; }
  sfx('slam'); sfx('roar'); shake(0.6); flash('#fff', 800, 0.7);
  // it comes apart column by column
  const parts = [];
  W.root.updateMatrixWorld(true);
  for (const m of [...W.rock, W.core, ...W.crystals.filter(c => c.visible)]) {
    const wp = m.getWorldPosition(new V3()), wq = m.getWorldQuaternion(new THREE.Quaternion());
    scene.attach(m); m.position.copy(wp); m.quaternion.copy(wq);
    parts.push({ m, v: new V3(rnd(-3, 3), rnd(0, 4), rnd(-1, 4)), w: new V3(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)) });
  }
  W.root.visible = false; W.dead = parts;
  for (let i = 0; i < 6; i++) { dust(new V3(rnd(-3, 3), 0, -15 + rnd(-2, 3)), 20, 2); yield 150; }
  yield 1200;
  S.cam = 'victory'; S.camT = now();
  for (const h of living()) h.act = { type: 'win', t0: now() };
  victoryJingle();
  yield* say(['The Warden settles back into the cliff it came from. The road north is open.']);
  S.results = results(true);
  yield () => S.results.go;
  restart(false);
}
function* defeat() {
  S.seq = null; ui = null; aim = null; music(null);
  if (AC) { const t = AC.currentTime + 0.1; [62, 58, 57, 50].forEach((m, i) => osc('triangle', MF(m), t + i * 0.45, 1.4, 0.12, { decay: 1, dest: musBus })); }
  yield 1200;
  S.results = results(false);
  yield () => S.results.go;
  restart(false);
}
function victoryJingle() {
  if (!AC) return; const t = AC.currentTime + 0.1;
  [[62, 0], [66, 0.18], [69, 0.36], [74, 0.54], [73, 1.1], [69, 1.28], [74, 1.46]].forEach(([m, at], i) => {
    osc('triangle', MF(m), t + at, i === 3 || i === 6 ? 1.8 : 0.5, 0.16, { decay: 1, dest: musBus });
    osc('sawtooth', MF(m - 12), t + at, 0.8, 0.04, { lp: 900, a: 0.02, dest: musBus });
  });
}
function results(win) {
  const st = S.stats, total = Math.max(1, st.incoming), rate = (st.parried + st.jumped) / total, secs = Math.round((now() - S.t0) / 1000);
  let rank = 'C';
  if (win) rank = rate >= 0.75 && st.ko === 0 ? 'S' : rate >= 0.55 ? 'A' : rate >= 0.3 ? 'B' : 'C';
  return { win, rank, rate, secs, go: false, t0: now() };
}
function restart(intro) {
  if (W.dead) { for (const p of W.dead) scene.remove(p.m); W.dead = null; rebuildBoss(); }
  newBattle();
  hideResults();
  run(battle(intro));
}
function rebuildBoss() {
  scene.remove(W.root);
  const nb = buildBoss();
  Object.keys(W).forEach(k => delete W[k]);
  Object.assign(W, nb);
}

// ───────────────────────── input ─────────────────────────
const KEYMAP = {
  KeyJ: 'A', KeyZ: 'A', Enter: 'A', NumpadEnter: 'A',
  KeyK: 'B', KeyX: 'B', ShiftLeft: 'B', ShiftRight: 'B',
  Escape: 'X', Backspace: 'X', Space: 'J',
  ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', KeyM: 'M',
};
let KEYN = { ok: 'J', parry: 'J', dodge: 'K', jump: 'SPACE' };
const held = new Set();
function evTime(e) { const t = e && e.timeStamp; const n = now(); return t && Math.abs(t - n) < 1000 ? t : n; }
addEventListener('keydown', e => {
  const a = KEYMAP[e.code]; if (!a) return;
  if (started) e.preventDefault();
  if (e.repeat) { if ('UDLR'.includes(a) && ui) onAction(a, evTime(e)); return; }
  held.add(a); onAction(a, evTime(e));
});
addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) held.delete(a); });
addEventListener('blur', () => held.clear());

function onAction(a, t) {
  if (!started) return;
  if (a === 'M') { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.7; return; }
  audioInit();
  if (S.results) { if ((a === 'A' || a === 'J') && now() - S.results.t0 > 700) S.results.go = true; return; }
  if (S.dlg) { if (a === 'A' || a === 'J' || a === 'B') { if (now() - S.dlg.t0 > 250) S.dlg.adv = true; } return; }
  if (S.qte) { if (a === 'A' || a === 'J') judgeQte(t); return; }
  if (aim) {
    if (aim.done) return;
    if (a === 'A' || a === 'J') fire();
    else if (a === 'B' || a === 'X') { aim.done = true; sfx('back'); }
    return;
  }
  if (ui) { menuInput(a); return; }
  if (S.seq) {
    if (a === 'A') defend('parry', t);
    else if (a === 'B') defend('dodge', t);
    else if (a === 'J' || a === 'U') defend('jump', t);
  }
}
function targets(kind) { return kind === 'ko' ? S.heroes.filter(h => h.ko) : living(); }
function menuList(u) {
  const h = u.hero;
  if (u.level === 'cmd') return CMDS.map(c => ({ ...c, off: c.id === 'aim' && h.ap < 1 }));
  if (u.level === 'skill') return SKILLS[h.id].map(s => ({ ...s, off: h.ap < s.ap }));
  if (u.level === 'item') return ITEMS.map(i => ({ ...i, count: S.items[i.id], off: !S.items[i.id] || !targets(i.target).length }));
  return targets(u.pending.target).map(x => ({ id: x.id, name: x.name, hero: x }));
}
function menuInput(a) {
  const u = ui, list = menuList(u), n = list.length;
  if (u.level === 'cmd' && '1234'.includes(a)) { u.idx = +a - 1; menuConfirm(u, list); return; }
  if ('UDLR'.includes(a)) {
    if (u.level !== 'target' && (a === 'L' || a === 'R')) return;
    u.idx = (u.idx + (a === 'D' || a === 'R' ? 1 : -1) + n) % n; sfx('blip'); return;
  }
  if (a === 'B' || a === 'X') { if (u.stack.length) { const s = u.stack.pop(); u.level = s.level; u.idx = s.idx; u.pending = s.pending; sfx('back'); } return; }
  if (a === 'A' || a === 'J') menuConfirm(u, list);
}
function menuConfirm(u, list) {
  const it = list[u.idx]; if (!it) return;
  if (it.off) { sfx('buzz'); return; }
  const done = r => { sfx('ok'); u.result = r; };
  const push = (level, pending) => { u.stack.push({ level: u.level, idx: u.idx, pending: u.pending }); u.level = level; u.idx = 0; if (pending) u.pending = pending; sfx('ok'); };
  if (u.level === 'cmd') {
    if (it.id === 'attack') done({ type: 'attack' });
    else if (it.id === 'aim') done({ type: 'aim' });
    else push(it.id);
  } else if (u.level === 'skill') {
    if (it.target) push('target', { type: 'skill', id: it.id, target: it.target });
    else done({ type: 'skill', id: it.id });
  } else if (u.level === 'item') {
    push('target', { type: 'item', id: it.id, target: it.target });
    if (it.target === 'ally') u.idx = Math.max(0, living().indexOf(u.hero));
  } else if (u.level === 'target') done({ type: u.pending.type, id: u.pending.id, target: it.hero });
}

glCanvas.addEventListener('pointerdown', e => {
  if (!started) return;
  const t = evTime(e); audioInit();
  if (e.button === 2) { onAction('X', t); return; }
  if (aim && !aim.done) { aim.x = e.clientX; aim.y = e.clientY; fire(); return; }
  if (ui && ui.level === 'target') {
    const list = menuList(ui);
    let best = -1, bd = 60;
    list.forEach((x, i) => { const s = toScreen(chest(x.hero)); const d = Math.hypot(s.x - e.clientX, s.y - e.clientY); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { ui.idx = best; menuConfirm(ui, list); }
    return;
  }
  if (S.dlg || S.qte || S.results) onAction('A', t);
});
glCanvas.addEventListener('pointermove', e => { if (aim && !aim.done && e.pointerType === 'mouse') { aim.x = e.clientX; aim.y = e.clientY; } });
glCanvas.addEventListener('contextmenu', e => e.preventDefault());
$('dlg').addEventListener('pointerdown', () => onAction('A', now()));

const touchEl = $('touch');
const KEYACT = { KeyJ: 'A', KeyK: 'B', Space: 'J', Escape: 'X' };
function enableTouch() {
  if (!touchEl.hidden) return;
  touchEl.hidden = false; document.body.classList.add('touching');
  KEYN = { ok: 'OK', parry: 'PARRY', dodge: 'DODGE', jump: 'JUMP' };
}
touchEl.addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); onAction(KEYACT[b.dataset.k], evTime(e)); });
addEventListener('touchstart', () => { if (started) enableTouch(); }, { passive: true });

const padPrev = {};
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const map = { 0: 'A', 1: 'B', 2: 'J', 3: 'J', 9: 'A', 8: 'X', 12: 'U', 13: 'D', 14: 'L', 15: 'R', 6: '4' };
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    for (const k in map) { const down = !!(p.buttons[k] && p.buttons[k].pressed), key = p.index + ':' + k; if (down && !padPrev[key]) onAction(map[k], now()); padPrev[key] = down; }
    const virt = { U: ay < -0.6, D: ay > 0.6, L: ax < -0.6, R: ax > 0.6 };
    for (const k in virt) { const key = p.index + ':' + k; if (virt[k] && !padPrev[key] && ui) onAction(k, now()); padPrev[key] = virt[k]; }
    if (aim && !aim.done) { if (Math.abs(ax) > 0.15) aim.x += ax * 9; if (Math.abs(ay) > 0.15) aim.y += ay * 9; }
  }
}

// ───────────────────────── animation ─────────────────────────
const HERO_IDLE = {
  aldric: { armR: 0.55, armRz: 0.15, armL: 0.1, armLz: -0.12, wx: 0, lean: 0.06 },
  wren: { armR: 0.3, armRz: 0.12, armL: 0.15, armLz: -0.1, wx: 0, lean: 0.03 },
  sable: { armR: 0.35, armRz: 0.1, armL: 0.5, armLz: 0.45, wx: 0.2, lean: 0.05 },
};
function heroTarget(h, t) {
  const b = HERO_IDLE[h.id];
  const p = { ...b, legL: 0, legR: 0, y: 0, ox: 0, oz: 0, ko: 0, wx: b.wx };
  const a = h.act, k = a ? t - a.t0 : 0;
  if (h.ko) { p.ko = 1; return p; }
  if (!a) { p.lean += Math.sin(t / 700 + h.home.x) * 0.02; return p; }
  switch (a.type) {
    case 'ready': p.armR += 0.25; p.lean += 0.08; break;
    case 'run': { const s = Math.sin(k / 55); p.legL = s * 0.9; p.legR = -s * 0.9; p.armL = -s * 0.7; p.lean = 0.35; p.y = Math.abs(s) * 0.08; if (h.id !== 'sable') p.armR = 0.4 + s * 0.3; break; }
    case 'windup': p.armR = 2.9; p.armRz = 0.3; p.lean = -0.1; break;
    case 'strike': p.armR = 0.15; p.armRz = -0.1; p.lean = 0.4; p.legL = 0.5; p.legR = -0.3; break;
    case 'cast': p.armR = 1.45; p.armL = 1.4; p.armLz = 0.2; p.lean = 0.12; break;
    case 'aim': p.armR = 1.52; p.armRz = 0.0; p.armL = 1.45; p.armLz = 0.5; p.lean = 0.04; p.wx = 0; break;
    case 'raise': p.armR = 2.8; p.armRz = 0.05; p.lean = -0.05; break;
    case 'parry': if (k < 260) { p.armR = h.id === 'sable' ? 1.9 : 2.1; p.armRz = -0.55; p.armL = 1.0; p.lean = -0.08; } break;
    case 'dodge': if (k < 420) { const s = Math.sin(k / 420 * Math.PI); p.ox = s * 0.9 * (h.home.x < 0 ? -1 : 1); p.oz = s * 0.7; p.lean = -0.25 * s; p.legL = -0.4 * s; } break;
    case 'jump': { const dur = JUMP_AIR[1] + 80; if (k < dur) { const s = Math.sin(clamp(k / dur, 0, 1) * Math.PI); p.y = s * 1.25; p.legL = -0.9 * s; p.legR = -0.5 * s; p.armL = 0.8 * s; } break; }
    case 'hurt': if (k < 320) { p.lean = -0.35 * (1 - k / 320); p.oz = 0.25 * (1 - k / 320); } break;
    case 'win': p.armR = 2.9 + Math.sin(k / 300) * 0.1; p.armRz = 0.2; p.y = Math.max(0, Math.sin(k / 260)) * 0.1; break;
  }
  return p;
}
function animateHero(h, t, dt) {
  const tgt = heroTarget(h, t), p = h.pose, k = 1 - Math.exp(-dt * 22);
  for (const key in tgt) p[key] = lerp(p[key] ?? tgt[key], tgt[key], key === 'y' || key === 'ox' || key === 'oz' ? 1 : k);
  const r = h.rig;
  r.root.position.set(h.pos.x + p.ox, groundHeight(h.pos.x, h.pos.z) * 0 + p.y + (p.ko ? 0.15 : 0), h.pos.z + p.oz);
  r.root.rotation.x = p.ko * (Math.PI / 2 - 0.1);
  r.root.rotation.y = 0;
  r.torso.rotation.x = -p.lean;
  r.armR.g.rotation.set(p.armR, 0, p.armRz);
  r.armL.g.rotation.set(p.armL, 0, -p.armLz);
  r.legs[0].rotation.x = p.legL; r.legs[1].rotation.x = p.legR;
  if (r.weapon) r.weapon.rotation.x = p.wx + (h.recoil && t - h.recoil < 120 ? 0.25 * (1 - (t - h.recoil) / 120) : 0);
  if (r.cape) r.cape.rotation.x = 0.1 + p.lean * 0.6 + Math.sin(t / 400 + h.home.x) * 0.06 + (h.act && h.act.type === 'run' ? 0.5 : 0);
  const fl = t - h.flash < 140;
  for (const m of r.mats) { m.emissive.set(fl ? '#ff5040' : '#000'); m.emissiveIntensity = fl ? 0.6 : 0; }
}
const bossPose = {};
function animateBoss(t, dt) {
  const b = S.boss;
  if (W.dead) {
    for (const p of W.dead) {
      p.v.y -= 12 * dt; p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.w.x * dt; p.m.rotation.z += p.w.z * dt;
      if (p.m.position.y < 0.2) { p.m.position.y = 0.2; p.v.set(p.v.x * 0.5, Math.abs(p.v.y) * 0.2, p.v.z * 0.5); p.w.multiplyScalar(0.5); }
    }
    return;
  }
  poseAt(b.kf, t, bossPose);
  if (!b.kf || t > b.kf[b.kf.length - 1].t) { bossPose.aSh += Math.sin(t / 900) * 0.04; bossPose.bSh += Math.sin(t / 900 + 1) * 0.04; bossPose.pitch += Math.sin(t / 1100) * 0.02; }
  if (b.broken) { bossPose.crouch = 1.5; bossPose.pitch = 0.5; bossPose.aSh = 0.1; bossPose.bSh = 0.1; }
  Object.assign(b.pose, bossPose);
  const P = bossPose;
  // walking: legs swing with distance travelled
  const moved = Math.hypot(P.x - b.prevX, P.z - b.prevZ); b.prevX = P.x; b.prevZ = P.z;
  const prevPhase = b.walk; b.walk += moved * 1.1;
  if (Math.floor(prevPhase / Math.PI) !== Math.floor(b.walk / Math.PI)) { sfx('step'); shake(0.08); dust(new V3(P.x + (Math.floor(b.walk / Math.PI) & 1 ? 0.95 : -0.95), 0, P.z + 0.5), 5, 0.6); }
  const stride = Math.min(1, moved / (dt || 1) / 6) * 0.45;
  const hurtShake = t - b.flash < 120 ? rnd(-0.06, 0.06) : 0;
  W.root.position.set(P.x + hurtShake, Math.abs(Math.sin(b.walk)) * stride * 0.3, P.z);
  W.hips.position.y = 3.25 - P.crouch * 0.9;
  W.LL.th.rotation.x = Math.sin(b.walk) * stride - P.crouch * 0.55; W.LL.kn.rotation.x = P.crouch * 1.05 + Math.max(0, -Math.sin(b.walk)) * stride;
  W.LR.th.rotation.x = -Math.sin(b.walk) * stride - P.crouch * 0.55; W.LR.kn.rotation.x = P.crouch * 1.05 + Math.max(0, Math.sin(b.walk)) * stride;
  W.torso.rotation.set(P.pitch + P.crouch * 0.1, P.twist, 0);
  W.A.sh.rotation.set(P.aSh, 0, P.aSide); W.A.el.rotation.x = P.aEl;
  W.B.sh.rotation.set(P.bSh, 0, -P.bSide); W.B.el.rotation.x = P.bEl;
  W.boulder.visible = P.rock > 0.5;
  W.head.rotation.x = -P.pitch * 0.5 + Math.sin(t / 1300) * 0.03;
  const pulse = 1 + Math.sin(t / (b.rage ? 160 : 380)) * 0.12;
  W.core.scale.setScalar(pulse); W.core.rotation.y += dt * 0.8;
  W.coreLight.intensity = (b.rage ? 10 : 6) * pulse;
  for (const m of W.crystals) { if (m.visible && m.scale.x < 0.7) m.scale.lerp(new V3(0.7, 1.7, 0.7), 1 - Math.exp(-dt * 5)); m.rotation.y += dt * 0.6; }
}

// ───────────────────────── camera ─────────────────────────
const camPos = new V3(1.5, 2.2, -6), camLook = new V3(0, 5, -15), camBase = new V3();
function camTarget(t, outPos, outLook) {
  const b = W.root.position;
  switch (S.cam) {
    case 'intro': { const k = clamp((t - S.camT) / 9000, 0, 1); outPos.set(lerp(3, 1.4, k), lerp(1.6, 2.6, k), lerp(-6, 7.5, k)); outLook.set(0, lerp(5.5, 3.2, k), -15); break; }
    case 'menu': { const h = S.camHero; outPos.set(h.pos.x + 1.15, 1.9, h.pos.z + 2.7); outLook.set(h.pos.x * 0.88 + 1.15, 2.5, -10); break; }
    case 'aim': { const h = S.camHero; outPos.set(h.pos.x + 0.75, 1.8, h.pos.z + 2.1); outLook.set(h.pos.x * 0.7 + 0.5, 3.4, -14); break; }
    case 'follow': { const h = S.active || S.camHero || S.heroes[0]; outPos.set(h.pos.x + 2.4, 2.4, h.pos.z + 4.8); outLook.set(h.pos.x * 0.5 + b.x * 0.5, 2.6, h.pos.z - 5); break; }
    case 'boss': outPos.set(3.5, 2.6, b.z + 13); outLook.set(b.x, 4, b.z); break;
    case 'victory': { const k = (t - S.camT) / 1000; outPos.set(Math.sin(k * 0.15) * 1.5, 1.6, -4.2); outLook.set(0, 1.3, 0.6); break; }
    default: { const close = clamp((b.z + 15) / 11, 0, 1); outPos.set(0.9, 2.5 + close * 1.2, 8.4 + close * 1.5); outLook.set(b.x * 0.3, 2.9 + close * 1.4, lerp(-8, -3, close)); }
  }
}
function updateCamera(t, dt) {
  const tp = tmp, tl = tmp2;
  camTarget(t, tp, tl);
  const k = 1 - Math.exp(-dt * (S.cam === 'follow' ? 6 : S.cam === 'intro' ? 1.4 : 3.2));
  camPos.lerp(tp, k); camLook.lerp(tl, k);
  const sk = t - S.shake.t, sa = sk < 320 ? S.shake.a * (1 - sk / 320) : 0;
  camera.position.set(camPos.x + rnd(-sa, sa), camPos.y + rnd(-sa, sa), camPos.z);
  camera.lookAt(camLook);
}
function toScreen(v) { const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, behind: p.z > 1 }; }

// ───────────────────────── update ─────────────────────────
function update(t, dt) {
  pollPad();
  tickScript(t);
  windU.value = t / 1000;
  for (const m of mist) { m.position.x += m.userData.v * dt; if (m.position.x > 30) m.position.x = -30; }
  updateCloud(SPARKS, t, dt); updateCloud(DUST, t, dt); updateChips(t, dt);
  if (!S) return;
  updateSeq(t);
  const q = S.qte; if (q && !q.res && t > q.t1 + 140 * DIFF.qte) q.res = 'miss';
  if (aim && !aim.done) {
    const sp = 420 * dt;
    if (held.has('L')) aim.x -= sp; if (held.has('R')) aim.x += sp; if (held.has('U')) aim.y -= sp; if (held.has('D')) aim.y += sp;
    aim.x = clamp(aim.x, 0, innerWidth); aim.y = clamp(aim.y, 0, innerHeight);
  }
  // projectiles
  for (let i = S.projs.length - 1; i >= 0; i--) {
    const p = S.projs[i], k = (t - p.t0) / p.dur;
    if (k >= 1) {
      scene.remove(p.m); S.projs.splice(i, 1);
      if (p.kind === 'rock') { debris(p.to, 8, 4); dust(p.to, 5, 0.5); sfx('crack'); }
      continue;
    }
    if (k < 0) { p.m.visible = false; continue; }
    p.m.visible = true;
    p.m.position.lerpVectors(p.from, p.to, k); p.m.position.y += Math.sin(k * Math.PI) * p.arc;
    if (p.spin) { p.m.rotation.x += dt * 8; p.m.rotation.z += dt * 5; if (Math.random() < 0.5) emit(DUST, p.m.position, { vy: 0.2, life: 700, size: 0.8, grow: 1, color: '#a89c86', alpha: 0.4 }); }
    if (p.kind === 'fire') emit(SPARKS, p.m.position, { vx: rnd(-0.5, 0.5), vy: rnd(0.2, 1), life: 350, size: 0.3, color: '#ff8a3a' });
    if (p.kind === 'ice' || p.kind === 'bolt') emit(SPARKS, p.m.position, { life: 250, size: 0.12, color: PROJ[p.kind].color });
    if (p.trail) emit(SPARKS, p.m.position, { life: 180, size: p.kind === 'big' ? 0.3 : 0.1, color: '#fff1a8' });
  }
  // shockwaves roll along the ground toward the party
  for (let i = S.waves.length - 1; i >= 0; i--) {
    const w = S.waves[i], r = (t - w.t0) / 1000 * WSPD;
    if (r > 26) { S.waves.splice(i, 1); continue; }
    for (let k = 0; k < 6; k++) {
      const a = rnd(-1.1, 1.1) + Math.PI / 2, p = new V3(w.o.x + Math.cos(a) * r, 0.1, w.o.z + Math.sin(a) * r);
      emit(DUST, p, { vy: rnd(0.8, 2), life: 700, size: rnd(0.6, 1.2), grow: 1, color: '#c0a987', alpha: 0.6 });
      if (k < 2) emit(SPARKS, p, { vy: rnd(1, 3), life: 300, size: 0.12, color: '#ffb46a' });
    }
  }
  for (let i = S.slashes.length - 1; i >= 0; i--) {
    const s = S.slashes[i], k = (t - s.t0) / s.dur;
    if (k >= 1) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); S.slashes.splice(i, 1); continue; }
    s.m.material.opacity = 1 - k; s.m.scale.setScalar(1 + k * 0.4); s.m.lookAt(camera.position);
  }
  S.nums = S.nums.filter(n => t - n.t0 < 1200);
  S.pops = S.pops.filter(n => t - n.t0 < 1000);
  for (const h of S.heroes) animateHero(h, t, dt);
  animateBoss(t, dt);
  if (S.boss.burn > 0 && Math.random() < 0.4) emit(SPARKS, corePos().add(new V3(rnd(-1, 1), rnd(-1, 1), 0.3)), { vy: rnd(1, 2), life: 500, size: 0.25, color: '#ff8a3a' });
  updateCamera(t, camDt);
}

// ───────────────────────── overlay (rings, numbers, crosshair) ─────────────────────────
function drawOverlay(t) {
  const c = fx2; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, innerWidth, innerHeight);
  if (!S || !started) return;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  // glints
  const q = S.seq;
  if (q && DIFF.glint) for (const v of q.vis) {
    if (!v.glint || t < v.glint || t > v.glint + 140) continue;
    const src = v.k === 'throw' ? W.B.fist : v.arm === 'B' ? W.B.fist : W.A.fist;
    const s = toScreen(src.getWorldPosition(new V3()));
    const k = (t - v.glint) / 140, r = 26 * Math.sin(k * Math.PI);
    c.save(); c.translate(s.x, s.y); c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(255,240,200,0.95)';
    c.beginPath(); c.moveTo(-r * 1.6, 0); c.lineTo(0, -r * 0.12); c.lineTo(r * 1.6, 0); c.lineTo(0, r * 0.12); c.fill();
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.12, 0); c.lineTo(0, r); c.lineTo(-r * 0.12, 0); c.fill();
    c.restore();
  }
  // story-mode rings around the hero about to be hit
  if (q && DIFF.rings) for (const e of q.ev) {
    if (e.res || t < e.t - 700 || t > e.t) continue;
    const s = toScreen(chest(e.h)), r = 18 + (e.t - t) / 700 * 60;
    c.strokeStyle = e.jump ? '#f3d68a' : '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(s.x, s.y, 18, 0, Math.PI * 2); c.stroke();
    if (e.jump) { c.font = '700 16px Cinzel, serif'; c.fillStyle = '#f3d68a'; c.fillText('JUMP', s.x, s.y - r - 12); }
  }
  // QTE ring
  if (S.qte) {
    const qq = S.qte, s = toScreen(qq.p), k = clamp((t - qq.t0) / (qq.t1 - qq.t0), 0, 1.25), r = Math.max(8, 26 + (1 - k) * 90);
    c.lineWidth = 3; c.strokeStyle = '#d9b35a'; c.beginPath(); c.arc(s.x, s.y, 26, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.strokeStyle = 'rgba(217,179,90,0.5)'; c.beginPath(); c.arc(s.x, s.y, 20, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 4; c.strokeStyle = '#fff'; c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.stroke();
    c.font = '700 14px Cinzel, serif'; c.fillStyle = '#fff'; c.fillText(KEYN.ok, s.x, s.y);
  }
  // target cursor
  if (ui && ui.level === 'target') {
    const tg = menuList(ui)[ui.idx];
    if (tg) { const s = toScreen(chest(tg.hero).add(new V3(0, 0.9, 0))); const b = Math.sin(t / 150) * 4; c.fillStyle = '#f3d68a'; c.beginPath(); c.moveTo(s.x, s.y + 10 + b); c.lineTo(s.x - 10, s.y - 6 + b); c.lineTo(s.x + 10, s.y - 6 + b); c.fill(); }
  }
  // crosshair
  if (aim && !aim.done) {
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.shadowColor = '#000'; c.shadowBlur = 4;
    c.beginPath(); c.arc(aim.x, aim.y, 14, 0, Math.PI * 2); c.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(aim.x + dx * 18, aim.y + dy * 18); c.lineTo(aim.x + dx * 28, aim.y + dy * 28); c.stroke(); }
    c.fillStyle = '#ff6a5a'; c.fillRect(aim.x - 1.5, aim.y - 1.5, 3, 3); c.shadowBlur = 0;
  }
  // marked reticle
  if (S.boss.marked && !W.dead) { const s = toScreen(corePos()); c.strokeStyle = '#ff6a5a'; c.lineWidth = 2; c.save(); c.translate(s.x, s.y); c.rotate(t / 600); c.strokeRect(-22, -22, 44, 44); c.restore(); }
  // pops and damage numbers
  for (const p of S.pops) {
    const k = (t - p.t0) / 1000, s = toScreen(p.p); if (s.behind) continue;
    c.globalAlpha = Math.min(1, (1 - k) * 2.5);
    c.font = 'italic 600 17px Spectral, serif'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.strokeText(p.v, s.x, s.y - k * 28); c.fillStyle = p.c; c.fillText(p.v, s.x, s.y - k * 28);
  }
  for (const n of S.nums) {
    const k = (t - n.t0) / 1200, s = toScreen(n.p); if (s.behind) continue;
    const bounce = k < 0.25 ? Math.sin(k / 0.25 * Math.PI) * 26 : k < 0.4 ? Math.sin((k - 0.25) / 0.15 * Math.PI) * 7 : 0;
    const scale = k < 0.08 ? 1.6 - k / 0.08 * 0.6 : 1;
    c.globalAlpha = Math.min(1, (1 - k) * 3);
    c.font = `800 ${Math.round((n.big ? 40 : 30) * scale)}px Cinzel, serif`; c.lineWidth = 5; c.strokeStyle = 'rgba(10,8,6,0.85)';
    c.strokeText(n.v, s.x + n.dx, s.y - 30 - bounce); c.fillStyle = n.c; c.fillText(n.v, s.x + n.dx, s.y - 30 - bounce);
  }
  c.globalAlpha = 1;
}

// ───────────────────────── DOM HUD ─────────────────────────
const hud = $('hud'), menuEl = $('menu'), descEl = $('desc'), partyEl = $('party'), orderEl = $('order'), promptEl = $('prompt'), bannerEl = $('banner'), dlgEl = $('dlg'), resEl = $('results');
const bossHp = document.querySelector('#boss .hp i'), bossHpLag = document.querySelector('#boss .hp b'), bossBrk = document.querySelector('#boss .brk'), bossTags = document.querySelector('#boss .tags');
const PORTRAIT = {};
const cache = {};
function setHTML(el, key, html) { if (cache[key] !== html) { cache[key] = html; el.innerHTML = html; } }
function drawHud(t) {
  const b = S.boss;
  const f = b.hp / b.maxhp;
  bossHp.style.width = (f * 100).toFixed(2) + '%'; bossHpLag.style.width = (f * 100).toFixed(2) + '%';
  bossBrk.firstElementChild.style.width = b.brk + '%'; bossBrk.classList.toggle('full', b.broken);
  let tags = '';
  if (shards()) tags += `<span style="color:#9fd0ff">◆ ${shards()}</span>`;
  if (b.marked) tags += '<span style="color:#ff8a7a">MARKED</span>';
  if (b.burn) tags += `<span style="color:#ff9a4a">BURN ${b.burn}</span>`;
  if (b.rage) tags += '<span style="color:#ff5a3a">ENRAGED</span>';
  setHTML(bossTags, 'tags', tags);
  // turn order
  const fc = forecast(7);
  setHTML(orderEl, 'order', fc.map((a, i) => `<div class="${i === 0 ? 'now ' : ''}${a === b ? 'boss' : ''}" style="background-image:url(${PORTRAIT[a === b ? 'boss' : a.id] || ''})"></div>`).join(''));
  // party cards
  setHTML(partyEl, 'party', S.heroes.map(h => `<div class="card ${S.active === h ? 'now' : ''} ${h.ko ? 'ko' : ''} ${h.hp < h.maxhp * 0.25 ? 'low' : ''}">
    <img src="${PORTRAIT[h.id] || ''}" alt=""><div class="nm">${h.name.toUpperCase()}</div>
    <div class="hpn">${h.hp}<small> / ${h.maxhp}</small></div><div class="bar"><i style="width:${(h.hp / h.maxhp * 100).toFixed(1)}%"></i></div>
    <div class="ap">${Array.from({ length: 9 }, (_, k) => `<i class="${k < h.ap ? 'on' : ''}"></i>`).join('')}</div>${S.guard && !h.ko ? '<div class="st">GUARD</div>' : ''}</div>`).join(''));
  // command menu, anchored next to the active hero
  if (ui) {
    const list = menuList(ui), u = ui;
    let html = '';
    if (u.level !== 'cmd') html += `<div class="strip head">${u.level === 'skill' ? 'SKILLS' : u.level === 'item' ? 'ITEMS' : 'CHOOSE WHO'}</div>`;
    html += list.map((it, i) => {
      const cost = it.ap != null ? `<span class="cost">${'<i></i>'.repeat(it.ap)}</span>` : it.count != null ? `<span class="count">×${it.count}</span>` : '';
      const key = u.level === 'cmd' ? `<span class="key">${it.key}</span>` : '';
      return `<div class="strip ${i === u.idx ? 'sel' : ''} ${it.off ? 'off' : ''}" data-i="${i}" style="--shift:${(list.length - 1 - i) * 18}px">${key}<span>${it.name}</span>${cost}</div>`;
    }).join('');
    setHTML(menuEl, 'menu', html);
    menuEl.hidden = false;
    const anchor = toScreen(chest(u.hero).add(new V3(0.45, 0.1, 0)));
    const mx = clamp(anchor.x + 20, innerWidth * 0.18, innerWidth - 320), my = clamp(anchor.y - 23 * list.length, 110, innerHeight - 46 * list.length - 150);
    menuEl.style.transform = `translate(${Math.round(mx)}px, ${Math.round(my)}px)`;
    const cur = u.level === 'target' ? (SKILLS[u.hero.id].find(s => s.id === u.pending.id) || ITEMS.find(i => i.id === u.pending.id)) : list[u.idx];
    let desc = cur && cur.desc;
    if (u.level === 'cmd' && cur && cur.id === 'aim' && u.hero.id === 'sable') desc += ' Sable’s shots hit twice as hard.';
    if (desc) { descEl.hidden = false; setHTML(descEl, 'desc', `<h3>${cur.name}</h3>${desc}`); } else descEl.hidden = true;
  } else { menuEl.hidden = true; descEl.hidden = true; cache.menu = ''; }
  // prompts
  let pr = '';
  if (S.seq) pr = `<span><kbd>${KEYN.parry}</kbd> Parry</span><span><kbd>${KEYN.dodge}</kbd> Dodge</span><span><kbd>${KEYN.jump}</kbd> Jump</span>`;
  else if (aim) pr = `<span><kbd>${KEYN.ok}</kbd> Fire · ${aim.h.ap} AP</span><span><kbd>K</kbd> Done</span>`;
  else if (ui) pr = `<span><kbd>↑↓</kbd> Choose</span><span><kbd>${KEYN.ok}</kbd> Confirm</span>${ui.level !== 'cmd' ? '<span><kbd>K</kbd> Back</span>' : ''}`;
  setHTML(promptEl, 'prompt', pr);
  // banner + dialog
  const bn = S.banner, on = bn && t - bn.t0 < bn.dur;
  bannerEl.classList.toggle('on', !!on);
  if (bn) { setHTML(bannerEl, 'banner', bn.text); bannerEl.style.color = bn.c; }
  if (S.dlg) { dlgEl.hidden = false; setHTML(dlgEl, 'dlg', S.dlg.lines.join('<br>') + `<span class="more">${KEYN.ok} ▸</span>`); } else dlgEl.hidden = true;
  if (S.results && resEl.hidden) showResults();
}
function showResults() {
  const r = S.results, st = S.stats;
  const rows = r.win ? [
    ['Time', Math.floor(r.secs / 60) + ':' + String(r.secs % 60).padStart(2, '0')], ['Turns', st.turns], ['Parried', st.parried], ['Jumped', st.jumped],
    ['Dodged', st.dodged], ['Hits taken', st.hit], ['Counters', st.counters], ['Perfect rings', st.perfect + ' / ' + st.qtes], ['Knocked down', st.ko],
  ] : [['Parried', st.parried], ['Jumped', st.jumped], ['Hits taken', st.hit], ['Warden HP left', Math.round(S.boss.hp / S.boss.maxhp * 100) + '%']];
  resEl.innerHTML = `<div class="box"><h2 class="${r.win ? '' : 'lose'}">${r.win ? 'VICTORY' : 'THE PASS HOLDS'}</h2>
    <table>${rows.map(([a, v]) => `<tr><td>${a}</td><td>${v}</td></tr>`).join('')}</table>
    ${r.win ? `<div class="rank">${r.rank}</div>` : ''}<button id="again">${r.win ? 'AGAIN' : 'TRY AGAIN'}</button></div>`;
  resEl.hidden = false;
  $('again').addEventListener('click', () => { S.results.go = true; });
}
function hideResults() { resEl.hidden = true; resEl.innerHTML = ''; }
menuEl.addEventListener('pointerdown', e => {
  const s = e.target.closest('.strip[data-i]'); if (!s || !ui) return;
  e.preventDefault(); audioInit();
  ui.idx = +s.dataset.i; menuConfirm(ui, menuList(ui));
});
menuEl.addEventListener('pointerover', e => { const s = e.target.closest('.strip[data-i]'); if (s && ui && ui.idx !== +s.dataset.i) { ui.idx = +s.dataset.i; sfx('blip'); } });

// ───────────────────────── portraits ─────────────────────────
// rendered once from the live models, so the HUD faces always match the 3D characters
function makePortraits() {
  const ps = new THREE.Scene();
  ps.add(new THREE.HemisphereLight('#e8e0d0', '#403830', 1.6));
  const dl = new THREE.DirectionalLight('#fff0dc', 2.5); dl.position.set(-1, 2, -3); ps.add(dl);
  const pc = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  const size = 128, out = document.createElement('canvas'); out.width = out.height = size; const ox = out.getContext('2d');
  const shoot = (obj, camP, look, key, bg) => {
    const parent = obj.parent; ps.add(obj);
    ps.background = new THREE.Color(bg);
    pc.position.copy(camP); pc.lookAt(look);
    renderer.setScissorTest(true); renderer.setViewport(0, 0, size / DPR, size / DPR); renderer.setScissor(0, 0, size / DPR, size / DPR);
    renderer.render(ps, pc);
    ox.clearRect(0, 0, size, size);
    ox.drawImage(renderer.domElement, 0, renderer.domElement.height - size, size, size, 0, 0, size, size);
    PORTRAIT[key] = out.toDataURL();
    renderer.setScissorTest(false);
    parent.add(obj);
  };
  for (const h of HEROES) {
    const r = h.rig.root; r.position.set(0, 0, 0); r.rotation.set(0, 0, 0); r.updateMatrixWorld(true);
    shoot(r, new V3(0.28, 1.84, -0.95), new V3(0, 1.74, 0), h.id, { aldric: '#3a2a2e', wren: '#23343a', sable: '#3a2e26' }[h.id]);
  }
  W.root.position.set(0, 0, 0); W.root.updateMatrixWorld(true);
  shoot(W.root, new V3(1.5, 6.2, 5.5), new V3(0, 6.3, 0), 'boss', '#2a1a14');
  W.root.position.copy(BOSS_HOME);
  resize();
}

// ───────────────────────── boot ─────────────────────────
let last = now(), camDt = 0.016;
function frame() {
  const t = now(), raw = (t - last) / 1000, dt = Math.min(0.05, raw); last = t;
  camDt = Math.min(0.25, raw);
  update(t, dt);
  composer.render();
  drawOverlay(t);
  if (started && S) drawHud(t);
  requestAnimationFrame(frame);
}
newBattle();
for (const h of HEROES) animateHero(h, now(), 0.016);
animateBoss(now(), 0.016);
makePortraits();
for (const h of HEROES) animateHero(h, now(), 0.016);
S.cam = 'intro'; S.camT = now() - 99999;
requestAnimationFrame(frame);

const beginBtn = $('begin');
beginBtn.disabled = false; beginBtn.textContent = 'BEGIN';
function begin() {
  DIFF = DIFFS[document.querySelector('input[name=diff]:checked').value];
  $('veil').hidden = true; hud.hidden = false; started = true;
  audioInit();
  if (matchMedia('(pointer: coarse)').matches) enableTouch();
  restart(true);
}
beginBtn.addEventListener('click', begin);
addEventListener('keydown', e => { if (!started && e.code === 'Enter' && document.activeElement?.tagName !== 'BUTTON') begin(); });
window.__greystep = { camera, toScreen, chest, get S() { return S; }, get ui() { return ui; }, get aim() { return aim; }, onAction, MOVES, W };
