# 陽炎 Kagerō

A Sekiro-style 2D sword duel that runs in the browser. It's built around deflecting: his attack strings are random every time, and each deflect is judged from your key press's timestamp, not rounded to the nearest frame.

**Play:** https://qihang-dai.github.io/kagero-duel/

**Play in 3D:** https://qihang-dai.github.io/kagero-duel/3d/

https://github.com/qihang-dai/kagero-duel/raw/main/media/kagero-demo.mp4

- One `index.html`, no build step, no assets: characters are animated in code (inverse kinematics), and all sound is generated live with WebAudio.
- Tap to deflect, hold to guard, and mashing shrinks the window. Break his posture, then land a deathblow. He has two lives.
- 危 perilous attacks: Mikiri the thrust, jump the sweep, dodge the charge.
- Controls: A/D move · K deflect · J attack · Space jump · Shift dodge · F heal. Gamepad and touch work too.

`tools/capture.mjs` records the demo video. It drives the game on a fixed 60 fps clock, renders the game's own sound events offline so they stay in sync, and encodes an H.264 MP4 (`cd tools && npm i && node capture.mjs`).

## 3D version

`3d/` is the same duel rendered with three.js (loaded from a CDN via an import map, still no build step). The combat simulation — timing windows, AI, poses, IK — is carried over from the 2D game unchanged and still runs along one line; the 3D layer places that line in the world and rotates it when either fighter circles the other, so strafing never changes the distances the deflect windows are tuned for. It adds a lock-on over-the-shoulder camera (<kbd>C</kbd> toggles a side-on view), sidestep dodges, 3D cloth, bloom, shadows, and a pampas field that bends with each deflect.

- Controls: W/S step in/back · A/D circle him · K deflect · J attack · Space jump · Shift dodge (with A/D: sidestep) · F heal · C camera.
- `3d/?debug` exposes `window.__duel` for scripted testing.

## Pale Hour

A second game in the same repo: a pixel-art JRPG boss fight in the reactive turn-based style. You pick commands on your turn; on its turn you parry, dodge and jump its strikes in real time. Parry a whole string and you counter.

**Play:** https://qihang-dai.github.io/kagero-duel/pale-hour/

- One `pale-hour/index.html`, no build step. The pixel art is drawn in code, and the chiptune score and sound effects are synthesized live with WebAudio.
- Three heroes, with AP, skills and timed rings. Free-aim shots knock off its chime shields and hit the dial's weak point, and its break gauge stuns it.
- Three phases: a mark that counts down to Erasure, and a twelve-strike finale at midnight.
- Its turn: J parry · K dodge · Space jump. Your turn: arrows + J/K. Story, Normal and Hard difficulties. Gamepad and touch work too.
