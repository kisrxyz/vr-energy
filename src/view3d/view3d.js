import { TYPES, clamp, bbox, vClass, wireRoute, isPzId } from '../core/elements.js';
import { fmtTime } from '../core/engine.js';
import { Sound } from '../ui/sound.js';
import { Diag } from '../ui/diag.js';
import { store } from '../ui/store.js';
import { MODELS, S3, H3, makeKit } from './models/index.js';
import { wireMid } from '../view2d/scheme2d.js';
import { buildRoom, ROOM_COL } from './room.js';
import { Items } from './items.js';
import { Walk } from './walk.js';

/* ===== §6. 3D и VR =====
   Схема → открытое распределительное устройство: координаты схемы становятся планом на земле
   (1 клетка = 1,25 м), провода висят на высоте 3,4 м. Модели собраны из кубов и цилиндров,
   каждый тип — свой построитель в ./models/<тип>.js (интерфейс описан в models/index.js).
   Бюджет для шлема: ≤ ~200 вызовов отрисовки на кадр. Поэтому неподвижные детали сливаются по материалам,
   все подписи — одна сетка, все сигнальные лампы — одна InstancedMesh.
   Управление: мышь (вращать, сдвигать, щелчок по аппарату) и WebXR (луч контроллера, курок, стики).
   VR-полигон (схема с s.room): вместо площадки — помещение ЗРУ (room.js), предметы в руках (items.js),
   на ноутбуке — ходьба от первого лица (walk.js); «Вид сверху» там — обзор помещения без потолка. */
let THREE = null;
// three.js подгружается отдельным куском только при входе в 3D
async function loadThree() {
  if (!THREE) THREE = await import('three');
  return THREE;
}
const RAY = { idle: 0x1f45ff, hot: 0xffd23f };
const COL3 = { dead: 0x7d8884, gnd: 0xF2C318, v220: 0xC9D52E, v110: 0x22B8F5, v35: 0xD8893E, v10: 0xB660E6, v6: 0x5A86FF, v04: 0xFF8B3D, vlow: 0xA0ADA8, on: 0xFF2D40, off: 0x1FD36C, blown: 0xFFA21F, lampDark: 0x2a2f2d, live: ROOM_COL.live };
function rr(x, X, Y, W, H, R) {
  x.beginPath();
  x.moveTo(X + R, Y); x.lineTo(X + W - R, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + R);
  x.lineTo(X + W, Y + H - R); x.quadraticCurveTo(X + W, Y + H, X + W - R, Y + H);
  x.lineTo(X + R, Y + H); x.quadraticCurveTo(X, Y + H, X, Y + H - R);
  x.lineTo(X, Y + R); x.quadraticCurveTo(X, Y, X + R, Y); x.closePath();
}

