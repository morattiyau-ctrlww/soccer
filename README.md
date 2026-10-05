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
| **Catch or parry** | Where the ball meets him decides how he stops it: a firm hand holds it, a fingertip pushes it clear — and the rebound is computed from the contact |

## The keeper

He is a jointed rig in real anthropometry for a 1.90 m athlete — tapered limbs
rather than boxes, deltoids, a number on his back, knee pads, socks with a cuff,
and cleats with a sole and studs — and his gloves have fingers that actually
close, because a catch has to *hold* the ball rather than stand next to it.

He is driven by a **named state machine** (`WORLD.keeperState`), so the WebGL rig,
the flat fallback and the readout can never disagree about what he is doing:

| State | When | What you see |
|---|---|---|
| `idle` | you are over the ball | weight bouncing, gloves up, shuffling along his line |
| `scan` | you charge power | he leans with **your aim** and crouches into **your power** |
| `dive_low` `dive_mid` `dive_high` | the ball is travelling | three keys — wind-up, extension, land — per side, with the trailing leg straightening |
| `catch` | he got a firm hand to it | the fingers close, and the ball is **parented to the glove** |
| `deflect` | he only got fingertips | a straight arm punching the ball away |
| `conceded` | he was beaten | a slump and a head drop on a goal, or turning to watch it go past |

The dive is keyframed with per-segment easing (explosive extension, settling
landing) and every channel is smoothed on its way to its target, so states
cross-fade instead of snapping.

## Catch, parry, and what the net does

The rules decide the outcome; the physics decides the picture.

- **A goal** keeps the velocity the ball actually had at the line and becomes a
  free body. It reaches the mesh, the mesh strips its pace (`rest 0.07`) and
  holds it, and the ball drops and settles **inside the pocket**. There is a test
  that a scored ball always reaches the net, never passes through it, never ends
  up in front of the line, and never stops dead in mid-air.
- **A catch** parents the ball to the glove: `ball.x = glove.x`, read straight
  off the rig's world matrix, with the fingers closing around it. The capture
  probe measures the distance — it is 0.070 m, exactly the cup offset.
- **A parry** is a real bounce: the palm faces the taker, so the rebound is
  computed from the contact point and always leaves *away* from the goal line. A
  fingertip at full stretch loops it over the crossbar. A parried ball can never
  end up in the net, and there is a test for that too — 400 parries, simulated.

| Verdict | What the ball does |
|---|---|
| GOAL | flies on, hits the mesh, the net ripples where it hit, the ball drops into the pocket |
| POST / BAR | the woodwork throws it back out and across, then the grass takes over |
| SAVED (catch) | held in the glove, the fingers closing |
| SAVED (parry) | deflects off the contact, loops away, lands and rolls |
| WIDE / OVER | carries on past the frame and lands behind the line |

## Sound

One graph, three buses and a limiter on the end, because a shootout fires several
sounds at the same instant and the old build wired every voice straight to the
output, where they clipped:

```
voice -> bus gain -> glue compressor -> limiter -> master -> output
                            `-------- crowd duck
```

| | |
|---|---|
| **Kick** | a low body thump with a downward pitch bend, a 40 ms leather click, and a low-passed weight layer |
| **Net** | pink noise sweeping 1900 → 420 Hz with a 34 Hz flutter: mesh stretching, not a hiss |
| **Save** | leather on glove — a 5 ms high-passed transient, a palm body, a soft thump |
| **Parry** | the same slap but drier and shorter, with a wooden tock: a fist on a ball, not a hold |
| **Post** | three inharmonic partials and a band-limited clang |
| **Whistle** | two near partials with a 24 Hz warble (the pea) plus band-limited breath |
| **Cheer / groan** | a looped pink crowd bed with a roar band the swell rises through, plus scattered clap transients |

Every noise voice is band-limited (180 Hz – 5.2 kHz) and plays off one pre-baked
buffer instead of allocating a fresh white-noise burst per call, envelopes start
from silence linearly and decay exponentially (so nothing clicks), the voice count
is capped, and muting ramps rather than cuts. The mix spec is plain data
(`AUDIO`), so the tests check the headroom without needing a browser:

```
node tests/logic.test.js      # 82 assertions, including the mix
```


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
dents where the ball struck it and shakes itself out before holding the ball in
the pocket, confetti, an anthropometric keeper rig with closing gloves that
leans, dives, catches, parries and slumps, and **three camera rigs** — handheld
behind the taker, a tracking flight camera, and a slow-motion broadcast sweep
after the verdict — graded by a composite pass (bloom, filmic vignette, grain,
chromatic aberration).

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

82 assertions: placement, woodwork, the power/accuracy curve, keeper reach and
anticipation scaling, the end-of-game rating, the 3D world model (a GOAL always
crosses inside the real frame, a POST always touches real woodwork the stadium can
clang off, the ball never clips through the grass) and the reader (the belief is a
probability distribution, its top box is what the overlay calls "expects", it
reads a habitual taker and not an unpredictable one).

The keeper, the net and the mix are covered the same way:

- every state the brief names exists, and `dive_low_left` / `dive_high_right` /
  the rest are derived from the same plan the rules scored against
- a save is always a catch or a parry and nothing else, a central contact is held
  and a fingertip is not, and a rocket is harder to hold than a pass-back
- 400 simulated parries never end up in the net, and a tip at full stretch clears
  the crossbar
- 300 scored shots all reach the mesh, none pass through it, all settle on the
  grass inside the pocket and none stop dead in mid-air
- the mix: no voice peak above 1, a real limiter, a bus order that puts the crowd
  under the effects, band-limited noise, a bounded voice count — and every voice
  is a no-op rather than a crash when there is no audio device at all

### Driving the real page headlessly

`script.js` carries a small capture driver — it runs the shipped page, not a
mock, which is how the screenshots and the end-to-end checks are produced:

```
index.html#cap=rest            stand on the spot
index.html#cap=flight,11       take a penalty, hold it 11 ticks in
index.html#cap=goal            a guaranteed goal, at the moment it lands
index.html#cap=save            a guaranteed save, either kind
index.html#cap=catch           a guaranteed clean catch, held in the glove
index.html#cap=parry           a guaranteed deflection, ball flying clear
index.html#cap=audio           build the audio graph and fire everything at once
index.html#cap=e2e             play a whole shootout and report the result
```

The probe reports what the *physics* did, not just what the rules said — the
ball's position and velocity, whether it is inside the net by the world model's
own test, where both gloves are, and whether a held ball is on one of them.

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
