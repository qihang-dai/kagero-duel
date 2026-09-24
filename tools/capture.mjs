// Frame-exact demo capture: drives the game on a fixed 60 fps clock, pipes frames to
// ffmpeg, renders the game's own sound events offline, and muxes an H.264/AAC MP4.
// Usage: node capture.mjs [--dry] [--seed N] [--out ../media/kagero-demo.mp4]
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : (args[i + 1] ?? true); };
const DRY = args.includes('--dry');
const SEED = Number(flag('--seed', 7));
const OUT = resolve(here, flag('--out', '../media/kagero-demo.mp4'));
const W = Number(flag('--w', 1920)), H = Number(flag('--h', 1080));
const FPS = 60, URL_TEXT = flag('--url', 'qihang-dai.github.io/kagero-duel');
const TAIL_MS = 2600, CARD_MS = 3200;           // after the deathblow, then the end card

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(seed => {
  window.__CAPTURE__ = { fps: 60 };
  let a = seed >>> 0;                            // mulberry32 — same seed, same duel
  Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}, SEED);
await page.goto('file://' + resolve(here, '../index.html'));
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load('800 60px "Shippori Mincho"', '陽炎忍殺見切り危勝死Kagerō'),
    document.fonts.load('700 30px "Shippori Mincho"', 'Kagerō, Wandering Blade Posture broken'),
    document.fonts.load('500 14px "Zen Kaku Gothic New"', 'Deflects Streak Perfect ms THRUST SWEEP'),
  ]);
});

// choreography + human-ish bot, installed in the page
await page.evaluate(({ W, H, URL_TEXT, TAIL_MS, CARD_MS }) => {
  const C = window.__cap, cv = document.getElementById('game'), ctx = cv.getContext('2d');
  const R = (a, b) => a + Math.random() * (b - a);
  C.start(0);
  C.P.x = -170; C.E.x = 170; C.E.think = 650;
  const q = s => C.comboQueue.push(C.scriptedCombo(s));
  q([{ type: 'high', wind: 520, hold: 260 }, { type: 'rise', wind: 200 }, { type: 'diag', wind: 230 },
     { type: 'high', wind: 220, hold: 380 }, { type: 'rise', wind: 125 }, { type: 'diag', wind: 190 }]);
  q([{ type: 'thrust', wind: 620, hold: 140 }]);
  q([{ type: 'diag', wind: 430 }, { type: 'rise', wind: 180 }, { type: 'sweep', wind: 640 }]);
  q([{ type: 'high', wind: 450 }, { type: 'diag', wind: 200 }, { type: 'rise', wind: 220 }, { type: 'high', wind: 180 }, { type: 'diag', wind: 200 }]);

  const bot = { done: new Set(), list: null, release: -1, openHits: 0, lastE: '', killAt: -1, log: [] };
  window.__bot = bot;
  const tap = (t) => { C.pressGuard(); bot.release = t + 50; };
  bot.tick = (t) => {
    const P = C.P, E = C.E;
    if (bot.release > 0 && t >= bot.release) { C.releaseGuard(); bot.release = -1; }
    C.input.left = C.input.right = false;
    if (E.state !== bot.lastE) { bot.log.push(`${(t / 1000).toFixed(2)}s E:${E.state} post=${E.posture | 0}`); bot.lastE = E.state; if (E.state === 'staggered') bot.openHits = 0; }
    if (E.state === 'attack' && E.atk) {
      const at = E.atk, a = at.list[at.i];
      if (at.list !== bot.list) { bot.list = at.list; bot.done = new Set(); }
      let tti = 1e9;
      if (at.phase === 'wind') tti = a.windT - at.pt + a.holdT + a.strike;
      else if (at.phase === 'hold') tti = a.holdT - at.pt + a.strike;
      else if (at.phase === 'strike') tti = a.strike - at.pt;
      const key = at.i;
      if (!bot.done.has(key)) {
        if (!a.lead) a.lead = R(26, 62);
        if (a.type === 'thrust' && tti < 230) { const tw = Math.sign(E.x - P.x); if (tw > 0) C.input.right = true; else C.input.left = true; C.pressDodge(); bot.done.add(key); }
        else if (a.type === 'sweep' && tti < 235) { C.pressJump(); bot.done.add(key); bot.kick = true; }
        else if (a.type === 'grab' && tti < 240) { C.pressJump(); bot.done.add(key); }
        else if (!['thrust', 'sweep', 'grab'].includes(a.type) && tti <= a.lead) { tap(t); bot.done.add(key); }
      }
      if (P.state === 'dodge' && P.dodgeToward) { if (E.x > P.x) C.input.right = true; else C.input.left = true; }
    }
    if (bot.kick && P.air && t - 0 > 0 && C.gameTime - P.sweepDodge < 400) { C.pressAttack(); bot.kick = false; }
    if (E.state === 'staggered' && !bot.mikiriSeen && bot.openHits < 2 && P.state === 'idle' && E.stateT > 120 && E.stateT < E.stagT - 380) { C.pressAttack(); bot.openHits++; }
    if (E.state === 'broken' && P.state !== 'execute' && E.stateT > 350) C.pressAttack();
    if (P.state === 'mikiri') bot.mikiriSeen = true;
    if (E.state === 'executed' && bot.killAt < 0) bot.killAt = t;
  };
  // overlays burned into the video
  const serif = '"Shippori Mincho", serif', sans = '"Zen Kaku Gothic New", sans-serif';
  bot.overlay = (t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = H / 1080;
    if (t < 3200) {
      const a = Math.min(1, t / 300) * Math.min(1, (3200 - t) / 500);
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 18 * u;
      ctx.fillStyle = '#ece2cc'; ctx.font = `700 ${34 * u}px ${sans}`;
      ctx.fillText('Every clang is a frame-timed deflect.', W / 2, H * 0.13);
      ctx.restore();
    }
    if (bot.killAt > 0 && t > bot.killAt + TAIL_MS) {
      const k = Math.min(1, (t - bot.killAt - TAIL_MS) / 600);
      ctx.fillStyle = `rgba(9,8,13,${0.88 * k})`; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalAlpha = k; ctx.textAlign = 'center';
      ctx.fillStyle = '#c42a1f'; ctx.font = `800 ${44 * u}px ${serif}`; ctx.fillText('陽 炎', W / 2, H * 0.36);
      ctx.fillStyle = '#ece2cc'; ctx.font = `800 ${150 * u}px ${serif}`; ctx.fillText('Kagerō', W / 2, H * 0.53);
      ctx.fillStyle = '#c9bfab'; ctx.font = `500 ${30 * u}px ${sans}`; ctx.fillText('A Sekiro-style deflect duel · plays in your browser', W / 2, H * 0.62);
      ctx.fillStyle = '#ffae4a'; ctx.font = `700 ${34 * u}px ${sans}`; ctx.fillText(URL_TEXT, W / 2, H * 0.72);
      ctx.restore();
    }
  };
  bot.finished = (t) => bot.killAt > 0 && t > bot.killAt + TAIL_MS + CARD_MS;
}, { W, H, URL_TEXT, TAIL_MS, CARD_MS });

