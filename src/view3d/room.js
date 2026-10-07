/* ===== VR-полигон: помещение ЗРУ-10 кВ =====
   buildRoom(v, s, topo) строит по схеме с s.room: стены, пол, потолок со светильниками, дверь, плакаты на стенах,
   ячейки КРУ в ряд (корпус, выкатная тележка, ЗН, лампы положения и ИНН, разъёмные контакты в отсеке тележки),
   шины над ячейками, у входа — стенд со средствами защиты и табличка «Как брать предметы», место щита с заданием.
   Модели — из кубов и цилиндров, как вся сцена; неподвижное потом сливается по материалам (view3d.mergeStatic).
   Устройства ячеек — записи в v.dev (тележка, ЗН): их двигает общий цикл view3d (slide по z, lever по z, pivot, лампы).
   Возвращает room: места для предметов (mounts), зоны ограждения, препятствия для ходьбы, точку входа, стенд, щит.

   Координаты (м): x — вдоль ряда ячеек, z — от задней стены к двери (+z — в коридор), y — вверх.
   Ячейка: начало — середина лицевой стороны на полу; тележка внизу (отсек на всю высоту до 1,5 м), выше — полоса
   с номером, ещё выше — дверь релейного отсека с лампами и ключом управления; ЗН — рукоятка на правой стойке. */
const CW = 0.9, CD = 1.4, CH = 2.3;               // ячейка КРУ: ширина, глубина, высота
const ZF = -1.15;                                  // лицевая сторона ряда
const R = { x0: -4.6, x1: 4.6, z0: -2.7, z1: 3.4, h: 3.6 };
const OUT = { work: 0, test: 0.3, repair: 2.0 };   // насколько выдвинута тележка, м
const DOOR = { x0: 2.4, x1: 3.5, h: 2.1 };
const STAND = { x: R.x1, z: 2.0 };                 // стенд на правой стене у входа
const CONTACT = { up: 1.3, lo: 0.95, z: -0.85 };   // разъёмные контакты в отсеке тележки
const COL = { live: 0xff6a00 };

