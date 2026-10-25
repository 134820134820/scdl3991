// Shared helpers for the presentation's 3D views (three.js r128, global THREE).
// Pages include: lib/three.min.js, lib/OrbitControls.js, lib/STLLoader.js, common.js

const VIZ = {
  ink: 0x0b0b0b, clay: 0xd9d6cd, clayDark: 0x8f8d86, ours: 0x2a78d6, other: 0xeb6834,
  zone: 0x1baf7a, alarm: 0xe34948, bg: 0xfcfcfb,
};

// Scene with soft "studio" light and a shadow-catching floor. Units: metres, Y up.
function makeStage(el, { cam = [2.2, 1.6, 2.4], target = [0, 0.8, 0], fov = 32, floor = true, orbit = true, transparent = false, tone = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: transparent });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  if (tone) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95; }
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  if (!transparent) scene.background = new THREE.Color(VIZ.bg);
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  camera.position.set(...cam);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b6ad, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2.5, 5, 3); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-3, 2, -2); scene.add(fill);
  if (floor) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.12 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  }
  let controls = null;
  if (orbit) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(...target); controls.enableDamping = true;
  } else camera.lookAt(...target);
  const hooks = [];
  function size() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', size); size();
  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    hooks.forEach(f => f(t));
    if (controls) controls.update();
    renderer.render(scene, camera);
  })();
  return { scene, camera, renderer, controls, onFrame: f => hooks.push(f), size };
}

function clay(color = VIZ.clay, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0, ...extra });
}

// Load the Zeno H1 URDF (robot/zeno_h1.urdf + STL meshes). Returns { root, joints, links }.
// joints[name].set(angle) rotates (revolute) or translates (prismatic) about the URDF axis.
// Block style (matches the simplified evidence pages): flat pastel colours + thin dark outlines.
const BLOCK = {
  base: 0x5f6e82, column: 0xa9b4c1, torso: 0xd2dae3, head: 0xeef1f4, armA: 0xb3c4d8, armB: 0x7f95b0, edge: 0x2b2b29,
};
function blockMat(color) { return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true }); }
function withEdges(mesh, opacity = 0.55) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30),
    new THREE.LineBasicMaterial({ color: BLOCK.edge, transparent: true, opacity }));
  mesh.add(e); return mesh;
}
function blockColor(link) {
  if (link === 'base_link') return BLOCK.base;
  if (link.startsWith('torso_base') || link === 'torso_Link_1') return BLOCK.column;
  if (link.startsWith('head') || link.startsWith('torso_head')) return BLOCK.head;
  const m = link.match(/arm_Link_(\d)/); if (m) return +m[1] % 2 ? BLOCK.armA : BLOCK.armB;
  if (link.includes('arm_base')) return BLOCK.armB;
  return BLOCK.torso;
}

// Gripper as a palm + two fingers inside the link's bounding box (tips at the end farther from the joint).
function blockGripper(bb, col) {
  const lo = bb.min.toArray(), hi = bb.max.toArray(), sz = hi.map((h, i) => h - lo[i]);
  const ax = sz.indexOf(Math.max(...sz)), rest = [0, 1, 2].filter(i => i !== ax);
  const b = sz[rest[0]] >= sz[rest[1]] ? rest[0] : rest[1], c = rest.find(i => i !== b);
  const tipHigh = Math.abs(hi[ax]) > Math.abs(lo[ax]);
  const part = (a0, a1, b0, b1, cScale) => { // box spanning fractions along ax and b
    const size = [0, 0, 0], ctr = [0, 0, 0];
    const A = tipHigh ? [lo[ax] + a0 * sz[ax], lo[ax] + a1 * sz[ax]] : [hi[ax] - a1 * sz[ax], hi[ax] - a0 * sz[ax]];
    size[ax] = A[1] - A[0]; ctr[ax] = (A[0] + A[1]) / 2;
    size[b] = (b1 - b0) * sz[b]; ctr[b] = lo[b] + (b0 + b1) / 2 * sz[b];
    size[c] = sz[c] * cScale; ctr[c] = (lo[c] + hi[c]) / 2;
    const m = withEdges(new THREE.Mesh(new THREE.BoxGeometry(...size.map(v => Math.max(v, .004))), blockMat(col)));
    m.position.set(...ctr); return m;
  };
  const g = part(0, 0.45, 0, 1, 0.9);
  g.add(part(0.45, 1, 0, 0.22, 0.55).translateX(-g.position.x).translateY(-g.position.y).translateZ(-g.position.z));
  g.add(part(0.45, 1, 0.78, 1, 0.55).translateX(-g.position.x).translateY(-g.position.y).translateZ(-g.position.z));
  return g;
}

