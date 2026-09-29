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
  REACH_Y: 1.0
};

/* Difficulty. Bigger reach / faster reaction / more anticipation = better
   keeper. reachX is the keeper's horizontal cover in goal units, reachY the
   vertical cover; react = seconds before he commits.                      */
var DIFF = {
  easy:   { react: 0.34, reachX: 0.26, reachY: 0.30, anticipate: 0.15, speed: 0.9 },
  normal: { react: 0.24, reachX: 0.38, reachY: 0.38, anticipate: 0.30, speed: 1.0 },
  hard:   { react: 0.16, reachX: 0.50, reachY: 0.45, anticipate: 0.44, speed: 1.1 },
  legend: { react: 0.11, reachX: 0.62, reachY: 0.52, anticipate: 0.58, speed: 1.2 }
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

  /* The keeper commits before he can see the shot (like a real penalty). */
  function keeperPlan(history, diff, rnd){
    rnd = rnd || Math.random;
    var d = DIFF[diff] || DIFF.normal;
    var read = rnd() < d.anticipate && history.length > 0;
    var dir;
    if (read){
      /* weight the taker's last four shots to find a tell */
      var sum = 0, w = 1;
      for (var i = history.length - 1; i >= 0 && i >= history.length - 4; i--){
        sum += history[i].x * w; w *= 0.7;
      }
      dir = Math.abs(sum) < 0.15 ? pick([-1, 0, 1]) : (sum > 0 ? 1 : -1);
    } else {
      dir = pick([-1, 0, 1]);
    }
    /* keepers guess low more often than high */
    var heightPlans = d.reachY > 0.4 ? [0.10, 0.30, 0.62, 0.85]
                                     : [0.12, 0.34, 0.70];
    var h = pick(heightPlans);
    var x = dir === 0 ? rand(-0.12, 0.12) : dir * rand(0.52, 0.80);
    return { x: x, y: h, dir: dir, height: h, read: read,
             react: d.react * rand(0.85, 1.2) };
  }

  /* Resolve the shot: where it crosses the line, and what happens. */
  function resolveShot(aim, power, keeper, diff, rnd){
    var d = DIFF[diff] || DIFF.normal;
    rnd = rnd || Math.random;
    power = clamp(power, 0, 1);

    var ex = shotError(power, rnd);
    var ey = shotError(power, rnd) * 0.55;
    var x = clamp(aim.x + ex, -1.45, 1.45);
    var y = clamp(aim.y + ey - Math.max(0, power - CFG.SWEET) * 0.10, -0.2, 1.6);
    var speed = lerp(1.35, 0.72, power);         /* 0..1 flight-time scale  */

    var verdict = 'goal', hit = null;

    /* woodwork */
    var postHit = Math.abs(Math.abs(x) - 1.0) <= 0.075;
    var barHit = Math.abs(Math.abs(y) - CFG.AIM_H) <= 0.075;
    if (Math.abs(x) > 1.0 && postHit){ verdict = 'post'; hit = 'post'; }
    else if (Math.abs(y) > CFG.AIM_H && barHit){ verdict = 'post'; hit = 'bar'; }
    else if (Math.abs(x) > 1.06){ verdict = 'wide'; }
    else if (Math.abs(y) > CFG.AIM_H){ verdict = 'over'; }
    else {
      /* A hard shot shrinks the keeper's window; a soft one invites a save. */
      var speedFactor = 1.25 - 0.55 * power;
      var slow = power < 0.42 ? 1.30 : 1.0;
      var rx = d.reachX * speedFactor * slow;
      var ry = d.reachY * CFG.REACH_Y * speedFactor * slow;
      var dx = Math.abs(x - keeper.x);
      var dy = Math.abs(y - keeper.y);
      if (dx <= rx && dy <= ry){
        verdict = 'saved';
        hit = y < 0.35 ? 'low' : (y > 0.95 ? 'high' : 'mid');
      }
    }

    return { x: x, y: y, verdict: verdict, hit: hit, power: power,
             speed: speed,
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

  return { shotError: shotError, keeperPlan: keeperPlan,
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
  reduce: false
};

/* ------------------------------- input ---------------------------------- */
function pointerToAim(cx, cy){
  var g = geometry();
  var nx = (cx - g.cx) / (g.goalHalf * 1.28);
  var ny = (g.goalBottomY - cy) / g.goalH;
  /* distance between the ball and the goal line compresses the vertical
     pointer range, so aiming feels the same at any screen size          */
  S.aim.x = clamp(nx, -1.3, 1.3);
  S.aim.y = clamp(ny, -0.15, 1.35);
}

function bindInput(){
  var cv = D.canvas;

  function down(e){
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
    if (S.busy) return;
    pointerToAim(e.clientX, e.clientY);
  }
  function up(){
    if (!S.charging || S.busy) return;
    S.charging = false;
    D.powerWrap.classList.remove('on');
    shootPenalty();
  }

  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  /* keyboard: arrows aim, hold space = power, release = shoot */
  window.addEventListener('keydown', function(e){
    if (S.busy || S.phase === 'over') return;
    var k = e.key;
    if (k === 'ArrowLeft'){ S.aim.x = clamp(S.aim.x - 0.06, -1.3, 1.3); }
    else if (k === 'ArrowRight'){ S.aim.x = clamp(S.aim.x + 0.06, -1.3, 1.3); }
    else if (k === 'ArrowUp'){ S.aim.y = clamp(S.aim.y + 0.06, -0.15, 1.35); }
    else if (k === 'ArrowDown'){ S.aim.y = clamp(S.aim.y - 0.06, -0.15, 1.35); }
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

  setTimeout(function(){
    S.busy = false;
    if (S.shotIndex >= CFG.ROUNDS){ finishGame(); }
    else { S.phase = 'aim'; S.shot = null; S.plan = null;
           S.keeper.pose = 'idle'; S.best = Math.max(S.best, S.streak);
           saveBest(); }
  }, S.reduce ? 620 : 1150);
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
  S.busy = false; S.charging = false; S.power = 0;
  S.phase = 'aim'; S.shot = null; S.plan = null;
  S.flight.t = 0; S.flight.done = false;
  S.keeper.pose = 'idle'; S.keeper.x = 0; S.keeper.y = 0.30;
  S.aim = { x: 0, y: 0.34 };
  var g0 = geometry();
  S.ball.x = g0.cx; S.ball.y = g0.ballRestY;
  S.ball.trail.length = 0;
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
var CROWD = [];
function resize(){
  var cv = D.canvas;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  D.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CROWD.length = 0;
  var n = clamp(Math.round(w / 9), 60, 190);
  for (var i = 0; i < n; i++){
    CROWD.push({ x: Math.random(), y: Math.random(), ph: Math.random() * 6.28,
                 s: rand(1.6, 3.4), hot: Math.random() < 0.18 });
  }
}

/* ------------------------------ background ------------------------------ */
function drawSky(g){
  var c = D.ctx;
  var sky = c.createLinearGradient(0, 0, 0, g.goalBottomY * 1.1);
  sky.addColorStop(0, '#04060c');
  sky.addColorStop(0.55, '#0a1626');
  sky.addColorStop(1, '#123a2a');
  c.fillStyle = sky;
  c.fillRect(0, 0, g.W, g.goalBottomY * 1.15);

  /* floodlights */
  [[0.12, 0.10], [0.88, 0.10], [0.3, 0.05], [0.7, 0.05]].forEach(function(l){
    var x = l[0] * g.W, y = l[1] * g.H;
    var rad = c.createRadialGradient(x, y, 0, x, y, g.W * 0.28);
    rad.addColorStop(0, 'rgba(190,225,255,.34)');
    rad.addColorStop(0.4, 'rgba(150,200,255,.10)');
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rad; c.beginPath(); c.arc(x, y, g.W * 0.28, 0, 6.29); c.fill();
    c.fillStyle = '#dff0ff';
    c.fillRect(x - g.W * 0.035, y - 4, g.W * 0.07, 8);
  });
}

function drawCrowd(g, time){
  var c = D.ctx, bandTop = g.H * 0.06, bandBot = g.H * 0.235;
  var grd = c.createLinearGradient(0, bandTop, 0, bandBot);
  grd.addColorStop(0, '#0b1524'); grd.addColorStop(1, '#16233a');
  c.fillStyle = grd; c.fillRect(0, bandTop, g.W, bandBot - bandTop);
  for (var i = 0; i < CROWD.length; i++){
    var d = CROWD[i];
    var tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.2 + d.ph));
    c.fillStyle = d.hot ? 'rgba(255,209,102,' + (0.30 * tw).toFixed(2) + ')'
                        : 'rgba(190,210,255,' + (0.22 * tw).toFixed(2) + ')';
    c.beginPath();
    c.arc(d.x * g.W, bandTop + d.y * (bandBot - bandTop), d.s, 0, 6.29);
    c.fill();
  }
}

function drawBoards(g){
  var c = D.ctx, y = g.H * 0.235, h = g.H * 0.052;
  var grd = c.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, '#0d1a2e'); grd.addColorStop(1, '#081120');
  c.fillStyle = grd; c.fillRect(0, y, g.W, h);
  c.strokeStyle = 'rgba(120,200,255,.18)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, y); c.lineTo(g.W, y); c.stroke();
  c.font = '600 ' + Math.round(h * 0.5) + 'px system-ui, sans-serif';
  c.fillStyle = 'rgba(160,210,255,.35)';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  var msg = 'AI AGENT · SOLVE PROBLEMS · PENALTY SHOOTOUT · ';
  c.fillText(msg + msg, g.W / 2, y + h * 0.55);
  c.textAlign = 'start'; c.textBaseline = 'alphabetic';
}

function drawPitch(g){
  var c = D.ctx, top = g.H * 0.287;
  var grd = c.createLinearGradient(0, top, 0, g.H);
  grd.addColorStop(0, '#0f3d24'); grd.addColorStop(1, '#1c7a45');
  c.fillStyle = grd; c.fillRect(0, top, g.W, g.H - top);

  /* perspective stripes */
  var stripes = 9;
  for (var i = 0; i < stripes; i++){
    var t0 = i / stripes, t1 = (i + 0.5) / stripes;
    c.fillStyle = 'rgba(255,255,255,.045)';
    quad(c, top, g.spotY, t0, t1);
  }

  /* goal area + 6 yard box + penalty box (projected) */
  c.strokeStyle = 'rgba(255,255,255,.42)'; c.lineWidth = Math.max(1.5, g.W * 0.0022);
  boxProjected(c, g, g.goalHalf * 1.30, 0.30);
  boxProjected(c, g, g.goalHalf * 2.35, 0.74);

  /* penalty arc */
  c.beginPath();
  c.ellipse(g.cx, g.spotY - g.H * 0.10, g.goalHalf * 1.7, g.H * 0.055, 0, Math.PI, 2 * Math.PI);
  c.stroke();

  /* penalty spot */
  c.fillStyle = 'rgba(255,255,255,.80)';
  c.beginPath(); c.ellipse(g.cx, g.spotY - g.H * 0.012, g.W * 0.012, g.W * 0.005, 0, 0, 6.29);
  c.fill();
}

function quad(c, top, bottom, t0, t1){
  var w = function(t){ return lerp(1.55, 0.34, t) * window.innerWidth; };
  var y0 = lerp(bottom, top, t0), y1 = lerp(bottom, top, t1);
  var x0 = (c.canvas.clientWidth - w(t0)) / 2, x1 = (c.canvas.clientWidth - w(t1)) / 2;
  c.beginPath();
  c.moveTo(x0, y0); c.lineTo(x0 + w(t0), y0);
  c.lineTo(x1 + w(t1), y1); c.lineTo(x1, y1);
  c.closePath(); c.fill();
}

function boxProjected(c, g, halfW, tBack){
  var y = lerp(g.spotY, g.goalBottomY, 1 - tBack * 0.5);
  var w = halfW * lerp(1.0, 0.72, tBack);
  c.beginPath();
  c.moveTo(g.cx - w, y); c.lineTo(g.cx + w, y);
  c.stroke();
  c.beginPath();
  c.moveTo(g.cx - w, y); c.lineTo(g.cx - w * 0.92, g.goalBottomY);
  c.moveTo(g.cx + w, y); c.lineTo(g.cx + w * 0.92, g.goalBottomY);
  c.stroke();
}

function drawGoal(g, ripple){
  var c = D.ctx;
  var x0 = g.cx - g.goalHalf, x1 = g.cx + g.goalHalf;
  var yTop = g.goalTopY, yBot = g.goalBottomY;

  /* net */
  c.save();
  c.beginPath(); c.rect(x0, yTop, g.goalHalf * 2, g.goalH); c.clip();
  c.fillStyle = 'rgba(8,16,26,.55)'; c.fillRect(x0, yTop, g.goalHalf * 2, g.goalH);
  c.strokeStyle = 'rgba(220,235,255,.20)'; c.lineWidth = 1;
  var stepX = g.goalHalf / 9, stepY = g.goalH / 6;
  for (var i = 1; i < 9; i++){
    c.beginPath();
    c.moveTo(x0 + i * stepX, yTop);
    c.lineTo(lerp(x0 + i * stepX, g.cx, 0.14), yBot);
    c.stroke();
  }
  for (var j = 1; j < 6; j++){
    c.beginPath();
    c.moveTo(x0, yTop + j * stepY); c.lineTo(x1, yTop + j * stepY);
    c.stroke();
  }
  if (ripple){
    var p = ripple.t / 0.6;
    if (p < 1){
      c.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - p)).toFixed(2) + ')';
      c.lineWidth = 2.4 * (1 - p);
      c.beginPath();
      c.ellipse(ripple.px, ripple.py, 10 + p * 54, 8 + p * 40, 0, 0, 6.29);
      c.stroke();
    }
  }
  c.restore();

  /* frame */
  c.strokeStyle = '#eef4ff'; c.lineCap = 'round';
  c.lineWidth = Math.max(5, g.W * 0.0075);
  c.beginPath();
  c.moveTo(x0, yBot); c.lineTo(x0, yTop); c.lineTo(x1, yTop); c.lineTo(x1, yBot);
  c.stroke();
  c.lineCap = 'butt';
}
/* -------------------------- keeper / ball / fx -------------------------- */
function drawKeeper(g){
  var c = D.ctx;
  var feetY = g.goalBottomY + 1;
  var bodyH = g.goalH * 0.74;
  var kx = g.cx + S.keeper.px;
  var ky = feetY - S.keeper.py * g.goalH * 0.42;
  var p = S.keeper.t;
  var lean = (S.plan ? (S.plan.dir || 0) : 0) * p;

  c.save();
  c.translate(kx, ky);
  c.rotate(lean * 0.85);
  var s = bodyH / 100;

  /* shadow */
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.beginPath(); c.ellipse(0, 2, 26 * s, 7 * s, 0, 0, 6.29); c.fill();

  /* legs */
  c.fillStyle = '#1b2a4a';
  c.fillRect(-13 * s, -42 * s, 10 * s, 42 * s);
  c.fillRect(3 * s, -42 * s, 10 * s, 42 * s);
  c.fillStyle = '#0d1626';
  c.fillRect(-14 * s, -4 * s, 12 * s, 5 * s);
  c.fillRect(2 * s, -4 * s, 12 * s, 5 * s);

  /* body */
  var jersey = c.createLinearGradient(0, -86 * s, 0, -38 * s);
  jersey.addColorStop(0, '#ffd166'); jersey.addColorStop(1, '#ff9f1c');
  c.fillStyle = jersey;
  c.beginPath();
  c.moveTo(-20 * s, -80 * s); c.lineTo(20 * s, -80 * s);
  c.lineTo(16 * s, -36 * s); c.lineTo(-16 * s, -36 * s);
  c.closePath(); c.fill();

  /* arms */
  c.strokeStyle = '#ffd166'; c.lineWidth = 9 * s; c.lineCap = 'round';
  var spread = 18 + p * 34;
  c.beginPath(); c.moveTo(-16 * s, -74 * s);
  c.lineTo(-spread * s, (-74 + p * 26) * s); c.stroke();
  c.beginPath(); c.moveTo(16 * s, -74 * s);
  c.lineTo(spread * s, (-74 + p * 26) * s); c.stroke();
  /* gloves */
  c.fillStyle = '#2ec4b6';
  c.beginPath(); c.arc(-spread * s, (-74 + p * 26) * s, 7.5 * s, 0, 6.29); c.fill();
  c.beginPath(); c.arc(spread * s, (-74 + p * 26) * s, 7.5 * s, 0, 6.29); c.fill();

  /* head */
  c.fillStyle = '#f2c9a0';
  c.beginPath(); c.arc(0, -92 * s, 12 * s, 0, 6.29); c.fill();
  c.fillStyle = '#22304a';
  c.beginPath(); c.arc(0, -96 * s, 12 * s, Math.PI, 2 * Math.PI); c.fill();

  c.restore();
}

function drawBall(g){
  var c = D.ctx;
  var showBall = (S.phase !== 'aim' && S.phase !== 'charging') || true;
  if (!showBall) return;

  /* trail */
  for (var i = 0; i < S.ball.trail.length; i++){
    var t = S.ball.trail[i];
    var a = (i + 1) / S.ball.trail.length;
    c.fillStyle = 'rgba(255,255,255,' + (0.16 * a).toFixed(2) + ')';
    c.beginPath(); c.arc(t.x, t.y, S.ball.r * 0.85 * a, 0, 6.29); c.fill();
  }

  var isFlight = S.phase === 'flying' || S.phase === 'result';
  var groundY = isFlight
    ? lerp(g.ballRestY, g.goalBottomY, easeInOut(S.flight.t))
    : g.spotY;
  var air = Math.max(0, groundY - S.ball.y);

  /* shadow (shrinks as the ball rises) */
  c.fillStyle = 'rgba(0,0,0,' + (0.38 - Math.min(0.28, air / 320)).toFixed(2) + ')';
  c.beginPath();
  c.ellipse(S.ball.x, groundY + 2, S.ball.r * (1.05 - Math.min(0.5, air / 420)),
            S.ball.r * 0.36, 0, 0, 6.29);
  c.fill();

  /* ball */
  var cx = S.ball.x, cy = S.ball.y, r = S.ball.r;
  var grd = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.75, '#e8eefb');
  grd.addColorStop(1, '#b9c4dc');
  c.fillStyle = grd;
  c.beginPath(); c.arc(cx, cy, r, 0, 6.29); c.fill();

  /* pentagon patches (spin) */
  c.fillStyle = 'rgba(16,22,34,.92)';
  c.save();
  c.translate(cx, cy); c.rotate(S.ball.spin);
  for (var k = 0; k < 5; k++){
    var ang = k * (6.283 / 5);
    var px = Math.cos(ang) * r * 0.52, py = Math.sin(ang) * r * 0.52;
    c.beginPath();
    c.moveTo(px, py - r * 0.17);
    c.lineTo(px + r * 0.16, py - r * 0.04);
    c.lineTo(px + r * 0.10, py + r * 0.16);
    c.lineTo(px - r * 0.10, py + r * 0.16);
    c.lineTo(px - r * 0.16, py - r * 0.04);
    c.closePath(); c.fill();
  }
  c.restore();
}

