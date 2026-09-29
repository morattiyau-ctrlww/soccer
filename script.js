/* =========================================================================
   Penalty Shootout 十二碼大戰  —  script.js  (part 1: utils, config, LOGIC)
   Pure logic lives in the LOGIC block and is exported for unit tests.
   ========================================================================= */
'use strict';

/* ------------------------------- utils ---------------------------------- */
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t){ return a + (b - a) * t; }
function rand(a, b){ return a + Math.random() * (b - a); }
function easeOut(t){ return 1 - Math.pow(1 - t, 3); }
function easeInOut(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

/* ------------------------------ config ---------------------------------- */
var CFG = {
  ROUNDS: 5,
  SWEET: 0.68,          /* ideal power */
  SWEET_WINDOW: 0.12,
  AIM_H: 1.0,           /* 1.0 = crossbar height */
  FLIGHT: 0.62,         /* seconds of ball flight (multiplied by shot speed) */
  REACH_Y: 1.0,

  /* Real geometry, in metres. world.js must agree — there is a test for it.  */
  GOAL_W: 7.32, GOAL_H: 2.44, POST_R: 0.06, BALL_R: 0.11
};
/* The woodwork band is a real collision, not a magic number: it is the post
   radius plus the ball radius, expressed in goal units. A shot counts as off
   the frame exactly when the ball's surface would touch it — so the band you
   see on screen is the band that counts.                                    */
CFG.WOOD = { x: (CFG.POST_R + CFG.BALL_R) / (CFG.GOAL_W / 2),
             y: (CFG.POST_R + CFG.BALL_R) / CFG.GOAL_H };

/* Difficulty. Bigger reach / faster reaction / more anticipation = better
   keeper. reachX is the keeper's horizontal cover in goal units, reachY the
   vertical cover; react = seconds before he commits.                      */
var DIFF = {
  easy:   { react: 0.34, reachX: 0.26, reachY: 0.30, anticipate: 0.15,
            speed: 0.9, learn: 0.12 },
  normal: { react: 0.24, reachX: 0.38, reachY: 0.38, anticipate: 0.30,
            speed: 1.0, learn: 0.34 },
  hard:   { react: 0.16, reachX: 0.50, reachY: 0.45, anticipate: 0.44,
            speed: 1.1, learn: 0.62 },
  legend: { react: 0.11, reachX: 0.62, reachY: 0.52, anticipate: 0.58,
            speed: 1.2, learn: 1.00 }
};

/* ============================== LOGIC ==================================== */
/* Pure functions — no DOM, no audio. Exported for node tests.             */
var LOGIC = (function(){

  /* Placement error. Weak shots are tame but slow; over-hit shots spray.
     The sweet spot (CFG.SWEET ± SWEET_WINDOW) is nearly pinpoint.        */
  function shotError(power, rnd){
    var d = power - CFG.SWEET;
    var wobble;
    if (Math.abs(d) <= CFG.SWEET_WINDOW) wobble = 0.004;
    else if (d < 0) wobble = (-d - CFG.SWEET_WINDOW) * 0.55;   /* tame      */
    else wobble = (d - CFG.SWEET_WINDOW) * 1.35;               /* wild      */
    return (rnd() * 2 - 1) * (wobble + 0.008);
  }

  /* ------------------------------------------------------------------------
     THE READER
     The keeper keeps a belief over a 3x3 grid of the goal mouth — nine little
     boxes he can dive into. Every shot you take nudges that belief, harder
     difficulties learn faster, and the belief is what he commits from. The
     game shows you the belief, so you can bait him and he can learn you.
     ------------------------------------------------------------------------ */
  var ZONES = {
    cols: [-0.68, 0, 0.68],          /* left / centre / right, in goal units */
    rows: [0.14, 0.50, 0.84],        /* low / middle / high                  */
    /* what an unread taker looks like: corners and low shots are where
       penalties actually go, which is the prior he starts from            */
    prior: [
      [0.11, 0.06, 0.10],
      [0.14, 0.09, 0.14],
      [0.10, 0.14, 0.12]
    ]
  };

  function colOf(x){ return x < -0.30 ? 0 : (x > 0.30 ? 2 : 1); }
  function rowOf(y){ return y < 0.34 ? 0 : (y > 0.68 ? 2 : 1); }

  /* The belief, as a normalised 3x3 matrix. Recency-weighted, learning rate
     by difficulty, and it forgets: your last eight penalties only.          */
  function gridWeights(history, diff){
    var d = DIFF[diff] || DIFF.normal;
    var w = [[0,0,0],[0,0,0],[0,0,0]];
    var r, c, sum = 0;
    for (r = 0; r < 3; r++){
      for (c = 0; c < 3; c++){
        w[r][c] = ZONES.prior[r][c];
        sum += w[r][c];
      }
    }
    var n = history ? history.length : 0;
    for (var i = n - 1; i >= 0 && i >= n - 8; i--){
      /* 0.62 per shot: he has a memory, not a grudge — old penalties fade */
      var rec = Math.pow(0.62, n - 1 - i);
      w[rowOf(history[i].y)][colOf(history[i].x)] += (d.learn || 0.3) * rec * 0.5;
    }
    sum = 0;
    for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) sum += w[r][c];
    for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) w[r][c] /= sum;
    return w;
  }

  /* the box he believes in most, with its probability */
  function bestCell(w){
    var br = 1, bc = 1, bp = -1;
    for (var r = 0; r < 3; r++){
      for (var c = 0; c < 3; c++){
        if (w[r][c] > bp){ bp = w[r][c]; br = r; bc = c; }
      }
    }
    return { r: br, c: bc, p: bp, x: ZONES.cols[bc], y: ZONES.rows[br] };
  }

  /* draw a box from the belief — this is the keeper "deciding" */
  function sampleCell(w, rnd){
    var total = 0, r, c;
    for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) total += w[r][c];
    var t = rnd() * total;
    for (r = 0; r < 3; r++){
      for (c = 0; c < 3; c++){
        t -= w[r][c];
        if (t <= 0) return { r: r, c: c };
      }
    }
    return { r: 1, c: 1 };
  }

  /* The keeper commits before he can see the shot (like a real penalty). */
  function keeperPlan(history, diff, rnd){
    rnd = rnd || Math.random;
    var d = DIFF[diff] || DIFF.normal;
    var heat = gridWeights(history, diff);
    var read = rnd() < d.anticipate && history.length > 0;
    var cell = read ? sampleCell(heat, rnd) : sampleCell(ZONES.prior, rnd);
    var dir = cell.c === 0 ? -1 : (cell.c === 2 ? 1 : 0);
    /* the box he chose sets the side; the exact spot inside it is still a dive
       he has to actually make */
    var x = dir === 0 ? rand(-0.12, 0.12) : dir * rand(0.52, 0.80);
    var h = clamp(ZONES.rows[cell.r] + rand(-0.08, 0.08), 0.08, 0.95);
    return { x: x, y: h, dir: dir, height: h, read: read,
             expect: bestCell(heat), heat: heat,
             react: d.react * rand(0.85, 1.2) };
  }

  /* How much goal the keeper covers for a given shot power (goal units).
     One function, so the rules, the 3D keeper and the on-screen "reach" the
     player is shown can never drift apart.                                  */
  function reachAt(diff, power){
    var d = DIFF[diff] || DIFF.normal;
    power = clamp(power, 0, 1);
    /* A hard shot shrinks the keeper's window; a soft one invites a save. */
    var speedFactor = 1.25 - 0.55 * power;
    var slow = power < 0.42 ? 1.30 : 1.0;
    return { x: d.reachX * speedFactor * slow,
             y: d.reachY * CFG.REACH_Y * speedFactor * slow };
  }

  /* Resolve the shot: where it crosses the line, and what happens. */
  function resolveShot(aim, power, keeper, diff, rnd){
    var d = DIFF[diff] || DIFF.normal;
    rnd = rnd || Math.random;
    power = clamp(power, 0, 1);

    var ex = shotError(power, rnd);
    var ey = shotError(power, rnd) * 0.55;
    var x = clamp(aim.x + ex, -1.45, 1.45);
    var y = clamp(aim.y + ey - Math.max(0, power - CFG.SWEET) * 0.10, 0, 1.6);
    var speed = lerp(1.35, 0.72, power);         /* 0..1 flight-time scale  */

    var verdict = 'goal', hit = null;
    var reach = reachAt(diff, power);
    var ax = Math.abs(x), ay = Math.abs(y);

    if (ax > 1.0 || ay > CFG.AIM_H){
      /* Missing the goal: it only counts as woodwork if the ball's surface
         still touches the frame. Beyond that it is simply wide or over.     */
      var onPost = ax > 1.0 && ax - 1.0 <= CFG.WOOD.x;
      var onBar  = ay > CFG.AIM_H && ay - CFG.AIM_H <= CFG.WOOD.y;
      if (onPost || onBar){ verdict = 'post'; hit = onPost ? 'post' : 'bar'; }
      else { verdict = ax > 1.0 ? 'wide' : 'over'; }
    } else {
      var dx = Math.abs(x - keeper.x);
      var dy = Math.abs(y - keeper.y);
      if (dx <= reach.x && dy <= reach.y){
        verdict = 'saved';
        hit = y < 0.35 ? 'low' : (y > 0.95 ? 'high' : 'mid');
      }
    }

    return { x: x, y: y, verdict: verdict, hit: hit, power: power,
             speed: speed, reach: reach,
             accuracy: 1 - (Math.abs(ex) + Math.abs(ey)) / 0.2 };
  }

  function playRound(aim, power, history, diff, rnd){
    var k = keeperPlan(history, diff, rnd);
    var s = resolveShot(aim, power, k, diff, rnd);
    return { shot: s, keeper: k };
  }

  function rating(goals, shots){
    if (!shots) return '—';
    var pct = goals / shots;
    if (goals === shots && shots >= CFG.ROUNDS) return 'PERFECT 完美';
    if (pct >= 0.8) return 'CLINICAL 神射手';
    if (pct >= 0.6) return 'SOLID 穩陣';
    if (pct >= 0.4) return 'SHAKY 一般';
    return 'STICK TO DEFENDING 練多啲';
  }

  return { shotError: shotError, keeperPlan: keeperPlan, reachAt: reachAt,
           gridWeights: gridWeights, bestCell: bestCell, ZONES: ZONES,
           colOf: colOf, rowOf: rowOf,
           resolveShot: resolveShot, playRound: playRound, rating: rating };
})();

