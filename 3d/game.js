// Kagerō 3D — the same duel as ../index.html, rendered in three.js.
//
// The combat simulation (timing windows, AI, poses, IK) is carried over from the 2D game
// and still runs on a single line: every fighter has a position `x` along the duel axis.
// The 3D layer places that axis in the world (origin AX.c, angle AX.th) and rotates it
// when a fighter circles the other, so strafing never changes the combat distances the
// deflect windows are tuned for. Poses stay 2D in the sagittal plane; the rig spreads
// limbs sideways and can roll the sword arm to tilt the swing plane.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V3 = THREE.Vector3;

// ───────────────────────── utilities ─────────────────────────
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const wrap180 = a => ((a + 540) % 360) - 180;
const D2R = Math.PI / 180;
const EASE = {
  lin: t => t,
  out: t => 1 - (1 - t) * (1 - t) * (1 - t),
  inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  strike: t => Math.pow(t, 1.7),         // accelerating blade — impact at full speed
  snap: t => 1 - Math.pow(1 - t, 5),
};
function pickW(o) { let s = 0; for (const k in o) s += o[k]; let r = Math.random() * s; for (const k in o) { r -= o[k]; if (r <= 0) return k; } return Object.keys(o)[0]; }

// ───────────────────────── constants ─────────────────────────
const STEP = 1000 / 120;          // fixed 120 Hz simulation
const ARENA = 640;
const ARENA_R = 760;              // radius of the clearing the duel's midpoint may wander
const GRAV = 2000;
const DEFLECT_WIN = 170;          // ms before impact a tap still deflects
const LATE_GRACE = 36;            // ms after impact still accepted (display latency)
const PERFECT_WIN = 65;
const MIN_SEP = 58;
const TORSO = 56, UA = 29, FA = 27, TH = 44, SH = 44, BLADE = 98, HILT = 16;

const TEMPOS = {
  measured:    { wind: 1.2,  cont: 0.8 },
  swordmaster: { wind: 1.0,  cont: 1.0 },
  demon:       { wind: 0.8,  cont: 1.2 },
};

// ───────────────────────── poses (local, facing forward, y up) ─────────────────────────
const BASE = { hx: 0, hy: 78, tr: 80, gx: 20, gy: -34, sw: 38, ff: 28, fb: -30, ffy: 0, fby: 0 };
const PK = Object.keys(BASE);
const mk = o => Object.assign({}, BASE, o);
const POSES = {
  idle:       mk({}),
  guard:      mk({ hx: -3, hy: 74, tr: 84, gx: 24, gy: -10, sw: 108, ff: 24, fb: -34 }),
  deflect:    mk({ hx: -6, hy: 72, tr: 90, gx: 27, gy: -4,  sw: 122, ff: 20, fb: -38 }),
  recoil:     mk({ hx: -10, hy: 76, tr: 102, gx: 8, gy: 8,  sw: 150, ff: 18, fb: -40 }),
  hurt:       mk({ hx: -10, hy: 74, tr: 106, gx: 14, gy: -40, sw: 10, ff: 22, fb: -38 }),
  broken:     mk({ hx: -4, hy: 46, tr: 66, gx: 16, gy: -42, sw: -72, ff: 30, fb: -40 }),
  executed:   mk({ hx: -4, hy: 40, tr: 48, gx: 10, gy: -40, sw: -80, ff: 30, fb: -40 }),
  dead:       mk({ hx: -30, hy: 14, tr: 176, gx: -8, gy: 10, sw: 170, ff: 38, fb: 22 }),
  windHigh:   mk({ hx: -4, hy: 78, tr: 96, gx: -4, gy: 24, sw: 150, ff: 30, fb: -32 }),
  endHigh:    mk({ hx: 12, hy: 70, tr: 68, gx: 30, gy: -26, sw: -28, ff: 46, fb: -30 }),
  folHigh:    mk({ hx: 10, hy: 72, tr: 70, gx: 20, gy: -40, sw: -52, ff: 44, fb: -30 }),
  windRise:   mk({ hx: -4, hy: 72, tr: 82, gx: -18, gy: -44, sw: 205, ff: 30, fb: -32 }),
  endRise:    mk({ hx: 10, hy: 76, tr: 80, gx: 30, gy: 6, sw: 410, ff: 42, fb: -30 }),
  folRise:    mk({ hx: 8, hy: 78, tr: 86, gx: 18, gy: 20, sw: 428, ff: 40, fb: -30 }),
  windDiag:   mk({ hx: -6, hy: 76, tr: 92, gx: -20, gy: 2, sw: 176, ff: 28, fb: -34 }),
  endDiag:    mk({ hx: 12, hy: 72, tr: 72, gx: 34, gy: -14, sw: -8, ff: 44, fb: -30 }),
  folDiag:    mk({ hx: 10, hy: 74, tr: 74, gx: 26, gy: -30, sw: -30, ff: 44, fb: -30 }),
  windThrust: mk({ hx: -12, hy: 70, tr: 86, gx: -14, gy: -26, sw: 4, ff: 26, fb: -40 }),
  endThrust:  mk({ hx: 22, hy: 66, tr: 70, gx: 48, gy: -12, sw: -2, ff: 66, fb: -28 }),
  folThrust:  mk({ hx: 16, hy: 68, tr: 74, gx: 38, gy: -18, sw: -4, ff: 58, fb: -30 }),
  windSweep:  mk({ hx: -10, hy: 60, tr: 66, gx: -30, gy: -38, sw: -8, ff: 34, fb: -42 }),
  endSweep:   mk({ hx: 14, hy: 56, tr: 62, gx: 34, gy: -44, sw: -22, ff: 52, fb: -40 }),
  folSweep:   mk({ hx: 10, hy: 58, tr: 64, gx: 30, gy: -40, sw: -30, ff: 50, fb: -40 }),
  windGrab:   mk({ hx: -10, hy: 70, tr: 78, gx: -26, gy: -36, sw: 212, ff: 28, fb: -40 }),
  endGrab:    mk({ hx: 26, hy: 66, tr: 58, gx: 30, gy: -20, sw: 200, ff: 64, fb: -26 }),
  folGrab:    mk({ hx: 20, hy: 68, tr: 66, gx: 22, gy: -30, sw: 205, ff: 58, fb: -28 }),
  mikiri:     mk({ hx: 8, hy: 50, tr: 62, gx: 30, gy: -40, sw: -30, ff: 44, fb: -38 }),
  jump:       mk({ hx: 0, hy: 78, tr: 84, gx: 20, gy: -28, sw: 50, ff: 20, ffy: 30, fb: -22, fby: 36 }),
  kick:       mk({ hx: 0, hy: 78, tr: 100, gx: 6, gy: -20, sw: 150, ff: 52, ffy: 38, fb: -18, fby: 30 }),
  heal:       mk({ hx: -2, hy: 80, tr: 92, gx: 14, gy: -44, sw: -70, ff: 24, fb: -28 }),
  sidestep:   mk({ hx: -2, hy: 62, tr: 80, gx: 22, gy: -22, sw: 70, ff: 28, fb: -28 }),
};

// attack shapes shared by both fighters; `roll` tilts the swing plane in 3D (radians)
const ATK = {
  high:   { wind: 'windHigh',   end: 'endHigh',   fol: 'folHigh',   range: 150, lungeMax: 70,  stop: 104, strike: 100, kind: 'normal', dmg: 17, pdmg: 16, roll: 0.12 },
  rise:   { wind: 'windRise',   end: 'endRise',   fol: 'folRise',   range: 146, lungeMax: 64,  stop: 104, strike: 105, kind: 'normal', dmg: 16, pdmg: 15, roll: -0.42 },
  diag:   { wind: 'windDiag',   end: 'endDiag',   fol: 'folDiag',   range: 152, lungeMax: 70,  stop: 104, strike: 95,  kind: 'normal', dmg: 17, pdmg: 16, roll: 0.62 },
  thrust: { wind: 'windThrust', end: 'endThrust', fol: 'folThrust', range: 220, lungeMax: 170, stop: 130, strike: 120, kind: 'thrust', dmg: 28, pdmg: 24, roll: 0 },
  sweep:  { wind: 'windSweep',  end: 'endSweep',  fol: 'folSweep',  range: 175, lungeMax: 90,  stop: 110, strike: 135, kind: 'sweep',  dmg: 26, pdmg: 0,  roll: 1.1 },
  grab:   { wind: 'windGrab',   end: 'endGrab',   fol: 'folGrab',   range: 125, lungeMax: 190, stop: 70,  strike: 150, kind: 'grab',   dmg: 36, pdmg: 0,  roll: 0 },
};
const PERILOUS = { thrust: 1, sweep: 1, grab: 1 };

// ───────────────────────── audio (all synthesized) ─────────────────────────
const AU = { ctx: null };
function initAudio() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const c = new AC(); AU.ctx = c;
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(c.destination);
  AU.master = c.createGain(); AU.master.gain.value = 0.85; AU.master.connect(comp);
  const nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; AU.noise = nb;
  const len = c.sampleRate * 1.8; const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  AU.verb = c.createConvolver(); AU.verb.buffer = ir; AU.verbIn = c.createGain(); AU.verbIn.gain.value = 0.32;
  AU.verbIn.connect(AU.verb); AU.verb.connect(AU.master);
}
function env(g, t, peak, a, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
function tone(f, peak, dcy, type = 'sine', verb = 0, a = 0.002, glideTo = 0) {
  const c = AU.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + a + dcy);
  env(g, t, peak, a, dcy); o.connect(g); g.connect(AU.master); if (verb) { const s = c.createGain(); s.gain.value = verb; g.connect(s); s.connect(AU.verbIn); }
  o.start(t); o.stop(t + a + dcy + 0.05);
}
function noise(peak, dcy, ftype, freq, q = 1, verb = 0, a = 0.001, sweepTo = 0) {
  const c = AU.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = AU.noise; s.playbackRate.value = rand(0.9, 1.1);
  f.type = ftype; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + a + dcy);
  env(g, t, peak, a, dcy); s.connect(f); f.connect(g); g.connect(AU.master); if (verb) { const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(AU.verbIn); }
  s.start(t, Math.random() * 0.5); s.stop(t + a + dcy + 0.05);
}
const SFX = {
  clang(perfect) {
    if (!AU.ctx) return; const f0 = rand(1080, 1260) * (perfect ? 1.06 : 0.97);
    const parts = [1, 1.483, 2.12, 2.74, 3.93, 5.41, 6.8];
    parts.forEach((m, i) => tone(f0 * m * rand(0.99, 1.01), (perfect ? 0.24 : 0.17) / Math.pow(i + 1, 0.55), rand(0.25, 0.7) / (1 + i * 0.25), 'sine', 0.9));
    noise(perfect ? 0.9 : 0.6, 0.05, 'highpass', 2600, 0.7, 0.4);
    tone(210, 0.45, 0.09, 'triangle', 0, 0.001, 70);
  },
  block() { if (!AU.ctx) return; noise(0.7, 0.12, 'lowpass', 1500, 0.8); tone(520, 0.12, 0.12, 'triangle', 0.3); tone(160, 0.35, 0.1, 'sine', 0, 0.001, 60); },
  hit() { if (!AU.ctx) return; noise(0.9, 0.2, 'bandpass', 900, 0.9, 0.1); noise(0.5, 0.06, 'highpass', 4200, 0.8); tone(110, 0.6, 0.16, 'sine', 0, 0.001, 45); },
  flesh() { if (!AU.ctx) return; noise(0.55, 0.14, 'bandpass', 1300, 1.3); noise(0.35, 0.05, 'highpass', 5000); },
  whoosh(dur, pitch = 1) { if (!AU.ctx) return; noise(0.35, dur, 'bandpass', 500 * pitch, 2.2, 0, dur * 0.35, 2400 * pitch); },
  perilous() { if (!AU.ctx) return; tone(1660, 0.22, 0.9, 'sine', 1); tone(2490, 0.12, 0.7, 'sine', 1); tone(55, 0.35, 0.9, 'sawtooth', 0.2, 0.08); noise(0.2, 0.5, 'lowpass', 300, 1, 0.3, 0.1); },
  breakPosture() { if (!AU.ctx) return; [1, 2.4, 2.9, 4.1].forEach((m, i) => tone(98 * m, 0.34 / (i + 1), 2.2 / (1 + i * 0.4), 'sine', 0.7)); noise(0.9, 0.35, 'lowpass', 900, 0.8, 0.4); },
  deathblow() { if (!AU.ctx) return; tone(62, 0.9, 1.4, 'sine', 0.5, 0.01, 28); noise(1, 0.7, 'lowpass', 2400, 0.7, 0.6, 0.01, 200); noise(0.6, 0.12, 'bandpass', 1100, 1.4); SFX.clang(true); },
  mikiri() { if (!AU.ctx) return; noise(1, 0.18, 'lowpass', 900, 0.8, 0.3); tone(420, 0.3, 0.3, 'triangle', 0.6); tone(90, 0.6, 0.25, 'sine', 0, 0.001, 40); },
  thud() { if (!AU.ctx) return; tone(80, 0.55, 0.18, 'sine', 0, 0.001, 40); noise(0.4, 0.1, 'lowpass', 600); },
  heal() { if (!AU.ctx) return; tone(660, 0.1, 0.6, 'sine', 0.8, 0.05); tone(990, 0.06, 0.6, 'sine', 0.8, 0.08); },
  roar() { if (!AU.ctx) return; noise(0.6, 1.1, 'bandpass', 180, 1.5, 0.4, 0.25, 420); tone(70, 0.4, 1.2, 'sawtooth', 0.4, 0.2, 55); },
  step() { if (!AU.ctx) return; noise(0.12, 0.05, 'lowpass', 500); },
};

// ───────────────────────── duel axis in the world ─────────────────────────
// world = c + u·x + up·y + n·lat, with u = (cos th, 0, sin th) and n = u × up = (−sin th, 0, cos th).
// A fighter's forward is u·dir and its right-hand side is n·dir.
const AX = { th: 0, cx: 0, cz: 0 };
function W3(x, y, lat = 0, out = new V3()) {
  const c = Math.cos(AX.th), s = Math.sin(AX.th);
  return out.set(AX.cx + c * x - s * lat, y, AX.cz + s * x + c * lat);
}
function toAxis(w) {   // world point → { x (along axis), y, z (lateral) }
  const c = Math.cos(AX.th), s = Math.sin(AX.th), dx = w.x - AX.cx, dz = w.z - AX.cz;
  return { x: dx * c + dz * s, y: w.y, z: -dx * s + dz * c };
}
// rotate the axis about the fighter standing at axis-position `pivotX`; everyone else swings around them
function orbit(pivotX, dth) {
  if (!dth) return;
  const p = W3(pivotX, 0); AX.th += dth;
  AX.cx = p.x - Math.cos(AX.th) * pivotX; AX.cz = p.z - Math.sin(AX.th) * pivotX;
}
// keep the sim's coordinates centred on the pair, and the pair inside the clearing
function recentre() {
  const k = -(P.x + E.x) / 2;
  P.x += k; E.x += k; if (P.execFrom !== undefined) { P.execFrom += k; P.execTo += k; }
  AX.cx -= Math.cos(AX.th) * k; AX.cz -= Math.sin(AX.th) * k;
  const r = Math.hypot(AX.cx, AX.cz); if (r > ARENA_R) { AX.cx *= ARENA_R / r; AX.cz *= ARENA_R / r; }
}

