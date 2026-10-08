import { TYPES, clamp, bbox, vClass, wireRoute, isPzId } from '../core/elements.js';
import { fmtTime } from '../core/engine.js';
import { Sound } from '../ui/sound.js';
import { Diag } from '../ui/diag.js';
import { store } from '../ui/store.js';
import { MODELS, S3, H3, PAL, texture, makeMaterials, makeKit } from './models/index.js';
import { wireMid } from '../view2d/scheme2d.js';
import { buildRoom } from './room.js';
import { Items } from './items.js';
import { placeText } from '../core/permit.js';
import { whyOf } from '../core/explain.js';
import { Walk, REACH as WALK_REACH } from './walk.js';
import { Teleport } from './teleport.js';
import { findKRU, buildZRU } from './zru.js';
import { footprints, makeYardWorld } from './world.js';
import { Batch } from './batch.js';
import { Probe } from './probe.js';
import { Coach } from './coach.js';

/* ===== §6. 3D и VR =====
   Схема → открытое распределительное устройство: координаты схемы становятся планом на земле
   (1 клетка = 1,25 м), провода висят на высоте 3,4 м. Модели собраны из кубов и цилиндров,
   каждый тип — свой построитель в ./models/<тип>.js (интерфейс описан в models/index.js).
   Бюджет для шлема: ≤ ~200 вызовов отрисовки на кадр. Поэтому неподвижные детали сливаются по материалам,
   все подписи — одна сетка, все сигнальные лампы — одна InstancedMesh.
   Управление: мышь (вращать, сдвигать, щелчок по аппарату) и WebXR (луч контроллера, курок, стики).
   VR-полигон (схема с s.room): вместо площадки — помещение ЗРУ (room.js), предметы в руках (items.js),
   на ноутбуке — ходьба от первого лица (walk.js); «Вид сверху» там — обзор помещения без потолка.
   Площадка: «Обзор» (облёт мышью, «Вид сверху») или «Пешком» — та же ходьба, мир для неё (граница — ограждение,
   препятствия — детали моделей) собирает buildYard (world.js). В шлеме стик и телепорт тоже не проходят сквозь препятствия. */
