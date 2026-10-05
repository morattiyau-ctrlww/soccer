/* =========================================================================
   Penalty Shootout 十二碼大戰  —  renderer3d.js
   A real 3D stadium: perspective camera, floodlights with shadows, a goal you
   can see the depth of, a cloth net, an articulated keeper, and a broadcast
   camera that drops into slow motion when it matters.

   Three.js (r160, UMD) is loaded lazily — only if the device actually has
   WebGL — so the 2D fallback appears instantly and the stadium upgrades in
   over the top when it is ready. Units are metres; see world.js.
   ========================================================================= */
'use strict';

var Renderer3D = (function(){

  var T = null;                      /* window.THREE, once loaded          */
  var ready = false, dead = false;
  var renderer, scene, camera, canvas, clock;
  var goal, net, keeper, ball, reticle, crowd, boards, confetti;
  var lights = [], halos = [];
  var W = 0, H = 0;

  /* ------------------------------ quality ------------------------------ */
  var Q = { shadows: true, crowd: 4200, dpr: 1.5, bloom: true, aniso: 4,
            fov: 40 };

  function setQuality(level){
    if (level === 'low'){
      Q.shadows = false; Q.crowd = 2500; Q.dpr = 1; Q.bloom = false; Q.aniso = 1;
    } else if (level === 'med'){
      Q.shadows = true; Q.crowd = 7000; Q.dpr = 1.25; Q.bloom = false; Q.aniso = 2;
    } else {
      Q.shadows = true; Q.crowd = 14000; Q.dpr = 1.5; Q.bloom = true; Q.aniso = 4;
    }
  }

  function want3d(){
    var s = (location.search || '') + (location.hash || '');
    if (/\bq=2d\b/.test(s)) return '2d';
    var m = /q=(low|med|high)/.exec(s);
    if (m) return m[1];
    /* auto: a small screen or few cores gets a quieter stadium */
    var cores = navigator.hardwareConcurrency || 4;
    var small = Math.min(window.screen.width, window.screen.height) < 700;
    return (cores <= 4 || small) ? 'low' : 'high';
  }

  function loadThree(cb){
    if (window.THREE){ T = window.THREE; cb(true); return; }
    var s = document.createElement('script');
    s.src = 'vendor/three.min.js';
    s.onload = function(){ T = window.THREE || null; cb(!!T); };
    s.onerror = function(){ cb(false); };
    document.head.appendChild(s);
  }

  function hasGL(){
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e){ return false; }
  }

  /* ============================== textures ==============================
     The pitch is 90 x 70 m with the goal line at z = 0, so every marking can
     be painted from real dimensions and lands in the right place by itself. */
  var PITCH_W = 90, PITCH_L = 70, PITCH_Z0 = -8, TEXRES = 2048;
  function tx(x){ return (x + PITCH_W / 2) / PITCH_W * TEXRES; }
  function ty(z){ return (1 - (z - PITCH_Z0) / PITCH_L) * TEXRES; }   /* flipY */

  function pitchTexture(){
    var cv = document.createElement('canvas');
    cv.width = cv.height = TEXRES;
    var c = cv.getContext('2d');

    var grd = c.createLinearGradient(0, 0, 0, TEXRES);
    grd.addColorStop(0, '#0a3220');
    grd.addColorStop(0.35, '#0e4227');
    grd.addColorStop(1, '#114c2d');
    c.fillStyle = grd; c.fillRect(0, 0, TEXRES, TEXRES);

    /* mown stripes, 5.5 m deep, running across the pitch */
    for (var i = 0; i < PITCH_L / 5.5; i++){
      var z0 = PITCH_Z0 + i * 5.5;
      c.fillStyle = (i % 2) ? 'rgba(255,255,255,.11)' : 'rgba(0,0,0,.09)';
      c.fillRect(0, ty(z0 + 5.5), TEXRES, ty(z0) - ty(z0 + 5.5));
    }

    /* blade noise, so 90 m of grass is never a flat colour */
    for (var n = 0; n < 26000; n++){
      var a = Math.random() * 0.05;
      c.fillStyle = (Math.random() < 0.5)
        ? 'rgba(255,255,255,' + a.toFixed(3) + ')'
        : 'rgba(0,0,0,' + a.toFixed(3) + ')';
      c.fillRect(Math.random() * TEXRES, Math.random() * TEXRES,
                 2 + Math.random() * 3, 1.4);
    }

    /* the floodlights pool on the middle of the pitch: everything outside the
       pool falls away, which is what makes it read as a night stadium        */
    var pool = c.createRadialGradient(tx(0), ty(4), 0, tx(0), ty(4), TEXRES * 0.52);
    pool.addColorStop(0, 'rgba(255,255,255,0.10)');
    pool.addColorStop(0.40, 'rgba(255,255,255,0.0)');
    pool.addColorStop(0.72, 'rgba(0,0,0,0.16)');
    pool.addColorStop(1, 'rgba(0,0,0,0.46)');
    c.fillStyle = pool; c.fillRect(0, 0, TEXRES, TEXRES);

    /* worn grass: the goalmouth and the penalty spot */
    function wear(cx, cz, r, alpha){
      var g2 = c.createRadialGradient(tx(cx), ty(cz), 0, tx(cx), ty(cz), r);
      g2.addColorStop(0, 'rgba(124,112,70,' + alpha + ')');
      g2.addColorStop(1, 'rgba(124,112,70,0)');
      c.fillStyle = g2;
      c.beginPath(); c.arc(tx(cx), ty(cz), r, 0, 6.29); c.fill();
    }
    wear(0, 2, TEXRES * 0.075, 0.22);
    wear(0, 11, TEXRES * 0.022, 0.28);

    /* the lines, painted 12 cm wide like the real thing */
    c.strokeStyle = 'rgba(255,255,255,.88)';
    c.lineWidth = Math.max(2, 0.12 / PITCH_W * TEXRES);
    c.beginPath();
    c.moveTo(0, ty(0)); c.lineTo(TEXRES, ty(0));                     /* goal line */
    c.moveTo(tx(-20.16), ty(0)); c.lineTo(tx(-20.16), ty(16.5));
    c.lineTo(tx(20.16), ty(16.5)); c.lineTo(tx(20.16), ty(0));       /* penalty area */
    c.moveTo(tx(-9.16), ty(0)); c.lineTo(tx(-9.16), ty(5.5));
    c.lineTo(tx(9.16), ty(5.5)); c.lineTo(tx(9.16), ty(0));          /* goal area */
    c.stroke();

    /* penalty arc: the part of a 9.15 m circle outside the area */
    var a0 = Math.acos(16.5 / 9.15 - 11 / 9.15);
    c.beginPath();
    c.arc(tx(0), ty(11), 9.15 / PITCH_W * TEXRES, a0, Math.PI - a0);
    c.stroke();

    /* the spot */
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.beginPath();
    var sr = 0.11 / PITCH_W * TEXRES;
    c.ellipse(tx(0), ty(11), sr, sr, 0, 0, 6.29);
    c.fill();

    var t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = Q.aniso;
    return t;
  }

  /* a net: white threads on nothing, tiled across each panel */
  function netTexture(){
    var s = 256, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var c = cv.getContext('2d');
    c.strokeStyle = 'rgba(252,255,255,1)';
    c.lineWidth = 4.5;
    var n = 8, step = s / n;
    for (var i = 0; i <= n; i++){
      c.beginPath(); c.moveTo(i * step, 0); c.lineTo(i * step, s); c.stroke();
      c.beginPath(); c.moveTo(0, i * step); c.lineTo(s, i * step); c.stroke();
    }
    var t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /* a soft round blob: glows, light halos, shadows, confetti */
  function blobTexture(){
    var s = 128, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    return new T.CanvasTexture(cv);
  }

  /* =============================== scene =============================== */
  function buildSky(){
    var mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top:    { value: new T.Color('#04060d') },
        mid:    { value: new T.Color('#0b1a2e') },
        bottom: { value: new T.Color('#123a2c') }
      },
      vertexShader:
        'varying float vY;' +
        'void main(){ vY = normalize(position).y;' +
        ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying float vY;' +
        'void main(){ float y = vY;' +
        ' vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.55)) : mix(mid, bottom, pow(-y, 0.5));' +
        ' gl_FragColor = vec4(c, 1.0); }'
    });
    var dome = new T.Mesh(new T.SphereGeometry(260, 24, 16), mat);
    dome.frustumCulled = false;
    scene.add(dome);

    var pts = [];
    for (var i = 0; i < 900; i++){
      var th = Math.random() * Math.PI * 2;
      var ph = Math.random() * Math.PI * 0.42;
      pts.push(240 * Math.sin(ph) * Math.cos(th),
               240 * Math.cos(ph) + 10,
               240 * Math.sin(ph) * Math.sin(th));
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    var stars = new T.Points(g, new T.PointsMaterial({
      color: 0xcfe2ff, size: 1.4, transparent: true, opacity: 0.85,
      fog: false, depthWrite: false
    }));
    stars.frustumCulled = false;
    scene.add(stars);
  }

  function buildPitch(){
    var pitch = new T.Mesh(
      new T.PlaneGeometry(PITCH_W, PITCH_L),
      new T.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.88,
                                   metalness: 0.0 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, 0, PITCH_Z0 + PITCH_L / 2);
    pitch.receiveShadow = true;
    scene.add(pitch);

    /* dark ground beyond the touchline, so the world has no visible edge */
    var outer = new T.Mesh(new T.PlaneGeometry(400, 400),
      new T.MeshStandardMaterial({ color: 0x061a12, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(0, -0.03, 40);
    scene.add(outer);
  }

  function buildLights(){
    scene.add(new T.HemisphereLight(0x9fc4ff, 0x0b2016, 0.28));
    scene.add(new T.AmbientLight(0x8ea9d6, 0.11));

    function flood(x, z, shadows, intensity, angle){
      /* decay 0: a floodlight 26 m up should not fall off like a light bulb */
      var s = new T.SpotLight(0xf2f7ff, intensity, 0, angle, 0.6, 0);
      s.position.set(x, 26, z);
      s.target.position.set(0, 0, x === 0 ? 2 : 0);
      s.castShadow = !!(shadows && Q.shadows);
      if (s.castShadow){
        s.shadow.mapSize.set(2048, 2048);
        s.shadow.camera.near = 6;
        s.shadow.camera.far = 72;
        s.shadow.bias = -0.0008;
        s.shadow.normalBias = 0.02;
        s.shadow.radius = 2.2;
      }
      scene.add(s); scene.add(s.target);
      lights.push(s);
      return s;
    }
    flood(-22, 18, true, 3.1, 0.72);             /* the key: casts the shadows */
    flood(22, 18, false, 1.8, 0.72);             /* fill, so nothing goes black */
    flood(0, -20, false, 1.0, 0.85);             /* rim light from behind the goal */

    /* the towers themselves, up behind the goal where you can see them */
    var panelMat = new T.MeshBasicMaterial({ color: 0xfff4d2 });
    var mastMat = new T.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.85 });
    var glow = blobTexture();
    [[-30, -26], [30, -26], [0, -34]].forEach(function(p){
      var mast = new T.Mesh(new T.CylinderGeometry(0.45, 0.9, 31, 8), mastMat);
      mast.position.set(p[0], 15.5, p[1]);
      scene.add(mast);
      var panel = new T.Mesh(new T.BoxGeometry(10, 3.6, 0.7), panelMat.clone());
      panel.position.set(p[0], 31.4, p[1]);
      panel.lookAt(0, 0, 8);
      scene.add(panel);
      var halo = new T.Sprite(new T.SpriteMaterial({
        map: glow, color: 0xe6f0ff, transparent: true, opacity: 0.5,
        blending: T.AdditiveBlending, depthWrite: false, fog: false
      }));
      halo.scale.set(34, 34, 1);
      halo.position.copy(panel.position);
      scene.add(halo);
      halos.push(halo);
    });
  }

  function buildGoalFrame(){
    var white = new T.MeshStandardMaterial({ color: 0xf7faff,
                                             roughness: 0.3, metalness: 0.15 });
    var R = WORLD.GOAL.postR, GH = WORLD.GOAL.h, HW = WORLD.GOAL.w / 2;
    var stick = new T.CylinderGeometry(R, R, GH, 20);
    var left = new T.Mesh(stick, white);
    left.position.set(-HW, GH / 2, 0);
    var right = new T.Mesh(stick, white);
    right.position.set(HW, GH / 2, 0);
    var bar = new T.Mesh(new T.CylinderGeometry(R, R, HW * 2 + R * 2, 20), white);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GH, 0);
    [left, right, bar].forEach(function(m){
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
    });

    /* the net, as four panels so the goal reads as a real box with depth */
    var src = netTexture();
    function panelGeo(w, h, rx, ry, sx, sy){
      var t = src.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(rx, ry);
      return new T.Mesh(new T.PlaneGeometry(w, h, sx || 1, sy || 1),
        new T.MeshBasicMaterial({
          map: t, transparent: true, opacity: 0.85, side: T.DoubleSide,
          depthWrite: false, fog: true
        }));
    }
    var D = WORLD.GOAL.depth;
    /* a dark recess behind the line, so the goal mouth reads as a hole in the
       grass rather than an empty frame floating on it */
    var recess = new T.Mesh(new T.PlaneGeometry(HW * 2, GH),
      new T.MeshBasicMaterial({ color: 0x05090f, transparent: true,
                                opacity: 0.42, depthWrite: false }));
    recess.position.set(0, GH / 2, -D + 0.02);
    scene.add(recess);

    /* the back panel carries enough vertices for the ball to dent it */
    var back = panelGeo(HW * 2, GH, 42, 15, 28, 14);
    back.position.set(0, GH / 2, -D);
    scene.add(back);
    net = back;
    var base = new Float32Array(back.geometry.attributes.position.count * 3);
    base.set(back.geometry.attributes.position.array);
    back.userData.base = base;
    back.userData.dirty = false;
    back.userData.hit = null;
    var top = panelGeo(HW * 2, D, 42, 11);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, GH, -D / 2);
    scene.add(top);
    [-1, 1].forEach(function(s){
      var side = panelGeo(D, GH, 11, 15);
      side.rotation.y = Math.PI / 2;
      side.position.set(s * HW, GH / 2, -D / 2);
      scene.add(side);
    });
    goal = { back: back };
  }

  /* ---------------------------- the stadium ---------------------------- */
  var CROWD = [];                    /* per-instance animation data         */

  function buildStands(){
    var conc = new T.MeshStandardMaterial({ color: 0x121722, roughness: 0.95 });
    var roofMat = new T.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 1 });

    /* a straight stand: `rows` steps receding away from the pitch */
    function stand(cx, cz, spanW, axis, out, rows){
      for (var i = 0; i < rows; i++){
        var y = 1.0 + i * 0.62;
        var depth = 0.95;
        var step = new T.Mesh(new T.BoxGeometry(
          axis === 'z' ? spanW : depth, y + 0.62,
          axis === 'z' ? depth : spanW), conc);
        step.position.set(
          axis === 'z' ? cx : cx + out * (i * depth + depth / 2),
          (y + 0.62) / 2 - 0.3,
          axis === 'z' ? cz + out * (i * depth + depth / 2) : cz);
        step.receiveShadow = true;
        scene.add(step);
      }
      var topY = 1.0 + rows * 0.62;
      var roof = new T.Mesh(new T.BoxGeometry(
        axis === 'z' ? spanW + 4 : rows * depth + 4, 1.4,
        axis === 'z' ? rows * depth + 4 : spanW + 4), roofMat);
      roof.position.set(axis === 'z' ? cx : cx + out * (rows * depth / 2),
                        topY + 2.6,
                        axis === 'z' ? cz + out * (rows * depth / 2) : cz);
      scene.add(roof);
      /* a lit fascia under the roof edge, the way real stands glow */
      var fascia = new T.Mesh(new T.BoxGeometry(
        axis === 'z' ? spanW + 4 : rows * depth + 4, 0.5,
        axis === 'z' ? rows * depth + 4 : spanW + 4),
        new T.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.8,
                                     emissive: 0x101828 }));
      fascia.position.set(roof.position.x, topY + 1.75, roof.position.z);
      scene.add(fascia);
    }
    /* the goal is at z = 0 and the camera sits at z = +19, so the stand the
       player actually looks at is the one behind the goal — keep it low enough
       that the roof, the floodlights and the sky all stay in frame           */
    stand(0, -11.5, 62, 'z', -1, 10);
    stand(-32, 16, 46, 'x', -1, 11);
    stand(32, 16, 46, 'x', 1, 11);
    stand(0, 42, 52, 'z', 1, 10);
  }

  /* A packed crowd, not a lattice: every tier gets three sub-rows of seats and
     the spacing is fixed in metres, then scaled down to the instance budget. */
  function buildCrowd(){
    var rows = [];
    function tierRow(fixed, from, to, y, axis, out){ 
      rows.push({ fixed: fixed, from: from, to: to, y: y, axis: axis, out: out });
    }
    function tiers(fixed, from, to, axis, out, count, sub){
      for (var i = 0; i < count; i++){
        for (var s = 0; s < sub; s++){
          tierRow(fixed + out * (i * 0.95 + 0.14 + s * 0.29),
                  from, to, 1.0 + i * 0.62, axis, out);
        }
      }
    }
    tiers(-11.5, -30, 30, 'z', -1, 10, 4);
    tiers(-32, -6, 38, 'x', -1, 11, 3);
    tiers(32, -6, 38, 'x', 1, 11, 3);
    tiers(42, -25, 25, 'z', 1, 10, 3);

    /* work out how many people 0.48 m of seat spacing would need, then scale */
    var span = 0, need = 0;
    rows.forEach(function(r){ span = r.to - r.from; need += span / 0.48; });
    var factor = Math.min(1, Q.crowd / Math.max(1, need));

    var geo = new T.SphereGeometry(0.15, 5, 4);
    var mat = new T.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    var total = 0;
    var per = rows.map(function(r){
      var n = Math.max(8, Math.round((r.to - r.from) / 0.48 * factor));
      total += n;
      return n;
    });

    var mesh = new T.InstancedMesh(geo, mat, total);
    var col = new T.Color(), m = new T.Matrix4();
    var idx = 0;
    rows.forEach(function(r, ri){
      for (var n = 0; n < per[ri]; n++){
        var t = (n + 0.5) / per[ri];
        var along = r.from + (r.to - r.from) * t + (Math.random() - 0.5) * 0.34;
        var x = r.axis === 'z' ? along : r.fixed;
        var z = r.axis === 'z' ? r.fixed : along;
        var y = r.y + 0.30 + Math.random() * 0.10;
        var s = 0.62 + Math.random() * 0.34;
        m.makeScale(s, s * (1 + Math.random() * 0.25), s);
        m.setPosition(x, y, z);
        mesh.setMatrixAt(idx, m);
        var c = Math.random();
        if (c < 0.04) col.setHSL(0.11, 0.40, 0.30);
        else if (c < 0.11) col.setHSL(0.56, 0.24, 0.22);
        else if (c < 0.22) col.setHSL(0.33, 0.16, 0.16);
        else if (c < 0.38) col.setHSL(0.62, 0.16, 0.09);
        else col.setHSL(0.60, 0.14, 0.04 + Math.random() * 0.045);
        mesh.setColorAt(idx, col);
        CROWD.push({ i: idx, x: x, y: y, z: z, s: s, ph: Math.random() * 6.28 });
        idx++;
      }
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    crowd = mesh;
  }

  /* ------------------------- the advertising boards ------------------------- */
  var BOARD_TEXT = 'AI AGENT  ·  SOLVE PROBLEMS  ·  PENALTY SHOOTOUT  ·  ' +
                   '十二碼大戰  ·  ';
  function boardsTexture(){
    var w = 2048, h = 120, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c = cv.getContext('2d');
    c.fillStyle = '#04140c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7cffb2';
    /* real boards are only a few centimetres of text lit from behind: at this
       canvas scale that is a ~20 px face on a 62 m board worth of pixels     */
    c.font = '700 20px "PingFang HK", system-ui, sans-serif';
    c.textBaseline = 'middle';
    var t = new T.CanvasTexture(cv);
    t.wrapS = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    t.userData = { cv: cv, ctx: c, w: w, h: h, offset: 0, last: -1 };
    return t;
  }
  function scrollBoards(tex, time){
    var u = tex.userData;
    var off = Math.floor((time * 120) % 3000);
    if (off === u.last) return;
    u.last = off;
    u.ctx.fillStyle = '#04140c'; u.ctx.fillRect(0, 0, u.w, u.h);
    u.ctx.fillStyle = '#7cffb2';
    u.ctx.font = '700 20px "PingFang HK", system-ui, sans-serif';
    u.ctx.textBaseline = 'middle';
    var txt = BOARD_TEXT + BOARD_TEXT + BOARD_TEXT;
    u.ctx.fillText(txt, -off, u.h / 2);
    u.ctx.fillText(txt, -off + u.w, u.h / 2);
    tex.needsUpdate = true;
  }

  function buildBoards(){
    var tex = boardsTexture();
    var mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
    var front = new T.Mesh(new T.PlaneGeometry(62, 1.5), mat);
    front.position.set(0, 0.95, -8.1);
    scene.add(front);
    [-1, 1].forEach(function(s){
      var side = new T.Mesh(new T.PlaneGeometry(50, 1.5), mat);
      side.position.set(s * 36.2, 0.95, 18);
      side.rotation.y = -s * Math.PI / 2;
      scene.add(side);
    });
    boards = { tex: tex };
  }

  /* ------------------------------ the keeper -------------------------------
     A joint hierarchy in real anthropometry for a 1.90 m athlete: tapered
     limbs rather than boxes, deltoids, a number on his back, knee pads, socks
     with a cuff, cleats with a sole and studs, and gloves with fingers that
     can actually close. The fingers exist because the `catch` state has to be
     able to hold the ball, not just be near it.                            */
  var KIT = { shirt: 0xffc93c, shirt2: 0xe07b1c, trim: 0x141b2b,
              glove: 0x2ec4b6, gloveDark: 0x17897f,
              shorts: 0x1b2a4a, skin: 0xf0c49c, skinDark: 0xd8a374,
              hair: 0x1d2433, boot: 0x0d1626, sole: 0xf2f5fa, sock: 0x22304d,
              pad: 0x2b3a55 };

  /* the number on his back, painted rather than modelled */
  function numberTexture(n){
    var s = 128, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, s, s);
    c.fillStyle = 'rgba(20,27,43,.92)';
    c.font = '900 92px "Helvetica Neue", system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), s / 2, s / 2 + 4);
    var t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function buildKeeper(){
    var root = new T.Group();
    root.position.set(0, 0, 0.35);
    var g = { arm: {}, leg: {}, hand: {} };

    function mat(col, rough, metal){
      return new T.MeshStandardMaterial({ color: col,
        roughness: rough === undefined ? 0.7 : rough, metalness: metal || 0 });
    }
    function box(w, h, d, m, x, y, z, parent){
      var mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      (parent || root).add(mesh);
      return mesh;
    }
    /* a tapered limb: capsule-ish limbs read as muscle, boxes read as Lego */
    function limb(rTop, rBot, len, m, parent, flatZ){
      var mesh = new T.Mesh(new T.CylinderGeometry(rTop, rBot, len, 12, 1), m);
      if (flatZ) mesh.scale.z = flatZ;
      mesh.position.y = -len / 2;                 /* hangs from its joint */
      (parent || root).add(mesh);
      return mesh;
    }
    function ball3(r, m, x, y, z, parent, seg){
      var mesh = new T.Mesh(new T.SphereGeometry(r, seg || 14, (seg || 14) - 2), m);
      mesh.position.set(x, y, z);
      (parent || root).add(mesh);
      return mesh;
    }

    /* ---- pelvis + torso: pivots at the pelvis so a dive rotates the lot --- */
    var hips = new T.Group(); hips.position.y = 0.94; root.add(hips);
    g.hips = hips;
    box(0.33, 0.23, 0.21, mat(KIT.shorts), 0, -0.055, 0, hips);
    box(0.335, 0.05, 0.215, mat(KIT.trim, 0.8), 0, 0.06, 0, hips);   /* waistband */

    var chest = new T.Group(); chest.position.y = 0.075; hips.add(chest);
    g.chest = chest;
    /* the torso tapers: broad across the chest, narrow at the waist */
    var torso = new T.Mesh(new T.CylinderGeometry(0.215, 0.155, 0.58, 14, 1),
                           mat(KIT.shirt, 0.72));
    torso.scale.z = 0.60;
    torso.position.y = 0.30;
    chest.add(torso);
    /* the flare of the shirt over the hips, so the kit is not skin-tight */
    var hem = new T.Mesh(new T.CylinderGeometry(0.168, 0.185, 0.10, 14, 1),
                         mat(KIT.shirt, 0.8));
    hem.scale.z = 0.62; hem.position.y = 0.015; chest.add(hem);
    /* collar, and the number patch on his back */
    var collar = new T.Mesh(new T.CylinderGeometry(0.075, 0.085, 0.045, 12, 1),
                            mat(KIT.trim, 0.8));
    collar.scale.z = 0.7; collar.position.y = 0.605; chest.add(collar);
    var num = new T.Mesh(new T.PlaneGeometry(0.20, 0.20),
      new T.MeshStandardMaterial({ map: numberTexture(1), transparent: true,
                                   roughness: 0.85 }));
    num.position.set(0, 0.34, -0.134);
    num.rotation.y = Math.PI;
    chest.add(num);

    /* ---- head: enough of a face to carry the disappointment -------------- */
    var neck = new T.Group(); neck.position.y = 0.63; chest.add(neck);
    g.neck = neck;
    var neckMesh = new T.Mesh(new T.CylinderGeometry(0.055, 0.062, 0.10, 10),
                              mat(KIT.skin, 0.85));
    neckMesh.position.y = 0.05; neck.add(neckMesh);
    var head = ball3(0.115, mat(KIT.skin, 0.82), 0, 0.175, 0, neck, 18);
    head.scale.set(0.95, 1.1, 1.0);
    var hair = new T.Mesh(new T.SphereGeometry(0.118, 18, 12, 0, 6.29, 0, 1.6),
                          mat(KIT.hair, 0.95));
    hair.position.y = 0.185; hair.scale.set(0.98, 1.05, 1.02); neck.add(hair);
    /* eyes and a brow: at this scale that is all it takes for a head tilt to
       read as a mood */
    [-1, 1].forEach(function(s){
      ball3(0.017, mat(0x101826, 0.5), s * 0.042, 0.185, 0.105, neck, 8);
    });
    g.brow = box(0.115, 0.014, 0.02, mat(0x161d2b, 0.9), 0, 0.212, 0.104, neck);

    /* ---- arms: shoulder -> elbow -> glove (with fingers) ----------------- */
    [-1, 1].forEach(function(s){
      var side = s < 0 ? 'l' : 'r';
      var sh = new T.Group();
      sh.position.set(s * 0.205, 0.545, 0);
      chest.add(sh);
      /* deltoid, then a tapered upper arm */
      ball3(0.082, mat(KIT.shirt, 0.75), 0, -0.02, 0, sh);
      limb(0.072, 0.056, 0.30, mat(KIT.shirt, 0.75), sh);
      box(0.145, 0.05, 0.155, mat(KIT.shirt2, 0.8), 0, -0.275, 0, sh);  /* sleeve hem */

      var el = new T.Group(); el.position.y = -0.30; sh.add(el);
      limb(0.055, 0.046, 0.26, mat(KIT.skin, 0.85), el);   /* bare forearm */

      /* the hand: a palm and five digits that can close on a ball */
      var hand = new T.Group();
      hand.position.y = -0.28;
      el.add(hand);
      var palm = box(0.105, 0.105, 0.055, mat(KIT.glove, 0.62), 0, 0, 0, hand);
      var fingers = [];
      for (var f = 0; f < 4; f++){
        var knuckle = new T.Group();
        knuckle.position.set(-0.038 + f * 0.025, -0.052, 0.004);
        hand.add(knuckle);
        var seg = new T.Mesh(new T.BoxGeometry(0.022, 0.062, 0.045),
                             mat(KIT.glove, 0.62));
        seg.position.y = -0.031;
        knuckle.add(seg);
        fingers.push(knuckle);
      }
      var thumb = new T.Group();
      thumb.position.set(s * 0.048, -0.012, 0.012);
      thumb.rotation.z = -s * 0.7;
      hand.add(thumb);
      var thumbSeg = new T.Mesh(new T.BoxGeometry(0.026, 0.058, 0.042),
                                mat(KIT.gloveDark, 0.6));
      thumbSeg.position.y = -0.028;
      thumb.add(thumbSeg);

      g.arm[side] = { sh: sh, el: el, glove: palm, hand: hand };
      g.hand[side] = { palm: palm, fingers: fingers, thumb: thumb };

      /* the fingers rest half-open until a catch closes them */
      fingers.forEach(function(k){ k.rotation.x = -0.45; });
    });

    /* ---- legs: hip -> knee -> boot, with a pad, a sock and cleats -------- */
    [-1, 1].forEach(function(s){
      var side = s < 0 ? 'l' : 'r';
      var hip = new T.Group();
      hip.position.set(s * 0.115, 0, 0);
      hips.add(hip);
      box(0.17, 0.42, 0.175, mat(KIT.shorts), 0, -0.21, 0, hip);
      limb(0.096, 0.072, 0.40, mat(KIT.skin, 0.85), hip);   /* thigh, in shorts */

      var knee = new T.Group(); knee.position.y = -0.44; hip.add(knee);
      ball3(0.075, mat(KIT.pad, 0.8), 0, 0.005, 0.012, knee);   /* knee pad */
      limb(0.068, 0.052, 0.40, mat(KIT.sock, 0.9), knee);       /* long sock */
      box(0.125, 0.035, 0.135, mat(KIT.trim, 0.85), 0, -0.03, 0, knee);  /* cuff */

      var foot = new T.Group(); foot.position.set(0, -0.44, 0.005); knee.add(foot);
      /* the boot: upper, sole and studs — this is what a keeper is judged on */
      var boot = new T.Mesh(new T.BoxGeometry(0.10, 0.075, 0.26),
                            mat(KIT.boot, 0.45));
      boot.position.set(0, -0.045, 0.055);
      foot.add(boot);
      var toe = new T.Mesh(new T.BoxGeometry(0.095, 0.055, 0.06),
                           mat(KIT.boot, 0.4));
      toe.position.set(0, -0.05, 0.175);
      foot.add(toe);
      var sole = new T.Mesh(new T.BoxGeometry(0.104, 0.018, 0.29),
                            mat(KIT.sole, 0.35));
      sole.position.set(0, -0.088, 0.062);
      foot.add(sole);
      for (var st = 0; st < 6; st++){
        var stud = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.016, 6),
                              mat(KIT.sole, 0.3));
        stud.position.set((st % 2 ? 0.03 : -0.03), -0.10, -0.05 + st * 0.045);
        foot.add(stud);
      }
      g.leg[side] = { hip: hip, knee: knee, boot: boot, foot: foot };
    });

    root.traverse(function(o){
      if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; }
    });
    scene.add(root);
    keeper = { root: root, g: g };
  }

  /* --------------------------- keeper animation -----------------------------
     A named state machine driving keyframed poses (see WORLD.keeperState for
     the state decision, so the flat renderer and this one cannot disagree):

       idle      alive on his line: weight shifts, gloves up, a weight bounce
       scan      leaning with your aim, crouching into your power
       dive_*    three keys — wind-up, extension, land — per height and side
       catch     the fingers close and the ball is held in the glove
       deflect   a straight arm punching the ball away
       conceded  beaten: he slumps, or turns and watches it go past him

     Every channel is smoothed on its way to the target, so states cross-fade
     instead of snapping.                                                    */
  var A = { lean: 0, lift: 0, crouch: 0.12, arm: 0.50, elbow: 0.34, split: 0.12,
            knee: 0.08, twist: 0, x: 0, y: 0, z: 0.35, grip: 0.05, head: 0,
            watch: 0 };

  function approach(v, target, rate, dt){
    return v + (target - v) * (1 - Math.exp(-rate * dt));
  }

  /* ---- keyframes: a pose is a flat bag of channels, a state is a list of
     keys in time, and each segment can carry its own easing ---------------- */
  var CHANNELS = ['lean', 'lift', 'crouch', 'arm', 'elbow', 'split',
                  'knee', 'twist', 'x', 'y', 'z', 'grip', 'head', 'watch'];

  function blend(a, b, u){
    var out = {};
    for (var i = 0; i < CHANNELS.length; i++){
      var k = CHANNELS[i];
      out[k] = lerp(a[k], b[k], u);
    }
    return out;
  }

  /* evaluate a keyframed pose at normalized time k (0..1) */
  function keyed(keys, k){
    k = WORLD.clamp(k, 0, 1);
    var a = keys[0], b = keys[keys.length - 1];
    for (var i = 0; i < keys.length - 1; i++){
      if (k >= keys[i].at && k <= keys[i + 1].at){ a = keys[i]; b = keys[i + 1]; break; }
    }
    var span = Math.max(1e-4, b.at - a.at);
    var u = (k - a.at) / span;
    /* the extension is explosive and the landing settles: ease per segment */
    if (a.ease === 'out') u = 1 - Math.pow(1 - u, 3);
    else if (a.ease === 'in') u = u * u;
    else u = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    return blend(a.pose, b.pose, u);
  }

  /* a complete pose, with anything unstated inherited from the last frame */
  function full(p){
    var out = {};
    for (var i = 0; i < CHANNELS.length; i++) out[CHANNELS[i]] = A[CHANNELS[i]];
    for (var k in p) if (p.hasOwnProperty(k)) out[k] = p[k];
    return out;
  }

  var BAND = {
    low:  { lean: 1.05, lift: 0.12, knee: 0.55, crouch: -0.16, z: 0.30 },
    mid:  { lean: 0.88, lift: 0.34, knee: 0.30, crouch: -0.05, z: 0.38 },
    high: { lean: 0.62, lift: 0.58, knee: 0.24, crouch:  0.02, z: 0.44 }
  };

  /* ---- idle: never still. He bounces, shifts weight and barks at you ---- */
  function poseIdle(){
    var t = S.time;
    return full({
      crouch: 0.30 + Math.sin(t * 2.3) * 0.045,
      arm:    0.62 + Math.sin(t * 2.3 + 1.1) * 0.06,
      elbow:  0.46,
      split:  0.18,
      knee:   0.24 + Math.sin(t * 2.3 + 0.6) * 0.05,
      x: Math.sin(t * 1.15) * 0.20,
      y: Math.abs(Math.sin(t * 2.3)) * 0.018,        /* the weight bounce */
      lift: 0, z: 0.35,
      twist: Math.sin(t * 1.15) * 0.10,
      grip: 0.06 + Math.sin(t * 2.3) * 0.04,
      head: -0.04, watch: Math.sin(t * 0.7) * 0.10
    });
  }

  /* ---- scan: he reads the run-up. Lean follows your aim, crouch your power */
  function poseScan(){
    var t = S.time;
    var side = Math.abs(S.aim.x) < 0.10 ? 0 : (S.aim.x > 0 ? 1 : -1);
    var p = WORLD.clamp(S.power, 0, 1);
    return full({
      lean:  -side * (0.10 + p * 0.10),
      crouch: 0.34 + p * 0.14 + Math.sin(t * 3.1) * 0.03,
      arm:    0.68 + p * 0.14,
      elbow:  0.50 - p * 0.10,
      split:  0.20,
      knee:   0.30 + p * 0.16,
      x: Math.sin(t * 3.4) * 0.09 + side * 0.10,
      y: Math.abs(Math.sin(t * 3.1)) * 0.022,
      lift: 0, z: 0.35,
      twist: side * 0.12,
      grip:  0.10 + p * 0.15,
      head:  -0.06, watch: side * 0.22
    });
  }

  /* ---- the dive: wind-up, extension, land. Three keys, per band + side --- */
  function poseDive(band, sign, planX, p){
    var b = BAND[band] || BAND.mid;
    var feint = (S.plan && S.plan.read && S.diff === 'legend') ? 1 : 0;
    var keys = [
      { at: 0.00, ease: 'out', pose: full({
          lean: sign * 0.14, lift: 0, crouch: 0.50, arm: 0.34, elbow: 0.62,
          split: 0.22, knee: 0.60, x: -sign * 0.10, twist: -sign * 0.10,
          grip: 0.10, head: 0.02, y: 0, z: 0.35 }) },
      { at: 0.26, ease: 'out', pose: full({
          lean: -sign * b.lean * 0.58, lift: b.lift * 0.45, crouch: -0.02,
          arm: 1.20, elbow: 0.16, split: 0.34, knee: b.knee * 0.80,
          x: sign * 0.18, twist: sign * 0.20, z: b.z,
          grip: 0.18, head: -0.06, y: 0, watch: sign * 0.20 }) },
      { at: 0.72, ease: 'inout', pose: full({
          lean: -sign * b.lean, lift: b.lift, crouch: b.crouch,
          arm: 1.58, elbow: 0.03, split: 0.30, knee: b.knee,
          x: planX, twist: sign * 0.30, z: b.z,
          grip: 0.24, head: -0.10, y: 0, watch: sign * 0.34 }) },
      { at: 1.00, ease: 'out', pose: full({
          lean: -sign * b.lean * 0.90, lift: b.lift * 0.52, crouch: b.crouch * 0.4,
          arm: 1.34, elbow: 0.14, split: 0.26, knee: b.knee * 0.7,
          x: planX, twist: sign * 0.26, z: b.z,
          grip: 0.20, head: 0.04, y: 0, watch: sign * 0.28 }) }
    ];
    var out = keyed(keys, p);
    /* the feint: on Legend he shows you one way before he goes the other */
    if (feint && p < 0.42) out.x -= sign * 0.30 * (1 - p / 0.42);
    return out;
  }

  /* the band and the side, read off the keeper's committed plan */
  function planShape(){
    var plan = S.plan || { x: 0, y: 0.4 };
    var sign = Math.abs(plan.x) < 0.14 ? 0 : (plan.x > 0 ? 1 : -1);
    var band = plan.y < 0.45 ? 'low' : (plan.y < 0.85 ? 'mid' : 'high');
    return { plan: plan, sign: sign, band: band,
             planX: plan.x * (WORLD.GOAL.w / 2) - sign * 0.42 };
  }

  /* ---- catch: the ball is held, so the fingers close around it ----------- */
  function poseCatch(band, sign, planX, after){
    var b = BAND[band] || BAND.mid;
    return {
      lean:  -sign * (b.lean * 0.70),
      lift:  b.lift * 0.62,
      crouch: 0.05,
      arm:   1.30 - Math.min(0.45, after * 1.4),     /* the arms draw it in */
      elbow: 0.42 + Math.min(0.35, after * 0.9),
      split: 0.24, knee: b.knee * 0.7,
      twist: sign * 0.22,
      x: planX, y: 0, z: b.z,
      grip: Math.min(1, 0.35 + after * 2.4),         /* the fingers close fast */
      head: -0.24 - Math.min(0.20, after * 0.5), watch: -sign * 0.10
    };
  }

  /* ---- deflect: a straight arm, an open hand, the ball going away -------- */
  function poseDeflect(band, sign, planX, after){
    var b = BAND[band] || BAND.mid;
    return {
      lean:  -sign * (b.lean * 0.86),
      lift:  b.lift * 0.85,
      crouch: b.crouch * 0.5,
      arm:   1.62, elbow: 0.02,
      split: 0.36, knee: b.knee * 1.05,
      twist: sign * 0.34,
      x: planX, y: 0, z: b.z,
      grip: 0.12,                                    /* a fist, not a hold */
      head: -0.12, watch: sign * 0.30
    };
  }

  /* ---- conceded: beaten. A goal is a slump, a miss he watches go by ------ */
  function poseConceded(band, sign, planX, after, scored){
    var b = BAND[band] || BAND.mid;
    var s = WORLD.clamp(after * 1.2, 0, 1);
    var slump = scored ? s : s * 0.5;
    return {
      lean:  -sign * (b.lean * (1 - slump * 0.45)),
      lift:  b.lift * (1 - slump * 0.75),
      crouch: b.crouch + slump * (scored ? 0.75 : 0.20),
      arm:   (scored ? 1.34 - slump * 1.0 : 1.50 - slump * 0.5),
      elbow: 0.14 + slump * (scored ? 0.85 : 0.35),
      split: 0.26 + slump * 0.10,
      knee:  b.knee + slump * 0.55,
      twist: -sign * slump * 0.16,
      x: planX, y: 0, z: b.z,
      grip: 0.05,
      head: scored ? 0.10 + slump * 0.45 : -0.20,    /* head down, or up */
      watch: scored ? -sign * 0.10 * slump : sign * 0.45
    };
  }

  /* ---------------------------- drive the rig ----------------------------- */
  function applyPose(st){
    var g = keeper.g, diving = (st.state === 'dive' || st.state === 'catch' ||
                               st.state === 'deflect' || st.state === 'conceded');
    var sign = Math.abs((S.plan && S.plan.x) || 0) < 0.14 ? 0
             : ((S.plan.x > 0) ? 1 : -1);

    keeper.root.position.set(A.x, A.lift + A.y, A.z);
    keeper.root.rotation.set(0, A.twist, A.lean);
    g.hips.rotation.z = -A.lean * 0.18;
    g.chest.rotation.z = -A.lean * 0.12;
    g.chest.rotation.x = A.crouch;
    g.neck.rotation.x = -A.crouch * 0.42 + A.head;
    g.neck.rotation.z = -A.lean * 0.10;
    g.neck.rotation.y = A.watch;

    /* arms: the leading glove reaches for where the ball is going, and the
       fingers close around it when he has it */
    ['l', 'r'].forEach(function(side){
      var s = side === 'l' ? -1 : 1;
      var lead = sign === 0 ? 0 : (s === sign ? 1 : 0.55);
      var arm = g.arm[side];
      arm.sh.rotation.z = -s * (A.arm * (0.55 + lead * 0.75));
      arm.sh.rotation.x = A.arm * (0.26 + lead * 0.5) * (diving ? 1 : 0.4);
      arm.el.rotation.z = -s * A.elbow;
      arm.el.rotation.x = diving ? lead * -0.35 : -A.elbow * 0.4;
      var h = g.hand[side], close = WORLD.clamp(A.grip, 0, 1);
      for (var f = 0; f < h.fingers.length; f++){
        h.fingers[f].rotation.x = -0.45 - close * 1.35;
      }
      h.thumb.rotation.z = -s * (0.70 + close * 0.30);
    });

    /* legs: the trailing leg straightens, the leading knee folds */
    ['l', 'r'].forEach(function(side){
      var s = side === 'l' ? -1 : 1;
      var leg = g.leg[side];
      var trail = sign !== 0 && s === -sign;
      leg.hip.rotation.z = -s * A.split * (diving ? 1.6 : 1);
      leg.hip.rotation.x = diving ? (trail ? -0.55 : 0.35) : -A.crouch * 0.5;
      leg.knee.rotation.x = diving ? (trail ? 0.15 : A.knee * 1.6) : A.knee;
      leg.foot.rotation.x = diving ? (trail ? 0.35 : -0.18) : 0;
    });

    /* the ball is about to be read off a glove, so bring the rig up to date */
    keeper.root.updateMatrixWorld(true);
  }

  function keeperPose(dt){
    var v = S.shot ? S.shot.verdict : null;
    var after = ball ? (ball.after || 0) : 0;
    var st = WORLD.keeperState({
      phase: S.phase, plan: S.plan, t: S.flight.t, dur: S.flight.dur,
      verdict: v, saveType: S.shot ? S.shot.saveType : null
    });

    var sh = planShape();
    var sign = sh.sign, band = sh.band, planX = sh.planX;
    var tgt;
    if (st.state === 'scan') tgt = poseScan();
    else if (st.state === 'dive') tgt = poseDive(band, sign, planX, st.p);
    else if (st.state === 'catch') tgt = full(poseCatch(band, sign, planX, after));
    else if (st.state === 'deflect') tgt = full(poseDeflect(band, sign, planX, after));
    else if (st.state === 'conceded'){
      tgt = full(poseConceded(band, sign, planX, after, v === 'goal'));
    } else tgt = poseIdle();

    /* how fast he gets there: a dive is violent, a slump is slow */
    var rate = (st.state === 'dive') ? 13
             : (st.state === 'idle') ? 4.5
             : (st.state === 'scan') ? 6 : 7;
    for (var i = 0; i < CHANNELS.length; i++){
      var c = CHANNELS[i];
      A[c] = approach(A[c], tgt[c], rate, dt);
    }
    applyPose(st);
    keeper.state = st;
    return st;
  }

  /* where a glove actually is in the world, for parenting the held ball */
  function gloveWorld(side, out){
    var arm = keeper && keeper.g.arm[side || 'l'];
    if (!arm) return out.set(0, 0.3, 0.35);
    return out.setFromMatrixPosition(arm.glove.matrixWorld);
  }

  /* -------------------------------- the ball -------------------------------- */
  function ballTexture(){
    var s = 512, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var c = cv.getContext('2d');
    c.fillStyle = '#f7f9fc'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#14181f';
    function penta(cx, cy, r, rot){
      c.beginPath();
      for (var i = 0; i < 5; i++){
        var a = rot + i * Math.PI * 2 / 5;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.closePath(); c.fill();
    }
    penta(s * 0.5, s * 0.5, s * 0.13, 0.3);
    penta(s * 0.12, s * 0.2, s * 0.10, 1.1);
    penta(s * 0.88, s * 0.2, s * 0.10, 0.6);
    penta(s * 0.12, s * 0.82, s * 0.10, 2.2);
    penta(s * 0.88, s * 0.82, s * 0.10, 1.8);
    penta(s * 0.5, s * 0.02, s * 0.10, 0.9);
    penta(s * 0.5, s * 0.98, s * 0.10, 0.2);
    c.strokeStyle = 'rgba(20,24,31,.35)'; c.lineWidth = 3;
    c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.38, 0, 6.29); c.stroke();
    var t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function buildBall(){
    var R = WORLD.BALL.r;
    var mesh = new T.Mesh(new T.SphereGeometry(R, 32, 24),
      new T.MeshStandardMaterial({ map: ballTexture(), roughness: 0.34,
                                   metalness: 0.02 }));
    mesh.castShadow = true;
    mesh.position.set(0, R, WORLD.PITCH.spot);
    scene.add(mesh);

    /* a motion trail: additive sprites that fade out behind the ball */
    var trail = [];
    var glow = blobTexture();
    for (var i = 0; i < 16; i++){
      var sp = new T.Sprite(new T.SpriteMaterial({
        map: glow, color: 0xffffff, transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false, fog: false
      }));
      sp.scale.set(R * 2, R * 2, 1);
      sp.visible = false;
      scene.add(sp);
      trail.push(sp);
    }
    ball = { mesh: mesh, trail: trail, hist: [], spin: 0 };
  }

  /* ------------------------------ the AI overlay ----------------------------
     The keeper's belief, drawn on the goal mouth. It is not decoration: this
     is the exact distribution his dive is sampled from, so a player who reads
     it can bait him — and he learns while they do.                          */
  var aiHeat = null;

  function buildAiHeat(){
    var cv = document.createElement('canvas');
    cv.width = 360; cv.height = 132;
    var tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    var mat = new T.MeshBasicMaterial({ map: tex, transparent: true,
      opacity: 0, depthWrite: false, depthTest: false,
      blending: T.AdditiveBlending, side: T.DoubleSide });
    var mesh = new T.Mesh(new T.PlaneGeometry(WORLD.GOAL.w, WORLD.GOAL.h), mat);
    mesh.position.set(0, WORLD.GOAL.h / 2, 0.045);
    mesh.renderOrder = 15;
    mesh.visible = false;
    scene.add(mesh);
    aiHeat = { mesh: mesh, tex: tex, cv: cv, mat: mat, op: 0 };
  }

  function aiHeatUpdate(dt){
    if (!aiHeat) return;
    var show = (S.phase === 'aim' || S.phase === 'charging');
    aiHeat.op = approach(aiHeat.op, show ? 1 : 0, 6, dt);
    aiHeat.mesh.visible = aiHeat.op > 0.01;
    if (!aiHeat.mesh.visible) return;
    aiHeat.mesh.lookAt(camera.position);
    aiHeat.mat.opacity = aiHeat.op * (S.charging ? 0.9 : 0.7);

    var cv = aiHeat.cv, c = cv.getContext('2d');
    var w = LOGIC.gridWeights(S.history, S.diff);
    var best = LOGIC.bestCell(w);
    c.clearRect(0, 0, cv.width, cv.height);

    var cw = cv.width / 3, ch = cv.height / 3, r, col;
    for (r = 0; r < 3; r++){
      for (col = 0; col < 3; col++){
        var p = w[r][col];
        var t = Math.min(1, p / Math.max(0.001, best.p));
        /* cold slate where he is not thinking, hot amber where he is */
        c.fillStyle = 'rgb(' + Math.round(40 + 215 * t) + ',' +
                                Math.round(120 + 90 * t) + ',' +
                                Math.round(150 - 100 * t) + ')';
        c.globalAlpha = 0.05 + 0.26 * t;
        c.fillRect(col * cw + 1, (2 - r) * ch + 1, cw - 2, ch - 2);
      }
    }
    c.globalAlpha = 1;
    /* the box he is actually thinking about */
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 2.5;
    c.strokeRect(best.c * cw + 2, (2 - best.r) * ch + 2, cw - 4, ch - 4);
    c.font = '700 24px system-ui, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.fillStyle = '#ffffff';
    var label = Math.round(best.p * 100) + '%';
    c.strokeText(label, best.c * cw + cw / 2, (2 - best.r) * ch + ch / 2 + 9);
    c.fillText(label, best.c * cw + cw / 2, (2 - best.r) * ch + ch / 2 + 9);
    /* a hairline frame, so it reads as a readout and not as part of the goal */
    c.strokeStyle = 'rgba(255,255,255,0.30)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, cv.width - 2, cv.height - 2);

    /* the scan: he is thinking about it                           */
    if (S.phase === 'charging'){
      var sy = (Math.sin(S.time * 3.4) * 0.5 + 0.5) * cv.height;
      var grd = c.createLinearGradient(0, sy - 12, 0, sy + 12);
      grd.addColorStop(0, 'rgba(160,255,220,0)');
      grd.addColorStop(0.5, 'rgba(180,255,230,0.55)');
      grd.addColorStop(1, 'rgba(160,255,220,0)');
      c.fillStyle = grd;
      c.fillRect(0, sy - 12, cv.width, 24);
    }
    aiHeat.tex.needsUpdate = true;
  }

  /* -------------------------------- aiming ---------------------------------
     The reticle lives in the world at the goal plane, so it is foreshortened
     by the camera exactly like the goal is: you aim where the ball will cross. */
  function buildReticle(){
    var grp = new T.Group();
    var mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true,
                                        opacity: 0.92, side: T.DoubleSide,
                                        depthTest: false, depthWrite: false });
    var ring = new T.Mesh(new T.RingGeometry(0.20, 0.255, 44), mat);
    grp.add(ring);
    [0, 1, 2, 3].forEach(function(i){
      var tick = new T.Mesh(new T.PlaneGeometry(0.035, 0.17), mat);
      var a = i * Math.PI / 2;
      tick.position.set(Math.cos(a) * 0.40, Math.sin(a) * 0.40, 0);
      tick.rotation.z = a - Math.PI / 2;
      grp.add(tick);
    });
    var power = new T.Mesh(new T.RingGeometry(0.52, 0.62, 60, 1),
      new T.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false,
        side: T.DoubleSide,
        uniforms: { p: { value: 0 }, tint: { value: new T.Color('#38ef7d') } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy;' +
          ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform float p; uniform vec3 tint; varying vec2 vP;' +
          'void main(){ float a = atan(vP.y, vP.x);' +
          ' float t = fract((a + 1.5707963) / 6.2831853);' +
          ' if (t > p) discard;' +
          ' float edge = smoothstep(p, p - 0.02, t);' +
          ' gl_FragColor = vec4(tint, 0.85 * edge); }'
      }));
    grp.add(power);
    grp.renderOrder = 20;
    grp.visible = false;
    scene.add(grp);
    reticle = { grp: grp, power: power, mat: mat };
  }

  function reticleUpdate(){
    if (!reticle) return;
    var show = (S.phase === 'aim' || S.phase === 'charging');
    reticle.grp.visible = show;
    if (!show) return;
    var mx = S.aim.x * (WORLD.GOAL.w / 2), my = S.aim.y * WORLD.GOAL.h;
    reticle.grp.position.set(mx, Math.max(0.05, my), 0.02);
    reticle.grp.lookAt(camera.position);
    reticle.power.material.uniforms.p.value =
      S.phase === 'charging' ? Math.min(1, S.power) : 0;
    var inSweet = Math.abs(S.power - CFG.SWEET) < CFG.SWEET_WINDOW;
    reticle.power.material.uniforms.tint.value.set(inSweet && S.charging
      ? '#ffd166' : '#38ef7d');
    var pulse = 0.75 + 0.25 * Math.sin(S.time * 5);
    reticle.mat.opacity = S.charging ? 1 : pulse;
  }

  /* ------------------------------- the ball -------------------------------- */
  function currentCross(){
    /* where this shot is going, in metres on the goal line */
    if (!S.shot) return { x: 0, y: 0 };
    return { x: S.shot.x * (WORLD.GOAL.w / 2), y: S.shot.y * WORLD.GOAL.h };
  }

  function ballUpdate(dt){
    if (!ball) return;
    var ph = S.phase, R = WORLD.BALL.r;

    if (ph === 'aim' || ph === 'charging'){
      /* waiting on the spot, breathing a little */
      ball.mesh.position.set(0, R, WORLD.PITCH.spot);
      ball.mesh.rotation.set(0, 0, 0);
      ball.hist.length = 0;
      ball.trail.forEach(function(s){ s.visible = false; s.material.opacity = 0; });
      return;
    }
    /* once the verdict is in, the ball is a free body and the aftermath owns
       it (or it is held in a glove) — see ballAftermath */
    if (ph === 'result') return;

    var p = WORLD.positionAt(S.flight.t, currentCross(), S.flight.curve, S.shot ? S.shot.power : 0.6);
    ball.mesh.position.set(p.x, p.y, p.z);

    /* roll + spin from the direction of travel */
    var spin = (S.shot ? S.shot.power : 0.5) * 14 + 6;
    ball.spin += dt * spin;
    ball.mesh.rotation.set(-p.z * 0.5, ball.spin, p.x * 0.6);

    /* trail */
    ball.hist.unshift({ x: p.x, y: p.y, z: p.z });
    if (ball.hist.length > ball.trail.length) ball.hist.pop();
    var moving = (ph === 'flying');
    ball.trail.forEach(function(sp, i){
      var h = ball.hist[i];
      if (!h || !moving){ sp.visible = false; sp.material.opacity = 0; return; }
      sp.visible = true;
      sp.position.set(h.x, h.y, h.z);
      var a = (1 - i / ball.trail.length);
      sp.material.opacity = a * a * 0.30;
      var s = R * 2 * (0.45 + a * 0.75);
      sp.scale.set(s, s, 1);
    });
  }

  /* -------------------------------- camera ---------------------------------
     Three rigs: behind the taker, tracking the ball, and a slow swing behind
     the goal once the ball is in. The camera is what makes it feel 3D.       */
  var CAM = { mode: 'aim', t: 0, lastPhase: 'aim', punch: 0 };
  /* three.js is not loaded until init(), so nothing may touch T up here */
  var camPos, camLook, tmpA, tmpB, tmpC;
  function easeOutLocal(x){ return 1 - Math.pow(1 - x, 3); }

  function cameraUpdate(dt){
    var ph = S.phase;
    if (ph !== CAM.lastPhase){
      if (ph === 'flying'){ CAM.mode = 'flight'; CAM.punch = 1; }
      else if (ph === 'result'){ CAM.mode = 'outcome'; CAM.t = 0; }
      else if (ph === 'aim' || ph === 'charging'){ CAM.mode = 'aim'; }
      CAM.lastPhase = ph;
    }
    CAM.t += dt;
    CAM.punch = Math.max(0, CAM.punch - dt * 3.4);
    var sway = S.reduce ? 0 : 1;
    var t = S.time;

    if (CAM.mode === 'aim'){
      /* a long lens from behind the taker: the goal fills the frame, the ball
         sits low in shot, and charging power walks the camera in */
      camPos.set(Math.sin(t * 0.62) * 0.10 * sway,
                 2.05 + Math.sin(t * 0.47) * 0.05 * sway,
                 18.5 - (S.charging ? S.power * 1.4 : 0));
      camLook.set(S.aim.x * 1.6, 1.2 + S.aim.y * 0.10, 0.2);
    } else if (CAM.mode === 'flight'){
      /* stay wide so you can see the whole flight, and push in as it travels */
      var b = ball.mesh.position;
      camPos.set(b.x * 0.10, 2.05 + b.y * 0.04, 18.5 - S.flight.t * 2.4);
      camLook.lerp(tmpA.set(b.x * 0.62, Math.max(0.35, b.y * 0.75), -0.4), 0.12);
    } else {
      var e = easeOutLocal(Math.min(1, CAM.t / 1.7));
      var v = S.shot ? S.shot.verdict : 'goal';
      var kx = keeper.root.position.x, ky = keeper.root.position.y;
      if (v === 'goal'){
        /* a slow-motion sweep out to the left, so the ball stays in the net
           with the keeper recovering in shot — and the camera never ends up
           inside the stand or the netting                              */
        var p0x = 0, p0y = 2.05, p0z = 16.2;
        var cxv = -6.0, cyv = 3.0, czv = 14.0;
        var p1x = -11.5, p1y = 3.8, p1z = 7.5;
        var u = 1 - e;
        camPos.set(u * u * p0x + 2 * u * e * cxv + e * e * p1x,
                   u * u * p0y + 2 * u * e * cyv + e * e * p1y,
                   u * u * p0z + 2 * u * e * czv + e * e * p1z);
        camLook.set(0, 1.25 - e * 0.15, 0.3 - e * 0.1);
      } else if (v === 'saved'){
        camPos.set(kx * 0.55, 1.5, 8.0 - e * 1.4);
        camLook.set(kx, 0.9 + ky * 0.5, 0.35);
      } else if (v === 'post'){
        camPos.set(ball.mesh.position.x * 0.35, 1.8, 10.5 - e * 1.6);
        camLook.set(ball.mesh.position.x * 0.9, 1.5, 0);
      } else {
        camPos.set(ball.mesh.position.x * 0.30, 2.2, 14.0 - e * 1.2);
        camLook.set(ball.mesh.position.x, Math.max(0.4, ball.mesh.position.y), -2);
      }
    }

    /* kick punch-in, plus shake on the frame */
    var shake = (S.shake > 0 && !S.reduce) ? S.shake * 0.012 : 0;
    camera.fov = Q.fov - CAM.punch * 3.5 + (CAM.mode === 'outcome' ? -1 : 0);
    camera.updateProjectionMatrix();
    camera.position.set(camPos.x + Math.sin(t * 40) * shake,
                        camPos.y + Math.cos(t * 37) * shake,
                        camPos.z);
    camera.lookAt(camLook);
    camera.rotation.z += Math.sin(t * 0.5) * 0.004 * sway;
  }

  /* ------------------------------- the crowd -------------------------------- */
  function crowdUpdate(){
    if (!crowd) return;
    var m = new T.Matrix4();
    var excited = (S.phase === 'result' && S.shot && S.shot.verdict === 'goal');
    var n = Math.min(260, CROWD.length);
    for (var k = 0; k < n; k++){
      crowd.userData.cursor = ((crowd.userData.cursor | 0) + 1) % CROWD.length;
      var c = CROWD[crowd.userData.cursor];
      if (!c) continue;
      var bob = Math.sin(S.time * (2.2 + c.ph * 0.2) + c.ph) * 0.045;
      var amp = excited ? 1 + 4 * Math.abs(bob / 0.045) * 0.5 : 1;
      m.makeScale(c.s, c.s, c.s);
      m.setPosition(c.x, c.y + bob * amp, c.z);
      crowd.setMatrixAt(c.i, m);
    }
    crowd.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------ the net ripple ----------------------------
     A save is a stop, a goal is a dent: the back of the net takes the impact
     and shakes it out, the clearest "that one went in" cue there is.         */
  function netImpact(x, y){
    if (!net || !net.userData.base) return;
    net.userData.hit = { x: x, y: y - WORLD.GOAL.h / 2, t: 0 };
  }
  function netRippleUpdate(dt){
    if (!net || !net.userData.base) return;
    var pos = net.geometry.attributes.position;
    var hit = net.userData.hit;
    if (!hit){
      if (net.userData.dirty){
        for (var j = 0; j < pos.count; j++) pos.setZ(j, 0);
        pos.needsUpdate = true;
        net.userData.dirty = false;
      }
      return;
    }
    hit.t += dt;
    if (hit.t > 1.25){ net.userData.hit = null; return; }
    net.userData.dirty = true;
    var base = net.userData.base;
    for (var i = 0; i < pos.count; i++){
      var dx = base[i * 3] - hit.x, dy = base[i * 3 + 1] - hit.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var core = Math.exp(-(d * d) / 0.20) * Math.exp(-hit.t * 3.0);
      var ring = Math.exp(-Math.pow(d - hit.t * 3.4, 2) / 0.035) *
                 Math.exp(-hit.t * 2.0) * 0.55;
      pos.setZ(i, -(core + ring) * 0.6);
    }
    pos.needsUpdate = true;
  }

  /* -------------------------------- confetti -------------------------------- */
  function buildConfetti(){
    var n = 240;
    var mesh = new T.InstancedMesh(
      new T.PlaneGeometry(0.06, 0.10),
      new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true,
                                toneMapped: false }),
      n);
    mesh.frustumCulled = false;
    mesh.visible = false;
    var col = new T.Color(), m = new T.Matrix4();
    var parts = [];
    for (var i = 0; i < n; i++){
      m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, m);
      col.setHSL(Math.random(), 0.75, 0.6);
      mesh.setColorAt(i, col);
      parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
                   rx: 0, ry: 0, life: 0 });
    }
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    confetti = { mesh: mesh, parts: parts, t: 0 };
  }

  function confettiBurst(){
    if (!confetti) return;
    confetti.mesh.visible = true;
    confetti.t = 0;
    confetti.parts.forEach(function(p){
      p.x = (Math.random() - 0.5) * 10;
      p.y = 2.6 + Math.random() * 5;
      p.z = -2.5 - Math.random() * 5;
      p.vx = (Math.random() - 0.5) * 2.4;
      p.vy = -0.5 - Math.random() * 1.2;
      p.vz = 0.7 + Math.random() * 2.4;
      p.rx = Math.random() * 6.28;
      p.ry = Math.random() * 6.28;
      p.life = 4.5 + Math.random() * 2.5;
    });
  }

  function confettiUpdate(dt){
    if (!confetti || !confetti.mesh.visible) return;
    confetti.t += dt;
    var m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
    confetti.parts.forEach(function(p, i){
      if (p.life > 0){
        p.life -= dt;
        p.vy -= 1.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vz *= (1 - Math.min(0.9, dt * 0.5));
        p.rx += dt * 3.2;
        p.ry += dt * 2.1;
      }
      e.set(p.rx, p.ry, p.rx * 0.5);
      q.setFromEuler(e);
      var s = p.life > 0 ? 1 : Math.max(0, 1 + p.life);
      m.compose(tmpA.set(p.x, Math.max(0.02, p.y), p.z), q, tmpB.set(s, s, s));
      confetti.mesh.setMatrixAt(i, m);
    });
    confetti.mesh.instanceMatrix.needsUpdate = true;
    if (confetti.t > 7) confetti.mesh.visible = false;
  }

  /* ---------------------------- housekeeping ------------------------------- */
  function resize(){
    if (!ready) return;
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    fxTargets(W, H);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  /* The goal, projected into screen space — the same shape script.js uses to
     turn a pointer into an aim, so the reticle sits exactly where the 3D goal
     is on screen and aiming feels identical in both renderers.               */
  function geometry(){
    var HW = WORLD.GOAL.w / 2, GH = WORLD.GOAL.h;
    var pts = [[-HW, 0], [HW, 0], [-HW, GH], [HW, GH]];
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < pts.length; i++){
      var v = tmpA.set(pts[i][0], pts[i][1], 0).project(camera);
      var sx = (v.x * 0.5 + 0.5) * W;
      var sy = (-v.y * 0.5 + 0.5) * H;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    var g = {
      W: W, H: H, cx: (minX + maxX) / 2,
      goalHalf: (maxX - minX) / 2, goalH: maxY - minY,
      goalBottomY: maxY, goalTopY: minY,
      spotR: Math.max(8, Math.min(W, H) * 0.021)
    };
    g.spotY = g.goalBottomY + g.goalH * 0.40;
    g.ballRestY = g.spotY - g.spotR * 1.75;
    return g;
  }

  function init(){
    if (dead) return false;
    var want = want3d();
    if (want === '2d' || !hasGL()){ dead = true; return false; }
    T = window.THREE;
    if (!T) return false;
    setQuality(want);

    canvas = document.createElement('canvas');
    canvas.id = 'field3d';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
      'display:block;pointer-events:none';
    var stage = document.getElementById('stage');
    stage.appendChild(canvas);

    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true,
                                     powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = T.SRGBColorSpace;

    scene = new T.Scene();
    scene.fog = new T.FogExp2(0x060d14, 0.0115);

    camera = new T.PerspectiveCamera(Q.fov, 1, 0.1, 500);
    camera.position.set(0, 2.05, 18.5);
    camera.lookAt(0, 1.2, 0.2);

    camPos = new T.Vector3(0, 2.05, 18.5);
    camLook = new T.Vector3(0, 1.2, 0.2);
    tmpA = new T.Vector3();
    tmpB = new T.Vector3();
    tmpC = new T.Vector3();            /* the glove the ball is held in */

    buildSky();
    buildPitch();
    buildLights();
    buildStands();
    buildBoards();
    buildGoalFrame();
    buildCrowd();
    buildKeeper();
    buildBall();
    buildReticle();
    buildAiHeat();
    buildConfetti();
    buildFx();

    resize();
    ready = true;
    canvas.style.pointerEvents = 'none';
    return true;
  }

  /* --------------------- what happens after the shot ------------------------
     The verdict decides the outcome; the physics decides the picture. The ball
     keeps the velocity it actually had at the line and becomes a free body:
     the mesh strips its pace and holds it, a parry loops away from the goal,
     a miss lands behind the line. The one case that is not a free body is a
     clean catch — there the ball is parented to the glove that caught it.   */
  var ended = false;

  /* the ball's velocity as it arrives, differentiated from the very path that
     has been drawn all flight, so the aftermath continues the motion rather
     than restarting it */
  function crossingVelocity(){
    var c = currentCross();
    var pw = S.shot ? S.shot.power : 0.6;
    var a = WORLD.positionAt(1, c, S.flight.curve, pw);
    var b = WORLD.positionAt(0.96, c, S.flight.curve, pw);
    var dt = 0.04 * Math.max(S.flight.dur, 0.2);
    return { x: (a.x - b.x) / dt, y: (a.y - b.y) / dt, z: (a.z - b.z) / dt };
  }

  function startBall(){
    var c = currentCross();
    var v = crossingVelocity();
    /* the crossing plane *is* the goal line, so z starts at 0: currentCross()
       is a 2D point on that plane and has no z of its own */
    ball.p = { x: c.x, y: c.y, z: 0, vx: v.x, vy: v.y, vz: v.z };
    ball.catchFrom = null;
    ball.netDone = false;

    var verdict = S.shot ? S.shot.verdict : 'goal';
    if (verdict === 'post'){
      /* the woodwork hits back: it throws the ball out and across */
      var sx = (c.x < 0 ? -1 : 1);
      if (S.shot.hit === 'bar'){
        ball.p.vy = -Math.abs(v.y) * 0.35 - 1.6;
        ball.p.vz = Math.abs(v.z) * 0.42;
        ball.p.vx = sx * 0.9;
      } else {
        ball.p.vx = sx * (Math.abs(v.x) * 0.5 + 2.2);
        ball.p.vz = Math.abs(v.z) * 0.45;
        ball.p.vy = Math.abs(v.y) * 0.30 + 1.4;
      }
      ballEvent('post');
    } else if (verdict === 'saved' && S.shot && S.shot.saveType === 'deflect'){
      /* the parry is computed from where the glove met the ball, then the
         physics takes over: what you see fly away is what the rules deflected */
      var d = WORLD.deflecting(c, S.plan || { x: 0, y: 0.4 },
                               S.shot.power, S.shot.pace);
      ball.p.x = d.contact.x; ball.p.y = d.contact.y; ball.p.z = d.contact.z;
      ball.p.vx = d.v.x; ball.p.vy = d.v.y; ball.p.vz = d.v.z;
    } else if (verdict === 'saved'){
      /* a catch: remember where he took it on the goal line, so it is drawn
         into the glove rather than teleporting there */
      ball.catchFrom = new T.Vector3(c.x, c.y, 0);
    }
  }

  /* a caught ball is held: parented to the glove that caught it */
  function holdInGlove(dt){
    var side = (S.plan && S.plan.x > 0.14) ? 'r' : 'l';
    gloveWorld(side, tmpC);
    tmpC.y -= 0.07;                          /* cupped under the palm */
    var t = Math.min(1, (ball.after || 0) / 0.09);
    if (t < 1 && ball.catchFrom) ball.mesh.position.lerpVectors(ball.catchFrom, tmpC, t);
    else ball.mesh.position.copy(tmpC);
    ball.mesh.rotation.y += dt * 2.2;
    ball.trail.forEach(function(sp){ sp.visible = false; sp.material.opacity = 0; });
  }

  function aftermath(dt){
    if (!ball) return;
    ball.after = (ball.after || 0) + dt;
    /* build the ball's physics state first, for every verdict: even a catch
       needs to know where the ball was taken, so it can be drawn into the
       glove over a few frames instead of popping there */
    if (!ball.p) startBall();

    var v = S.shot ? S.shot.verdict : 'goal';
    if (v === 'saved' && S.shot && S.shot.saveType === 'catch'){
      holdInGlove(dt);
      return;
    }

    var ev = WORLD.ballStep(ball.p, dt);
    if (ev.net && !ball.netDone){
      ball.netDone = true;
      /* the net dents where the ball hit it, and the mesh gives up its sound
         at exactly that moment */
      netImpact(ball.p.x, ball.p.y);
      ballEvent('net', { speed: ev.net });
    }
    ball.mesh.position.set(ball.p.x, ball.p.y, ball.p.z);
    ball.mesh.rotation.z += dt * 6;
    ball.mesh.rotation.x += dt * 3;
    ball.trail.forEach(function(sp){ sp.visible = false; sp.material.opacity = 0; });
  }

  /* ============================== post effects ==============================
     One composite pass over the whole frame: bloom, a filmic vignette, film
     grain and a touch of chromatic aberration. It is what stops a night
     stadium looking like a flat green rectangle.                            */
  var FX = { quadScene: null, cam: null, rt: null, rtA: null, rtB: null,
             bright: null, blur: null, comp: null };

  function fxQuad(mat){
    var mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    FX.quadScene.add(mesh);
    return mesh;
  }

  function buildFx(){
    FX.quadScene = new T.Scene();
    FX.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var VS = 'varying vec2 vUv; void main(){ vUv = uv;' +
             ' gl_Position = vec4(position.xy, 0.0, 1.0); }';

    FX.bright = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, texel: { value: new T.Vector2() },
                  threshold: { value: 0.84 } },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold;' +
        'varying vec2 vUv;' +
        'void main(){' +
        ' vec4 c = texture2D(tDiffuse, vUv);' +
        ' c += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0));' +
        ' c += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0));' +
        ' c += texture2D(tDiffuse, vUv + vec2(0.0, texel.y));' +
        ' c += texture2D(tDiffuse, vUv - vec2(0.0, texel.y));' +
        ' c /= 5.0;' +
        ' float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));' +
        ' float k = smoothstep(threshold, threshold + 0.30, l);' +
        ' gl_FragColor = vec4(c.rgb * k, 1.0); }'
    });

    FX.blur = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, dir: { value: new T.Vector2() } },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;' +
        'void main(){' +
        ' vec4 s = texture2D(tDiffuse, vUv) * 0.227;' +
        ' s += (texture2D(tDiffuse, vUv + dir * 1.3846) +' +
        '       texture2D(tDiffuse, vUv - dir * 1.3846)) * 0.316;' +
        ' s += (texture2D(tDiffuse, vUv + dir * 3.2308) +' +
        '       texture2D(tDiffuse, vUv - dir * 3.2308)) * 0.070;' +
        ' gl_FragColor = s; }'
    });

    FX.comp = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null },
        bloom: { value: 0.0 }, grain: { value: 0.035 },
        vig: { value: 0.62 }, ca: { value: 0.0035 },
        time: { value: 0 }
      },
      vertexShader: VS,
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform sampler2D tBloom;' +
        'uniform float bloom; uniform float grain; uniform float vig;' +
        'uniform float ca; uniform float time; varying vec2 vUv;' +
        'void main(){' +
        ' vec2 d = vUv - 0.5; float r2 = dot(d, d);' +
        ' float k = ca * r2 * 4.0;' +                       /* corner fringing */
        ' vec3 col;' +
        ' col.r = texture2D(tDiffuse, vUv - d * k).r;' +
        ' col.g = texture2D(tDiffuse, vUv).g;' +
        ' col.b = texture2D(tDiffuse, vUv + d * k).b;' +
        ' col += texture2D(tBloom, vUv).rgb * bloom;' +
        ' col *= 1.0 - vig * smoothstep(0.10, 0.62, r2 * 1.7);' +   /* vignette */
        ' float n = fract(sin(dot(vUv * vec2(1234.5, 5678.9) + time,' +
        '   vec2(12.9898, 78.233))) * 43758.5453);' +
        ' col += (n - 0.5) * grain;' +
        ' col = clamp(col, 0.0, 1.0);' +
        ' col = col * col * (3.0 - 2.0 * col) * 0.30 + col * 0.70;' + /* S-curve */
        ' vec3 srgb = mix(col * 12.92,' +
        '   1.055 * pow(max(col, vec3(0.0)), vec3(0.4167)) - 0.055,' +
        '   step(vec3(0.0031308), col));' +
        ' gl_FragColor = vec4(srgb, 1.0); }'
    });

    fxQuad(FX.bright);
    fxQuad(FX.blur);
    fxQuad(FX.comp);
  }

  function fxTargets(w, h){
    var dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    var pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr));
    var bw = Math.max(2, Math.round(pw / 4)), bh = Math.max(2, Math.round(ph / 4));
    if (FX.rt) FX.rt.dispose();
    if (FX.rtA) FX.rtA.dispose();
    if (FX.rtB) FX.rtB.dispose();
    var opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter,
                depthBuffer: true };
    FX.rt = new T.WebGLRenderTarget(pw, ph, opt);
    opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    FX.rtA = new T.WebGLRenderTarget(bw, bh, opt);
    FX.rtB = new T.WebGLRenderTarget(bw, bh, opt);
  }

  function blit(mat, target){
    FX.quadScene.children.forEach(function(m){
      m.visible = (m.material === mat);
    });
    renderer.setRenderTarget(target || null);
    renderer.render(FX.quadScene, FX.cam);
  }

  function postFX(){
    blit(FX.bright, FX.rtA);
    FX.blur.uniforms.tDiffuse.value = FX.rtA.texture;
    FX.blur.uniforms.dir.value.set(1.4 / FX.rtA.width, 0);
    blit(FX.blur, FX.rtB);
    FX.blur.uniforms.tDiffuse.value = FX.rtB.texture;
    FX.blur.uniforms.dir.value.set(0, 1.4 / FX.rtB.height);
    blit(FX.blur, FX.rtA);

    FX.comp.uniforms.tDiffuse.value = FX.rt.texture;
    FX.comp.uniforms.tBloom.value = FX.rtA.texture;
    FX.comp.uniforms.bloom.value = Q.bloom ? 0.55 : 0.0;
    FX.comp.uniforms.time.value = S.time;
    blit(FX.comp, null);
  }

  /* everything that animates, without drawing: the capture driver steps this
     so a pinned frame shows the dive and the camera in the right place       */
  function tick(dt){
    if (!ready) return;
    if (!S.reduce) S.timeScale = (S.phase === 'result') ? 0.42 : 1;

    /* the instant the verdict lands: drop the ball into physics and cheer */
    if (S.phase === 'result' && !ended){
      ended = true;
      ball.after = 0;
      ball.p = null;                     /* the aftermath builds it fresh */
      var v = S.shot ? S.shot.verdict : '';
      /* the net dents when the ball actually reaches it, from the physics —
         the confetti, which is pure celebration, can go now */
      if (v === 'goal') confettiBurst();
    } else if (S.phase !== 'result'){
      ended = false;
      if (ball){ ball.after = 0; ball.p = null; }
    }

    keeperPose(dt);
    ballUpdate(dt);
    if (S.phase === 'result') aftermath(dt);
    cameraUpdate(dt);
    reticleUpdate();
    aiHeatUpdate(dt);
    crowdUpdate();
    netRippleUpdate(dt);
    confettiUpdate(dt);
    if (boards) scrollBoards(boards.tex, S.time);
    if (halos.length && !S.reduce){
      for (var i = 0; i < halos.length; i++){
        halos[i].material.opacity = 0.34 + 0.10 * Math.sin(S.time * 2.1 + i * 1.7);
      }
    }
  }

  /* ================================ render ================================= */
  function render(dt){
    if (!ready) return;
    tick(dt);

    /* the stadium is drawn into a target so the grade can run over all of it */
    renderer.setRenderTarget(FX.rt);
    renderer.render(scene, camera);
    postFX();
  }

  function reset(){
    CAM.mode = 'aim'; CAM.t = 0; CAM.lastPhase = 'aim'; CAM.punch = 0;
    ended = false;
    A.x = 0; A.lift = 0; A.lean = 0; A.y = 0; A.grip = 0.05;
    if (confetti) confetti.mesh.visible = false;
    if (net){ net.userData.hit = null; net.userData.dirty = true; }
    if (ball){
      ball.hist.length = 0; ball.after = 0;
      ball.p = null; ball.catchFrom = null; ball.netDone = false;
    }
    if (!S.reduce) S.timeScale = 1;
  }

  return {
    init: init,
    loadThree: loadThree,
    resize: resize,
    geometry: geometry,
    render: render,
    tick: tick,
    reset: reset,
    active: function(){ return ready; },
    dead: function(){ return dead; },
    quality: function(){ return Q; },
    three: function(){ return T; },
    scene: function(){ return scene; },
    camera: function(){ return camera; },
    webgl: function(){ return renderer; },
    canvas: function(){ return canvas; },
    state: function(){
      return { mode: CAM.mode, ready: ready, dead: dead, q: Q,
               keeperX: keeper ? keeper.root.position.x : 0,
               keeper: (keeper && keeper.state) ? keeper.state.key : null,
               keeperGrip: +A.grip.toFixed(2),
               ball: ball ? [ball.mesh.position.x, ball.mesh.position.y, ball.mesh.position.z] : null,
               /* is the ball actually in the goal pocket, by the world model? */
               inNet: (ball && ball.p) ? WORLD.inNet(ball.p) : false,
               phys: ball && ball.p ? { x: ball.p.x, y: ball.p.y, z: ball.p.z,
                                        vz: ball.p.vz } : null,
               vel: ball && ball.p ? { x: ball.p.vx, y: ball.p.vy, z: ball.p.vz } : null,
               catchFrom: ball && ball.catchFrom
                 ? [ball.catchFrom.x, ball.catchFrom.y, ball.catchFrom.z] : null,
               /* where the gloves are: a held ball must sit on one of them */
               gloves: (keeper && keeper.root)
                 ? ['l', 'r'].map(function(sd){
                     gloveWorld(sd, tmpA); return [+tmpA.x.toFixed(3), +tmpA.y.toFixed(3),
                                                   +tmpA.z.toFixed(3)];
                   }) : null,
               held: !!(ball && ball.catchFrom && ball.after > 0.1),
               net: net && net.userData.hit ? net.userData.hit.t : null,
               confetti: confetti ? confetti.mesh.visible : false,
               crowd: crowd ? crowd.count : 0 };
    }
  };











})();