if (typeof module !== 'undefined' && module.exports){
  module.exports = { LOGIC: LOGIC, DIFF: DIFF, CFG: CFG };
}
/* ---------------------------- audio engine ------------------------------ */
var Sound = (function(){
  var ctx = null, on = true, crowdNode = null, crowdGain = null;

  function ac(){
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }
  function resume(){ var c = ac(); if (c && c.state === 'suspended') c.resume(); }
  function now(){ return ac().currentTime; }

  function tone(freq, dur, type, vol, slideTo){
    if (!on) return; var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, now());
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now() + dur);
    g.gain.setValueAtTime(0.0001, now());
    g.gain.exponentialRampToValueAtTime(vol || 0.25, now() + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(now() + dur + 0.03);
  }
  function noise(dur, vol, filterHz, q){
    if (!on) return; var c = ac(); if (!c) return;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++){
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = filterHz || 900; f.Q.value = q || 0.8;
    var g = c.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  }
  function crowdStart(){
    if (!on) return; var c = ac(); if (!c || crowdNode) return;
    var len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++){
      last = (last + (Math.random() * 2 - 1) * 0.06) * 0.985; d[i] = last;
    }
    crowdNode = c.createBufferSource(); crowdNode.buffer = buf; crowdNode.loop = true;
    crowdGain = c.createGain(); crowdGain.gain.value = 0.05;
    crowdNode.connect(crowdGain); crowdGain.connect(c.destination); crowdNode.start();
  }
  function crowd(vol, ramp){
    if (!on || !crowdGain) return;
    crowdGain.gain.cancelScheduledValues(now());
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, now());
    crowdGain.gain.linearRampToValueAtTime(vol, now() + (ramp || 0.25));
  }

  return {
    set: function(v){ on = v; if (!on && crowdGain) crowd(0.0, 0.1); },
    enabled: function(){ return on; },
    wake: function(){ resume(); crowdStart(); },
    kick: function(power){
      tone(lerp(120, 70, power), 0.16, 'sine', 0.30, lerp(60, 38, power));
      noise(0.09, 0.20 * lerp(0.7, 1.2, power), 1500, 0.7);
    },
    step: function(){ tone(90, 0.06, 'sine', 0.10, 70); },
    post: function(){ tone(1250, 0.36, 'triangle', 0.26, 620); tone(1900, 0.2, 'sine', 0.14, 900); },
    net: function(){ noise(0.16, 0.16, 2600, 0.5); },
    save: function(){ noise(0.14, 0.22, 500, 0.6); },
    whistle: function(){
      tone(2100, 0.28, 'sine', 0.16, 2350);
      tone(2650, 0.26, 'sine', 0.10, 2850);
    },
    groan: function(){ crowd(0.16, 0.12); tone(320, 0.5, 'sawtooth', 0.06, 150); },
    cheer: function(){
      crowd(0.34, 0.12);
      noise(0.9, 0.16, 800, 0.4);
      setTimeout(function(){ crowd(0.06, 0.9); }, 900);
    },
    charge: function(p){ tone(lerp(700, 1300, p), 0.03, 'square', 0.05); }
  };
})();