// ───────────────────────── world state ─────────────────────────
let mode = 'title';   // title | play | paused | dead | won
let tempo = 'swordmaster';
const CLOCK = { now: () => performance.now() };
const timers = [];
function later(ms, fn) { timers.push({ at: CLOCK.now() + ms, fn }); }
let gameTime = 0, acc = 0, lastFrame = CLOCK.now(), freeze = 0, timeScale = 1, slowT = 0;
const cam = { shake: 0, kick: 0, mode: 'behind' };
let parts = [], trails = [], banners = [], decals = [];
let flashRed = 0, flashWhite = 0;
const gust = { x: 0, z: 0, amp: 0 };
const stats = { deflects: 0, streak: 0, best: 0, last: null };
const input = { left: false, right: false, guard: false, fwd: false, back: false, sl: false, sr: false };

function newFighter(isPlayer) {
  return {
    isPlayer, x: isPlayer ? -220 : 220, y: 0, vy: 0, vx: 0, air: false, kb: 0, dir: isPlayer ? 1 : -1,
    state: 'idle', stateT: 0, hp: 100, maxHp: 100, posture: 0, maxPosture: 100, postureCalm: 0,
    anim: { from: mk({}), to: mk({}), cur: mk({}), t: 1, dur: 1, ease: EASE.out },
    sp: { sw: 0, swv: 0, tr: 0, trv: 0 }, walk: 0, walkPh: 0, atk: null, chain: 0,
    scale: isPlayer ? 1 : 1.07, chains: [], lungeV: 0, lungeT: 0, iframe: false,
    gait: 0, gaitPh: 0, roll: 0.1, vlat: 0,
    // player-only
    guardPress: null, lastPressT: -1e9, spam: 0, wantGuard: false, atkBuf: -1e9, jumpBuf: -1e9, dodgeBuf: -1e9, healBuf: -1e9,
    gourds: 3, dodgeToward: false, dodgeLat: 0, sweepDodge: -1e9, guardHeldT: 0, healed: false,
    // enemy-only
    lives: 2, think: 900, spacing: 200, blockStreak: 0, openHits: 0, brokenFromHp: false, lastAtkEnd: 0,
    peril: 0, perilKind: '', circ: 0, circT: 0,
  };
}
let P, E;

function resetDuel() {
  P = newFighter(true); E = newFighter(false);
  P.chains = [mkChain(9, 8.5), mkChain(4, 6)]; E.chains = [mkChain(7, 9), mkChain(6, 8)];
  parts = []; trails = []; banners = []; decals = []; stats.deflects = 0; stats.streak = 0; stats.last = null;
  freeze = 0; timeScale = 1; slowT = 0; flashRed = 0; flashWhite = 0;
  AX.th = 0; AX.cx = 0; AX.cz = 0;
}

function setState(f, s) { f.state = s; f.stateT = 0; }
function setPose(f, pose, dur, ease = EASE.out, arc = null) {
  const a = f.anim, to = Object.assign({}, typeof pose === 'string' ? POSES[pose] : pose);
  a.from = Object.assign({}, a.cur);
  to.sw = arc === null ? a.from.sw + wrap180(to.sw - a.from.sw) : a.from.sw + arc;
  a.to = to; a.t = 0; a.dur = Math.max(1, dur); a.ease = ease;
}
function updAnim(f, dt) {
  const a = f.anim; a.t = Math.min(1, a.t + dt / a.dur); const k = a.ease(a.t);
  for (const key of PK) a.cur[key] = lerp(a.from[key], a.to[key], k);
  const s = f.sp, d = dt / 1000;
  s.swv += (-340 * s.sw - 20 * s.swv) * d; s.sw += s.swv * d;
  s.trv += (-260 * s.tr - 18 * s.trv) * d; s.tr += s.trv * d;
  // swing-plane roll eases toward the current attack's plane
  const tgt = f.atk && f.state === 'attack' ? curAtk(f).roll : ['guard'].includes(f.state) ? 0.28 : 0.1;
  f.roll += (tgt - f.roll) * (1 - Math.exp(-dt * (f.atk && f.atk.phase === 'strike' ? 0.004 : 0.012)));
}
function finalPose(f) {
  const p = Object.assign({}, f.anim.cur);
  p.sw += f.sp.sw; p.tr += f.sp.tr;
  if (f.walk && !f.air) {
    const s = Math.sin(f.walkPh), c = Math.cos(f.walkPh), amp = 11 * Math.min(1, Math.abs(f.walk));
    p.ff += s * amp; p.fb -= s * amp; p.ffy += Math.max(0, c) * 6; p.fby += Math.max(0, -c) * 6; p.hy -= Math.abs(s) * 2;
  }
  if (f.gait && !f.air) {
    const s = Math.sin(f.gaitPh), g = Math.min(1, Math.abs(f.gait));
    p.ffy += Math.max(0, s) * 6 * g; p.fby += Math.max(0, -s) * 6 * g; p.hy -= Math.abs(s) * 1.6 * g;
  }
  if (['idle', 'guard'].includes(f.state)) { const b = Math.sin(gameTime * 0.0032 + (f.isPlayer ? 0 : 2)); p.hy += b * 0.9; p.gy += b * 0.7; }
  return p;
}

// two-bone IK. bend: +1 counter-clockwise from base line.
function ik(ox, oy, tx, ty, a, b, bend) {
  let dx = tx - ox, dy = ty - oy; let d = Math.hypot(dx, dy) || 0.001;
  const dc = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.01);
  const base = Math.atan2(dy, dx);
  const cA = clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1);
  const ang = base + bend * Math.acos(cA);
  return { jx: ox + a * Math.cos(ang), jy: oy + a * Math.sin(ang), ex: ox + dx / d * dc, ey: oy + dy / d * dc };
}
function skeleton(p) {
  const hip = { x: p.hx, y: p.hy }, tr = p.tr * D2R;
  const sh = { x: hip.x + Math.cos(tr) * TORSO, y: hip.y + Math.sin(tr) * TORSO };
  const head = { x: sh.x + Math.cos(tr) * 17, y: sh.y + Math.sin(tr) * 17 };
  const neck = { x: sh.x + Math.cos(tr) * 6, y: sh.y + Math.sin(tr) * 6 };
  const armF = ik(sh.x, sh.y, sh.x + p.gx, sh.y + p.gy, UA, FA, -1);
  const grip = { x: armF.ex, y: armF.ey };
  const sa = p.sw * D2R, ux = Math.cos(sa), uy = Math.sin(sa);
  const hand2 = { x: grip.x - ux * 10, y: grip.y - uy * 10 };
  const armB = ik(sh.x - 3, sh.y - 1, hand2.x, hand2.y, UA, FA, -1);
  const legF = ik(hip.x, hip.y, p.ff, p.ffy, TH, SH, 1);
  const legB = ik(hip.x, hip.y, p.fb, p.fby, TH, SH, 1);
  return {
    hip, sh, head, neck, tr, grip, hand2: { x: armB.ex, y: armB.ey }, ux, uy,
    elbowF: { x: armF.jx, y: armF.jy }, elbowB: { x: armB.jx, y: armB.jy },
    kneeF: { x: legF.jx, y: legF.jy }, footF: { x: legF.ex, y: legF.ey },
    kneeB: { x: legB.jx, y: legB.jy }, footB: { x: legB.ex, y: legB.ey },
  };
}
const toWorld = (f, pt) => ({ x: f.x + pt.x * f.dir * f.scale, y: f.y + pt.y * f.scale });

// 3D rig in fighter-local space: x forward, y up, z to the fighter's right.
// The 2D skeleton gives the sagittal plane; limbs get lateral offsets and the sword arm is
// rolled about the shoulder line so diagonal cuts actually travel diagonally.
function rig(f) {
  const sk = skeleton(finalPose(f));
  const g = f.gait && !f.air ? Math.sin(f.gaitPh) * 6 * clamp(f.gait, -1, 1) : 0;
  const cr = Math.cos(f.roll), sr = Math.sin(f.roll), sy = sk.sh.y;
  const rl = (pt, z) => { const dy = pt.y - sy; return [pt.x, sy + dy * cr - z * sr, dy * sr + z * cr]; };
  const bd = [sk.ux, sk.uy * cr, sk.uy * sr];
  const grip = rl(sk.grip, 3);
  const along = k => [grip[0] + bd[0] * k, grip[1] + bd[1] * k, grip[2] + bd[2] * k];
  return {
    sk, tr: sk.tr,
    hip: [sk.hip.x, sk.hip.y, 0], sh: [sk.sh.x, sk.sh.y, 0], neck: [sk.neck.x, sk.neck.y, 0], head: [sk.head.x, sk.head.y, 0],
    shF: [sk.sh.x - 1, sk.sh.y - 3, 11], shB: [sk.sh.x - 4, sk.sh.y - 4, -11],
    hipF: [sk.hip.x + 2, sk.hip.y - 3, 7], hipB: [sk.hip.x - 2, sk.hip.y - 3, -7],
    kneeF: [sk.kneeF.x, sk.kneeF.y, 9 + g * 0.5], footF: [sk.footF.x, sk.footF.y, 8 + g],
    kneeB: [sk.kneeB.x, sk.kneeB.y, -9 - g * 0.5], footB: [sk.footB.x, sk.footB.y, -8 - g],
    elbowF: rl(sk.elbowF, 15), elbowB: rl(sk.elbowB, -13), grip, hand2: rl(sk.hand2, -1),
    bd, side: [0, -sr, cr],
    guardPt: along(4), pommel: along(-HILT), tip: along(BLADE + 4), along,
  };
}
function lw(f, p, out = new V3()) { return W3(f.x + p[0] * f.dir * f.scale, f.y + p[1] * f.scale, p[2] * f.dir * f.scale, out); }
function lv(f, p, out = new V3()) {   // direction local → world
  const c = Math.cos(AX.th) * f.dir, s = Math.sin(AX.th) * f.dir;
  return out.set(c * p[0] - s * p[2], p[1], s * p[0] + c * p[2]);
}
function bladeW(f, frac) { const r = rig(f); return lw(f, r.along(4 + BLADE * frac)); }

// cloth chains (scarf, hair, hat ribbons) — verlet, world space
function mkChain(n, seg) { const pts = []; for (let i = 0; i < n; i++) pts.push({ x: 0, y: 100, z: 0, px: 0, py: 100, pz: 0 }); return { pts, seg, init: false }; }
function stepChain(ch, a, back, dt, wind) {
  const pts = ch.pts;
  if (!ch.init) { pts.forEach((q, i) => { q.x = q.px = a.x + back.x * i * ch.seg; q.y = q.py = a.y; q.z = q.pz = a.z + back.z * i * ch.seg; }); ch.init = true; }
  const d = dt / 1000;
  const q0 = pts[0]; q0.x = q0.px = a.x; q0.y = q0.py = a.y; q0.z = q0.pz = a.z;
  for (let i = 1; i < pts.length; i++) {
    const q = pts[i], vx = (q.x - q.px) * 0.9, vy = (q.y - q.py) * 0.9, vz = (q.z - q.pz) * 0.9;
    q.px = q.x; q.py = q.y; q.pz = q.z;
    q.x += vx + wind.x * d * d; q.y += vy - 700 * d * d; q.z += vz + wind.z * d * d;
    if (q.y < 1) q.y = 1;
  }
  for (let k = 0; k < 3; k++) for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i], dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    const dist = Math.hypot(dx, dy, dz) || 0.01, diff = (dist - ch.seg) / dist;
    if (i === 1) { B.x -= dx * diff; B.y -= dy * diff; B.z -= dz * diff; }
    else { A.x += dx * diff * 0.5; A.y += dy * diff * 0.5; A.z += dz * diff * 0.5; B.x -= dx * diff * 0.5; B.y -= dy * diff * 0.5; B.z -= dz * diff * 0.5; }
  }
}

// ───────────────────────── particles / fx (spawned from axis coords, simulated in world) ─────────────────────────
// p = { x, y, z? } along the duel axis; dirX pushes along the axis
function spawnAt(p) { return W3(p.x, p.y, p.z || 0); }
function axisVel(vx, vy, vl) { const c = Math.cos(AX.th), s = Math.sin(AX.th); return [c * vx - s * vl, vy, s * vx + c * vl]; }
function sparks(p, n, power, dirX = 0) {
  const o = spawnAt(p);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(0.25, 1) * power;
    const [vx, vy, vz] = axisVel(Math.cos(a) * sp * 0.8 + dirX * power * 0.35, Math.sin(a) * sp + power * 0.25, rand(-0.8, 0.8) * sp);
    parts.push({ k: 'spark', x: o.x, y: o.y, z: o.z, vx, vy, vz, life: 0, max: rand(0.18, 0.5), w: rand(1, 2.4), h: rand(28, 48) });
  }
}
function flash(p, r, max = 0.12, col = [255, 236, 200]) { const o = spawnAt(p); parts.push({ k: 'flash', x: o.x, y: o.y, z: o.z, r, life: 0, max, col }); }
function ring(p, r, max = 0.3, col = [255, 220, 170]) { const o = spawnAt(p); parts.push({ k: 'ring', x: o.x, y: o.y, z: o.z, r, life: 0, max, col }); }
function blood(p, n, dirX, power = 420) {
  const o = spawnAt(p);
  for (let i = 0; i < n; i++) {
    const [vx, vy, vz] = axisVel(dirX * rand(0.2, 1) * power + rand(-80, 80), rand(0.15, 0.95) * power, rand(-0.35, 0.35) * power);
    parts.push({ k: 'blood', x: o.x, y: o.y, z: o.z, vx, vy, vz, life: 0, max: rand(0.9, 2.2), s: rand(1.6, 4.2) });
  }
}
function dust(x, n, dirX = 0) {
  for (let i = 0; i < n; i++) {
    const o = W3(x + rand(-14, 14), 2, rand(-14, 14));
    const [vx, vy, vz] = axisVel(dirX * rand(20, 160) + rand(-50, 50), rand(10, 70), rand(-60, 60));
    parts.push({ k: 'dust', x: o.x, y: o.y, z: o.z, vx, vy, vz, life: 0, max: rand(0.5, 1.1), s: rand(6, 16) });
  }
}
function motes(x, y, n) {
  for (let i = 0; i < n; i++) {
    const o = W3(x + rand(-24, 24), y + rand(-10, 60), rand(-24, 24));
    parts.push({ k: 'mote', x: o.x, y: o.y, z: o.z, vx: rand(-20, 20), vy: rand(40, 110), vz: rand(-20, 20), life: 0, max: rand(0.6, 1.2), s: rand(1.5, 3) });
  }
}
function banner(text, sub, color, dur = 1.8, size = 1) { banners.push({ text, sub, color, t: 0, dur, size }); }
function shake(a) { cam.shake = Math.max(cam.shake, a); }
function hitstop(ms) { freeze = Math.max(freeze, ms); }
function gustAt(x, a) { const w = W3(x, 0); gust.x = w.x; gust.z = w.z; gust.amp = a; }

