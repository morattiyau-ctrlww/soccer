/* Penalty Shootout — logic tests.
   Run from the repo root:  node tests/logic.test.js                  */
var path = require('path');
var mod = require(path.join(__dirname, '..', 'script.js'));
var LOGIC = mod.LOGIC, DIFF = mod.DIFF, CFG = mod.CFG;

var pass = 0, fail = 0;
function check(name, cond, info){
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(info)); }
}
function rnd05(){ return 0.5; }
function mkKeeper(x, y){
  return { x: x, y: y, dir: x < 0 ? -1 : (x > 0 ? 1 : 0), height: y,
           read: false, react: 0.2 };
}

console.log('\n1. placement');
(function(){
  var scored = 0, n = 2000;
  for (var i = 0; i < n; i++){
    var r = LOGIC.resolveShot({ x: 0.78, y: 0.30 }, CFG.SWEET,
                              mkKeeper(-0.7, 0.3), 'normal');
    if (r.verdict === 'goal') scored++;
  }
  check('far-corner shot scores > 95% against a keeper going the other way',
        scored / n > 0.95, scored + '/' + n);
})();
(function(){
  var saved = 0, n = 2000;
  for (var i = 0; i < n; i++){
    var r = LOGIC.resolveShot({ x: 0, y: 0.30 }, 0.9, mkKeeper(0, 0.3), 'normal');
    if (r.verdict === 'saved') saved++;
  }
  check('shot straight at the keeper is almost always saved',
        saved / n > 0.95, saved + '/' + n);
})();

console.log('\n2. woodwork and misses');
(function(){
  var r = LOGIC.resolveShot({ x: 1.03, y: 0.35 }, CFG.SWEET,
                            mkKeeper(-0.7, 0.3), 'normal', rnd05);
  check('aiming at the post hits the woodwork', r.verdict === 'post', r.verdict);

  var r2 = LOGIC.resolveShot({ x: 0.2, y: 1.04 }, CFG.SWEET,
                             mkKeeper(0, 0.3), 'normal', rnd05);
  check('too high = crossbar or over',
        r2.verdict === 'post' || r2.verdict === 'over', r2.verdict);

  var r3 = LOGIC.resolveShot({ x: 1.2, y: 0.4 }, CFG.SWEET,
                             mkKeeper(0, 0.3), 'normal', rnd05);
  check('well outside the post = wide', r3.verdict === 'wide', r3.verdict);
})();

console.log('\n3. power model');
(function(){
  function avgErr(power){
    var sum = 0, n = 6000;
    for (var i = 0; i < n; i++){
      var r = LOGIC.resolveShot({ x: 0.5, y: 0.4 }, power, mkKeeper(9, 9), 'easy');
      sum += Math.abs(r.x - 0.5) + Math.abs(r.y - 0.4);
    }
    return sum / n;
  }
  var sweet = avgErr(CFG.SWEET), max = avgErr(1.0), low = avgErr(0.30);
  check('sweet-spot power beats max power for accuracy', sweet < max,
        { sweet: sweet.toFixed(4), max: max.toFixed(4) });
  check('sweet-spot power beats a weak shot for accuracy', sweet < low,
        { sweet: sweet.toFixed(4), low: low.toFixed(4) });
  check('max power sprays wider than a weak shot', max > low,
        { max: max.toFixed(4), low: low.toFixed(4) });
})();

