# 陽炎 Kagerō

A Sekiro-style 2D sword duel that runs in the browser. It's built around deflecting: his attack strings are random every time, and each deflect is judged from your key press's timestamp, not rounded to the nearest frame.

**Play:** https://qihang-dai.github.io/kagero-duel/

https://github.com/qihang-dai/kagero-duel/raw/main/media/kagero-demo.mp4

- One `index.html`, no build step, no assets: characters are animated in code (inverse kinematics), and all sound is generated live with WebAudio.
- Tap to deflect, hold to guard, and mashing shrinks the window. Break his posture, then land a deathblow. He has two lives.
- 危 perilous attacks: Mikiri the thrust, jump the sweep, dodge the charge.
- Controls: A/D move · K deflect · J attack · Space jump · Shift dodge · F heal. Gamepad and touch work too.

`tools/capture.mjs` records the demo video. It drives the game on a fixed 60 fps clock, renders the game's own sound events offline so they stay in sync, and encodes an H.264 MP4 (`cd tools && npm i && node capture.mjs`).