function updParts(dt) {
  const d = dt / 1000;
  for (const q of parts) {
    q.life += d;
    if (q.k === 'spark') {
      q.vy -= 1300 * d; const damp = Math.pow(0.1, d); q.vx *= damp; q.vz *= damp;
      q.x += q.vx * d; q.y += q.vy * d; q.z += q.vz * d;
      if (q.y < 0) { q.y = 0; q.vy *= -0.3; q.vx *= 0.5; q.vz *= 0.5; }
    } else if (q.k === 'blood') {
      q.vy -= 1400 * d; q.x += q.vx * d; q.y += q.vy * d; q.z += q.vz * d;
      if (q.y <= 0) { q.life = q.max; decals.push({ x: q.x, z: q.z, s: q.s * 1.8, a: rand(0, 6.28), life: 0, max: 2.5 + rand(0, 1.5) }); }
    } else if (q.k === 'dust') {
      q.x += q.vx * d; q.y += q.vy * d; q.z += q.vz * d;
      const dx = Math.pow(0.2, d); q.vx *= dx; q.vz *= dx; q.vy *= Math.pow(0.3, d); q.s += 16 * d;
    } else if (q.k === 'mote') { q.x += q.vx * d; q.y += q.vy * d; q.z += q.vz * d; }
  }
  parts = parts.filter(q => q.life < q.max);
  if (parts.length > 900) parts.splice(0, parts.length - 900);
  for (const q of decals) q.life += d;
  decals = decals.filter(q => q.life < q.max);
  if (decals.length > 380) decals.splice(0, decals.length - 380);
  for (const b of banners) b.t += d;
  banners = banners.filter(b => b.t < b.dur);
}

// ───────────────────────── input ─────────────────────────
function nowGame(evtTs) {
  if (mode !== 'play' || freeze > 0) return gameTime;
  const ts = evtTs && evtTs > 0 ? evtTs : CLOCK.now();
  return gameTime + acc + clamp(ts - lastFrame, -STEP, 50) * timeScale;
}
function pressGuard(ts) {
  if (mode !== 'play') return;
  const t = nowGame(ts);
  // Sekiro's anti-mash rule: quick repeat presses shrink the window
  P.spam = (t - P.lastPressT < 230) ? Math.min(P.spam + 1, 4) : 0;
  P.lastPressT = t;
  P.guardPress = { t, win: Math.max(45, DEFLECT_WIN * Math.pow(0.55, P.spam)) };
  P.wantGuard = true; input.guard = true;
}
function releaseGuard() { input.guard = false; }
function pressAttack(ts) { if (mode === 'play') P.atkBuf = nowGame(ts); }
function pressJump(ts) { if (mode === 'play') P.jumpBuf = nowGame(ts); }
function pressDodge(ts) { if (mode === 'play') P.dodgeBuf = nowGame(ts); }
function pressHeal(ts) { if (mode === 'play') P.healBuf = nowGame(ts); }
function toggleCam() { cam.mode = cam.mode === 'behind' ? 'side' : 'behind'; }
// lock-on: forward/back become ±x along the axis, left/right circle him
function mapInput() {
  const mv = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
  input.right = mv * P.dir > 0; input.left = mv * P.dir < 0;
}
const strafeIn = () => (input.sr ? 1 : 0) - (input.sl ? 1 : 0);

const MOVE_KEYS = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'sl', ArrowLeft: 'sl', KeyD: 'sr', ArrowRight: 'sr' };
addEventListener('keydown', e => {
  const c = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c) && mode !== 'title') e.preventDefault();
  if (MOVE_KEYS[c]) input[MOVE_KEYS[c]] = true;
  if (e.repeat) return;
  if (c === 'KeyK') pressGuard(e.timeStamp);
  if (c === 'KeyJ') pressAttack(e.timeStamp);
  if (c === 'Space') pressJump(e.timeStamp);
  if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyL') pressDodge(e.timeStamp);
  if (c === 'KeyF') pressHeal(e.timeStamp);
  if (c === 'KeyC') toggleCam();
  if (c === 'Escape') togglePause();
  if (c === 'KeyR' && (mode === 'dead' || mode === 'won' || mode === 'paused')) startDuel();
  if (c === 'Enter' && mode === 'title' && ready) startDuel();
});
addEventListener('keyup', e => {
  const c = e.code;
  if (MOVE_KEYS[c]) input[MOVE_KEYS[c]] = false;
  if (c === 'KeyK') releaseGuard();
});
const cv = document.getElementById('game');
cv.addEventListener('mousedown', e => { if (e.button === 0) pressAttack(e.timeStamp); if (e.button === 2) pressGuard(e.timeStamp); });
addEventListener('mouseup', e => { if (e.button === 2) releaseGuard(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k of ['left', 'right', 'guard', 'fwd', 'back', 'sl', 'sr']) input[k] = false; if (mode === 'play') togglePause(); });

// touch
const touchEl = document.getElementById('touch');
if (matchMedia('(pointer: coarse)').matches) touchEl.hidden = false;
touchEl.querySelectorAll('button').forEach(b => {
  const k = b.dataset.k, held = ['fwd', 'back', 'sl', 'sr'].includes(k);
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); b.setPointerCapture(e.pointerId);
    if (held) input[k] = true;
    else if (k === 'guard') pressGuard(e.timeStamp); else if (k === 'attack') pressAttack(e.timeStamp);
    else if (k === 'jump') pressJump(e.timeStamp); else if (k === 'dodge') pressDodge(e.timeStamp); else if (k === 'heal') pressHeal(e.timeStamp);
  });
  const up = () => { if (held) input[k] = false; else if (k === 'guard') releaseGuard(); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
});

// gamepad
const padPrev = {};
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && [...pads].find(Boolean); if (!gp) return;
  const btn = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const edge = (i, fn, rel) => { const v = btn(i); if (v && !padPrev[i]) fn(); if (!v && padPrev[i] && rel) rel(); padPrev[i] = v; };
  edge(5, () => pressAttack()); edge(7, () => pressAttack());
  edge(4, () => pressGuard(), releaseGuard); edge(6, () => pressGuard(), releaseGuard);
  edge(0, () => pressJump()); edge(1, () => pressDodge()); edge(2, () => pressHeal()); edge(3, toggleCam);
  edge(9, () => togglePause());
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  padPrev.useAxis = Math.abs(ax) > 0.35 || Math.abs(ay) > 0.35 || btn(12) || btn(13) || btn(14) || btn(15) || padPrev.useAxis;
  if (padPrev.useAxis) {
    input.sl = ax < -0.35 || btn(14); input.sr = ax > 0.35 || btn(15);
    input.fwd = ay < -0.35 || btn(12); input.back = ay > 0.35 || btn(13);
  }
}

// ───────────────────────── enemy combos ─────────────────────────
function buildCombo(opts = {}) {
  const T = TEMPOS[tempo];
  let L = pick([1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6]);
  if (T.cont > 1 && Math.random() < 0.35) L++;
  if (T.cont < 1) L = Math.min(L, 4);
  const list = []; let prev = null;
  for (let i = 0; i < L; i++) {
    const last = i === L - 1;
    let type = pick(['high', 'rise', 'diag', 'high', 'diag', 'rise'].filter(x => x !== prev));
    if ((last && L > 1 && Math.random() < 0.3) || (L === 1 && Math.random() < 0.4)) type = pickW({ thrust: 0.45, sweep: 0.3, grab: 0.25 });
    if (i === 0 && opts.opener) type = opts.opener;
    const perilous = !!PERILOUS[type];
    let wind = i === 0 ? rand(380, 620) : rand(170, 300), hold = 0;
    if (i === 0 && opts.counter) wind = rand(220, 290);
    if (i === 0 && !opts.counter && Math.random() < 0.3) hold = rand(150, 420);      // stare-down
    if (i > 0 && Math.random() < 0.22) hold = rand(200, 430);                        // delayed swing
    else if (i > 0 && Math.random() < 0.2) wind = rand(105, 145);                    // flurry
    if (perilous) { wind = rand(560, 720); hold = type === 'thrust' ? rand(0, 180) : 0; }
    list.push(Object.assign({}, ATK[type], { type, windT: wind * T.wind, holdT: hold * T.wind, folT: last ? 300 : rand(95, 160), last, perilous }));
    prev = type;
    if (perilous && !last) break; // perilous always ends a string
  }
  list[list.length - 1].last = true; list[list.length - 1].folT = 320;
  return list;
}
const comboQueue = [];
function scriptedCombo(steps) {
  return steps.map((s, i) => Object.assign({}, ATK[s.type], { type: s.type, windT: s.wind, holdT: s.hold || 0, folT: i === steps.length - 1 ? 320 : (s.fol || 130), last: i === steps.length - 1, perilous: !!PERILOUS[s.type] }));
}
function startCombo(f, list) {
  setState(f, 'attack');
  f.atk = { list, i: 0, phase: '', pt: 0, deflectedLast: false };
  beginPhase(f, 'wind');
}
function curAtk(f) { return f.atk.list[f.atk.i]; }
function beginPhase(f, phase) {
  const a = curAtk(f), at = f.atk; at.phase = phase; at.pt = 0;
  if (phase === 'wind') {
    f.dir = Math.sign(P.x === E.x ? 1 : (f.isPlayer ? E.x - P.x : P.x - E.x)) || f.dir;
    setPose(f, a.wind, a.windT, EASE.out);
    if (a.perilous) { f.peril = 0.9; f.perilKind = a.type; SFX.perilous(); flashRed = Math.max(flashRed, 0.12); }
  } else if (phase === 'hold') {
    const w = POSES[a.wind]; setPose(f, Object.assign({}, w, { sw: w.sw + 9, tr: w.tr + 3, hx: w.hx - 3 }), a.holdT, EASE.inOut);
  } else if (phase === 'strike') {
    const arc = POSES[a.end].sw - POSES[a.wind].sw;
    setPose(f, a.end, a.strike, EASE.strike, arc);
    // lunge closes distance so the swing actually arrives
    const tgt = f.isPlayer ? E : P, dist = Math.abs(tgt.x - f.x);
    const lunge = clamp(dist - a.stop, f.isPlayer ? 0 : 6, a.lungeMax);
    f.lungeV = f.dir * lunge / (a.strike / 1000); f.lungeT = a.strike;
    SFX.whoosh(a.strike / 1000 * 1.6, f.isPlayer ? 1.15 : 0.9);
    if (!f.isPlayer && a.kind !== 'grab') f.glint = 1;
  } else if (phase === 'fol') {
    setPose(f, a.fol, a.folT, EASE.out);
  }
}
// strike arc must be relative to where the windup actually ended
function strikeArc(f) { const a = curAtk(f); return POSES[a.end].sw - POSES[a.wind].sw; }

function runAttack(f, dt, onImpact) {
  const at = f.atk, a = curAtk(f);
  const before = at.pt; at.pt += dt;
  if (at.phase === 'wind' && at.pt >= a.windT) { if (a.holdT > 0) beginPhase(f, 'hold'); else startStrike(f); }
  else if (at.phase === 'hold' && at.pt >= a.holdT) startStrike(f);
  else if (at.phase === 'strike') {
    if (at.pt >= a.strike) {
      const tHit = gameTime + (a.strike - before);
      onImpact(f, a, tHit);
      if (f.atk === at && (f.state === 'attack')) beginPhase(f, 'fol');
    }
  } else if (at.phase === 'fol' && at.pt >= a.folT) {
    if (at.i < at.list.length - 1) { at.i++; beginPhase(f, 'wind'); }
    else return true; // finished
  }
  return false;
}
function startStrike(f) {
  // align the arc from the real current angle so the blade path is continuous
  const a = curAtk(f); beginPhase(f, 'strike');
  f.anim.to.sw = f.anim.from.sw + strikeArc(f) - (a.holdT > 0 ? 9 : 0);
}

// ───────────────────────── resolution ─────────────────────────
const pending = [];
const DBG = { parry: false };      // ?debug hook: the harness can make the player deflect everything
function enemyImpact(f, a, tHit) { pending.push({ t: tHit, at: tHit + LATE_GRACE, a }); }

function resolveEnemyHit(h) {
  if (E.state !== 'attack') return;             // enemy was broken/interrupted before resolution
  const a = h.a, d = Math.abs(P.x - E.x);
  if (P.state === 'dead' || P.state === 'execute') return;
  if (d > a.range + 6) return;                  // whiffed — stepped out
  if (a.kind === 'sweep') {
    if (P.air) { P.sweepDodge = gameTime; return; }
    return playerHit(a);
  }
  if (a.kind === 'grab') { if (P.air || P.iframe) return; return playerHit(a); }
  if (a.kind === 'thrust' && P.state === 'dodge' && P.dodgeToward && h.t - P.dodgeStart < 440) return doMikiri();
  if (P.iframe) return;
  const striking = P.state === 'attack' && P.atk && P.atk.phase === 'strike';
  const canGuard = !P.air && ['idle', 'guard', 'attack', 'recoil'].includes(P.state) && !striking;
  if (DBG.parry && ['idle', 'guard'].includes(P.state) && !P.air) P.guardPress = { t: h.t - rand(0, 100), win: DEFLECT_WIN };
  const g = P.guardPress;
  if (canGuard && g && h.t - g.t <= g.win && g.t - h.t <= LATE_GRACE) return doDeflect(a, g.t - h.t);
  if (canGuard && input.guard && P.state === 'guard') return doBlock(a);
  playerHit(a);
}

function contactPoint() {
  const w = bladeW(P, 0.5).add(bladeW(E, 0.72)).multiplyScalar(0.5);
  const p = toAxis(w); p.y = clamp(p.y, 60, 170); return p;
}

