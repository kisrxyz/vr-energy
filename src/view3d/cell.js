/* ===== Ячейка КРУ-10 кВ: общий построитель для VR-полигона (room.js) и ЗРУ на площадках (zru.js) =====
   buildCell(v, o) кладёт в o.parent группу ячейки: корпус (задняя часть — шинный и кабельный отсеки, стойки, верх — релейный отсек),
   тёмный отсек тележки на всю высоту до 1,5 м, дверь релейного отсека с мнемосхемой, лампами ВКЛ/ОТКЛ, ИНН и ключом управления;
   разъёмные контакты в глубине отсека (верхние — шины, за шторкой; нижние — линия); выкатную тележку (лицевая панель видна всегда,
   начинка — когда выкачена); ЗН — рукоятка на правой стойке и ножи к нижним контактам.
   Начало ячейки — середина лицевой стороны на полу; местная +z — в коридор. Тележка выдвигается по +z: OUT[положение], м.
   Устройства — записи v.dev (тележка, ЗН): их двигает общий цикл view3d (slide, lever, pivot, лампы). Невидимые коробки — o.proxy.
   Модели — из кубов и цилиндров; неподвижное потом сливается по материалам (view3d.mergeStatic). Цвета — models/kit.js (PAL). */

const CW = 0.9, CD = 1.4, CH = 2.3;                // ячейка: ширина, глубина, высота
const OUT = { work: 0, test: 0.3, repair: 2.0 };   // насколько выдвинута тележка, м
const CONTACT = { up: 1.3, lo: 0.95, z: -0.85 };   // разъёмные контакты в отсеке тележки

// o: { parent, x, z, ry, cart (элемент cart или cartdisc), earth (ЗН или null), kind: 'line' | 'input' | 'vt' | 'disc',
//      busMat, loMat — материалы узлов шин и линии, liveTerm — вывод тележки на стороне линии (ИНН), num — табличка с номером или null,
//      label — подпись над ячейкой, labelY — её высота, proxy(parent, w, h, d, x, y, z, data) — невидимая коробка }
function buildCell(v, o) {
  const k = v.kit, M = v.M, g = k.group(o.x, 0, o.z);
  g.rotation.y = o.ry || 0;
  o.parent.add(g);
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
  // мнемосхема присоединения на двери: линия и выключатель — между местами для плакатов
  g.add(k.box(0.018, 0.46, 0.006, M.mimic, 0, 2.0, 0.023));
  g.add(k.box(0.05, 0.05, 0.006, M.mimic, 0, 2.02, 0.024));
  // табличка с номером: полигон — слева на полосе, ЗРУ — по середине (номер и присоединение, numX = 0)
  if (o.num) { o.num.position.set(o.numX != null ? o.numX : -0.27, 1.6, 0.014); g.add(o.num); }
  g.add(k.cyl(0.035, 0.03, M.dark, 0.33, 2.15, 0.03, 'z'));                         // ключ управления
  g.add(k.box(0.012, 0.06, 0.02, M.handle, 0.33, 2.15, 0.05));
  // лампы: ВКЛ (красная), ОТКЛ (зелёная), ИНН — наличие напряжения на линейной стороне (три фазы)
  const disc = o.cart.t === 'cartdisc';
  const dc = { el: o.cart, group: g, kind: 'cart', trip: false, lamps: [], cell: o.cell || null, mod: disc ? CARTDISC : CART };
  dc.lamps.push({ p: [-0.33, 2.2, 0.03], s: 0.022, role: 'on' }, { p: [-0.26, 2.2, 0.03], s: 0.022, role: 'off' });
  for (let j = 0; j < 3; j++) dc.lamps.push({ p: [-0.13 + j * 0.06, 2.2, 0.03], s: 0.016, role: 'live' });
  dc.liveTerm = o.liveTerm;
  // разъёмные контакты в глубине отсека: верхние — шины (за шторкой), нижние — линия
  for (let j = -1; j <= 1; j++) {
    g.add(k.cyl(0.03, 0.12, o.busMat, j * 0.2, CONTACT.up, CONTACT.z + 0.02, 'z'));
    g.add(k.cyl(0.03, 0.12, o.loMat, j * 0.2, CONTACT.lo, CONTACT.z + 0.02, 'z'));
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
  if (o.kind === 'vt') {
    for (const bx of [-0.15, 0.15]) inner.add(k.box(0.24, 0.42, 0.34, M.tank, bx, 0.42, -0.34));
    for (let j = -1; j <= 1; j++) inner.add(k.cyl(0.035, 0.3, M.porcelain, j * 0.2, 1.0, -0.55));
  } else if (o.kind === 'disc') {
    // тележка разъединителя (СР): три шины-перемычки между верхними и нижними контактами
    inner.add(k.box(CW - 0.3, 0.5, 0.3, M.rTrolley, 0, 0.45, -0.3));
    for (let j = -1; j <= 1; j++) inner.add(k.box(0.04, CONTACT.up - CONTACT.lo + 0.08, 0.04, M.rCopper, j * 0.2, (CONTACT.up + CONTACT.lo) / 2, -0.66));
  } else {
    inner.add(k.box(CW - 0.3, 0.6, 0.42, M.rTrolley, 0, 0.5, -0.3));
    for (let j = -1; j <= 1; j++) inner.add(k.cyl(0.05, 0.62, M.rPole, j * 0.2, 1.02, -0.62));
  }
  for (let j = -1; j <= 1; j++) for (const cy of [CONTACT.up, CONTACT.lo]) inner.add(k.cyl(0.02, 0.2, M.rCopper, j * 0.2, cy, -0.76, 'z'));
  inner.visible = false;
  Object.assign(dc, { slide, slideAxis: 'z', slideX: 0, slideT: 0, inner, merge: [front, inner], fxY: 1.1, labelPos: [0, o.labelY, 0.1], labelText: o.label, labelH: o.labelH || 0.17 });
  v.dev.set(o.cart.id, dc);
  o.proxy(front, CW - 0.2, 1.44, 0.08, 0, 0.76, 0.02, { dev: o.cart.id });
  o.proxy(g, 0.14, 0.14, 0.1, 0.33, 2.15, 0.04, { dev: o.cart.id });
  // ЗН: рукоятка на правой стойке, ножи — к нижним контактам (видны в открытом отсеке)
  let dz = null;
  if (o.earth) {
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
    dz = { el: o.earth, group: zg, kind: 'earth', trip: false, lamps: [{ p: [0, 0.16, 0.01], s: 0.02 }], mod: ZN,
           lever, leverAxis: 'z', leverT: 0.9, pivot, ang: -1.3, angT: -1.3, closedAng: 0, openAng: -1.3, fxY: 1.0 };
    lever.rotation.z = 0.9; pivot.rotation.x = -1.3; pivot.visible = false;
    v.dev.set(o.earth.id, dz);
    o.proxy(zg, 0.12, 0.34, 0.1, 0, -0.06, 0.02, { dev: o.earth.id });
  }
  dc.zn = dz;
  return { g, dc, dz, front };
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

export { buildCell, CW, CD, CH, OUT, CONTACT, CART, CARTDISC, ZN };