/* ------------------------------- DOM refs ------------------------------- */
var D = {};
function grabDom(){
  D.canvas = document.getElementById('pitch');
  D.ctx = D.canvas.getContext('2d');
  D.round = document.getElementById('hud-round');
  D.goals = document.getElementById('hud-goals');
  D.streak = document.getElementById('hud-streak');
  D.best = document.getElementById('hud-best');
  D.shots = document.getElementById('shots');
  D.banner = document.getElementById('banner');
  D.overlay = document.getElementById('overlay');
  D.ovTitle = document.getElementById('ov-title');
  D.ovSub = document.getElementById('ov-sub');
  D.ovStats = document.getElementById('ov-stats');
  D.again = document.getElementById('again');
  D.powerWrap = document.getElementById('power-wrap');
  D.powerFill = document.getElementById('power-fill');
  D.powerLabel = document.getElementById('power-label');
  D.difficulty = document.getElementById('difficulty');
  D.soundBtn = document.getElementById('sound');
  D.restart = document.getElementById('restart');
  D.hint = document.getElementById('hint');
  D.ai = document.getElementById('ai');
  D.aiText = document.getElementById('ai-text');
}

/* -------------------------------- state --------------------------------- */
var S = {
  diff: 'normal',
  phase: 'aim',
  busy: false,
  charging: false,
  power: 0,
  aim: { x: 0, y: 0.34 },
  shotIndex: 0,
  goals: 0,
  streak: 0,
  best: 0,
  readHits: 0,
  history: [],
  results: [],
  plan: null,
  shot: null,
  flight: { t: 0, dur: 0.62 },
  ball: { x: 0, y: 0, sx: 0, sy: 0, r: 9, spin: 0, trail: [] },
  keeper: { x: 0, y: 0.30, t: 0., px: 0, py: 0.30, pose: 'idle' },
  fx: [],
  shake: 0,
  time: 0,
  reduce: false,
  /* the 3D renderer drops to slow motion for the aftermath; the game just
     multiplies its timestep by this, so the rules stay in one place */
  timeScale: 1,
  wait: 0
};