function drawFx(g){
  var c = D.ctx;
  for (var i = 0; i < S.fx.length; i++){
    var f = S.fx[i];
    if (f.kind === 'spark'){
      var a = clamp(1 - f.t / (f.life || 0.9), 0, 1);
      c.globalAlpha = a;
      c.fillStyle = f.col;
      c.fillRect(f.x, f.y, f.s, f.s * 1.6);
      c.globalAlpha = 1;
    }
  }
}

function drawReticle(g){
  if (S.busy || S.phase === 'over') return;
  var c = D.ctx;
  var x = g.cx + S.aim.x * g.goalHalf;
  var y = g.goalBottomY - S.aim.y * g.goalH;
  var r = Math.max(9, g.W * 0.010);

  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, r, 0, 6.29); c.stroke();
  c.beginPath();
  c.moveTo(x - r * 1.9, y); c.lineTo(x - r * 0.6, y);
  c.moveTo(x + r * 0.6, y); c.lineTo(x + r * 1.9, y);
  c.moveTo(x, y - r * 1.9); c.lineTo(x, y - r * 0.6);
  c.moveTo(x, y + r * 0.6); c.lineTo(x, y + r * 1.9);
  c.stroke();

  if (S.charging){
    c.strokeStyle = 'rgba(56,239,125,.95)'; c.lineWidth = 3.4;
    c.beginPath();
    c.arc(x, y, r * 2.6, -Math.PI / 2, -Math.PI / 2 + 6.283 * S.power);
    c.stroke();
  }
}

