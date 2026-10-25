/* Replay3D: shared 3D replay viewer for the mobile-patch3d evidence pages.
 *
 * Needs three.js r128 + OrbitControls loaded first.
 *
 *   const v = Replay3D.mount(document.getElementById('viewer'), {
 *     scene: {kind:'mujoco', data:CASES.v1, cutaway:['ceiling'], translucent:/corridor/},
 *     //  or {kind:'boxes', data:CASE}  (parent_scripts/b_export2.py format)
 *     view:'follow', mode:'full', t0:0,
 *     phaseNames:{...}, legend:'<html>',
 *   });
 *   v.addLayer('region', i => THREE.Object3D|null, {label:'动作区', on:true});
 *   v.onFrame(i => ...); v.show(i); v.times; v.setView('free'); v.dispose();
 *
 * Controls (same on every page):
 *   mouse drag = rotate, wheel = zoom, right drag = pan
 *   W/S forward/back, A/D left/right, Q/E down/up, Shift = 3x speed (switches to free view)
 *   Space = play/pause, ←/→ = one frame, 1–4 = follow / free / top / robot camera
 */
(function () {
  const PHASES = {warmup:'开局热身',initialization:'开局热身',init:'开局',ACT:'ACT 控制中',turn_primitive:'转身（固定原语）',approach:'前进到柜台',hover:'对准',descend:'下探',close:'夹紧',lift:'抬起',clear:'离开柜台',turn:'转身',translate:'穿过走廊',face:'转向餐桌',dock:'靠近餐桌',place_hover:'对准放置点',place_descend:'下放',release:'松手',retreat:'后退',transfer:'搬运',lower:'下压',wipe:'擦拭',done:'完成'};
  const css = `
.r3d{display:flex;flex-direction:column;gap:8px;font-size:13px}
.r3d .stage{position:relative}
.r3d canvas{width:100%;aspect-ratio:16/9;max-height:max(320px,calc(100vh - 230px));display:block;border:1px solid var(--line,#d4dcd8);border-radius:6px;background:#dfe6e3;outline:none}
.r3d canvas:focus{border-color:var(--accent,#0f6f63)}
.r3d [hidden]{display:none!important}
.r3d .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted,#5a6863)}
.r3d .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.r3d button{font:inherit;padding:4px 10px;border:1px solid var(--line,#d4dcd8);background:var(--panel,#fff);color:var(--fg,#17201c);border-radius:4px;cursor:pointer}
.r3d button.on{background:var(--accent,#0f6f63);color:#fff;border-color:var(--accent,#0f6f63)}
.r3d .gap{width:10px}
.r3d .bar{display:flex;gap:10px;align-items:center}
.r3d .bar input{flex:1;min-width:0}
.r3d .clock{font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;min-width:220px}
.r3d .phase{display:inline-block;padding:1px 8px;border-radius:3px;background:var(--chip,#e2ece9)}
.r3d .help{color:var(--muted,#5a6863);font-size:12.5px}
.r3d .help kbd{font-family:inherit;border:1px solid var(--line,#d4dcd8);border-bottom-width:2px;border-radius:3px;padding:0 4px;background:var(--panel,#fff)}`;
  if (!document.getElementById('r3d-css')) { const s = document.createElement('style'); s.id = 'r3d-css'; s.textContent = css; document.head.appendChild(s); }

  const b64 = (s, T) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b).convertSRGBToLinear();
  const mat3 = R => new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);

  /* ---------- scene sources: each returns {root, times, show(i), robotCam(i)->{p,x,y,z}, fovy, modes, extraToggles} ---------- */
  function mujocoSource(C, o) {
    const root = new THREE.Group(), cut = o.cutaway || [], tl = o.translucent || null;
    const meshGeo = {}, uvGeo = {}, texCache = {}, loader = new THREE.TextureLoader();
    for (const [k, M] of Object.entries(C.meshes)) {
      const q = b64(M.v, Uint16Array), pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) { const a = i % 3; pos[i] = M.lo[a] + q[i] / 65535 * (M.hi[a] - M.lo[a]); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(b64(M.f, M.big ? Uint32Array : Uint16Array), 1)); g.computeVertexNormals(); meshGeo[k] = g;
    }
    // exported mesh UVs are MuJoCo-compiled (u, 1-v) and the image rows are not reversed, so mesh textures must NOT be flipped again
    const texOf = (id, flipY = true) => { const k = id + ':' + flipY; if (!(k in texCache)) { const t = loader.load(C.textures[id].faces[0]); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.flipY = flipY; texCache[k] = t; } return texCache[k]; };
    const uvOf = k => { if (!(k in uvGeo)) { const M = C.meshes[k], g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b64(M.cv, Float32Array), 3)); g.setAttribute('uv', new THREE.BufferAttribute(b64(M.cuv, Float32Array), 2)); g.computeVertexNormals(); uvGeo[k] = g; } return uvGeo[k]; };
    const prim = e => { const s = e.size; switch (e.t) {
      case 0: return new THREE.PlaneGeometry(2 * (s[0] || 10), 2 * (s[1] || 10));
      case 2: return new THREE.SphereGeometry(s[0], 24, 16);
      case 4: { const g = new THREE.SphereGeometry(1, 24, 16); g.scale(s[0], s[1], s[2]); return g; }
      case 5: { const g = new THREE.CylinderGeometry(s[0], s[0], 2 * s[1], 32); g.rotateX(Math.PI / 2); return g; }
      case 6: return new THREE.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2]);
      default: return null; } };
    const fullMat = e => { const M = e.mat, p = {color: lin(M.rgba[0], M.rgba[1], M.rgba[2]), specular: new THREE.Color(M.spec * .5, M.spec * .5, M.spec * .5), shininess: Math.max(1, M.shin * 128), transparent: M.rgba[3] < .99, opacity: M.rgba[3], side: e.t === 0 ? THREE.DoubleSide : THREE.FrontSide}; if (M.tex >= 0 && C.textures[M.tex]) p.map = texOf(M.tex, !(e.t === 7 && C.meshes[e.mesh] && C.meshes[e.mesh].cv)); return new THREE.MeshPhongMaterial(p); };
    const simpleMat = e => new THREE.MeshLambertMaterial({color: lin(e.rgba[0], e.rgba[1], e.rgba[2]), transparent: e.rgba[3] < .99, opacity: e.rgba[3], side: e.t === 0 ? THREE.DoubleSide : THREE.FrontSide});
    const build = (e, m, full) => {
      if (e.t === 7) return new THREE.Mesh(full && C.meshes[e.mesh].cv && e.mat.tex >= 0 ? uvOf(e.mesh) : meshGeo[e.mesh], m);
      if (e.t === 3) { const g = new THREE.Group(), s = e.size, cy = new THREE.CylinderGeometry(s[0], s[0], 2 * s[1], 24); cy.rotateX(Math.PI / 2); g.add(new THREE.Mesh(cy, m)); for (const z of [-s[1], s[1]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(s[0], 20, 12), m); sp.position.z = z; g.add(sp); } return g; }
      const g = prim(e); return g ? new THREE.Mesh(g, m) : new THREE.Group(); };
    const objs = C.geoms.map(e => {
      const g = new THREE.Group(), fm = fullMat(e), sm = simpleMat(e), a = build(e, fm, true), b = build(e, sm, false);
      a.userData.full = true; b.userData.simple = true; g.add(a, b);
      if (!e.dyn) { g.position.set(...e.p); g.quaternion.set(e.q[1], e.q[2], e.q[3], e.q[0]); }
      g.userData.cut = cut.some(k => (e.name + ' ' + e.body).includes(k)); g.visible = !g.userData.cut;
      if (tl && tl.test(e.name)) { g.userData.tl = [fm, sm]; for (const m of g.userData.tl) { m.transparent = true; m.opacity = .28; m.depthWrite = false; } }
      root.add(g); return g; });
    const fullLights = new THREE.Group();
    fullLights.add(new THREE.AmbientLight(0xffffff, (C.headlight.ambient[0] + C.lights.reduce((a, l) => a + l.ambient[0], 0)) * 2.2));
    for (const l of C.lights) { const L = new THREE.DirectionalLight(0xffffff, l.diffuse[0] * 1.15); L.position.set(-l.dir[0], -l.dir[1], -l.dir[2]); fullLights.add(L); }
    root.add(fullLights);
    const poses = C.poses_q ? decodePoses(C.poses_q) : b64(C.poses, Float32Array), cams = b64(C.cams, Float32Array), ND = C.dyn.length;
    const times = Array.from({length: C.nframes}, (_, i) => i * C.dt);
    let baseK = 0; { let best = 1e9; C.dyn.forEach((gi, k) => { if (/mobilebase|base/.test(C.geoms[gi].body) && poses[k * 7 + 2] < best) { best = poses[k * 7 + 2]; baseK = k; } }); }
    const toggles = [];
    if (cut.length) toggles.push({key: 'cut', label: '外墙和天花板', on: false, set: on => objs.forEach(g => { if (g.userData.cut) g.visible = on; })});
    if (objs.some(g => g.userData.tl)) toggles.push({key: 'tl', label: '半透明部件改不透明', on: false, set: on => objs.forEach(g => (g.userData.tl || []).forEach(m => { m.opacity = on ? 1 : .28; m.transparent = !on; m.depthWrite = on; }))});
    return {
      root, times, fovy: C.fovy, modes: true, headlight: C.headlight.diffuse[0] * 1.15, fullLights, toggles,
      phase: i => (C.phases || [])[i] || '',
      focus: () => objs[C.dyn[baseK]].position,
      show(i) { for (let k = 0; k < ND; k++) { const g = objs[C.dyn[k]], p = poses.subarray((i * ND + k) * 7, (i * ND + k) * 7 + 7); g.position.set(p[0], p[1], p[2]); g.quaternion.set(p[4], p[5], p[6], p[3]); } },
      robotCam(i) { const c = cams.subarray(i * 12, i * 12 + 12); return {p: new THREE.Vector3(c[0], c[1], c[2]), x: new THREE.Vector3(c[3], c[6], c[9]), y: new THREE.Vector3(c[4], c[7], c[10]), z: new THREE.Vector3(c[5], c[8], c[11])}; },
      setMode(full) { objs.forEach(g => g.children.forEach(c => { c.visible = full ? !!c.userData.full : !!c.userData.simple; })); fullLights.visible = full; },
    };
  }

  function boxesSource(C) {
    const root = new THREE.Group(), G2 = new THREE.BoxGeometry(2, 2, 2), room = new THREE.Group();
    const box = (b, color) => { const m = new THREE.Mesh(G2, new THREE.MeshLambertMaterial({color})); m.scale.set(...b.h); m.setRotationFromMatrix(mat3(b.R)); m.position.set(...b.c); return m; };
    for (const b of C.static) { const m = box(b, new THREE.Color(...b.rgb)); (Math.max(...b.h) > 1.0 && b.c[2] > 0.2 ? room : root).add(m); }
    room.visible = false; root.add(room);
    // two exports: b_export2 (robot_h/robot_rgb, frame.robot=[x,y,z,R9]) and L2 cases (robot_parts=[{h,rgb}], frame.robot=[{c,R}])
    const parts = C.robot_parts || C.robot_h.map((h, j) => ({h, rgb: C.robot_rgb[j]}));
    const robot = parts.map(pt => { const m = new THREE.Mesh(G2, new THREE.MeshLambertMaterial({color: new THREE.Color(...pt.rgb).lerp(new THREE.Color(0x9aa3a0), .5)})); m.scale.set(...pt.h); root.add(m); return m; });
    const F = C.frames;
    return {
      root, times: F.map(f => f.t), fovy: C.fovy, modes: false, toggles: [{key: 'room', label: '墙和天花板', on: false, set: on => { room.visible = on; }}],
      phase: () => '',
      focus: () => { const v = new THREE.Vector3(); robot.forEach(m => v.add(m.position)); return v.multiplyScalar(1 / Math.max(1, robot.length)); },
      show(i) { F[i].robot.forEach((v, j) => { const c = v.c || v, R = v.R || v.slice(3); robot[j].position.set(c[0], c[1], c[2]); robot[j].setRotationFromMatrix(mat3(R)); }); },
      robotCam(i) { const c = F[i].cam, R = c.mat; return {p: new THREE.Vector3(...c.pos), x: new THREE.Vector3(R[0], R[3], R[6]), y: new THREE.Vector3(R[1], R[4], R[7]), z: new THREE.Vector3(R[2], R[5], R[8])}; },
      setMode() {},
    };
  }

  /* ---------- helpers for overlay layers ---------- */
  const cellGeo = {};
  function cells(list, {size = .05, color = 0x0aa3a3, opacity = 1, scale = 1} = {}) {
    const k = size * scale; cellGeo[k] = cellGeo[k] || new THREE.BoxGeometry(k, k, k);
    const im = new THREE.InstancedMesh(cellGeo[k], new THREE.MeshLambertMaterial({color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1}), Math.max(1, list.length)), M = new THREE.Matrix4();
    list.forEach((c, i) => { M.makeTranslation(c[0] * size, c[1] * size, c[2] * size); im.setMatrixAt(i, M); }); im.count = list.length; return im;
  }
  function boxes(list, color) { const g = new THREE.Group(), G2 = new THREE.BoxGeometry(2, 2, 2); for (const b of list) { const m = new THREE.Mesh(G2, new THREE.MeshLambertMaterial({color})); m.scale.set(...b.h); m.setRotationFromMatrix(mat3(b.R)); m.position.set(...b.c); g.add(m); } return g; }

  /* ---------- viewer ---------- */
  function mount(host, opt) {
    host.classList.add('r3d');
    host.innerHTML = `<div class="row tog"></div><div class="row"><span class="modes"></span><span class="gap"></span>
      <button data-cam="follow">跟随机器人</button><button data-cam="free">自由视角</button><button data-cam="top">俯视全场</button><button data-cam="robot">从机器人相机看</button><span class="gap"></span>
      <button data-s="0.5">0.5×</button><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button></div>
      <div class="stage"><canvas tabindex="0"></canvas><div class="loading">加载模型中…</div></div>
      <div class="bar"><button class="play">播放</button><input type="range" min="0" step="1"><span class="clock"></span></div>
      <div class="help">鼠标：拖动旋转，滚轮缩放，右键平移。键盘：<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 前后左右移动，<kbd>Q</kbd>/<kbd>E</kbd> 下降/上升，按住 <kbd>Shift</kbd> 加速；<kbd>空格</kbd> 播放/暂停，<kbd>←</kbd><kbd>→</kbd> 逐帧，<kbd>1</kbd>–<kbd>4</kbd> 切换视角。</div>`;
    const offs = [], on = (t, ev, f) => { t.addEventListener(ev, f); offs.push(() => t.removeEventListener(ev, f)); };
    const $ = s => host.querySelector(s), canvas = $('canvas'), slider = $('input[type=range]'), playBtn = $('.play'), clock = $('.clock');
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true}); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(45, 16 / 9, .02, 80); cam.up.set(0, 0, 1);
    const simpleLights = [new THREE.HemisphereLight(0xffffff, 0x7d8a85, .8)]; { const a = new THREE.DirectionalLight(0xffffff, .65); a.position.set(3, -4, 6); const b = new THREE.DirectionalLight(0xffffff, .25); b.position.set(-4, 3, 4); simpleLights.push(a, b); }
    simpleLights.forEach(l => scene.add(l));
    const controls = new THREE.OrbitControls(cam, canvas); controls.enableDamping = true;
    const src = opt.scene.kind === 'boxes' ? boxesSource(opt.scene.data) : mujocoSource(opt.scene.data, opt.scene);
    scene.add(src.root);
    const head = new THREE.DirectionalLight(0xffffff, src.headlight || .6); head.position.set(0, 0, 1); cam.add(head); head.target.position.set(0, 0, -1); cam.add(head.target); scene.add(cam);
    const camDot = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 12), new THREE.MeshBasicMaterial({color: 0x111111})); scene.add(camDot);
    const frust = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0x111111, transparent: true, opacity: .55})); scene.add(frust);
    const phaseNames = Object.assign({}, PHASES, opt.phaseNames || {});
    const NF = src.times.length, layers = [], listeners = [];
    let idx = 0, view = 'follow', mode = opt.mode || 'simple', speed = 1, playing = false, acc = 0, last = performance.now(), showFrust = true;
    slider.max = NF - 1;

    // toggles: scene-provided + camera frustum + layers
    const tog = $('.tog');
    const addToggle = (label, on, set) => { const b = document.createElement('button'); b.textContent = label; b.classList.toggle('on', on); b.onclick = () => { on = !on; b.classList.toggle('on', on); set(on); }; tog.appendChild(b); set(on); };
    src.toggles.forEach(t => addToggle(t.label, t.on, t.set));
    addToggle('相机视野', true, on => { showFrust = on; show(idx); });
    if (src.modes) { $('.modes').innerHTML = '<button data-mode="full">完整版</button><button data-mode="simple">简化版</button>'; }

    function setMode(m) { mode = src.modes ? m : 'simple'; const full = mode === 'full'; src.setMode(full); head.visible = full && src.modes; simpleLights.forEach(l => { l.visible = !full || !src.modes; });
      scene.background = new THREE.Color(full && src.modes ? 0x7b8db3 : 0xdfe6e3); host.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode)); }
    function show(i) {
      idx = i; src.show(i);
      const {p, x, y, z} = src.robotCam(i); camDot.position.copy(p);
      const d = 1.2, th = Math.tan(src.fovy * Math.PI / 360) * d, tw = th * 16 / 9, c = p.clone().addScaledVector(z, -d), pts = [];
      const cn = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(x, a * tw).addScaledVector(y, b * th));
      cn.forEach((q, k) => { pts.push(p, q, q, cn[(k + 1) % 4]); }); frust.geometry.setFromPoints(pts);
      frust.visible = showFrust && view !== 'robot'; camDot.visible = view !== 'robot';
      for (const L of layers) { if (L.obj) L.grp.remove(L.obj); L.obj = L.fn(i); if (L.obj) L.grp.add(L.obj); L.grp.visible = L.on; }
      slider.value = i; const ph = src.phase(i);
      clock.innerHTML = `${src.times[i].toFixed(1)} / ${src.times[NF - 1].toFixed(1)} 秒` + (ph ? `　<span class="phase">${phaseNames[ph] || ph}</span>` : '');
      if (view === 'robot') { cam.position.copy(p); cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); cam.fov = src.fovy; cam.updateProjectionMatrix(); }
      if (view === 'follow') { const f = src.focus(), tgt = new THREE.Vector3(f.x, f.y, .6), off = cam.position.clone().sub(controls.target); controls.target.copy(tgt); cam.position.copy(tgt.add(off)); }
      listeners.forEach(f => f(i));
    }
    function setView(v) {
      const prev = view; view = v; controls.enabled = v !== 'robot'; cam.fov = 45; cam.updateProjectionMatrix(); cam.up.set(0, 0, 1);
      const p = src.focus();
      if (v === 'top') { const c = opt.topCenter || [p.x, p.y]; controls.target.set(c[0], c[1], 0); cam.position.set(c[0], c[1] - 1, opt.topHeight || 9); }
      else if (v === 'follow' || prev === 'robot') { controls.target.set(p.x, p.y, .6); cam.position.set(p.x + 1.4, p.y - 2.2, 3.3); }
      host.querySelectorAll('[data-cam]').forEach(e => e.classList.toggle('on', e.dataset.cam === v)); show(idx);
    }
    function setPlay(on) { playing = on; playBtn.textContent = on ? '暂停' : '播放'; if (on && idx >= NF - 1) show(0); last = performance.now(); acc = 0; }
    host.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cam) setView(b.dataset.cam); if (b.dataset.mode) setMode(b.dataset.mode);
      if (b.dataset.s) { speed = +b.dataset.s; host.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b)); }
      if (b === playBtn) setPlay(!playing); b.blur(); });
    slider.addEventListener('input', () => show(+slider.value));

    // keyboard: WASD/QE fly, space, arrows, 1-4
    const keys = new Set(), FLY = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
    const typing = e => e.target.matches && e.target.matches('input[type=text],input[type=search],textarea,select');
    on(window, 'keydown', e => { if (typing(e)) return;
      if (FLY.includes(e.code)) { e.preventDefault(); if (view !== 'free') setView('free'); keys.add(e.code); }
      else if (e.code === 'Space') { e.preventDefault(); setPlay(!playing); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setPlay(false); show(Math.max(0, Math.min(NF - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)))); }
      else if (/^Digit[1-4]$/.test(e.code)) setView(['follow', 'free', 'top', 'robot'][+e.code.slice(5) - 1]); });
    on(window, 'keyup', e => keys.delete(e.code)); on(window, 'blur', () => keys.clear());
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
    function fly(dt, shift) {
      if (!keys.size) return; cam.getWorldDirection(fwd); fwd.z = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0); fwd.normalize(); right.crossVectors(fwd, cam.up).normalize();
      mv.set(0, 0, 0);
      if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd); if (keys.has('KeyD')) mv.add(right); if (keys.has('KeyA')) mv.sub(right);
      if (keys.has('KeyE')) mv.z += 1; if (keys.has('KeyQ')) mv.z -= 1;
      if (!mv.lengthSq()) return; mv.normalize().multiplyScalar((opt.flySpeed || 1.5) * (shift ? 3 : 1) * dt); cam.position.add(mv); controls.target.add(mv);
    }
    let shiftDown = false; on(window, 'keydown', e => { if (e.key === 'Shift') shiftDown = true; }); on(window, 'keyup', e => { if (e.key === 'Shift') shiftDown = false; });

    function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    on(window, 'resize', resize); resize();
    // background tabs start with a 0-size canvas: resize again whenever it becomes visible or changes size
    if (window.ResizeObserver) { const ro = new ResizeObserver(resize); ro.observe(canvas); offs.push(() => ro.disconnect()); }
    on(document, 'visibilitychange', () => { if (!document.hidden) resize(); });
    setMode(mode); { const k = src.times.findIndex(t => t >= (opt.t0 || 0)); show(k < 0 ? NF - 1 : k); } setView('follow'); if (opt.view && opt.view !== 'follow') setView(opt.view);
    if (opt.free) { setView('free'); controls.target.set(...opt.free.target); cam.position.set(...opt.free.position); }
    $('.loading').hidden = true;
    let alive = true;
    (function loop(now) { if (!alive) return; requestAnimationFrame(loop); const dt = Math.min(.1, (now - last) / 1000);
      if (playing) { acc += dt * speed; while (playing && idx < NF - 1 && src.times[idx + 1] - src.times[idx] <= acc) { acc -= src.times[idx + 1] - src.times[idx]; show(idx + 1); } if (idx >= NF - 1) setPlay(false); }
      last = now; if (canvas.width < 2 && canvas.clientWidth > 1) resize(); fly(dt, shiftDown); if (controls.enabled) controls.update(); renderer.render(scene, cam); })(performance.now());

    return {
      scene, camera: cam, controls, times: src.times, get index() { return idx; }, show, setView, setMode, setPlay,
      onFrame(f) { listeners.push(f); },
      addLayer(name, fn, {label = name, on = true} = {}) { const L = {name, fn, on, grp: new THREE.Group(), obj: null}; scene.add(L.grp); layers.push(L); addToggle(label, on, v => { L.on = v; L.grp.visible = v; }); show(idx); return L; },
      dispose() { alive = false; offs.forEach(f => f()); controls.dispose(); renderer.dispose(); host.innerHTML = ''; },
    };
  }

  // load a data script (window.CASES / window.CASE) and resolve when it has run
  const load = url => new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('加载失败：' + url)); document.head.appendChild(s); });
  // Split format (parent_scripts/split_replay.py): episode file holds poses + `scene` id; meshes/textures live once in ../_scenes/scene_<id>.js.
  // Scenes live in evidence/_scenes/, located relative to this script (pages sit at different depths).
  const LIB_URL = (document.currentScript && document.currentScript.src) || new URL('_lib/replay3d.js', location.href).href;
  const decodePoses = Q => {
    const p = b64(Q.p, Uint16Array), q = b64(Q.q, Int16Array), n = p.length / 3, out = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) out[i * 7 + a] = Q.lo[a] + p[i * 3 + a] / 65535 * (Q.hi[a] - Q.lo[a]);
      for (let a = 0; a < 4; a++) out[i * 7 + 3 + a] = q[i * 4 + a] / 32767;
    }
    return out;
  };
  const loadCase = async (url, key) => {
    await load(url);
    const C = window.CASES[key];
    if (C && C.scene && !C.meshes) {
      window.SCENES = window.SCENES || {};
      if (!window.SCENES[C.scene]) await load(new URL('../_scenes/scene_' + C.scene + '.js', LIB_URL).href);
      Object.assign(C, window.SCENES[C.scene]);
    }
    return C;
  };
  window.Replay3D = {mount, load, loadCase, cells, boxes, PHASES};
})();