function doDeflect(a, err) {
  const perfect = Math.abs(err) <= PERFECT_WIN;
  if (P.atk) P.atk = null;
  setState(P, 'guard'); P.guardHold = input.guard;
  setPose(P, 'deflect', 34, EASE.snap);
  P.sp.swv -= perfect ? 420 : 300; E.sp.swv += perfect ? 620 : 420; E.sp.trv += 90;
  P.posture = Math.min(P.maxPosture - 1, P.posture + (perfect ? 2 : 5)); P.postureCalm = 0;
  const gain = (a.last ? 12 : 7) + (perfect ? 2 : 0) + (a.perilous ? 8 : 0);
  addPosture(E, gain);
  P.kb = -P.dir * (a.last ? 220 : 150); E.kb = -E.dir * (a.last ? 170 : 60);
  const c = contactPoint();
  sparks(c, perfect ? 56 : 30, perfect ? 760 : 520, -P.dir * 0.4);
  flash(c, perfect ? 70 : 46, perfect ? 0.14 : 0.1);
  if (perfect) ring(c, 90, 0.26);
  gustAt(c.x, perfect ? 1 : 0.6);
  SFX.clang(perfect);
  hitstop(perfect ? 78 : 52); shake(perfect ? 6 : 3.5);
  flashWhite = Math.max(flashWhite, perfect ? 0.1 : 0.04);
  stats.deflects++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); stats.last = { err: Math.round(err), perfect };
  if (a.last) E.atk.deflectedLast = true;
  if (E.posture >= E.maxPosture) breakEnemy(false);
}
function doBlock(a) {
  P.posture += a.pdmg; P.postureCalm = 0;
  setPose(P, 'guard', 40, EASE.snap); P.sp.swv -= 200; P.kb = -P.dir * 200;
  const c = contactPoint(); sparks(c, 10, 300, -P.dir * 0.3); flash(c, 26, 0.08, [255, 200, 150]);
  SFX.block(); hitstop(34); shake(2.5); stats.streak = 0; stats.last = { err: null, blocked: true };
  if (P.posture >= P.maxPosture) breakPlayer();
}
function playerHit(a) {
  const heavy = a.kind === 'grab';
  P.hp -= a.dmg; P.posture = Math.min(P.maxPosture, P.posture + 8); P.postureCalm = 0; P.atk = null;
  const at = { x: P.x - P.dir * 4, y: 110 };
  blood(at, heavy ? 44 : 26, -P.dir, heavy ? 520 : 380); flash(at, 34, 0.1, [255, 120, 100]);
  SFX.hit(); if (heavy) SFX.thud();
  hitstop(heavy ? 110 : 64); shake(heavy ? 11 : 7); flashRed = Math.max(flashRed, heavy ? 0.5 : 0.32);
  stats.streak = 0; stats.last = { err: null, hit: true };
  P.kb = -P.dir * (heavy ? 520 : 240); P.sp.trv += 220;
  if (P.air) { P.vy = Math.min(P.vy, 0); }
  if (P.hp <= 0) { P.hp = 0; return killPlayer(); }
  setState(P, 'hurt'); P.hurtT = heavy ? 900 : 360; setPose(P, heavy ? 'broken' : 'hurt', heavy ? 160 : 70, EASE.snap);
}
function breakPlayer() {
  P.posture = P.maxPosture; setState(P, 'broken'); P.atk = null; setPose(P, 'broken', 180, EASE.out);
  SFX.breakPosture(); shake(6); flashRed = Math.max(flashRed, 0.25); dust(P.x, 10, -P.dir);
  banner('', 'Posture broken', '#e8452c', 0.9, 0.6);
}
function killPlayer() {
  setState(P, 'dead'); P.atk = null; setPose(P, 'dead', 520, EASE.out); P.kb = -P.dir * 300;
  mode = 'dead'; timeScale = 0.35; slowT = 900; SFX.breakPosture();
  later(500, () => banner('死', 'Death — press R to rise again', '#c42a1f', 99, 1.4));
}
function doMikiri() {
  setState(P, 'mikiri'); P.iframe = false; setPose(P, 'mikiri', 70, EASE.snap);
  P.x = E.x + (P.x < E.x ? -72 : 72); P.dir = Math.sign(E.x - P.x);
  addPosture(E, 30); E.atk = null; setState(E, 'staggered'); E.stagT = 1000; setPose(E, 'recoil', 120, EASE.snap); E.sp.trv -= 200;
  const tip = { x: (P.x + E.x) / 2, y: 8 };
  sparks({ x: tip.x, y: tip.y + 10 }, 34, 520); dust(tip.x, 16, 0); flash({ x: tip.x, y: 20 }, 60, 0.14);
  SFX.mikiri(); hitstop(110); shake(8); banner('見切り', 'Mikiri counter', '#ece2cc', 1.1, 0.7);
  stats.deflects++; stats.streak++; stats.best = Math.max(stats.best, stats.streak);
  if (E.posture >= E.maxPosture) breakEnemy(false);
}

function addPosture(f, v) { f.posture = Math.min(f.maxPosture, f.posture + v); f.postureCalm = 0; }

function breakEnemy(fromHp) {
  E.atk = null; setState(E, 'broken'); E.brokenFromHp = fromHp; E.posture = E.maxPosture;
  E.brokenT = fromHp ? 1e9 : 2600; setPose(E, 'broken', 260, EASE.out); pending.length = 0;
  SFX.breakPosture(); hitstop(120); shake(9); flashWhite = Math.max(flashWhite, 0.18);
  const c = toWorld(E, { x: 0, y: 110 }); ring(c, 140, 0.45, [255, 90, 70]); gustAt(E.x, 1.3);
  E.peril = 0;
}

function playerImpact(f, a) {
  const d = Math.abs(E.x - P.x);
  if (d > a.range) return;
  const es = E.state;
  if (['broken', 'executed', 'dead', 'rise'].includes(es)) return;
  const hitPt = toWorld(E, { x: 6, y: 112 });
  if (es === 'attack') {                                  // hyper-armour: trade
    E.hp -= 3; addPosture(E, 1); blood(hitPt, 12, P.dir, 300); SFX.flesh(); hitstop(36); shake(2.5);
  } else if (['recover', 'staggered', 'hurt'].includes(es)) {
    E.openHits++;
    if (E.openHits >= 3 && Math.random() < 0.75) return enemyDeflect();
    E.hp -= 6; addPosture(E, 4); blood(hitPt, 18, P.dir, 340); SFX.flesh(); hitstop(46); shake(3);
    E.sp.trv += 160;
    if (es !== 'staggered') { setState(E, 'hurt'); setPose(E, 'hurt', 60, EASE.snap); }
  } else {
    const pd = 0.26 + 0.2 * E.blockStreak + (P.chain >= 2 ? 0.22 : 0);
    if (Math.random() < pd) return enemyDeflect();
    E.blockStreak++; addPosture(E, 5);
    setState(E, 'guard'); setPose(E, 'guard', 45, EASE.snap); E.sp.swv += 160; E.kb = -E.dir * 120;
    const c = contactPoint(); sparks(c, 9, 280, P.dir * 0.3); flash(c, 22, 0.07, [255, 200, 150]);
    SFX.block(); hitstop(30); shake(2);
  }
  if (E.hp <= 0) { E.hp = 0; breakEnemy(true); }
  else if (E.posture >= E.maxPosture) breakEnemy(false);
}
function enemyDeflect() {
  E.blockStreak = 0; E.openHits = 0;
  setState(E, 'deflectCounter'); setPose(E, 'deflect', 40, EASE.snap); E.sp.swv += 300;
  P.atk = null; setState(P, 'recoil'); setPose(P, 'recoil', 60, EASE.snap); P.sp.swv += 520; P.kb = -P.dir * 200;
  P.posture = Math.min(P.maxPosture, P.posture + 10); P.postureCalm = 0;
  const c = contactPoint(); sparks(c, 34, 560, P.dir * -0.3); flash(c, 50, 0.1);
  SFX.clang(false); hitstop(60); shake(4);
  if (P.posture >= P.maxPosture) breakPlayer();
}

// ───────────────────────── player ─────────────────────────
const PATK = ['high', 'rise', 'diag'];
function startPlayerAttack(airborne) {
  const type = airborne ? 'high' : PATK[P.chain % 3];
  const base = ATK[type];
  const a = Object.assign({}, base, { type, windT: airborne ? 80 : 105, holdT: 0, strike: airborne ? 80 : 78, folT: P.chain >= 2 ? 360 : 230, last: true, range: base.range + 4, lungeMax: 26, stop: 90 });
  P.chain = (P.chain + 1) % 3; P.atkBuf = -1e9;
  setState(P, 'attack'); P.atk = { list: [a], i: 0, phase: '', pt: 0 }; beginPhase(P, 'wind');
}
const orbitRate = (f, speed) => speed / Math.max(60, Math.abs(P.x - E.x));
function stepPlayer(dt) {
  const p = P, d = dt / 1000; p.stateT += dt;
  const t = gameTime;
  mapInput();
  const lat = strafeIn();
  // physics
  if (p.air) {
    p.vy -= GRAV * d; p.y += p.vy * d; p.x += p.vx * d;
    if (p.vlat) orbit(E.x, -p.vlat * d / Math.max(60, Math.abs(E.x - p.x)));
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.vlat = 0; p.air = false; dust(p.x, 6); SFX.step(); if (['jump', 'kick'].includes(p.state) || (p.state === 'attack')) { p.atk = null; setState(p, 'idle'); setPose(p, 'idle', 140); } }
  }
  p.x += p.kb * d; p.kb *= Math.exp(-11 * d);
  if (p.lungeT > 0) { const s = Math.min(dt, p.lungeT); p.x += p.lungeV * s / 1000; p.lungeT -= dt; }

  const faceable = !['attack', 'dodge', 'execute', 'dead', 'mikiri'].includes(p.state);
  if (faceable && Math.abs(E.x - p.x) > 4) p.dir = Math.sign(E.x - p.x);

  const free = ['idle', 'guard'].includes(p.state) && !p.air;
  // guard press → instant guard (cancels windup/recovery of own attack)
  if (p.wantGuard) {
    const cancellable = free || p.state === 'recoil' || (p.state === 'attack' && p.atk && p.atk.phase !== 'strike' && !p.air) || p.state === 'heal' && p.stateT < 200;
    if (cancellable) { p.atk = null; setState(p, 'guard'); setPose(p, 'guard', 45, EASE.snap); p.wantGuard = false; }
    else if (['hurt', 'broken', 'dead', 'dodge', 'mikiri', 'execute', 'heal'].includes(p.state) || p.air) p.wantGuard = false;
  }
  if (input.guard && p.state === 'guard') p.guardHeldT += dt; else p.guardHeldT = 0;

  // buffered actions
  const buffered = b => t - b < 190;
  if (buffered(p.atkBuf)) {
    const dE = Math.abs(E.x - p.x);
    if (E.state === 'broken' && dE < 200 && !p.air && ['idle', 'guard', 'attack', 'recoil'].includes(p.state)) { p.atkBuf = -1e9; startExecute(); }
    else if (p.air && ['jump'].includes(p.state)) {
      p.atkBuf = -1e9;
      if (t - p.sweepDodge < 800 && dE < 210) doKick(); else startPlayerAttack(true);
    }
    else if (free || (p.state === 'attack' && p.atk && p.atk.phase === 'fol' && p.atk.pt > 60)) startPlayerAttack(false);
  }
  if (buffered(p.jumpBuf) && (free || p.state === 'recoil') && !p.air) {
    p.jumpBuf = -1e9; p.air = true; p.vy = 700; p.vx = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 200; p.vlat = lat * 170;
    setState(p, 'jump'); setPose(p, 'jump', 120); dust(p.x, 6); SFX.whoosh(0.2, 0.7);
  }
  if (buffered(p.dodgeBuf) && (free || p.state === 'recoil' || (p.state === 'attack' && p.atk && p.atk.phase === 'fol')) && !p.air) {
    p.dodgeBuf = -1e9; p.atk = null;
    const mv = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    // a dodge with only a strafe held is a sidestep around him; otherwise along the line as in 2D
    p.dodgeLat = mv === 0 ? lat : 0;
    const dirX = p.dodgeLat ? 0 : (mv === 0 ? -p.dir : mv);
    p.dodgeToward = dirX === p.dir; p.dodgeDir = dirX; p.dodgeStart = t;
    setState(p, 'dodge'); setPose(p, p.dodgeToward ? 'windThrust' : p.dodgeLat ? 'sidestep' : 'recoil', 90, EASE.snap);
    dust(p.x, 5, -dirX); SFX.whoosh(0.18, 0.8);
  }
  if (buffered(p.healBuf) && free && p.gourds > 0) {
    p.healBuf = -1e9; p.gourds--; p.healed = false; setState(p, 'heal'); setPose(p, 'heal', 180);
    if (E.state === 'idle') E.think = Math.min(E.think, 140);      // he punishes greed
  }

  // movement
  p.walk = 0; p.gait = 0;
  if (free) {
    const mv = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sp = p.state === 'guard' ? 110 : (mv === p.dir ? 190 : 165);
    p.x += mv * sp * d; p.walk = mv; if (mv) p.walkPh += dt * 0.0125 * mv * p.dir;
    if (lat) {
      orbit(E.x, -lat * orbitRate(p, p.state === 'guard' ? 100 : 150) * d);
      p.gait = lat; p.gaitPh += dt * 0.013;
    }
  }

  switch (p.state) {
    case 'guard':
      if (!input.guard && p.stateT > 150) { setState(p, 'idle'); setPose(p, 'idle', 180); }
      else if (input.guard && p.stateT > 120 && p.anim.t >= 1 && p.anim.to.gy !== POSES.guard.gy) setPose(p, 'guard', 120);
      break;
    case 'attack':
      if (runAttack(p, dt, playerImpact)) { p.atk = null; setState(p, 'idle'); setPose(p, 'idle', 200); p.chain = 0; }
      break;
    case 'recoil': if (p.stateT > 340) { setState(p, 'idle'); setPose(p, 'idle', 180); } break;
    case 'hurt': if (p.stateT > p.hurtT) { setState(p, 'idle'); setPose(p, 'idle', 200); } break;
    case 'broken': if (p.stateT > 1050) { p.posture = p.maxPosture * 0.55; setState(p, 'idle'); setPose(p, 'idle', 260); } break;
    case 'dodge': {
      const T = 300, k = p.stateT / T;
      p.iframe = p.stateT > 20 && p.stateT < 250;
      const v = Math.max(0, 200 / (T / 1000) * 1.6 * (1 - k));
      p.x += p.dodgeDir * v * d;
      if (p.dodgeLat) { orbit(E.x, -p.dodgeLat * orbitRate(p, v * 0.85) * d); p.gait = p.dodgeLat; p.gaitPh += dt * 0.02; }
      if (p.stateT > T) { p.iframe = false; setState(p, 'idle'); setPose(p, 'idle', 160); }
      break;
    }
    case 'mikiri': if (p.stateT > 620) { setState(p, 'idle'); setPose(p, 'idle', 220); } break;
    case 'heal':
      if (!p.healed && p.stateT > 480) { p.healed = true; p.hp = Math.min(p.maxHp, p.hp + 42); motes(p.x, 60, 26); SFX.heal(); }
      if (p.stateT > 820) { setState(p, 'idle'); setPose(p, 'idle', 200); }
      break;
    case 'kick': if (!p.air && p.stateT > 200) { setState(p, 'idle'); setPose(p, 'idle', 160); } break;
    case 'execute': stepExecute(dt); break;
  }

  // posture recovery — faster while guarding, slower when wounded
  p.postureCalm += dt;
  if (p.postureCalm > 750 && p.state !== 'broken') {
    const rate = (p.state === 'guard' ? 30 : 14) * (0.45 + 0.55 * p.hp / p.maxHp);
    p.posture = Math.max(0, p.posture - rate * d);
  }
}
function doKick() {
  setState(P, 'kick'); setPose(P, 'kick', 50, EASE.snap); P.vy = 560;
  addPosture(E, 22); E.atk = null; setState(E, 'staggered'); E.stagT = 850; setPose(E, 'recoil', 90, EASE.snap); E.sp.trv -= 260; pending.length = 0;
  const c = toWorld(E, { x: 0, y: 150 }); flash(c, 50, 0.12); dust(E.x, 10); sparks(c, 12, 300);
  SFX.thud(); SFX.mikiri(); hitstop(80); shake(7);
  if (E.posture >= E.maxPosture) breakEnemy(false);
}

