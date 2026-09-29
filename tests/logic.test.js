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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