// Материалы помещения: добавляются к общим материалам вида (v.M) один раз
function roomMats(v) {
  const T = v.kit.T, M = v.M;
  if (M.rFloor) return M;
  const S = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0.05 }, o));
  const tex = (w, h, draw, rep) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    return t;
  };
  // пол: бетон с плиткой, полосы — разметка и стыки
  const floor = tex(256, 256, (x, w, h) => {
    x.fillStyle = '#9a9c97'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const g = 135 + Math.floor(Math.random() * 40); x.fillStyle = `rgb(${g},${g + 1},${g - 3})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(70,72,68,0.45)'; x.lineWidth = 3; x.strokeRect(0, 0, w, h);
  }, [(R.x1 - R.x0) / 1.2, (R.z1 - R.z0) / 1.2]);
  // контур заземления: жёлто-зелёные полосы
  const gstrip = tex(128, 16, (x, w, h) => {
    x.fillStyle = '#1f9a3c'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f2d21a';
    for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, h); x.lineTo(i * 16 + 8, h); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 8, 0); x.closePath(); x.fill(); }
  }, [12, 1]);
  Object.assign(M, {
    rFloor: S(0xffffff, { map: floor, roughness: 0.95 }), rMat: S(0x2a2d2c, { roughness: 1 }), rLine: S(0xf2c318, { roughness: 0.7 }),
    rWall: S(0xe6e2d6, { roughness: 0.95 }), rWallLow: S(0x8fa5a0, { roughness: 0.9 }), rWallF: S(0xe6e2d6, { roughness: 0.95 }),
    rCeil: S(0xd9d7cf, { roughness: 1 }), rLampBox: S(0xc9ccc8, { metalness: 0.3 }), rTube: new T.MeshBasicMaterial({ color: 0xfafcff, toneMapped: false }),
    rDoor: S(0x58707a, { metalness: 0.35, roughness: 0.55 }), rGstrip: S(0xffffff, { map: gstrip, roughness: 0.6 }),
    rKruDoor: S(0xbcc3bd, { metalness: 0.05, roughness: 0.8 }), rCavity: S(0x262b2a, { roughness: 0.9 }), rShutter: S(0xb8432e, { roughness: 0.6 }),
    rTrolley: S(0xa9b2ad, { metalness: 0.05, roughness: 0.85 }), rPole: S(0x5b3328, { roughness: 0.5 }), rCopper: S(0xc8823e, { metalness: 0.6, roughness: 0.35 }),
    rStand: S(0x50646f, { roughness: 0.7 }), rShelf: S(0x8b6b4a, { roughness: 0.8 }), rRed: S(0xc8202c, { roughness: 0.45 }),
  });
  return M;
}

// Табличка из атласа: один холст на все надписи помещения, каждая плоскость берёт свой кусок
function makeAtlas(v) {
  const T = v.kit.T, W = 1024, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), regions = {};
  const F = (w, s) => `${w} ${s}px "Golos Text", system-ui, sans-serif`;
  const area = (k, X, Y, w, h, draw) => { x.save(); x.translate(X, Y); draw(w, h); x.restore(); regions[k] = [X / W, 1 - (Y + h) / H, (X + w) / W, 1 - Y / H]; };
  const center = (t, cx, y, font, color) => { x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.fillText(t, cx, y); x.textAlign = 'left'; };
  // однолинейная схема ЗРУ на левой стене
  area('scheme', 0, 0, 512, 320, (w, h) => {
    x.fillStyle = '#f6f4ec'; x.fillRect(0, 0, w, h); x.strokeStyle = '#2d3b9a'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    center('ЗРУ-10 кВ · 1С-10', w / 2, 44, F(700, 30), '#1b2330');
    x.strokeStyle = '#8a3cae'; x.lineWidth = 8; x.beginPath(); x.moveTo(40, 120); x.lineTo(w - 40, 120); x.stroke();
    x.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const cx = 70 + i * 74;
      x.strokeStyle = '#1b2330'; x.beginPath(); x.moveTo(cx, i === 0 ? 70 : 120); x.lineTo(cx, i === 0 ? 120 : 230); x.stroke();
      x.fillStyle = i === 2 ? '#cf2538' : '#ffffff'; x.fillRect(cx - 14, i === 0 ? 82 : 150, 28, 28); x.strokeRect(cx - 14, i === 0 ? 82 : 150, 28, 28);
      center(String(i + 1), cx, 280, F(700, 26), '#1b2330');
    }
    center('ячейки КРУ', w / 2, 310, F(500, 20), '#56645e');
  });
  // обязательные знаки: перчатки и каска
  const must = (k, X, title, icon) => area(k, X, 320, 256, 340, (w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1a5fb4'; x.beginPath(); x.arc(w / 2, 110, 92, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; icon(w / 2, 110);
    x.fillStyle = '#1b2330'; x.font = F(700, 26); x.textAlign = 'center';
    title.forEach((t, i) => x.fillText(t, w / 2, 250 + i * 32)); x.textAlign = 'left';
  });
  must('gloves', 512, ['Работать', 'в диэлектрических', 'перчатках'], (cx, cy) => {
    x.beginPath(); x.moveTo(cx - 36, cy + 60); x.lineTo(cx - 36, cy - 10); x.lineTo(cx - 52, cy - 34); x.lineTo(cx - 40, cy - 44); x.lineTo(cx - 26, cy - 22);
    for (let i = 0; i < 4; i++) { x.lineTo(cx - 22 + i * 16, cy - 64); x.lineTo(cx - 12 + i * 16, cy - 64); x.lineTo(cx - 10 + i * 16, cy - 22); }
    x.lineTo(cx + 36, cy - 10); x.lineTo(cx + 36, cy + 60); x.closePath(); x.fill();
  });
  must('helmet', 768, ['Работать', 'в защитной', 'каске'], (cx, cy) => {
    x.beginPath(); x.arc(cx, cy + 20, 58, Math.PI, 0); x.fill(); x.fillRect(cx - 78, cy + 16, 156, 16); x.fillRect(cx - 8, cy - 46, 16, 30);
  });
  // выход, стенд, ЗРУ
  area('exit', 0, 320, 256, 100, (w, h) => { x.fillStyle = '#138a3e'; x.fillRect(0, 0, w, h); center('ВЫХОД', w / 2, 68, F(700, 46), '#ffffff'); });
  area('standHead', 0, 430, 512, 80, (w, h) => { x.fillStyle = '#21303a'; x.fillRect(0, 0, w, h); center('Средства защиты и плакаты', w / 2, 52, F(700, 34), '#ffffff'); });
  // табличка «Как брать предметы» — над стендом (то же обучение, что при первом входе)
  area('howto', 0, 660, 1024, 364, (w, h) => {
    x.fillStyle = '#14201b'; x.fillRect(0, 0, w, h); x.fillStyle = '#3b4fd1'; x.fillRect(0, 0, w, 10);
    x.font = F(700, 40); x.fillStyle = '#ffffff'; x.fillText('Как брать предметы', 36, 66);
    const steps = [
      ['1', 'Подойдите к стенду: ходьба — стик или WASD, переход — курок по полу.'],
      ['2', 'Шлем: поднесите руку к предмету, боковая кнопка — взять, ещё раз — отпустить или повесить. Ноутбук: E — взять и применить, Q — положить.'],
      ['3', 'Перчатки — к другой руке, каску — к голове (E на ноутбуке). Указателем коснитесь нижних контактов в отсеке тележки.'],
    ];
    let y = 116;
    for (const [n, t] of steps) {
      x.fillStyle = '#3b4fd1'; x.beginPath(); x.arc(58, y + 6, 24, 0, Math.PI * 2); x.fill();
      center(n, 58, y + 16, F(700, 28), '#ffffff');
      x.font = F(500, 27); x.fillStyle = '#e8efe9';
      const words = t.split(' '); let line = '', ly = y + 14;
      for (const wd of words) { const tt = line ? line + ' ' + wd : wd; if (x.measureText(tt).width > w - 140 && line) { x.fillText(line, 100, ly); ly += 34; line = wd; } else line = tt; }
      if (line) x.fillText(line, 100, ly);
      y = ly + 46;
    }
  });
  // номера ячеек на полосе над тележкой
  for (let i = 0; i < 6; i++) area('n' + (i + 1), 512 + i * 80, 0, 80, 80, (w, h) => {
    x.fillStyle = '#f2f2ea'; x.fillRect(0, 0, w, h); x.strokeStyle = '#1b2330'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    center(String(i + 1), w / 2, 58, F(700, 50), '#1b2330');
  });
  area('zru', 512, 160, 384, 110, (w, h) => { x.fillStyle = '#21303a'; x.fillRect(0, 0, w, h); center('ЗРУ-10 кВ', w / 2, 72, F(700, 52), '#ffffff'); });
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  const mat = new T.MeshBasicMaterial({ map: t, toneMapped: false }), matF = new T.MeshBasicMaterial({ map: t, toneMapped: false });
  // плоскость w×h с куском атласа k
  const plane = (k, w, h, m = mat) => {
    const g = new T.PlaneGeometry(w, h), uv = g.attributes.uv, r = regions[k];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? r[2] : r[0], uv.getY(i) ? r[3] : r[1]);
    return new T.Mesh(g, m);
  };
  return { plane, mat, matF };
}

function buildRoom(v, s, topo) {
  const T = v.kit.T, M = roomMats(v), k = v.kit, root = v.root, cells = s.room.cells;
  const atlas = makeAtlas(v), add = (o, parent = root) => { parent.add(o); return o; };
  const put = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; return add(m); };
  const W = R.x1 - R.x0, D = R.z1 - R.z0, cx0 = (R.x0 + R.x1) / 2, cz0 = (R.z0 + R.z1) / 2;
  const hideTop = new Set([M.rCeil, M.rWallF, M.rLampBox, M.rTube, M.rDoor, atlas.matF]);

  // ---------- пол, стены, потолок, свет ----------
  const floor = new T.Mesh(new T.PlaneGeometry(W, D), M.rFloor);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx0, 0, cz0); floor.userData.ground = true;
  add(floor); v.pickables.push(floor);
  // стены: внутренние грани — по границам помещения; передняя — с дверным проёмом
  const t = 0.12;
  add(k.box(W + 2 * t, R.h, t, M.rWall, cx0, R.h / 2, R.z0 - t / 2));
  add(k.box(t, R.h, D, M.rWall, R.x0 - t / 2, R.h / 2, cz0));
  add(k.box(t, R.h, D, M.rWall, R.x1 + t / 2, R.h / 2, cz0));
  add(k.box(DOOR.x0 - R.x0 + t, R.h, t, M.rWallF, (R.x0 - t + DOOR.x0) / 2, R.h / 2, R.z1 + t / 2));
  add(k.box(R.x1 + t - DOOR.x1, R.h, t, M.rWallF, (DOOR.x1 + R.x1 + t) / 2, R.h / 2, R.z1 + t / 2));
  add(k.box(DOOR.x1 - DOOR.x0, R.h - DOOR.h, t, M.rWallF, (DOOR.x0 + DOOR.x1) / 2, (DOOR.h + R.h) / 2, R.z1 + t / 2));
  // панель стен снизу (крашеная) и контур заземления
  const low = 1.2, ts = 0.015;
  add(k.box(W, low, ts, M.rWallLow, cx0, low / 2, R.z0 + ts / 2));
  add(k.box(ts, low, D, M.rWallLow, R.x0 + ts / 2, low / 2, cz0));
  add(k.box(ts, low, D, M.rWallLow, R.x1 - ts / 2, low / 2, cz0));
  add(k.box(W, 0.04, 0.012, M.rGstrip, cx0, 0.32, R.z0 + 0.03));
  add(k.box(0.012, 0.04, D, M.rGstrip, R.x0 + 0.03, 0.32, cz0));
  add(k.box(0.012, 0.04, D - 2.6, M.rGstrip, R.x1 - 0.03, 0.32, cz0 - 1.3));
  // потолок и светильники
  const ceil = new T.Mesh(new T.PlaneGeometry(W, D), M.rCeil);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx0, R.h, cz0); add(ceil);
  for (const lz of [-0.6, 1.9]) for (const lx of [-3, 0, 3]) {
    add(k.box(1.3, 0.07, 0.24, M.rLampBox, lx, R.h - 0.035, lz));
    add(k.box(1.22, 0.025, 0.14, M.rTube, lx, R.h - 0.08, lz));
  }
  // дверь, табличка «Выход», огнетушитель
  add(k.box(DOOR.x1 - DOOR.x0 - 0.04, DOOR.h - 0.03, 0.05, M.rDoor, (DOOR.x0 + DOOR.x1) / 2, (DOOR.h - 0.03) / 2, R.z1 + 0.03));
  add(k.box(0.04, 0.16, 0.05, M.galv, DOOR.x1 - 0.15, 1.0, R.z1 - 0.01));
  put(atlas.plane('exit', 0.42, 0.16, atlas.matF), (DOOR.x0 + DOOR.x1) / 2, DOOR.h + 0.18, R.z1 - 0.005, Math.PI);
  add(k.cyl(0.08, 0.5, M.rRed, DOOR.x0 - 0.3, 0.3, R.z1 - 0.12));
  add(k.cyl(0.03, 0.08, M.dark, DOOR.x0 - 0.3, 0.6, R.z1 - 0.12));
  // плакаты на стенах: схема ЗРУ, обязательные знаки, надпись над ячейками
  put(atlas.plane('scheme', 1.6, 1.0), R.x0 + 0.01, 1.75, 0.6, Math.PI / 2);
  put(atlas.plane('gloves', 0.5, 0.66), R.x0 + 0.01, 1.6, 2.1, Math.PI / 2);
  put(atlas.plane('helmet', 0.5, 0.66), R.x0 + 0.01, 1.6, 2.75, Math.PI / 2);
  put(atlas.plane('zru', 1.4, 0.4), 0, 3.15, R.z0 + 0.01);

  // ---------- ячейки КРУ ----------
  const n = cells.length, rowX0 = -n * CW / 2;
  const busNode = cells[0].up != null ? topo.wireNode.get(cells[0].up) : null, busMat = busNode != null ? v.nodeMat(busNode) : M.galv;
  const mounts = new Map(), zones = new Map(), touch = [], obstacles = [], out = [];
  const proxyMat = v._proxyMat || (v._proxyMat = new T.MeshBasicMaterial({ color: 0xffffff }));
  const proxy = (parent, w, h, d, x, y, z, data) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), proxyMat);
    m.position.set(x, y, z); m.visible = false; Object.assign(m.userData, data, { proxy: true });
    parent.add(m); v.pickables.push(m);
    return m;
  };
  // место для предметов: obj — родитель (ячейка или тележка), p — точка, ry — поворот плаката; slots — смещения следующих
  const mount = (id, obj, p, ry, o = {}) => {
    const mt = Object.assign({ id, obj, p, ry, slot: [0.025, -0.045, 0.004] }, o);
    mounts.set(id, mt);
    mt.proxy = proxy(obj, o.pw || 0.36, o.ph || 0.26, o.pd || 0.12, p[0], p[1], p[2], { mount: id });
    return mt;
  };
  cells.forEach((c, i) => {
    const x = rowX0 + CW * (i + 0.5), g = k.group(x, 0, ZF), cn = c.n;
    add(g);
    // корпус: задняя часть (шинный и кабельный отсеки), стойки, верх (релейный отсек), отсек тележки внутри тёмный
    g.add(k.box(CW - 0.01, CH, CD - 0.9, M.kru, 0, CH / 2, -0.9 - (CD - 0.9) / 2));
    for (const sx of [-1, 1]) g.add(k.box(0.1, CH, 0.9, M.kru, sx * (CW / 2 - 0.05), CH / 2, -0.45));
    g.add(k.box(CW - 0.2, CH - 1.5, 0.9, M.kru, 0, 1.5 + (CH - 1.5) / 2, -0.45));
    g.add(k.box(CW - 0.2, 1.5, 0.02, M.rCavity, 0, 0.75, -0.89));
    g.add(k.box(CW - 0.2, 0.02, 0.88, M.rCavity, 0, 0.005, -0.45));
    for (const sx of [-1, 1]) g.add(k.box(0.012, 1.48, 0.88, M.rCavity, sx * (CW / 2 - 0.106), 0.75, -0.45));
    g.add(k.box(CW - 0.2, 0.012, 0.88, M.rCavity, 0, 1.494, -0.45));
    // лицевые детали: дверь релейного отсека, полоса с номером, ручка
    g.add(k.box(CW - 0.06, 0.56, 0.02, M.rKruDoor, 0, 2.0, 0.01));
    g.add(k.box(0.025, 0.12, 0.035, M.handle, CW / 2 - 0.07, 1.98, 0.035));
    g.add(k.box(CW - 0.2, 0.2, 0.012, M.rKruDoor, 0, 1.6, 0.006));
    const num = atlas.plane('n' + Math.min(cn, 6), 0.12, 0.12); num.position.set(-0.27, 1.6, 0.014); g.add(num);
    g.add(k.cyl(0.035, 0.03, M.dark, 0.33, 2.15, 0.03, 'z'));                         // ключ управления
    g.add(k.box(0.012, 0.06, 0.02, M.handle, 0.33, 2.15, 0.05));
    // лампы: ВКЛ (красная), ОТКЛ (зелёная), ИНН — наличие напряжения на линейной стороне (три фазы)
    const dc = { el: s.els.find(e => e.id === c.cart), group: g, kind: 'cart', trip: false, lamps: [], cell: c, mod: c.kind === 'vt' ? CARTDISC : CART };
    dc.lamps.push({ p: [-0.33, 2.2, 0.03], s: 0.022, role: 'on' }, { p: [-0.26, 2.2, 0.03], s: 0.022, role: 'off' });
    for (let j = 0; j < 3; j++) dc.lamps.push({ p: [-0.13 + j * 0.06, 2.2, 0.03], s: 0.016, role: 'live' });
    dc.liveTerm = c.kind === 'input' ? 0 : 1;
    // разъёмные контакты в глубине отсека: верхние — шины (за шторкой), нижние — линия
    const loNode = c.lo != null ? topo.wireNode.get(c.lo) : null, loMat = loNode != null ? v.nodeMat(loNode) : M.galv;
    for (let j = -1; j <= 1; j++) {
      g.add(k.cyl(0.03, 0.12, busMat, j * 0.2, CONTACT.up, CONTACT.z + 0.02, 'z'));
      g.add(k.cyl(0.03, 0.12, loMat, j * 0.2, CONTACT.lo, CONTACT.z + 0.02, 'z'));
    }
    g.add(k.box(CW - 0.24, 0.2, 0.012, M.rShutter, 0, CONTACT.up, CONTACT.z + 0.11));
    // тележка: лицевая панель видна всегда, начинка — когда тележка выдвинута (экономия вызовов отрисовки)
    const slide = k.group(0, 0, 0), front = k.group(), inner = k.group();
    slide.add(front, inner); g.add(slide);
    front.add(k.box(CW - 0.22, 1.44, 0.025, M.rTrolley, 0, 0.76, 0));
    front.add(k.box(0.16, 0.06, 0.012, M.dark, 0, 1.28, 0.016));
    front.add(k.cyl(0.03, 0.025, M.dark, 0, 0.36, 0.02, 'z'));
    front.add(k.box(0.42, 0.03, 0.035, M.dark, 0, 1.38, 0.03));
    dc.lamps.push({ p: [-0.2, 1.12, 0.02], s: 0.024, role: 'btnOn', slide: true }, { p: [-0.2, 1.02, 0.02], s: 0.024, role: 'btnOff', slide: true });
    inner.add(k.box(CW - 0.24, 0.08, 0.82, M.dark, 0, 0.14, -0.43));
    for (const wx of [-0.27, 0.27]) for (const wz of [-0.14, -0.72]) inner.add(k.cyl(0.055, 0.04, M.dark, wx, 0.06, wz, 'x'));
    if (c.kind === 'vt') {
      for (const bx of [-0.15, 0.15]) inner.add(k.box(0.24, 0.42, 0.34, M.tank, bx, 0.42, -0.34));
      for (let j = -1; j <= 1; j++) inner.add(k.cyl(0.035, 0.3, M.porcelain, j * 0.2, 1.0, -0.55));
    } else {
      inner.add(k.box(CW - 0.3, 0.6, 0.42, M.rTrolley, 0, 0.5, -0.3));
      for (let j = -1; j <= 1; j++) inner.add(k.cyl(0.05, 0.62, M.rPole, j * 0.2, 1.02, -0.62));
    }
    for (let j = -1; j <= 1; j++) for (const cy of [CONTACT.up, CONTACT.lo]) inner.add(k.cyl(0.02, 0.2, M.rCopper, j * 0.2, cy, -0.76, 'z'));
    inner.visible = false;
    Object.assign(dc, { slide, slideAxis: 'z', slideX: 0, slideT: 0, inner, merge: [front, inner], fxY: 1.1, labelPos: [0, CH + 0.62 + (i % 2) * 0.2, 0.1], labelText: `Яч.${cn} · ${c.title}`, labelH: 0.17 });
    if (dc.el) v.dev.set(c.cart, dc);
    proxy(front, CW - 0.2, 1.44, 0.08, 0, 0.76, 0.02, { dev: c.cart });
    proxy(g, 0.14, 0.14, 0.1, 0.33, 2.15, 0.04, { dev: c.cart });
    // ЗН: рукоятка на правой стойке, ножи — к нижним контактам (видны в открытом отсеке)
    let dz = null;
    if (c.earth && s.els.some(e => e.id === c.earth)) {
      const zg = k.group(CW / 2 - 0.05, 1.05, 0.03);
      g.add(zg);
      zg.add(k.cyl(0.04, 0.03, M.dark, 0, 0, 0, 'z'));
      const lever = k.group(0, 0, 0.02);
      lever.add(k.box(0.03, 0.22, 0.025, M.handle, 0, -0.1, 0));
      zg.add(lever);
      const pivot = k.group(0, 0.78, CONTACT.z + 0.06);
      pivot.add(k.box(CW - 0.3, 0.025, 0.025, M.earthBlade, 0, 0, 0));
      for (let j = -1; j <= 1; j++) pivot.add(k.box(0.02, 0.17, 0.02, M.earthBlade, j * 0.2, 0.085, 0));
      g.add(pivot);
      dz = { el: s.els.find(e => e.id === c.earth), group: zg, kind: 'earth', trip: false, lamps: [{ p: [0, 0.16, 0.01], s: 0.02 }], mod: ZN,
             lever, leverAxis: 'z', leverT: 0.9, pivot, ang: -1.3, angT: -1.3, closedAng: 0, openAng: -1.3, fxY: 1.0 };
      lever.rotation.z = 0.9; pivot.rotation.x = -1.3; pivot.visible = false;
      v.dev.set(c.earth, dz);
      proxy(zg, 0.12, 0.34, 0.1, 0, -0.06, 0.02, { dev: c.earth });
    }
    dc.zn = dz;
    // места для предметов
    mount(`drive:${cn}`, g, [0.19, 1.93, 0.03], 0, { lock: [-CW / 2 + 0.05, 1.06, 0.05] });
    mount(`door:${cn}`, g, [-0.19, 1.93, 0.03], 0);
    if (dz) mount(`earth:${cn}`, g, [0.17, 1.6, 0.03], 0, { pw: 0.34, ph: 0.2 });
    mount(`cart:${cn}`, front, [0, 0.8, 0.04], 0, { pw: 0.5, ph: 0.4, slot: [0, -0.24, 0.003] });
    mount(`shutter:${cn}`, g, [0, CONTACT.up, CONTACT.z + 0.13], 0, { pw: 0.6, ph: 0.24 });
    const ct = mount(`contact:${cn}:lo`, g, [0, CONTACT.lo, CONTACT.z + 0.08], 0, { pw: 0.62, ph: 0.14, pd: 0.22, touch: true });
    mount(`contact:${cn}:up`, g, [0, CONTACT.up, CONTACT.z + 0.08], 0, { pw: 0.62, ph: 0.14, pd: 0.18, touch: true });
    touch.push(ct);
    // пол перед ячейкой — место ограждения
    zones.set(cn, { x, x0: x - 0.6, x1: x + 0.6, z0: ZF + 0.15, z1: ZF + 2.6 });
    mount(`zone:${cn}`, g, [0, 0.03, 1.35], 0, { pw: 1.1, ph: 0.06, pd: 2.4, floor: true });
    out.push({ n: cn, x, group: g, dev: dc, zn: dz, c });
  });
  // коврики, разметка зоны выкатки, шины над ячейками
  add(k.box(n * CW, 0.012, 0.9, M.rMat, 0, 0.006, ZF + 0.5));
  add(k.box(n * CW, 0.006, 0.05, M.rLine, 0, 0.004, ZF + 2.65));
  const busY = CH + 0.36, bz = ZF - CD / 2;
  for (const dzb of [-0.22, 0, 0.22]) add(k.box(n * CW + 0.1, 0.08, 0.012, busMat, 0, busY, bz + dzb));
  for (let i = 0; i < n; i++) for (const dzb of [-0.22, 0, 0.22]) {
    const x = rowX0 + CW * (i + 0.5);
    add(k.cyl(0.028, 0.26, M.porcelain, x, CH + 0.17, bz + dzb));
    add(k.box(0.012, 0.3, 0.012, busMat, x, CH + 0.2, bz + dzb + 0.03));
  }
  add(k.box(n * CW, 0.04, 0.05, M.galv, 0, CH + 0.02, bz - 0.33));
  add(k.box(n * CW, 0.04, 0.05, M.galv, 0, CH + 0.02, bz + 0.33));
  // ввод от Т1: шинный короб из ячейки 1 в стену
  const inCell = out.find(o => o.c.kind === 'input');
  if (inCell) {
    add(k.box(0.5, R.h - CH - 0.05, 0.5, M.kru, inCell.x, CH + (R.h - CH) / 2, bz));
    put(atlas.plane('zru', 0.42, 0.12), inCell.x, 3.05, bz + 0.26);
  }
  obstacles.push({ x0: rowX0 - 0.02, x1: -rowX0 + 0.02, z0: ZF - CD - 0.1, z1: ZF + 0.02 });
  if (inCell) obstacles.push({ x0: inCell.x - 0.3, x1: inCell.x + 0.3, z0: bz - 0.3, z1: bz + 0.3 });

  // ---------- стенд со средствами защиты (правая стена у входа) ----------
  const st = k.group(STAND.x, 0, STAND.z);
  st.rotation.y = -Math.PI / 2;   // местная +z — в помещение (мировая −x), местная +x — к двери (мировая +z)
  add(st);
  st.add(k.box(2.0, 1.75, 0.04, M.rStand, 0, 1.05, 0.03));
  st.add(k.box(2.0, 0.03, 0.32, M.rShelf, 0, 1.12, 0.18));
  for (const sx of [-0.9, 0, 0.9]) st.add(k.box(0.03, 0.18, 0.28, M.rShelf, sx, 1.03, 0.16));
  for (const [hx, hy] of [[0.8, 1.62], [0.3, 1.62], [-0.35, 1.44], [-0.75, 1.44]]) st.add(k.cyl(0.012, 0.08, M.galv, hx, hy, 0.09, 'z'));
  for (const py of [0.98, 0.68]) for (const hx of [-0.65, 0, 0.65]) st.add(k.cyl(0.008, 0.05, M.galv, hx, py, 0.07, 'z'));
  const head = atlas.plane('standHead', 1.6, 0.25); head.position.set(0, 2.06, 0.055); st.add(head);
  const how = atlas.plane('howto', 1.7, 0.6); how.position.set(0, 2.62, 0.035); st.add(how);
  proxy(st, 2.0, 1.6, 0.36, 0, 1.0, 0.2, { stand: true });
  obstacles.push({ x0: STAND.x - 0.42, x1: STAND.x + 0.2, z0: STAND.z - 1.02, z1: STAND.z + 1.02 });
  // дома предметов на стенде (местные координаты стенда): [x, y, z], поворот
  const homes = {
    helmet: { p: [0.62, 1.22, 0.19] }, gloves: { p: [0.18, 1.17, 0.2] }, lock: { p: [-0.28, 1.17, 0.2] },
    // указатель и ПЗ лежат на крюках вдоль стенда (наконечник — к середине)
    uvn: { p: [0.95, 1.66, 0.11], r: [0, Math.PI / 2, 0] }, pz: { p: [-0.22, 1.48, 0.11], r: [0, Math.PI / 2, 0] },
    nevkl1: { p: [-0.65, 0.88, 0.075] }, nevkl2: { p: [0, 0.88, 0.075] }, zazem1: { p: [0.65, 0.88, 0.075] },
    stop1: { p: [-0.65, 0.58, 0.075] }, stop2: { p: [0, 0.58, 0.075] }, work1: { p: [0.65, 0.58, 0.075] },
  };
  const fenceHome = { x: STAND.x - 0.28, z: 0.75 };

  const room = {
    R, ZF, CW, CD, CH, OUT, cells: out, mounts, zones, touch, obstacles, hideTop,
    stand: st, homes, fenceHome,
    start: { x: (DOOR.x0 + DOOR.x1) / 2, z: R.z1 - 0.7, yaw: -0.75 },
    board: { pos: [R.x1 - 0.06, 0.48, -0.25], ry: -Math.PI / 2, scale: 0.6 },
    view: { x: 0, z: 0.3, r: 9 },
    // Тележки, выкаченные в коридор, — тоже препятствия
    blocks() {
      const b = obstacles.slice();
      for (const o of out) {
        const sx = o.dev.slideX || 0;
        if (sx > 0.05) b.push({ x0: o.x - 0.36, x1: o.x + 0.36, z0: ZF + sx - 0.88, z1: ZF + sx + 0.04 });
      }
      return b;
    },
    // Сдвинуть точку (круг радиуса r) из стен и препятствий
    resolve(x, z, r = 0.25) {
      for (let it = 0; it < 3; it++) {
        x = Math.min(R.x1 - r, Math.max(R.x0 + r, x));
        z = Math.min(R.z1 - r, Math.max(R.z0 + r, z));
        for (const b of this.blocks()) {
          const px = Math.min(b.x1, Math.max(b.x0, x)), pz = Math.min(b.z1, Math.max(b.z0, z));
          const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) { const d = Math.sqrt(d2), k2 = (r - d) / d; x += dx * k2; z += dz * k2; }
          else {
            // центр внутри препятствия — выталкиваем к ближайшей грани
            const opts = [[b.x0 - r - x, 0], [b.x1 + r - x, 0], [0, b.z0 - r - z], [0, b.z1 + r - z]];
            opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
            x += opts[0][0]; z += opts[0][1];
          }
        }
      }
      return [x, z];
    },
    walkable(x, z, r = 0.25) {
      if (x < R.x0 + r || x > R.x1 - r || z < R.z0 + r || z > R.z1 - r) return false;
      return !this.blocks().some(b => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
    },
    // Точка эффекта (дуга, «U есть/нет») для аппарата, провода контактов или ПЗ на них
    posOf(id) {
      const wire = String(id).startsWith('pz:') ? String(id).slice(3) : id;
      for (const o of out) {
        const side = o.c.lo === wire ? 'lo' : o.c.up === wire ? 'up' : null;
        if (side) return o.group.localToWorld(new T.Vector3(0, CONTACT[side], CONTACT.z + 0.1));
        if (o.c.cart === id) return o.group.localToWorld(new T.Vector3(0, 1.1, 0.2));
        if (o.c.earth === id) return o.group.localToWorld(new T.Vector3(CW / 2 - 0.05, 1.05, 0.1));
      }
      return null;
    },
  };
  return room;
}

// Обновление устройств ячейки (общий цикл view3d: update → цели анимации, step → движение)
const CART = {
  update(d, s) {
    d.lampState = s.on ? 'on' : 'off';
    d.slideT = OUT[s.pos] != null ? OUT[s.pos] : 0;
    d.live = s.live(d.liveTerm);
  },
};
const CARTDISC = {
  update(d, s) {
    d.lampState = s.pos === 'work' ? 'on' : 'off';
    d.slideT = OUT[s.pos] != null ? OUT[s.pos] : 0;
    d.live = s.live(d.liveTerm);
  },
};
const ZN = {
  update(d, s) {
    d.lampState = s.on ? 'on' : 'off';
    d.leverT = s.on ? -0.9 : 0.9;
    d.angT = s.on ? d.closedAng : d.openAng;
  },
};

export { buildRoom, R as ROOM, ZF, CW, CD, CH, OUT, CONTACT, COL as ROOM_COL };
