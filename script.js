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
  GOAL_W: 7.32, GOAL_H: 2.44, POST_R: 0.06, BALL_R: 0.11,
  PITCH_SPOT_M: 11.0            /* the penalty spot, for real ball pace     */
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

/* LOGIC shares one rule with the 3D world model: how a save is classified.
   world.js is loaded before this file in the browser, and required directly
   under node, so that rule has exactly one home and cannot drift. The
   fallback only exists so a missing world.js degrades instead of crashing;
   the tests assert that we are never actually running without it.          */
var WorldRef = (typeof WORLD !== 'undefined') ? WORLD
             : (typeof require === 'function'
                 ? (function(){ try { return require('./world.js'); } catch (e){ return null; } })()
                 : null);

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

    var verdict = 'goal', hit = null, saveType = null;
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
        /* How he stopped it is a rule, not a flourish: a firm hand on a soft
           ball holds it, a full stretch or a rocket comes back out. The ball
           you watch fly away is the ball the rules parried.                 */
        saveType = WorldRef
          ? WorldRef.saveTypeFor(x - keeper.x, y - keeper.y, reach, power)
          : 'deflect';
      }
    }

    return { x: x, y: y, verdict: verdict, hit: hit, saveType: saveType,
             power: power, speed: speed, reach: reach,
             /* the ball's real pace across the line, in m/s: the number the
                audio and the parry both read from */
             pace: CFG.PITCH_SPOT_M / (CFG.FLIGHT * speed),
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
  module.exports = { LOGIC: LOGIC, DIFF: DIFF, CFG: CFG, WorldRef: WorldRef };
}
/* ---------------------------- audio engine ------------------------------
   One graph, three buses and a limiter on the end, because a shootout fires
   several sounds at the same instant (ball, net, crowd, whistle) and the old
   build wired every voice straight to the output, where they clipped.

       voice -> bus gain -> glue compressor -> limiter -> master -> output

   Every noise voice is band-limited and plays off one pre-baked buffer instead
   of allocating a fresh white-noise burst per call, so there is no hiss and no
   garbage-churn during a burst of events. AUDIO below is the mix spec: plain
   data, so the tests can check the headroom without an AudioContext.       */
var AUDIO = {
  master: 0.85,                        /* the player-facing volume          */
  /* the wall: fast, hard, and after the glue so it only ever catches peaks */
  limiter: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.003, release: 0.10 },
  /* the glue: gentle, so the mix breathes instead of pumping */
  glue:    { threshold: -14, knee: 6, ratio: 3, attack: 0.008, release: 0.25 },
  buses:   { sfx: 1.00, crowd: 0.90, ui: 0.55 },
  /* every voice's own peak amplitude: all below 1, sum caught downstream */
  peak: { kick: 0.60, click: 0.26, thud: 0.34, net: 0.40, slap: 0.52,
          palm: 0.30, tock: 0.34, post: 0.36, whistle: 0.32, breath: 0.07,
          cheer: 0.60, roar: 0.30, groan: 0.26, charge: 0.14 },
  /* the mix is high-passed to drop DC/rumble and rolled off to kill fizz */
  hp: 32, lp: 16000,
  /* no noise voice may reach outside this band: it is why nothing hisses */
  noiseBand: { lo: 180, hi: 5200 },
  maxVoices: 24,                       /* a burst cannot pile up unboundedly */
  fadeMs: 90                           /* mute ramps, so toggling never pops */
};