class View3D {
  constructor(app, box) {
    this.app = app; this.host = box;
    this.ready = false; this.active = false;
    this.dev = new Map(); this.nodeMats = new Map(); this.pickables = []; this.fxList = [];
    this.builtFor = -1; this.builtTopo = null; this.hover = null; this.top = false; this.geoCache = new Map();
    this.room = null; this.items = null; this.walk = null;
  }
  async show() {
    this.active = true;
    if (!this.ready) {
      await loadThree();
      try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* шрифты не обязательны */ }
      this.init();
    }
    if (this.builtFor !== this.app.schemeVersion || this.builtTopo !== this.app.tr.topo) this.build();
    else if (this.room && !this.top) this.walk.enable(this.room);
    this.resize();
    this.update(true);
    this.renderer.setAnimationLoop((t, f) => this.loop(t, f));
    this.checkVR();
  }
  hide() {
    this.active = false;
    if (this.renderer && !this.renderer.xr.isPresenting) this.renderer.setAnimationLoop(null);
    if (this.walk) this.walk.disable();
    this.closeMenu3D();
    this.tip(null);
  }
  // Полигон от первого лица на ноутбуке (не обзор и не шлем)
  fpsOn() { return !!(this.room && !this.top && this.walk && this.walk.on && !this.renderer.xr.isPresenting); }

  // ---------- сцена ----------
  init() {
    const T = THREE;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.xr.enabled = true;
    r.domElement.setAttribute('aria-label', '3D-вид подстанции');
    this.host.prepend(r.domElement);
    const sc = this.scene = new T.Scene();
    sc.background = new T.Color(0xBCD2E4);
    sc.fog = new T.Fog(0xBCD2E4, 90, 320);
    this.camera = new T.PerspectiveCamera(60, 1, 0.05, 900);
    this.rig = new T.Group();
    this.rig.add(this.camera);
    sc.add(this.rig);
    this.hemi = new T.HemisphereLight(0xe8f2ff, 0x5d5a50, 1.1);
    sc.add(this.hemi);
    const sun = this.sun = new T.DirectionalLight(0xffffff, 1.7);
    sun.position.set(40, 70, 25);
    sc.add(sun);
    this.arcLight = new T.PointLight(0x9fd8ff, 0, 30, 2);
    sc.add(this.arcLight);
    this.root = new T.Group();
    sc.add(this.root);
    this.ray = new T.Raycaster();
    this.clock = new T.Clock();
    this.tmp = { m: new T.Matrix4(), v: new T.Vector3(), v2: new T.Vector3(), dir: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    this.geo = { sphere: new T.SphereGeometry(1, 18, 12), ring: new T.TorusGeometry(1.1, 0.06, 8, 48), lamp: new T.SphereGeometry(1, 12, 8) };
    this.makeMats();
    this.ring = new T.Mesh(this.geo.ring, new T.MeshBasicMaterial({ color: 0xffd23f }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false;
    sc.add(this.ring);
    this.orbit = { target: new T.Vector3(), r: 60, th: 0.42, ph: 0.98 };
    this.bindPointer();
    this.walk = new Walk(this);
    this.setupXR();
    Diag.on(t => { if (t === 'error') { this.drawBoard(); if (this.dbg && this.dbg.m.visible) this.drawDebug(); } });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.ready = true;
  }
  makeMats() {
    const T = THREE, M = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.1 }, o));
    this.M = {
      galv: M(0xb4bcbf, { metalness: 0.5, roughness: 0.5 }), porcelain: M(0x8a4f2a, { roughness: 0.35 }),
      tank: M(0x5c6b62, { metalness: 0.3, roughness: 0.6 }), radiator: M(0x6c7a71, { metalness: 0.3 }),
      cabinet: M(0xc9cdc7), concrete: M(0xa9a79e, { roughness: 0.95 }), blade: M(0xdfe5e8, { metalness: 0.8, roughness: 0.3 }),
      earthBlade: M(0xe0b81a, { metalness: 0.4, roughness: 0.5 }), plate: M(0x6f8f3a), dark: M(0x2b302e), handle: M(0x1f2226),
      wall: M(0xd9cfbd), roof: M(0x5b4a3c), motor: M(0x3f6f9e, { metalness: 0.35 }), pump: M(0x6f7d84, { metalness: 0.4 }),
      stripe: M(0xffd200, { emissive: 0x332a00 }), fan: M(0x2f3437), qf: M(0xe8e9e4), ground: M(0x7f8c66, { roughness: 1 }),
      yard: M(0xffffff, { roughness: 1 }), post: M(0x7d8285), ctrl: M(0x202428),
      kru: M(0xd4d8d2, { metalness: 0.2, roughness: 0.6 }), cap: M(0xb9bfc4, { metalness: 0.4, roughness: 0.45 }),
      coil: M(0x6b5a4a, { roughness: 0.8 }), pzCable: M(0xd8c25a, { roughness: 0.6 }),
    };
    this.kit = makeKit(THREE, this.M, this.geoCache, n => this.nodeMat(n));
    this.kit.sphere = this.geo.sphere;
    this.kit.winTex = () => this.winTex();
  }
  boxGeo(w, h, d) { const k = `b${w}|${h}|${d}`; if (!this.geoCache.has(k)) this.geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return this.geoCache.get(k); }
  cylGeo(r, h) { const k = `c${r}|${h}`; if (!this.geoCache.has(k)) this.geoCache.set(k, new THREE.CylinderGeometry(r, r, h, 14)); return this.geoCache.get(k); }
  box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(this.boxGeo(w, h, d), mat); m.position.set(x, y, z); return m; }
  cyl(r, h, mat, x = 0, y = 0, z = 0, axis) {
    const m = new THREE.Mesh(this.cylGeo(r, h), mat);
    m.position.set(x, y, z);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  }
  tube(a, b, r, mat) {
    const T = THREE, va = new T.Vector3(a[0], a[1], a[2]), vb = new T.Vector3(b[0], b[1], b[2]);
    const dir = vb.clone().sub(va), len = dir.length();
    const m = new T.Mesh(new T.CylinderGeometry(r, r, Math.max(len, 0.001), 10), mat);
    m.position.copy(va).addScaledVector(dir, 0.5);
    if (len > 0) m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    return m;
  }
  nodeMat(n) {
    if (!this.nodeMats.has(n)) this.nodeMats.set(n, new THREE.MeshStandardMaterial({ color: COL3.dead, roughness: 0.4, metalness: 0.3, emissive: 0x000000 }));
    return this.nodeMats.get(n);
  }
  labelSprite(text, bg = 'rgba(14,20,18,0.82)', h = 0.36) {
    const T = THREE, c = document.createElement('canvas'), x = c.getContext('2d');
    const font = '600 40px "JetBrains Mono", ui-monospace, monospace';
    x.font = font;
    const w = Math.ceil(x.measureText(text).width) + 32;
    c.width = w; c.height = 60;
    x.font = font;
    x.fillStyle = bg; rr(x, 0, 0, w, 60, 12); x.fill();
    x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.fillText(text, 16, 32);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(h * w / 60, h, 1);
    sp.renderOrder = 2;
    return sp;
  }
  winTex() {
    if (this._win) return this._win;
    const mk = (wall, win) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 160;
      const x = c.getContext('2d');
      x.fillStyle = wall; x.fillRect(0, 0, 256, 160);
      x.fillStyle = win;
      for (let row = 0; row < 2; row++) for (let k = 0; k < 5; k++) x.fillRect(14 + k * 48, 22 + row * 72, 32, 44);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    this._win = { map: mk('#d9cfbd', '#3a454c'), mask: mk('#000000', '#ffffff') };
    return this._win;
  }

  build() {
    const app = this.app, s = app.scheme, topo = app.tr.topo;
    for (const ch of [...this.root.children]) this.root.remove(ch);
    this.dev.clear(); this.nodeMats.clear(); this.pickables = []; this.hover = null; this.ring.visible = false;
    this.pzDev = new Map(); this.closeMenu3D();
    if (this.items) { this.items.dispose(); this.items = null; }
    const poly = !!(s.room && Array.isArray(s.room.cells) && s.room.cells.length);
    this.setEnv(poly);
    if (poly) {
      // VR-полигон: помещение ЗРУ, устройства ячеек и места для предметов (room.js), щит на стене
      this.room = buildRoom(this, s, topo);
      this.bounds = { hx: 6, hz: 4 };
      this.toWorld = () => new THREE.Vector3();
      this.start = new THREE.Vector3(this.room.start.x, 0, this.room.start.z);
      this.makeBoard(this.room.board);
    } else {
      this.room = null;
      if (this.walk) this.walk.disable();
      this.buildYard(s, topo);
    }
    this.compactParts();
    this.mergeStatic();
    this.makeLamps();
    this.makeLabels();
    if (this.room) {
      // потолок, передняя стена, светильники и дверь прячутся в обзоре сверху
      this.room.topMeshes = this.root.children.filter(o => o.isMesh && this.room.hideTop.has(o.material));
      this.items = new Items(this, this.room);
    }
    this.builtFor = app.schemeVersion;
    this.builtTopo = topo;
    this.resetCamera();
  }
  // Свет и фон: площадка под небом или закрытое помещение
  setEnv(poly) {
    const sc = this.scene;
    if (!this._fog) this._fog = sc.fog;
    if (poly) {
      sc.background.setHex(0x1d2427); sc.fog = null;
      this.hemi.color.setHex(0xf6f7f4); this.hemi.groundColor.setHex(0x7d776a); this.hemi.intensity = 1.55;
      this.sun.intensity = 0.95; this.sun.position.set(-12, 40, 34);
    } else {
      sc.background.setHex(0xBCD2E4); sc.fog = this._fog;
      this.hemi.color.setHex(0xe8f2ff); this.hemi.groundColor.setHex(0x5d5a50); this.hemi.intensity = 1.1;
      this.sun.intensity = 1.7; this.sun.position.set(40, 70, 25);
    }
  }
  buildYard(s, topo) {
    const T = THREE;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of s.els) { const b = bbox(el); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    if (!isFinite(x0)) { x0 = -6; y0 = -6; x1 = 6; y1 = 6; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const W = p => new T.Vector3((p[0] - cx) * S3, 0, (p[1] - cy) * S3);
    this.toWorld = W;
    const hx = (x1 - x0) / 2 * S3 + 7, hz = (y1 - y0) / 2 * S3 + 7;
    this.bounds = { hx, hz };
    const ground = new T.Mesh(new T.PlaneGeometry(700, 700), this.M.ground);
    ground.rotation.x = -Math.PI / 2; ground.userData.ground = true;
    this.root.add(ground); this.pickables.push(ground);
    if (!this.M.yard.map) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#b3b2aa'; x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) { const g = 140 + Math.floor(Math.random() * 70); x.fillStyle = `rgb(${g},${g - 2},${g - 8})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
      x.strokeStyle = 'rgba(90,92,86,0.2)'; x.lineWidth = 2; x.strokeRect(0, 0, 128, 128);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = 4;
      this.M.yard.map = tex; this.M.yard.needsUpdate = true;
    }
    this.M.yard.map.repeat.set(hx / 2, hz / 2);
    const yard = new T.Mesh(new T.PlaneGeometry(hx * 2, hz * 2), this.M.yard);
    yard.rotation.x = -Math.PI / 2; yard.position.y = 0.01; yard.userData.ground = true;
    this.root.add(yard); this.pickables.push(yard);
    this.buildFence(hx, hz);
    // Провода: видимые трубы (сливаются по узлам) и невидимые коробки для луча — на провод накладывают ПЗ и ставят указатель
    const pmat = new T.MeshBasicMaterial({ color: 0xffffff });
    for (const w of s.wires) {
      const pts = wireRoute(w).map(p => { const v = W(p); v.y = H3; return v; });
      const mat = this.nodeMat(topo.wireNode.get(w.id));
      for (let i = 0; i < pts.length - 1; i++) {
        if (pts[i].distanceTo(pts[i + 1]) < 1e-6) continue;
        const m = this.tube(pts[i].toArray(), pts[i + 1].toArray(), 0.045, mat);
        this.root.add(m);
        const a = pts[i], b = pts[i + 1], px = new T.Mesh(this.boxGeo(Math.abs(b.x - a.x) + 0.35, 0.35, Math.abs(b.z - a.z) + 0.35), pmat);
        px.position.set((a.x + b.x) / 2, H3, (a.z + b.z) / 2);
        px.visible = false; px.userData.wire = w.id; px.userData.proxy = true;
        this.root.add(px); this.pickables.push(px);
      }
    }
    for (const el of s.els) {
      const g = this.model(el, topo);
      if (!g) continue;
      g.position.copy(W([el.x, el.y]));
      g.rotation.y = -el.r * Math.PI / 2;
      this.root.add(g);
    }
    this.start = new T.Vector3(0, 0, hz + 1.5);
    this.makeBoard();
    this.makeProxies();
  }
  buildFence(hx, hz) {
    const T = THREE, per = [], step = 3, gate = 3;
    for (let x = -hx; x <= hx + 0.01; x += step) { per.push([x, -hz]); if (Math.abs(x) > gate) per.push([x, hz]); }
    for (let z = -hz + step; z < hz - 0.01; z += step) per.push([-hx, z], [hx, z]);
    const im = new T.InstancedMesh(this.cylGeo(0.05, 2.2), this.M.post, per.length);
    const m4 = new T.Matrix4();
    per.forEach((p, i) => { m4.makeTranslation(p[0], 1.1, p[1]); im.setMatrixAt(i, m4); });
    this.root.add(im);
    const pts = [];
    const segs = [[[-hx, -hz], [hx, -hz]], [[hx, -hz], [hx, hz]], [[hx, hz], [gate, hz]], [[-gate, hz], [-hx, hz]], [[-hx, hz], [-hx, -hz]]];
    for (const y of [0.6, 1.3, 2.0]) for (const [a, b] of segs) pts.push(new T.Vector3(a[0], y, a[1]), new T.Vector3(b[0], y, b[1]));
    this.root.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x5f666a })));
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 320, 200);
    x.strokeStyle = '#d0202f'; x.lineWidth = 14; x.strokeRect(7, 7, 306, 186);
    x.fillStyle = '#d0202f'; x.font = '700 40px "Golos Text", system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText('СТОЙ!', 160, 62); x.fillText('НАПРЯЖЕНИЕ', 160, 176);
    x.fillStyle = '#111'; x.beginPath(); x.moveTo(176, 74); x.lineTo(140, 118); x.lineTo(162, 118); x.lineTo(146, 146); x.lineTo(186, 104); x.lineTo(164, 104); x.closePath(); x.fill();
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const sign = new T.Mesh(new T.PlaneGeometry(0.8, 0.5), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.position.set(-gate - 1.6, 1.4, hz + 0.06);
    this.root.add(sign);
  }

  // Невидимые коробки вокруг аппаратов: по ним считается щелчок и луч контроллера
  makeProxies(only) {
    const T = THREE;
    this.root.updateMatrixWorld(true);
    const mat = this._proxyMat || (this._proxyMat = new T.MeshBasicMaterial({ color: 0xffffff }));
    const b = new T.Box3(), size = new T.Vector3(), c = new T.Vector3(), out = [];
    for (const [id, d] of only || this.dev) {
      b.makeEmpty();
      for (const ch of d.group.children) if (!(d.far && d.far.includes(ch))) b.expandByObject(ch);
      if (b.isEmpty()) continue;
      b.getSize(size); b.getCenter(c);
      const m = new T.Mesh(new T.BoxGeometry(Math.max(size.x, 0.6), Math.max(size.y, 0.6), Math.max(size.z, 0.6)), mat);
      m.position.copy(c); m.visible = false; m.userData.dev = id; m.userData.proxy = true;
      this.root.add(m);
      this.pickables.push(m);
      out.push(m);
    }
    return out;
  }
  // Подвижная часть из нескольких фигур (тележка, ротор, ПЗ) сливается по материалам в своей системе координат
  // d.merge — свои группы для слияния (тележка ячейки полигона: лицевая панель и начинка отдельно)
  compactParts() {
    for (const d of this.dev.values()) {
      const parts = (d.merge || ['pivot', 'lever', 'slide', 'show', 'mark'].map(k => d[k])).filter(Boolean).concat(d.merge ? [d.pivot, d.lever].filter(Boolean) : [], d.spin || []);
      for (const g of parts) this.mergeInto(g);
    }
  }
  mergeInto(g) {
    const T = THREE, buckets = new Map();
    g.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(g.matrixWorld).invert(), m4 = new T.Matrix4();
    // невидимые коробки для щелчка и луча (полигон: на тележке) не сливаются — у них своя роль
    g.traverse(o => { if (o.isMesh && o !== g && !o.userData.proxy) { let l = buckets.get(o.material); if (!l) buckets.set(o.material, l = []); l.push(o); } });
    for (const [mat, list] of buckets) {
      if (list.length < 2) continue;
      const geo = this.joinGeos(list.map(m => { const q = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); q.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld)); return q; }));
      for (const m of list) m.parent.remove(m);
      g.add(new T.Mesh(geo, mat));
    }
  }
  joinGeos(parts) {
    const T = THREE, out = new T.BufferGeometry();
    for (const nm of ['position', 'normal', 'uv']) {
      if (!parts.every(q => q.attributes[nm])) continue;
      let len = 0;
      for (const q of parts) len += q.attributes[nm].array.length;
      const arr = new Float32Array(len);
      let off = 0;
      for (const q of parts) { arr.set(q.attributes[nm].array, off); off += q.attributes[nm].array.length; }
      out.setAttribute(nm, new T.BufferAttribute(arr, parts[0].attributes[nm].itemSize));
    }
    parts.forEach(q => q.dispose());
    out.computeBoundingSphere();
    return out;
  }
  // Неподвижные детали с одинаковым материалом сливаются в одну сетку: меньше вызовов отрисовки в шлеме
  mergeStatic() {
    const T = THREE, dyn = new Set();
    for (const d of this.dev.values()) {
      for (const k of ['pivot', 'lever', 'slide', 'show', 'mark', 'beacon']) if (d[k]) d[k].traverse(o => dyn.add(o));
      if (d.spin) for (const sp of d.spin) sp.traverse(o => dyn.add(o));
    }
    const buckets = new Map();
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || dyn.has(o) || o.userData.proxy || o.userData.ground || o.userData.board || o.userData.dyn) return;
      if (o.material && o.material.map && o.material.emissiveMap) return;
      let l = buckets.get(o.material);
      if (!l) buckets.set(o.material, l = []);
      l.push(o);
    });
    for (const [mat, list] of buckets) {
      if (list.length < 2) continue;
      const out = this.joinGeos(list.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g; }));
      this.root.add(new T.Mesh(out, mat));
      for (const m of list) m.parent.remove(m);
    }
  }
  // Все сигнальные лампы схемы — одна InstancedMesh с цветом на каждую лампу
  makeLamps() {
    const T = THREE, list = [];
    this.root.updateMatrixWorld(true);
    for (const d of this.dev.values()) for (const l of d.lamps || []) list.push({ d, l });
    this.lampList = list; this.lampMesh = null;
    if (!list.length) return;
    const im = new T.InstancedMesh(this.geo.lamp, new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), list.length);
    const m4 = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    list.forEach(({ d, l }, i) => {
      v.set(l.p[0], l.p[1], l.p[2]).applyMatrix4((l.slide ? d.slide : d.group).matrixWorld);
      m4.compose(v, q, sc.setScalar(l.s));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, new T.Color(COL3.lampDark));
      l.i = i;
    });
    im.frustumCulled = false;
    this.root.add(im);
    this.lampMesh = im;
  }
  // Лампы на выкатной тележке (кнопки) едут вместе с ней
  moveLamps(d) {
    const im = this.lampMesh;
    if (!im) return;
    const m4 = this._m4 || (this._m4 = new THREE.Matrix4()), v = this.tmp.v, q = this._q || (this._q = new THREE.Quaternion()), sc = this.tmp.v2;
    d.slide.updateMatrixWorld(true);
    for (const l of d.lamps) {
      if (!l.slide) continue;
      v.set(l.p[0], l.p[1], l.p[2]).applyMatrix4(d.slide.matrixWorld);
      im.setMatrixAt(l.i, m4.compose(v, q, sc.setScalar(l.s)));
    }
    im.instanceMatrix.needsUpdate = true;
  }
  // role у лампы (полигон): on / off — лампа «включён» или «отключён», live — ИНН (напряжение на линии), btnOn / btnOff — кнопки
  setLamps(blink) {
    const im = this.lampMesh;
    if (!im) return;
    const c = this._lampColor || (this._lampColor = new THREE.Color());
    for (const { d, l } of this.lampList) {
      let hex = d.lampState === 'blown' ? COL3.blown : d.lampState === 'on' ? COL3.on : d.lampState === 'off' ? COL3.off : COL3.lampDark;
      if (l.role === 'on') hex = d.lampState === 'on' ? COL3.on : COL3.lampDark;
      else if (l.role === 'off') hex = d.lampState === 'off' ? COL3.off : COL3.lampDark;
      else if (l.role === 'live') hex = d.live ? COL3.live : COL3.lampDark;
      else if (l.role === 'btnOn') hex = 0xb81c2a;
      else if (l.role === 'btnOff') hex = 0x168a45;
      if (d.trip && !blink && l.role !== 'live' && l.role !== 'btnOn' && l.role !== 'btnOff') hex = COL3.lampDark;
      im.setColorAt(l.i, c.setHex(hex));
    }
    im.instanceColor.needsUpdate = true;
  }
  // Все подписи — одна сетка: текстуры подписей в одном атласе, квадраты всегда смотрят на камеру
  makeLabels() {
    const T = THREE, list = [];
    for (const d of this.dev.values()) if (d.labelPos) list.push(d);
    this.labelMesh = null;
    if (!list.length) return;
    // атлас в 1,5 раза плотнее прежнего (60 px вместо 40) — подписи чётче в шлеме; размер в сцене тот же
    const font = '600 60px "JetBrains Mono", ui-monospace, monospace', LH = 90, AW = 2048;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    x.font = font;
    let cx = 0, cy = 0;
    // labelText — своя подпись (ячейка полигона: «Яч.3 · Л-3 «Цех №3»»), labelH — высота подписи, м
    const text = d => d.labelText || d.el.name;
    const boxes = list.map(d => {
      const w = Math.min(AW, Math.ceil(x.measureText(text(d)).width) + 48);
      if (cx + w > AW) { cx = 0; cy += LH; }
      const b = { x: cx, y: cy, w };
      cx += w + 2;
      return b;
    });
    c.width = AW; c.height = cy + LH;
    x.font = font; x.textBaseline = 'middle';
    list.forEach((d, i) => {
      const b = boxes[i];
      x.fillStyle = 'rgba(14,20,18,0.82)'; rr(x, b.x, b.y, b.w, LH, 18); x.fill();
      x.fillStyle = '#ffffff'; x.fillText(text(d), b.x + 24, b.y + 48);
    });
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const n = list.length, center = new Float32Array(n * 12), corner = new Float32Array(n * 8), uv = new Float32Array(n * 8), idx = [];
    const v = new T.Vector3();
    this.root.updateMatrixWorld(true);
    list.forEach((d, i) => {
      const h = d.labelH || 0.36, b = boxes[i], w = h * b.w / LH;
      v.set(d.labelPos[0], d.labelPos[1], d.labelPos[2]).applyMatrix4(d.group.matrixWorld);
      const u0 = b.x / AW, u1 = (b.x + b.w) / AW, v1 = 1 - b.y / c.height, v0 = 1 - (b.y + LH) / c.height;
      const cs = [[-w / 2, -h / 2, u0, v0], [w / 2, -h / 2, u1, v0], [w / 2, h / 2, u1, v1], [-w / 2, h / 2, u0, v1]];
      cs.forEach(([ox, oy, uu, vv], j) => {
        center.set([v.x, v.y, v.z], (i * 4 + j) * 3);
        corner.set([ox, oy], (i * 4 + j) * 2);
        uv.set([uu, vv], (i * 4 + j) * 2);
      });
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(center, 3));
    geo.setAttribute('corner', new T.BufferAttribute(corner, 2));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new T.ShaderMaterial({
      uniforms: { map: { value: tex }, far: { value: 0 } },
      vertexShader: `attribute vec2 corner; varying vec2 vUv; uniform float far;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xy += corner;
          gl_Position = projectionMatrix * mv; if (far > 0.0 && -mv.z > far) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.userData.board = true; mesh.raycast = () => {};
    this.root.add(mesh);
    this.labelMesh = mesh;
  }

  // ---------- модели ----------
  model(el, topo) {
    const mod = MODELS[el.t];
    if (!mod) return null;
    const d = { el, group: new THREE.Group(), kind: el.t, trip: false, mod };
    const k = this.kit.forEl(el, topo, d);
    const r = mod.build(k, el, d) || {};
    d.labelPos = r.label || [0, H3 + 0.8, 0];
    this.dev.set(el.id, d);
    return d.group;
  }
  // ПЗ, наложенные в тренажёре: модель ставится в точку провода и убирается, когда ПЗ снято
  // Модель пересоздаётся и тогда, когда ПЗ перенесли в другую точку, пока 3D был скрыт.
  syncPz() {
    const tr = this.app.tr, on = new Set(tr.pzOn()), where = id => { const pl = this.app.view.pzPlace(id); return pl ? pl.p.join(',') + '/' + pl.r : ''; };
    for (const [id, d] of this.pzDev) if (!on.has(id) || d.where !== where(id)) {
      this.root.remove(d.group);
      for (const p of d.proxies) { this.root.remove(p); this.pickables.splice(this.pickables.indexOf(p), 1); }
      this.dev.delete(id); this.pzDev.delete(id);
    }
    for (const id of on) {
      if (this.pzDev.has(id)) continue;
      const pl = this.app.view.pzPlace(id);
      if (!pl) continue;
      const el = tr.elOf(id), d = { el, group: new THREE.Group(), kind: 'pz', trip: false, mod: MODELS.pz };
      const k = this.kit.forEl(el, tr.topo, d);
      MODELS.pz.build(k, el, d);
      this.mergeInto(d.show);
      d.group.position.copy(this.toWorld(pl.p));
      d.group.rotation.y = -pl.r * Math.PI / 2;
      d.where = where(id);
      this.root.add(d.group);
      this.dev.set(id, d);
      d.proxies = this.makeProxies(new Map([[id, d]]));
      this.pzDev.set(id, d);
    }
  }

  // ---------- состояние ----------
  update(instant) {
    if (!this.ready || !this.active) return;
    const tr = this.app.tr;
    this.closeMenu3D();   // после любой операции пункты меню тележки устарели
    if (this.builtTopo !== tr.topo) this.build();
    // в полигоне ПЗ — предмет в руках (items.js), отдельной модели на проводе нет
    if (!this.room) this.syncPz();
    const st = tr.state;
    for (const [n, m] of this.nodeMats) {
      const kv = st.V.get(n);
      let col, ei;
      if (kv != null) { col = COL3[vClass(kv)]; ei = 0.55; } else if (st.G.has(n)) { col = COL3.gnd; ei = 0.3; } else { col = COL3.dead; ei = 0; }
      m.color.setHex(col); m.emissive.setHex(col); m.emissiveIntensity = ei;
    }
    for (const [id, d] of this.dev) {
      const sw = tr.sim.st[id], tm = tr.topo.term.get(id) || [];
      d.trip = sw ? !!sw.trip : false;
      const ss = tr.sim.src[id];
      const s = { on: sw ? !!sw.on : false, pos: sw && sw.pos, trip: d.trip, blown: !!(sw && sw.blown), src: !!(ss && ss.on && !ss.trip), live: i => st.V.has(tm[i]) };
      if (d.mod.update) d.mod.update(d, s);
      if (instant) {
        if (d.angT != null) { d.ang = d.angT; d.pivot.rotation.x = d.ang; }
        if (d.leverT != null) d.lever.rotation[d.leverAxis || 'x'] = d.leverT;
        if (d.slideT != null) { d.slideX = d.slideT; d.slide.position[d.slideAxis || 'x'] = d.slideX; this.slideMoved(d); }
        if (d.speedT != null) d.speed = d.speedT;
      }
    }
    this.setLamps(true);
    if (this.items) this.items.sync();
    this.drawBoard();
  }
  // Тележка ячейки полигона сдвинулась: начинка видна только снаружи шкафа, кнопки едут с панелью
  slideMoved(d) {
    if (!d.inner) return;
    const vis = d.slideX > 0.02;
    if (d.inner.visible !== vis) { d.inner.visible = vis; if (d.zn) d.zn.pivot.visible = vis; }
    this.moveLamps(d);
  }
  // Предметы, плакаты и мероприятия изменились (событие 'field' движка)
  onField(d = {}) {
    if (!this.ready) return;
    if (this.items) this.items.sync(!!d.reset);
    this.drawBoard();
  }
  // Кадр: ошибка в шаге или отрисовке уходит в журнал, сессия VR продолжается
  loop(time) {
    try { this.step(time); } catch (e) { this.xrError(this.renderer.xr.isPresenting ? 'VR-кадр' : '3D-кадр', e); }
    try { this.renderer.render(this.scene, this.camera); } catch (e) { this.xrError('отрисовка', e); }
    this.perfTick(performance.now());
  }
  step(time) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const blink = Math.floor(time / 350) % 2 === 0;
    let trips = false;
    for (const d of this.dev.values()) {
      if (d.pivot && d.angT != null && d.ang !== d.angT) {
        const diff = d.angT - d.ang;
        d.ang += Math.sign(diff) * Math.min(Math.abs(diff), 2.4 * dt);
        d.pivot.rotation.x = d.ang;
      }
      if (d.lever && d.leverT != null) {
        const ax = d.leverAxis || 'x', cur = d.lever.rotation[ax], diff = d.leverT - cur;
        if (diff) d.lever.rotation[ax] = cur + Math.sign(diff) * Math.min(Math.abs(diff), 9 * dt);
      }
      if (d.slide && d.slideT != null && d.slideX !== d.slideT) {
        const diff = d.slideT - d.slideX;
        d.slideX += Math.sign(diff) * Math.min(Math.abs(diff), 0.8 * dt);
        d.slide.position[d.slideAxis || 'x'] = d.slideX;
        this.slideMoved(d);
      }
      if (d.spin && d.spin.length) {
        d.speed += (d.speedT - d.speed) * Math.min(1, dt * (d.speedT > d.speed ? 0.9 : 0.45));
        if (d.speed > 0.01) for (const sp of d.spin) sp.rotation.x += d.speed * dt;
      }
      if (d.trip) trips = true;
    }
    if (trips || this._tripsWas) this.setLamps(blink);
    this._tripsWas = trips;
    this.stepFx(dt);
    const xr = this.renderer.xr.isPresenting;
    if (this.labelMesh) this.labelMesh.material.uniforms.far.value = xr ? 32 : 0;
    if (xr) this.xrFrame(dt);
    else if (this.fpsOn()) this.walk.step(dt);
    if (this.items) this.items.step(dt, time);
    if (this.menu3d && performance.now() > this.menu3d.until) this.closeMenu3D();
  }

  // ---------- камера и мышь ----------
  applyOrbit() {
    const o = this.orbit, sp = Math.sin(o.ph);
    this.camera.position.set(o.target.x + o.r * sp * Math.sin(o.th), o.target.y + o.r * Math.cos(o.ph), o.target.z + o.r * sp * Math.cos(o.th));
    this.camera.lookAt(o.target);
  }
  resetCamera() {
    const o = this.orbit, b = document.getElementById('btnCam');
    this.top = false;
    if (this.room) {
      // полигон: от первого лица у входа; «Обзор» — помещение сверху без потолка
      this.showTop(true);
      this.walk.reset(this.room.start);
      if (this.active) this.walk.enable(this.room);
      if (b) b.textContent = 'Обзор';
      return;
    }
    o.target.set(0, 1.5, 0);
    o.r = clamp(Math.max(this.bounds.hx, this.bounds.hz) * 1.3, 22, 200);
    o.target.set(0, 1.5, this.bounds.hz * 0.12);
    o.th = 0.42; o.ph = 0.98;
    if (b) b.textContent = 'Вид сверху';
    this.applyOrbit();
  }
  toggleTopView() {
    if (!this.ready) return;
    this.top = !this.top;
    const o = this.orbit, b = document.getElementById('btnCam');
    if (this.room) {
      this.closeMenu3D();
      if (this.top) {
        this.walk.disable();
        this.showTop(false);
        o.target.set(this.room.view.x, 0.8, this.room.view.z); o.r = this.room.view.r; o.th = 0.25; o.ph = 0.72;
        this.applyOrbit();
      } else {
        this.showTop(true);
        this.walk.enable(this.room);
        this.walk.apply();
      }
      b.textContent = this.top ? 'От первого лица' : 'Обзор';
      return;
    }
    if (this.top) { o.ph = 0.04; o.th = 0; o.target.set(0, 0, 0); } else { o.ph = 0.98; o.th = 0.42; }
    b.textContent = this.top ? 'Вид сбоку' : 'Вид сверху';
    this.applyOrbit();
  }
  // Потолок, передняя стена и светильники полигона: в обзоре сверху спрятаны
  showTop(on) { if (this.room && this.room.topMeshes) for (const m of this.room.topMeshes) m.visible = on; }
  pan(dx, dy) {
    const o = this.orbit, k = o.r * 0.0016;
    const fw = this.tmp.v.set(Math.sin(o.th), 0, Math.cos(o.th));
    const right = this.tmp.v2.set(fw.z, 0, -fw.x);
    o.target.addScaledVector(right, -dx * k).addScaledVector(fw, -dy * k);
    o.target.x = clamp(o.target.x, -this.bounds.hx * 1.5, this.bounds.hx * 1.5);
    o.target.z = clamp(o.target.z, -this.bounds.hz * 1.5, this.bounds.hz * 1.5);
  }
  bindPointer() {
    const el = this.renderer.domElement, pts = new Map();
    let drag = null, down = null;
    // в полигоне от первого лица мышь ведёт walk.js: захват, взгляд, действие по прицелу
    const fps = e => { if (!this.fpsOn()) return false; this.walk.pointer(e); return true; };
    el.addEventListener('pointerdown', e => {
      if (fps(e)) return;
      this.app.userGesture();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* нет захвата */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, r0: this.orbit.r, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, moved: false, btn: e.button, shift: e.shiftKey };
      drag = { kind: (e.button === 2 || e.button === 1 || e.ctrlKey) ? 'pan' : 'rot', x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', e => {
      if (fps(e)) return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!drag) { this.hoverAt(e.clientX, e.clientY); return; }
      const o = this.orbit;
      if (drag.kind === 'pinch') {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()];
        o.r = clamp(drag.r0 * drag.d0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 4, 260);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.pan(mx - drag.mx, my - drag.my); drag.mx = mx; drag.my = my;
        this.applyOrbit();
        return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
      if (down && !down.moved) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.kind === 'rot') { o.th -= dx * 0.006; o.ph = clamp(o.ph - dy * 0.006, 0.04, 1.5); this.top = o.ph < 0.2; }
      else this.pan(dx, dy);
      this.applyOrbit();
      this.tip(null);
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (fps(e)) { drag = null; down = null; return; }
      if (drag && drag.kind === 'pinch') { if (!pts.size) drag = null; return; }
      const click = down && !down.moved && down.btn === 0 && e.type === 'pointerup';
      const shift = down && down.shift;
      drag = null; down = null;
      if (click) this.clickAt(e.clientX, e.clientY, shift);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', e => { if (fps(e)) return; if (!drag) { this.tip(null); this.setHover(null); } });
    el.addEventListener('wheel', e => { e.preventDefault(); if (this.fpsOn()) return; this.orbit.r = clamp(this.orbit.r * Math.exp(e.deltaY * 0.001), 4, 260); this.applyOrbit(); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  clickAt(cx, cy, shift) {
    const h = this.pick(cx, cy);
    if (!h) return;
    const u = h.object.userData;
    if (u.board) { this.boardClick(h.uv); return; }
    if (u.menu) { this.menuClick(h.uv); return; }
    if (u.dev) { this.app.pick3D(u.dev, shift, { cx, cy }); this.hover = null; this.hoverAt(cx, cy); return; }
    if (u.wire) this.app.pickWire3D(u.wire, shift);
  }
  // Луч ловит провод только с инструментом (указатель, ПЗ) — иначе провод не мешает щёлкать по аппаратам
  pick(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.ray.far = 900;
    return this.firstHit(this.ray.intersectObjects(this.pickables, false));
  }
  firstHit(hits) {
    const tool = !!this.app.tool;
    // предметы и места полигона ловит items.js (руки), обычный щелчок и обзор — только аппараты и щит
    return hits.find(h => { const u = h.object.userData; return !u.ground && (tool || !u.wire) && !u.item && !u.mount && !u.stand; }) || null;
  }
  hoverAt(cx, cy) {
    const h = this.pick(cx, cy);
    const u = h ? h.object.userData : {}, id = u.dev;
    this.setHover(id || null);
    const cv = this.renderer.domElement, tr = this.app.tr;
    if (id) {
      const el = tr.elOf(id), sw = tr.sim.st[id], T = TYPES[el.t];
      let t = el.name + (sw ? (T.cart ? ` · тележка: ${{ work: 'рабочее', test: 'контрольное', repair: 'ремонтное' }[sw.pos]}` + (T.sw === 'breaker' ? (sw.on ? ', включён' : ', отключён') : '') : sw.on ? ' · включён' : ' · отключён') : '');
      if (this.app.tool === 'check') t += ' — проверить напряжение';
      else if (this.app.tool === 'pz') t += el.t === 'bus' ? ' — наложить ПЗ' : isPzId(id) ? ' — снять ПЗ' : '';
      else if (sw) t += tr.actions(id).length > 1 ? ' — щелчок: меню' : sw.on ? ' — щелчок: отключить' : ' — щелчок: включить';
      this.tip(t, cx, cy);
      cv.style.cursor = 'pointer';
    } else if (u.wire) { this.tip(this.app.tool === 'pz' ? 'Провод — наложить или снять ПЗ' : 'Провод — проверить напряжение', cx, cy); cv.style.cursor = 'pointer'; }
    else if (u.board || u.menu) { this.tip(u.menu ? 'Выберите действие' : 'Щит: нажмите кнопку', cx, cy); cv.style.cursor = 'pointer'; }
    else { this.tip(null); cv.style.cursor = 'grab'; }
  }
  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    if (!id || !this.dev.has(id) || this.room) { this.ring.visible = false; return; }
    const d = this.dev.get(id), p = this.tmp.v;
    d.group.getWorldPosition(p);
    this.ring.position.set(p.x, 0.06, p.z);
    this.ring.scale.setScalar(d.kind === 'transformer' || d.kind === 'tr3' ? 2.3 : d.kind === 'load' ? 2.6 : 1.25);
    this.ring.visible = d.kind !== 'bus';
  }
  tip(text, x, y) {
    const t = document.getElementById('v3tip');
    if (!t) return;
    if (!text) { t.hidden = true; return; }
    const r = this.host.getBoundingClientRect();
    t.hidden = false; t.textContent = text;
    t.style.left = (x - r.left) + 'px'; t.style.top = (y - r.top) + 'px';
  }
  resize() {
    if (!this.renderer || this.renderer.xr.isPresenting) return;
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- подготовка к тесту в шлеме: замеры, отладка, отметки, обучение ----------
  // Ошибка внутри кадра или обработчика XR: в журнал (без повторов каждый кадр), сессия продолжается
  xrError(where, e) {
    const msg = String(e && e.message ? e.message : e), now = performance.now();
    if (this._errMsg === msg && now - this._errT < 3000) return;
    this._errMsg = msg; this._errT = now;
    Diag.addError(where, e);
  }
  // Раз в секунду: FPS, вызовы отрисовки, ввод — в запись теста и на панель отладки
  perfTick(now) {
    const p = this.perf || (this.perf = { t0: now, frames: 0, fps: 0, hist: [] });
    p.frames++;
    if (now - p.t0 < 1000) return;
    p.fps = p.frames * 1000 / (now - p.t0);
    p.t0 = now; p.frames = 0;
    p.hist.push(Math.round(p.fps)); if (p.hist.length > 10) p.hist.shift();
    const inf = this.renderer.info.render;
    p.calls = inf.calls; p.tris = inf.triangles;
    if (this.renderer.xr.isPresenting) Diag.sessionTick({ fps: p.fps, calls: p.calls, tris: p.tris, ref: this.refInfo, inputs: this.inputList() });
    if (this.dbg && this.dbg.m.visible) this.drawDebug();
  }
  // Что подключено: «левый: oculus-touch-v3, контроллер»
  inputList() {
    const s = this.renderer.xr.getSession && this.renderer.xr.getSession();
    if (!s || !s.inputSources) return [];
    const side = { left: 'левый', right: 'правый', none: 'без стороны' };
    return [...s.inputSources].map(i => `${side[i.handedness] || i.handedness}: ${(i.profiles && i.profiles[0]) || '?'}, ${i.hand ? 'руки' : i.gamepad ? 'контроллер' : i.targetRayMode}`);
  }
  mkPanel(w, h, pw, ph) {
    const T = THREE, c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(pw, ph), new T.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = 12; m.visible = false;
    return { c, t, m };
  }
  // Панель отладки у левого края взгляда. В шлеме — кнопка «Отладка» на щите, на компьютере в 3D — клавиша F.
  toggleDebug(on) {
    if (!this.ready) return;
    if (!this.dbg) { this.dbg = this.mkPanel(640, 560, 0.4, 0.35); this.dbg.m.position.set(-0.36, 0.1, -0.9); this.camera.add(this.dbg.m); }
    this.dbg.m.visible = on == null ? !this.dbg.m.visible : on;
    if (this.dbg.m.visible) this.drawDebug();
    this.drawBoard();
  }
  drawDebug() {
    const { c, t } = this.dbg, x = c.getContext('2d'), p = this.perf || {}, xr = this.renderer.xr, s = xr.getSession && xr.getSession();
    const F = (w, sz) => `${w} ${sz}px "JetBrains Mono", ui-monospace, monospace`;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(8,12,10,0.88)'; rr(x, 0, 0, c.width, c.height, 20); x.fill();
    let y = 44;
    const line = (text, color = '#e8efe9', size = 24, w = 500) => { x.font = F(w, size); x.fillStyle = color; x.fillText(this.fit(x, text, c.width - 40), 20, y); y += size + 10; };
    const fps = Math.round(p.fps || 0), minFps = p.hist && p.hist.length ? Math.min(...p.hist) : 0;
    line(`FPS ${fps}  (мин. за 10 с: ${minFps})`, fps >= 68 ? '#5ee08f' : fps >= 50 ? '#f5b544' : '#ff6b7d', 34, 600);
    line(`Отрисовка: ${p.calls || 0} вызовов${xr.isPresenting ? ' (оба глаза)' : ''}, ${Math.round((p.tris || 0) / 1000)} тыс. треуг.`);
    if (xr.isPresenting) { x.font = F(500, 22); x.fillStyle = '#e8efe9'; this.wrap(x, `VR: ${this.refInfo || '?'}`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 30; }); }
    else line('VR: не запущен (3D на экране)');
    const ins = this.inputList();
    if (!ins.length) line('Ввод: нет', '#93a69e');
    for (const i of ins.slice(0, 3)) line('· ' + i, '#c6d3cd', 22);
    const cp = this.camera.getWorldPosition(this.tmp.v2);
    line(`Где стою: x ${cp.x.toFixed(1)} м, z ${cp.z.toFixed(1)} м, глаза ${cp.y.toFixed(2)} м`, '#c6d3cd', 22);
    const d = Diag.data();
    line(`Отметок: ${d.marks.length} · ошибок в журнале: ${Diag.errors().length}`, '#c6d3cd', 22);
    x.font = F(400, 18); x.fillStyle = '#93a69e';
    this.wrap(x, navigator.userAgent, c.width - 40, 3).forEach(l => { x.fillText(l, 20, y); y += 24; });
    const e = Diag.pageErrors ? Diag.lastError() : null;
    if (e) { y += 4; x.font = F(600, 20); x.fillStyle = '#ff6b7d'; this.wrap(x, `Ошибка: ${e.where}: ${e.msg}`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 26; }); }
    t.needsUpdate = true;
  }
  // Что сейчас перед глазами: аппарат, провод, щит, земля
  gazeLabel() {
    const cam = this.camera, o = this.tmp.v.setFromMatrixPosition(cam.matrixWorld), dir = this.tmp.dir;
    cam.getWorldDirection(dir);
    this.ray.ray.origin.copy(o); this.ray.ray.direction.copy(dir); this.ray.far = 120;
    const h = this.ray.intersectObjects(this.pickables, false)[0];
    if (!h) return { label: 'небо, вдаль', board: false };
    const u = h.object.userData, dist = ` (${h.distance.toFixed(1)} м)`;
    if (u.dev) return { label: this.app.tr.nm(u.dev) + dist, board: false };
    if (u.item && this.items) return { label: this.items.list.get(u.item).it.title + dist, board: false };
    if (u.mount) return { label: u.mount + dist, board: false };
    if (u.stand) return { label: 'стенд со средствами защиты' + dist, board: false };
    if (u.wire) return { label: 'провод' + dist, board: false };
    if (u.board) return { label: 'щит с заданием' + dist, board: true };
    if (u.menu) return { label: 'меню тележки' + dist, board: false };
    return { label: 'земля' + dist, board: false };
  }
  // Отметка: время, FPS, где стою, на что смотрю, состояние задания — в запись теста
  addMark(from) {
    let g = this.gazeLabel();
    // со щита взгляд всегда на щите — берём то, на что смотрели до этого
    if (g.board && this.lastGaze && performance.now() - this.lastGaze.t < 15000) g = { label: this.lastGaze.label + ` — ${Math.round((performance.now() - this.lastGaze.t) / 1000)} с назад` };
    const cp = this.camera.getWorldPosition(new THREE.Vector3());
    let near = null, nd = 8;
    for (const d of this.dev.values()) { const p = d.group.getWorldPosition(this.tmp.v2), dd = Math.hypot(p.x - cp.x, p.z - cp.z); if (dd < nd) { nd = dd; near = d; } }
    const tr = this.app.tr, run = tr.run;
    const m = Diag.addMark({
      fps: Math.round((this.perf && this.perf.fps) || 0), look: g.label, via: from,
      where: `x ${cp.x.toFixed(1)}, z ${cp.z.toFixed(1)} м${near ? ', рядом ' + near.el.name : ''}`,
      task: run ? `задание «${run.task.title}»${run.done ? ' завершено' : `: операций ${run.ops.length}, ошибок ${run.errors.length}`}` : 'свободный режим',
    });
    this.banner(`Отметка ${m.n} сохранена: ${m.look}`, 'info');
    if (this.dbg && this.dbg.m.visible) this.drawDebug();
  }
  // Короткое обучение перед лицом: при первом входе в VR и по кнопке «Обучение» на щите; закрывается курком
  showTutor(on = true) {
    if (!this.tutor) { this.tutor = this.mkPanel(1024, 600, 1.0, 0.586); this.tutor.m.position.set(0, -0.05, -1.25); this.camera.add(this.tutor.m); }
    this.tutor.m.visible = on;
    if (!on) return;
    const { c, t } = this.tutor, x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(16,24,21,0.94)'; rr(x, 0, 0, c.width, c.height, 28); x.fill();
    x.fillStyle = '#3b4fd1'; rr(x, 0, 0, c.width, 10, 4); x.fill();
    // в полигоне — как брать предметы (то же на табличке над стендом)
    x.fillStyle = '#ffffff'; x.font = F(600, 44); x.fillText(this.room ? 'Как брать предметы' : 'Как управлять', 44, 82);
    const steps = this.room ? [
      ['1', 'Подойдите к стенду справа от входа', 'Левый стик — ходьба, правый — поворот, курок по полу — переход. На стенде — СИЗ, указатель, ПЗ, плакаты, замок, ограждение.'],
      ['2', 'Боковая кнопка — взять и отпустить', 'Поднесите руку к предмету и нажмите боковую кнопку. Ещё раз у нужного места — повесить, запереть, поставить; в стороне — уронить.'],
      ['3', 'Надеть и коснуться', 'Перчатки поднесите к другой руке, каску — к голове. Указателем коснитесь нижних контактов в отсеке тележки. Курок — переключить аппарат.'],
    ] : [
      ['1', 'Луч и курок', 'Наведите луч на аппарат и нажмите курок — он переключится. Курок по земле — переход в эту точку.'],
      ['2', 'Боковая кнопка — указатель', 'Наведите луч и нажмите боковую кнопку (под средним пальцем) — проверка напряжения.'],
      ['3', 'Стики', 'Левый стик — ходьба, правый — поворот. Кнопка A или X — отметка для отчёта теста.'],
    ];
    let y = 150;
    for (const [n, h, d] of steps) {
      x.fillStyle = '#3b4fd1'; x.beginPath(); x.arc(72, y - 4, 26, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffffff'; x.font = F(700, 30); x.textAlign = 'center'; x.fillText(n, 72, y + 7); x.textAlign = 'left';
      x.font = F(600, 32); x.fillText(h, 120, y + 6);
      x.font = F(400, 26); x.fillStyle = '#c6d3cd';
      this.wrap(x, d, c.width - 160, 2).forEach((l, i) => x.fillText(l, 120, y + 46 + i * 32));
      y += 140;
    }
    x.fillStyle = '#ffd23f'; x.font = F(600, 30); x.textAlign = 'center';
    x.fillText('Нажмите курок, чтобы начать', c.width / 2, c.height - 30); x.textAlign = 'left';
    t.needsUpdate = true;
  }
  // Руки без контроллеров: луч и щипок работают не полностью — честно просим взять контроллеры
  checkHands() {
    const s = this.renderer.xr.getSession && this.renderer.xr.getSession();
    const src = s && s.inputSources ? [...s.inputSources] : [];
    const hands = src.length > 0 && src.every(i => i.hand);
    if (hands === !!this.handsOnly) return;
    this.handsOnly = hands;
    if (hands) this.banner('Возьмите контроллеры: управление руками в тренажёре не поддерживается.', 'warn');
    this.drawBoard();
  }

  // ---------- щит с заданием ----------
  makeBoard(place) {
    const T = THREE;
    if (!this.boardCanvas) {
      // рисуем в координатах 1024×720, текстура в 1,5 раза плотнее — чтобы читалось в шлеме с 2–3 м
      this.boardCanvas = document.createElement('canvas');
      this.boardW = 1024; this.boardH = 720; this.boardK = 1.5;
      this.boardCanvas.width = this.boardW * this.boardK; this.boardCanvas.height = this.boardH * this.boardK;
      this.boardTex = new T.CanvasTexture(this.boardCanvas);
      this.boardTex.colorSpace = T.SRGBColorSpace;
      this.boardTex.anisotropy = 4;
    }
    const g = new T.Group();
    const panel = new T.Mesh(new T.PlaneGeometry(3.2, 2.25), new T.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
    panel.position.y = 2.25; panel.userData.board = true; g.add(panel);
    g.add(this.box(3.32, 2.37, 0.08, this.M.dark, 0, 2.25, -0.05));
    // place — щит на стене помещения (полигон): без стоек, уменьшенный
    if (place) {
      g.position.set(place.pos[0], place.pos[1], place.pos[2]); g.rotation.y = place.ry; g.scale.setScalar(place.scale);
    } else {
      for (const x of [-1.35, 1.35]) g.add(this.box(0.1, 1.2, 0.1, this.M.galv, x, 0.6, -0.05));
      g.position.set(-4.4, 0, this.bounds.hz - 1.4);
      g.rotation.y = 0.5;
    }
    this.root.add(g);
    this.pickables.push(panel);
    this.drawBoard();
  }
  wrap(x, text, maxW, maxLines) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = this.fit(x, lines[maxLines - 1] + '…', maxW); }
    return lines;
  }
  fit(x, text, maxW) {
    if (x.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  drawBoard() {
    if (!this.boardCanvas) return;
    const c = this.boardCanvas, x = c.getContext('2d'), app = this.app, tr = app.tr, W = this.boardW, H = this.boardH;
    const F = (w, s) => `${w} ${s}px "Golos Text", system-ui, sans-serif`;
    x.setTransform(this.boardK, 0, 0, this.boardK, 0, 0);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#14201b'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#3b4fd1'; x.fillRect(0, 0, W, 8);
    x.fillStyle = '#eef4f1'; x.font = F(600, 32); x.fillText(this.fit(x, app.scheme.title, W - 64), 32, 58);
    x.fillStyle = '#93a69e'; x.font = F(400, 22);
    const poly = !!this.room, pm = app.permit;
    const mode = poly ? 'предметы: боковая кнопка в шлеме, E на ноутбуке' : app.tool === 'check' ? 'режим указателя напряжения' : app.tool === 'pz' ? 'переносное заземление: курок по проводу или шине' : 'курок — операция, боковая кнопка — указатель';
    x.fillText(this.fit(x, `Блокировки ${tr.opt.interlocks ? 'включены' : 'выключены'} · ${mode}`, W - 64), 32, 92);
    let y = 142;
    const para = (text, size, weight, color, maxLines) => {
      x.font = F(weight, size); x.fillStyle = color;
      for (const l of this.wrap(x, text, W - 64, maxLines)) { x.fillText(l, 32, y); y += Math.round(size * 1.3); }
    };
    const run = tr.run, tasks = app.scheme.tasks;
    if (run) {
      para(run.task.title, 30, 600, '#ffffff', 2);
      if (!run.done) {
        para(run.task.desc, 22, 400, '#c6d3cd', poly ? 2 : 3);
        const g = tr.grade(run);
        y += 8; x.font = F(600, 26); x.fillStyle = run.errors.length ? '#ffb4bd' : '#eef4f1';
        x.fillText(`Время ${fmtTime(tr.elapsed())} · операций ${g.myOps} · ошибок ${run.errors.length}`, 32, y); y += 40;
        // полигон: сколько мероприятий сделано, СИЗ и подсказка «следующее мероприятие»
        if (poly && run.task.measures) {
          const st = pm.status();
          x.font = F(500, 22); x.fillStyle = '#c6d3cd';
          x.fillText(`Мероприятия: ${st.n} из ${st.total} · СИЗ: перчатки ${st.ppe.gloves ? '✓' : '—'}, каска ${st.ppe.helmet ? '✓' : '—'}`, 32, y); y += 34;
          if (st.guide && st.next) para('Следующее: ' + st.next, 26, 600, '#ffd23f', 2);
        }
      } else {
        const g = run.grade;
        y += 6; x.font = F(600, 30); x.fillStyle = g.tone === 'good' ? '#4ade80' : g.tone === 'mid' ? '#f5a524' : '#ff5a6e';
        x.fillText(`${g.verdict} · ${g.score} из 100`, 32, y); y += 42;
        x.font = F(400, 22); x.fillStyle = '#c6d3cd';
        x.fillText(`Время ${fmtTime(g.secs)} · операций ${g.myOps} (эталон ${g.refOps}) · ошибок ${run.errors.length}`, 32, y); y += 36;
      }
    } else if (tasks.length) {
      const i = clamp(app.taskIdx, 0, tasks.length - 1);
      x.font = F(500, 22); x.fillStyle = '#93a69e';
      x.fillText(`Задание ${i + 1} из ${tasks.length}: выберите стрелками и нажмите «Начать»`, 32, y); y += 40;
      para(tasks[i].title, 30, 600, '#ffffff', 2);
      para(tasks[i].desc, 22, 400, '#c6d3cd', 3);
    } else para('Свободная тренировка: наведите луч на аппарат и нажмите курок.', 26, 500, '#ffffff', 2);
    y = Math.max(y + 12, 392);
    x.fillStyle = '#2b3a34'; x.fillRect(32, y - 30, W - 64, 2);
    x.font = F(400, 21);
    for (const e of tr.log.slice(0, 3)) {
      x.fillStyle = e.level === 'err' ? '#ff6b7d' : e.level === 'warn' ? '#f5b544' : e.level === 'ok' ? '#5ee08f' : '#c6d3cd';
      x.fillText(this.fit(x, e.text, W - 64), 32, y); y += 30;
    }
    // в полигоне ПЗ — предмет со стенда, а вместо платной подсказки — «следующее мероприятие» (вкл/выкл)
    const btns = [], pz = poly ? [] : [['pz', 'ПЗ']];
    if (run && !run.done) btns.push(poly && run.task.measures ? ['guide', pm.guide ? 'Подсказки: вкл' : 'Подсказки: выкл'] : ['hint', 'Подсказка'], ['ack', 'Квитировать'], ...pz, ['stop', 'Завершить']);
    else if (run && run.done) btns.push(['again', 'Ещё раз'], ['exit', 'Свободный режим'], ['lock', tr.opt.interlocks ? 'Блокировки: вкл' : 'Блокировки: выкл']);
    else {
      if (tasks.length) btns.push(['prev', '‹'], ['next', '›'], ['start', 'Начать']);
      btns.push(['ack', 'Квитировать'], ...pz, ['reset', 'Сброс'], ['lock', tr.opt.interlocks ? 'Блок.: вкл' : 'Блок.: выкл']);
    }
    // узкие кнопки: стрелки и ПЗ
    const fixed = { prev: 76, next: 76, pz: 92 };
    const bh = 64, by = H - bh - 22, gap = 12, fx = btns.reduce((a, b) => a + (fixed[b[0]] || 0), 0), nf = btns.filter(b => fixed[b[0]]).length;
    const bigW = (W - 64 - fx - gap * (btns.length - 1)) / (btns.length - nf);
    let bx = 32;
    this.boardBtns = [];
    for (const [act, label] of btns) {
      const w = fixed[act] || bigW;
      const lit = act === 'start' || act === 'again' || (act === 'pz' && app.tool === 'pz');
      x.fillStyle = lit ? '#3b4fd1' : '#24332d'; rr(x, bx, by, w, bh, 12); x.fill();
      x.strokeStyle = '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffffff'; x.font = F(600, act === 'prev' || act === 'next' ? 40 : 24); x.textAlign = 'center';
      x.fillText(label, bx + w / 2, by + (act === 'prev' || act === 'next' ? 46 : 41));
      x.textAlign = 'left';
      this.boardBtns.push({ act, x: bx, y: by, w, h: bh });
      bx += w + gap;
    }
    // служебный ряд для теста: слева последняя ошибка (красным), справа отметка, отладка, обучение
    const sy = by - 62, sh = 50, sw = 150;
    const util = [['mark', 'Отметка'], ['debug', 'Отладка'], ['tutor', 'Обучение']];
    util.forEach(([act, label], i) => {
      const ux = W - 32 - (util.length - i) * (sw + 10) + 10, lit = act === 'debug' && this.dbg && this.dbg.m.visible;
      x.fillStyle = lit ? '#3b4fd1' : '#1d2a25'; rr(x, ux, sy, sw, sh, 10); x.fill();
      x.strokeStyle = '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#dfe8e3'; x.font = F(600, 22); x.textAlign = 'center'; x.fillText(label, ux + sw / 2, sy + 33); x.textAlign = 'left';
      this.boardBtns.push({ act, x: ux, y: sy, w: sw, h: sh });
    });
    const err = Diag.pageErrors ? Diag.lastError() : null;
    if (err) {
      x.fillStyle = '#ff6b7d'; x.font = F(600, 20);
      this.wrap(x, `Ошибка: ${err.where}: ${err.msg}`, W - 64 - util.length * (sw + 10) - 10, 2).forEach((l, i) => x.fillText(l, 32, sy + 20 + i * 24));
    }
    if (this.handsOnly) {
      x.fillStyle = 'rgba(165,92,0,0.96)'; rr(x, 32, 300, W - 64, 120, 16); x.fill();
      x.fillStyle = '#ffffff'; x.font = F(600, 36); x.fillText('Возьмите контроллеры', 56, 350);
      x.font = F(400, 24); x.fillText('Управление руками в тренажёре не поддерживается: нужны курок и стики.', 56, 392);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    this.boardTex.needsUpdate = true;
    if (this.wrist && this.renderer && this.renderer.xr.isPresenting) this.drawWrist();
  }
  boardClick(uv) {
    if (!uv || !this.boardBtns) return;
    const px = uv.x * this.boardW, py = (1 - uv.y) * this.boardH;
    const b = this.boardBtns.find(q => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
    if (b) this.boardAction(b.act);
  }
  boardAction(act) {
    const app = this.app, tr = app.tr, n = app.scheme.tasks.length;
    Sound.play('check');
    if (act === 'prev' && n) app.taskIdx = (app.taskIdx - 1 + n) % n;
    else if (act === 'next' && n) app.taskIdx = (app.taskIdx + 1) % n;
    else if (act === 'start') app.startTask(app.scheme.tasks[app.taskIdx]);
    else if (act === 'again' && tr.run) app.startTask(tr.run.task);
    else if (act === 'stop') tr.stopTask();
    else if (act === 'hint') { if (!tr.hint()) this.banner('Все эталонные шаги выполнены.', 'info'); }
    else if (act === 'ack') { if (!tr.ack()) this.banner('Сигналов нет.', 'info'); }
    else if (act === 'reset') { if (!tr.resetToNormal()) this.banner('Сначала завершите задание.', 'warn'); }
    else if (act === 'lock') { tr.opt.interlocks = !tr.opt.interlocks; app.toast(`Блокировки: ${tr.opt.interlocks ? 'включены' : 'выключены'}.`); }
    else if (act === 'exit') tr.exitTask();
    else if (act === 'pz') app.toggleTool('pz');
    else if (act === 'guide') { const on = app.permit.toggleGuide(); this.banner(`Подсказки мероприятий ${on ? 'включены' : 'выключены'}.`, 'info'); }
    else if (act === 'mark') this.addMark('щит');
    else if (act === 'debug') this.toggleDebug();
    else if (act === 'tutor') { if (this.room && !this.renderer.xr.isPresenting) this.walk.intro(true); else this.showTutor(true); }
    app.renderSide();
    this.drawBoard();
  }

  // ---------- эффекты ----------
  // Точка в сцене для эффекта: аппарат, ПЗ на проводе или середина провода
  posOf(id) {
    if (this.room) return this.room.posOf(id);
    const p = new THREE.Vector3(), dv = this.dev.get(id);
    if (dv) { dv.group.getWorldPosition(p); return p; }
    if (isPzId(id)) { const pl = this.app.view.pzPlace(id); return pl ? this.toWorld(pl.p) : null; }
    const w = this.app.scheme.wires.find(v => v.id === id);
    return w ? this.toWorld(wireMid(w)) : null;
  }
  fx(d) {
    if (!this.active) return;
    const p = this.posOf(d.id);
    if (!p) return;
    if (!this.room) p.y = H3;
    this.arc(p);
  }
  arc(p) {
    const T = THREE;
    const sph = new T.Mesh(this.geo.sphere, new T.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
    sph.position.copy(p); sph.scale.setScalar(0.3);
    this.scene.add(sph);
    const n = 140, pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = 3 + Math.random() * 6, k = Math.sqrt(1 - u * u);
      vel.push(new T.Vector3(k * Math.cos(a) * s, Math.abs(u) * s + 1, k * Math.sin(a) * s));
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xffd27a, size: 0.09, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    this.scene.add(pts);
    this.arcLight.position.copy(p);
    this.arcLight.intensity = 90;
    this.fxList.push({ t: 0, life: 1.6, sph, pts, vel });
  }
  checkFx(d) {
    if (!this.active) return;
    const p = this.posOf(d.target);
    if (!p) return;
    const sp = this.labelSprite(d.live ? 'U есть' : 'U нет', d.live ? 'rgba(210,25,50,0.92)' : 'rgba(20,150,80,0.92)', this.room ? 0.2 : 0.5);
    sp.position.set(p.x, this.room ? p.y + 0.35 : H3 + 1.7, p.z);
    this.scene.add(sp);
    this.fxList.push({ t: 0, life: 2.4, mark: sp });
    this.banner(d.text, d.live ? 'warn' : 'info');
  }
  stepFx(dt) {
    if (this.arcLight.intensity > 0) this.arcLight.intensity = Math.max(0, this.arcLight.intensity - 180 * dt);
    if (!this.fxList.length) return;
    for (const f of this.fxList) {
      f.t += dt;
      const k = f.t / f.life;
      if (f.sph) { f.sph.scale.setScalar(0.3 + 2.8 * Math.min(1, k * 2)); f.sph.material.opacity = Math.max(0, 1 - k * 2.2); }
      if (f.pts) {
        const a = f.pts.geometry.attributes.position;
        for (let i = 0; i < f.vel.length; i++) {
          const v = f.vel[i];
          v.y -= 9.8 * dt;
          a.array[i * 3] += v.x * dt;
          a.array[i * 3 + 1] = Math.max(0.03, a.array[i * 3 + 1] + v.y * dt);
          a.array[i * 3 + 2] += v.z * dt;
        }
        a.needsUpdate = true;
        f.pts.material.opacity = Math.max(0, 1 - k);
      }
      if (f.mark) f.mark.material.opacity = k > 0.75 ? Math.max(0, (1 - k) * 4) : 1;
    }
    const done = this.fxList.filter(f => f.t >= f.life);
    for (const f of done) {
      if (f.sph) { this.scene.remove(f.sph); f.sph.material.dispose(); }
      if (f.pts) { this.scene.remove(f.pts); f.pts.geometry.dispose(); f.pts.material.dispose(); }
      if (f.mark) { this.scene.remove(f.mark); f.mark.material.map.dispose(); f.mark.material.dispose(); }
    }
    if (done.length) this.fxList = this.fxList.filter(f => f.t < f.life);
  }

  // ---------- VR ----------
  async checkVR() {
    const b = document.getElementById('btnVR'), note = document.getElementById('v3note');
    let ok = false;
    try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { ok = false; }
    b.disabled = !ok;
    b.title = ok ? 'Войти в VR' : 'VR откроется в браузере шлема по https-ссылке';
    note.hidden = ok;
    if (!ok) note.textContent = 'VR откроется в браузере шлема Meta Quest по https-ссылке (например, GitHub Pages). Здесь — 3D: мышь вращает сцену, щелчок переключает аппарат, Shift+щелчок — указатель напряжения.';
  }
  async enterVR() {
    if (!this.ready) return;
    if (this.renderer.xr.isPresenting) { const s = this.renderer.xr.getSession(); if (s) await s.end(); return; }
    if (!navigator.xr) { this.app.toast('В этом браузере нет WebXR. Откройте ссылку в браузере шлема Quest.', 'warn'); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      this.refType = 'local-floor';
      this.renderer.xr.setReferenceSpaceType('local-floor');
      try { await this.renderer.xr.setSession(session); }
      catch (e) {
        // без пола в шлеме — обычное локальное пространство (рост тогда не учитывается)
        Diag.addError('вход в VR: local-floor', e);
        this.refType = 'local (local-floor не дали)';
        this.renderer.xr.setReferenceSpaceType('local');
        await this.renderer.xr.setSession(session);
      }
    } catch (e) {
      console.error(e);
      this.app.toast('Не удалось войти в VR: ' + (e && e.message ? e.message : e) + '. Откройте страницу по https-ссылке в браузере шлема.', 'warn');
    }
  }
  setupXR() {
    const T = THREE, r = this.renderer;
    this.ctrls = [];
    // Луч — тонкая полоса насыщенного синего: видна и на светлом небе, и на земле; над аппаратом — жёлтая
    const lineGeo = new T.BoxGeometry(0.007, 0.007, 1).translate(0, 0, -0.5);
    for (let i = 0; i < 2; i++) {
      const c = r.xr.getController(i);
      const line = new T.Mesh(lineGeo, new T.MeshBasicMaterial({ color: RAY.idle, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      line.scale.z = 6; line.visible = false; c.add(line);
      const dot = new T.Mesh(this.geo.sphere, new T.MeshBasicMaterial({ color: RAY.idle, toneMapped: false }));
      dot.scale.setScalar(0.045); dot.visible = false;
      this.scene.add(dot);
      const info = { i, c, line, dot, hand: null, src: null, turned: false };
      c.addEventListener('connected', e => { info.src = e.data; info.hand = e.data.handedness; if (info.hand === 'left' && !e.data.hand) this.attachWrist(info); this.checkHands(); });
      c.addEventListener('disconnected', () => { info.src = null; line.visible = false; dot.visible = false; this.checkHands(); });
      c.addEventListener('selectstart', () => { try { this.xrSelect(info); } catch (e) { this.xrError('курок', e); } });
      c.addEventListener('squeezestart', () => { try { this.xrSqueeze(info); } catch (e) { this.xrError('боковая кнопка', e); } });
      this.rig.add(c);
      const grip = r.xr.getControllerGrip(i);
      grip.add(this.box(0.04, 0.035, 0.12, this.M.ctrl, 0, 0, 0.02));
      this.rig.add(grip);
      info.grip = grip;
      this.ctrls.push(info);
    }
    const mk = (w, h, pw, ph) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
      const m = new T.Mesh(new T.PlaneGeometry(pw, ph), new T.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
      m.renderOrder = 10; m.visible = false;
      return { c, t, m };
    };
    this.bannerH = mk(1024, 180, 1.0, 0.176);
    this.bannerH.m.position.set(0, -0.24, -1.2);
    this.camera.add(this.bannerH.m);
    this.wrist = mk(512, 256, 0.2, 0.1);
    this.wrist.m.position.set(0, 0.07, 0.05);
    this.wrist.m.rotation.x = -0.9;
    r.xr.addEventListener('sessionstart', () => this.onXRStart());
    r.xr.addEventListener('sessionend', () => this.onXREnd());
  }
  attachWrist(info) { info.grip.add(this.wrist.m); this.wrist.m.visible = true; this.drawWrist(); }
  drawWrist() {
    const { c, t } = this.wrist, x = c.getContext('2d'), tr = this.app.tr;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(16,24,21,0.9)'; rr(x, 0, 0, c.width, c.height, 22); x.fill();
    x.fillStyle = '#93a69e'; x.font = '500 22px "Golos Text", system-ui, sans-serif';
    let top = this.app.tool === 'check' ? 'Указатель напряжения включён' : this.app.tool === 'pz' ? 'ПЗ: курок по проводу или шине' : 'Курок — операция · боковая — указатель';
    // полигон: СИЗ и что в руках
    if (this.room) {
      const pp = this.app.permit.status().ppe, held = this.items ? [0, 1].map(h => this.items.heldIn(h)).filter(Boolean).map(id => this.items.list.get(id).it.title) : [];
      top = `Перчатки ${pp.gloves ? '✓' : '—'} · каска ${pp.helmet ? '✓' : '—'}${held.length ? ' · в руках: ' + held.join(', ') : ''}`;
    }
    x.fillText(this.fit(x, top, c.width - 40), 20, 38);
    const e = tr.log[0];
    x.fillStyle = !e ? '#c6d3cd' : e.level === 'err' ? '#ff6b7d' : e.level === 'warn' ? '#f5b544' : e.level === 'ok' ? '#5ee08f' : '#eef4f1';
    x.font = '600 26px "Golos Text", system-ui, sans-serif';
    this.wrap(x, e ? e.text : 'Событий пока нет', c.width - 40, 3).forEach((l, i) => x.fillText(l, 20, 80 + i * 34));
    const err = Diag.pageErrors ? Diag.lastError() : null;
    if (err) { x.fillStyle = '#ff6b7d'; x.font = '600 20px "Golos Text", system-ui, sans-serif'; this.wrap(x, `Ошибка: ${err.msg}`, c.width - 40, 2).forEach((l, i) => x.fillText(l, 20, 206 + i * 24)); }
    t.needsUpdate = true;
  }
  banner(text, level) {
    if (!this.ready || !this.renderer.xr.isPresenting || !this.bannerH) return;
    const { c, t, m } = this.bannerH, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = level === 'err' ? 'rgba(200,20,45,0.92)' : level === 'warn' ? 'rgba(165,92,0,0.92)' : 'rgba(18,30,26,0.9)';
    rr(x, 0, 0, c.width, c.height, 24); x.fill();
    x.fillStyle = '#ffffff'; x.font = '600 32px "Golos Text", system-ui, sans-serif';
    this.wrap(x, text, c.width - 60, 3).forEach((l, i) => x.fillText(l, 30, 54 + i * 42));
    t.needsUpdate = true;
    m.visible = true;
    this.bannerUntil = performance.now() + (level === 'err' ? 5500 : 3500);
  }
  xrHits(info) {
    const c = info.c;
    this.tmp.m.identity().extractRotation(c.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).applyMatrix4(this.tmp.m);
    this.ray.far = 80;
    return this.ray.intersectObjects(this.pickables, false);
  }
  // Первое попадание луча для курка: аппарат, щит, меню, провод (с инструментом), земля; предметы и места полигона — у items.js
  xrHit(info, hits) {
    return (hits || this.xrHits(info)).find(h => { const u = h.object.userData; return (this.app.tool || !u.wire) && !u.item && !u.mount && !u.stand; }) || null;
  }
  pulse(info, k) {
    const gp = info.src && info.src.gamepad, ha = gp && gp.hapticActuators && gp.hapticActuators[0];
    try { if (ha && ha.pulse) ha.pulse(k, 60); } catch (e) { /* без вибрации */ }
  }
  xrSelect(info) {
    this.app.userGesture();
    if (this.tutor && this.tutor.m.visible) { this.showTutor(false); store.set(this.room ? 'ts.polyTutorVR' : 'ts.vrTutor', '1'); this.pulse(info, 0.3); return; }
    const hits = this.xrHits(info);
    // полигон: курок с предметом в этой руке — надеть, повесить, коснуться указателем по лучу
    if (this.room && this.items && this.items.select(info, hits)) return;
    const h = this.xrHit(info, hits);
    if (!h) return;
    const u = h.object.userData;
    if (u.board) { this.boardClick(h.uv); this.pulse(info, 0.3); return; }
    if (u.menu) { this.menuClick(h.uv); this.pulse(info, 0.5); return; }
    this.closeMenu3D();
    if (u.dev) { this.app.pick3D(u.dev, false, { menu3d: acts => this.showMenu3D(u.dev, acts, h.point) }); this.pulse(info, 0.7); return; }
    if (u.wire) { this.app.pickWire3D(u.wire, false); this.pulse(info, 0.5); return; }
    if (u.ground) {
      // в помещении — только туда, где можно стоять (не в ячейку и не за стену)
      if (this.room && !this.room.walkable(h.point.x, h.point.z)) { this.banner('Туда не пройти.', 'info'); return; }
      const p = this.tmp.v;
      this.camera.getWorldPosition(p);
      this.rig.position.x += h.point.x - p.x;
      this.rig.position.z += h.point.z - p.z;
    }
  }
  xrSqueeze(info) {
    // полигон: боковая кнопка — взять предмет и отпустить (у места — повесить, поставить)
    if (this.room && this.items) { this.items.squeeze(info, this.xrHits(info)); this.drawWrist(); return; }
    const h = this.xrHit(info);
    if (h && h.object.userData.dev) { this.app.pick3D(h.object.userData.dev, true); this.pulse(info, 0.4); }
    else if (h && h.object.userData.wire) { this.app.pickWire3D(h.object.userData.wire, true); this.pulse(info, 0.4); }
  }
  // Меню аппарата в VR (выкатная тележка): панель перед аппаратом, кнопки нажимаются лучом
  showMenu3D(id, acts, point) {
    this.closeMenu3D();
    const T = THREE, w = 560, rowH = 84, top = 70, H = top + acts.length * rowH + 14;
    const c = document.createElement('canvas'); c.width = w; c.height = H;
    const x = c.getContext('2d'), F = (wt, sz) => `${wt} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.fillStyle = 'rgba(16,24,21,0.95)'; rr(x, 0, 0, w, H, 22); x.fill();
    x.fillStyle = '#93a69e'; x.font = F(600, 30); x.fillText(this.fit(x, this.app.tr.nm(id), w - 48), 24, 46);
    const btns = acts.map((a, i) => {
      const y = top + i * rowH;
      x.fillStyle = '#24332d'; rr(x, 14, y, w - 28, rowH - 12, 14); x.fill();
      x.strokeStyle = '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffffff'; x.font = F(600, 28); x.fillText(this.fit(x, a.label, w - 70), 34, y + 46);
      return { y0: y, y1: y + rowH - 12, a };
    });
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const pw = 1.0, m = new T.Mesh(new T.PlaneGeometry(pw, pw * H / w), new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = 11;
    const cam = this.camera.getWorldPosition(new T.Vector3()), dir = cam.clone().sub(point);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    m.position.copy(point).addScaledVector(dir, Math.min(1.2, cam.distanceTo(point) * 0.5));
    m.position.y = clamp(cam.y - 0.15, 0.8, 2.4);
    m.lookAt(cam.x, m.position.y, cam.z);
    m.userData.menu = true;
    this.scene.add(m); this.pickables.push(m);
    this.menu3d = { m, id, btns, H, until: performance.now() + 12000 };
  }
  menuClick(uv) {
    const mm = this.menu3d;
    if (!mm || !uv) return;
    const py = (1 - uv.y) * mm.H, b = mm.btns.find(q => py >= q.y0 && py <= q.y1);
    if (!b) return;
    this.closeMenu3D();
    this.app.tr.operate(mm.id, b.a.pos ? { pos: b.a.pos } : undefined);
  }
  closeMenu3D() {
    const mm = this.menu3d;
    if (!mm) return;
    this.scene.remove(mm.m);
    const i = this.pickables.indexOf(mm.m);
    if (i >= 0) this.pickables.splice(i, 1);
    mm.m.material.map.dispose(); mm.m.material.dispose(); mm.m.geometry.dispose();
    this.menu3d = null;
  }
  xrFrame(dt) {
    let hoverId = null;
    for (const info of this.ctrls) {
      if (!info.src) continue;
      info.line.visible = true;
      const hits = this.xrHits(info), h = this.xrHit(info, hits);
      // полигон: луч жёлтый и над предметом или местом, куда можно повесить то, что в руке
      const it = this.room && this.items ? this.items.pick(hits, info.i, 1.7) : null;
      const hp = it && (!h || it.h.distance <= h.distance) ? it.h : h;
      if (hp) {
        info.line.scale.z = hp.distance;
        info.dot.visible = true; info.dot.position.copy(hp.point);
        if (hp.object.userData.dev) hoverId = hp.object.userData.dev;
      } else { info.line.scale.z = 6; info.dot.visible = false; }
      const u = hp && hp.object.userData, col = it || (u && (u.dev || u.board || u.menu || u.wire)) ? RAY.hot : RAY.idle;
      info.line.material.color.setHex(col); info.dot.material.color.setHex(col);
      const gp = info.src.gamepad;
      // A (правый) или X (левый) — отметка для отчёта теста
      const bA = !!(gp && gp.buttons && gp.buttons[4] && gp.buttons[4].pressed);
      if (bA && !info.aWas) this.addMark('кнопка ' + (info.hand === 'left' ? 'X' : 'A'));
      info.aWas = bA;
      if (gp && gp.axes && gp.axes.length) {
        const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
        const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
        if (info.hand === 'right') this.xrTurn(info, ax);
        else this.xrMove(ax, ay, dt);
      }
    }
    this.setHover(hoverId);
    if (this.room && this.items) this.items.xrFrame(this.ctrls);
    if (this.bannerH.m.visible && performance.now() > this.bannerUntil) this.bannerH.m.visible = false;
    const now = performance.now();
    if (!this.gazeT || now - this.gazeT > 250) {
      this.gazeT = now;
      const g = this.gazeLabel();
      if (!g.board) this.lastGaze = { label: g.label, t: now };
    }
  }
  xrMove(ax, ay, dt) {
    if (Math.abs(ax) < 0.15 && Math.abs(ay) < 0.15) return;
    const f = this.tmp.dir;
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) return;
    f.normalize();
    const sp = 3.0 * dt, dx = (f.x * -ay + -f.z * ax) * sp, dz = (f.z * -ay + f.x * ax) * sp;
    if (this.room) {
      // в помещении стик не проводит сквозь стены, ячейки и выкаченные тележки
      const p = this.camera.getWorldPosition(this.tmp.v2), [nx, nz] = this.room.resolve(p.x + dx, p.z + dz, 0.22);
      this.rig.position.x += nx - p.x; this.rig.position.z += nz - p.z;
      return;
    }
    this.rig.position.x += dx;
    this.rig.position.z += dz;
  }
  xrTurn(info, ax) {
    if (!info.turned && Math.abs(ax) > 0.7) {
      const ang = -Math.sign(ax) * Math.PI / 6, p = this.tmp.v;
      this.camera.getWorldPosition(p);
      this.rig.position.sub(p).applyAxisAngle(this.tmp.up, ang).add(p);
      this.rig.rotation.y += ang;
      info.turned = true;
    }
    if (Math.abs(ax) < 0.3) info.turned = false;
  }
  onXRStart() {
    this.rig.position.copy(this.start);
    this.rig.rotation.set(0, 0, 0);
    if (this.room) {
      // полигон: у входа лицом к стенду; на ноутбуке управление отключается до выхода из шлема
      this.walk.disable();
      this.camera.position.set(0, 0, 0); this.camera.rotation.set(0, 0, 0);
      this.rig.rotation.y = this.room.start.yaw;
      if (this.items) this.items.xrStart();
    }
    this.tip(null); this.setHover(null);
    document.getElementById('btnVR').textContent = 'Выйти из VR';
    const s = this.renderer.xr.getSession();
    const feats = s && s.enabledFeatures ? [...s.enabledFeatures].join(', ') : '';
    this.refInfo = (this.refType || 'local-floor') + (feats ? ` (включено: ${feats})` : '');
    Diag.sessionStart({ ua: navigator.userAgent, scheme: this.app.scheme.title, ref: this.refInfo });
    if (s) s.addEventListener('inputsourceschange', () => this.checkHands());
    this.handsOnly = false; this.checkHands();
    if (store.get(this.room ? 'ts.polyTutorVR' : 'ts.vrTutor') !== '1') this.showTutor(true);
    this.drawBoard();
  }
  onXREnd() {
    Diag.sessionEnd();
    if (this.tutor) this.tutor.m.visible = false;
    this.handsOnly = false;
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    for (const info of this.ctrls) { info.line.visible = false; info.dot.visible = false; }
    this.bannerH.m.visible = false;
    document.getElementById('btnVR').textContent = 'Войти в VR';
    if (this.items) this.items.xrEnd();
    // полигон: снова от первого лица на ноутбуке (или обзор, если он был включён)
    if (this.room && !this.top) { if (this.active) this.walk.enable(this.room); this.walk.apply(); }
    else this.applyOrbit();
    this.resize();
    if (!this.active) this.renderer.setAnimationLoop(null);
  }
}

export { THREE, loadThree, S3, COL3, rr, View3D };
