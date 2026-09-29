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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
