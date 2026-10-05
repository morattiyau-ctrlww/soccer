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

  /* ---------------- the net, as a surface the ball can really hit ----------
     The net is not a picture: it is a plane with a restitution. A scored ball
     flies past the keeper, reaches the mesh, is stripped of its pace and drops
     into the pocket. Before this existed the ball stopped in mid-air while the
     net rippled behind it, which is exactly the kind of lie the world model is
     here to prevent.                                                        */
  var NET = {
    rest: 0.07,        /* the mesh gives back almost nothing: it catches  */
    hold: 1.4,         /* m/s ceiling on the rebound, so it stays in      */
    absorbX: 0.50,     /* sideways damping as the net stretches      */
    absorbY: 0.52,
    airDrag: 0.18,     /* per second, on the ball in flight          */
    groundRest: 0.44,  /* grass                                       */
    rollFric: 1.8      /* m/s^2 of rolling resistance on the grass    */
  };
  var GRAV = 9.81;

  /* Is a ball whose *centre* is here still inside the mouth? The rules decide a
     goal with the ball's centre on the goal line, so the mesh has to accept a
     centre up to one radius outside the mouth: a goal that clipped the bar and
     dropped in would otherwise sail straight through the netting.          */
  function insideMouth(x, y){
    return Math.abs(x) <= GOAL.w / 2 + GOAL.postR + BALL.r &&
           y >= -BALL.r && y <= GOAL.h + GOAL.postR + BALL.r;
  }
  /* is the ball in the pocket — behind the goal line, inside the frame? */
  function inNet(b){
    return b.z < -BALL.r * 0.5 && insideMouth(b.x, b.y);
  }

  /* One step of the ball as a free body, in metres: gravity, drag, the mesh,
     the side netting, the roof, and the grass. The same integrator runs for a
     shot in the net and for a parry, so the two can never disagree.
     `b` = {x,y,z,vx,vy,vz} mutated in place. Returns what it touched.        */
  function ballStep(b, dt){
    dt = clamp(dt, 0, 1 / 30);
    var r = BALL.r, ev = { net: 0, side: 0, top: 0, ground: false };
    var wx = GOAL.w / 2, gh = GOAL.h, dep = GOAL.depth;

    b.vy -= GRAV * dt;
    var k = 1 - NET.airDrag * dt;
    b.vx *= k; b.vy *= k; b.vz *= k;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

    /* the side netting and the roof first: the goal is a box, and a ball that
       reaches a corner in one step must not slip out through the seam */
    if (b.z <= r && b.z >= -dep - r){
      if (b.x + r > wx && b.vx > 0){ b.x = wx - r; ev.side = b.vx; b.vx = -b.vx * NET.rest; }
      if (b.x - r < -wx && b.vx < 0){ b.x = -wx + r; ev.side = -b.vx; b.vx = -b.vx * NET.rest; }
      /* the roof only exists under the crossbar: above it, the ball is over */
      if (b.y <= gh && b.y + r > gh && b.vy > 0){
        b.y = gh - r; ev.top = b.vy; b.vy = -b.vy * NET.rest * 0.6;
      }
    }
    /* then the back of the net: it strips the pace and holds the ball in */
    if (b.z - r <= -dep && insideMouth(b.x, b.y)){
      b.z = -dep + r;
      if (b.vz < 0){
        ev.net = -b.vz;
        /* the mesh stretches, kills the pace, and holds the ball: the rebound
           is a dribble back off the netting, never a bounce out of the goal */
        b.vz = Math.min(-b.vz * NET.rest, NET.hold);
        b.vx *= NET.absorbX;
        b.vy *= NET.absorbY;
      }
    }
    /* the grass */
    if (b.y <= r){
      b.y = r;
      /* a landing scuffs the pace off it — but only the landing frame, or the
         ball would brake to a stop in front of the net while merely rolling */
      if (b.vy < -0.5){
        b.vy = -b.vy * NET.groundRest;
        b.vx *= 0.72; b.vz *= 0.80;
      }
      if (b.vy < 0) b.vy = 0;
      /* rolling: bleed the horizontal speed off until it settles */
      var sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      if (sp > 0.001){
        var dec = Math.min(sp, NET.rollFric * dt);
        b.vx -= b.vx / sp * dec;
        b.vz -= b.vz / sp * dec;
      }
      if (b.vy === 0 && sp < 0.06){ b.vx = 0; b.vz = 0; }
      ev.ground = true;
    }
    return ev;
  }

  /* ---------------- the keeper's reflex: catch or parry? -------------------
     Where the ball meets him decides it. Contact near the middle of his body
     is a clean catch; contact out at the fingertips is a parry, and so is
     anything hit hard. This is a rule, not a flourish, so it is pure and it is
     tested: the ball you see fly away is the ball the rules decided he parried. */
  function saveTypeFor(dx, dy, reach, power){
    var cx = reach.x > 0 ? Math.abs(dx) / reach.x : 0;
    var cy = reach.y > 0 ? Math.abs(dy) / reach.y : 0;
    var d = Math.sqrt(cx * cx + cy * cy);
    /* a firm hand holds it; a hard shot and a full stretch do not */
    var grip = 0.72 - 0.26 * clamp(power, 0, 1);
    return d <= grip ? 'catch' : 'deflect';
  }

  /* Where the glove actually met the ball, in metres. The keeper can only
     touch what is inside his stretch, so a fingertip save contacts the ball at
     the edge of his reach rather than wherever the ball would have crossed.  */
  var GLOVE = { out: 0.74, up: 0.66, fwd: 0.15 };
  function contactPoint(cross, plan){
    var k = diveCentre(plan);
    var dx = cross.x - k.x, dy = cross.y - k.y;
    var lx = clamp(dx, -GLOVE.out, GLOVE.out);
    var ly = clamp(dy, -GLOVE.up, GLOVE.up);
    return { x: k.x + lx, y: clamp(k.y + ly, BALL.r, GOAL.h + 0.5),
             z: k.z - GLOVE.fwd };
  }

  /* The bounce off a glove or a fist. The palm faces the taker, so the ball
     always leaves *away* from the goal line — a parried ball can never end up
     in the net, which is a promise worth being able to test.                */
  function deflect(cross, plan, power, speed){
    var c = contactPoint(cross, plan);
    var k = diveCentre(plan);
    /* the surface normal: mostly out towards the taker, angled away from his
       body centre and up or down by where the contact was */
    var nx = c.x - k.x, ny = c.y - k.y;
    var len = Math.sqrt(nx * nx + ny * ny) || 1;
    var n = { x: (nx / len) * 0.55, y: (ny / len) * 0.42, z: 1.0 };
    var nl = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    n.x /= nl; n.y /= nl; n.z /= nl;

    var sIn = clamp(speed, 12, 34) * lerp(0.72, 1.06, clamp(power, 0, 1));
    var dot = -sIn * n.z;
    var e = 0.42;
    var v = { x: -(1 + e) * dot * n.x,
              y: -(1 + e) * dot * n.y,
              z: -sIn - (1 + e) * dot * n.z };
    /* the punch: a fist adds pace along the normal, a fingertip barely any */
    var punch = lerp(1.2, 5.0, clamp(power, 0, 1));
    v.x += n.x * punch; v.y += n.y * punch; v.z += n.z * punch;
    /* Whatever the geometry did, a parry always pushes the ball away from the
       goal face. He has stopped it; it cannot then trickle over the line. */
    v.z = Math.max(v.z, 1.2 + punch * 0.5);
    /* A fingertip to a ball above his reach flicks it up and over the bar —
       the one parry in football that turns a save into a corner. It is read
       off the contact, not authored: high contact, upward ball.            */
    if (c.y > k.y + GLOVE.up * 0.55){
      v.y = Math.max(v.y, 1.6 + punch * 0.55);
    }
    /* A real deflection loops: the ball leaves at the pace the contact gave it
       and gravity does the rest. These bounds only stop the maths producing a
       rocket — the ball still lands on the pitch, as a parried ball does.  */
    v.x = clamp(v.x, -14, 14);
    v.y = clamp(v.y, -2.5, 5.6);
    v.z = clamp(v.z, 1.2, 16);
    return { v: v, contact: c, normal: n };
  }

  /* ---------------- the keeper's animation state ---------------------------
     One decision, in one place, so the 3D rig and the flat fallback can never
     disagree about what he is doing. `phase` is the game phase, `t`/`dur` are
     the flight clock, `saveType` comes from the rules.                      */
  var KEEPER_STATES = ['idle', 'scan', 'dive_low', 'dive_mid', 'dive_high',
                       'catch', 'deflect', 'conceded'];
  function keeperState(o){
    o = o || {};
    var out = { state: 'idle', side: 0, band: 'mid', p: 0, key: 'idle' };
    var plan = o.plan, ph = o.phase;

    if (plan){
      out.side = Math.abs(plan.x) < 0.14 ? 0 : (plan.x > 0 ? 1 : -1);
      out.band = plan.y < 0.45 ? 'low' : (plan.y < 0.85 ? 'mid' : 'high');
      out.p = diveProgress(o.t || 0, plan, o.dur || 0.6);
    }
    if (ph === 'aim') out.state = 'idle';
    else if (ph === 'charging') out.state = 'scan';
    else if (ph === 'flying') out.state = (out.p > 0 && plan) ? 'dive' : 'scan';
    else if (ph === 'result'){
      var v = (o.verdict || 'goal');
      if (v === 'saved') out.state = (o.saveType === 'catch') ? 'catch' : 'deflect';
      else out.state = 'conceded';
    } else out.state = 'idle';

    var side = out.side < 0 ? 'left' : (out.side > 0 ? 'right' : 'centre');
    out.key = (out.state === 'dive') ? ('dive_' + out.band + '_' + side)
                                     : (out.state + '_' + out.band + '_' + side);
    return out;
  }

  /* ---------------- pitch markings (world space, for the pitch texture) ---- */
  function markings(){
    return { goal: GOAL, pitch: PITCH, ball: BALL, keeper: KEEPER };
  }

  return { GOAL: GOAL, PITCH: PITCH, BALL: BALL, KEEPER: KEEPER, NET: NET,
           clamp: clamp, lerp: lerp,
           toMetres: toMetres, toGoal: toGoal, reachMetres: reachMetres,
           diveCentre: diveCentre, positionAt: positionAt, crossing: crossing,
           insideFrame: insideFrame, onWoodwork: onWoodwork,
           diveProgress: diveProgress, markings: markings,
           insideMouth: insideMouth, inNet: inNet, ballStep: ballStep,
           saveTypeFor: saveTypeFor, contactPoint: contactPoint, deflecting: deflect,
           KEEPER_STATES: KEEPER_STATES, keeperState: keeperState, GLOVE: GLOVE };
})();

if (typeof module !== 'undefined' && module.exports){ module.exports = WORLD; }
