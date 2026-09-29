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
    scene.add(new T.HemisphereLight(0x9fc4ff, 0x0b2016, 0.20));
    scene.add(new T.AmbientLight(0x8ea9d6, 0.08));

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
    flood(-22, 18, true, 2.7, 0.72);             /* the key: casts the shadows */
    flood(22, 18, false, 1.5, 0.72);             /* fill, so nothing goes black */
    flood(0, -20, false, 0.85, 0.85);            /* rim light from behind the goal */

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
     A joint hierarchy of primitives. Keeping it in real proportions and
     leaning him with the dive is what makes the save read as a save.        */
  var KIT = { shirt: 0xffc93c, shirt2: 0xe07b1c, glove: 0x2ec4b6,
              shorts: 0x1b2a4a, skin: 0xf0c49c, hair: 0x1d2433, boot: 0x0d1626,
              sock: 0x22304d };

  function buildKeeper(){
    var root = new T.Group();
    root.position.set(0, 0, 0.35);
    var g = {};

    function mat(col, rough, metal){
      return new T.MeshStandardMaterial({ color: col, roughness: rough === undefined ? 0.7 : rough,
                                          metalness: metal || 0 });
    }
    function box(w, h, d, m, x, y, z, parent){
      var mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      (parent || root).add(mesh);
      return mesh;
    }

    /* torso pivots at the pelvis so a dive can rotate hips + chest together */
    var hips = new T.Group(); hips.position.y = 0.92; root.add(hips);
    g.hips = hips;
    box(0.34, 0.24, 0.22, mat(KIT.shorts), 0, -0.05, 0, hips);

    var chest = new T.Group(); chest.position.y = 0.10; hips.add(chest);
    g.chest = chest;
    var torso = box(0.46, 0.60, 0.26, mat(KIT.shirt), 0, 0.30, 0, chest);
    torso.castShadow = true;
    box(0.48, 0.16, 0.27, mat(KIT.shirt2), 0, 0.60, 0, chest);
    box(0.30, 0.30, 0.28, mat(KIT.shirt2), 0, 0.30, 0.005, chest);   /* number patch */

    var neck = new T.Group(); neck.position.y = 0.70; chest.add(neck);
    g.neck = neck;
    var head = new T.Mesh(new T.SphereGeometry(0.132, 16, 14), mat(KIT.skin, 0.85));
    head.position.y = 0.14; head.castShadow = true;
    neck.add(head);
    var hair = new T.Mesh(new T.SphereGeometry(0.138, 16, 12, 0, 6.29, 0, 1.5),
                          mat(KIT.hair, 0.95));
    hair.position.y = 0.15; neck.add(hair);

    /* arms: shoulder -> elbow -> glove */
    g.arm = {};
    [-1, 1].forEach(function(s){
      var sh = new T.Group();
      sh.position.set(s * 0.29, 0.56, 0);
      chest.add(sh);
      box(0.12, 0.34, 0.12, mat(KIT.shirt), 0, -0.17, 0, sh);
      var el = new T.Group(); el.position.y = -0.34; sh.add(el);
      box(0.11, 0.32, 0.11, mat(KIT.skin, 0.85), 0, -0.16, 0, el);
      var glove = new T.Mesh(new T.SphereGeometry(0.11, 12, 10), mat(KIT.glove, 0.65));
      glove.position.y = -0.36;
      glove.scale.set(1, 1.15, 0.7);
      glove.castShadow = true;
      el.add(glove);
      g.arm[s < 0 ? 'l' : 'r'] = { sh: sh, el: el, glove: glove };
    });

    /* legs: hip -> knee -> boot */
    g.leg = {};
    [-1, 1].forEach(function(s){
      var hip = new T.Group();
      hip.position.set(s * 0.13, 0, 0);
      hips.add(hip);
      box(0.17, 0.46, 0.18, mat(KIT.shorts), 0, -0.23, 0, hip);
      var knee = new T.Group(); knee.position.y = -0.46; hip.add(knee);
      /* the lower leg is a long sock, not bare skin: it reads far better */
      box(0.145, 0.44, 0.155, mat(KIT.sock, 0.9), 0, -0.22, 0, knee);
      var boot = new T.Mesh(new T.BoxGeometry(0.16, 0.09, 0.30), mat(KIT.boot, 0.5));
      boot.position.set(0, -0.47, 0.06);
      boot.castShadow = true;
      knee.add(boot);
      g.leg[s < 0 ? 'l' : 'r'] = { hip: hip, knee: knee, boot: boot };
    });

    root.traverse(function(o){ if (o.isMesh) o.castShadow = true; });
    scene.add(root);
    keeper = { root: root, g: g };
  }

  /* --------------------------- keeper animation -----------------------------
     Every value is smoothed towards a target, so nothing ever snaps: the dive
     is a real rotation of the whole body plus the arms reaching for the ball. */
  var A = { lean: 0, lift: 0, crouch: 0, arm: 0, elbow: 0, split: 0, knee: 0,
            twist: 0, x: 0, z: 0.35, feint: 0 };

  function approach(v, target, rate, dt){
    return v + (target - v) * (1 - Math.exp(-rate * dt));
  }

  function keeperPose(dt){
    var ph = S.phase, t = S.time;
    var plan = S.plan;
    var diving = (ph === 'flying' || ph === 'result') && plan;
    var p = 0;
    if (diving) p = WORLD.diveProgress(S.flight.t, plan, S.flight.dur);

    /* ---- targets ---- */
    var tgt = { lean: 0, lift: 0, crouch: 0.10, arm: 0.42, elbow: 0.30,
                split: 0.10, knee: 0.05, twist: 0, x: 0, z: 0.35, feint: 0 };
    var sign = 0;

    if (diving){
      sign = Math.abs(plan.x) < 0.14 ? 0 : (plan.x > 0 ? 1 : -1);
      var low = plan.y < 0.45;
      var mid = plan.y >= 0.45 && plan.y < 0.85;
      /* a big dive: body goes over, legs follow, arms stretch to the corner */
      tgt.lean   = -sign * (low ? 1.02 : (mid ? 0.86 : 0.66));
      tgt.lift   = low ? 0.10 : (mid ? 0.30 : 0.52);
      tgt.crouch = low ? -0.16 : -0.05;
      tgt.arm    = 1.45;
      tgt.elbow  = 0.08;
      tgt.split  = 0.22;
      tgt.knee   = low ? 0.55 : 0.30;
      tgt.twist  = sign * 0.28;
      /* he can only carry himself so far; the stretch covers the last half metre */
      tgt.x = plan.x * (WORLD.GOAL.w / 2) - sign * 0.42;
      /* the feint: he shows you one way before he goes the other */
      if (plan.read && S.diff === 'legend') tgt.feint = (p < 0.42 ? -sign * 0.30 : 0);
      tgt.x += tgt.feint;
    } else if (ph === 'charging'){
      tgt.crouch = 0.34; tgt.arm = 0.66; tgt.elbow = 0.55; tgt.split = 0.18;
      tgt.knee = 0.16;
      tgt.x = Math.sin(t * 2.1) * 0.10;
    } else if (ph === 'aim'){
      /* alive on his line: weight shifting, gloves up, barking at the taker */
      tgt.crouch = 0.22 + Math.sin(t * 2.4) * 0.03;
      tgt.arm = 0.52 + Math.sin(t * 2.4 + 1.1) * 0.06;
      tgt.elbow = 0.42;
      tgt.split = 0.16;
      tgt.knee = 0.10;
      tgt.x = Math.sin(t * 1.15) * 0.22;
      tgt.twist = Math.sin(t * 1.15) * 0.08;
    }

    var rate = diving ? 11 : 4.2;
    for (var k in tgt){
      if (tgt.hasOwnProperty(k)) A[k] = approach(A[k], tgt[k], rate, dt);
    }

    var g = keeper.g;
    keeper.root.position.set(A.x, A.lift, A.z);
    keeper.root.rotation.set(0, A.twist, A.lean);
    g.hips.rotation.z = -A.lean * 0.18;
    g.chest.rotation.z = -A.lean * 0.12;
    g.chest.rotation.x = A.crouch;
    g.neck.rotation.x = -A.crouch * 0.55 + (diving ? -0.18 : 0);
    g.neck.rotation.z = -A.lean * 0.10;

    /* arms: the leading glove reaches for where the ball is going */
    ['l', 'r'].forEach(function(side){
      var s = side === 'l' ? -1 : 1;
      var lead = sign === 0 ? 0 : (s === sign ? 1 : 0.55);
      var arm = g.arm[side];
      arm.sh.rotation.z = -s * (A.arm * (0.55 + lead * 0.75));
      arm.sh.rotation.x = A.arm * (0.30 + lead * 0.5) * (diving ? 1 : 0.4);
      arm.el.rotation.z = -s * A.elbow;
      arm.el.rotation.x = diving ? lead * -0.35 : -A.elbow * 0.4;
    });

    /* legs: the trailing leg straightens, the leading knee folds */
    ['l', 'r'].forEach(function(side){
      var s = side === 'l' ? -1 : 1;
      var leg = g.leg[side];
      var trail = sign !== 0 && s === -sign;
      leg.hip.rotation.z = -s * A.split * (diving ? 1.6 : 1);
      leg.hip.rotation.x = diving ? (trail ? -0.55 : 0.35) : -A.crouch * 0.5;
      leg.knee.rotation.x = diving ? (trail ? 0.15 : A.knee * 1.6) : A.knee;
    });
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
  var camPos, camLook, tmpA, tmpB;
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

  /* ------------------------- what happens after the shot --------------------
     The sim freezes the ball the moment the verdict is in; the aftermath is
     staging, so it lives here: the ball settling in the net, dropping after a
     save, or thudding into the boards after a miss.                          */
  var ended = false;

  function aftermath(dt){
    if (!ball) return;
    var v = S.shot ? S.shot.verdict : 'goal';
    var c = currentCross();
    var p = WORLD.positionAt(1, c, S.flight.curve, S.shot ? S.shot.power : 0.5);
    ball.after = (ball.after || 0) + dt;
    var t = ball.after, y = p.y, z = p.z, x = p.x;

    if (v === 'wide' || v === 'over'){
      var sp = 11, k = Math.min(1, t / 0.6);
      x += (p.x < 0 ? -1 : 1) * sp * k;
      y = Math.max(0.11, p.y + (v === 'over' ? 1.6 : -1.2) * k - 3.2 * k * k);
      z = Math.max(-6.4, -6.4 * k);
    } else if (v === 'post'){
      var k2 = Math.min(1, t / 0.7);
      x = p.x + (p.x < 0 ? -1 : 1) * 5.5 * k2;
      y = Math.max(0.11, p.y + 1.1 * k2 - 4.0 * k2 * k2);
      z = p.z + 7.5 * k2;
    } else if (v === 'saved'){
      var k3 = Math.min(1, t / 0.55);
      y = Math.max(0.11, p.y - 5.0 * k3 * k3);
      z = p.z + 1.6 * k3;
      x = p.x + 0.9 * k3 * (p.x < 0 ? -1 : 1);
    } else {
      var k4 = Math.min(1, t / 0.5);
      z = p.z - 0.50 * k4;
      y = Math.max(0.11, p.y - 2.4 * k4 * k4);
    }
    ball.mesh.position.set(x, y, z);
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

    /* the instant the verdict lands: dent the net, throw the confetti */
    if (S.phase === 'result' && !ended){
      ended = true;
      ball.after = 0;
      var v = S.shot ? S.shot.verdict : '';
      var mx = S.shot ? S.shot.x * (WORLD.GOAL.w / 2) : 0;
      var my = S.shot ? S.shot.y * WORLD.GOAL.h : 0;
      if (v === 'goal'){ netImpact(mx, my); confettiBurst(); }
      else if (v === 'post'){ netImpact(mx * 0.85, my); }
    } else if (S.phase !== 'result'){
      ended = false;
      if (ball) ball.after = 0;
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
    A.x = 0; A.lift = 0; A.lean = 0; A.feint = 0;
    if (confetti) confetti.mesh.visible = false;
    if (net){ net.userData.hit = null; net.userData.dirty = true; }
    if (ball){ ball.hist.length = 0; ball.after = 0; }
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
               ball: ball ? [ball.mesh.position.x, ball.mesh.position.y, ball.mesh.position.z] : null,
               net: net && net.userData.hit ? net.userData.hit.t : null,
               confetti: confetti ? confetti.mesh.visible : false,
               crowd: crowd ? crowd.count : 0 };
    }
  };











})();