console.log('\n4. keeper AI');
(function(){
  var bad = 0;
  for (var i = 0; i < 4000; i++){
    var k = LOGIC.keeperPlan([], 'normal', Math.random);
    if (Math.abs(k.x) > 1.0 || k.y < 0 || k.y > 1.0) bad++;
  }
  check('keeper never plans a dive outside the goal', bad === 0, bad);
})();
(function(){
  var hist = [{ x: -0.8 }, { x: -0.7 }, { x: -0.9 }, { x: -0.6 }];
  function leftRate(diff){
    var c = 0, n = 6000;
    for (var i = 0; i < n; i++){
      if (LOGIC.keeperPlan(hist, diff, Math.random).dir === -1) c++;
    }
    return c / n;
  }
  var e = leftRate('easy'), l = leftRate('legend');
  check('legend keeper reads your favourite side more than an easy one',
        l > e + 0.05, { easy: e.toFixed(3), legend: l.toFixed(3) });
})();
(function(){
  function saveRate(diff){
    var saved = 0, n = 4000;
    for (var i = 0; i < n; i++){
      var res = LOGIC.playRound({ x: 0.62, y: 0.34 }, 0.6, [], diff);
      if (res.shot.verdict === 'saved') saved++;
    }
    return saved / n;
  }
  var easy = saveRate('easy'), legend = saveRate('legend');
  check('harder difficulty saves more of the same shots', legend > easy,
        { easy: easy.toFixed(3), legend: legend.toFixed(3) });
  check('even Legend leaves most decent shots scoreable (< 70%)', legend < 0.70,
        legend.toFixed(3));
})();

console.log('\n5. round + rating');
(function(){
  var r = LOGIC.playRound({ x: 0.4, y: 0.5 }, 0.7, [], 'normal', Math.random);
  check('playRound returns a coherent shot + keeper decision',
        !!r.shot && !!r.keeper && typeof r.shot.verdict === 'string' &&
        typeof r.keeper.x === 'number', r.shot.verdict);
  check('rating reacts to performance',
        LOGIC.rating(5, 5).indexOf('PERFECT') === 0 &&
        LOGIC.rating(0, 5) !== LOGIC.rating(5, 5),
        LOGIC.rating(5, 5) + ' | ' + LOGIC.rating(0, 5));
  check('all four difficulties are defined',
        ['easy', 'normal', 'hard', 'legend'].every(function(k){
          return DIFF[k] && DIFF[k].reachX > 0 && DIFF[k].react > 0;
        }), Object.keys(DIFF));
})();

