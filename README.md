# Penalty Shootout 十二碼大戰 ⚽

A skill-based penalty shootout in a single page — no build step, no dependencies,
no external assets. Everything (stadium, keeper, ball physics, sound) is drawn and
generated in code.

**Play:** aim with the mouse/finger, **hold** to charge power, **release** to shoot.

## What makes it a game (not a coin flip)

| Skill lever | How it works |
|---|---|
| **Aiming** | The reticle follows your pointer, in 2D across the goal (corners + height), not 3 fixed directions |
| **Power** | Hold to charge. ~68% is the *sweet spot*: pinpoint accuracy. Weak shots are tame but slow, over-hit shots spray wide |
| **Woodwork** | Hit within a ball-width of the frame and it's a post/crossbar, with its own clang |
| **Keeper AI** | He commits *before* he can see the shot, then dives — bigger reach, faster reaction and better anticipation at higher difficulty |
| **Anticipation** | He reads your last four penalties. Repeat a side and he'll suss you out — mixing sides is how you win |
| **Shootout** | 5 penalties, streak + best-streak tracking (saved locally), end-of-game rating |

## Controls

| Action | Pointer | Keyboard |
|---|---|---|
| Aim | Move mouse / drag finger | ← → ↑ ↓ |
| Charge | Press and hold | Hold `Space` |
| Shoot | Release | Release `Space` |
| Restart | ↻ button | `R` |

Difficulty: **Easy / Normal / Hard / Legend** — keeper reach 0.26 → 0.62 goal units,
reaction 0.34s → 0.11s, anticipation 15% → 58%.

## Features

- Fake-3D perspective stadium: night sky, floodlight glow, twinkling crowd,
  advertising boards, mown pitch stripes, projected penalty area, penalty arc
- Articulated keeper with a real dive pose, ball rotation, motion trail,
  height-aware shadow, net ripple, confetti burst, goal-frame screen shake
- Procedural WebAudio sound: kick thump, whistle, net swish, post clang,
  crowd swell / groan (no audio files)
- Mobile-first: pointer events, responsive HUD, DPR-aware canvas, no scroll/zoom
- Accessible: keyboard play, `prefers-reduced-motion` disables shake and confetti,
  canvas label, ARIA sound toggle

## Files

```
index.html              HUD / markup
style.css               HUD, overlays, responsive layout
script.js               LOGIC (pure) + audio + renderer + game loop
tests/logic.test.js     headless tests for the pure logic
```

`script.js` keeps every rule of the game inside the pure `LOGIC` block
(`shotError`, `keeperPlan`, `resolveShot`, `playRound`, `rating`) so it can be
unit-tested headlessly — it exports itself when loaded under CommonJS:

```js
const { LOGIC, DIFF, CFG } = require('./script.js');
LOGIC.resolveShot({ x: 0.8, y: 0.3 }, 0.68, keeper, 'normal');
```

## Tests

```bash
node tests/logic.test.js
```

15 assertions covering placement, woodwork, the power/accuracy curve, keeper
reach and anticipation scaling, and the end-of-game rating — no browser needed.

## Deploy

Static files — GitHub Pages serves `main` / root directly. Locally:

```bash
python3 -m http.server 8000    # http://localhost:8000
```