// deathblow
function startExecute() {
  setState(P, 'execute'); P.atk = null; P.execDone = false; P.dir = Math.sign(E.x - P.x) || 1;
  P.execFrom = P.x; P.execTo = E.x - P.dir * 64;
  setPose(P, 'windThrust', 120, EASE.out); E.brokenT = 1e9;
}
function stepExecute(dt) {
  const p = P, k = clamp(p.stateT / 160, 0, 1);
  p.x = lerp(p.execFrom, p.execTo, EASE.out(k));
  if (p.stateT > 150 && p.anim.to.gx !== POSES.endThrust.gx) setPose(p, 'endThrust', 90, EASE.strike, 0);
  if (!p.execDone && p.stateT > 240) {
    p.execDone = true; E.lives--; E.hp = 0;
    setState(E, 'executed'); setPose(E, 'executed', 300, EASE.out); E.sp.trv += 300;
    const c = toWorld(E, { x: 0, y: 115 });
    blood(c, 90, P.dir, 640); blood(c, 30, -P.dir, 300);
    flash(c, 120, 0.2, [255, 110, 90]); ring(c, 220, 0.5, [255, 80, 60]);
    SFX.deathblow(); hitstop(140); shake(13); flashWhite = 0.35; timeScale = 0.3; slowT = 700; cam.kick = 1;
    gustAt(E.x, 1.6);
    banner('忍殺', E.lives > 0 ? 'Shinobi execution' : 'Shinobi execution — the last', '#ece2cc', 2.2, 1.2);
  }
  if (p.stateT > 1100) { setState(p, 'idle'); setPose(p, 'idle', 400); }
}

// ───────────────────────── enemy brain ─────────────────────────
function stepEnemy(dt) {
  const e = E, d = dt / 1000; e.stateT += dt;
  e.x += e.kb * d; e.kb *= Math.exp(-10 * d);
  if (e.lungeT > 0) { const s = Math.min(dt, e.lungeT); e.x += e.lungeV * s / 1000; e.lungeT -= dt; }
  const turnable = !['attack', 'broken', 'executed', 'dead'].includes(e.state);
  if (turnable && Math.abs(P.x - e.x) > 4) e.dir = Math.sign(P.x - e.x);
  const dist = Math.abs(P.x - e.x);
  e.walk = 0; e.gait = 0;
  if (e.peril > 0) e.peril -= d;
  if (e.glint > 0) e.glint -= d * 6;

  switch (e.state) {
    case 'idle': {
      if (P.state === 'dead') break;
      let mv = 0;
      if (dist > e.spacing + 30) mv = 1; else if (dist < e.spacing - 45) mv = -1;
      const sp = dist > 420 ? 200 : 115;
      e.x += e.dir * mv * sp * d; e.walk = mv; if (mv) e.walkPh += dt * 0.011 * mv;
      // he circles you while he measures the distance
      e.circT -= dt;
      if (e.circT <= 0) { e.circ = pick([-1, 0, 0, 1]); e.circT = rand(900, 2200); }
      if (e.circ && !mv) { orbit(P.x, -e.circ * orbitRate(e, 70) * d); e.gait = e.circ * 0.7; e.gaitPh += dt * 0.009; }
      e.think -= dt;
      if (e.think <= 0) {
        if (dist < 340) {
          let opener = null;
          if (P.guardHeldT > 1300 && Math.random() < 0.55) opener = 'grab';        // turtling gets punished
          else if (dist > 250 && Math.random() < 0.45) opener = 'thrust';
          startCombo(e, comboQueue.length ? comboQueue.shift() : buildCombo({ opener }));
        } else e.think = 120;
      }
      break;
    }
    case 'attack':
      if (runAttack(e, dt, enemyImpact)) {
        const dl = e.atk.deflectedLast; e.atk = null; e.openHits = 0;
        if (dl) { setState(e, 'staggered'); e.stagT = rand(650, 850); setPose(e, 'recoil', 120, EASE.snap); }
        else { setState(e, 'recover'); e.recT = rand(380, 700) * TEMPOS[tempo].wind; setPose(e, 'idle', 360); }
        e.spacing = rand(150, 240);
      }
      break;
    case 'recover': if (e.stateT > e.recT) toIdle(rand(250, 650)); break;
    case 'staggered': if (e.stateT > e.stagT) toIdle(rand(200, 500)); break;
    case 'hurt': if (e.stateT > 300) { if (Math.random() < 0.4) { startCombo(e, buildCombo({ counter: true })); } else toIdle(rand(150, 400)); } break;
    case 'guard': if (e.stateT > 260) { if (Math.random() < 0.3) startCombo(e, buildCombo({ counter: true })); else toIdle(rand(150, 450)); } break;
    case 'deflectCounter': if (e.stateT > 170) startCombo(e, buildCombo({ counter: true })); break;
    case 'broken':
      if (e.stateT > e.brokenT) { e.posture = e.maxPosture * 0.6; toIdle(300); SFX.roar(); }
      break;
    case 'executed':
      if (e.stateT > 2300) {
        if (e.lives > 0) { setState(e, 'rise'); setPose(e, 'idle', 900, EASE.inOut); e.hp = 0; SFX.roar(); banner('', 'He rises again', '#c42a1f', 1.6, 0.6); }
        else { setState(e, 'dead'); setPose(e, 'dead', 700, EASE.out); later(900, () => { mode = 'won'; banner('勝', 'The pass is yours — press R to duel again', '#ece2cc', 99, 1.4); }); }
      }
      break;
    case 'rise':
      e.hp = Math.min(e.maxHp, e.hp + dt * 0.12); e.posture = 0;
      if (e.stateT > 1000) { e.hp = e.maxHp; e.posture = 0; toIdle(600); }
      break;
  }
  // posture recovery
  e.postureCalm += dt;
  if (e.postureCalm > 1400 && !['broken', 'executed', 'rise', 'dead'].includes(e.state)) {
    e.posture = Math.max(0, e.posture - 10 * (0.2 + 0.8 * e.hp / e.maxHp) * d);
  }
}
function toIdle(think) { setState(E, 'idle'); setPose(E, 'idle', 240); E.think = think; E.blockStreak = Math.max(0, E.blockStreak - 1); }

// ───────────────────────── simulation step ─────────────────────────
function step(dt) {
  stepPlayer(dt);
  stepEnemy(dt);
  // resolve due enemy hits (small late-grace keeps deflects fair against display latency)
  for (let i = pending.length - 1; i >= 0; i--) if (gameTime + dt >= pending[i].at) { const h = pending.splice(i, 1)[0]; resolveEnemyHit(h); }
  // spacing + arena
  const side = Math.sign(P.x - E.x) || -1;
  if (Math.abs(P.x - E.x) < MIN_SEP && !(P.air && P.y > 120)) {
    const push = (MIN_SEP - Math.abs(P.x - E.x));
    const pw = E.state === 'attack' ? 1 : 0.6;
    P.x += side * push * pw; E.x -= side * push * (1 - pw);
  }
  P.x = clamp(P.x, -ARENA, ARENA); E.x = clamp(E.x, -ARENA, ARENA);
  if (Math.abs(P.x - E.x) < MIN_SEP - 1 && !P.air) E.x = clamp(P.x - side * MIN_SEP, -ARENA, ARENA);
  recentre();
  updAnim(P, dt); updAnim(E, dt);
  sampleTrail(P); sampleTrail(E);
  gameTime += dt;
}
function sampleTrail(f) {
  const at = f.atk, striking = at && (at.phase === 'strike' || (at.phase === 'fol' && at.pt < 50)) || (f.state === 'execute' && f.stateT > 140 && f.stateT < 260);
  if (!striking) return;
  const r = rig(f);
  trails.push({ f, tip: lw(f, r.tip), mid: lw(f, r.along(4 + BLADE * 0.62)), t: gameTime, red: !f.isPlayer && at && curAtk(f).perilous });
}

// ═════════════════════════ three.js ═════════════════════════
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('fail').hidden = false; throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const FOG = new THREE.Color('#5c2d31');
scene.fog = new THREE.FogExp2(FOG, 0.000105);
scene.background = FOG;
const camera = new THREE.PerspectiveCamera(50, 1, 4, 40000);
camera.position.set(-520, 150, 60);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// the moon hangs low behind him at the start, so fighters are rimmed in its light
const MOON_DIR = new V3(Math.cos(0.2) * Math.cos(0.19), Math.sin(0.19), Math.sin(0.2) * Math.cos(0.19)).normalize();

// ── lights
scene.add(new THREE.HemisphereLight('#7a5a88', '#2a1618', 1.2));
const moonLight = new THREE.DirectionalLight('#ffc9a0', 2.6);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
Object.assign(moonLight.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 10, far: 3000 });
moonLight.shadow.bias = -0.0008; moonLight.shadow.normalBias = 1.2;
scene.add(moonLight, moonLight.target);
const fillLight = new THREE.DirectionalLight('#9aa2e0', 1.3);
scene.add(fillLight, fillLight.target);

// ── materials: dark cloth with a warm fresnel rim, like the 2D silhouettes caught in moonlight
function rimmed(mat, rim = '#ffb88a', k = 0.9) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.rimCol = { value: new THREE.Color(rim).multiplyScalar(k) };
    sh.fragmentShader = 'uniform vec3 rimCol;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\noutgoingLight += rimCol * rimF;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'rim' + rim + k;
  return mat;
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0 }, o));

// ── sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    cTop: { value: new THREE.Color('#120f1c') }, cMid: { value: new THREE.Color('#2b1d2c') },
    cLow: { value: new THREE.Color('#6b3431') }, cHor: { value: new THREE.Color('#9a4a33') },
    moonDir: { value: MOON_DIR }, glow: { value: new THREE.Color('#ffc48f') },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 cTop, cMid, cLow, cHor, moonDir, glow; varying vec3 vDir;
    void main(){
      float y = vDir.y;
      vec3 c = mix(cHor, cLow, smoothstep(-0.02, 0.09, y));
      c = mix(c, cMid, smoothstep(0.09, 0.32, y));
      c = mix(c, cTop, smoothstep(0.32, 0.85, y));
      float m = max(dot(normalize(vDir), moonDir), 0.0);
      c += glow * (pow(m, 14.0) * 0.30 + pow(m, 3.0) * 0.07);
      c += vec3(0.16, 0.06, 0.05) * (1.0 - smoothstep(0.0, 0.25, abs(y))) * 0.5;   // haze band on the horizon
      c = mix(c, vec3(0.03, 0.02, 0.025), smoothstep(0.0, -0.2, y));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
// image-based light from the same sunset (plus a bright moon) so steel reflects the sky
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const m = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b8').multiplyScalar(6) }));
  m.position.copy(MOON_DIR).multiplyScalar(40); m.lookAt(0, 0, 0); envScene.add(m);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture; scene.environmentIntensity = 0.75;
  pmrem.dispose();
}

// ── moon: disc + halo, far along MOON_DIR
function radialTex(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const moon = new THREE.Group();
{
  const disc = new THREE.Mesh(new THREE.CircleGeometry(950, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#f6e3c4').multiplyScalar(1.5), fog: false, depthWrite: false }));
  const mare = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9a78a'), fog: false, transparent: true, opacity: 0.35, depthWrite: false });
  const m1 = new THREE.Mesh(new THREE.CircleGeometry(160, 32), mare); m1.position.set(-280, -190, 1);
  const m2 = new THREE.Mesh(new THREE.CircleGeometry(95, 32), mare); m2.position.set(330, 240, 1);
  const m3 = new THREE.Mesh(new THREE.CircleGeometry(60, 32), mare); m3.position.set(100, -400, 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,214,170,0.55)'], [0.25, 'rgba(255,200,160,0.22)'], [1, 'rgba(255,190,150,0)']]), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(7000, 7000, 1); halo.position.z = -2;
  moon.add(halo, disc, m1, m2, m3);
  moon.position.copy(MOON_DIR).multiplyScalar(15000);
  moon.renderOrder = -9; moon.traverse(o => { o.renderOrder = -9; });
  scene.add(moon);
}

// ── distant ridges (three rings, like the 2D parallax layers) with a castle on the far one
function noise1(x, seed) { return Math.sin(x * 0.0021 + seed) * 0.5 + Math.sin(x * 0.0053 + seed * 2.3) * 0.3 + Math.sin(x * 0.013 + seed * 4.1) * 0.2; }
function ridgeHeight(li, th) { const R = [12500, 8200, 5200][li]; const x = th * R * 0.35; return [1150, 760, 430][li] + noise1(x, li * 7 + 1) * [700, 420, 230][li]; }
[['#2a2335', 12500], ['#1d1826', 8200], ['#141019', 5200]].forEach(([col, R], li) => {
  const N = 360, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const th = i / N * Math.PI * 2, h = Math.max(80, ridgeHeight(li, th));
    pos.push(Math.cos(th) * R, -40, Math.sin(th) * R, Math.cos(th) * R, h, Math.sin(th) * R);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
  scene.add(m);
});
{
  // castle: stacked tiers with flared roofs, two lit windows
  const th = 0.2 - 0.23, R = 8150, s = 7;
  const base = new V3(Math.cos(th) * R, ridgeHeight(1, th) - 60, Math.sin(th) * R);
  const castle = new THREE.Group(); castle.position.copy(base); castle.lookAt(0, base.y, 0); castle.scale.setScalar(s);
  const dark = new THREE.MeshBasicMaterial({ color: '#241e2e' });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(92, 40, 60), dark); wall.position.y = 20; castle.add(wall);
  let y = 40;
  for (const [w, h] of [[70, 20], [56, 17], [42, 15], [30, 13]]) {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 1.05, h * 0.7, 4, 1), dark); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.7; roof.position.y = y + h * 0.35; castle.add(roof);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, h * 0.6, w * 0.55), dark); body.position.y = y + h * 0.7 + h * 0.3; castle.add(body);
    y += h;
  }
  const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffaa5a').multiplyScalar(2.2) });
  for (const [x, yy] of [[-3, 52], [12, 76]]) { const w = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 1), lit); w.position.set(x, yy, 31); castle.add(w); }
  scene.add(castle);
}