var Sound = (function(){
  var ctx = null, on = true, graph = null, voices = 0;
  var whiteBuf = null, pinkBuf = null, crowdSrc = null, crowdVoices = 0;

  function ac(){
    if (ctx) return ctx;
    /* node has no Web Audio: every voice degrades to a no-op, which is what
       lets the mix spec and the busiest sound paths be tested headlessly   */
    if (typeof window === 'undefined') return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  /* Build the chain once: nothing may be scheduled before the context exists,
     and nothing may reach `destination` except the master gain. */
  function build(){
    if (graph || !ac()) return graph;
    var c = ctx;
    graph = { bus: {} };

    var hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = AUDIO.hp; hp.Q.value = 0.7;
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = AUDIO.lp; lp.Q.value = 0.5;

    var glue = c.createDynamicsCompressor();
    glue.threshold.value = AUDIO.glue.threshold;
    glue.knee.value = AUDIO.glue.knee;
    glue.ratio.value = AUDIO.glue.ratio;
    glue.attack.value = AUDIO.glue.attack;
    glue.release.value = AUDIO.glue.release;

    var lim = c.createDynamicsCompressor();
    lim.threshold.value = AUDIO.limiter.threshold;
    lim.knee.value = AUDIO.limiter.knee;
    lim.ratio.value = AUDIO.limiter.ratio;
    lim.attack.value = AUDIO.limiter.attack;
    lim.release.value = AUDIO.limiter.release;

    var master = c.createGain();
    master.gain.value = on ? AUDIO.master : 0;

    hp.connect(glue); glue.connect(lim); lim.connect(lp); lp.connect(master);
    master.connect(c.destination);
    graph.in = hp; graph.master = master;

    ['sfx', 'crowd', 'ui'].forEach(function(name){
      var b = c.createGain();
      b.gain.value = AUDIO.buses[name];
      b.connect(hp);
      graph.bus[name] = b;
    });
    return graph;
  }

  function resume(){ if (ac() && ctx.state === 'suspended') ctx.resume(); }
  function now(){ return ac().currentTime + 0.001; }

  /* ---- noise, baked once ------------------------------------------------
     One white buffer for transients, one smoothed ("pink-ish") buffer for
     everything breathy. Both are band-limited by the voices that use them, so
     no sound can ever put raw full-spectrum noise into the mix.            */
  function bake(){
    if (whiteBuf || !ac()) return;
    var c = ctx, sr = c.sampleRate, len = Math.floor(sr * 2), i, x, l1 = 0, l2 = 0;
    whiteBuf = c.createBuffer(1, len, sr);
    var w = whiteBuf.getChannelData(0);
    for (i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    pinkBuf = c.createBuffer(1, len, sr);
    var p = pinkBuf.getChannelData(0);
    for (i = 0; i < len; i++){
      x = w[i];
      l1 += (x - l1) * 0.085;      /* two poles: a gentle -6 dB/oct tilt */
      l2 += (l1 - l2) * 0.085;
      p[i] = Math.max(-1, Math.min(1, l2 * 3.1));
    }
  }

  /* ---- primitives -------------------------------------------------------- */

  /* an envelope that starts from silence linearly (no click) and decays
     exponentially (natural tail), instead of jumping from 1e-4 */
  function env(param, t0, peak, atk, dec, dur){
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + atk);
    param.exponentialRampToValueAtTime(Math.max(0.0004, peak * 0.30), t0 + atk + dec);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function track(node){
    voices++;
    node.onended = function(){
      voices--;
      if (voices < 0) voices = 0;
      try { node.disconnect(); } catch (e){}
    };
    return node;
  }

  function live(){ return on && !!ac() && !!build() && voices < AUDIO.maxVoices; }
  function busOf(name){
    var b = build();
    return b ? b.bus[name || 'sfx'] : null;
  }

  /* one band-limited noise voice; `hi` sweeps down to `lo` over its life */
  function noiseVoice(o){
    if (!live()) return null;
    var c = ctx, dest = busOf(o.bus);
    var t0 = now() + (o.delay || 0);
    var src = c.createBufferSource();
    src.buffer = (o.colour === 'pink') ? pinkBuf : whiteBuf;
    src.loop = o.dur > 1.8;
    var f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q === undefined ? 0.8 : o.q;
    var hi = Math.min(o.hi || 1200, AUDIO.noiseBand.hi);
    var lo = Math.max(o.lo || 400, AUDIO.noiseBand.lo);
    f.frequency.setValueAtTime(hi, t0);
    if (lo !== hi) f.frequency.exponentialRampToValueAtTime(lo, t0 + o.dur * 0.8);
    var vg = c.createGain();
    env(vg.gain, t0, o.peak, o.atk === undefined ? 0.006 : o.atk, o.dur * 0.35, o.dur);
    src.connect(f); f.connect(vg); vg.connect(dest);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
    /* a ruffle: mesh and cloth flutter rather than hiss */
    if (o.flutter){
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.type = 'sine'; lfo.frequency.value = o.flutter;
      lg.gain.value = o.flutterDepth === undefined ? 0.30 : o.flutterDepth;
      lfo.connect(lg); lg.connect(vg.gain);
      lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
      track(lfo);
    }
    return track(src);
  }

  /* one filtered tone voice, with an optional pitch sweep and vibrato */
  function toneVoice(o){
    if (!live()) return null;
    var c = ctx, dest = busOf(o.bus);
    var t0 = now() + (o.delay || 0);
    var osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to && o.to !== o.from){
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    }
    var vg = c.createGain();
    env(vg.gain, t0, o.peak, o.atk === undefined ? 0.004 : o.atk, o.dur * 0.3, o.dur);
    var tail = osc;
    if (o.lp){
      var f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.6;
      f.frequency.value = Math.min(o.lp, AUDIO.lp);
      osc.connect(f); tail = f;
    }
    tail.connect(vg); vg.connect(dest);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
    if (o.vib){
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.type = o.vibType || 'sine'; lfo.frequency.value = o.vib;
      lg.gain.value = o.vibDepth || 60;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
      track(lfo);
    }
    return track(osc);
  }

  /* ---- the crowd bed ----------------------------------------------------
     A looped pink buffer under a slow lowpass, so the crowd is a body of air
     rather than a hiss, plus a roar band the cheers swell through.         */
  var crowd = null;
  function crowdStart(){
    if (!on || !ac() || !build() || crowdSrc) return;
    bake();
    var c = ctx;
    crowdSrc = c.createBufferSource();
    crowdSrc.buffer = pinkBuf; crowdSrc.loop = true;
    var f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.7;
    var swell = c.createGain();
    swell.gain.value = 0.045;                       /* the idle murmur */
    var roar = c.createBiquadFilter();
    roar.type = 'bandpass'; roar.frequency.value = 460; roar.Q.value = 0.9;
    var roarG = c.createGain(); roarG.gain.value = 0.0;
    crowdSrc.connect(f); f.connect(swell); swell.connect(busOf('crowd'));
    swell.connect(roar); roar.connect(roarG); roarG.connect(busOf('crowd'));
    /* a slow wander, so the bed is never static */
    var lfo = c.createOscillator(), lg = c.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 0.07; lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(swell.gain);
    crowdSrc.start(); lfo.start();
    crowd = { swell: swell, roar: roarG };
  }

  function crowdLevel(vol, ramp, roar){
    if (!crowd || !on) return;
    var t0 = now();
    crowd.swell.gain.cancelScheduledValues(t0);
    crowd.swell.gain.setValueAtTime(crowd.swell.gain.value, t0);
    crowd.swell.gain.linearRampToValueAtTime(vol, t0 + (ramp || 0.25));
    if (roar !== undefined){
      crowd.roar.gain.cancelScheduledValues(t0);
      crowd.roar.gain.setValueAtTime(crowd.roar.gain.value, t0);
      crowd.roar.gain.linearRampToValueAtTime(roar, t0 + (ramp || 0.25));
    }
  }

  return {
    set: function(v){
      on = v;
      if (!on) crowdLevel(0.0, 0.15, 0.0);
      var b = build();
      /* ramp the master rather than cutting it, so tails fade instead of pop */
      if (b && ac()){
        var t0 = now();
        b.master.gain.cancelScheduledValues(t0);
        b.master.gain.setValueAtTime(b.master.gain.value, t0);
        b.master.gain.linearRampToValueAtTime(on ? AUDIO.master : 0,
                                              t0 + AUDIO.fadeMs / 1000);
      }
    },
    enabled: function(){ return on; },
    wake: function(){ resume(); bake(); build(); crowdStart(); },
    voiceCount: function(){ return voices; },

    /* -- the ball off the boot: a low body thump, a leather click and a short
          slap of air. Crisp, and never a bare sine blip.                   */
    kick: function(power){
      power = clamp(power || 0, 0, 1);
      bake(); if (!live()) return;
      toneVoice({ from: lerp(178, 128, power), to: lerp(56, 42, power),
                  type: 'sine', peak: AUDIO.peak.kick, dur: 0.20, atk: 0.004 });
      toneVoice({ from: lerp(96, 74, power), to: 44, type: 'triangle',
                  peak: AUDIO.peak.thud, dur: 0.13, atk: 0.006, lp: 400 });
      noiseVoice({ hi: Math.min(3000, AUDIO.noiseBand.hi), lo: 1400, q: 1.1,
                   peak: AUDIO.peak.click * lerp(0.8, 1.15, power), dur: 0.045 });
    },

    /* a step: soft, low, and only ever a background detail */
    step: function(){
      bake();
      toneVoice({ from: 88, to: 62, type: 'sine', peak: 0.10, dur: 0.09, atk: 0.006 });
      noiseVoice({ hi: 700, lo: 300, q: 0.7, peak: 0.05, dur: 0.06 });
    },

    /* -- the net: mesh stretching, not a hiss. Pink noise sweeping down with
          a fast flutter as the weave ripples, and a soft low "give".       */
    net: function(speed){
      bake(); if (!live()) return;
      var s = clamp((speed || 14) / 26, 0.35, 1);
      noiseVoice({ colour: 'pink', hi: 1900, lo: 420, q: 0.85,
                   peak: AUDIO.peak.net * lerp(0.6, 1, s), dur: 0.52,
                   atk: 0.010, flutter: 34, flutterDepth: 0.10 });
      noiseVoice({ colour: 'pink', hi: 900, lo: 260, q: 0.6,
                   peak: AUDIO.peak.net * 0.45, dur: 0.34, atk: 0.016 });
      toneVoice({ from: 120, to: 70, type: 'sine',
                  peak: AUDIO.peak.thud * 0.5, dur: 0.16, atk: 0.008, lp: 500 });
    },

    /* -- a clean catch: leather on glove, then the ball settling into it --- */
    save: function(){
      bake(); if (!live()) return;
      noiseVoice({ hi: AUDIO.noiseBand.hi, lo: 2200, q: 0.7,
                   peak: AUDIO.peak.slap, dur: 0.055, atk: 0.0015 });
      noiseVoice({ hi: 1400, lo: 500, q: 0.9, peak: AUDIO.peak.palm,
                   dur: 0.15, atk: 0.004, colour: 'pink' });
      toneVoice({ from: 240, to: 150, type: 'sine',
                  peak: AUDIO.peak.thud, dur: 0.12, atk: 0.003, lp: 700 });
    },
    /* -- a parry: harder and drier, a fist on a ball rather than a hold ----- */
    parry: function(){
      bake(); if (!live()) return;
      noiseVoice({ hi: AUDIO.noiseBand.hi, lo: 2600, q: 0.6,
                   peak: AUDIO.peak.slap * 0.9, dur: 0.042, atk: 0.001 });
      noiseVoice({ hi: 1800, lo: 800, q: 1.4, peak: AUDIO.peak.tock,
                   dur: 0.10, atk: 0.002 });
      toneVoice({ from: 620, to: 300, type: 'triangle',
                  peak: AUDIO.peak.tock * 0.5, dur: 0.09, atk: 0.002, lp: 1600 });
    },

    /* -- a bell of a post: inharmonic, metallic, and gone ------------------ */
    post: function(){
      bake(); if (!live()) return;
      noiseVoice({ hi: 3600, lo: 900, q: 1.6, peak: AUDIO.peak.post,
                   dur: 0.36, atk: 0.001 });
      toneVoice({ from: 620, to: 596, type: 'triangle',
                  peak: AUDIO.peak.post * 0.55, dur: 0.42, atk: 0.002 });
      toneVoice({ from: 1174, to: 1130, type: 'sine',
                  peak: AUDIO.peak.post * 0.30, dur: 0.24, atk: 0.002 });
      toneVoice({ from: 1908, to: 1855, type: 'sine',
                  peak: AUDIO.peak.post * 0.18, dur: 0.15, atk: 0.002 });
    },

    /* -- the referee: a pea whistle. Two near partials with a warble, plus
          breath, band-limited so it pierces without any fizz.             */
    whistle: function(){
      bake(); if (!live()) return;
      toneVoice({ from: 2330, to: 2344, type: 'sine', peak: AUDIO.peak.whistle,
                  lp: 6000, vib: 24, vibDepth: 70, dur: 0.30, atk: 0.022 });
      toneVoice({ from: 2960, to: 2972, type: 'sine',
                  peak: AUDIO.peak.whistle * 0.42, lp: 7000, vib: 29,
                  vibDepth: 70, dur: 0.28, atk: 0.022 });
      noiseVoice({ hi: 4200, lo: 2400, q: 0.6, peak: AUDIO.peak.breath,
                   dur: 0.24, atk: 0.022, colour: 'pink' });
    },

    /* -- elation, then a wall of noise: a rising roar over the crowd bed ---- */
    cheer: function(){
      bake();
      crowdLevel(0.40, 0.16, 0.24);
      noiseVoice({ colour: 'pink', hi: 1500, lo: 500, q: 0.4,
                   peak: AUDIO.peak.roar, dur: 1.5, atk: 0.10, bus: 'crowd' });
      /* claps: a scatter of tiny transients, not one long hiss */
      for (var i = 0; i < 6; i++){
        noiseVoice({ hi: 3200, lo: 1600, q: 1.2,
                     peak: AUDIO.peak.cheer * 0.12, dur: 0.05, atk: 0.001,
                     delay: 0.02 + Math.random() * 0.5, bus: 'crowd' });
      }
      setTimeout(function(){ crowdLevel(0.06, 1.1, 0.0); }, 1100);
    },

    /* -- a save or a miss: the crowd sighs and the pitch drops ------------- */
    groan: function(){
      bake();
      crowdLevel(0.17, 0.12, 0.05);
      toneVoice({ from: 330, to: 148, type: 'triangle', peak: AUDIO.peak.groan,
                  lp: 900, dur: 0.62, atk: 0.05 });
      toneVoice({ from: 196, to: 96, type: 'sine', peak: AUDIO.peak.groan * 0.5,
                  lp: 600, dur: 0.55, atk: 0.06 });
      setTimeout(function(){ crowdLevel(0.06, 1.0, 0.0); }, 800);
    },

    /* the power bar: a soft tick on its own quiet bus, low-passed. The old
       build used a bare square wave at 0.05 — the harshest thing in the mix. */
    charge: function(p){
      bake();
      toneVoice({ from: lerp(660, 1180, clamp(p, 0, 1)), type: 'triangle',
                  peak: AUDIO.peak.charge, dur: 0.05, atk: 0.004, lp: 2600,
                  bus: 'ui' });
    }
  };
})();

/* ------------------------- physical event hook ---------------------------- */
/* The renderers call this the instant something actually touches something, so
   the sound is never played before the picture shows it: the net swish lands
   on the frame the mesh ripples, not the frame the verdict was decided.     */
function ballEvent(kind, info){
  var speed = info && info.speed;
  if (kind === 'net') Sound.net(speed);
  else if (kind === 'post') Sound.post();
  else if (kind === 'ground' && speed > 3) Sound.step();
}

/* the audio engine is defined below the LOGIC export, so its own keys are
   attached here — where AUDIO and Sound are certain to exist */
if (typeof module !== 'undefined' && module.exports){
  module.exports.AUDIO = AUDIO;
  module.exports.Sound = Sound;
}

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
  /* the keeper's position on the line. His *animation state* is not stored
     here: it is derived from the world model on demand (see WORLD.keeperState),
     so there is exactly one answer to "what is he doing" */
  keeper: { x: 0, y: 0.30, t: 0., px: 0, py: 0.30 },
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
  S.keeper.x = 0; S.keeper.y = 0.30;
  S.keeper.t = 0;

  Sound.kick(power);
  S.shake = (S.reduce ? 0 : 7) * power;
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
    Sound.cheer();
    burst(netImpactPoint(), 46, ['#38ef7d', '#ffd166', '#8fd3ff', '#ffffff']);
    var ip = netImpactPoint();
    S.fx.push({ kind: 'netRipple', t: 0, px: ip.x, py: ip.y });
    /* the swish belongs to the moment the mesh is struck. The 3D renderer
       calls ballEvent('net') when its ball reaches the net; the flat renderer
       has no ball physics, so its ripple IS the impact. */
    if (!(Renderer3D && Renderer3D.active())) Sound.net(S.shot.pace);
  } else {
    S.streak = 0;
    if (v === 'post'){ Sound.post(); burst(netImpactPoint(), 18, ['#ffd166', '#ffffff']); }
    else if (v === 'saved'){
      if (S.shot.saveType === 'catch') Sound.save(); else Sound.parry();
      Sound.groan();
    } else { Sound.groan(); }
  }

  /* what he does about it is not stored anywhere: the world model derives
     catch / deflect / conceded from this verdict and the plan he committed to,
     so the pose he plays is the save that was scored against him */
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
    S.best = Math.max(S.best, S.streak);
    S.ball.vx = undefined; S.ball.vy = undefined; S.ball.after = undefined;
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
  S.keeper.x = 0; S.keeper.y = 0.30;
  S.ball.vx = undefined; S.ball.vy = undefined; S.ball.after = undefined;
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
/* ------------------------- the flat renderer's aftermath ------------------
   The 2D fallback has no world-space physics, so the same outcomes are played
   in screen space. The states and the verdicts are identical; only the units
   differ. This is why the fallback still shows a ball that ends up in the net
   rather than a ball that freezes on the goal line.                       */
