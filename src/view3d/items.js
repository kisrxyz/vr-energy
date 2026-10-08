/* ===== VR-полигон: предметы в руках =====
   Модели предметов со стенда: диэлектрические перчатки, каска, указатель напряжения УВН-10, переносное заземление,
   замок, переносное ограждение, плакаты. Здесь — где предмет физически (стенд, рука, пол, место) и что с ним делают руки:
   взять, отпустить, повесить, надеть, коснуться указателем. Надет ли, висит ли, наложено ли и все правила — в Permit
   (src/core/permit.js); 3D только спрашивает его и показывает итог (sync).
   Руки: 'desk' — ноутбук (предмет перед камерой, E и Q), 0 и 1 — контроллеры шлема (боковая кнопка — взять и отпустить).
   Перчатки и каску в руку не берут: их надевают сразу, как взяли со стенда.
   Предпросмотр, пока предмет в руке: все места, куда его можно поставить сейчас, мягко подсвечены (одна InstancedMesh, места одинаковые —
   правильное не выдаётся); у места под прицелом или лучом — призрак самого предмета там, где он встанет (одна сетка);
   с «Подсказками мероприятий» место ближайшего мероприятия — пульсирующее кольцо (одна InstancedMesh). Всего ≤ 3 вызова и только с предметом в руке. */
import { ITEMS, ITEM, TAKES, parseMount, placeText } from '../core/permit.js';
import { Sound } from '../ui/sound.js';
import { PAL } from './models/kit.js';

const PW = 0.32, PH = 0.2;                         // плакат, м (крупнее настоящего 240×130 мм — читается в шлеме)
const REACH = { desk: 2.6, xr: 1.7, grab: 0.17, snap: 0.3, tip: 0.1 };
// Как предмет держат: смещение и поворот относительно камеры (ноутбук) и контроллера (шлем)
const HOLD = {
  desk: {
    poster: [[0.17, -0.17, -0.42], [-0.15, -0.35, 0]],
    uvn: [[0.16, -0.2, -0.28], [0.12, 0.12, 0]], pz: [[0.16, -0.2, -0.3], [0.1, 0.12, 0]], lock: [[0.16, -0.16, -0.38], [0.2, -0.3, 0]],
    fence: [[0.25, -0.95, -0.55], [0, -0.3, 0]],
  },
  xr: {
    poster: [[0, 0.02, -0.12], [-0.6, 0, 0]],
    uvn: [[0, 0, 0.05], [0, 0, 0]], pz: [[0, 0, 0.05], [0, 0, 0]], lock: [[0, 0, -0.06], [0, 0, 0]], fence: [[0, -0.6, -0.1], [0, 0, 0]],
  },
};
const PPE = { gloves: true, helmet: true };        // надевают сразу, в руку не берут
const C = PAL.items, GLOVE = C.glove, CTRL = C.ctrl;   // цвет перчаток; коробки контроллеров в шлеме — без перчаток и в перчатках (цвета — models/kit.js)
// Как предмет лежит на полу: высота и наклон
const REST = { poster: [0.006, -Math.PI / 2], gloves: [0.03, 0], helmet: [0.0, 0], uvn: [0.03, 0], pz: [0.03, 0], lock: [0.02, 0], fence: [0, 0] };
// Поставленное ограждение (местные координаты ячейки): стойки по углам и у входа, лента на высоте пояса
const FENCE = { Z0: 0.15, Z1: 2.55, X: 0.62, Y: 0.95 };
FENCE.posts = [[-FENCE.X, FENCE.Z1], [FENCE.X, FENCE.Z1], [0.05, FENCE.Z1], [-FENCE.X, FENCE.Z0], [FENCE.X, FENCE.Z0]];
const distToSeg = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1))); return a.clone().addScaledVector(ab, t).distanceTo(p); };

class Items {
  constructor(v, room) {
    this.v = v; this.room = room; this.T = v.kit.T;
    this.list = new Map(); this.hands = { desk: null, 0: null, 1: null };
    this.touching = new Map(); this.lampUntil = 0; this.hot = null; this.hotMats = new Map();
    this.mats();
    for (const it of ITEMS) this.make(it);
    this.makePreview();
    this.sync(true);
  }
  get permit() { return this.v.app.permit; }