let THREE = null;
// three.js подгружается отдельным куском только при входе в 3D
async function loadThree() {
  if (!THREE) THREE = await import('three');
  return THREE;
}
// цвета 3D — в models/kit.js (PAL)
const RAY = { idle: PAL.ui.rayIdle, hot: PAL.ui.rayHot };
const YARD_GATE = 3;                                // ворота ограждения площадки: полуширина, м
// Меню тележки в 3D: ширина холста (560 = 1 м) от и до, отступ текста, шрифт, строка, высота кнопки с зазором, шапка; закрыть дальше far м
const MENU = { minW: 560, maxW: 900, pad: 34, font: 28, line: 34, row: 84, top: 70, far: 4 };
const COL3 = PAL.volt;
// Подписи пешком и в шлеме: видны до far м, дальше 9 м растут с расстоянием до grow раз (с 15–20 м читаются на 1366×860 и в шлеме)
const LABEL = { far: 28, grow: 2.2 };
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
    // world — где ходить пешком (полигон или площадка); yardWalk — площадка сейчас «Пешком», а не «Обзор»
    this.world = null; this.yardWalk = false;
  }
  async show() {
    this.active = true;
    if (!this.ready) {
      // смена схемы, пока грузится three.js, снова зовёт show(): сцена и управление создаются один раз
      // (иначе два холста и два обработчика клавиш и мыши — E срабатывает дважды, захват мыши путается)
      if (!this.loading) this.loading = (async () => {
        await loadThree();
        try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* шрифты не обязательны */ }
        this.init();
      })();
      try { await this.loading; } catch (e) { this.loading = null; throw e; }
      if (!this.active) return;
    }
    if (this.builtFor !== this.app.schemeVersion || this.builtTopo !== this.app.tr.topo) this.build();
    else if (this.walking()) this.walk.enable(this.world);
    this.resize();
    this.update(true);
    this.renderer.setAnimationLoop((t, f) => this.loop(t, f));
    this.checkVR();
    // первый вход в 3D площадки — предложить обучение; идёт обучение — показать текущий шаг
    if (this.coach.on) this.coach.update(true); else this.coach.offer();
  }
  hide() {
    this.active = false;
    if (this.renderer && !this.renderer.xr.isPresenting) this.renderer.setAnimationLoop(null);
    if (this.walk) this.walk.disable();
    if (this.probe) this.probe.dispose();
    if (this.coach) this.coach.hide();
    this.closeMenu3D();
    this.tip(null);
  }
  // Пешком от первого лица на ноутбуке (не обзор и не шлем)
  fpsOn() { return !!(this.walk && this.walk.on && !this.renderer.xr.isPresenting); }
  // Должен ли сейчас работать ходьба: полигон — кроме обзора сверху, площадка — в режиме «Пешком»
  walking() { return !!this.world && (this.room ? !this.top : this.yardWalk); }

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
    sc.background = new T.Color(PAL.env.fog);
    sc.fog = new T.Fog(PAL.env.fog, 90, 320);
    this.camera = new T.PerspectiveCamera(60, 1, 0.05, 900);
    this.rig = new T.Group();
    this.rig.add(this.camera);
    sc.add(this.rig);
    this.hemi = new T.HemisphereLight(PAL.env.hemiSky, PAL.env.hemiGround, 1.1);
    sc.add(this.hemi);
    const sun = this.sun = new T.DirectionalLight(PAL.env.sun, 1.7);
    sun.position.set(40, 70, 25);
    sc.add(sun);
    this.arcLight = new T.PointLight(PAL.ui.arcLight, 0, 30, 2);
    sc.add(this.arcLight);
    this.root = new T.Group();
    sc.add(this.root);
    this.ray = new T.Raycaster();
    this.clock = new T.Clock();
    this.tmp = { m: new T.Matrix4(), v: new T.Vector3(), v2: new T.Vector3(), dir: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    this.geo = { sphere: new T.SphereGeometry(1, 18, 12), ring: new T.TorusGeometry(1.1, 0.06, 8, 48), lamp: new T.SphereGeometry(1, 12, 8) };
    this.makeMats();
    // указатель напряжения на площадке: в руке и касание по месту (probe.js)
    this.probe = new Probe(this);
    this.ring = new T.Mesh(this.geo.ring, new T.MeshBasicMaterial({ color: PAL.ui.ring }));
    // небо с дальними холмами — одна сфера вокруг площадки (в помещении спрятана); рисуется первой, без тумана
    this.sky = new T.Mesh(new T.SphereGeometry(800, 32, 16), new T.MeshBasicMaterial({ map: texture(T, 'sky'), side: T.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.raycast = () => {};
    sc.add(this.sky);
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false;
    sc.add(this.ring);
    this.orbit = { target: new T.Vector3(), r: 60, th: 0.42, ph: 0.98 };
    this.bindPointer();
    this.walk = new Walk(this);
    this.tp = new Teleport(this);
    this.makeBeacon();
    // обучение «за руку» на площадке (coach.js)
    this.coach = new Coach(this);
    this.setupXR();
    Diag.on(t => { if (t === 'error') { this.drawBoard(); if (this.dbg && this.dbg.m.visible) this.drawDebug(); } });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.ready = true;
  }
  makeMats() {
    // материалы и процедурные текстуры — по палитре models/kit.js
    this.M = makeMaterials(THREE);
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
    if (!this.nodeMats.has(n)) this.nodeMats.set(n, new THREE.MeshStandardMaterial({ color: COL3.dead, roughness: 0.35, metalness: 0.45, emissive: 0x000000 }));
    return this.nodeMats.get(n);
  }
  // Подпись-спрайт лицом к камере; kind — фон из PAL.label (bg, dead, live); поверх всего — её не срезают стенки и аппараты
  // screen — размер постоянный на экране (h — доля высоты кадра), иначе h — высота в метрах
  labelSprite(text, kind = 'bg', h = 0.36, screen = false) {
    const T = THREE, L = PAL.label, c = document.createElement('canvas'), x = c.getContext('2d');
    const font = '600 40px "JetBrains Mono", ui-monospace, monospace';
    x.font = font;
    const w = Math.ceil(x.measureText(text).width) + 32;
    c.width = w; c.height = 60;
    x.font = font;
    x.fillStyle = L[kind] || L.bg; rr(x, 0, 0, w, 60, 12); x.fill();
    if (kind !== 'bg') { x.strokeStyle = L.edge; x.lineWidth = 3; rr(x, 1.5, 1.5, w - 3, 57, 11); x.stroke(); }
    x.fillStyle = L.fg; x.textBaseline = 'middle'; x.fillText(text, 16, 32);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, sizeAttenuation: !screen }));
    sp.scale.set(h * w / 60, h, 1);
    sp.renderOrder = 9;
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
    if (this.tp) this.tp.cancel();
    if (this.probe) this.probe.dispose();
    // новая схема: обучение — заново (предложение — на новой площадке), щит — у ворот
    if (this.coach) { this.coach.stop(false); this.coach.offered = false; }
    this.taskStart = null; this.boardG = null;
    if (this.items) { this.items.dispose(); this.items = null; }
    const poly = !!(s.room && Array.isArray(s.room.cells) && s.room.cells.length);
    this.setEnv(poly);
    if (poly) {
      // VR-полигон: помещение ЗРУ, устройства ячеек и места для предметов (room.js), щит на стене
      this.room = buildRoom(this, s, topo);
      this.bounds = { hx: 6, hz: 4 };
      this.toWorld = () => new THREE.Vector3();
      this.start = new THREE.Vector3(this.room.start.x, 0, this.room.start.z);
      this.world = this.room;
      this.makeBoard(this.room.board);
    } else {
      // новая площадка открывается в «Обзоре», пешком — от ворот
      this.room = null; this.yardWalk = false; this.walkPose = null;
      if (this.walk) this.walk.disable();
      this.buildYard(s, topo);
    }
    // мир ходьбы нужен и вне «Пешком»: «Перейти к аппарату» в шлеме ищет место тем же walk.seek
    if (this.walk) this.walk.world = this.world;
    this.partBoxes();
    this.compactParts();
    // таблица узлов и инстансы одинаковых подвижных частей (batch.js) — до слияния неподвижного
    if (this.batch) this.batch.dispose();
    this.batch = new Batch(this);
    this.batch.instance();
    this.mergeStatic();
    this.makeLamps();
    this.makeLabels();
    // крыша и светильники ЗРУ: в «Обзоре» спрятаны — видно ячейки сверху
    this.zruTop = [];
    if (this.zru) this.root.traverse(o => { if (o.isMesh && this.zru.topMats.has(o.material)) this.zruTop.push(o); });
    this.showRoof(false);
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
    const E = PAL.env;
    this.sky.visible = !poly;
    if (poly) {
      sc.background.setHex(E.roomBg); sc.fog = null;
      this.hemi.color.setHex(E.roomSky); this.hemi.groundColor.setHex(E.roomGround); this.hemi.intensity = 1.55;
      this.sun.intensity = 0.95; this.sun.position.set(-12, 40, 34);
    } else {
      sc.background.setHex(E.fog); sc.fog = this._fog;
      this.hemi.color.setHex(E.hemiSky); this.hemi.groundColor.setHex(E.hemiGround); this.hemi.intensity = 1.15;
      this.sun.intensity = 1.75; this.sun.position.set(40, 70, 25);
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
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.userData.ground = true;
    this.root.add(ground); this.pickables.push(ground);
    // гравий: одна текстура на 3 м площадки
    this.M.yard.map.repeat.set(hx * 2 / 3, hz * 2 / 3);
    const yard = new T.Mesh(new T.PlaneGeometry(hx * 2, hz * 2), this.M.yard);
    yard.rotation.x = -Math.PI / 2; yard.position.y = 0.01; yard.userData.ground = true;
    this.root.add(yard); this.pickables.push(yard);
    this.buildFence(hx, hz);
    this.buildRoads(hx, hz);
    // ЗРУ: ячейки КРУ (тележка, ТТ, ЗН, ТН, предохранитель) — в здании (zru.js); на улице их не строим
    const kru = findKRU(s, topo);
    this.zru = kru ? buildZRU(this, s, topo, kru, W) : null;
    // Провода: видимые трубы (сливаются по узлам) и невидимые коробки для луча — на провод накладывают ПЗ и ставят указатель
    const pmat = new T.MeshBasicMaterial({ color: PAL.ui.proxy });
    for (const w of s.wires) {
      // провод внутри ЗРУ (шины, узлы ячеек) не висит над площадкой: его коробка — у нижних контактов ячейки или у шин
      const wn = topo.wireNode.get(w.id);
      if (this.zru && this.zru.nodes.has(wn)) {
        const p = this.zru.inner(wn);
        if (p) { const px = new T.Mesh(this.boxGeo(0.5, 0.25, 0.3), pmat); px.position.copy(p); px.visible = false; px.userData.wire = w.id; px.userData.proxy = true; this.root.add(px); this.pickables.push(px); }
        continue;
      }
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
      if (this.zru && this.zru.inside.has(el.id)) continue;
      const g = this.model(el, topo);
      if (!g) continue;
      g.position.copy(W([el.x, el.y]));
      g.rotation.y = -el.r * Math.PI / 2;
      this.root.add(g);
    }
    // КЛ из ячеек — лотком к муфтам, к трансформаторам — шинный мост (выводы уличных элементов уже на месте)
    if (this.zru) { this.root.updateMatrixWorld(true); this.zru.links(); }
    // щит с заданием переезжает к первому аппарату задания (placeBoard): его детали не сливаются с неподвижными
    const board = this.boardG = this.makeBoard();
    this.mergeInto(board);
    board.traverse(o => { o.userData.dyn = true; });
    this.boardHome = { pos: board.position.clone(), ry: board.rotation.y };
    this.boardBlocks = footprints(T, board);
    this.makeProxies();
    this.makeShadows([...this.dev.values()].filter(d => d.kind !== 'bus' && !d.zru).map(d => d.group));
    // Пешком: граница — ограждение с воротами, препятствия — детали моделей (и щита), до которых не дотянуться над головой.
    // Дальние части (линия от энергосистемы) не мешают; провода и шины на высоте 3,4 м — тоже
    const blocks = [].concat(this.zru ? this.zru.blocks : []);
    for (const d of this.dev.values()) {
      if (d.zru) continue;
      const far = new Set();
      for (const f of d.far || []) f.traverse(o => far.add(o));
      blocks.push(...footprints(T, d.group, o => far.has(o)));
    }
    const zdyn = this.zru && this.zru.dyn;
    this.world = makeYardWorld({ hx, hz, gate: YARD_GATE, blocks, dyn: () => (zdyn ? zdyn() : []).concat(this.boardBlocks) });
    this.start = new T.Vector3(this.world.start.x, 0, this.world.start.z);
  }
  buildFence(hx, hz) {
    const T = THREE, per = [], step = 3, gate = YARD_GATE;
    for (let x = -hx; x <= hx + 0.01; x += step) { per.push([x, -hz]); if (Math.abs(x) > gate) per.push([x, hz]); }
    for (let z = -hz + step; z < hz - 0.01; z += step) per.push([-hx, z], [hx, z]);
    const im = new T.InstancedMesh(this.cylGeo(0.05, 2.2), this.M.post, per.length);
    const m4 = new T.Matrix4();
    per.forEach((p, i) => { m4.makeTranslation(p[0], 1.1, p[1]); im.setMatrixAt(i, m4); });
    this.root.add(im);
    const pts = [];
    const segs = [[[-hx, -hz], [hx, -hz]], [[hx, -hz], [hx, hz]], [[hx, hz], [gate, hz]], [[-gate, hz], [-hx, hz]], [[-hx, hz], [-hx, -hz]]];
    for (const y of [0.6, 1.3, 2.0]) for (const [a, b] of segs) pts.push(new T.Vector3(a[0], y, a[1]), new T.Vector3(b[0], y, b[1]));
    this.root.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: PAL.ui.wireLine })));
    // сетка ограждения между стойками (одна сетка после слияния): рисунок ромбов 0,5 м
    for (const [a, b] of segs) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.1) continue;
      const g = new T.PlaneGeometry(len, 1.9), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.5, uv.getY(i) * 1.9 / 0.5);
      const m = new T.Mesh(g, this.M.fence);
      m.position.set((a[0] + b[0]) / 2, 1.08, (a[1] + b[1]) / 2);
      m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      this.root.add(m);
    }
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

  // Дорога вдоль ограждения с выездом к воротам и кабельный лоток вдоль неё: плиты и бетон (одна сетка после слияния)
  buildRoads(hx, hz) {
    const T = THREE, W = 2.6, m0 = 1.1, cell = 6, y = 0.026;
    const strip = (x0, z0, x1, z1) => {
      const w = x1 - x0, d = z1 - z0, g = new T.PlaneGeometry(w, d), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / cell, uv.getY(i) * d / cell);
      const m = new T.Mesh(g, this.M.road);
      m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      this.root.add(m);
    };
    const a = m0, b = m0 + W;
    strip(-hx + a, -hz + a, hx - a, -hz + b);       // дальняя сторона
    strip(-hx + a, hz - b, hx - a, hz - a);         // у ворот
    strip(-hx + a, -hz + b, -hx + b, hz - b);       // левая
    strip(hx - b, -hz + b, hx - a, hz - b);         // правая
    strip(-YARD_GATE, hz - a, YARD_GATE, hz - 0.05); // выезд к воротам
    // лоток: бетонный короб с крышками вдоль внутреннего края дороги
    const tw = 0.5, th = 0.12, t = b + 0.35;
    const tray = (x0, z0, x1, z1) => {
      const w = Math.max(tw, x1 - x0), d = Math.max(tw, z1 - z0), g = new T.BoxGeometry(w, th, d), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, w / 1.5), uv.getY(i) * Math.max(1, d / 1.5));
      const m = new T.Mesh(g, this.M.concrete);
      m.position.set((x0 + x1) / 2, th / 2, (z0 + z1) / 2);
      this.root.add(m);
    };
    tray(-hx + t, -hz + t, hx - t, -hz + t + tw);
    tray(-hx + t, hz - t - tw, -YARD_GATE - 1, hz - t);
    tray(YARD_GATE + 1, hz - t - tw, hx - t, hz - t);
    tray(-hx + t, -hz + t + tw, -hx + t + tw, hz - t - tw);
    tray(hx - t - tw, -hz + t + tw, hx - t, hz - t - tw);
  }
  // Мягкие «запечённые» тени-пятна под оборудованием: одна InstancedMesh, пятно чуть сдвинуто от солнца
  makeShadows(groups, extra = []) {
    const T = THREE, b = new T.Box3(), c = new T.Vector3(), s = new T.Vector3(), list = [];
    this.root.updateMatrixWorld(true);
    for (const g of [...groups, ...extra]) {
      b.makeEmpty();
      g.traverse(o => { if (o.isMesh && !o.userData.proxy && o.geometry && !(o.geometry.boundingSphere && o.geometry.boundingSphere.radius > 40)) b.expandByObject(o); });
      if (b.isEmpty()) continue;
      b.getCenter(c); b.getSize(s);
      // от дальних частей (линия к энергосистеме) тени нет: берём пятно не больше 9 м
      if (s.x > 18 || s.z > 18) continue;
      list.push([c.x - 0.12 * Math.min(s.y, 4), c.z - 0.07 * Math.min(s.y, 4), Math.min(9, s.x * 1.25 + 0.7), Math.min(9, s.z * 1.25 + 0.7)]);
    }
    if (!list.length) return;
    const geo = new T.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new T.MeshBasicMaterial({ map: texture(T, 'blob'), color: PAL.env.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 });
    const im = new T.InstancedMesh(geo, mat, list.length), m4 = new T.Matrix4();
    list.forEach(([x, z, w, d], i) => { m4.makeScale(w, 1, d); m4.setPosition(x, 0.034, z); im.setMatrixAt(i, m4); });
    im.raycast = () => {}; im.renderOrder = 1;
    this.root.add(im);
  }
  // Невидимые коробки вокруг аппаратов: по ним считается щелчок и луч контроллера
  makeProxies(only) {
    const T = THREE;
    this.root.updateMatrixWorld(true);
    const mat = this._proxyMat || (this._proxyMat = new T.MeshBasicMaterial({ color: PAL.ui.proxy }));
    const b = new T.Box3(), size = new T.Vector3(), c = new T.Vector3(), out = [];
    for (const [id, d] of only || this.dev) {
      if (d.zru) continue;   // у ячеек ЗРУ коробки свои (cell.js, zru.js)
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
  // Коробки деталей каждого аппарата площадки — до слияния (потом детали разных аппаратов в одной сетке): по ним щелчок и прицел
  // выбирают аппарат, чья деталь ближе по лучу, когда невидимые коробки соседей перекрываются (ЗН у трансформатора, ТТ у выключателя)
  partBoxes() {
    const T = THREE, b = new T.Box3();
    this.root.updateMatrixWorld(true);
    for (const d of this.dev.values()) {
      if (d.zru) continue;
      const far = new Set();
      for (const f of d.far || []) f.traverse(o => far.add(o));
      d.pick = [];
      d.group.traverse(o => { if (!o.isMesh || o.userData.proxy || far.has(o)) return; b.setFromObject(o); if (!b.isEmpty()) d.pick.push(b.clone().expandByScalar(0.03)); });
    }
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
    for (const nm of ['position', 'normal', 'uv', 'nodeIdx']) {
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
  // Неподвижные детали с одинаковым материалом сливаются в одну сетку: меньше вызовов отрисовки в шлеме.
  // Провода, шины и выводы всех узлов — одна сетка с материалом таблицы узлов, окна всех потребителей — тоже одна (batch.js)
  mergeStatic() {
    const T = THREE, dyn = new Set(), B = this.batch, topo = this.app.tr.topo;
    for (const d of this.dev.values()) {
      for (const k of ['pivot', 'lever', 'slide', 'show', 'mark', 'beacon']) if (d[k]) d[k].traverse(o => dyn.add(o));
      if (d.spin) for (const sp of d.spin) sp.traverse(o => dyn.add(o));
    }
    // окна потребителя светятся по его узлу (вывод 0)
    const winIdx = new Map();
    for (const d of this.dev.values()) {
      if (!d.win || !B) continue;
      const i = B.table.idx.get((topo.term.get(d.el.id) || [])[0]);
      if (i != null) d.group.traverse(o => { if (o.material === d.win) winIdx.set(o, i); });
    }
    const buckets = new Map();
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || dyn.has(o) || o.userData.proxy || o.userData.ground || o.userData.board || o.userData.dyn) return;
      let key = o.material;
      if (B && B.nodeIdx(o.material) >= 0) key = 'node';
      else if (winIdx.has(o)) key = 'win';
      else if (o.material && o.material.map && o.material.emissiveMap) return;
      let l = buckets.get(key);
      if (!l) buckets.set(key, l = []);
      l.push(o);
    });
    for (const [key, list] of buckets) {
      const shared = key === 'node' || key === 'win';
      if (list.length < 2 && !shared) continue;
      const out = this.joinGeos(list.map(m => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        return key === 'node' ? B.tag(g, B.nodeIdx(m.material)) : key === 'win' ? B.tag(g, winIdx.get(m)) : g;
      }));
      this.root.add(new T.Mesh(out, key === 'node' ? B.nodeMat : key === 'win' ? B.winFor(list[0].material) : key));
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
    const im = new T.InstancedMesh(this.geo.lamp, new T.MeshBasicMaterial({ color: PAL.ui.lamp, toneMapped: false }), list.length);
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
      else if (l.role === 'btnOn') hex = COL3.btnOn;
      else if (l.role === 'btnOff') hex = COL3.btnOff;
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
      x.fillStyle = PAL.label.bg; rr(x, b.x, b.y, b.w, LH, 18); x.fill();
      x.fillStyle = PAL.label.fg; x.fillText(text(d), b.x + 24, b.y + 48);
    });
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const n = list.length, center = new Float32Array(n * 12), corner = new Float32Array(n * 8), uv = new Float32Array(n * 8), lid = new Float32Array(n * 4), lod = new Float32Array(n * 4), idx = [];
    // номер подписи — чтобы подпись аппарата под прицелом показать крупнее (uniform hot)
    this.labelIdx = new Map();
    // lod 1 — подпись ячейки ЗРУ: в «Обзоре» не рисуется (иначе десяток подписей в куче над рядами), видна под курсором
    list.forEach((d, i) => { lid.fill(i, i * 4, i * 4 + 4); lod.fill(d.labelLod || 0, i * 4, i * 4 + 4); if (d.el) this.labelIdx.set(d.el.id, i); });
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
    geo.setAttribute('lid', new T.BufferAttribute(lid, 1));
    geo.setAttribute('lod', new T.BufferAttribute(lod, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new T.ShaderMaterial({
      // grow: дальше 9 м подпись растёт с расстоянием (до grow раз) — пешком и в шлеме читается с 15–20 м; в «Обзоре» grow = 1, как было.
      // hot — подпись аппарата под прицелом: в 1,4 раза крупнее и поверх всего. Подписи пишут глубину: ближняя закрывает дальнюю целиком
      uniforms: { map: { value: tex }, far: { value: 0 }, hot: { value: -1 }, grow: { value: 1 }, overview: { value: 0 } },
      vertexShader: `attribute vec2 corner; attribute float lid; attribute float lod; varying vec2 vUv; uniform float far; uniform float hot; uniform float grow; uniform float overview;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float k = clamp(-mv.z / 9.0, 1.0, grow); bool h = abs(lid - hot) < 0.5;
          if (h) k *= 1.4;
          mv.xy += corner * k;
          gl_Position = projectionMatrix * mv;
          if (h) gl_Position.z = -gl_Position.w * 0.999;
          else if ((far > 0.0 && -mv.z > far) || (overview > 0.5 && lod > 0.5)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: true,
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
      // ПЗ на проводе внутри ЗРУ — на нижних контактах ячейки (модель меньше: зажим на контактах, провод — к полу)
      const q = this.posOf(id);
      if (q && q.indoor) { d.group.scale.setScalar(0.6); d.group.position.set(q.x, q.y - (H3 - 0.04) * 0.6, q.z); }
      else { d.group.position.copy(this.toWorld(pl.p)); d.group.rotation.y = -pl.r * Math.PI / 2; }
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
      if (this.batch) this.batch.setNode(n, col, ei);
    }
    if (this.batch) this.batch.commit();
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
    if (this.batch) this.batch.sync();
    if (this.items) this.items.sync();
    this.syncGuide();
    this.drawBoard();
  }
  // Тележка ячейки полигона сдвинулась: начинка видна только снаружи шкафа, кнопки едут с панелью
  slideMoved(d) {
    if (!d.inner) return;
    const vis = d.slideX > 0.02;
    if (d.inner.visible !== vis) { d.inner.visible = vis; if (d.zn) d.zn.pivot.visible = vis; }
    this.moveLamps(d);
    // предмет на полу, на который выкатили тележку, отодвигается из-под неё — иначе его не достать
    if (this.items) this.items.unbury();
  }
  // Предметы, плакаты и мероприятия изменились (событие 'field' движка); test — самопроверка указателя на проверочном устройстве
  onField(d = {}) {
    if (!this.ready) return;
    if (this.items) this.items.sync(!!d.reset);
    // в шлеме — табличка у указателя (вместо баннера перед глазами), на ноутбуке — строка у прицела
    if (d.test && this.active) {
      if (!(this.items && this.items.tipLabel('Указатель исправен', 'dead'))) this.banner('Указатель исправен: огонёк горит, звук есть.', 'info');
      if (this.fpsOn()) this.walk.said('Указатель исправен — огонёк горит, звук есть');
    }
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
    let trips = false, moved = false;
    for (const d of this.dev.values()) {
      if (d.pivot && d.angT != null && d.ang !== d.angT) {
        moved = true;
        const diff = d.angT - d.ang;
        d.ang += Math.sign(diff) * Math.min(Math.abs(diff), 2.4 * dt);
        d.pivot.rotation.x = d.ang;
      }
      if (d.lever && d.leverT != null) {
        const ax = d.leverAxis || 'x', cur = d.lever.rotation[ax], diff = d.leverT - cur;
        if (diff) { d.lever.rotation[ax] = cur + Math.sign(diff) * Math.min(Math.abs(diff), 9 * dt); moved = true; }
      }
      if (d.slide && d.slideT != null && d.slideX !== d.slideT) {
        const diff = d.slideT - d.slideX;
        d.slideX += Math.sign(diff) * Math.min(Math.abs(diff), 0.8 * dt);
        d.slide.position[d.slideAxis || 'x'] = d.slideX;
        this.slideMoved(d);
        moved = true;
      }
      if (d.spin && d.spin.length) {
        d.speed += (d.speedT - d.speed) * Math.min(1, dt * (d.speedT > d.speed ? 0.9 : 0.45));
        if (d.speed > 0.01) { for (const sp of d.spin) sp.rotation.x += d.speed * dt; moved = true; }
      }
      if (d.trip) trips = true;
    }
    // инстансы подвижных частей — за своими местами (batch.js)
    if (moved && this.batch) this.batch.sync();
    if (trips || this._tripsWas) this.setLamps(blink);
    this._tripsWas = trips;
    this.stepFx(dt);
    this.tp.step(dt);
    const xr = this.renderer.xr.isPresenting;
    // пешком и в шлеме дальние подписи (дальше LABEL.far) не рисуются — они только загромождают; ближние растут с расстоянием
    if (this.labelMesh) { const u = this.labelMesh.material.uniforms, near = xr || this.fpsOn(); u.far.value = near ? LABEL.far : 0; u.grow.value = near ? LABEL.grow : 1; u.overview.value = near || this.room ? 0 : 1; }
    // маяк заметен издалека, а вблизи (у самого аппарата) почти прозрачен — не слепит и не закрывает аппарат
    if (this.beacon.visible) {
      const c = this.camera.getWorldPosition(this.tmp.v2), d = Math.hypot(c.x - this.beacon.position.x, c.z - this.beacon.position.z);
      this.beacon.material.opacity = Math.min(1, Math.max(0.12, (d - 3) / 10)) * (0.8 + 0.15 * Math.sin(time * 0.004));
    }
    if (xr) this.xrFrame(dt);
    else if (this.fpsOn()) this.walk.step(dt);
    this.holdProbe(xr);
    this.probe.step(dt, time);
    if (this.coach.on && time - (this._coachT || 0) > 150) { this._coachT = time; this.coach.update(); }
    if (this.items) this.items.step(dt, time);
    if (this.menu3d && (performance.now() > this.menu3d.until || this.menuFar())) this.closeMenu3D();
  }

  // Указатель на площадке в руке, пока включён инструмент: пешком — у края кадра (модель — по аппарату под прицелом),
  // в шлеме — в правой руке. В «Обзоре» и в полигоне (там указатель — предмет со стенда) — нет
  holdProbe(xr) {
    let anchor = null, kind = this.probeKind || 'uvn';
    if (!this.room && this.app.tool === 'check') {
      if (xr) { const c = this.ctrls.find(q => q.src && q.hand === 'right') || this.ctrls.find(q => q.src); anchor = c ? c.grip : null; }
      else if (this.fpsOn()) {
        anchor = this.camera;
        const a = this.walk.aim;
        if (a && a.id && (a.type === 'dev' || a.type === 'wire' || a.type === 'far')) kind = this.probeKind = this.probe.kindForTarget(a.id);
      }
    }
    this.probe.hold(anchor, kind);
  }
  // Куда коснуться указателем (площадка): выводы аппарата — каждая проверяемая сторона, провод — точка попадания на высоте проводов,
  // в ЗРУ — нижние контакты ячейки
  probePoints(d) {
    const T = THREE, tr = this.app.tr, dv = this.dev.get(d.target), out = [];
    const h = this.hitAt && this.hitAt.id === d.target && performance.now() - this.hitAt.t < 1500 ? this.hitAt.p : null;
    if (dv && !dv.zru && dv.ports && dv.ports.length) {
      const tm = tr.topo.term.get(d.target) || [];
      for (const r of d.res) {
        const i = tm.indexOf(r.n), pp = dv.ports[i >= 0 ? i : 0];
        if (pp) out.push({ p: dv.group.localToWorld(new T.Vector3(...pp)), live: r.kv != null });
      }
      return out;
    }
    const p = !dv && h ? h.clone() : this.posOf(d.target);
    if (!p) return out;
    if (!dv && !p.indoor) p.y = H3;
    out.push({ p, live: d.live });
    return out;
  }
  // Щелчок, E или луч по аппарату и проводу: где попали — туда коснётся указатель
  noteHit(h) { const u = h && h.object.userData; if (u && (u.dev || u.wire)) this.hitAt = { id: u.dev || u.wire, p: h.point.clone(), t: performance.now() }; }

  // ---------- щит у первого аппарата задания (площадка) ----------
  // Задание началось: щит — рядом с первым аппаратом задания, начало пешком — перед ним (аппарат под прицелом, щит сбоку);
  // уже пешком — переход туда, в шлеме — затемнением. Без задания щит у ворот и начало у ворот (как было)
  onTaskStart() {
    if (!this.ready || this.room || !this.boardG) return;
    const q = this.placeBoard();
    if (!q || !this.active) return;
    if (this.renderer.xr.isPresenting) {
      const T = THREE, head = this.camera.getWorldPosition(new T.Vector3());
      this.tp.go(head, q, (x, z) => {
        const c = this.camera.getWorldPosition(new T.Vector3()), d = this.camera.getWorldDirection(new T.Vector3()), hy = Math.atan2(-d.x, -d.z);
        const ang = Math.atan2(Math.sin(q.yaw - hy), Math.cos(q.yaw - hy));
        this.rig.position.sub(c).applyAxisAngle(this.tmp.up, ang).add(c); this.rig.rotation.y += ang; this.rig.updateMatrixWorld(true);
        const c2 = this.camera.getWorldPosition(new T.Vector3());
        this.rig.position.x += x - c2.x; this.rig.position.z += z - c2.z;
      }, 'fade');
    } else if (this.fpsOn()) this.walk.goPose(q);
    else this.walkPose = q;
  }
  // Щит — к первому аппарату задания: место, откуда аппарат под прицелом (walk.seek), щит — впереди слева или справа от него.
  // Возвращает место начала { x, z, yaw, pitch } или null (задания нет — щит у ворот)
  placeBoard() {
    const T = THREE, g = this.boardG, run = this.app.tr.run;
    if (!g) return null;
    const home = () => { g.position.copy(this.boardHome.pos); g.rotation.y = this.boardHome.ry; this.boardBlocks = footprints(T, g); this.taskStart = null; return null; };
    if (!run || run.done) return home();
    const st = run.task.steps.find(x => this.guideTarget(x.id)), t = st && this.guideTarget(st.id), a = t && this.aimTarget(t);
    if (!a) return home();
    // щит на время поиска — у ворот (не загораживает); камера и rig — как были (поиск двигает камеру ходьбы)
    g.position.copy(this.boardHome.pos); g.rotation.y = this.boardHome.ry; this.boardBlocks = footprints(T, g);
    const cam = this.camera, rig = this.rig, w = this.walk, keep = [cam.position.clone(), cam.quaternion.clone(), rig.position.clone(), rig.rotation.y, w.x, w.z, w.yaw, w.pitch];
    const xr = this.renderer.xr.isPresenting;
    if (xr) { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true); }
    let q = null;
    this.wireAim = !!t.wire;
    try { q = w.seek(a.p, a.want, false, [5.5, 5, 4.5, 4, 3.5]); } finally {
      this.wireAim = false;
      [w.x, w.z, w.yaw, w.pitch] = keep.slice(4);
      cam.position.copy(keep[0]); cam.quaternion.copy(keep[1]); rig.position.copy(keep[2]); rig.rotation.set(0, keep[3], 0); rig.updateMatrixWorld(true);
      if (this.fpsOn()) w.apply(); else if (!xr) this.applyOrbit();
    }
    if (!q) return home();
    // щит: на 3 м вперёд и на 2,4 м вбок от места, откуда виден аппарат, лицом к нему; начало — лицом к щиту
    // (задание на щите перед глазами, аппарат — рядом; к нему — G, это первый шаг обучения)
    const f = [-Math.sin(q.yaw), -Math.cos(q.yaw)], r = [Math.cos(q.yaw), -Math.sin(q.yaw)];
    this.taskStart = q;
    const spots = [];
    for (const fw of [3, 2.4, 3.6, 1.8]) for (const lat of [2.4, 3, 1.8]) for (const side of [-1, 1]) spots.push([fw, lat * side]);
    for (const [fw, lt] of spots) {
      const bx = q.x + f[0] * fw + r[0] * lt, bz = q.z + f[1] * fw + r[1] * lt;
      const ry = Math.atan2(q.x - bx, q.z - bz), ex = Math.cos(ry) * 1.6, ez = -Math.sin(ry) * 1.6;
      if (![[bx, bz], [bx + ex, bz + ez], [bx - ex, bz - ez]].every(([x, z]) => this.world.walkable(x, z, 0.35))) continue;
      g.position.set(bx, 0, bz); g.rotation.y = ry;
      this.boardBlocks = footprints(T, g);
      this.taskStart = { x: q.x, z: q.z, yaw: Math.atan2(-(bx - q.x), -(bz - q.z)), pitch: Math.atan2(2.25 - 1.62, Math.hypot(bx - q.x, bz - q.z)) };
      break;
    }
    return this.taskStart;
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
      this.camButtons();
      return;
    }
    this.camButtons();
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
        if (this.items) this.items.handVisible(false);
        this.showTop(false);
        o.target.set(this.room.view.x, 0.8, this.room.view.z); o.r = this.room.view.r; o.th = 0.25; o.ph = 0.72;
        this.applyOrbit();
      } else {
        this.showTop(true);
        if (this.items) this.items.handVisible(true);
        this.walk.enable(this.room);
        this.walk.apply();
      }
      b.textContent = this.top ? 'От первого лица' : 'Обзор';
      return;
    }
    if (this.yardWalk) { this.top = false; return; }
    if (this.top) { o.ph = 0.04; o.th = 0; o.target.set(0, 0, 0); } else { o.ph = 0.98; o.th = 0.42; }
    b.textContent = this.top ? 'Вид сбоку' : 'Вид сверху';
    this.applyOrbit();
  }
  // Площадка: «Пешком» — от первого лица у ворот, лицом к подстанции; «Обзор» — облёт мышью, как раньше
  toggleWalk() {
    if (!this.ready || this.room || !this.world || this.renderer.xr.isPresenting) return;
    this.yardWalk = !this.yardWalk;
    this.closeMenu3D(); this.tip(null); this.setHover(null);
    // «Обзор» и обратно — на то же место: начало у ворот только у новой площадки
    const w = this.walk;
    // начало: прежнее место, иначе у щита с заданием (задание идёт), иначе у ворот
    if (this.yardWalk) { this.top = false; if (this.walkPose) w.pose(this.walkPose); else if (this.taskStart) w.pose(this.taskStart); else w.reset(this.world.start); if (this.active) w.enable(this.world); }
    else { this.walkPose = { x: w.x, z: w.z, yaw: w.yaw, pitch: w.pitch }; w.disable(); this.applyOrbit(); }
    this.showRoof(this.yardWalk);
    this.camButtons();
  }
  // Кнопки вида: «Пешком»/«Обзор» — только на площадке; «Вид сверху» пешком на площадке не нужен
  camButtons() {
    const w = document.getElementById('btnWalk'), b = document.getElementById('btnCam');
    if (w) { w.hidden = !!this.room; w.textContent = this.yardWalk ? 'Обзор' : 'Пешком'; w.setAttribute('aria-pressed', String(this.yardWalk)); }
    if (b) b.hidden = !this.room && this.yardWalk;
    this.app.renderStatus();
  }
  // Крыша ЗРУ на площадке: пешком и в шлеме — есть, в «Обзоре» — нет
  showRoof(on) { for (const m of this.zruTop || []) m.visible = on; }
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
    this.noteHit(h);
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
    // wireAim — «Перейти к проводу» ищет место, откуда провод под прицелом, и без инструмента
    const tool = !!this.app.tool || !!this.wireAim;
    // предметы и места полигона ловит items.js (руки), обычный щелчок и обзор — только аппараты и щит; меню — поверх всего
    const h = hits.find(q => q.object.userData.menu) || hits.find(q => { const u = q.object.userData; return !u.ground && (tool || !u.wire) && !u.item && !u.mount && !u.stand; }) || null;
    return h && h.object.userData.dev ? this.centered(h, hits) : h;
  }
  // Коробки соседних аппаратов перекрываются (ЗН у трансформатора, ТТ у выключателя): из аппаратов не дальше 3 м за первым
  // берём тот, чью деталь луч встречает раньше (коробки деталей — partBoxes); луч мимо деталей — тот, чей центр ближе к лучу
  // (в долях размера коробки): щелчок по середине аппарата попадает в него, а не в соседа
  centered(first, hits) {
    const T = THREE, ray = this.ray.ray, c = this.tmp.v, p = this.tmp.v2, inv = this._inv || (this._inv = new T.Matrix4());
    if (this.pickParts !== false) {
      const seen = new Set();
      let pb = null, pd = Infinity;
      // по деталям — и за пустыми коробками впереди (луч прошёл коробку ЗН мимо его деталей — виден трансформатор за ней)
      for (const h of hits) {
        if (h.distance > first.distance + 12) break;
        const id = h.object.userData.dev, d = id && !seen.has(id) ? this.dev.get(id) : null;
        if (!d) continue;
        seen.add(id);
        // шина — тонкая и длинная, проходит над аппаратами: по деталям её не выбираем (кроме ПЗ) — щелчок рядом с ней — по аппарату
        if (d.kind === 'bus' && this.app.tool !== 'pz') continue;
        for (const b of d.pick || []) if (ray.intersectBox(b, c)) { const dist = c.distanceTo(ray.origin); if (dist < pd) { pd = dist; pb = h; } }
      }
      if (pb) return pb;
    }
    let best = first, bk = Infinity;
    for (const h of hits) {
      if (h.distance > first.distance + 3) break;
      const o = h.object;
      if (!o.userData.dev) continue;
      o.getWorldPosition(c);
      ray.closestPointToPoint(c, p);
      // смещение луча от центра — в местных осях коробки, в долях полуразмера
      inv.copy(o.matrixWorld).invert();
      p.applyMatrix4(inv);
      const g = o.geometry.parameters, k = Math.max(Math.abs(p.x) / (g.width / 2), Math.abs(p.y) / (g.height / 2), Math.abs(p.z) / (g.depth / 2));
      if (k < bk) { bk = k; best = h; }
    }
    return best;
  }
  hoverAt(cx, cy) {
    const h = this.pick(cx, cy), u = h ? h.object.userData : {};
    this.setHover(u.dev || null);
    this.tip(h ? this.targetText(h) || null : null, cx, cy);
    this.renderer.domElement.style.cursor = u.dev || u.wire || u.board || u.menu ? 'pointer' : 'grab';
  }
  // Что под курсором или прицелом и что будет по щелчку (пешком — и по E): одна подпись для подсказки мыши и прицела.
  // Пусто — заголовок меню: нажимать там нечего
  targetText(h) {
    const u = h.object.userData, tr = this.app.tr, tool = this.app.tool;
    if (u.menu) { const b = this.menuBtn(h.uv); return b ? b.a.label : ''; }
    if (u.board) return 'Щит с заданием — нажать кнопку';
    if (u.wire) return tool === 'pz' ? 'Провод — наложить или снять ПЗ' : 'Провод — проверить напряжение';
    if (!u.dev) return '';
    const id = u.dev, el = tr.elOf(id), sw = tr.sim.st[id], T = TYPES[el.t];
    let t = el.name + (sw ? (T.cart ? ` · тележка: ${{ work: 'рабочее', test: 'контрольное', repair: 'ремонтное' }[sw.pos]}` + (T.sw === 'breaker' ? (sw.on ? ', включён' : ', отключён') : '') : sw.on ? ' · включён' : ' · отключён') : '');
    if (tool === 'check') t += ' — проверить напряжение';
    else if (tool === 'pz') t += el.t === 'bus' ? ' — наложить ПЗ' : isPzId(id) ? ' — снять ПЗ' : '';
    else if (sw) t += tr.actions(id).length > 1 ? ' — меню' : sw.on ? ' — отключить' : ' — включить';
    // не переключается (трансформатор, шина, ТТ, нагрузка…): щелчок — справка, что это; энергосистема — включить или отключить
    else if (tr.sim.src[id]) t += tr.sim.src[id].on ? ' — отключить' : ' — включить';
    else t += ' — справка';
    return t;
  }
  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    if (this.labelMesh) this.labelMesh.material.uniforms.hot.value = id != null && this.labelIdx.has(id) ? this.labelIdx.get(id) : -1;
    if (!id || !this.dev.has(id) || this.room) { this.ring.visible = false; return; }
    const d = this.dev.get(id), p = this.tmp.v;
    d.group.getWorldPosition(p);
    this.ring.position.set(p.x, 0.06, p.z);
    this.ring.scale.setScalar(d.kind === 'transformer' || d.kind === 'tr3' ? 2.3 : d.kind === 'load' ? 2.6 : 1.25);
    // в ЗРУ — маленькое кольцо на полу коридора перед ячейкой (ряд B повёрнут: «перед» — в местных осях ячейки)
    if (d.zru) { const q = d.group.localToWorld(this.tmp.v2.set(0, 0, 0.5)); this.ring.scale.setScalar(0.4); this.ring.position.set(q.x, 0.06, q.z); }
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
  // Короткое обучение перед лицом: при первом входе в VR и по кнопке «Обучение» на щите; закрывается курком.
  // kind = 'uvn' — «как понять результат» при первом взятии указателя
  showTutor(on = true, kind) {
    if (!this.tutor) { this.tutor = this.mkPanel(1024, 600, 1.0, 0.586); this.tutor.m.position.set(0, -0.05, -1.25); this.camera.add(this.tutor.m); }
    this.tutor.m.visible = on;
    if (!on) return;
    this.tutorKind = kind || (this.room ? 'room' : 'yard');
    const { c, t } = this.tutor, x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(16,24,21,0.94)'; rr(x, 0, 0, c.width, c.height, 28); x.fill();
    x.fillStyle = '#3b4fd1'; rr(x, 0, 0, c.width, 10, 4); x.fill();
    // в полигоне — как брать предметы (то же на табличке над стендом)
    const uvn = this.tutorKind === 'uvn';
    x.fillStyle = '#ffffff'; x.font = F(600, 44); x.fillText(uvn ? 'Указатель: как понять результат' : this.room ? 'Как брать предметы' : 'Как управлять', 44, 82);
    const steps = uvn ? [
      ['1', 'Сначала самопроверка', 'Коснитесь наконечником электрода проверочного устройства на полке стенда: мигает и пищит — указатель исправен.'],
      ['2', 'Горит и пищит — напряжение есть', 'На контактах огонёк мигает красным и звучит сигнал: заземлять и работать нельзя.'],
      ['3', 'Молчит, огонёк серый — напряжения нет', 'Но только после самопроверки: неисправный указатель тоже молчит.'],
    ] : this.room ? [
      ['1', 'Подойдите к стенду справа от входа', 'Левый стик — ходьба, правый — поворот, курок по полу — переход к кольцу. На стенде — СИЗ, указатель, ПЗ, плакаты, замок, ограждение.'],
      // описание шага — не больше 2 строк, иначе обрезается «…»
      ['2', 'Боковая кнопка — взять и отпустить', 'Рука у предмета, боковая кнопка — взять. Ещё раз у нужного места — повесить, запереть, поставить; в стороне — уронить.'],
      ['3', 'СИЗ и указатель', 'Перчатки и каска надеваются сразу. Указатель: сначала проверочное устройство на полке, потом нижние контакты.'],
    ] : [
      ['1', 'Луч и курок', 'Наведите луч на аппарат и нажмите курок — он переключится. Курок по земле — переход туда, где кольцо (красное — не пройти).'],
      ['2', 'Боковая кнопка — указатель', 'Наведите луч и нажмите боковую кнопку (под средним пальцем) — проверка напряжения.'],
      ['3', 'Стики и кнопки', 'Левый стик — ходьба, правый — поворот. B или Y — к аппарату следующего шага, A или X — отметка для отчёта.'],
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
    return g;
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
    // экзамен: «задание 1 из 2» и время; подсказок и эталона нет
    const exam = !!(app.exam && app.exam.active());
    if (exam) { x.font = F(600, 24); x.fillStyle = '#ffd23f'; x.fillText(this.fit(x, app.exam.boardLine(), W - 64), 32, y); y += 38; }
    if (run) {
      para(run.task.title, 30, 600, '#ffffff', 2);
      if (!run.done) {
        para(run.task.desc, 22, 400, '#c6d3cd', poly ? 2 : 3);
        const g = tr.grade(run);
        y += 8; x.font = F(600, 26); x.fillStyle = run.errors.length ? '#ffb4bd' : '#eef4f1';
        x.fillText(`Время ${fmtTime(tr.elapsed())} · операций ${g.myOps} · ошибок ${run.errors.length}`, 32, y); y += 40;
        // площадка с подсказками шагов — следующий шаг (без штрафа, Trainer.peek)
        const nx = poly ? null : app.guideNext(), cl = poly ? null : this.coach.boardLine();
        if (cl) para(cl, 26, 600, '#ffd23f', 3);
        else if (nx) para('Следующий шаг: ' + nx.text, 26, 600, '#ffd23f', 2);
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
    if (exam) {
      if (run && !run.done) btns.push(['ack', 'Квитировать'], ...pz, ['stop', 'Завершить задание']);
      else if (app.exam.between) btns.push(['exnext', 'Следующее задание']);
    } else if (run && !run.done) {
      // полигон — «Подсказки» мероприятий; площадка — «Подсказки» шагов и «К следующему» (с ними платная «Подсказка» не нужна)
      const help = poly && run.task.measures ? [['guide', pm.guide ? 'Подсказки: вкл' : 'Подсказки: выкл']]
        : poly ? [['hint', 'Подсказка']] : app.stepGuide ? [['sguide', 'Подсказки: вкл'], ['goto', 'К следующему']] : [['hint', 'Подсказка'], ['sguide', 'Подсказки: выкл']];
      btns.push(...help, ['ack', 'Квитировать'], ...pz, ['stop', 'Завершить']);
    }
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
    else if (act === 'hint') { if (app.exam && app.exam.active()) this.banner('В экзамене подсказок нет.', 'warn'); else if (!tr.hint()) this.banner('Все эталонные шаги выполнены.', 'info'); }
    else if (act === 'exnext' && app.exam) app.exam.next();
    else if (act === 'ack') { if (!tr.ack()) this.banner('Сигналов нет.', 'info'); }
    else if (act === 'reset') { if (!tr.resetToNormal()) this.banner('Сначала завершите задание.', 'warn'); }
    else if (act === 'lock') { tr.opt.interlocks = !tr.opt.interlocks; app.toast(`Блокировки: ${tr.opt.interlocks ? 'включены' : 'выключены'}.`); }
    else if (act === 'exit') tr.exitTask();
    else if (act === 'pz') app.toggleTool('pz');
    else if (act === 'guide') { const on = app.permit.toggleGuide(); this.banner(`Подсказки мероприятий ${on ? 'включены' : 'выключены'}.`, 'info'); }
    else if (act === 'sguide') { app.setStepGuide(!app.stepGuide); this.banner(`Подсказки шагов ${app.stepGuide ? 'включены' : 'выключены'}.`, 'info'); }
    else if (act === 'goto') this.goNext();
    else if (act === 'mark') this.addMark('щит');
    else if (act === 'debug') this.toggleDebug();
    // на ноутбуке — карточка поверх 3D (закрывается «Понятно» или клавишей), в шлеме — панель перед глазами (закрывается курком)
    // на площадке — обучение «за руку» на задании (в шлеме — и панель управления перед глазами); в полигоне — карточка или панель
    else if (act === 'tutor') {
      const xr = this.renderer.xr.isPresenting;
      if (!this.room && this.coach.can()) { if (xr) this.showTutor(true); this.coach.start(); }
      else if (!xr) this.walk.intro(true); else this.showTutor(true);
    }
    app.renderSide();
    this.drawBoard();
  }

  // ---------- эффекты ----------
  // Точка в сцене для эффекта: аппарат, ПЗ на проводе или середина провода
  posOf(id) {
    if (this.room) return this.room.posOf(id);
    const p = new THREE.Vector3(), dv = this.dev.get(id);
    // в ЗРУ: аппарат — на своей высоте, провод внутри — у нижних контактов ячейки (indoor — высоту не менять)
    if (dv && dv.zru) { dv.group.getWorldPosition(p); p.y += dv.fxY != null ? dv.fxY : 0.3; p.indoor = true; return p; }
    if (dv) { dv.group.getWorldPosition(p); return p; }
    if (this.zru) {
      const tp = this.app.tr.topo, at = isPzId(id) ? id.slice(3) : id, n = tp.wireNode.has(at) ? tp.wireNode.get(at) : (tp.term.get(at) || [])[0];
      const q = n != null && this.zru.nodes.has(n) ? this.zru.inner(n) : null;
      if (q) { q.indoor = true; return q; }
    }
    if (isPzId(id)) { const pl = this.app.view.pzPlace(id); return pl ? this.toWorld(pl.p) : null; }
    const w = this.app.scheme.wires.find(v => v.id === id);
    return w ? this.toWorld(wireMid(w)) : null;
  }
  fx(d) {
    if (!this.active) return;
    const p = this.posOf(d.id);
    if (!p) return;
    if (!this.room && !p.indoor) p.y = H3;
    this.arc(p);
  }
  arc(p) {
    const T = THREE;
    const sph = new T.Mesh(this.geo.sphere, new T.MeshBasicMaterial({ color: PAL.ui.arc, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
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
    const pts = new T.Points(geo, new T.PointsMaterial({ color: PAL.ui.sparks, size: 0.09, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    this.scene.add(pts);
    this.arcLight.position.copy(p);
    this.arcLight.intensity = 90;
    this.fxList.push({ t: 0, life: 1.6, sph, pts, vel });
  }
  // Итог проверки указателем. Полигон — как в жизни: при напряжении указатель мигает и пищит (items.lampUntil, звук),
  // без напряжения молчит и огонёк серый; для обучения итог — строкой у прицела (ноутбук), баннером (шлем)
  // и табличкой на 2 с у указателя в руке («Нет напряжения» — нейтральная, «ЕСТЬ НАПРЯЖЕНИЕ» — красная), не в ячейке.
  // Площадка — подпись над аппаратом или проводом лицом к камере, поверх всего
  checkFx(d) {
    if (!this.active) return;
    if (this.room) {
      const mt = this.app.permit.contactMount(d.target), place = mt ? placeText(mt, 3).replace(/ \(.+?\)/, '') : this.app.tr.nm(d.target);
      if (this.fpsOn()) this.walk.said(`${d.live ? 'Есть напряжение!' : 'Напряжения нет'} — ${place.charAt(0).toLowerCase() + place.slice(1)}`, d.live);
      // в шлеме — табличка у указателя; баннер перед глазами — только если указателя в руке нет
      if (!(this.items && this.items.tipLabel(d.live ? 'ЕСТЬ НАПРЯЖЕНИЕ' : 'Нет напряжения', d.live ? 'live' : 'dead'))) this.banner(d.text, d.live ? 'warn' : 'info');
      return;
    }
    // площадка: указатель касается выводов (пешком — из руки, в шлеме — из руки контроллера, в «Обзоре» — появляется у места);
    // в шлеме итог — табличкой у рукоятки, а не баннером перед глазами
    const xr = this.renderer.xr.isPresenting, pts = d.res ? this.probePoints(d) : [];
    if (pts.length) {
      const anchor = xr ? this.probeHand || (this.ctrls.find(q => q.src && q.hand === 'right') || {}).grip || null : this.fpsOn() ? this.camera : null;
      this.probe.touch(pts, this.probe.kindFor(d.res.map(r => r.n)), anchor, xr ? g => this.probeLabel(g, d.live) : null);
    }
    if (!xr || !pts.length) this.banner(d.text, d.live ? 'warn' : 'info');
    // под подписью аппарата (её видно и пешком, и в обзоре) или над проводом; размер на экране один и тот же издалека и вблизи
    const dv = this.dev.get(d.target), p = dv && dv.labelPos ? dv.group.localToWorld(new THREE.Vector3(...dv.labelPos)) : this.posOf(d.target);
    if (!p) return;
    if (!dv) p.y = p.indoor ? p.y + 0.5 : H3 + 0.45; else if (dv.labelPos) p.y -= 0.5; else p.y += 0.6;
    const sp = this.labelSprite(d.live ? 'ЕСТЬ НАПРЯЖЕНИЕ' : 'Нет напряжения', d.live ? 'live' : 'dead', 0.045, true);
    sp.position.copy(p);
    // подпись одна: новая проверка убирает прежнюю (иначе «есть» и «нет» лягут друг на друга)
    for (const f of this.fxList) if (f.mark) f.t = f.life;
    this.scene.add(sp);
    this.fxList.push({ t: 0, life: 2.6, mark: sp });
  }
  // Шлем: табличка итога у рукоятки указателя на 2 с («Нет напряжения» — нейтральная, «ЕСТЬ НАПРЯЖЕНИЕ» — красная)
  probeLabel(g, live) {
    const sp = this.labelSprite(live ? 'ЕСТЬ НАПРЯЖЕНИЕ' : 'Нет напряжения', live ? 'live' : 'dead', 0.045);
    sp.position.set(0, 0.09, -0.25); sp.renderOrder = 13; g.add(sp);
    this.fxList.push({ t: 0, life: 2, mark: sp });
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
      if (f.mark) { if (f.mark.parent) f.mark.parent.remove(f.mark); f.mark.material.map.dispose(); f.mark.material.dispose(); }
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
    // коробки контроллеров: свой материал — в полигоне после перчаток он цвета перчаток (items.gloveGrips)
    this.gripMat = this.M.ctrl.clone();
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
      grip.add(this.box(0.04, 0.035, 0.12, this.gripMat, 0, 0, 0.02));
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
    // площадка с заданием: задание, следующий шаг (с подсказками), последняя ошибка (или последнее событие)
    const run = tr.run, g = !this.room && run && !run.done ? this.app.guideNext() : null;
    if (!this.room && run && !run.done) top = run.task.title;
    x.fillText(this.fit(x, top, c.width - 40), 20, 38);
    let y = 80, lines = 3;
    const cl = this.room ? null : this.coach.boardLine();
    if (g || cl) {
      x.fillStyle = '#ffd23f'; x.font = '600 24px "Golos Text", system-ui, sans-serif';
      this.wrap(x, cl || `Следующий: ${g.text} · B/Y — перейти`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 30; lines--; });
      y += 6;
    }
    const last = run && !run.done && run.errors.length ? run.errors[run.errors.length - 1] : null;
    const e = last ? { level: 'err', text: last.text } : tr.log[0];
    x.fillStyle = !e ? '#c6d3cd' : e.level === 'err' ? '#ff6b7d' : e.level === 'warn' ? '#f5b544' : e.level === 'ok' ? '#5ee08f' : '#eef4f1';
    x.font = '600 26px "Golos Text", system-ui, sans-serif';
    this.wrap(x, e ? e.text : 'Событий пока нет', c.width - 40, Math.max(1, lines)).forEach((l, i) => x.fillText(l, 20, y + i * 34));
    const err = Diag.pageErrors ? Diag.lastError() : null;
    if (err) { x.fillStyle = '#ff6b7d'; x.font = '600 20px "Golos Text", system-ui, sans-serif'; this.wrap(x, `Ошибка: ${err.msg}`, c.width - 40, 2).forEach((l, i) => x.fillText(l, 20, 206 + i * 24)); }
    t.needsUpdate = true;
  }
  // Баннер перед глазами в шлеме; why — «почему опасно» мельче под текстом (ошибка), баннер тогда выше и висит дольше
  banner(text, level, why) {
    if (!this.ready || !this.renderer.xr.isPresenting || !this.bannerH) return;
    const { c, m } = this.bannerH, x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.font = F(600, 32);
    const main = this.wrap(x, text, c.width - 60, 3);
    x.font = F(400, 27);
    const sub = why ? this.wrap(x, 'Почему опасно: ' + why, c.width - 60, 4) : [];
    const H = Math.max(180, 30 + main.length * 42 + (sub.length ? 14 + sub.length * 34 : 0) + 18);
    // высота холста меняется — текстуру пересоздаём (в WebGL2 её размер неизменяем)
    if (c.height !== H) { c.height = H; this.bannerH.t.dispose(); this.bannerH.t = new THREE.CanvasTexture(c); this.bannerH.t.colorSpace = THREE.SRGBColorSpace; m.material.map = this.bannerH.t; m.scale.y = H / 180; m.position.y = -0.24 - (H - 180) / 180 * 0.176 / 2; }
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = level === 'err' ? 'rgba(200,20,45,0.92)' : level === 'warn' ? 'rgba(165,92,0,0.92)' : 'rgba(18,30,26,0.9)';
    rr(x, 0, 0, c.width, c.height, 24); x.fill();
    x.fillStyle = '#ffffff'; x.font = F(600, 32);
    main.forEach((l, i) => x.fillText(l, 30, 54 + i * 42));
    x.font = F(400, 27); x.fillStyle = '#ffe9ec';
    sub.forEach((l, i) => x.fillText(l, 30, 54 + main.length * 42 + 10 + i * 34));
    this.bannerH.t.needsUpdate = true;
    m.visible = true;
    this.bannerUntil = performance.now() + (why ? 9000 : level === 'err' ? 5500 : 3500);
  }
  // Ошибка задания на площадке и в полигоне: что случилось и почему опасно — у прицела (пешком), в баннере (шлем);
  // в «Обзоре» объяснение — в тосте (app.toast). e — { kind, text, why? }
  errFx(e) {
    if (!this.ready || !this.active) return;
    // в шлеме — баннер (его показывает приложение вместе с тостом)
    if (this.renderer.xr.isPresenting || !this.fpsOn()) return;
    const why = whyOf(e);
    this.walk.said(e.text, true, why ? 9000 : 5000, why ? 'Почему опасно: ' + why : '');
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
    const hs = hits || this.xrHits(info);
    return hs.find(h => h.object.userData.menu) || hs.find(h => { const u = h.object.userData; return (this.app.tool || !u.wire) && !u.item && !u.mount && !u.stand; }) || null;
  }
  pulse(info, k) {
    const gp = info.src && info.src.gamepad, ha = gp && gp.hapticActuators && gp.hapticActuators[0];
    try { if (ha && ha.pulse) ha.pulse(k, 60); } catch (e) { /* без вибрации */ }
  }
  xrSelect(info) {
    this.app.userGesture();
    if (this.tutor && this.tutor.m.visible) { this.showTutor(false); store.set(this.tutorKind === 'uvn' ? 'ts.uvnCard' : this.room ? 'ts.polyTutorVR' : 'ts.vrTutor', '1'); this.pulse(info, 0.3); return; }
    const hits = this.xrHits(info);
    // полигон: курок с предметом в этой руке — надеть, повесить, коснуться указателем по лучу
    if (this.room && this.items && this.items.select(info, hits)) return;
    const h = this.xrHit(info, hits);
    if (!h) return;
    const u = h.object.userData;
    if (u.board) { this.boardClick(h.uv); this.pulse(info, 0.3); return; }
    if (u.menu) { this.menuClick(h.uv); this.pulse(info, 0.5); return; }
    this.closeMenu3D();
    this.noteHit(h); this.probeHand = info.grip;
    if (u.dev) { this.app.pick3D(u.dev, false, { menu3d: acts => this.showMenu3D(u.dev, acts, h.point) }); this.pulse(info, 0.7); return; }
    if (u.wire) { this.app.pickWire3D(u.wire, false); this.pulse(info, 0.5); return; }
    if (u.ground) {
      // туда, где можно стоять (не в ячейку, не в аппарат, не за ограждение и стену): затемнение, перенос, кольцо прибытия
      if (h.distance > this.floorReach()) { this.banner('Дальше 25 м — подойдите ближе.', 'info'); return; }
      if (!this.canStand(h.point)) { this.banner('Туда не пройти.', 'info'); return; }
      const p = this.camera.getWorldPosition(this.tmp.v);
      this.tp.go(p, h.point, (x, z) => { const c = this.camera.getWorldPosition(this.tmp.v2); this.rig.position.x += x - c.x; this.rig.position.z += z - c.z; }, 'fade');
      this.pulse(info, 0.2);
    }
  }
  xrSqueeze(info) {
    // полигон: боковая кнопка — взять предмет и отпустить (у места — повесить, поставить)
    if (this.room && this.items) { this.items.squeeze(info, this.xrHits(info)); this.drawWrist(); return; }
    const h = this.xrHit(info);
    this.noteHit(h); this.probeHand = info.grip;
    if (h && h.object.userData.dev) { this.app.pick3D(h.object.userData.dev, true); this.pulse(info, 0.4); }
    else if (h && h.object.userData.wire) { this.app.pickWire3D(h.object.userData.wire, true); this.pulse(info, 0.4); }
  }
  // Меню аппарата в 3D (выкатная тележка): панель перед аппаратом, кнопки нажимаются лучом, щелчком или E.
  // Ширина — по самому длинному пункту (шире MENU.maxW — перенос на 2 строки), последняя строка — «Закрыть».
  // Закрывается само через 12 с или если отойти от него дальше ~4 м (menuFar)
  showMenu3D(id, acts, point) {
    this.closeMenu3D();
    const T = THREE, F = (wt, sz) => `${wt} ${sz}px "Golos Text", system-ui, sans-serif`, K = MENU;
    const title = this.app.tr.nm(id), items = [...acts, { close: true, label: 'Закрыть' }];
    const c = document.createElement('canvas'), x = c.getContext('2d');
    // ширина по тексту: размер холста сбрасывает шрифт, поэтому мерим до него
    x.font = F(600, 30);
    let w = x.measureText(title).width + 48;
    x.font = F(600, K.font);
    for (const a of items) w = Math.max(w, x.measureText(a.label).width + 2 * K.pad);
    w = Math.ceil(clamp(w, K.minW, K.maxW));
    const rows = items.map(a => ({ a, lines: this.wrap(x, a.label, w - 2 * K.pad, 2) }));
    const H = K.top + rows.reduce((s, r) => s + K.row + (r.lines.length - 1) * K.line, 0) + 14;
    c.width = w; c.height = H;
    x.fillStyle = 'rgba(16,24,21,0.95)'; rr(x, 0, 0, w, H, 22); x.fill();
    x.fillStyle = '#93a69e'; x.font = F(600, 30); x.fillText(this.fit(x, title, w - 48), 24, 46);
    let y = K.top;
    const btns = rows.map(({ a, lines }) => {
      const bh = K.row - 12 + (lines.length - 1) * K.line;
      // «Закрыть» — без заливки, чтобы не путать с операцией
      x.fillStyle = a.close ? 'rgba(16,24,21,0.95)' : '#24332d'; rr(x, 14, y, w - 28, bh, 14); x.fill();
      x.strokeStyle = a.close ? '#93a69e' : '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = a.close ? '#c6d3cd' : '#ffffff'; x.font = F(600, K.font);
      if (a.close) x.textAlign = 'center';
      lines.forEach((l, i) => x.fillText(l, a.close ? w / 2 : K.pad, y + 46 + i * K.line));
      x.textAlign = 'left';
      const b = { y0: y, y1: y + bh, a };
      y += bh + 12;
      return b;
    });
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    // 560 точек холста = 1 м: шрифт в шлеме того же размера при любой ширине
    const pw = w / K.minW, m = new T.Mesh(new T.PlaneGeometry(pw, pw * H / w), new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = 11;
    const cam = this.camera.getWorldPosition(new T.Vector3()), dir = cam.clone().sub(point);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const back = Math.min(1.2, cam.distanceTo(point) * 0.5);
    if (this.renderer.xr.isPresenting) {
      // шлем: перед аппаратом, чуть ниже глаз
      m.position.copy(point).addScaledVector(dir, back);
      m.position.y = clamp(cam.y - 0.15, 0.8, 2.4);
    } else {
      // ноутбук: меню целиком в кадре (обзор камеры уже, чем в шлеме), прицел — на заголовке: второе E не выберет пункт.
      // Если для этого меню дальше аппарата — не беда: оно рисуется поверх всего и ловится первым (items.pick)
      const ph = pw * H / w, tY = K.top / 2 / H * ph, th = Math.tan(this.camera.fov * Math.PI / 360);
      const need = Math.max((ph - tY) / th, pw / 2 / (th * this.camera.aspect)) * 1.15;
      const hd = Math.hypot(cam.x - point.x, cam.z - point.z), d = clamp(Math.max(hd - back, need), 0.5, 3);
      const look = this.camera.getWorldDirection(new T.Vector3()), lh = Math.hypot(look.x, look.z) || 1;
      m.position.set(cam.x + look.x / lh * d, cam.y + d * look.y / lh - (ph / 2 - tY), cam.z + look.z / lh * d);
    }
    m.lookAt(cam.x, m.position.y, cam.z);
    m.userData.menu = true;
    this.scene.add(m); this.pickables.push(m);
    // меню, открытое лучом издалека (площадка), закрывается, когда отошли ещё на метр
    const far = Math.max(K.far, Math.hypot(cam.x - m.position.x, cam.z - m.position.z) + 1);
    this.menu3d = { m, id, btns, H, w, far, until: performance.now() + 12000 };
  }
  menuFar() {
    const mm = this.menu3d, p = this.camera.getWorldPosition(this.tmp.v2);
    return Math.hypot(p.x - mm.m.position.x, p.z - mm.m.position.z) > mm.far;
  }
  // Куда смотреть пешком, чтобы под прицелом было нужное: what = { item | mount | dev } или { menu: 'пункт меню' }.
  // Возвращает { p — точка в мире, want(aim) — то ли под прицелом } или null. Для автопоказа и автопроходки (walk.seek)
  aimTarget(what) {
    const T = THREE, p = new T.Vector3();
    if (what.menu) {
      const mm = this.menu3d, b = mm && mm.btns.find(q => q.a.label === what.menu);
      if (!b) return null;
      mm.m.updateWorldMatrix(true, false);
      mm.m.localToWorld(p.set(0, (0.5 - (b.y0 + b.y1) / 2 / mm.H) * mm.m.geometry.parameters.height, 0));
      return { p, want: a => !!a && a.type === 'menu' && (this.menuBtn(a.h.uv) || {}).a === b.a };
    }
    const key = what.item ? 'item' : what.mount ? 'mount' : what.wire ? 'wire' : 'dev', id = what[key];
    // у предмета — коробка, которая сейчас ловится (поставленное ограждение — стойка у прохода, а не сложенное у фасада)
    const o = this.pickables.find(q => q.userData[key] === id && (key !== 'item' || !this.items || this.items.proxyOn(q)));
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    o.getWorldPosition(p);
    return { p, want: a => !!a && a.type === key && a.id === id };
  }
  // Пункт меню под лучом или прицелом (null — заголовок или зазор)
  menuBtn(uv) {
    const mm = this.menu3d;
    if (!mm || !uv) return null;
    const py = (1 - uv.y) * mm.H;
    return mm.btns.find(q => py >= q.y0 && py <= q.y1) || null;
  }
  menuClick(uv) {
    const mm = this.menu3d, b = this.menuBtn(uv);
    if (!b) return;
    this.closeMenu3D();
    if (b.a.close) return;
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
    let hoverId = null, floor = null;
    const rays = this._rays || (this._rays = new Map());
    rays.clear();
    for (const info of this.ctrls) {
      if (!info.src) continue;
      info.line.visible = true;
      const hits = this.xrHits(info), h = this.xrHit(info, hits);
      rays.set(info, hits);
      // полигон: луч жёлтый и над предметом или местом, куда можно повесить то, что в руке
      const it = this.room && this.items ? this.items.pick(hits, info.i, 1.7) : null;
      const hp = it && (!h || it.h.distance <= h.distance) ? it.h : h;
      if (hp) {
        info.line.scale.z = hp.distance;
        info.dot.visible = true; info.dot.position.copy(hp.point);
        if (hp.object.userData.dev) hoverId = hp.object.userData.dev;
      } else { info.line.scale.z = 6; info.dot.visible = false; }
      const u = hp && hp.object.userData, col = it || (u && (u.dev || u.board || u.menu || u.wire)) ? RAY.hot : RAY.idle;
      // луч на полу — метка: куда встанете (дальше 25 м на площадке — нет)
      if (!floor && hp && u.ground && !this.tp.busy && hp.distance <= this.floorReach()) floor = hp;
      info.line.material.color.setHex(col); info.dot.material.color.setHex(col);
      const gp = info.src.gamepad;
      // A (правый) или X (левый) — отметка для отчёта теста
      const bA = !!(gp && gp.buttons && gp.buttons[4] && gp.buttons[4].pressed);
      if (bA && !info.aWas) this.addMark('кнопка ' + (info.hand === 'left' ? 'X' : 'A'));
      info.aWas = bA;
      // B (правый) или Y (левый) — к аппарату следующего шага (площадка, с подсказками шагов)
      const bB = !!(gp && gp.buttons && gp.buttons[5] && gp.buttons[5].pressed);
      if (bB && !info.bWas && !this.room) this.goNext();
      info.bWas = bB;
      if (gp && gp.axes && gp.axes.length) {
        const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
        const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
        if (info.hand === 'right') this.xrTurn(info, ax);
        else this.xrMove(ax, ay, dt);
      }
    }
    this.setHover(hoverId);
    this.tp.aim(floor && floor.point, !!floor && this.canStand(floor.point));
    if (this.room && this.items) this.items.xrFrame(this.ctrls, rays);
    if (this.bannerH.m.visible && performance.now() > this.bannerUntil) this.bannerH.m.visible = false;
    const now = performance.now();
    if (!this.gazeT || now - this.gazeT > 250) {
      this.gazeT = now;
      const g = this.gazeLabel();
      if (!g.board) this.lastGaze = { label: g.label, t: now };
    }
  }
  // ---------- подсказки шагов на площадке: маяк, «Перейти к аппарату» ----------
  // Маяк — столб света над аппаратом следующего шага: виден издалека, один вызов, только с подсказками
  makeBeacon() {
    const T = THREE, c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(0.08, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 4, 128);
    const tex = new T.CanvasTexture(c);
    const m = new T.Mesh(new T.CylinderGeometry(0.22, 0.32, 16, 16, 1, true), new T.MeshBasicMaterial({ color: PAL.ui.guide, map: tex, transparent: true, opacity: 0.85,
      blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.visible = false; m.renderOrder = 3; m.raycast = () => {}; m.frustumCulled = false;
    this.scene.add(m);
    this.beacon = m;
  }
  // Куда идти, чтобы выполнить шаг: аппарат (или модель ПЗ), иначе провод, на который накладывают ПЗ или ставят указатель
  guideTarget(id) {
    if (!id || this.room) return null;
    if (this.dev.has(id)) return { dev: id };
    const s = this.app.scheme, at = isPzId(id) ? id.slice(3) : id;
    if (this.dev.has(at)) return { dev: at };
    return s.wires.some(w => w.id === at) ? { wire: at } : null;
  }
  guidePoint(t) {
    if (!t) return null;
    if (t.dev) return this.dev.get(t.dev).group.getWorldPosition(new THREE.Vector3());
    if (this.zru) { const n = this.app.tr.topo.wireNode.get(t.wire), q = this.zru.nodes.has(n) ? this.zru.inner(n) : null; if (q) return q; }
    const w = this.app.scheme.wires.find(q => q.id === t.wire);
    return w ? this.toWorld(wireMid(w)) : null;
  }
  // После каждого изменения: маяк — над аппаратом следующего шага
  syncGuide() {
    const g = this.room ? null : this.app.guideNext(), p = g ? this.guidePoint(this.guideTarget(g.step.id)) : null;
    this.beacon.visible = !!p;
    if (p) this.beacon.position.set(p.x, 8, p.z);
  }
  say(text, level = 'info') { this.app.toast(text, level); this.banner(text, level); }
  // Карточка «Указатель: как понять результат» — при первом взятии указателя (в обучении; в экзамене и показе — нет)
  uvnCard() {
    const app = this.app;
    if ((app.exam && app.exam.active()) || app.demoOn || store.get('ts.uvnCard') === '1') return;
    if (this.renderer.xr.isPresenting) this.showTutor(true, 'uvn'); else this.walk.intro(true, false, 'uvn');
  }
  // G, «Перейти · G», «К следующему» (щит, B/Y в шлеме): к аппарату следующего шага
  goNext() {
    const app = this.app, g = app.guideNext();
    if (!g) { this.say(app.exam && app.exam.active() ? 'В экзамене подсказок нет.' : !app.stepGuide ? 'Подсказки шагов выключены.' : 'Задание не идёт — начните задание.'); return false; }
    return this.goTo(g.step.id);
  }
  // G пешком: аппарат вдали под прицелом — к нему, иначе — к следующему шагу. В экзамене G нет
  goG(aim) {
    if (this.app.exam && this.app.exam.active()) { this.say('В экзамене подсказок нет: к аппарату — пешком или щелчком по земле.'); return; }
    if (aim && aim.type === 'far') this.goTo(aim.id); else this.goNext();
  }
  // Перейти к аппарату id: пешком — к месту перед ним (прицел на нём), в «Обзоре» — камера на него, в шлеме — затемнением
  goTo(id) {
    const t = this.guideTarget(id);
    if (!t || !this.ready) return false;
    const a = this.aimTarget(t);
    if (!a) return false;
    if (this.renderer.xr.isPresenting) return this.xrGoTo(t, a);
    if (!this.yardWalk) {
      const o = this.orbit;
      o.target.set(a.p.x, 1.5, a.p.z); o.r = Math.min(o.r, 20);
      if (this.top) { o.ph = 0.98; this.top = false; }
      this.applyOrbit(); this.setHover(t.dev || null);
      return true;
    }
    const q = this.seekFor(t, a);
    if (!q) { this.say(`Не нашлось места, откуда видно ${this.app.tr.nm(id)}.`, 'warn'); return false; }
    this.walk.goPose(q);
    return true;
  }
  seekFor(t, a) {
    this.wireAim = !!t.wire;
    try { return this.walk.seek(a.p, a.want, false, [3.2, 2.5, 4, 1.8, 5, 2.2, 5.6]); } finally { this.wireAim = false; }
  }
  // Шлем: место ищет тот же walk.seek (на время — rig в начале координат), переход — затемнением, взгляд — на аппарат
  xrGoTo(t, a) {
    const T = THREE, rig = this.rig, cam = this.camera, w = this.walk;
    const head = cam.getWorldPosition(new T.Vector3()), dir = cam.getWorldDirection(new T.Vector3());
    const rp = rig.position.clone(), ry = rig.rotation.y, cp = cam.position.clone(), cq = cam.quaternion.clone();
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true);
    w.x = head.x; w.z = head.z; w.yaw = Math.atan2(-dir.x, -dir.z); w.pitch = 0;
    let q = null;
    try { q = this.seekFor(t, a); } finally {
      rig.position.copy(rp); rig.rotation.set(0, ry, 0); cam.position.copy(cp); cam.quaternion.copy(cq); rig.updateMatrixWorld(true);
    }
    if (!q) { this.banner('Не нашлось места, откуда видно аппарат.', 'warn'); return false; }
    this.tp.go(head, q, (x, z) => {
      const c = cam.getWorldPosition(new T.Vector3()), d = cam.getWorldDirection(new T.Vector3()), hy = Math.atan2(-d.x, -d.z);
      const ang = Math.atan2(Math.sin(q.yaw - hy), Math.cos(q.yaw - hy));
      rig.position.sub(c).applyAxisAngle(this.tmp.up, ang).add(c); rig.rotation.y += ang;
      rig.updateMatrixWorld(true);
      const c2 = cam.getWorldPosition(new T.Vector3());
      rig.position.x += x - c2.x; rig.position.z += z - c2.z;
    }, 'fade');
    return true;
  }
  // Курок по полу: на площадке — до 25 м (как щелчок на ноутбуке), в помещении — до стены (пол только внутри)
  floorReach() { return this.room ? 80 : WALK_REACH.floor; }
  canStand(p) { return !this.world || this.world.walkable(p.x, p.z); }
  xrMove(ax, ay, dt) {
    if (Math.abs(ax) < 0.15 && Math.abs(ay) < 0.15) return;
    const f = this.tmp.dir;
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) return;
    f.normalize();
    const sp = 3.0 * dt, dx = (f.x * -ay + -f.z * ax) * sp, dz = (f.z * -ay + f.x * ax) * sp;
    if (this.world) {
      // стик не проводит сквозь стены, ячейки, тележки и аппараты площадки
      const p = this.camera.getWorldPosition(this.tmp.v2), [nx, nz] = this.world.resolve(p.x + dx, p.z + dz, 0.22);
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
    this.tp.cancel();
    this.probe.dispose();
    this.showRoof(true);
    this.rig.position.copy(this.start);
    this.rig.rotation.set(0, 0, 0);
    // площадка с заданием — у щита рядом с первым аппаратом, лицом к нему
    if (!this.room && this.taskStart) { this.rig.position.set(this.taskStart.x, 0, this.taskStart.z); this.rig.rotation.y = this.taskStart.yaw; }
    // ходьба на ноутбуке отключается до выхода из шлема; камера — снова в начале координат
    if (this.walking()) { this.walk.disable(); this.camera.position.set(0, 0, 0); this.camera.rotation.set(0, 0, 0); }
    if (this.room) {
      // полигон: у входа лицом к стенду
      this.rig.rotation.y = this.room.start.yaw;
      if (this.items) this.items.xrStart();
    }
    this.tip(null); this.setHover(null);
    this.coach.hide();
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
    // затемнение и метка не остаются после шлема
    this.tp.cancel();
    this.probe.dispose();
    this.showRoof(this.yardWalk);
    Diag.sessionEnd();
    if (this.tutor) this.tutor.m.visible = false;
    this.handsOnly = false;
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    for (const info of this.ctrls) { info.line.visible = false; info.dot.visible = false; }
    this.bannerH.m.visible = false;
    document.getElementById('btnVR').textContent = 'Войти в VR';
    if (this.items) this.items.xrEnd();
    if (this.coach.on) this.coach.update(true);
    // снова пешком на ноутбуке (полигон или площадка «Пешком») или обзор
    if (this.walking()) { if (this.active) this.walk.enable(this.world); this.walk.apply(); }
    else this.applyOrbit();
    this.resize();
    if (!this.active) this.renderer.setAnimationLoop(null);
  }
}

export { THREE, loadThree, S3, COL3, rr, View3D };