console.log('\n6. world model (what you see must match what was decided)');
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));
  var m = W.toMetres(1, 1);
  check('goal units map to a real 7.32 x 2.44 m frame',
        Math.abs(m.x - 3.66) < 1e-9 && Math.abs(m.y - 2.44) < 1e-9, m);

  check('CFG and world.js agree on the geometry',
        CFG.GOAL_W === W.GOAL.w && CFG.GOAL_H === W.GOAL.h &&
        CFG.POST_R === W.GOAL.postR && CFG.BALL_R === W.BALL.r,
        { cfg: [CFG.GOAL_W, CFG.GOAL_H, CFG.POST_R, CFG.BALL_R],
          world: [W.GOAL.w, W.GOAL.h, W.GOAL.postR, W.BALL.r] });

  /* --- the ball's 3D path may never contradict the verdict --- */
  var cross = { x: 2.9, y: 1.86 };                    /* metres */
  var end = W.positionAt(1, cross, 0.5, 0.7);
  check('the 3D flight lands exactly on the decided crossing point',
        Math.abs(end.x - cross.x) < 1e-6 && Math.abs(end.y - cross.y) < 1e-6 &&
        end.z === 0, end);

  var below = 0, start = W.positionAt(0, cross, 0.5, 0.7);
  for (var t = 0; t <= 1.0001; t += 0.02){
    if (W.positionAt(t, cross, 0.5, 0.7).y < 0) below++;
  }
  check('the ball never dips through the grass mid-flight', below === 0, below);
  check('the ball starts on the penalty spot 11 m out',
        Math.abs(start.z - 11) < 1e-9 && Math.abs(start.x) < 1e-9, start);
})();
(function(){
  /* every verdict, mapped into metres, must be physically true */
  var W = require(path.join(__dirname, '..', 'world.js'));
  var bad = { goal: 0, wide: 0, over: 0, post: 0 };
  for (var i = 0; i < 4000; i++){
    var aim = { x: -1.3 + 2.6 * Math.random(),
                y: -0.15 + 1.5 * Math.random() };
    var r = LOGIC.resolveShot(aim, Math.random(), { x: 9, y: 9 }, 'easy');
    var p = W.toMetres(r.x, r.y);
    if (r.verdict === 'goal' && !W.insideFrame(r.x, r.y)) bad.goal++;
    if (r.verdict === 'goal' && (Math.abs(p.x) > 3.66 + 1e-9 || p.y > 2.44 + 1e-9)) bad.goal++;
    if (r.verdict === 'wide' && Math.abs(p.x) <= 3.66 + W.GOAL.postR + W.BALL.r) bad.wide++;
    if (r.verdict === 'over' && p.y <= 2.44 + W.GOAL.postR + W.BALL.r) bad.over++;
    if (r.verdict === 'post'){
      var dPost = Math.abs(Math.abs(p.x) - 3.66), dBar = Math.abs(p.y - 2.44);
      if (Math.min(dPost, dBar) > W.GOAL.postR + W.BALL.r + 1e-9) bad.post++;
    }
  }
  check('a GOAL always crosses inside the real frame', bad.goal === 0, bad.goal);
  check('WIDE is always outside the post', bad.wide === 0, bad.wide);
  check('OVER is always above the bar', bad.over === 0, bad.over);
  check('POST always touches real woodwork the 3D can clang off', bad.post === 0,
        bad.post);
})();
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));
  /* the keeper's cover, in metres, is the same cover the 3D dive draws */
  var easy = LOGIC.reachAt('easy', 0.68), legend = LOGIC.reachAt('legend', 0.68);
  var em = W.reachMetres({ reachX: easy.x, reachY: easy.y });
  var lm = W.reachMetres({ reachX: legend.x, reachY: legend.y });
  check('legend keeper covers more of the goal than an easy one (in metres)',
        lm.x > em.x && lm.y > em.y, { easy: em, legend: lm });
  check('no keeper covers the whole goal', lm.x < W.GOAL.w / 2, lm);
  check('powering up shrinks the keeper window the player is shown',
        LOGIC.reachAt('legend', 0.9).x < LOGIC.reachAt('legend', 0.3).x,
        'reach falls with power');

  /* dive timing: nothing before he reacts, complete when the ball arrives */
  var plan = { x: 0.7, y: 0.3, react: 0.2 };
  check('the keeper has not moved before his reaction time',
        W.diveProgress(0, plan, 0.5) === 0, W.diveProgress(0, plan, 0.5));
  check('the dive is complete by the time the ball crosses the line',
        W.diveProgress(1, plan, 0.5) === 1, W.diveProgress(1, plan, 0.5));
})();