// ── ground: dark earth with a canvas noise texture
{
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#2a2027'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '10,6,10' : '70,50,48'},${rand(0.05, 0.25)})`; g.beginPath(); g.arc(rand(0, 256), rand(0, 256), rand(0.5, 3.5), 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(90, 90); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16000, 64), std('#6a5058', { map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
}

// ── rocks and two stone lanterns at the edge of the clearing
{
  const rockMat = std('#2c2530', { roughness: 0.95, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2), r = rand(950, 2600), s = rand(14, i < 6 ? 70 : 40);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
    m.position.set(Math.cos(a) * r, s * 0.25, Math.sin(a) * r); m.scale.set(s * rand(1, 1.8), s * rand(0.5, 0.9), s * rand(1, 1.5));
    m.rotation.set(rand(0, 1), rand(0, 6), rand(0, 1)); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }
  const stone = std('#4a4148', { roughness: 1, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(2.4) });
  for (const a of [2.35, 3.9]) {
    const g = new THREE.Group(); const r = 980; g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    const add = (geo, m, y, sx = 1, sy = 1, sz = 1, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.scale.set(sx, sy, sz); o.rotation.y = ry; o.castShadow = true; g.add(o); return o; };
    add(new THREE.CylinderGeometry(22, 26, 12, 6), stone, 6);
    add(new THREE.CylinderGeometry(7, 9, 52, 8), stone, 38);
    add(new THREE.CylinderGeometry(18, 14, 8, 6), stone, 68);
    add(new THREE.BoxGeometry(22, 20, 22), stone, 82);
    add(new THREE.BoxGeometry(14, 12, 23), glow, 82); add(new THREE.BoxGeometry(23, 12, 14), glow, 82);
    add(new THREE.ConeGeometry(30, 18, 6), stone, 101);
    add(new THREE.SphereGeometry(5, 8, 6), stone, 113);
    const pl = new THREE.PointLight('#ff9a4a', 90000, 700, 2); pl.position.y = 82; g.add(pl);
    scene.add(g);
  }
}

// ── pampas grass: one merged geometry, bent in the vertex shader by wind and deflect gusts
const grassMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    uTime: { value: 0 }, uGust: { value: new THREE.Vector3(0, 0, 0) }, uWind: { value: new THREE.Vector2(-0.6, -0.8).normalize() },
    fogColor: { value: FOG }, fogDensity: { value: scene.fog.density },
    cBase: { value: new THREE.Color('#0f0a10') }, cTip: { value: new THREE.Color('#6e4034') }, cPlume: { value: new THREE.Color('#a48a7c') },
    moonDir: { value: MOON_DIR },
  },
  vertexShader: `
    uniform float uTime; uniform vec3 uGust; uniform vec2 uWind; uniform vec3 moonDir;
    attribute vec3 aBase; attribute vec4 aInfo; attribute vec3 aUV;
    varying float vT; varying float vPlume; varying float vDist; varying float vBack;
    void main(){
      float h = aBase.z, t = aUV.y;
      vec2 base = aBase.xy;
      float bend = aInfo.x + 0.1 + sin(uTime * 1.2 + aInfo.y + base.x * 0.004) * 0.12;
      vec2 d = base - uGust.xy; float dl = length(d);
      float g = uGust.z * exp(-dl / 260.0) * 0.7;
      vec2 dir = normalize(uWind + (dl > 0.1 ? d / dl : vec2(0.0)) * g * 3.0 + vec2(0.0001));
      bend += g;
      vec2 side = vec2(cos(aInfo.z), sin(aInfo.z));
      float w = aUV.z > 0.5 ? aInfo.w * 2.6 * (1.0 - abs(t - 1.12) * 2.5) : aInfo.w * (1.0 - min(t, 1.0) * 0.85);
      vec3 p;
      p.xz = base + side * aUV.x * w + dir * sin(bend) * h * t * t;
      p.y = cos(bend) * h * t;
      vT = t; vPlume = aUV.z;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vDist = -mv.z;
      // brighter where the blade stands between the camera and the moon
      vBack = 0.5 + 0.5 * dot(normalize(cameraPosition.xz - p.xz), -normalize(moonDir.xz));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 fogColor, cBase, cTip, cPlume; uniform float fogDensity;
    varying float vT; varying float vPlume; varying float vDist; varying float vBack;
    void main(){
      vec3 c = mix(cBase, cTip, smoothstep(0.1, 1.0, vT));
      if (vPlume > 0.5) c = cPlume * (0.3 + 0.55 * vBack);
      else c *= 0.7 + 0.6 * vBack;
      float f = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
      gl_FragColor = vec4(mix(c, fogColor, clamp(f, 0.0, 1.0)), 1.0);
    }`,
});
{
  const base = [], info = [], uv = [];
  const vert = (b, i, x, t, pl) => { base.push(...b); info.push(...i); uv.push(x, t, pl); };
  let blades = 0;
  const addBlade = (x, z, h, plume) => {
    const b = [x, z, h], i = [rand(-0.2, 0.3), rand(0, 6.28), rand(0, 6.28), rand(0.9, 1.7)];
    // blade: two base, two middle, one tip
    vert(b, i, -1, 0, 0); vert(b, i, 1, 0, 0); vert(b, i, -1, 0.5, 0);
    vert(b, i, 1, 0, 0); vert(b, i, 1, 0.5, 0); vert(b, i, -1, 0.5, 0);
    vert(b, i, -1, 0.5, 0); vert(b, i, 1, 0.5, 0); vert(b, i, 0, 1, 0);
    if (plume) { vert(b, i, -1, 0.92, 1); vert(b, i, 1, 0.92, 1); vert(b, i, 0, 1.34, 1); }
    blades++;
  };
  // tufts of 3–8 blades sharing a root read as clumps of susuki rather than a bed of spikes
  for (let n = 0; n < 5200; n++) {
    const r = Math.sqrt(Math.random()) * 3400, a = rand(0, Math.PI * 2);
    const inner = r < 560;
    if (inner && Math.random() < 0.6) continue;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, k = inner ? 3 + (Math.random() * 3 | 0) : 4 + (Math.random() * 5 | 0);
    const h0 = inner ? rand(16, 38) * (0.5 + r / 1100) : rand(55, 125) * clamp((r - 400) / 500, 0.45, 1);
    for (let j = 0; j < k; j++) addBlade(cx + rand(-7, 7), cz + rand(-7, 7), h0 * rand(0.65, 1.1), !inner && j < 2 && Math.random() < 0.7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(base.length), 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 3));
  const grass = new THREE.Mesh(g, grassMat); grass.frustumCulled = false; scene.add(grass);
}

// ── petals drifting through the light
const PETALS = 320;
const petalGeo = new THREE.BufferGeometry();
const petalPos = new Float32Array(PETALS * 3), petalVel = [];
for (let i = 0; i < PETALS; i++) { petalPos.set([rand(-900, 900), rand(0, 600), rand(-900, 900)], i * 3); petalVel.push({ vx: rand(-60, -20), vy: rand(-30, -12), vz: rand(-40, -10), ph: rand(0, 6.28) }); }
petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
const petals = new THREE.Points(petalGeo, new THREE.PointsMaterial({ color: new THREE.Color('#ffb08a'), size: 4.2, transparent: true, opacity: 0.8, depthWrite: false }));
petals.frustumCulled = false; scene.add(petals);

// ── fighters
const GEO = {
  limb: new THREE.CylinderGeometry(0.82, 1, 1, 10, 1),
  flare: new THREE.CylinderGeometry(1.2, 0.9, 1, 12, 1, true),     // hakama legs and kimono sleeves widen toward the end
  sph: new THREE.SphereGeometry(1, 16, 12),
  // waist → chest → shoulders, lathed and later squashed front-to-back
  torso: new THREE.LatheGeometry([[0, -0.5], [0.8, -0.5], [0.76, -0.25], [0.88, 0.05], [1, 0.3], [0.95, 0.44], [0.62, 0.5], [0, 0.52]].map(([x, y]) => new THREE.Vector2(x, y)), 18),
  skirt: new THREE.CylinderGeometry(0.6, 1, 1, 18, 1, true),
  hat: new THREE.ConeGeometry(1, 1, 28, 1, true),
  box: new THREE.BoxGeometry(1, 1, 1),
};
function bladeGeometry() {
  // katana profile in the XY plane: y along the blade, +x is the edge; spine curves back (sori)
  const L = BLADE, sori = k => -3.6 * k * k, shape = new THREE.Shape();
  const N = 14, spine = [], edge = [];
  for (let i = 0; i <= N; i++) {
    const y = i / N * (L - 9), k = y / L, w = lerp(3.3, 2.6, k);
    spine.push([sori(k) - w * 0.35, y]); edge.push([sori(k) + w * 0.65, y]);
  }
  // kissaki: edge sweeps up to meet the spine at the tip
  const tipK = 1, tip = [sori(tipK) - 0.6, L];
  shape.moveTo(...spine[0]);
  for (const p of spine) shape.lineTo(...p);
  shape.lineTo(...tip);
  const e0 = edge[N]; shape.quadraticCurveTo(e0[0] + 0.4, L - 2, e0[0], e0[1]);
  for (let i = N; i >= 0; i--) shape.lineTo(...edge[i]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.35); return g;
}
const BLADE_GEO = bladeGeometry();
function buildSword() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#d4dbe4', metalness: 0.85, roughness: 0.24, emissive: new THREE.Color('#1a1e24'), envMapIntensity: 1.6 });
  const blade = new THREE.Mesh(BLADE_GEO, steel); blade.position.y = 7; blade.castShadow = true;
  const tsuka = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, HILT + 4, 8), std('#2b2226')); tsuka.position.y = -HILT / 2 + 1; tsuka.scale.x = 0.8;
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 1.3, 16), std('#3a2f2a', { metalness: 0.6, roughness: 0.5 })); tsuba.position.y = 4.5; tsuba.scale.z = 0.8;
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 1.3), std('#b08a4a', { metalness: 0.8, roughness: 0.4 })); habaki.position.set(0.3, 6.4, 0);
  g.add(blade, tsuka, tsuba, habaki);
  g.userData.steel = steel;
  return g;
}
const LOOK3 = {
  player: { cloth: '#26222e', clothB: '#1b1822', hakama: '#1e1b24', skin: '#b08468', hair: '#0c0a0e', accent: '#a51c1c', rim: '#ffb58a' },
  enemy:  { cloth: '#2c2224', clothB: '#221a1c', hakama: '#3a302a', skin: '#8e6a55', hair: '#0e0a0b', accent: '#ddd3c2', rim: '#ffa982', hat: '#7a6546' },
};
function ribbon(n, color, w0, w1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
  const m = new THREE.Mesh(g, rimmed(std(color, { side: THREE.DoubleSide, roughness: 0.7 }), '#ffb58a', 0.35));
  m.castShadow = true; m.frustumCulled = false; scene.add(m);
  return { m, w0, w1 };
}
function buildRig(isPlayer) {
  const L = isPlayer ? LOOK3.player : LOOK3.enemy;
  const g = new THREE.Group(); scene.add(g);
  const cloth = rimmed(std(L.cloth), L.rim), clothB = rimmed(std(L.clothB), L.rim), hak = rimmed(std(L.hakama, { side: THREE.DoubleSide }), L.rim);
  const glove = rimmed(std('#16131a'), L.rim), skin = rimmed(std(L.skin, { roughness: 0.7 }), L.rim, 0.35), hair = rimmed(std(L.hair), L.rim), accent = rimmed(std(L.accent, { roughness: 0.75 }), L.rim, 0.35);
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
  const r = {
    g, torso: add(GEO.torso, cloth), belt: add(GEO.limb, accent), skirt: add(GEO.skirt, hak), neck: add(GEO.limb, skin),
    head: add(GEO.sph, skin), hair: add(GEO.sph, hair),
    thighF: add(GEO.limb, hak), shinF: add(GEO.flare, hak), kneeF: add(GEO.sph, hak), footF: add(GEO.box, clothB),
    thighB: add(GEO.limb, hak), shinB: add(GEO.flare, hak), kneeB: add(GEO.sph, hak), footB: add(GEO.box, clothB),
    uaF: add(GEO.flare, cloth), faF: add(GEO.limb, clothB), elF: add(GEO.sph, clothB), handF: add(GEO.sph, glove),
    uaB: add(GEO.flare, clothB), faB: add(GEO.limb, clothB), elB: add(GEO.sph, clothB), handB: add(GEO.sph, glove),
    shoF: add(GEO.sph, cloth), shoB: add(GEO.sph, clothB),
    sword: buildSword(),
  };
  g.add(r.sword);
  if (isPlayer) {
    r.knot = add(GEO.limb, hair);
    r.ribbons = [ribbon(9, L.accent, 7, 3), ribbon(4, L.hair, 3.5, 1.5)];
  } else {
    r.hat = add(GEO.hat, rimmed(std(L.hat, { side: THREE.DoubleSide, roughness: 0.95 }), L.rim, 0.5));
    r.hatTop = add(GEO.sph, rimmed(std(L.hat, { roughness: 0.95 }), L.rim, 0.5));
    r.ribbons = [ribbon(7, L.accent, 3.2, 1.6), ribbon(6, L.accent, 2.6, 1.2)];
  }
  // glint telegraph right before his blade falls
  r.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex(), color: '#fff5dc', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  r.glint.visible = false; r.glint.renderOrder = 5; scene.add(r.glint);
  return r;
}
function starTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.12, 'rgba(255,240,210,0.6)'); rg.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,250,235,0.95)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 64); g.moveTo(64, 0); g.lineTo(64, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const RIG = { P: null, E: null };

// placement helpers (all world space)
const _d = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m4 = new THREE.Matrix4(), UP = new V3(0, 1, 0);
function seg(m, a, b, r) {
  _d.subVectors(b, a); const L = _d.length() || 0.001;
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _d.divideScalar(L));
  m.scale.set(r, L, r);
}
function frame3(m, pos, yAxis, zHint, sx, sy, sz) {   // y along yAxis, z as close to zHint as possible
  _y.copy(yAxis).normalize(); _x.crossVectors(_y, zHint).normalize(); _z.crossVectors(_x, _y);
  _m4.makeBasis(_x, _y, _z); m.quaternion.setFromRotationMatrix(_m4); m.position.copy(pos); m.scale.set(sx, sy, sz);
}
function ball(m, p, r) { m.position.copy(p); m.scale.setScalar(r); m.quaternion.identity(); }