const MAX_FRAMES = FPS * 60;
let ff, frames = 0;
const tmpVideo = OUT.replace(/\.mp4$/, '.video.mp4'), tmpWav = OUT.replace(/\.mp4$/, '.wav');
mkdirSync(dirname(OUT), { recursive: true });
if (!DRY) ff = spawn(ffmpegPath, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', tmpVideo], { stdio: ['pipe', 'ignore', 'inherit'] });

for (let i = 0; i < MAX_FRAMES; i++) {
  const t = i * 1000 / FPS;
  const res = await page.evaluate(({ t, dry }) => {
    const b = window.__bot; b.tick(t); window.__cap.frame(t); b.overlay(t);
    return { done: b.finished(t), jpg: dry ? null : document.getElementById('game').toDataURL('image/jpeg', 0.94) };
  }, { t, dry: DRY });
  if (!DRY) { const buf = Buffer.from(res.jpg.split(',')[1], 'base64'); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
  frames = i + 1;
  if (i % 300 === 0) process.stderr.write(`frame ${i}\n`);
  if (res.done) break;
}
const seconds = frames / FPS;
const summary = await page.evaluate(() => ({ log: window.__bot.log, stats: window.__cap.P && { hp: window.__cap.P.hp }, lives: window.__cap.E.lives, sfx: window.__cap.sfxLog.length }));
console.log(summary.log.join('\n'));
console.log(`frames=${frames} (${seconds.toFixed(1)}s) playerHP=${summary.stats.hp} enemyLives=${summary.lives} sfxEvents=${summary.sfx}`);

if (!DRY) {
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  // offline-render the same sound events, sample-accurate to the frames
  const wav = await page.evaluate(async secs => {
    const buf = await window.__cap.renderAudio(secs);
    const n = buf.length, chs = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0; for (const c of chs) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
    const g = peak > 0.95 ? 0.95 / peak : 1, out = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++) for (const c of chs) { out.setInt16(o, Math.max(-1, Math.min(1, c[i] * g)) * 32767, true); o += 2; }
    let s = ''; const b = new Uint8Array(out.buffer); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }, seconds);
  writeFileSync(tmpWav, Buffer.from(wav, 'base64'));
  await new Promise((res, rej) => spawn(ffmpegPath, ['-y', '-i', tmpVideo, '-i', tmpWav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' })
    .on('close', c => c === 0 ? res() : rej(new Error('mux failed'))));
  console.log('wrote', OUT);
}
await browser.close();