console.log('\n7. the reader (the AI you can see working)');
(function(){
  /* a belief is a probability distribution, or it is a lie on screen */
  var w = LOGIC.gridWeights([], 'normal');
  var sum = 0, i, j;
  for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) sum += w[i][j];
  check('the belief is a probability distribution (sums to 1)',
        Math.abs(sum - 1) < 1e-9, sum);

  function feed(side, n){
    var h = [];
    for (var k = 0; k < n; k++) h.push({ x: side * 0.75, y: 0.2, verdict: 'goal' });
    return h;
  }
  var left = LOGIC.gridWeights(feed(-1, 6), 'legend');
  var right = LOGIC.gridWeights(feed(1, 6), 'legend');
  var leftCol = left[0][0] + left[1][0] + left[2][0];
  var rightColL = left[0][2] + left[1][2] + left[2][2];
  var rightCol = right[0][2] + right[1][2] + right[2][2];
  var leftColR = right[0][0] + right[1][0] + right[2][0];
  check('six penalties down the left push the belief to the left',
        leftCol > rightColL && leftCol > 0.5, { left: leftCol, other: rightColL });
  check('and six down the right mirror it', rightCol > leftColR, rightCol);

  var low = LOGIC.gridWeights([{ x: 0.7, y: 0.12, verdict: 'goal' }], 'legend');
  var highRow = low[2][0] + low[2][1] + low[2][2];
  var lowRow = low[0][0] + low[0][1] + low[0][2];
  check('and a row of daisy-cutters moves the belief low', lowRow > highRow, {
    lowRow: lowRow, highRow: highRow });

  /* the belief has to be worth something: measure it on a taker with a habit.
     A 70/30 taker can be read; the top box should land on the next shot far
     more often than his own 30% rate of going the other way.               */
  var hits = 0, trials = 0, seed = 12345;
  function srnd(){ seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  for (var t = 0; t < 3000; t++){
    var h2 = [];
    for (var k = 0; k < 6; k++) h2.push(srnd() < 0.7 ? { x: 0.76, y: 0.2 } : { x: -0.76, y: 0.7 });
    var best = LOGIC.bestCell(LOGIC.gridWeights(h2, 'legend'));
    var nextLeft = srnd() < 0.7;
    trials++;
    if ((best.c === 2 && nextLeft) || (best.c === 0 && !nextLeft)) hits++;
  }
  check('reading a 70/30 taker works far better than guessing (needs >60%)',
        hits / trials > 0.60, (100 * hits / trials).toFixed(1) + '%');

  /* but a genuinely unpredictable taker must stay hard to read */
  var mixed = [];
  for (var m = 0; m < 8; m++){
    mixed.push({ x: (m % 2 ? 0.72 : -0.72), y: (m % 2 ? 0.2 : 0.85) });
  }
  var even = LOGIC.bestCell(LOGIC.gridWeights(mixed, 'legend'));
  check('a taker who alternates corners and heights stays under 45% sure',
        even.p < 0.45, even.p);

  check('a rookie keeper barely learns at all',
        LOGIC.gridWeights(feed(-1, 6), 'easy')[0][0] <
        LOGIC.gridWeights(feed(-1, 6), 'legend')[0][0],
        { easy: LOGIC.gridWeights(feed(-1, 6), 'easy')[0][0],
          legend: LOGIC.gridWeights(feed(-1, 6), 'legend')[0][0] });

  /* the plan he commits to must be inside the goal, and the expected box is
     the argmax of the belief                       */
  var outside = 0, badExpect = 0, badY = 0;
  for (var q = 0; q < 2000; q++){
    var hist = feed(q % 3 === 0 ? -1 : 1, 6);
    var plan = LOGIC.keeperPlan(hist, 'legend');
    if (Math.abs(plan.x) > 1 || Math.abs(plan.y) > 1) outside++;
    if (plan.y < 0.08 || plan.y > 0.95) badY++;
    var be = LOGIC.bestCell(plan.heat);
    if (be.r !== plan.expect.r || be.c !== plan.expect.c) badExpect++;
  }
  check('the keeper still only ever commits inside his goal', outside === 0, outside);
  check('his dive height stays inside the frame', badY === 0, badY);
  check('the "AI expects" box on screen is the belief argmax', badExpect === 0,
        badExpect);
})();