/* ------------------------------- input ---------------------------------- */
function pointerToAim(cx, cy){
  var g = geometry();
  var nx = (cx - g.cx) / (g.goalHalf * 1.28);
  var ny = (g.goalBottomY - cy) / g.goalH;
  /* distance between the ball and the goal line compresses the vertical
     pointer range, so aiming feels the same at any screen size          */
  /* the goal has no gap under it: you can aim along the grass, not below it  */
  S.aim.x = clamp(nx, -1.3, 1.3);
  S.aim.y = clamp(ny, 0, 1.35);
}

function bindInput(){
  var cv = D.canvas;

  /* The pointer listeners live on the window, not on a canvas: that way the
     2D canvas can be switched off when the 3D renderer takes over, and the
     HUD stays clickable without also firing a shot. */
  function isUi(target){
    return !!(target && target.closest &&
              target.closest('.hud, .overlay, .tools, .badge, button, select'));
  }

  function down(e){
    if (isUi(e.target)) return;
    if (S.busy || S.phase === 'over') return;
    Sound.wake();
    pointerToAim(e.clientX, e.clientY);
    S.charging = true; S.phase = 'charging'; S.power = 0;
    D.powerWrap.classList.add('on');
    if (e.pointerId !== undefined && cv.setPointerCapture){
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }
  function move(e){
    pointerToAim(e.clientX, e.clientY);
  }
  function up(){
    if (!S.charging || S.busy) return;
    S.charging = false;
    D.powerWrap.classList.remove('on');
    shootPenalty();
  }

  window.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('contextmenu', function(e){
    if (!isUi(e.target)) e.preventDefault();
  });

  /* keyboard: arrows aim, hold space = power, release = shoot */
  window.addEventListener('keydown', function(e){
    if (S.busy || S.phase === 'over') return;
    var k = e.key;
    if (k === 'ArrowLeft'){ S.aim.x = clamp(S.aim.x - 0.06, -1.3, 1.3); }
    else if (k === 'ArrowRight'){ S.aim.x = clamp(S.aim.x + 0.06, -1.3, 1.3); }
    else if (k === 'ArrowUp'){ S.aim.y = clamp(S.aim.y + 0.06, 0, 1.35); }
    else if (k === 'ArrowDown'){ S.aim.y = clamp(S.aim.y - 0.06, 0, 1.35); }
    else if (k === ' '){
      e.preventDefault();
      if (!S.charging){ Sound.wake(); S.charging = true; S.phase = 'charging';
        S.power = 0; D.powerWrap.classList.add('on'); }
      return;
    } else if (k === 'r' || k === 'R'){ newGame(); return; }
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', function(e){
    if (e.key === ' ' && S.charging && !S.busy){ up(); }
  });
}
/* --------------------------- round / game flow -------------------------- */
function geometry(){
  /* when the stadium is on, ask the camera where the goal is on screen, so
     the pointer maps onto the 3D goal exactly */
  if (Renderer3D && Renderer3D.active()) return Renderer3D.geometry();
  var W = D.canvas.clientWidth, H = D.canvas.clientHeight;
  var goalHalf = Math.min(W * 0.27, H * 0.46);
  var goalBottomY = H * 0.70;
  var goalH = goalHalf * 0.78;                 /* posts are tall + narrow   */
  return { W: W, H: H, cx: W / 2, goalHalf: goalHalf,
           goalBottomY: goalBottomY, goalH: goalH,
           goalTopY: goalBottomY - goalH,
           spotY: H * 0.93, spotR: Math.max(8, Math.min(W, H) * 0.021),
           ballRestY: H * 0.93 -
             Math.max(8, Math.min(W, H) * 0.021) * 1.75 };
}

function updatePower(dt){
  if (!S.charging) return;
  var before = S.power;
  S.power = clamp(S.power + dt * 1.35, 0, 1);
  D.powerFill.style.width = (S.power * 100).toFixed(1) + '%';
  var inSweet = Math.abs(S.power - CFG.SWEET) < CFG.SWEET_WINDOW;
  D.powerLabel.textContent = inSweet ? 'SWEET SPOT!' : 'POWER';
  D.powerLabel.style.color = inSweet ? 'var(--brand)' : '';
  if (Math.floor(before * 12) !== Math.floor(S.power * 12)) Sound.charge(S.power);
}

function shootPenalty(){
  if (S.busy) return;
  S.busy = true;
  S.phase = 'flying';

  var power = Math.max(S.power, 0.12);
  var res = LOGIC.playRound(S.aim, power, S.history, S.diff, Math.random);
  S.plan = res.keeper; S.shot = res.shot;
  S.history.push({ x: res.shot.x, y: res.shot.y, verdict: res.shot.verdict });
  if (S.history.length > 12) S.history.shift();

  /* flight timing: harder shots are quicker */
  S.flight.t = 0;
  S.flight.done = false;
  S.flight.dur = CFG.FLIGHT * res.shot.speed;
  S.flight.curve = (Math.random() * 2 - 1) * 0.55;

  var g = geometry();
  S.ball.trail.length = 0;
  S.ball.x = g.cx; S.ball.y = g.ballRestY; S.ball.spin = 0;
  S.keeper.pose = 'idle'; S.keeper.x = 0; S.keeper.y = 0.30;
  S.keeper.t = 0;

  Sound.kick(power);
  S.shake = (S.reduce ? 0 : 7) * power;
}

function keeperReact(){
  var k = S.plan;
  S.keeper.pose = 'diving';
  S.keeper.targetX = k.x;
  S.keeper.targetY = k.y;
}

function endShot(){
  var s = S.shot, v = s.verdict;
  var g = geometry();
  var label = { goal: 'GOAL!', saved: 'SAVED', post: 'POST!',
                wide: 'WIDE', over: 'OVER' }[v];
  var cn = { goal: '入球', saved: '被撲出', post: '中柱', wide: '射斜', over: '射高' }[v];
  var cls = (v === 'goal') ? 'goal' : (v === 'saved') ? 'save'
          : (v === 'post') ? 'post' : 'out';

  S.results.push(v);
  S.shotIndex++;
  var scored = (v === 'goal');
  if (scored){
    S.goals++;
    S.streak++;
    S.best = Math.max(S.best, S.streak);
    Sound.net(); Sound.cheer();
    burst(netImpactPoint(), 46, ['#38ef7d', '#ffd166', '#8fd3ff', '#ffffff']);
    var ip = netImpactPoint();
    S.fx.push({ kind: 'netRipple', t: 0, px: ip.x, py: ip.y });
  } else {
    S.streak = 0;
    if (v === 'post'){ Sound.post(); burst(netImpactPoint(), 18, ['#ffd166', '#ffffff']); }
    else if (v === 'saved'){ Sound.save(); Sound.groan(); }
    else { Sound.groan(); }
  }
  if (!S.reduce && (v === 'post' || v === 'saved')) S.shake = 5;

  showBanner(label, cn, cls);
  renderShots();
  updateHud(true);
  if (v === 'saved' && S.plan && S.plan.read) S.readHits++;
  updateAiHud();

  /* The round does not advance on a wall clock — it advances on the
     simulation, so the slow-motion aftermath and any fast-forward stay
     coherent with everything the rules decided. */
  S.phase = 'result';
  S.wait = S.reduce ? 0.7 : 1.0;
}

function nextRound(){
  S.busy = false;
  if (S.shotIndex >= CFG.ROUNDS){ finishGame(); }
  else {
    S.phase = 'aim'; S.shot = null; S.plan = null;
    S.keeper.pose = 'idle'; S.best = Math.max(S.best, S.streak);
    if (Renderer3D && Renderer3D.active()) Renderer3D.reset();
    saveBest();
  }
}

function netImpactPoint(){
  var g = geometry();
  var x = g.cx + S.shot.x * g.goalHalf;
  var y = g.goalBottomY - S.shot.y * g.goalH;
  return { x: clamp(x, g.cx - g.goalHalf, g.cx + g.goalHalf),
           y: clamp(y, g.goalTopY, g.goalBottomY) };
}

/* ------------------------------ helpers --------------------------------- */
function showBanner(text, cn, cls){
  D.banner.textContent = text;
  var small = document.createElement('small');
  small.textContent = cn; D.banner.appendChild(small);
  D.banner.className = 'banner';
  void D.banner.offsetWidth;                    /* restart the animation   */
  D.banner.classList.add('show', cls);
}

function burst(p, n, colors){
  if (S.reduce) return;
  for (var i = 0; i < n; i++){
    S.fx.push({
      kind: 'spark', x: p.x, y: p.y,
      vx: (Math.random() * 2 - 1) * 260,
      vy: -Math.random() * 300 - 40,
      life: rand(0.5, 1.1), t: 0,
      col: pick(colors), s: rand(2, 5)
    });
  }
}

function updateHud(pump){
  D.round.textContent = Math.min(S.shotIndex + 1, CFG.ROUNDS) + '/' + CFG.ROUNDS;
  D.goals.textContent = S.goals;
  D.streak.textContent = S.streak;
  D.best.textContent = Math.max(S.best, S.streak);
  if (pump){
    [D.goals.parentNode, D.streak.parentNode].forEach(function(el){
      el.classList.remove('pump'); void el.offsetWidth; el.classList.add('pump');
    });
  }
}

/* ------------------------------ the AI read ------------------------------
   The keeper's belief, in words. It is the same distribution the 3D overlay
   draws and the same one his dive is sampled from, so the readout can never
   flatter him: what you read on screen is what he is actually thinking.     */
var AI_COLS = ['left', 'centre', 'right'];
var AI_ROWS = ['low', 'middle', 'high'];
var aiLast = '';

function aiInfo(){
  var w = LOGIC.gridWeights(S.history, S.diff);
  var b = LOGIC.bestCell(w);
  return { heat: w, best: b,
           where: AI_ROWS[b.r] + '-' + AI_COLS[b.c],
           pct: Math.round(b.p * 100) };
}

function updateAiHud(){
  if (!D.aiText) return;
  var info = aiInfo();
  var txt, hot = info.best.p > 0.30;
  if (S.phase === 'result' && S.shot && S.plan){
    var v = S.shot.verdict;
    var how = S.plan.read ? 'he read you' : 'he guessed';
    if (v === 'goal') txt = 'you beat him — ' + how;
    else if (v === 'saved') txt = 'READ YOU — saved ' + info.where;
    else txt = v + ' — ' + how;
  } else if (S.phase === 'over'){
    txt = 'full time · he read you ' + S.readHits + '/' + S.results.length;
  } else if (S.history.length === 0){
    txt = 'expects ' + info.where + ' from an unknown taker';
  } else {
    txt = 'expects ' + info.where + ' · ' + info.pct + '% · ' +
          S.history.length + ' shot' + (S.history.length === 1 ? '' : 's') + ' learned';
  }
  if (txt !== aiLast){
    aiLast = txt;
    D.aiText.textContent = txt;
    if (D.ai) D.ai.className = 'ai' + (hot ? ' hot' : '');
  }
}

function renderShots(){
  var html = '';
  for (var i = 0; i < CFG.ROUNDS; i++){
    var v = S.results[i];
    var cls = v ? (v === 'goal' ? 'goal' : 'miss') : '';
    if (i === S.results.length && !v) cls += ' now';
    html += '<i class="' + cls + '"></i>';
  }
  D.shots.innerHTML = html;
}

function saveBest(){
  try { localStorage.setItem('penalty_best_streak', String(S.best)); } catch (e) {}
}
function loadBest(){
  try { var v = localStorage.getItem('penalty_best_streak');
        if (v) S.best = parseInt(v, 10) || 0; } catch (e) {}
}

function finishGame(){
  S.phase = 'over';
  Sound.whistle();
  saveBest();
  var r = LOGIC.rating(S.goals, S.results.length || CFG.ROUNDS);
  D.ovTitle.textContent = S.goals + ' / ' + CFG.ROUNDS + ' — ' + r;
  D.ovSub.textContent = S.goals === CFG.ROUNDS
    ? 'Perfect shootout! 完美十二碼！'
    : (S.goals >= 4 ? 'Great nerves. 好穩！'
      : (S.goals >= 3 ? 'Not bad — the keeper read you. 唔錯，但守門員睇穿你。'
        : 'The keeper won this one. 守門員贏咗。'));
  D.ovStats.innerHTML =
    '<div><span>Goals</span><b>' + S.goals + '</b></div>' +
    '<div><span>Best streak</span><b>' + S.best + '</b></div>' +
    '<div><span>Saved</span><b>' +
      S.results.filter(function(v){ return v === 'saved'; }).length + '</b></div>';
  D.overlay.classList.add('show');
}

function newGame(){
  S.shotIndex = 0; S.goals = 0; S.streak = 0;
  S.results = []; S.history = []; S.fx = [];
  S.readHits = 0; aiLast = '';
  S.busy = false; S.charging = false; S.power = 0;
  S.phase = 'aim'; S.shot = null; S.plan = null;
  S.flight.t = 0; S.flight.done = false;
  S.wait = 0; S.timeScale = 1;
  S.keeper.pose = 'idle'; S.keeper.x = 0; S.keeper.y = 0.30;
  S.aim = { x: 0, y: 0.34 };
  var g0 = geometry();
  S.ball.x = g0.cx; S.ball.y = g0.ballRestY;
  S.ball.trail.length = 0;
  if (Renderer3D && Renderer3D.active()) Renderer3D.reset();
  D.overlay.classList.remove('show');
  D.banner.className = 'banner';
  D.powerWrap.classList.remove('on');
  renderShots(); updateHud(false);
}
/* ------------------------------ simulation ------------------------------ */
function updateFlight(dt){
  var f = S.flight;
  if (f.t >= 1) return;
  f.t = clamp(f.t + dt / Math.max(f.dur, 0.05), 0, 1);
  var t = easeInOut(f.t);
  var g = geometry();
  var x0 = g.cx, y0 = g.ballRestY;
  var x1 = g.cx + S.shot.x * g.goalHalf;
  var y1 = g.goalBottomY - S.shot.y * g.goalH;
  var arc = lerp(44, 16, clamp(S.shot.power, 0, 1));
  S.ball.x = lerp(x0, x1, t) + Math.sin(Math.PI * t) * S.flight.curve * 12;
  S.ball.y = lerp(y0, y1, t) - Math.sin(Math.PI * t) * arc;
  S.ball.r = lerp(g.spotR, g.spotR * 0.82, t);
  S.ball.spin += dt * (7 + S.shot.power * 12);
  S.ball.trail.push({ x: S.ball.x, y: S.ball.y });
  if (S.ball.trail.length > 16) S.ball.trail.shift();
  if (f.t >= 1 && !f.done){ f.done = true; endShot(); }
}

function updateKeeper(dt){
  var k = S.plan, g = geometry();
  if (!k){ S.keeper.px = 0; S.keeper.py = 0.30; S.keeper.t = 0; return; }
  var delay = k.react / Math.max(S.flight.dur, 0.05);
  var t = clamp((S.flight.t - delay) / Math.max(1 - delay, 0.15), 0, 1);
  if (t > 0 && S.keeper.pose === 'idle') keeperReact();
  var p = easeOut(t);
  S.keeper.t = p;
  S.keeper.px = lerp(0, k.x, p) * g.goalHalf;
  S.keeper.py = lerp(0.30, k.y, p);
}

function updateFx(dt){
  for (var i = S.fx.length - 1; i >= 0; i--){
    var f = S.fx[i];
    f.t += dt;
    if (f.kind === 'spark'){
      f.vy += 620 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
    }
    if (f.t >= (f.life || 0.9)) S.fx.splice(i, 1);
  }
  if (S.shake > 0){ S.shake = Math.max(0, S.shake - dt * 26); }
}

/* -------------------------------- resize -------------------------------- */
function resize(){
  var cv = D.canvas;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  D.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (Renderer2D) Renderer2D.resize();
  if (Renderer3D) Renderer3D.resize();
}

/* --------------------------------- loop --------------------------------- */
var last = 0;
/* captures and tests hold the frame exactly where they left it */
var frozen = false;

function frame(ts){
  var raw = Math.min(0.033, (ts - last) / 1000 || 0.016);
  last = ts;
  /* S.timeScale is the slow-motion lever: 1 normally, lower for the aftermath */
  var dt = raw * (S.timeScale || 1);

  if (!frozen){
    S.time += dt;

    updatePower(dt);
    if (S.phase === 'flying'){ updateFlight(dt); updateKeeper(dt); }
    updateFx(dt);
    updateAiHud();

    /* the round advances on the simulation clock, not a wall clock */
    if (S.wait > 0){
      S.wait -= dt;
      if (S.wait <= 0){ S.wait = 0; nextRound(); }
    }
  }

  if (Renderer3D && Renderer3D.active()) Renderer3D.render(frozen ? 0 : dt);
  else Renderer2D.render(geometry());

  requestAnimationFrame(frame);
}
/* ------------------------- test / capture hooks --------------------------
   A tiny driver so the shipped page can be exercised headlessly: it is how the
   screenshots and the end-to-end run in the README are produced. Modes:
     #cap=rest          stand still on the spot
     #cap=flight,N      take a penalty and fast-forward N simulation ticks
     #cap=outcome       take a penalty and stop just after the verdict
     #cap=e2e           play a whole shootout and report the result
   ------------------------------------------------------------------------ */
function stepSim(n, dt){
  dt = dt || 1 / 60;
  for (var i = 0; i < n; i++){
    updatePower(dt);
    if (S.phase === 'flying'){ updateFlight(dt); updateKeeper(dt); }
    updateFx(dt);
    if (S.wait > 0){
      S.wait -= dt;
      if (S.wait <= 0){ S.wait = 0; nextRound(); }
    }
  }
}

/* a scripted shot for captures: keep trying until the verdict is the one the
   shot is meant to show, so a "goal" screenshot is always a goal */
function scriptedShot(want){
  for (var i = 0; i < 14; i++){
    S.aim = { x: (i % 2 ? -1 : 1) * (i < 4 ? 0.86 : 0.62),
              y: 0.28 + (i % 3) * 0.06 };
    S.power = CFG.SWEET;
    shootPenalty();
    if (!want || S.shot.verdict === want) return S.shot;
    S.busy = false; S.phase = 'aim'; S.wait = 0;
    S.shot = null; S.plan = null;
    S.history.pop();
  }
  return S.shot;
}

function probe(){
  return {
    ready3d: !!(Renderer3D && Renderer3D.active()),
    dead3d: !!(Renderer3D && Renderer3D.dead()),
    phase: S.phase, round: S.shotIndex + 1, goals: S.goals,
    streak: S.streak, busy: S.busy, wait: +S.wait.toFixed(2),
    scale: S.timeScale, power: +S.power.toFixed(3),
    aim: { x: +S.aim.x.toFixed(2), y: +S.aim.y.toFixed(2) },
    verdict: S.shot ? S.shot.verdict : null,
    results: S.results.slice(),
    overlay: D.overlay.classList.contains('show'),
    title: D.ovTitle.textContent,
    three: typeof window.THREE !== 'undefined',
    err3d: window.__err3d || null,
    r3: (Renderer3D && Renderer3D.active()) ? Renderer3D.state() : null
  };
}

function report(tag){
  var txt = tag + ' ' + JSON.stringify(probe());
  document.title = txt;
  var d = document.getElementById('probe');
  if (!d){
    d = document.createElement('div');
    d.id = 'probe';
    d.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;' +
      'background:#fff;color:#000;font:11px monospace;padding:4px;max-width:96vw';
    document.body.appendChild(d);
  }
  d.textContent = txt;
}

/* wait for the stadium to be up (or for it to give up) before driving */
function whenStadium(cb, capMs){
  var started = Date.now();
  capMs = capMs || 12000;
  (function poll(){
    var state = !Renderer3D ? 'dead'
              : Renderer3D.active() ? 'ready'
              : Renderer3D.dead() ? 'dead' : 'loading';
    if (state !== 'loading' || Date.now() - started > capMs) cb(state);
    else setTimeout(poll, 50);
  })();
}

function capture(){
  var m = /^cap(?:=([a-z0-9]+)(?:,(-?\d+))?)?$/.exec((location.hash || '').replace(/^#/, ''));
  if (!m) return;
  var mode = m[1] || 'rest';
  var arg = parseInt(m[2] || '12', 10);

  whenStadium(function(state){
    report('CAP ' + mode + ' [' + state + ']');
    if (mode === 'rest'){ setTimeout(function(){ report('CAP rest [' + state + ']'); }, 400); }
  });

  if (mode === 'e2e'){
    whenStadium(function(){
      var fired = 0;
      /* aim somewhere different every time, like a real shootout */
      var spots = [{ x: 0.86, y: 0.30 }, { x: -0.82, y: 0.55 },
                   { x: 0.55, y: 0.92 }, { x: -0.60, y: 0.22 },
                   { x: 0.10, y: 0.45 }];
      var iv = setInterval(function(){
        if (fired >= CFG.ROUNDS){
          if (S.phase === 'over'){
            clearInterval(iv);
            report('CAP e2e done');
            frozen = true;
            return;
          }
          stepSim(30);
          return;
        }
        if (!S.busy){
          S.aim = spots[fired % spots.length];
          S.power = CFG.SWEET;
          shootPenalty();
          fired++;
        }
        stepSim(40);
      }, 25);
    });
    return;
  }
  if (mode === 'rest') return;

  whenStadium(function(){
    if (mode === 'goal' || mode === 'save'){
      scriptedShot(mode === 'goal' ? 'goal' : 'saved');
      var guard = 0;
      while (S.phase !== 'result' && guard++ < 400) stepSim(1);
      stepSim(14);
    } else if (mode === 'flight' || mode === 'outcome'){
      scriptedShot('goal');
      if (mode === 'outcome'){
        var g2 = 0;
        while (S.phase !== 'result' && g2++ < 400) stepSim(1);
        stepSim(14);
      } else {
        stepSim(Math.abs(arg));
      }
    }
    report('CAP ' + mode);
    /* pin this exact frame: the screenshot is taken long after this runs, so
       let the renderer catch its animations up first, then hold everything */
    if (Renderer3D && Renderer3D.active()){
      var spins = (mode === 'flight') ? Math.abs(arg)
                : (mode === 'goal' || mode === 'save' || mode === 'outcome') ? 45
                : 28;
      for (var t = 0; t < spins; t++) Renderer3D.tick(1 / 60);
    }
    frozen = true;
    report('CAP ' + mode);
  });
}

/* --------------------------------- init --------------------------------- */
function init(){
  grabDom();
  S.reduce = window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  resize();
  loadBest();
  newGame();
  bindInput();

  /* any failure anywhere lands in the probe, which is what the headless
     captures read — a silent black screen is the one outcome we never want */
  window.addEventListener('error', function(e){
    if (!window.__err3d){
      window.__err3d = String(e.message) + ' @' +
        String(e.filename || '').split('/').pop() + ':' + e.lineno;
    }
  });
  bootStadium();

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function(){ last = 0; });

  D.difficulty.addEventListener('change', function(){
    S.diff = D.difficulty.value; newGame();
  });
  D.soundBtn.addEventListener('click', function(){
    var on = !Sound.enabled();
    Sound.set(on);
    if (on) Sound.wake();
    D.soundBtn.textContent = on ? '🔊' : '🔇';
    D.soundBtn.setAttribute('aria-pressed', String(on));
  });
  D.restart.addEventListener('click', function(){ Sound.wake(); newGame(); });
  D.again.addEventListener('click', function(){ Sound.wake(); newGame(); });

  requestAnimationFrame(frame);

  /* dev/CI driver, documented in the README */
  try {
    window.PENALTY = { S: S, LOGIC: LOGIC, CFG: CFG, DIFF: DIFF,
                       probe: probe, stepSim: stepSim, scriptedShot: scriptedShot,
                       freeze: function(on){ frozen = !!on; },
                       renderer2d: Renderer2D, renderer3d: Renderer3D };
  } catch (e){}
  capture();
}

/* Bring the stadium in when it is ready. The flat renderer covers the load, and
   if anything at all goes wrong the game simply stays 2D. */
function bootStadium(){
  if (!Renderer3D || Renderer3D.dead()) return;
  if (/\bq=2d\b/.test((location.search || '') + (location.hash || ''))) return;
  var splash = document.getElementById('splash');
  if (splash) splash.classList.add('on');
  Renderer3D.loadThree(function(ok){
    var built = false;
    if (ok){
      try { built = Renderer3D.init(); }
      catch (err){
        built = false;
        window.__err3d = String((err && err.stack) || err);
      }
    } else {
      window.__err3d = 'three.js failed to load';
    }
    if (built){
      D.canvas.style.display = 'none';
      var stage = document.getElementById('stage');
      if (stage) stage.classList.add('is3d');
      resize();
    }
    if (splash) splash.classList.remove('on');
  });
}

if (typeof document !== 'undefined' && document.getElementById){
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
}
