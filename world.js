/* =========================================================================
   Penalty Shootout 十二碼大戰  —  world.js
   The shared 3D world model. Pure math only: no DOM, no THREE, no game state.
   Exported under CommonJS so the tests can check that what you *see* in 3D is
   exactly what the rules decided.

   Coordinate system (right-handed, metres, y is up):
     x : across the goal, 0 = centre, -3.66 = left post, +3.66 = right post
     y : height above the grass, 0 = ground, 2.44 = crossbar
     z : distance in front of the goal line (goal line = 0, penalty spot = 11)

   The goal-plane game units used by LOGIC are x: -1..1 (post to post) and
   y: 0..1 (grass to crossbar).
   ========================================================================= */
'use strict';

var WORLD = (function(){

  var GOAL  = { w: 7.32, h: 2.44, postR: 0.06, depth: 1.95 };
  var PITCH = { spot: 11.0, areaD: 16.5, areaW: 40.32,
                sixD: 5.5, sixW: 18.32, arcR: 9.15 };
  var BALL  = { r: 0.11, mass: 0.43 };
  var KEEPER = { h: 1.9, span: 1.85 };

  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t){ return a + (b - a) * t; }

  /* ---------------- units ---------------- */

  /* goal units -> metres on the goal line */
  function toMetres(gx, gy){ return { x: gx * GOAL.w / 2, y: gy * GOAL.h, z: 0 }; }
  /* metres on the goal line -> goal units */
  function toGoal(mx, my){ return { x: mx / (GOAL.w / 2), y: my / GOAL.h }; }
  /* the keeper's horizontal / vertical cover, in metres, for a difficulty */
  function reachMetres(d){ return { x: d.reachX * GOAL.w / 2, y: d.reachY * GOAL.h }; }
  /* where the keeper's centre ends up when he commits to `plan` */
  function diveCentre(plan){
    return { x: plan.x * GOAL.w / 2, y: plan.y * GOAL.h, z: 0.35 };
  }

  /* ---------------- ball flight ---------------- */

  /* Position of the ball at t (0 = on the spot, 1 = crossing the line).
     The path is authored so that t = 1 lands *exactly* on the crossing point
     the rules decided on — the look never lies about the outcome.          */
  function positionAt(t, cross, curve, power){
    t = clamp(t, 0, 1); power = clamp(power, 0, 1);
    /* z is linear so the ball always takes the same time to arrive */
    var z = lerp(PITCH.spot, 0, t);
    var x = lerp(0, cross.x, t) + curve * Math.sin(Math.PI * t) * 0.34;
    /* a rising, dipping arc: the lift fades to zero exactly at the goal line */
    var lift = Math.sin(Math.PI * t) * lerp(0.95, 0.22, power);
    var y = Math.max(BALL.r * 0.6, lerp(BALL.r, cross.y, t) + lift);
    return { x: x, y: y, z: z };
  }

  /* where the ball ends up when nobody stops it (for the net/crowd) */
  function crossing(cross, curve, power){ return positionAt(1, cross, curve, power); }

  /* is the crossing point inside the frame? (goal units in, boolean out) */
  function insideFrame(gx, gy){
    return Math.abs(gx) <= 1 && gy <= 1 && gy >= 0;
  }
  /* is it on the woodwork, in metres, given the ball radius? */
  function onWoodwork(mx, my){
    var inX = Math.abs(mx) <= GOAL.w / 2 + GOAL.postR + BALL.r;
    var inY = my <= GOAL.h + GOAL.postR + BALL.r;
    var nearPost = Math.abs(Math.abs(mx) - GOAL.w / 2) <= GOAL.postR + BALL.r;
    var nearBar  = Math.abs(my - GOAL.h) <= GOAL.postR + BALL.r;
    return (inX && nearBar) || (inY && nearPost && Math.abs(mx) > GOAL.w / 2 - GOAL.postR - BALL.r) ||
           (nearPost && my <= GOAL.h) || (nearBar && Math.abs(mx) <= GOAL.w / 2);
  }

  /* ---------------- keeper ---------------- */

  /* The keeper's dive, as a fraction 0..1 of the way to his committed pose.
     Same timing rule the rules use, so the dive you see is the dive that
     was scored against.                                                   */
  function diveProgress(flightT, plan, flightDur){
    var delay = plan.react / Math.max(flightDur, 0.05);
    return clamp((flightT - delay) / Math.max(1 - delay, 0.15), 0, 1);
  }

  /* ---------------- pitch markings (world space, for the pitch texture) ---- */
  function markings(){
    return { goal: GOAL, pitch: PITCH, ball: BALL, keeper: KEEPER };
  }

  return { GOAL: GOAL, PITCH: PITCH, BALL: BALL, KEEPER: KEEPER,
           clamp: clamp, lerp: lerp,
           toMetres: toMetres, toGoal: toGoal, reachMetres: reachMetres,
           diveCentre: diveCentre, positionAt: positionAt, crossing: crossing,
           insideFrame: insideFrame, onWoodwork: onWoodwork,
           diveProgress: diveProgress, markings: markings };
})();

if (typeof module !== 'undefined' && module.exports){ module.exports = WORLD; }