console.log('\n7. the keeper\'s animation states');
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));

  check('every state the brief asks for exists',
        ['idle', 'scan', 'dive_low', 'dive_mid', 'dive_high',
         'catch', 'deflect', 'conceded'].every(function(s){
           return W.KEEPER_STATES.indexOf(s) >= 0;
         }), W.KEEPER_STATES);

  var mkPlan = function(x, y){ return { x: x, y: y, react: 0.2 }; };

  check('he is idle while you stand over the ball',
        W.keeperState({ phase: 'aim' }).state === 'idle',
        W.keeperState({ phase: 'aim' }).key);
  check('he is scanning while you charge power',
        W.keeperState({ phase: 'charging' }).state === 'scan',
        W.keeperState({ phase: 'charging' }).key);

  /* the dive must carry the side and the height, so the right pose plays */
  var lowL = W.keeperState({ phase: 'flying', plan: mkPlan(-0.7, 0.2), t: 0.6, dur: 0.6 });
  var highR = W.keeperState({ phase: 'flying', plan: mkPlan(0.7, 0.9), t: 0.6, dur: 0.6 });
  var midR = W.keeperState({ phase: 'flying', plan: mkPlan(0.7, 0.6), t: 0.6, dur: 0.6 });
  check('a low dive to the left is dive_low_left', lowL.key === 'dive_low_left', lowL.key);
  check('a high dive to the right is dive_high_right', highR.key === 'dive_high_right', highR.key);
  check('a middle-height dive is its own state', midR.key === 'dive_mid_right', midR.key);

  /* the reaction delay is honoured: he does not dive before he commits */
  check('he is still scanning during his reaction delay',
        W.keeperState({ phase: 'flying', plan: mkPlan(0.7, 0.3), t: 0.05, dur: 0.6 })
          .state === 'scan',
        W.keeperState({ phase: 'flying', plan: mkPlan(0.7, 0.3), t: 0.05, dur: 0.6 }).key);

  check('a clean catch plays the catch state',
        W.keeperState({ phase: 'result', verdict: 'saved', saveType: 'catch',
                        plan: mkPlan(-0.7, 0.2) }).state === 'catch');
  check('a parry plays the deflect state',
        W.keeperState({ phase: 'result', verdict: 'saved', saveType: 'deflect',
                        plan: mkPlan(0.7, 0.2) }).state === 'deflect');
  check('a goal plays the conceded state',
        W.keeperState({ phase: 'result', verdict: 'goal',
                        plan: mkPlan(0.7, 0.2) }).state === 'conceded');
  check('a miss he stretched for is conceded too',
        W.keeperState({ phase: 'result', verdict: 'post',
                        plan: mkPlan(0.7, 0.2) }).state === 'conceded');

  /* the state must be derived from the same plan the rules scored against */
  var mismatch = 0;
  for (var q = 0; q < 500; q++){
    var plan = LOGIC.keeperPlan([], 'normal');
    var st = W.keeperState({ phase: 'flying', plan: plan, t: 0.9, dur: 0.6 });
    var side = Math.abs(plan.x) < 0.14 ? 'centre' : (plan.x > 0 ? 'right' : 'left');
    var band = plan.y < 0.45 ? 'low' : (plan.y < 0.85 ? 'mid' : 'high');
    if (st.key !== 'dive_' + band + '_' + side) mismatch++;
  }
  check('the dive you see is the dive the rules scored against', mismatch === 0,
        mismatch);
})();

console.log('\n8. catch and parry: the save is a rule, not a flourish');
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));
  var reach = { x: 0.38, y: 0.38 };

  check('a shot into the middle of his body is caught',
        W.saveTypeFor(0.02, 0.02, reach, 0.5) === 'catch');
  check('a fingertip save at the edge of his reach is parried',
        W.saveTypeFor(0.37, 0.37, reach, 0.5) === 'deflect');
  check('a rocket is harder to hold than a pass-back',
        W.saveTypeFor(0.16, 0.16, reach, 1.0) === 'deflect' &&
        W.saveTypeFor(0.16, 0.16, reach, 0.2) === 'catch',
        { hard: W.saveTypeFor(0.16, 0.16, reach, 1.0),
          soft: W.saveTypeFor(0.16, 0.16, reach, 0.2) });

  /* every save must be exactly one of the two kinds, and only saves have one */
  var bad = 0, kinds = { catch: 0, deflect: 0 }, saves = 0;
  for (var i = 0; i < 4000; i++){
    var keeper = LOGIC.keeperPlan([], 'normal');
    var r = LOGIC.resolveShot({ x: -1 + 2 * Math.random(), y: Math.random() },
                              Math.random(), keeper, 'normal');
    if (r.verdict === 'saved'){
      saves++;
      if (r.saveType !== 'catch' && r.saveType !== 'deflect') bad++;
      else kinds[r.saveType]++;
    } else if (r.saveType !== null) bad++;
  }
  check('every save is a catch or a parry, and nothing else is either',
        bad === 0 && saves > 100 && kinds.catch > 0 && kinds.deflect > 0,
        { bad: bad, saves: saves, kinds: kinds });
})();