const WIND = new V3(-0.6, 0, -0.8).normalize();
function updRig(f, R, dtReal, tReal) {
  const r = rig(f), s = f.scale;
  const P3 = k => lw(f, r[k]);
  const hip = P3('hip'), sh = P3('sh'), neck = P3('neck'), head = P3('head');
  const shF = P3('shF'), shB = P3('shB'), hipF = P3('hipF'), hipB = P3('hipB');
  const kneeF = P3('kneeF'), footF = P3('footF'), kneeB = P3('kneeB'), footB = P3('footB');
  const elbowF = P3('elbowF'), elbowB = P3('elbowB'), grip = P3('grip'), hand2 = P3('hand2');
  const fwd = lv(f, [1, 0, 0]), right = lv(f, [0, 0, 1]);
  const axis = _d.subVectors(sh, hip).clone();

  frame3(R.torso, hip.clone().lerp(sh, 0.5), axis, right, 10.5 * s, axis.length() + 4 * s, 13.5 * s);
  frame3(R.belt, hip.clone().addScaledVector(axis, 0.12), axis, right, 9.4 * s, 5 * s, 12 * s);
  seg(R.neck, sh, head, 4.2 * s);
  ball(R.head, head, 9.6 * s);
  R.hair.position.copy(head).addScaledVector(fwd, -1.6 * s).addScaledVector(axis.clone().normalize(), 1.5 * s); R.hair.scale.setScalar(10 * s);
  ball(R.shoF, shF, 6 * s); ball(R.shoB, shB, 6 * s);
  // legs
  seg(R.thighF, hipF, kneeF, 8 * s); seg(R.shinF, kneeF, footF, 7.6 * s); ball(R.kneeF, kneeF, 7.4 * s);
  seg(R.thighB, hipB, kneeB, 8 * s); seg(R.shinB, kneeB, footB, 7.6 * s); ball(R.kneeB, kneeB, 7.4 * s);
  for (const [m, ft] of [[R.footF, footF], [R.footB, footB]]) { frame3(m, ft.clone().addScaledVector(fwd, 4 * s).setY(Math.max(ft.y, f.y) + 2 * s), fwd, UP, 5 * s, 14 * s, 4 * s); }
  // hakama / skirt from the hips toward the knees
  const flare = f.isPlayer ? 0.62 : 0.8;
  const kc = kneeF.clone().lerp(kneeB, 0.5), bottom = hip.clone().lerp(kc, flare);
  const spread = kneeF.distanceTo(kneeB) * flare;
  frame3(R.skirt, hip.clone().lerp(bottom, 0.5), hip.clone().sub(bottom), right, Math.max(13, spread * 0.55 + 8) * s, hip.distanceTo(bottom) + 6 * s, (f.isPlayer ? 15 : 13.5) * s);
  // arms
  seg(R.uaF, shF, elbowF, 6 * s); seg(R.faF, elbowF, grip, 3.8 * s); ball(R.elF, elbowF, 4.2 * s); ball(R.handF, grip, 4.3 * s);
  seg(R.uaB, shB, elbowB, 5.8 * s); seg(R.faB, elbowB, hand2, 3.7 * s); ball(R.elB, elbowB, 4 * s); ball(R.handB, hand2, 4.1 * s);
  // sword: y along the blade, x toward the edge, z the flat
  const bd = lv(f, r.bd), side = lv(f, r.side), edge = new V3().crossVectors(bd, side);
  _m4.makeBasis(edge, bd, side); R.sword.quaternion.setFromRotationMatrix(_m4); R.sword.position.copy(grip); R.sword.scale.setScalar(s);
  const striking = f.atk && f.atk.phase === 'strike';
  R.sword.userData.steel.emissive.set(striking ? '#6a6f7a' : '#1a1e24');
  // head gear
  const up = axis.clone().normalize();
  if (R.hat) {
    frame3(R.hat, head.clone().addScaledVector(up, 6 * s), up, right, 29 * s, 13 * s, 29 * s);
    R.hatTop.position.copy(head).addScaledVector(up, 12.5 * s); R.hatTop.scale.setScalar(2.2 * s);
  } else {
    const kn = head.clone().addScaledVector(fwd, -7 * s).addScaledVector(up, 8 * s);
    seg(R.knot, head.clone().addScaledVector(up, 6 * s).addScaledVector(fwd, -3 * s), kn, 3.2 * s);
  }
  // cloth
  if (freeze <= 0) {
    const dtc = Math.min(dtReal, 33) * (timeScale < 1 ? timeScale : 1);
    const wmag = 260 + Math.sin(tReal * 0.0013) * 160;
    const vel = f.prevHip ? hip.clone().sub(f.prevHip).multiplyScalar(1000 / Math.max(dtc, 1)) : new V3();
    const wind = WIND.clone().multiplyScalar(wmag).addScaledVector(vel, -0.9);
    const back = fwd.clone().negate();
    if (f.isPlayer) {
      stepChain(f.chains[0], neck.clone().addScaledVector(fwd, -3 * s), back, dtc, wind);
      stepChain(f.chains[1], head.clone().addScaledVector(fwd, -7 * s).addScaledVector(up, 8 * s), back, dtc, wind);
    } else {
      stepChain(f.chains[0], head.clone().addScaledVector(up, 5 * s).addScaledVector(right, 12 * s).addScaledVector(fwd, -6 * s), back, dtc, wind);
      stepChain(f.chains[1], head.clone().addScaledVector(up, 5 * s).addScaledVector(right, -12 * s).addScaledVector(fwd, -6 * s), back, dtc, wind);
    }
    f.prevHip = hip;
  }
  R.ribbons.forEach((rb, i) => drawRibbon(rb, f.chains[i]));
  // glint
  if (f.glint > 0) { R.glint.visible = true; R.glint.position.copy(lw(f, r.tip)); R.glint.scale.setScalar(40 * f.glint * s); R.glint.material.opacity = Math.min(1, f.glint); }
  else R.glint.visible = false;
  R.head3 = head; R.chest = sh.clone().lerp(hip, 0.25);
}
const _t = new V3(), _v = new V3(), _sd = new V3();
function drawRibbon(rb, ch) {
  const pts = ch.pts, pos = rb.m.geometry.attributes.position, n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], q = pts[i];
    _t.set(b.x - a.x, b.y - a.y, b.z - a.z);
    _v.set(camera.position.x - q.x, camera.position.y - q.y, camera.position.z - q.z);
    _sd.crossVectors(_t, _v).normalize().multiplyScalar(lerp(rb.w0, rb.w1, i / (n - 1)) / 2);
    pos.setXYZ(i * 2, q.x - _sd.x, q.y - _sd.y, q.z - _sd.z);
    pos.setXYZ(i * 2 + 1, q.x + _sd.x, q.y + _sd.y, q.z + _sd.z);
  }
  pos.needsUpdate = true; rb.m.geometry.computeVertexNormals(); rb.m.geometry.computeBoundingSphere();
}

