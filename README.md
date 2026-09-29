# Penalty Shootout 十二碼大戰 ⚽

A skill-based penalty shootout in a single page — no build step, no assets, no
bundler. The stadium is a **real WebGL 3D scene** (perspective camera,
floodlights with shadows, a packed crowd, cinematic slow motion), and the keeper
is a **learning AI whose belief you can watch and exploit**.

**Play:** aim with the mouse/finger, **hold** to charge power, **release** to shoot.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## What makes it a game (not a coin flip)

| Skill lever | How it works |
|---|---|
| **Aiming** | The reticle sits *on the goal in 3D*, foreshortened by the camera — corners and height, not three fixed directions |
| **Power** | Hold to charge. ~68% is the *sweet spot*: pinpoint. Weak shots are tame but slow; over-hit shots spray wide |
| **Woodwork** | The post band is a real collision — post radius + ball radius — so the band you see is the band that counts |
| **Visible AI** | The keeper's belief is drawn on the goal mouth as a 3×3 heat map, live: nine boxes, one hot spot, a percentage |
| **Double bluff** | His dive is *sampled from that same distribution*. Read it and bait him — but he learns from every penalty, so the box moves |
| **Shootout** | 5 penalties, streak + best streak saved locally, end-of-game rating, and a post-mortem of how often he read you |

## The AI, in the open

The old keeper guessed. This one keeps a **belief over a 3×3 grid of the goal
mouth**: every penalty you take nudges it, recent shots count for more, and each
difficulty learns faster (12% → 100%). Before you shoot you can read it:

```
AI READ   expects low-left · 38% · 6 shots learned
```

and the 3D overlay paints the whole distribution over the goal, with the box he
is thinking about outlined and a scan line sweeping while you charge. Because his
dive is sampled from exactly that distribution, a taker who notices "he's sure I
go left" can go right — at which point the belief follows him over there.

`LOGIC.gridWeights()` is pure and unit-tested, including the parts that matter:
a 70/30 taker is *predictable* (>60% of the time the top box is right), while a
taker who alternates corners and heights stays under 45% confident.


## Rendering

| | |
|---|---|
| **Renderer 3D** | three.js r160 (vendored UMD), loaded lazily **only if the device has WebGL**. 1 unit = 1 metre |
| **Renderer 2D** | The original canvas renderer, kept as the automatic fallback (`?q=2d`, no WebGL, weak GPU) |

`script.js` asks the active renderer *where the goal is on screen*, so pointer
aiming behaves identically in both. The 3D world is built from real dimensions —
a 7.32 × 2.44 m goal, an 11 m spot, 12 cm lines painted from world coordinates —
and the ball's flight is authored to land **exactly** on the crossing point the
rules decided, so the picture can never contradict the verdict (there is a test
for that).

In 3D you get: a night stadium with a gradient sky and stars, four stands of
instanced crowd (up to ~14 k), scrolling LED boards, floodlight towers with
bloomed halos, a pitch lit by a spotlight pool with real shadows, a net that
dents and shakes itself out when the ball hits it, confetti, a hand-built keeper
rig (shoulders → elbows → gloves, hips → knees → boots) that leans, dives, baits
and lands, and **three camera rigs** — handheld behind the taker, a tracking
flight camera, and a slow-motion broadcast sweep after the verdict — graded by a
composite pass (bloom, filmic vignette, grain, chromatic aberration).

Quality is automatic (GPU cores + screen size) and can be forced:

| URL | |
|---|---|
| `?q=low` | 2.5 k crowd, no shadows, no bloom (SwiftShader / CI) |
| `?q=med` | 7 k crowd, shadows |
| `?q=high` | 14 k crowd, shadows, bloom |
| `?q=2d` | force the flat renderer |

Reduced-motion users get no shake, no confetti and no slow motion — and it never
changes the rules.

## Controls

| Action | Pointer | Keyboard |
|---|---|---|
| Aim | Move mouse / drag finger | ← → ↑ ↓ |
| Charge | Press and hold | Hold `Space` |
| Shoot | Release | Release `Space` |
| Restart | ↻ button | `R` |

Difficulty: **Easy / Normal / Hard / Legend** — keeper reach 0.26 → 0.62 goal
units, reaction 0.34s → 0.11s, anticipation 15% → 58%, learning 12% → 100%.

## Files

```
index.html              HUD / markup
style.css               HUD, AI readout, overlays, responsive layout
world.js                the shared 3D world model (metres, pure, tested)
renderer2d.js           the flat canvas renderer (fallback)
renderer3d.js           the WebGL stadium, camera rigs and post grade
script.js               LOGIC (pure) + audio + game loop + capture driver
vendor/three.min.js     three.js r160 UMD, MIT, unmodified
tests/logic.test.js     headless tests for the rules, the world and the AI
```

Rules, world maths and the AI are all pure functions with no DOM, so they run
under node. `script.js` exports itself when loaded under CommonJS:

```js
const { LOGIC, DIFF, CFG } = require('./script.js');
const W = require('./world.js');
LOGIC.resolveShot({ x: 0.8, y: 0.3 }, 0.68, keeper, 'normal');
W.toMetres(1, 1);            // -> { x: 3.66, y: 2.44 } the real goal
```

## Tests

```bash
node tests/logic.test.js
node --check script.js renderer3d.js renderer2d.js world.js
```

39 assertions: placement, woodwork, the power/accuracy curve, keeper reach and
anticipation scaling, the end-of-game rating, the 3D world model (a GOAL always
crosses inside the real frame, a POST always touches real woodwork the stadium can
clang off, the ball never clips through the grass) and the reader (the belief is a
probability distribution, its top box is what the overlay calls "expects", it
reads a habitual taker and not an unpredictable one).

### Driving the real page headlessly

`script.js` carries a small capture driver — it runs the shipped page, not a
mock, which is how the screenshots and the end-to-end check are produced:

```
index.html#cap=rest            stand on the spot
index.html#cap=flight,11       take a penalty, hold it 11 ticks in
index.html#cap=goal            a guaranteed goal, at the moment it lands
index.html#cap=save            a guaranteed save, mid-keeper
index.html#cap=e2e             play a whole shootout and report the result
```

The result goes to `document.title` and to a `#probe` element:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --enable-unsafe-swiftshader --virtual-time-budget=60000 \
  --screenshot=/tmp/shot.png --window-size=1280,720 \
  'file:///…/index.html?q=med#cap=goal'
```

## Deploy

Static files — GitHub Pages serves `main` / root directly.

## Credits

three.js r160 (`vendor/three.min.js`, MIT, byte-for-byte upstream —
sha256 `170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa`).
Everything else is hand-written for this project.