console.log('\n8b. the parry is computed from the contact, and never scores');
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));

  var outOfGoal = 0, minZ = 99, escapes = 0;
  for (var k = 0; k < 400; k++){
    var plan = LOGIC.keeperPlan([], 'legend');
    var cross = { x: plan.x * 3.66, y: plan.y * 2.44 };
    var d = W.deflecting(cross, plan, 0.4 + Math.random() * 0.6,
                         12 + Math.random() * 20);
    if (d.v.z <= 0) outOfGoal++;
    /* then let the physics run: a parried ball may never end up in the net */
    var b = { x: d.contact.x, y: d.contact.y, z: d.contact.z,
              vx: d.v.x, vy: d.v.y, vz: d.v.z };
    var lo = b.z;
    for (var s = 0; s < 240; s++){ W.ballStep(b, 1 / 60); lo = Math.min(lo, b.z); }
    minZ = Math.min(minZ, lo);
    if (W.inNet(b)) escapes++;
  }
  check('a parried ball always leaves away from the goal face', outOfGoal === 0,
        outOfGoal);
  check('a parried ball never crosses the goal line, let alone the net',
        escapes === 0 && minZ > 0, { escapes: escapes, minZ: minZ });

  /* a fingertip on a ball above him tips it over the bar */
  var hi = W.deflecting({ x: 0.6, y: 2.35 }, { x: 0.78, y: 0.72 }, 0.9, 26);
  var hb = { x: hi.contact.x, y: hi.contact.y, z: hi.contact.z,
             vx: hi.v.x, vy: hi.v.y, vz: hi.v.z };
  var apex = hb.y;
  for (var t2 = 0; t2 < 300; t2++){ W.ballStep(hb, 1 / 60); apex = Math.max(apex, hb.y); }
  check('a tip at full vertical stretch goes over the crossbar',
        apex > W.GOAL.h, { apex: apex, bar: W.GOAL.h });

  /* and the contact point is where a glove could actually be */
  var far = 0, low = 0;
  for (var q = 0; q < 400; q++){
    var p2 = LOGIC.keeperPlan([], 'legend');
    var c2 = W.contactPoint({ x: 0, y: 1.2 }, p2);
    var centre = W.diveCentre(p2);
    if (Math.abs(c2.x - centre.x) > W.GLOVE.out + 1e-9) far++;
    if (c2.y < W.BALL.r - 1e-9) low++;
  }
  check('the glove only ever meets the ball inside its own reach', far === 0, far);
  check('a save never contacts the ball below the grass', low === 0, low);
})();

console.log('\n9. the net: a goal is a ball that reaches the mesh and stays');
(function(){
  var W = require(path.join(__dirname, '..', 'world.js'));

  /* fly real goal-bound shots into the net and watch where they settle */
  var through = 0, notInNet = 0, notSettled = 0, inMidAir = 0, hitNet = 0, n = 0;
  for (var i = 0; i < 300; i++){
    var r = LOGIC.resolveShot({ x: -0.95 + 1.9 * Math.random(), y: Math.random() },
                              CFG.SWEET, { x: 9, y: 9 }, 'easy');
    if (r.verdict !== 'goal') continue;
    n++;
    var cross = { x: r.x * 3.66, y: r.y * 2.44 };
    var a = W.positionAt(1, cross, 0, r.power);
    var b0 = W.positionAt(0.96, cross, 0, r.power);
    var dtv = 0.04 * Math.max(CFG.FLIGHT * r.speed, 0.2);
    var b = { x: a.x, y: a.y, z: 0,
              vx: (a.x - b0.x) / dtv, vy: (a.y - b0.y) / dtv, vz: (a.z - b0.z) / dtv };
    var imp = 0;
    for (var s = 0; s < 900; s++){
      var ev = W.ballStep(b, 1 / 60);
      if (ev.net && !imp) imp = ev.net;
      if (b.z < -W.GOAL.depth + 0.005) through++;
    }
    if (imp) hitNet++;
    if (!W.inNet(b)) notInNet++;
    /* it must be lying on the grass, not hanging in the air */
    var speed = Math.abs(b.vx) + Math.abs(b.vz);
    if (speed > 0.02 || b.vy !== 0) notSettled++;
    if (b.y > W.BALL.r + 1e-6) inMidAir++;
  }
  check('a scored ball always hits the mesh', n > 100 && hitNet === n,
        hitNet + '/' + n);
  check('the ball never passes through the net', through === 0, through);
  check('the ball ends up in the pocket, not in front of the line',
        notInNet === 0, notInNet);
  check('the ball comes to rest instead of stopping dead in mid-air',
        notSettled === 0, notSettled);
  check('it falls to the grass inside the net, it does not hang there',
        inMidAir === 0, inMidAir);

  /* the mesh absorbs: it must not spit the ball back out of the goal */
  var outAgain = 0;
  for (var k = 0; k < 200; k++){
    var bk = { x: 1.2, y: 1.4, z: 0.4, vx: 0, vy: 0, vz: -22 };
    var hit = 0;
    for (var s2 = 0; s2 < 600; s2++){
      var e2 = W.ballStep(bk, 1 / 60);
      if (e2.net) hit = 1;
      if (hit && bk.z > 0) outAgain++;        /* back out in front of the line */
    }
    if (!W.inNet(bk)) outAgain++;
  }
  check('the net never kicks the ball back out of the goal', outAgain === 0,
        outAgain);

  var impact = 0, rebound = 0;
  var bb = { x: 0, y: 1.2, z: 0.3, vx: 0, vy: 0, vz: -24 };
  for (var s3 = 0; s3 < 200; s3++){
    var e3 = W.ballStep(bb, 1 / 60);
    if (e3.net){ impact = e3.net; rebound = bb.vz; break; }
  }
  check('the mesh gives back a fraction of the pace, not all of it',
        impact > 20 && rebound > 0 && rebound < impact * 0.25,
        { impact: impact, rebound: rebound });
})();