/* --------------------------------- loop --------------------------------- */
var last = 0;
function frame(ts){
  var dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
  last = ts;
  S.time += dt;

  updatePower(dt);
  if (S.phase === 'flying'){ updateFlight(dt); updateKeeper(dt); }
  updateFx(dt);

  var c = D.ctx, g = geometry();
  c.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0,
                 Math.min(window.devicePixelRatio || 1, 2), 0, 0);
  var sx = 0, sy = 0;
  if (S.shake > 0 && !S.reduce){ sx = rand(-S.shake, S.shake); sy = rand(-S.shake, S.shake); }
  c.save(); c.translate(sx, sy);

  drawSky(g);
  drawCrowd(g, S.time);
  drawBoards(g);
  drawPitch(g);
  drawGoal(g, S.fx.filter(function(f){ return f.kind === 'netRipple'; })[0]);
  drawKeeper(g);
  drawBall(g);
  drawFx(g);
  drawReticle(g);

  c.restore();

  /* vignette */
  var vg = c.createRadialGradient(g.W / 2, g.H / 2, Math.min(g.W, g.H) * 0.35,
                                  g.W / 2, g.H / 2, Math.max(g.W, g.H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  c.fillStyle = vg; c.fillRect(0, 0, g.W, g.H);

  requestAnimationFrame(frame);
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
}

if (typeof document !== 'undefined' && document.getElementById){
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
}