// blocks: true replaces every link mesh with a box the size of its bounding box (same kinematics, block look).
async function loadZeno(base = 'robot/', { material = () => clay(), blocks = false } = {}) {
  const xml = new DOMParser().parseFromString(await (await fetch(base + 'zeno_h1.urdf')).text(), 'text/xml');
  const v3 = s => (s || '0 0 0').trim().split(/\s+/).map(Number);
  const links = {}, joints = {};
  const loader = new THREE.STLLoader();
  const loads = [];
  for (const l of xml.querySelectorAll('robot > link')) {
    const g = new THREE.Group(); g.name = l.getAttribute('name'); links[g.name] = g;
    const m = l.querySelector('visual mesh');
    if (!m) continue;
    const o = l.querySelector('visual origin');
    const file = m.getAttribute('filename').replace('package://zeno_h1_urdf/', base);
    loads.push(new Promise(res => loader.load(file, geo => {
      geo.computeVertexNormals();
      let mesh;
      if (blocks) {
        geo.computeBoundingBox(); const bb = geo.boundingBox, sz = new THREE.Vector3(), c = new THREE.Vector3();
        bb.getSize(sz); bb.getCenter(c);
        const col = blockColor(g.name);
        if (/arm_Link_7$/.test(g.name)) mesh = blockGripper(bb, col);
        else {
          mesh = withEdges(new THREE.Mesh(new THREE.BoxGeometry(Math.max(sz.x, .01), Math.max(sz.y, .01), Math.max(sz.z, .01)), blockMat(col)));
          mesh.geometry.translate(c.x, c.y, c.z); mesh.children[0].geometry.translate(c.x, c.y, c.z);
        }
        mesh.userData.base = col;
        if (g.name === 'torso_head_tilt_link') for (const y of [-0.035, 0.035]) { // stereo camera "eyes"
          const eye = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.022), blockMat(0x1d2633));
          eye.position.set(bb.max.x + 0.004, c.y + y, c.z + 0.01); mesh.add(eye);
        }
      } else mesh = new THREE.Mesh(geo, material(g.name));
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (o) { mesh.position.set(...v3(o.getAttribute('xyz'))); mesh.rotation.set(...v3(o.getAttribute('rpy')), 'ZYX'); }
      g.add(mesh); res();
    }, undefined, res)));
  }
  const children = new Set();
  for (const j of xml.querySelectorAll('robot > joint')) {
    const parent = links[j.querySelector('parent').getAttribute('link')];
    const child = links[j.querySelector('child').getAttribute('link')];
    children.add(child.name);
    const o = j.querySelector('origin');
    const frame = new THREE.Group();
    if (o) { frame.position.set(...v3(o.getAttribute('xyz'))); frame.rotation.set(...v3(o.getAttribute('rpy')), 'ZYX'); }
    const mover = new THREE.Group();
    frame.add(mover); mover.add(child); parent.add(frame);
    const axis = new THREE.Vector3(...v3(j.querySelector('axis')?.getAttribute('xyz') || '1 0 0')).normalize();
    const type = j.getAttribute('type'), lim = j.querySelector('limit');
    const lo = lim ? +lim.getAttribute('lower') : -Infinity, hi = lim ? +lim.getAttribute('upper') : Infinity;
    joints[j.getAttribute('name')] = {
      frame, mover, axis, type, lo, hi, value: 0,
      set(a) {
        a = Math.max(lo, Math.min(hi, a)); this.value = a;
        if (type === 'prismatic') mover.position.copy(axis).multiplyScalar(a);
        else if (type !== 'fixed') mover.quaternion.setFromAxisAngle(axis, a);
      },
    };
  }
  const rootLink = Object.values(links).find(l => !children.has(l.name));
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2; // URDF is Z-up
  root.add(rootLink);
  await Promise.all(loads);
  return { root, joints, links };
}

// Smooth looping keyframe player: keys = [{t, ...values}], returns values at time t (seconds).
function keyframes(keys, t) {
  const T = keys[keys.length - 1].t; t = ((t % T) + T) % T;
  let i = 0; while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1], u = (t - a.t) / (b.t - a.t || 1);
  const s = u * u * (3 - 2 * u); const out = {};
  for (const k in a) if (k !== 't') out[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * s;
  return out;
}

// HTML labels that follow 3D points. Returns add(text, object3D, offset[]) .
function makeLabels(stage, el, cls = 'lbl') {
  const items = [];
  stage.onFrame(() => {
    const w = el.clientWidth, h = el.clientHeight, p = new THREE.Vector3();
    for (const it of items) {
      it.obj.updateWorldMatrix(true, false);
      p.set(...it.off).applyMatrix4(it.obj.matrixWorld).project(stage.camera);
      it.div.style.transform = `translate(${(p.x + 1) / 2 * w}px,${(1 - p.y) / 2 * h}px) translate(-50%,-50%)`;
      it.div.style.display = p.z < 1 ? '' : 'none';
    }
  });
  return (text, obj, off = [0, 0, 0]) => {
    const div = document.createElement('div'); div.className = cls; div.innerHTML = text; el.appendChild(div);
    items.push({ div, obj, off }); return div;
  };
}