function updateAftermath2D(dt){
  var b = S.ball, g = geometry();
  if (!S.shot) return;
  var v = S.shot.verdict;
  if (b.after === undefined) b.after = 0;
  b.after += dt;

  /* a caught ball is in his hands: the flat keeper's gloves are at the top of
     his catch pose (92% of body height above his feet, body = 74% of the goal),
     so the ball is placed on exactly that point rather than near it */
  if (v === 'saved' && S.shot.saveType === 'catch'){
    var feetY = g.goalBottomY + 1 - S.keeper.py * g.goalH * 0.42;
    b.x = g.cx + S.keeper.px;
    b.y = feetY - (g.goalH * 0.74) * 0.92;
    b.r = g.spotR * 0.82;
    return;
  }
  if (b.vx === undefined){
    b.vx = 0; b.vy = 0;
    var sp = 0.16 * g.goalHalf;
    if (v === 'goal'){ b.vx = 0; b.vy = sp * 0.30; }              /* into the net */
    else if (v === 'post'){ b.vx = (S.shot.x < 0 ? -1 : 1) * sp * 1.5; b.vy = -sp * 0.5; }
    else if (v === 'saved'){ b.vx = (S.shot.x < 0 ? -1 : 1) * sp * 2.2; b.vy = -sp * 0.9; }
    else { b.vx = (S.shot.x < 0 ? -1 : 1) * sp * 2.6; b.vy = (v === 'over' ? -sp * 0.7 : sp * 0.4); }
  }
  b.vy += dt * g.goalH * 2.6;                 /* gravity, in screen units */
  b.vx *= (1 - dt * 1.2); b.vy *= (1 - dt * 0.6);
  b.x += b.vx * dt; b.y += b.vy * dt;
  /* the grass stops it: it settles inside the net instead of in mid-air */
  var floor = g.goalBottomY + (v === 'goal' ? g.goalH * 0.06 : 0);
  if (b.y > floor){ b.y = floor; b.vy = 0; b.vx *= 0.86; }
  b.r = g.spotR * 0.82;
  b.spin += dt * 3;
}