  // ---------- модели ----------
  mats() {
    const T = this.T, S = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.05 }, o));
    // плакаты: один атлас на четыре вида, у каждого плаката свой кусок
    const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
    const x = c.getContext('2d'), F = (w, s) => `${w} ${s}px "Golos Text", system-ui, sans-serif`;
    const reg = {}, cell = (k, X, Y, draw) => { x.save(); x.translate(X, Y); draw(512, 320); x.restore(); reg[k] = [X / 1024, 1 - (Y + 320) / 640, (X + 512) / 1024, 1 - Y / 640]; };
    const txt = (t, cx, y, f, col) => { x.font = f; x.fillStyle = col; x.textAlign = 'center'; x.fillText(t, cx, y); x.textAlign = 'left'; };
    // «Не включать! Работают люди» — запрещающий: красная кайма, белый фон, красная надпись
    cell('nevkl', 0, 0, (w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d0202f'; x.lineWidth = 26; x.strokeRect(13, 13, w - 26, h - 26);
      txt('НЕ ВКЛЮЧАТЬ!', w / 2, 140, F(800, 66), '#d0202f'); txt('РАБОТАЮТ ЛЮДИ', w / 2, 232, F(800, 52), '#d0202f');
    });
    // «Заземлено» — указательный: синий фон, белое поле, чёрная надпись
    cell('zazem', 512, 0, (w, h) => {
      x.fillStyle = '#1a4fb0'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffffff'; x.fillRect(48, 70, w - 96, h - 140);
      txt('ЗАЗЕМЛЕНО', w / 2, 184, F(800, 64), '#111111');
    });
    // «Стой! Напряжение» — предупреждающий: красная кайма, чёрная надпись, красная стрела-молния
    cell('stop', 0, 320, (w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d0202f'; x.lineWidth = 22; x.strokeRect(11, 11, w - 22, h - 22);
      txt('СТОЙ', w / 2, 92, F(800, 62), '#111111'); txt('НАПРЯЖЕНИЕ', w / 2, 284, F(800, 54), '#111111');
      x.fillStyle = '#d0202f'; x.beginPath(); x.moveTo(290, 108); x.lineTo(222, 188); x.lineTo(258, 188); x.lineTo(226, 246); x.lineTo(304, 166); x.lineTo(266, 166); x.closePath(); x.fill();
    });
    // «Работать здесь» — предписывающий: зелёный фон, белый круг, чёрная надпись
    cell('work', 512, 320, (w, h) => {
      x.fillStyle = '#16843c'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffffff'; x.beginPath(); x.arc(w / 2, h / 2, 138, 0, Math.PI * 2); x.fill();
      txt('РАБОТАТЬ', w / 2, 150, F(800, 50), '#111111'); txt('ЗДЕСЬ', w / 2, 210, F(800, 50), '#111111');
    });
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    this.reg = reg;
    // лента ограждения: красно-белые полосы
    const tc = document.createElement('canvas'); tc.width = 64; tc.height = 16;
    const tx = tc.getContext('2d');
    tx.fillStyle = '#ffffff'; tx.fillRect(0, 0, 64, 16); tx.fillStyle = '#d0202f';
    for (let i = -1; i < 4; i++) { tx.beginPath(); tx.moveTo(i * 32, 16); tx.lineTo(i * 32 + 16, 16); tx.lineTo(i * 32 + 32, 0); tx.lineTo(i * 32 + 16, 0); tx.closePath(); tx.fill(); }
    const tape = new T.CanvasTexture(tc); tape.colorSpace = T.SRGBColorSpace; tape.wrapS = T.RepeatWrapping;
    this.M = {
      poster: new T.MeshBasicMaterial({ map: tex, toneMapped: false }), back: S(C.back),
      glove: S(GLOVE, { roughness: 0.75 }), helmet: S(C.helmet, { roughness: 0.35 }),
      rod: S(C.rod, { roughness: 0.4 }), handle: S(C.handle, { roughness: 0.6 }), head: S(C.head, { roughness: 0.4 }),
      metal: S(C.metal, { metalness: 0.7, roughness: 0.3 }), pzRod: S(C.pzRod, { roughness: 0.45 }), pzCable: S(C.pzCable, { roughness: 0.5 }),
      brass: S(C.brass, { metalness: 0.6, roughness: 0.35 }), post: S(C.post), tape: new T.MeshStandardMaterial({ map: tape, roughness: 0.6 }),
      lamp: new T.MeshBasicMaterial({ color: C.lampOff, toneMapped: false }),
    };
  }
  // Плоскость с куском атласа плакатов
  posterMesh(kind) {
    const T = this.T, g = new T.PlaneGeometry(PW, PH), uv = g.attributes.uv, r = this.reg[kind];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? r[2] : r[0], uv.getY(i) ? r[3] : r[1]);
    const m = new T.Mesh(g, this.M.poster);
    m.position.z = 0.004;
    return m;
  }
  make(it) {
    const T = this.T, k = this.v.kit, M = this.M, g = new T.Group(), body = new T.Group();
    g.add(body);
    let size = [0.2, 0.2, 0.2], center = [0, 0, 0], tip = null, lamp = null, folded = null, open = null;
    if (it.kind === 'poster') {
      body.add(this.posterMesh(it.poster));
      body.add(k.box(PW, PH, 0.006, M.back, 0, 0, 0));
      size = [PW, PH, 0.04];
    } else if (it.kind === 'gloves') {
      for (const sx of [-0.06, 0.06]) {
        body.add(k.cyl(0.045, 0.12, M.glove, sx, 0, 0.08, 'z'));
        body.add(k.box(0.085, 0.03, 0.1, M.glove, sx, 0, -0.03));
        for (let f = 0; f < 4; f++) body.add(k.box(0.017, 0.022, 0.07, M.glove, sx - 0.03 + f * 0.02, 0, -0.115));
        body.add(k.box(0.018, 0.022, 0.06, M.glove, sx + (sx < 0 ? 0.05 : -0.05), 0, -0.04));
      }
      size = [0.24, 0.08, 0.3];
    } else if (it.kind === 'helmet') {
      body.add(new T.Mesh(new T.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.helmet));
      body.add(k.cyl(0.155, 0.012, M.helmet, 0, 0.006, 0.02));
      body.add(k.box(0.025, 0.02, 0.24, M.helmet, 0, 0.12, 0));
      size = [0.32, 0.16, 0.32]; center = [0, 0.06, 0];
    } else if (it.kind === 'uvn') {
      // рукоятка у начала координат, наконечник — по −z: так его держат в руке и касаются контактов
      body.add(k.cyl(0.02, 0.3, M.handle, 0, 0, -0.03, 'z'));
      body.add(k.cyl(0.036, 0.016, M.rod, 0, 0, -0.19, 'z'));
      body.add(k.cyl(0.016, 0.44, M.rod, 0, 0, -0.41, 'z'));
      body.add(k.cyl(0.03, 0.13, M.head, 0, 0, -0.69, 'z'));
      body.add(k.cyl(0.006, 0.07, M.metal, 0, 0, -0.79, 'z'));
      lamp = new T.Mesh(this.v.geo.sphere, M.lamp);
      lamp.scale.setScalar(0.017); lamp.position.set(0, 0.03, -0.68);
      g.add(lamp);
      tip = [0, 0, -0.83]; size = [0.08, 0.08, 0.86]; center = [0, 0, -0.4];
    } else if (it.kind === 'pz') {
      // штанга с зажимом на конце (для разъёмных контактов КРУ) и моток провода к заземлению
      body.add(k.cyl(0.018, 0.62, M.pzRod, 0, 0, -0.3, 'z'));
      body.add(k.box(0.07, 0.05, 0.05, M.metal, 0, 0, -0.63));
      body.add(new T.Mesh(new T.TorusGeometry(0.075, 0.012, 6, 18), M.pzCable));
      body.children[body.children.length - 1].position.set(0, -0.09, 0.03);
      tip = [0, 0, -0.65]; size = [0.18, 0.2, 0.7]; center = [0, -0.03, -0.3];
    } else if (it.kind === 'lock') {
      body.add(k.box(0.05, 0.06, 0.025, M.brass, 0, 0, 0));
      const sh = new T.Mesh(new T.TorusGeometry(0.018, 0.005, 6, 12, Math.PI), M.metal);
      sh.position.y = 0.03; body.add(sh);
      size = [0.08, 0.12, 0.06];
    } else if (it.kind === 'fence') {
      // сложенное: две стойки и рулон ленты; поставленное — П-образное ограждение места работ
      folded = new T.Group(); body.add(folded);
      for (const sx of [-0.05, 0.05]) { folded.add(k.cyl(0.018, 1.0, M.post, sx, 0.52, 0)); folded.add(k.box(0.16, 0.02, 0.16, M.post, sx, 0.01, 0)); }
      folded.add(k.cyl(0.06, 0.1, M.tape, 0, 0.9, 0.05, 'x'));
      open = this.fenceOpen();
      g.add(open); open.visible = false;
      size = [0.3, 1.05, 0.3]; center = [0, 0.52, 0];
    }
    // невидимая коробка: по ней ловят предмет щелчком или лучом
    // у ограждения — своя коробка у сложенного (на стенде, в руке, на полу); у поставленного — коробки стоек и ленты (fenceOpen)
    const px = new T.Mesh(new T.BoxGeometry(size[0] + 0.06, size[1] + 0.06, size[2] + 0.06), this.v._proxyMat);
    px.position.set(center[0], center[1], center[2]); px.visible = false; px.userData.item = it.id; px.userData.proxy = true;
    if (open) px.userData.part = 'folded';
    g.add(px); this.v.pickables.push(px);
    g.traverse(o => { o.userData.dyn = true; });
    for (const ch of body.children) ch.userData.dyn = true;
    this.v.root.add(g);
    this.list.set(it.id, { id: it.id, it, obj: g, body, proxy: px, center, tip, lamp, folded, open, state: 'home', hand: null, mount: null, fall: null });
  }
  // Поставленное ограждение: стойки по углам места работ, лента на высоте пояса, вход справа.
  // Снять его можно за любую стойку или ленту: у каждой своя невидимая коробка (part 'open' — ловятся, только пока оно стоит)
  fenceOpen() {
    const T = this.T, k = this.v.kit, M = this.M, g = new T.Group(), { Z0, Z1, X, Y } = FENCE;
    const grip = (w, h, d, x, y, z) => {
      const px = new T.Mesh(new T.BoxGeometry(w, h, d), this.v._proxyMat);
      px.position.set(x, y, z); px.visible = false; Object.assign(px.userData, { item: 'fence', part: 'open', proxy: true });
      g.add(px); this.v.pickables.push(px);
    };
    for (const [px, pz] of FENCE.posts) { g.add(k.cyl(0.02, 1.0, M.post, px, 0.5, pz)); g.add(k.box(0.16, 0.02, 0.16, M.post, px, 0.01, pz)); grip(0.2, 1.06, 0.2, px, 0.52, pz); }
    const tape = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), m = k.box(x0 === x1 ? 0.01 : len, 0.07, x0 === x1 ? len : 0.01, M.tape, (x0 + x1) / 2, Y, (z0 + z1) / 2);
      // полосы ленты не растягиваются с длиной
      m.geometry = m.geometry.clone();
      const uv = m.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 0.25);
      g.add(m);
      grip(x0 === x1 ? 0.12 : len, 0.2, x0 === x1 ? len : 0.12, (x0 + x1) / 2, Y, (z0 + z1) / 2);
    };
    tape(-X, Z0, -X, Z1); tape(X, Z0, X, Z1); tape(-X, Z1, 0.05, Z1);
    // место для плаката «Стой! Напряжение» — на ленте слева, лицом внутрь
    const px = new T.Mesh(new T.BoxGeometry(0.08, 0.34, 0.9), this.v._proxyMat);
    px.position.set(-X + 0.02, Y, 1.4); px.visible = false; px.userData.mount = 'fence'; px.userData.proxy = true;
    g.add(px); this.v.pickables.push(px);
    this.fenceProxy = px;
    return g;
  }

  // ---------- где предмет ----------
  heldIn(hand) { return this.hands[hand] || null; }
  handOf(id) { for (const h of Object.keys(this.hands)) if (this.hands[h] === id) return h; return null; }
  setPose(x, parent, p, r, s = 1) {
    if (x.obj.parent !== parent) parent.add(x.obj);
    x.obj.position.set(p[0], p[1], p[2]);
    x.obj.rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
    x.obj.scale.setScalar(s);
    x.obj.visible = true;
  }
  freeHand(x) { const h = this.handOf(x.id); if (h != null) this.hands[h] = null; x.hand = null; }
  toHome(x) {
    this.freeHand(x);
    x.state = 'home'; x.mount = null; x.fall = null;
    this.showOpen(x, false);
    if (x.it.kind === 'fence') { this.setPose(x, this.v.root, [this.room.fenceHome.x, 0, this.room.fenceHome.z], [0, 0.4, 0]); return; }
    const h = this.room.homes[x.id] || { p: [0, 1.2, 0.2] };
    this.setPose(x, this.room.stand, h.p, h.r);
  }
  toHand(x, hand) {
    this.freeHand(x);
    const xr = hand !== 'desk', hold = HOLD[xr ? 'xr' : 'desk'][x.it.kind], parent = xr ? this.v.ctrls[hand].grip : this.v.camera;
    x.state = 'hand'; x.hand = hand; x.mount = null; x.fall = null;
    this.hands[hand] = x.id;
    this.showOpen(x, false);
    this.setPose(x, parent, hold[0], hold[1], xr ? 1 : 0.8);
  }
  toWorn(x) { this.freeHand(x); x.state = 'worn'; x.mount = null; x.obj.visible = false; }
  // Где предмет встанет на месте at: родитель, точка и поворот. Плакаты — по очереди со смещением (slot — номер плаката на месте),
  // замок — на петлю привода, ПЗ — зажимом на контакты, ограждение — вокруг места работ. Тем же считается призрак предпросмотра
  mountPose(x, at, slot = 0) {
    const m = at === 'fence' ? this.fenceMount() : this.room.mounts.get(at);
    if (!m) return null;
    const kind = x.it.kind, p = m.p, sv = m.slot || [0, 0, 0];
    if (kind === 'poster') return { parent: m.obj, p: [p[0] + sv[0] * slot, p[1] + sv[1] * slot, p[2] + sv[2] * slot], r: [0, m.ry || 0, 0] };
    if (kind === 'lock') return { parent: m.obj, p: m.lock || p, r: [0, 0, 0] };
    if (kind === 'pz') return { parent: m.obj, p: [p[0] + 0.12, p[1], p[2] + 0.62], r: [0, 0, 0] };
    if (kind === 'fence') return { parent: m.obj, p: [0, 0, 0], r: [0, 0, 0] };
    return null;
  }
  // Номер плаката на месте: свой, если уже висит здесь, иначе первый свободный — соседние плакаты при этом не переезжают
  freeSlot(at, x) {
    if (x.it.kind !== 'poster') return 0;
    if (x.state === 'mount' && x.mount === at && x.slot != null) return x.slot;
    const used = new Set([...this.list.values()].filter(q => q !== x && q.state === 'mount' && q.mount === at && q.it.kind === 'poster').map(q => q.slot));
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }
  toMount(x, at) {
    const slot = this.freeSlot(at, x), q = this.mountPose(x, at, slot);
    if (!q) { this.toHome(x); return; }
    this.freeHand(x);
    x.state = 'mount'; x.mount = at; x.fall = null; x.slot = slot;
    this.setPose(x, q.parent, q.p, q.r);
    this.showOpen(x, x.it.kind === 'fence');
  }
  showOpen(x, on) {
    if (!x.open) return;
    x.open.visible = on; x.folded.visible = !on;
  }
  // Место «на ограждении» существует, пока ограждение поставлено
  fenceMount() {
    const f = this.list.get('fence');
    if (!f || f.state !== 'mount') return null;
    return { obj: f.open, p: [-0.62 + 0.03, 0.95, 1.25], ry: Math.PI / 2, slot: [0, -0.02, 0.36] };
  }
  // Положить на пол перед собой (или там, где предмет сейчас): падает и ложится
  toFloor(x, at) {
    this.freeHand(x);
    const T = this.T, wp = at || x.obj.getWorldPosition(new T.Vector3());
    const [fx, fz] = this.room.resolve(wp.x, wp.z, 0.12);
    const rest = REST[x.it.kind] || [0.02, 0];
    this.showOpen(x, false);
    const y0 = Math.max(wp.y, rest[0]);
    this.setPose(x, this.v.root, [fx, y0, fz], [rest[1], Math.random() * 6.28, 0]);
    x.state = 'floor'; x.mount = null;
    x.fall = { y: y0, to: rest[0], v: 0 };
  }

  // Предметы на полу — не под тележкой и не в стене (тележку выкатили на лежащий предмет)
  unbury() {
    for (const x of this.list.values()) {
      if (x.state !== 'floor') continue;
      const p = x.obj.position, [fx, fz] = this.room.resolve(p.x, p.z, 0.12);
      if (Math.abs(fx - p.x) > 1e-4 || Math.abs(fz - p.z) > 1e-4) { p.x = fx; p.z = fz; }
    }
  }

  // ---------- синхронизация с Permit ----------
  sync(reset) {
    const pm = this.permit;
    if (reset || !pm || !pm.active) { for (const x of this.list.values()) this.toHome(x); this.updateFenceProxy(); this.gloveGrips(); return; }
    // сначала ограждение: на нём висят плакаты
    const order = [...this.list.values()].sort((a, b) => (a.it.kind === 'fence' ? -1 : 0) - (b.it.kind === 'fence' ? -1 : 0));
    for (const x of order) {
      const at = pm.itemAt(x.id);
      if (at === 'worn') { if (x.state !== 'worn') this.toWorn(x); continue; }
      if (at) { this.toMount(x, at); continue; }
      // сняли не руками (убрали ограждение вместе с плакатом) — падает на пол
      if (x.state === 'mount') { this.toFloor(x); continue; }
      if (x.state === 'worn') this.toHome(x);
    }
    this.updateFenceProxy();
    this.gloveGrips();
  }
  updateFenceProxy() { const f = this.list.get('fence'); this.fenceOn = !!(f && f.state === 'mount'); }
  // В шлеме: перчатки надеты — коробки контроллеров цвета перчаток
  gloveGrips(off) {
    const m = this.v.gripMat, pm = this.permit;
    if (m) m.color.setHex(!off && pm && pm.active && pm.itemAt('gloves') === 'worn' ? GLOVE : CTRL);
  }

  // ---------- что под прицелом или лучом ----------
  // Подходит ли попадание: держим предмет — места для него (и аппараты, щит); пустая рука — предметы, аппараты, щит
  usable(u, held) {
    if (u.item) {
      const x = this.list.get(u.item);
      if (held || !x || x.state === 'worn' || x.state === 'hand') return false;
      return !u.part || (u.part === 'open') === (x.state === 'mount');
    }
    if (u.mount) {
      if (!held) return false;
      if (u.mount === 'fence' && !this.fenceOn) return false;
      const m = parseMount(u.mount), kind = ITEM[held].kind;
      return !!m && (TAKES[m.type] || []).includes(kind);
    }
    if (u.stand) return !!held;
    return !!(u.dev || u.board || u.menu);
  }
  pick(hits, hand, far) {
    const held = this.heldIn(hand);
    // меню тележки рисуется поверх всего — и ловится первым, даже если стоит дальше аппарата
    const mh = hits.find(h => h.object.userData.menu);
    if (mh && mh.distance <= 9) return { h: mh, type: 'menu', id: null };
    for (const h of hits) {
      const u = h.object.userData;
      if (u.ground || u.wire) continue;
      if (!this.usable(u, held)) continue;
      const lim = u.board || u.menu ? 9 : far;
      if (h.distance > lim) return null;
      const type = u.item ? 'item' : u.mount ? 'mount' : u.stand ? 'stand' : u.dev ? 'dev' : u.board ? 'board' : 'menu';
      return { h, type, id: u.item || u.mount || u.dev || null };
    }
    return null;
  }
  // Подпись для прицела: что это и что будет по E
  label(tgt, hand) {
    const held = this.heldIn(hand), pm = this.permit, tr = this.v.app.tr;
    if (!tgt) return held ? `В руке: ${ITEM[held].title}` : '';
    if (tgt.type === 'item') {
      const at = pm.itemAt(tgt.id), it = ITEM[tgt.id];
      return `${it.title}${at && at !== 'worn' ? ' ' + placeText(at, 1) : ''} — ${at ? (it.kind === 'fence' ? 'убрать' : 'снять') : PPE[it.kind] ? 'надеть' : 'взять'}`;
    }
    if (tgt.type === 'mount') {
      const kind = ITEM[held].kind, ms = pm.mountState(tgt.id), at = tgt.id;
      if (!ms.ok) return `${placeText(at, 3)}: ${lowFirst(ms.text)}`;
      const to = placeText(at, 0);
      const verb = kind === 'uvn' ? `проверить указателем ${placeText(at, 1)}` : kind === 'pz' ? `наложить ПЗ ${to}` : kind === 'lock' ? `запереть ${to.replace(/^на /, '')} на замок`
        : kind === 'fence' ? `поставить ограждение ${to}` : `повесить плакат ${to}`;
      return `${hand === 'desk' ? 'E' : 'Боковая кнопка'} — ${verb}${this.guideNote(held, at)}`;
    }
    if (tgt.type === 'stand') return 'Стенд — положить на место';
    if (tgt.type === 'dev') {
      const el = tr.elOf(tgt.id), sw = tr.sim.st[tgt.id];
      if (!el || !sw) return el ? el.name : '';
      const acts = tr.actions(tgt.id);
      const pos = el.t === 'cart' || el.t === 'cartdisc' ? ` · тележка: ${{ work: 'рабочее', test: 'контрольное', repair: 'ремонтное' }[sw.pos]}` : '';
      return `${el.name}${el.t !== 'cartdisc' ? (sw.on ? ' · включён' : ' · отключён') : ''}${pos} — ${acts.length > 1 ? 'меню' : lowFirst(acts[0] ? acts[0].label : 'переключить')}`;
    }
    if (tgt.type === 'board') return 'Щит с заданием — нажать кнопку';
    // меню: подпись — пункт под прицелом; над заголовком подписи нет, чтобы не закрывать первый пункт
    const b = this.v.menuBtn(tgt.h.uv);
    return b ? b.a.label : '';
  }

  // С «Подсказками мероприятий»: прицел на место того же вида, но не то, — мягко, где ближайшее мероприятие (ошибкой не считается)
  guideNote(id, at) {
    const nx = this.permit.nextMounts(id), run = this.v.app.tr.run;
    if (!nx.length || nx.includes(at)) return '';
    const W = run && run.task.workCell;
    return W && nx.some(a => (parseMount(a) || {}).n === W) ? ` · место работ — яч.${W}` : ` · по порядку — ${placeText(nx[0], 0)}`;
  }

  // ---------- действия ----------
  say(text, level = 'warn') { if (!text) return; this.v.app.toast(text, level); this.v.banner(text, level === 'err' ? 'err' : level === 'warn' ? 'warn' : 'info'); }
  // E, щелчок или курок с предметом в руке; 'pass' — пусть обработает вид (аппарат, щит, меню)
  act(hand, tgt) {
    const held = this.heldIn(hand);
    if (held) {
      if (tgt && tgt.type === 'mount') { this.applyAt(held, tgt.id); return true; }
      if (tgt && tgt.type === 'stand') { this.toHome(this.list.get(held)); Sound.play('grab'); return true; }
      if (tgt && (tgt.type === 'dev' || tgt.type === 'board' || tgt.type === 'menu')) return 'pass';
      this.say(`${ITEM[held].title}: здесь не применить. ${hand === 'desk' ? 'Q — положить.' : 'Боковая кнопка — отпустить.'}`, 'info');
      return true;
    }
    if (tgt && tgt.type === 'item') { this.grab(tgt.id, hand); return true; }
    return 'pass';
  }
  grab(id, hand) {
    const x = this.list.get(id), pm = this.permit;
    if (!x || x.state === 'worn') return false;
    // перчатки и каску надевают сразу, как взяли: без второго нажатия и без поднесения к руке или голове
    if (PPE[x.it.kind]) return this.wear(id);
    const at = pm.itemAt(id);
    this.toHand(x, hand);
    if (at) {
      const r = pm.take(id);
      if (r && r.err) { this.say(r.text); this.sync(); return false; }
    }
    Sound.play('grab');
    return true;
  }
  wear(id) {
    const r = this.permit.wear(id);
    if (r.err) { this.say(r.text); return false; }
    Sound.play('wear');
    return true;
  }
  // Повесить, запереть, наложить, поставить — или коснуться указателем
  applyAt(id, mount) {
    const kind = ITEM[id].kind, pm = this.permit;
    if (kind === 'uvn') { this.touchAt(mount); return; }
    const r = pm.place(id, mount);
    if (!r || r.err) { this.say(r ? r.text : 'Сюда нельзя.'); Sound.play('blocked'); return; }
    if (r.blocked) return;   // замок или блокировка: движок уже сообщил
    Sound.play(kind === 'lock' ? 'lock' : 'hang');
    this.sync();
  }
  touchAt(mount) {
    const r = this.permit.touch(mount);
    if (!r || r.err) { this.say(r ? r.text : 'Указателем касаются токоведущих частей.'); return null; }
    // огонёк и звук — если напряжение есть (звук подаёт приложение по событию проверки)
    if (r.res && r.res.some(q => q.kv != null)) this.lampUntil = performance.now() + 2200;
    return r;
  }
  // Q на ноутбуке, боковая кнопка в шлеме: отпустить — повесить у места, вернуть на стенд или уронить на пол
  release(hand, near) {
    const id = this.heldIn(hand);
    if (!id) return false;
    const x = this.list.get(id);
    if (near && near.type === 'mount' && ITEM[id].kind !== 'uvn') { this.applyAt(id, near.id); if (this.heldIn(hand) !== id) return true; }
    if (near && near.type === 'stand') { this.toHome(x); Sound.play('grab'); return true; }
    const wp = x.obj.getWorldPosition(new this.T.Vector3());
    if (hand === 'desk') {
      const cam = this.v.camera, d = cam.getWorldDirection(new this.T.Vector3());
      wp.copy(cam.getWorldPosition(new this.T.Vector3())).addScaledVector(d.setY(0).normalize(), 0.6);
      wp.y = 0.6;
    }
    // у стенда — на своё место
    const home = this.homeWorld(x);
    if (home && home.distanceTo(wp) < 0.45) { this.toHome(x); Sound.play('grab'); return true; }
    this.toFloor(x, wp);
    return true;
  }
  homeWorld(x) {
    if (x.it.kind === 'fence') return new this.T.Vector3(this.room.fenceHome.x, 0.5, this.room.fenceHome.z);
    const h = this.room.homes[x.id];
    return h ? this.room.stand.localToWorld(new this.T.Vector3(h.p[0], h.p[1], h.p[2])) : null;
  }

  // ---------- шлем ----------
  // Боковая кнопка: пустая рука — взять ближайший предмет (или по лучу), с предметом — отпустить у места
  squeeze(info, rayHits) {
    const hand = info.i, held = this.heldIn(hand);
    if (held) { this.release(hand, this.snapFor(hand, rayHits)); this.preview(null); return true; }
    let best = this.nearest(info.grip.getWorldPosition(new this.T.Vector3()));
    if (!best && rayHits) { const t = this.pick(rayHits, hand, REACH.xr); if (t && t.type === 'item') best = this.list.get(t.id); }
    if (!best) return false;
    this.grab(best.id, hand);
    this.v.pulse(info, 0.5);
    return true;
  }
  // Предмет у руки (шлем): ближе REACH.grab до края; поставленное ограждение — до любой стойки
  nearest(gp) {
    let best = null, bd = REACH.grab;
    for (const x of this.list.values()) {
      if (x.state === 'worn' || x.state === 'hand') continue;
      const d = this.grabDist(x, gp);
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  grabDist(x, gp) {
    const T = this.T;
    if (x.open && x.state === 'mount') {
      let d = Infinity;
      for (const [px, pz] of FENCE.posts) d = Math.min(d, distToSeg(gp, x.open.localToWorld(new T.Vector3(px, 0.05, pz)), x.open.localToWorld(new T.Vector3(px, 1.0, pz))) - 0.05);
      return d;
    }
    // расстояние до края предмета, а не до центра: длинный указатель берут за любую часть
    const c = x.obj.localToWorld(new T.Vector3(x.center[0], x.center[1], x.center[2])), pr = x.proxy.geometry.parameters;
    return c.distanceTo(gp) - Math.max(pr.width, pr.height, pr.depth) * 0.35;
  }
  // Невидимая коробка предмета сейчас ловится (у ограждения — сложенного или поставленного)
  proxyOn(o) { const u = o.userData, x = this.list.get(u.item); return !!x && (!u.part || (u.part === 'open') === (x.state === 'mount')); }
  // Подсветка предмета под прицелом, лучом или у руки: весь предмет чуть светится (материалы — копии с подсветкой, вызовов не прибавляется)
  hover(id) {
    if (this.hot === id) return;
    if (this.hot && this.list.has(this.hot)) this.tint(this.list.get(this.hot), false);
    this.hot = id || null;
    if (this.hot && this.list.has(this.hot)) this.tint(this.list.get(this.hot), true);
  }
  tint(x, on) {
    x.obj.traverse(o => {
      if (!o.isMesh || o.userData.proxy || o === x.lamp) return;
      if (on && !o.userData.mat0) { o.userData.mat0 = o.material; o.material = this.hotMat(o.material); }
      else if (!on && o.userData.mat0) { o.material = o.userData.mat0; delete o.userData.mat0; }
    });
  }
  hotMat(m) {
    let h = this.hotMats.get(m);
    if (!h) {
      h = m.clone();
      if (h.emissive) { h.emissive.setHex(C.hot); h.emissiveIntensity = 0.45; }
      else h.color.lerp(new this.T.Color(C.hot), 0.25);
      this.hotMats.set(m, h);
    }
    return h;
  }
  // Курок с предметом в руке: применить по лучу (надеть, повесить, коснуться); иначе — обычный курок
  select(info, rayHits) {
    const hand = info.i, held = this.heldIn(hand);
    if (!held) return false;
    const t = this.pick(rayHits, hand, REACH.xr), r = this.act(hand, t);
    if (r === 'pass') return false;
    this.v.pulse(info, 0.4);
    return true;
  }
  // Куда повесится предмет, если отпустить сейчас: ближайшее подходящее место у предмета или по лучу
  snapFor(hand, rayHits) {
    const id = this.heldIn(hand);
    if (!id) return null;
    const x = this.list.get(id), kind = ITEM[id].kind;
    if (kind === 'uvn') return null;
    const p = x.obj.localToWorld(new this.T.Vector3(...(x.tip || x.center)));
    let best = null, bd = kind === 'fence' ? 1.2 : REACH.snap;
    const consider = (mid, wp) => { const d = wp.distanceTo(p); if (d < bd) { bd = d; best = { type: 'mount', id: mid, wp }; } };
    const pm = this.permit;
    for (const [mid, m] of this.room.mounts) {
      const mm = parseMount(mid);
      // только места, куда предмет можно повесить сейчас (отсек открыт, тележка выкачена)
      if (!mm || !(TAKES[mm.type] || []).includes(kind) || !pm.mountState(mid).ok) continue;
      const wp = m.obj.localToWorld(new this.T.Vector3(m.p[0], kind === 'fence' ? 0.5 : m.p[1], m.p[2]));
      if (kind === 'fence') p.y = 0.5;
      consider(mid, wp);
    }
    const fm = this.fenceMount();
    if (fm && kind === 'poster') consider('fence', fm.obj.localToWorld(new this.T.Vector3(fm.p[0], fm.p[1], fm.p[2])));
    if (best) return best;
    const t = rayHits ? this.pick(rayHits, hand, REACH.xr) : null;
    if (t && (t.type === 'mount' || t.type === 'stand')) return t;
    const home = this.homeWorld(x);
    if (home && home.distanceTo(p) < 0.4) return { type: 'stand' };
    return null;
  }
  // Каждый кадр в шлеме: коснуться указателем; подсветить место
  xrFrame(ctrls, rays) {
    let prev = null, hot = null;
    for (const info of ctrls) {
      if (!info.src) continue;
      const id = this.heldIn(info.i), hits = rays && rays.get(info);
      if (!id) {
        // пустая рука: подсветить предмет у руки, иначе — под лучом
        const near = this.nearest(info.grip.getWorldPosition(new this.T.Vector3()));
        const t = near || !hits ? null : this.pick(hits, info.i, REACH.xr);
        hot = hot || (near ? near.id : t && t.type === 'item' ? t.id : null);
        continue;
      }
      if (ITEM[id].kind === 'uvn') this.tipTouch(this.list.get(id));
      // призрак — там, куда встанет предмет, если отпустить сейчас (у руки или по лучу), как в release
      const s = this.snapFor(info.i, hits);
      if (!prev && s && s.type === 'mount') prev = { id, at: s.id };
    }
    this.hover(hot);
    this.preview(prev && prev.id, prev && prev.at);
  }
  // Наконечник указателя у контактов: одна проверка на касание, следующая — когда отвели и снова коснулись
  tipTouch(x) {
    const T = this.T, tp = x.obj.localToWorld(new T.Vector3(...x.tip));
    for (const m of this.room.touch) {
      const wp = m.obj.localToWorld(new T.Vector3(m.p[0], m.p[1], m.p[2] - 0.06)), d = wp.distanceTo(tp);
      const was = this.touching.get(m.id);
      if (!was && d < REACH.tip) { this.touching.set(m.id, true); this.touchAt(m.id); }
      else if (was && d > REACH.tip * 1.8) this.touching.set(m.id, false);
    }
  }

  // ---------- предпросмотр: подсветка мест, призрак, метка ближайшего мероприятия ----------
  makePreview() {
    const T = this.T, v = this.v, n = this.room.mounts.size + 1;
    const basic = (c, o) => new T.MeshBasicMaterial(Object.assign({ color: c, transparent: true, depthWrite: false, toneMapped: false }, o));
    this.ghostMat = basic(C.ghost, { opacity: 0.5 });
    this.ghosts = new Map(); this.ghostShown = null;
    this.spots = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), basic(C.spot, { opacity: 0.2 }), n);
    this.marks = new T.InstancedMesh(new T.TorusGeometry(1, 0.06, 6, 40), basic(C.next, { opacity: 0.95 }), n);
    for (const im of [this.spots, this.marks]) {
      im.count = 0; im.visible = false; im.frustumCulled = false; im.raycast = () => {}; im.renderOrder = 6; im.userData.dyn = true;
      v.scene.add(im);
    }
    this.spotIds = []; this.markIds = [];
  }
  // Призрак предмета: его же детали одной сеткой полупрозрачным материалом (у ограждения — поставленная П-образная часть)
  ghostOf(x) {
    const kind = x.it.kind;
    if (this.ghosts.has(kind)) return this.ghosts.get(kind);
    const T = this.T, src = kind === 'fence' ? x.open : x.body, list = [];
    src.updateWorldMatrix(true, true);
    const inv = new T.Matrix4().copy(src.matrixWorld).invert(), m4 = new T.Matrix4();
    src.traverse(o => { if (o.isMesh && !o.userData.proxy && o !== x.lamp) list.push(o); });
    const geo = this.v.joinGeos(list.map(o => { const q = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); q.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)); return q; }));
    const g = new T.Mesh(geo, this.ghostMat);
    g.renderOrder = 7; g.raycast = () => {}; g.visible = false; g.userData.dyn = true;
    this.ghosts.set(kind, g);
    return g;
  }
  // Показать призрак предмета id на месте at (или спрятать: id пустой, указатель, место недоступно)
  preview(id, at) {
    const x = id && at && this.list.get(id);
    const q = x && x.it.kind !== 'uvn' && this.permit.mountState(at).ok ? this.mountPose(x, at, this.freeSlot(at, x)) : null;
    const g = q ? this.ghostOf(x) : null;
    if (this.ghostShown && this.ghostShown !== g) this.ghostShown.visible = false;
    this.ghostShown = g; this.ghostAt = q ? at : null;
    if (!g) return;
    if (g.parent !== q.parent) q.parent.add(g);
    g.position.set(q.p[0], q.p[1], q.p[2]); g.rotation.set(q.r[0], q.r[1], q.r[2]);
    g.visible = true;
  }
  // Каждый кадр: что в руке — места для него (подсветка) и место ближайшего мероприятия (кольцо, пульсирует)
  stepPreview(time) {
    const v = this.v, xr = v.renderer.xr.isPresenting, pm = this.permit;
    const hands = xr ? [0, 1] : v.walk && v.walk.on ? ['desk'] : [];
    const held = hands.map(h => this.heldIn(h)).filter(Boolean);
    if (!xr && !(v.walk && v.walk.on)) this.preview(null);
    this.spotIds = held.length ? [...new Set(held.flatMap(id => pm.mountsFor(id)))] : [];
    this.markIds = held.length ? [...new Set(held.flatMap(id => pm.nextMounts(id)))] : [];
    this.layout(this.spots, this.spotIds, false, 1);
    this.layout(this.marks, this.markIds, true, 1 + 0.1 * Math.sin(time * 0.006));
  }
  layout(im, ids, ring, k) {
    im.count = 0; im.visible = ids.length > 0;
    if (!im.visible) return;
    const T = this.T, m4 = this._m4 || (this._m4 = new T.Matrix4()), s4 = this._s4 || (this._s4 = new T.Matrix4()), r4 = new T.Matrix4();
    for (const id of ids) {
      const px = id === 'fence' ? this.fenceProxy : (this.room.mounts.get(id) || {}).proxy;
      if (!px) continue;
      px.updateWorldMatrix(true, false);
      const g = px.geometry.parameters, floor = g.height < 0.1;
      if (ring) {
        // кольцо вокруг места: на полу — лёжа, тонкое; на ячейке — в плоскости фасада
        if (floor) s4.makeScale(0.5 * k, 0.5 * k, 0.25);
        else s4.makeScale(g.width / 2 * 1.1 * k, g.height / 2 * 1.25 * k, 1);
        m4.multiplyMatrices(px.matrixWorld, floor ? r4.makeRotationX(-Math.PI / 2) : r4.identity()).multiply(s4);
      } else m4.multiplyMatrices(px.matrixWorld, s4.makeScale(g.width * (floor ? 0.72 : 1), floor ? 0.01 : g.height, g.depth * (floor ? 0.92 : 1)));
      im.setMatrixAt(im.count++, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  // Сессия VR закончилась: предметы из рук контроллеров — в руку ноутбука или на пол
  xrEnd() {
    for (const h of [0, 1]) {
      const id = this.hands[h];
      if (!id) continue;
      const x = this.list.get(id);
      if (!this.hands.desk) this.toHand(x, 'desk'); else this.toFloor(x);
    }
    this.preview(null);
  }
  xrStart() {
    const id = this.hands.desk;
    if (id) this.toFloor(this.list.get(id), this.v.camera.getWorldPosition(new this.T.Vector3()));
  }

  // ---------- каждый кадр ----------
  step(dt, time) {
    this.stepPreview(time);
    for (const x of this.list.values()) {
      if (!x.fall) continue;
      x.fall.v += 9.8 * dt; x.fall.y = Math.max(x.fall.to, x.fall.y - x.fall.v * dt);
      x.obj.position.y = x.fall.y;
      if (x.fall.y <= x.fall.to) x.fall = null;
    }
    const u = this.list.get('uvn');
    if (u && u.lamp) {
      const on = performance.now() < this.lampUntil && Math.floor(time / 120) % 2 === 0;
      u.lamp.material.color.setHex(on ? C.lampOn : C.lampOff);
    }
  }
  dispose() {
    this.hover(null);
    for (const g of this.ghosts.values()) { if (g.parent) g.parent.remove(g); g.geometry.dispose(); }
    for (const im of [this.spots, this.marks]) { this.v.scene.remove(im); im.geometry.dispose(); im.material.dispose(); }
    this.ghostMat.dispose();
    for (const m of this.hotMats.values()) m.dispose();
    this.gloveGrips(true);
    for (const x of this.list.values()) if (x.obj.parent) x.obj.parent.remove(x.obj);
  }
}
const lowFirst = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;

export { Items };