// ── fx rendering
const MAXP = 1400;
function pointsLayer(additive) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAXP), 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 1 : 0 } },
    vertexShader: `attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
      void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uSoft; varying vec4 vCol;
      void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r = dot(c, c); if (r > 1.0) discard;
        float a = uSoft > 0.5 ? (1.0 - r) * (1.0 - r) : smoothstep(1.0, 0.6, r);
        gl_FragColor = vec4(vCol.rgb, vCol.a * a); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
  return pts;
}
const fxSoft = pointsLayer(false), fxGlow = pointsLayer(true);
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 6), 3).setUsage(THREE.DynamicDrawUsage));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXP * 6), 3).setUsage(THREE.DynamicDrawUsage));
const sparkLines = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
sparkLines.frustumCulled = false; sparkLines.renderOrder = 4; scene.add(sparkLines);
const RINGS = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.visible = false; m.renderOrder = 4; scene.add(m); RINGS.push(m);
}
const decalMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4a0608', roughness: 0.35, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 400);
decalMesh.frustumCulled = false; decalMesh.receiveShadow = true; scene.add(decalMesh);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(600 * 3), 3).setUsage(THREE.DynamicDrawUsage));
const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
trailMesh.frustumCulled = false; trailMesh.renderOrder = 4; scene.add(trailMesh);

const _o = new THREE.Object3D();
function drawFx() {
  const soft = { p: fxSoft.geometry.attributes.position, c: fxSoft.geometry.attributes.aCol, s: fxSoft.geometry.attributes.aSize, n: 0 };
  const glow = { p: fxGlow.geometry.attributes.position, c: fxGlow.geometry.attributes.aCol, s: fxGlow.geometry.attributes.aSize, n: 0 };
  const put = (L, x, y, z, r, g, b, a, size) => { if (L.n >= MAXP) return; L.p.setXYZ(L.n, x, y, z); L.c.setXYZW(L.n, r, g, b, a); L.s.setX(L.n, size); L.n++; };
  const sp = sparkGeo.attributes.position, sc = sparkGeo.attributes.color; let ns = 0, nr = 0;
  for (const q of parts) {
    const k = q.life / q.max;
    if (q.k === 'blood') put(soft, q.x, q.y, q.z, 0.33, 0.02, 0.03, 0.95, q.s * 1.4);
    else if (q.k === 'dust') put(soft, q.x, q.y, q.z, 0.3, 0.22, 0.22, 0.22 * (1 - k), q.s * 2.4);
    else if (q.k === 'mote') put(glow, q.x, q.y, q.z, 0.6, 1.6, 0.9, 0.9 * (1 - k), q.s * 3);
    else if (q.k === 'flash') {
      const c = q.col; put(glow, q.x, q.y, q.z, c[0] / 255 * 1.5, c[1] / 255 * 1.5, c[2] / 255 * 1.5, 0.8 * (1 - k), q.r * 1.3 * (0.6 + k * 0.8));
    } else if (q.k === 'spark' && ns < MAXP) {
      const spd = Math.hypot(q.vx, q.vy, q.vz) || 1, len = Math.min(q.h, spd * 0.03), al = (1 - k) * 3.2;
      const g = (200 + 55 * (1 - k)) / 255, b = (120 + 100 * (1 - k)) / 255;
      sp.setXYZ(ns * 2, q.x, q.y, q.z); sp.setXYZ(ns * 2 + 1, q.x - q.vx / spd * len, q.y - q.vy / spd * len, q.z - q.vz / spd * len);
      sc.setXYZ(ns * 2, al, g * al, b * al); sc.setXYZ(ns * 2 + 1, al * 0.4, g * al * 0.3, b * al * 0.2); ns++;
      put(glow, q.x, q.y, q.z, 1.8, g * 1.6, b * 1.2, 1 - k, q.w * 2.4);
    } else if (q.k === 'ring' && nr < RINGS.length) {
      const m = RINGS[nr++], c = q.col; m.visible = true; m.position.set(q.x, q.y, q.z); m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(Math.max(0.01, q.r * 0.6 * EASE.out(k))); m.material.color.setRGB(c[0] / 255 * 1.8, c[1] / 255 * 1.8, c[2] / 255 * 1.8).multiplyScalar(0.45 * (1 - k));
    }
  }
  for (let i = nr; i < RINGS.length; i++) RINGS[i].visible = false;
  for (const L of [soft, glow]) { L.p.needsUpdate = L.c.needsUpdate = L.s.needsUpdate = true; }
  fxSoft.geometry.setDrawRange(0, soft.n); fxGlow.geometry.setDrawRange(0, glow.n);
  sp.needsUpdate = sc.needsUpdate = true; sparkGeo.setDrawRange(0, ns * 2);
  // blood on the ground fades by shrinking
  let nd = 0;
  for (const q of decals) {
    const k = q.life / q.max, sc2 = q.s * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    _o.position.set(q.x, 0.3 + (nd % 7) * 0.02, q.z); _o.rotation.set(0, q.a, 0); _o.scale.set(sc2 * 1.5, 1, sc2 * 0.8); _o.updateMatrix();
    decalMesh.setMatrixAt(nd++, _o.matrix); if (nd >= 400) break;
  }
  decalMesh.count = nd; decalMesh.instanceMatrix.needsUpdate = true;
  // blade trails
  trails = trails.filter(t => gameTime - t.t < 110);
  const tp = trailGeo.attributes.position, tc = trailGeo.attributes.color; let nt = 0;
  for (const f of [P, E]) {
    const list = trails.filter(t => t.f === f);
    for (let i = 1; i < list.length && nt < 96; i++) {
      const a = list[i - 1], b = list[i]; if (b.t - a.t > 30) continue;
      const age = (gameTime - b.t) / 110, al = (1 - age) * (1 - age) * 0.38;
      const col = b.red ? [1.4 * al, 0.45 * al, 0.35 * al] : [1.3 * al, 1.2 * al, 1.1 * al];
      const quad = [a.tip, b.tip, b.mid, a.tip, b.mid, a.mid];
      for (let j = 0; j < 6; j++) { tp.setXYZ(nt * 6 + j, quad[j].x, quad[j].y, quad[j].z); tc.setXYZ(nt * 6 + j, col[0], col[1], col[2]); }
      nt++;
    }
  }
  tp.needsUpdate = tc.needsUpdate = true; trailGeo.setDrawRange(0, nt * 6);
}

// ── camera: over-the-shoulder lock-on, or side-on like the 2D duel
const camPos = new V3(-520, 150, 60), camLook = new V3(0, 100, 0);
const _pw = new V3(), _ew = new V3(), _F = new V3(), _R = new V3(), _dp = new V3(), _dl = new V3();
function updCamera(dtReal, tReal) {
  W3(P.x, P.y * 0.5, 0, _pw); W3(E.x, E.y * 0.5, 0, _ew);
  _F.subVectors(_ew, _pw).setY(0); const sep = _F.length();
  if (sep < 1) lv(P, [1, 0, 0], _F); else _F.divideScalar(sep);
  _R.set(-_F.z, 0, _F.x);
  const mid = _pw.clone().lerp(_ew, 0.5);
  let rate = 0.006;
  if (mode === 'title') {
    const n = new V3(-Math.sin(AX.th), 0, Math.cos(AX.th)), u = new V3(Math.cos(AX.th), 0, Math.sin(AX.th));
    const ang = -2.2 + Math.sin(tReal * 0.00012) * 0.35;
    _dp.copy(mid).addScaledVector(u, Math.cos(ang) * 380).addScaledVector(n, Math.sin(ang) * 380).setY(120);
    _dl.copy(mid).setY(92);
    // the title card covers the left half; aim so the pair sits right of centre
    const rgt = new V3().subVectors(_dl, _dp).cross(UP).normalize();
    _dl.addScaledVector(rgt, -130);
    rate = 0.003;
  } else if (P.state === 'execute' || (E.state === 'executed' && E.stateT < 1600)) {
    // deathblow: cut to a low three-quarter angle from the player's sword side
    _dp.copy(mid).addScaledVector(_R, 250).addScaledVector(_F, -70).setY(78);
    _dl.copy(mid).setY(104);
    rate = 0.01;
  } else if (cam.mode === 'side') {
    const n = new V3(-Math.sin(AX.th), 0, Math.cos(AX.th));
    _dp.copy(mid).addScaledVector(n, -Math.max(360, sep * 0.95 + 230)).setY(118);
    _dl.copy(mid).setY(96);
  } else {
    const k = cam.kick;
    // over the right shoulder and wide enough that he is never hidden behind you: he sits
    // near the centre of the frame, you stand off to the left
    _dp.copy(_pw).addScaledVector(_F, -225).addScaledVector(_R, 135).setY(150 + sep * 0.05);
    _dl.copy(_pw).addScaledVector(_F, sep * 0.85).addScaledVector(_R, 10).setY(92);
  }
  const kp = 1 - Math.exp(-dtReal * rate), kl = 1 - Math.exp(-dtReal * rate * 1.8);
  camPos.lerp(_dp, kp); camLook.lerp(_dl, kl);
  const sh = cam.shake * 0.7;
  camera.position.set(camPos.x + (Math.random() * 2 - 1) * sh, camPos.y + (Math.random() * 2 - 1) * sh, camPos.z + (Math.random() * 2 - 1) * sh);
  camera.lookAt(camLook);
  camera.fov = 50 - cam.kick * 6; camera.updateProjectionMatrix();
  cam.shake *= Math.exp(-dtReal * 0.018);
  cam.kick *= Math.exp(-dtReal * 0.003);
  // shadows and fill follow the fight
  moonLight.target.position.copy(mid).setY(0); moonLight.position.copy(mid).addScaledVector(MOON_DIR, 1500);
  fillLight.target.position.copy(mid).setY(80); fillLight.position.copy(camera.position).add(new V3(0, 300, 0));
  sky.position.copy(camera.position);
  moon.position.copy(camera.position).addScaledVector(MOON_DIR, 15000); moon.lookAt(camera.position);
}

// ── scenery animation
function updScenery(dtReal, tReal) {
  const d = Math.min(dtReal, 50) / 1000;
  grassMat.uniforms.uTime.value = tReal / 1000;
  grassMat.uniforms.uGust.value.set(gust.x, gust.z, gust.amp);
  const pp = petalGeo.attributes.position, cx = camLook.x, cz = camLook.z;
  for (let i = 0; i < PETALS; i++) {
    const v = petalVel[i]; v.ph += d * 2;
    let x = pp.getX(i) + (v.vx + Math.sin(v.ph) * 20) * d, y = pp.getY(i) + v.vy * d, z = pp.getZ(i) + (v.vz + Math.cos(v.ph) * 14) * d;
    if (y < 0 || Math.abs(x - cx) > 900 || Math.abs(z - cz) > 900) { x = cx + rand(-900, 900); z = cz + rand(-900, 900); y = rand(200, 600); }
    pp.setXYZ(i, x, y, z);
  }
  pp.needsUpdate = true;
}

// ───────────────────────── HUD (2D canvas over the scene) ─────────────────────────
const hud = document.getElementById('hud'), ctx = hud.getContext('2d');
let W = 0, H = 0, DPR = 1, vignette = null;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
  hud.width = Math.round(W * DPR); hud.height = Math.round(H * DPR);
  renderer.setSize(W, H, false); composer.setSize(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(camera.fov * D2R / 2));
  fxSoft.material.uniforms.uScale.value = fxGlow.material.uniforms.uScale.value = scale;
  vignette = document.createElement('canvas'); vignette.width = Math.max(1, W * DPR / 2); vignette.height = Math.max(1, H * DPR / 2);
  const v = vignette.getContext('2d'), g = v.createRadialGradient(vignette.width / 2, vignette.height * 0.55, vignette.height * 0.3, vignette.width / 2, vignette.height * 0.55, vignette.width * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); v.fillStyle = g; v.fillRect(0, 0, vignette.width, vignette.height);
}
addEventListener('resize', resize);
const _pj = new V3();
function project(w) { _pj.copy(w).project(camera); return { x: (_pj.x * 0.5 + 0.5) * W, y: (-_pj.y * 0.5 + 0.5) * H, vis: _pj.z < 1 }; }

function bar(x, y, w, h, ratio, col, bg = 'rgba(0,0,0,0.55)') {
  ctx.fillStyle = bg; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
  ctx.strokeStyle = 'rgba(236,226,204,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
}
function postureBar(cx, y, w, ratio, broken) {
  if (ratio < 0.01 && !broken) return;
  const h = 7, half = w / 2 * clamp(ratio, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
  const hot = clamp((ratio - 0.55) / 0.45, 0, 1);
  const r = 240, g = Math.round(lerp(170, 60, hot)), b = Math.round(lerp(60, 40, hot));
  const grd = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  grd.addColorStop(0, `rgb(${r},${g},${b})`); grd.addColorStop(0.5, `rgb(255,${Math.min(255, g + 60)},${b + 40})`); grd.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = broken ? '#ff4a30' : grd; ctx.fillRect(cx - half, y, half * 2, h);
  ctx.strokeStyle = 'rgba(236,226,204,0.22)'; ctx.strokeRect(cx - w / 2 - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = '#f0c75e'; ctx.beginPath(); ctx.moveTo(cx, y - 5); ctx.lineTo(cx + 4, y + h / 2); ctx.lineTo(cx, y + h + 5); ctx.lineTo(cx - 4, y + h / 2); ctx.closePath(); ctx.fill();
}
function drawHUD(tReal) {
  const pad = Math.max(16, W * 0.03);
  const small = W < 600, S = clamp(H / 700, 0.7, 1.4);
  // enemy
  ctx.font = `700 ${small ? 14 : 17}px "Shippori Mincho", serif`; ctx.fillStyle = '#ece2cc'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText('陽炎  Kagerō, Wandering Blade', pad + 34, pad + 14);
  for (let i = 0; i < 2; i++) {
    const alive = i < E.lives; ctx.beginPath(); ctx.arc(pad + 8 + i * 14, pad + 24, 5, 0, 7);
    ctx.fillStyle = alive ? '#c42a1f' : 'rgba(80,60,60,0.6)'; ctx.fill(); ctx.strokeStyle = 'rgba(236,226,204,0.4)'; ctx.stroke();
  }
  const ew = Math.min(360, W * 0.42);
  bar(pad + 34, pad + 21, ew, 6, E.hp / E.maxHp, '#b3261e');
  postureBar(W / 2, pad + 44, Math.min(420, W * 0.5), E.posture / E.maxPosture, E.state === 'broken');
  // player
  const pw = Math.min(300, W * 0.36), py = H - pad - 14 - (touchEl.hidden ? 0 : 150);
  ctx.font = `500 12px "Zen Kaku Gothic New", sans-serif`; ctx.fillStyle = 'rgba(236,226,204,0.75)';
  ctx.fillText(`Gourd ${'●'.repeat(P.gourds)}${'○'.repeat(3 - P.gourds)}`, pad, py - 10);
  bar(pad, py, pw, 7, P.hp / P.maxHp, '#b3261e');
  postureBar(W / 2, py - (small ? 26 : 0), Math.min(380, W * 0.44), P.posture / P.maxPosture, P.state === 'broken');
  // practice readout
  ctx.textAlign = 'right'; ctx.font = `500 12px "Zen Kaku Gothic New", sans-serif`; ctx.fillStyle = 'rgba(236,226,204,0.6)';
  ctx.fillText(`Deflects ${stats.deflects}   Streak ${stats.streak}   Best ${stats.best}`, W - pad, pad + 14);
  if (stats.last) {
    let s = '', col = 'rgba(236,226,204,0.6)';
    if (stats.last.hit) { s = 'Hit'; col = '#e8452c'; }
    else if (stats.last.blocked) s = 'Blocked — tap closer to impact';
    else { const e = stats.last.err; s = `${stats.last.perfect ? 'Perfect deflect' : 'Deflect'}  ${e > 0 ? '+' : ''}${e} ms`; col = stats.last.perfect ? '#ffcf7a' : 'rgba(236,226,204,0.8)'; }
    ctx.fillStyle = col; ctx.fillText(s, W - pad, pad + 32);
  }
  ctx.fillStyle = 'rgba(236,226,204,0.35)'; ctx.fillText(`C  camera: ${cam.mode === 'behind' ? 'shoulder' : 'side'}`, W - pad, H - pad - (touchEl.hidden ? 0 : 150));
  ctx.textAlign = 'left';
  // perilous kanji over his head
  if (E.peril > 0 && E.state === 'attack' && RIG.E.head3) {
    const sp = project(RIG.E.head3.clone().add(new V3(0, 42, 0)));
    if (sp.vis) {
      const k = 1 - E.peril / 0.9, pop = k < 0.12 ? EASE.out(k / 0.12) : 1, al = E.peril > 0.15 ? 1 : E.peril / 0.15;
      const size = 54 * S * (1.3 - 0.3 * pop);
      ctx.save(); ctx.globalAlpha = al; ctx.font = `800 ${size}px "Shippori Mincho", serif`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255,40,20,0.9)'; ctx.shadowBlur = 24; ctx.fillStyle = '#e0261a'; ctx.fillText('危', sp.x, sp.y);
      ctx.shadowBlur = 0; ctx.globalAlpha = al * 0.9; ctx.font = `700 ${Math.max(11, 13 * S)}px "Zen Kaku Gothic New", sans-serif`; ctx.fillStyle = '#ffb3a8';
      ctx.fillText({ thrust: 'THRUST', sweep: 'SWEEP', grab: 'CHARGE' }[E.perilKind] || '', sp.x, sp.y + 18 * S);
      ctx.restore();
    }
  }
  // deathblow mark
  if (E.state === 'broken' && RIG.E.chest) {
    const sp = project(RIG.E.chest), pulse = 0.7 + Math.sin(tReal * 0.012) * 0.3;
    if (sp.vis) {
      const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 34 * S); g.addColorStop(0, `rgba(255,60,40,${0.9 * pulse})`); g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, 34 * S, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff3b27'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 6 * S, 0, 7); ctx.fill();
    }
  }
  // banners
  for (const b of banners) {
    const inK = clamp(b.t / 0.25, 0, 1), out = b.dur > 50 ? 1 : clamp((b.dur - b.t) / 0.4, 0, 1);
    const al = Math.min(inK, out);
    ctx.save(); ctx.globalAlpha = al; ctx.textAlign = 'center';
    if (b.text) {
      const size = Math.min(W * 0.22, H * 0.26) * b.size * (1.08 - 0.08 * EASE.out(inK));
      ctx.font = `800 ${size}px "Shippori Mincho", serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 30; ctx.fillStyle = b.color;
      ctx.fillText(b.text, W / 2, H * 0.44);
      ctx.shadowBlur = 0; ctx.font = `500 ${Math.max(13, size * 0.1)}px "Zen Kaku Gothic New", sans-serif`; ctx.fillStyle = 'rgba(236,226,204,0.9)';
      ctx.fillText(b.sub, W / 2, H * 0.44 + size * 0.28);
    } else {
      ctx.font = `700 ${Math.max(16, 26 * b.size * S)}px "Shippori Mincho", serif`; ctx.fillStyle = b.color;
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 16; ctx.fillText(b.sub, W / 2, H * 0.3);
    }
    ctx.restore();
  }
}

// ───────────────────────── main loop ─────────────────────────
function render(dtReal, tReal) {
  updRig(P, RIG.P, dtReal, tReal); updRig(E, RIG.E, dtReal, tReal);
  updCamera(dtReal, tReal);
  updScenery(dtReal, tReal);
  drawFx();
  composer.render();
  // grade + HUD
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  if (vignette) ctx.drawImage(vignette, 0, 0, W, H);
  if (flashRed > 0.005) { ctx.fillStyle = `rgba(160,10,10,${flashRed})`; ctx.fillRect(0, 0, W, H); flashRed *= Math.exp(-dtReal * 0.006); }
  if (flashWhite > 0.005) { ctx.fillStyle = `rgba(255,240,220,${flashWhite})`; ctx.fillRect(0, 0, W, H); flashWhite *= Math.exp(-dtReal * 0.012); }
  if (P.hp / P.maxHp < 0.3 && mode === 'play') { ctx.fillStyle = `rgba(120,0,0,${0.12 + Math.sin(tReal * 0.006) * 0.05})`; ctx.fillRect(0, 0, W, H); }
  if (mode !== 'title') drawHUD(tReal);
  if (mode === 'paused') { ctx.fillStyle = 'rgba(9,8,13,0.55)'; ctx.fillRect(0, 0, W, H); }
}

function frame(now) {
  for (let i = timers.length - 1; i >= 0; i--) if (now >= timers[i].at) timers.splice(i, 1)[0].fn();
  let dtReal = Math.min(now - lastFrame, 100); lastFrame = now;
  pollPad();
  if (mode === 'play' || mode === 'dead' || mode === 'won') {
    if (slowT > 0) { slowT -= dtReal; if (slowT <= 0) timeScale = mode === 'dead' ? 0.6 : 1; }
    if (freeze > 0) { freeze -= dtReal; updParts(dtReal * 0.25); }
    else {
      acc += dtReal * timeScale;
      let n = 0; while (acc >= STEP && n < 24) { step(STEP); acc -= STEP; n++; }
      updParts(dtReal * timeScale);
    }
    gust.amp *= Math.exp(-dtReal * 0.004);
  } else if (mode === 'title') {
    // living title card: both fighters breathe, cloth moves
    gameTime += dtReal; updAnim(P, dtReal); updAnim(E, dtReal);
  }
  render(dtReal, now);
  requestAnimationFrame(frame);
}

// ───────────────────────── flow ─────────────────────────
const veil = document.getElementById('veil');
let ready = false;
function startDuel() {
  initAudio();
  const sel = document.querySelector('input[name="tempo"]:checked'); tempo = sel ? sel.value : 'swordmaster';
  resetDuel(); pending.length = 0;
  P.x = -210; E.x = 210; E.think = 1100;
  setPose(P, 'idle', 1); setPose(E, 'idle', 1);
  mode = 'play'; veil.hidden = true; acc = 0; lastFrame = CLOCK.now();
  banner('', 'Kagerō draws his blade', '#ece2cc', 1.6, 0.8);
}
function togglePause() {
  if (mode === 'play') {
    mode = 'paused'; veil.hidden = false;
    document.getElementById('eyebrow').textContent = 'Paused';
    document.getElementById('begin').textContent = 'Restart duel';
  } else if (mode === 'paused') { mode = 'play'; veil.hidden = true; lastFrame = CLOCK.now(); }
}
const beginBtn = document.getElementById('begin');
beginBtn.addEventListener('click', startDuel);

resetDuel();
RIG.P = buildRig(true); RIG.E = buildRig(false);
resize();
setPose(P, 'guard', 1); setPose(E, 'windThrust', 1);
P.x = -150; E.x = 130;
// compile shaders before the first frame so the title card doesn't hitch
renderer.compile(scene, camera);
ready = true; beginBtn.disabled = false; window.__kagero3d = true;
if (new URLSearchParams(location.search).has('debug')) {
  window.__duel = { get P() { return P; }, get E() { return E; }, get mode() { return mode; }, get AX() { return AX; }, comboQueue, scriptedCombo, input, DBG, pressGuard, releaseGuard, pressAttack, pressJump, pressDodge, cam };
}
requestAnimationFrame(t => { lastFrame = t; frame(t); });