console.log('\n10. the sound engine: headroom, and no voice can clip');
(function(){
  var A = mod.AUDIO, S = mod.Sound;
  check('the mix spec is exported so it can be checked without a browser',
        !!A && !!A.limiter && !!A.buses && !!A.peak, Object.keys(A || {}).length);

  var over = Object.keys(A.peak).filter(function(k){ return A.peak[k] > 1; });
  check('no voice can clip on its own (every voice peak is <= 1)',
        over.length === 0, over);
  check('the master gain leaves the limiter somewhere to work',
        A.master > 0 && A.master <= 1, A.master);

  check('there is a real brick wall on the output',
        A.limiter.threshold < 0 && A.limiter.ratio >= 10 && A.limiter.attack <= 0.01,
        A.limiter);
  check('a gentle glue compressor sits before the limiter',
        A.glue.ratio > 1 && A.glue.ratio < A.limiter.ratio &&
        A.glue.threshold < A.limiter.threshold, A.glue);

  var busOver = Object.keys(A.buses).filter(function(k){ return A.buses[k] > 1; });
  check('no bus is driven above unity', busOver.length === 0, A.buses);
  check('the crowd bus sits under the effects it has to compete with',
        A.buses.crowd < A.buses.sfx, A.buses);
  check('the UI bus is the quietest thing in the mix',
        A.buses.ui < A.buses.crowd, A.buses);

  /* the band limit is what stops the old white-noise hiss coming back */
  check('noise is band-limited above the rumble and below the fizz',
        A.noiseBand.lo >= 120 && A.noiseBand.hi <= 8000, A.noiseBand);
  check('the whole mix is high-passed and gently rolled off',
        A.hp >= 20 && A.lp <= 20000, [A.hp, A.lp]);
  check('the voice count is bounded, so a burst cannot pile up',
        A.maxVoices > 4 && A.maxVoices <= 32, A.maxVoices);
  check('muting ramps rather than cuts, so toggling never pops',
        A.fadeMs > 0, A.fadeMs);

  /* every voice must be a safe no-op with no Web Audio present at all */
  var threw = null;
  try {
    S.wake();
    ['kick', 'step', 'net', 'save', 'parry', 'post', 'whistle', 'cheer',
     'groan', 'charge'].forEach(function(name){ S[name](0.5); });
    S.set(false); S.set(true);
  } catch (e){ threw = String((e && e.message) || e); }
  check('every voice is a no-op under node, never a crash', threw === null, threw);
  check('nothing is left running with no audio device',
        S.voiceCount() === 0, S.voiceCount());

  /* world.js is what classifies a save, so it must never be missing */
  check('the save rule has exactly one home (world.js is reachable)',
        !!mod.WorldRef, !!mod.WorldRef);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
