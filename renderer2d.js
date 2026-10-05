/* =========================================================================
   Penalty Shootout 十二碼大戰  —  renderer2d.js
   The original flat canvas renderer. It stays as the automatic fallback:
   no WebGL, a weak GPU, or ?q=2d all land here. It paints the whole stadium
   with 2D paths, so it needs no assets and no shaders.

   Loaded before script.js and reads the shared globals (S, D, CFG, rand...)
   at call time, plus the screen-space geometry() helper from script.js.
   ========================================================================= */
'use strict';

var CROWD = [];

function buildCrowd(w){
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
/* -------------------------- keeper / ball / fx --------------------------
   The flat keeper reads the same state machine as the 3D rig
   (WORLD.keeperState), so the fallback can never do something the stadium
   would not: idle, scan, dive_low/mid/high left or right, catch, deflect,
   conceded. The poses are hand-tuned in screen space, the *state* is shared. */
function keeperPose2D(k, p){
  /* k = {state, side, band, p}; returns screen-space pose numbers */
  var bandLean = k.band === 'low' ? 0.95 : (k.band === 'mid' ? 0.78 : 0.55);
  var out = { lean: 0, feet: 0, hands: 0.42, spread: 18, crouch: 0,
              handY: -74, headTilt: 0, apart: 0 };
  if (k.state === 'idle'){
    var t = S.time;
    out.feet = Math.abs(Math.sin(t * 2.3)) * 3;
    out.lean = Math.sin(t * 1.15) * 0.05;
    out.crouch = 6 + Math.sin(t * 2.3) * 2;
    out.hands = 0.55 + Math.sin(t * 2.3 + 1.1) * 0.05;
  } else if (k.state === 'scan'){
    var side = S.aim.x < -0.1 ? -1 : (S.aim.x > 0.1 ? 1 : 0);
    out.lean = side * 0.10;
    out.crouch = 12 + S.power * 10;
    out.hands = 0.70 + S.power * 0.12;
    out.spread = 22;
    out.apart = side * 6;
  } else if (k.state === 'dive'){
    var e = p;
    out.lean = -k.side * bandLean * (0.35 + 0.65 * e);
    out.hands = 1.35 * e + 0.3;
    out.spread = 18 + 30 * e;
    out.crouch = -8 * e;
    out.handY = -74 + (k.band === 'high' ? -22 : (k.band === 'mid' ? -10 : 7)) * e;
    out.apart = k.side * 26 * e;
    out.feet = 4 + 14 * e;
  } else if (k.state === 'catch'){
    out.lean = -k.side * bandLean * 0.7;
    out.hands = 1.05; out.spread = 13; out.apart = k.side * 18;
    out.handY = -92; out.crouch = 4;
  } else if (k.state === 'deflect'){
    out.lean = -k.side * bandLean * 0.85;
    out.hands = 1.5; out.spread = 34; out.apart = k.side * 22;
    out.handY = -86;
  } else if (k.state === 'conceded'){
    out.lean = -k.side * bandLean * 0.45;
    out.crouch = 22; out.hands = 0.30; out.spread = 26;
    out.headTilt = 1; out.apart = k.side * 10;
  }
  return out;
}

function drawKeeper(g){
  var c = D.ctx;
  var feetY = g.goalBottomY + 1;
  var bodyH = g.goalH * 0.74;
  var kx = g.cx + S.keeper.px;
  var ky = feetY - S.keeper.py * g.goalH * 0.42;
  var st = WORLD.keeperState({
    phase: S.phase, plan: S.plan, t: S.flight.t, dur: S.flight.dur,
    verdict: S.shot ? S.shot.verdict : null,
    saveType: S.shot ? S.shot.saveType : null
  });
  var pose = keeperPose2D(st, st.state === 'dive' ? st.p : 0);
  var s = bodyH / 100;

  c.save();
  c.translate(kx + pose.apart * s, ky - pose.feet * s);
  c.rotate(pose.lean);

  /* shadow */
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.beginPath(); c.ellipse(0, 2, 26 * s, 7 * s, 0, 0, 6.29); c.fill();

  var sq = 1 + pose.crouch * 0.004;
  /* legs */
  c.fillStyle = '#1b2a4a';
  c.fillRect(-13 * s, -42 * s * sq, 10 * s, 42 * s * sq);
  c.fillRect(3 * s, -42 * s * sq, 10 * s, 42 * s * sq);
  c.fillStyle = '#22304d';
  c.fillRect(-13 * s, -42 * s * sq, 10 * s, 26 * s);
  c.fillRect(3 * s, -42 * s * sq, 10 * s, 26 * s);
  /* cleats */
  c.fillStyle = '#0d1626';
  c.fillRect(-14.5 * s, -5 * s, 13 * s, 5 * s);
  c.fillRect(1.5 * s, -5 * s, 13 * s, 5 * s);
  c.fillStyle = '#f2f5fa';
  c.fillRect(-14.5 * s, -1.4 * s, 13 * s, 1.4 * s);
  c.fillRect(1.5 * s, -1.4 * s, 13 * s, 1.4 * s);

  /* body: a tapered jersey with a collar, not a rectangle */
  var topY = -80 * s * sq, botY = -36 * s * sq;
  var jersey = c.createLinearGradient(0, topY, 0, botY);
  jersey.addColorStop(0, '#ffd166'); jersey.addColorStop(1, '#ff9f1c');
  c.fillStyle = jersey;
  c.beginPath();
  c.moveTo(-21 * s, topY);
  c.lineTo(21 * s, topY);
  c.lineTo(15 * s, botY);
  c.lineTo(-15 * s, botY);
  c.closePath(); c.fill();
  c.fillStyle = '#141b2b';
  c.fillRect(-6 * s, topY - 2 * s, 12 * s, 4 * s);            /* collar */

  /* arms */
  var handX = pose.spread, handY = pose.handY;
  c.strokeStyle = '#ffd166'; c.lineWidth = 9 * s; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-18 * s, -72 * s); c.lineTo(-handX * s, handY * s); c.stroke();
  c.beginPath(); c.moveTo(18 * s, -72 * s); c.lineTo(handX * s, handY * s); c.stroke();
  /* gloves */
  c.fillStyle = '#2ec4b6';
  c.beginPath(); c.arc(-handX * s, handY * s, 8 * s, 0, 6.29); c.fill();
  c.beginPath(); c.arc(handX * s, handY * s, 8 * s, 0, 6.29); c.fill();

  /* head, with a hint of a face so the mood reads */
  var headY = -92 * s * sq;
  c.fillStyle = '#f2c9a0';
  c.beginPath(); c.arc(0, headY, 12 * s, 0, 6.29); c.fill();
  c.fillStyle = '#1d2433';
  c.beginPath(); c.arc(0, headY - 4 * s, 12 * s, Math.PI, 2 * Math.PI); c.fill();
  c.fillStyle = '#101826';
  if (pose.headTilt){
    /* head down: no eyes, he is looking at the grass */
    c.fillRect(-6 * s, headY + 2 * s, 12 * s, 1.6 * s);
  } else {
    c.beginPath(); c.arc(-4 * s, headY + 1 * s, 1.7 * s, 0, 6.29); c.fill();
    c.beginPath(); c.arc(4 * s, headY + 1 * s, 1.7 * s, 0, 6.29); c.fill();
  }

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

/* -------------------------------- facade -------------------------------- */
var Renderer2D = {
  name: '2d',
  active: function(){ return true; },
  resize: function(){
    var cv = D.canvas;
    buildCrowd(Math.max(1, cv.clientWidth));
  },
  /* one full frame of fake-3D stadium */
  render: function(g){
    var c = D.ctx;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    var sx = 0, sy = 0;
    if (S.shake > 0 && !S.reduce){
      sx = rand(-S.shake, S.shake); sy = rand(-S.shake, S.shake);
    }
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
  }
};