/* ---------------------------- simulation -------------------------------- */
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

function keeperStateNow(){
  /* the one answer to "what is he doing", asked of the world model */
  return WorldRef.keeperState({
    phase: S.phase, plan: S.plan, t: S.flight.t, dur: S.flight.dur,
    verdict: S.shot ? S.shot.verdict : null,
    saveType: S.shot ? S.shot.saveType : null
  }).state;
}

function updateKeeper(dt){
  var k = S.plan, g = geometry();
  if (!k){ S.keeper.px = 0; S.keeper.py = 0.30; S.keeper.t = 0; return; }
  var delay = k.react / Math.max(S.flight.dur, 0.05);
  var t = clamp((S.flight.t - delay) / Math.max(1 - delay, 0.15), 0, 1);
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
    else if (S.phase === 'result' && !(Renderer3D && Renderer3D.active())){
      updateAftermath2D(dt);
    }
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

/* a scripted save of a given kind: central and soft enough that he holds it,
   or out at the fingertips where he can only push it away */
function scriptedSave(kind){
  for (var i = 0; i < 40; i++){
    S.aim = { x: (i % 4) * 0.10 - 0.15, y: 0.30 };
    S.power = 0.22;
    shootPenalty();
    if (S.shot.verdict === 'saved' && S.shot.saveType === kind) return S.shot;
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
    /* a shot's own facts, so a capture can prove what the physics did */
    saveType: S.shot ? S.shot.saveType : null,
    pace: S.shot ? +S.shot.pace.toFixed(1) : null,
    keeperPose: keeperStateNow(),
    audio: { on: Sound.enabled(), voices: Sound.voiceCount(),
             err: window.__audioErr || null },
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
  if (mode === 'audio'){
    /* Build the real graph in a real browser and fire everything at once —
       the overlapping case is exactly what used to clip. */
    whenStadium(function(){
      var err = null;
      try {
        Sound.wake();
        Sound.kick(0.7); Sound.net(20); Sound.save(); Sound.parry();
        Sound.post(); Sound.whistle(); Sound.cheer(); Sound.groan();
        Sound.charge(0.5); Sound.step();
        for (var i = 0; i < 6; i++){
          Sound.kick(0.9); Sound.net(26); Sound.cheer(); Sound.whistle();
        }
      } catch (e){ err = String((e && e.message) || e); }
      window.__audioErr = err;
      report('CAP audio');
      frozen = true;
    });
    return;
  }
  if (mode === 'rest') return;

  whenStadium(function(){
    if (mode === 'goal' || mode === 'save' || mode === 'catch' || mode === 'parry'){
      if (mode === 'goal') scriptedShot('goal');
      else if (mode === 'save') scriptedShot('saved');
      else scriptedSave(mode === 'catch' ? 'catch' : 'deflect');
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
                : (mode === 'goal' || mode === 'save' || mode === 'outcome' ||
                   mode === 'catch' || mode === 'parry') ? 45
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
