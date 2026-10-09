/* ===== ЗРУ на площадке: ячейки КРУ в здании (РП-10, КРУ-10 ПС 110/35/10, свои схемы) =====
   Движок и 2D не меняются: схема та же, меняется только, где элементы стоят в 3D.
   findKRU(s, topo) — без DOM и three (тест в Node): секции шин КРУ (шина, к которой прямо подключены ≥ 2 тележки) и их ячейки.
     Ячейка — ветка от шины: тележка (cart, cartdisc) и дальше по цепочке ТТ, предохранитель, ЗН, ТН этой ветки — до первого «уличного»
     элемента (КЛ, ВЛ, трансформатор, ТСН, нагрузка, разъединитель или ВН на ТП) — он остаётся на улице (down). Ветка из одного ОПН или ТН
     на шине — ячейка без тележки. Тележка СВ, за ней тележка СР ко второй секции — две ячейки секционирования. Что не распознано — на улице.
   layoutZRU(kru) — без three: две секции — два ряда лицом друг к другу через коридор, СВ и СР — друг напротив друга; номера и подписи.
   buildZRU(v, s, topo, kru, W) — здание: ряды ячеек (cell.js) с табличками «номер · присоединение», шины над рядами, шинный мост СВ—СР
     над коридором; вход в торце с тамбуром (щит с заданием, однолинейная схема, знаки), открытые двери с табличками «ЗРУ-10 кВ»
     и «Стой! Напряжение» в обоих торцах, окна под потолком, светильники; кабельный канал (рифлёные плиты) перед рядами, КЛ — из стены
     за рядом в траншею с плитами к концевой муфте; к трансформатору и ТСН — шинный мост на высоте проводов. */
import { buildCell, CW, CD, CH, CONTACT } from './cell.js';
import { roomMats } from './room.js';
import { MODELS, PAL, makeMaterials } from './models/index.js';

const TROLLEY = { cart: 1, cartdisc: 1 };
const CHAIN = { ct: 1, fuse: 1 };             // проходят через ячейку
const SIDE = { earth: 1, kz: 1 };             // ЗН на узле ячейки
const END = { vt: 1, arrester: 1 };           // один вывод: ТН, ОПН внутри ячейки

function findKRU(s, topo) {
  const byId = new Map(s.els.map(e => [e.id, e]));
  const adj = new Map();
  for (const el of s.els) (topo.term.get(el.id) || []).forEach((n, i) => { if (n == null) return; if (!adj.has(n)) adj.set(n, []); adj.get(n).push({ el, i }); });
  const at = n => adj.get(n) || [];
  const termOf = (el, i) => (topo.term.get(el.id) || [])[i];
  const busNode = new Map();   // узел → шина КРУ
  for (const b of s.els) {
    if (b.t !== 'bus') continue;
    const n = termOf(b, 0);
    if (at(n).filter(a => TROLLEY[a.el.t]).length >= 2) busNode.set(n, b);
  }
  if (!busNode.size) return null;
  const used = new Set(), cells = [];
  const other = (el, i) => termOf(el, 1 - i);
  // Ветка вниз от узла n (пришли по элементу prev): части ячейки и первый уличный элемент
  const walk = (n, prev) => {
    const parts = [], nodes = [n];
    let down = null;
    for (let step = 0; step < 6; step++) {
      const here = at(n).filter(a => a.el !== prev && !used.has(a.el.id));
      let next = null;
      for (const a of here) {
        if (SIDE[a.el.t] || END[a.el.t]) { if (!parts.some(p => p.el.t === a.el.t && SIDE[a.el.t])) parts.push({ el: a.el, role: a.el.t }); }
        else if (CHAIN[a.el.t] && !next) next = a;
        else if (!down && !CHAIN[a.el.t]) down = { el: a.el, i: a.i, node: n };
      }
      if (!next || down) break;
      parts.push({ el: next.el, role: next.el.t });
      prev = next.el; n = other(next.el, next.i);
      if (n == null) break;
      nodes.push(n);
    }
    return { parts, nodes, down };
  };
  for (const [nb, bus] of busNode) {
    for (const a of at(nb)) {
      const el = a.el;
      if (el === bus || used.has(el.id)) continue;
      if (TROLLEY[el.t]) {
        const n1 = other(el, a.i);
        // секционирование: СВ к шине другой секции прямо или через тележку СР
        if (busNode.has(n1) && busNode.get(n1) !== bus) { used.add(el.id); cells.push({ kind: el.t === 'cartdisc' ? 'disc' : 'line', cart: el, bus, liveTerm: 1 - a.i, nodes: [], parts: [], down: null, tie: true, x: el.x }); continue; }
        const via = at(n1).filter(q => q.el !== el);
        const sr = via.length === 1 && TROLLEY[via[0].el.t] && busNode.has(other(via[0].el, via[0].i)) && busNode.get(other(via[0].el, via[0].i)) !== bus ? via[0] : null;
        if (sr) {
          used.add(el.id); used.add(sr.el.id);
          const bus2 = busNode.get(other(sr.el, sr.i));
          cells.push({ kind: el.t === 'cartdisc' ? 'disc' : 'line', cart: el, bus, liveTerm: 1 - a.i, nodes: [n1], parts: [], down: null, tie: true, x: el.x });
          cells.push({ kind: sr.el.t === 'cartdisc' ? 'disc' : 'line', cart: sr.el, bus: bus2, liveTerm: sr.i, nodes: [n1], parts: [], down: null, tie: true, x: sr.el.x });
          continue;
        }
        used.add(el.id);
        const w = walk(n1, el);
        w.parts.forEach(p => used.add(p.el.id));
        const vt = w.parts.some(p => p.el.t === 'vt');
        cells.push({ kind: el.t === 'cartdisc' ? (vt ? 'vt' : 'disc') : 'line', cart: el, bus, liveTerm: 1 - a.i, nodes: w.nodes, parts: w.parts, down: w.down, x: el.x });
      } else if (END[el.t]) {
        used.add(el.id);
        cells.push({ kind: 'aux', cart: null, bus, liveTerm: 0, nodes: [], parts: [{ el, role: el.t }], down: null, x: el.x });
      }
    }
  }
  // ряд — по x схемы (у горизонтальной шины), секции — по шинам
  cells.sort((p, q) => p.x - q.x);
  const inside = new Set([...busNode.values()].map(b => b.id));
  for (const c of cells) { if (c.cart) inside.add(c.cart.id); for (const p of c.parts) inside.add(p.el.id); }
  const nodes = new Set(busNode.keys());
  for (const c of cells) for (const n of c.nodes) nodes.add(n);
  return { cells, buses: [...busNode.values()], busNodes: busNode, inside, nodes, byId };
}

// ---------- раскладка (без three, тест в Node) ----------
// Две секции — два ряда лицом друг к другу через коридор (типовой РП-10 с двухрядным КРУ): секция 1 — ряд A, секция 2 — ряд B;
// СВ и СР — в конце рядов друг напротив друга (у того торца, что дальше от входа), над коридором — перемычка шин.
// Одна секция или больше двух — один ряд по x схемы, как раньше. Номера ячеек — слева направо, как их видит человек
// в коридоре лицом к ряду: ряд A — 1…nA, ряд B — дальше. Подпись — номер и присоединение («5 · Л-3»)
const shortName = n => String(n).replace(/\s*тележка$/i, '').replace(/^В-\d+\s+/, '').replace(/^(СВ|СР)-\d+$/, '$1').replace(/^ОПН-\d+\s+/, 'ОПН ');
function layoutZRU(kru) {
  const cells = kru.cells, two = kru.buses.length === 2;
  const byX = (p, q) => p.x - q.x;
  let rows;
  if (two) {
    const [b0, b1] = kru.buses;
    // ряд A: секция 1, СВ — последней (у дальнего торца); ряд B: секция 2 по схеме с СР первой — в мире наоборот,
    // чтобы СР оказалась напротив СВ (человек, повернувшийся к ряду B, видит её слева, как на схеме)
    const a = cells.filter(c => c.bus === b0).sort((p, q) => (p.tie - q.tie) || byX(p, q));
    const b = cells.filter(c => c.bus === b1).sort((p, q) => (q.tie - p.tie) || byX(p, q)).reverse();
    rows = [{ side: 'A', cells: a, bus: b0 }, { side: 'B', cells: b, bus: b1 }].filter(r => r.cells.length);
  } else rows = [{ side: 'A', cells: cells.slice().sort(byX), bus: null }];
  const L = Math.max(...rows.map(r => r.cells.length));
  let num = 0;
  const out = [];
  for (const r of rows) {
    const n = r.cells.length;
    r.cells.forEach((c, i) => {
      // ряд A: слева направо = по x; ряд B: человек смотрит на −… его «слева направо» — по убыванию x
      const no = r.side === 'A' ? num + i + 1 : num + (n - i);
      out.push({ c, row: r.side, i, slot: L - n + i, no, short: shortName(c.cart ? c.cart.name : c.parts[0].el.name) });
    });
    num += n;
  }
  return { two: rows.length === 2, rows: rows.map(r => r.side), L, cells: out };
}

// ---------- здание ЗРУ и ячейки (three — через v.kit.T) ----------
// Местные координаты здания: x — вдоль рядов (правые концы рядов — у x = L/2, вход с тамбуром — у x = −L/2 − hall),
// z — поперёк: коридор от −corr/2 до +corr/2, ряд A — фасадами в коридор при z = −corr/2, ряд B — при z = +corr/2 (повёрнут на 180°)
const Z = { corr: 3.2, back: 0.6, hall: 3.2, end: 1.2, h: 3.8, t: 0.2, doorW: 1.4, doorH: 2.3 };
const NOP = { update() {} };

function buildZRU(v, s, topo, kru, W) {
  const T = v.kit.T, k = v.kit, M = zruMats(v), root = v.root, lay = layoutZRU(kru), two = lay.two;
  const CWL = lay.L * CW, hc = Z.corr / 2;
  const nm = node => (node != null ? v.nodeMat(node) : M.galv);
  const termOf = (el, i) => (topo.term.get(el.id) || [])[i];
  // где здание: середина рядов — по x ячеек схемы, коридор — по линии первой шины КРУ
  const xs = kru.cells.map(c => W([c.x, 0]).x), b0 = kru.buses[0];
  const g = k.group((Math.min(...xs) + Math.max(...xs)) / 2, 0, W([b0.x, b0.y]).z);
  root.add(g);
  const proxyMat = v._proxyMat || (v._proxyMat = new T.MeshBasicMaterial({ color: PAL.ui.proxy }));
  const proxy = (parent, w, h, d, x, y, z, data) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), proxyMat);
    m.position.set(x, y, z); m.visible = false; Object.assign(m.userData, data, { proxy: true });
    parent.add(m); v.pickables.push(m);
    return m;
  };
  const rec = (el, group, extra) => { const d = Object.assign({ el, group, kind: el.t, trip: false, lamps: [], mod: MODELS[el.t] || NOP, zru: true }, extra); v.dev.set(el.id, d); return d; };
  const zA = -hc - CD - Z.back, zB = two ? hc + CD + Z.back : hc;     // внутренние грани продольных стен
  const xa = -CWL / 2 - Z.hall, xb = CWL / 2 + Z.end;               // внутренние грани торцов: вход с тамбуром — у xa
  const atlas = zruAtlas(v, lay);
  // ---------- ячейки ----------
  const out = [], nodeCell = new Map();
  for (const q of lay.cells) {
    const c = q.c, rowB = q.row === 'B', x = -CWL / 2 + CW * (q.slot + 0.5), z = rowB ? hc : -hc, ry = rowB ? Math.PI : 0, busNode = termOf(c.bus, 0);
    const o = { c, q, x, z, ry, rowB };
    for (const nd of c.nodes) nodeCell.set(nd, o);
    // табличка на фасаде: номер и присоединение
    const plate = atlas.plane('p' + q.no, 0.6, 0.12);
    if (c.cart) {
      const earth = (c.parts.find(p => SIDE[p.el.t]) || {}).el || null;
      const r = buildCell(v, { parent: g, x, z, ry, cart: c.cart, earth, kind: c.kind === 'vt' ? 'vt' : c.kind === 'disc' ? 'disc' : 'line', busMat: nm(busNode),
        loMat: nm(termOf(c.cart, c.liveTerm)), liveTerm: c.liveTerm, num: plate, numX: 0, label: `${q.no} · ${q.short}`, labelY: CH + 0.42, labelH: 0.17, proxy });
      r.dc.zru = true; r.dc.labelLod = 1; if (r.dz) r.dz.zru = true;
      Object.assign(o, r);
    } else {
      // ячейка без тележки (ОПН, ТН на шине): закрытый шкаф
      const cg = k.group(x, 0, z); cg.rotation.y = ry; g.add(cg);
      cg.add(k.box(CW - 0.01, CH, CD, M.kru, 0, CH / 2, -CD / 2));
      cg.add(k.box(CW - 0.06, 1.7, 0.02, M.rKruDoor, 0, 1.15, 0.01));
      cg.add(k.box(0.025, 0.12, 0.035, M.handle, CW / 2 - 0.07, 1.2, 0.035));
      cg.add(k.box(0.018, 0.5, 0.006, M.mimic, 0, 1.7, 0.023));
      plate.position.set(0, 2.15, 0.014); cg.add(plate);
      o.g = cg;
    }
    // ТТ и ТН — в отсеке за тележкой (видны выкаченной), ОПН и ТН ячейки без тележки — за дверью; предохранитель — на двери
    let back = 0;
    for (const p of c.parts) {
      const el = p.el;
      if (SIDE[el.t]) continue;
      if (el.t === 'fuse') {
        const fg = k.group(-0.2, 1.86, 0.03); o.g.add(fg);
        fg.add(k.box(0.22, 0.1, 0.02, M.dark, 0, 0, 0));
        const show = k.group();
        for (let j = -1; j <= 1; j++) show.add(k.cyl(0.012, 0.08, M.porcelain, j * 0.06, 0, 0.018, 'x'));
        fg.add(show);
        rec(el, fg, { show, lamps: [{ p: [0.13, 0, 0.012], s: 0.014 }] });
        proxy(fg, 0.28, 0.14, 0.08, 0, 0, 0.02, { dev: el.id });
        continue;
      }
      const inCart = !!c.cart, y = inCart ? 0.5 - back * 0.28 : 1.0, zz = inCart ? CONTACT.z + 0.12 : 0.06;
      const pg = k.group(0, y, zz); o.g.add(pg);
      if (!inCart) pg.add(k.box(0.2, 0.3, 0.01, M.porcelain, 0, 0.1, 0));
      else if (el.t === 'ct') for (let j = -1; j <= 1; j++) pg.add(k.cyl(0.06, 0.14, M.tank, j * 0.2, 0, 0, 'z'));
      else if (el.t === 'vt') pg.add(k.box(0.5, 0.24, 0.2, M.tank, 0, 0, 0));
      else pg.add(k.cyl(0.04, 0.4, M.porcelain, 0, 0.1, 0));
      rec(el, pg);
      proxy(pg, 0.62, inCart ? 0.24 : 0.8, 0.2, 0, 0, 0, { dev: el.id });
      back++;
    }
    out.push(o);
  }
  // ---------- шины над рядами: по секциям (с ячейками секционирования) ----------
  const busY = CH + 0.36;
  for (const bus of kru.buses) {
    const os = out.filter(o => o.c.bus === bus);
    if (!os.length) continue;
    const rowB = os[0].rowB, bz = rowB ? hc + CD / 2 : -hc - CD / 2, x0 = Math.min(...os.map(o => o.x)) - CW / 2, x1 = Math.max(...os.map(o => o.x)) + CW / 2, len = x1 - x0, mat = nm(termOf(bus, 0));
    const bg = k.group(x0, 0, 0); g.add(bg);
    for (const dzb of [-0.22, 0, 0.22]) bg.add(k.box(len + 0.1, 0.08, 0.012, mat, len / 2, busY, bz + dzb));
    for (const o of os) for (const dzb of [-0.22, 0, 0.22]) {
      const cx = o.x - x0;
      bg.add(k.cyl(0.028, 0.26, M.porcelain, cx, CH + 0.17, bz + dzb));
      bg.add(k.box(0.012, 0.3, 0.012, mat, cx, CH + 0.2, bz + dzb + 0.03));
    }
    rec(bus, bg, { kind: 'bus', labelPos: [0.7, busY + 0.62, bz], labelH: 0.22 });
    proxy(bg, len + 0.1, 0.3, 0.6, len / 2, busY, bz, { dev: bus.id });
  }
  // секционирование: шинный мост над коридором между СВ и СР (два ряда) или перемычка над ячейками (один ряд)
  const ties = out.filter(o => o.c.tie);
  if (ties.length === 2) {
    const mat = nm(ties[0].c.nodes[0]), [p, q] = ties, yb = CH + 0.75;
    if (two && p.rowB !== q.rowB) {
      const za = (p.rowB ? hc : -hc) - (p.rowB ? -1 : 1) * CD / 2, zb = (q.rowB ? hc : -hc) - (q.rowB ? -1 : 1) * CD / 2;
      g.add(k.box(0.36, 0.3, Math.abs(zb - za) + 0.36, M.kru, (p.x + q.x) / 2, yb, (za + zb) / 2));
      for (const o of ties) g.add(k.box(0.36, yb - CH, 0.36, M.kru, o.x, (CH + yb) / 2, (o.rowB ? hc : -hc) + (o.rowB ? 1 : -1) * CD / 2));
      g.add(k.box(0.06, 0.06, Math.abs(zb - za), mat, (p.x + q.x) / 2, yb - 0.17, (za + zb) / 2));
    } else g.add(k.box(Math.abs(q.x - p.x) + 0.1, 0.08, 0.012, mat, (p.x + q.x) / 2, busY + 0.25, -hc - CD / 2));
  }
  // ---------- здание: пол, кабельный канал, стены с дверями, окна, потолок со светильниками ----------
  const BW = xb - xa, BD = zB - zA, t = Z.t, h = Z.h, cx = (xa + xb) / 2, cz = (zA + zB) / 2;
  const floor = new T.Mesh(new T.PlaneGeometry(BW, BD), M.rFloor), uv = floor.geometry.attributes.uv, rep = M.rFloor.map.repeat;
  for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * BW / 1.2 / rep.x, uv.getY(j) * BD / 1.2 / rep.y);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.025, cz); floor.userData.ground = true;
  g.add(floor); v.pickables.push(floor);
  // кабельный канал перед каждым рядом: съёмные рифлёные плиты вдоль фасадов (кабели — вниз из ячеек в канал)
  for (const r of lay.rows) {
    const os = out.filter(o => o.q.row === r), x0 = Math.min(...os.map(o => o.x)) - CW / 2, x1 = Math.max(...os.map(o => o.x)) + CW / 2;
    const zc = r === 'B' ? hc - 0.3 : -hc + 0.3;
    for (let px = x0; px < x1 - 0.01; px += 0.6) g.add(k.box(Math.min(0.6, x1 - px) - 0.02, 0.012, 0.56, M.rPlate, px + Math.min(0.6, x1 - px) / 2, 0.03, zc));
  }
  // разметка: жёлтая линия зоны выкатки по оси коридора
  g.add(k.box(CWL, 0.006, 0.05, M.rLine, 0, 0.032, 0));
  // продольные стены с окнами под потолком (над ячейками), торцы с дверными проёмами в коридор
  const WIN = { y0: 2.75, y1: 3.45, w: 1.4, gap: 1.6 };
  for (const zw of [zA - t / 2, zB + t / 2]) {
    g.add(k.box(BW + 2 * t, WIN.y0, t, M.rWall, cx, WIN.y0 / 2, zw));
    g.add(k.box(BW + 2 * t, h - WIN.y1, t, M.rWall, cx, (WIN.y1 + h) / 2, zw));
    const n = Math.max(1, Math.floor((BW - 0.6) / (WIN.w + WIN.gap))), span = n * WIN.w + (n - 1) * WIN.gap, x0 = cx - span / 2;
    let px = xa - t;
    for (let i = 0; i < n; i++) {
      const wx = x0 + i * (WIN.w + WIN.gap);
      g.add(k.box(wx - px, WIN.y1 - WIN.y0, t, M.rWall, (px + wx) / 2, (WIN.y0 + WIN.y1) / 2, zw));
      g.add(k.box(WIN.w, WIN.y1 - WIN.y0, 0.03, M.rWin, wx + WIN.w / 2, (WIN.y0 + WIN.y1) / 2, zw));
      g.add(k.box(WIN.w, 0.05, t + 0.04, M.galv, wx + WIN.w / 2, WIN.y0, zw));
      px = wx + WIN.w;
    }
    g.add(k.box(xb + t - px, WIN.y1 - WIN.y0, t, M.rWall, (px + xb + t) / 2, (WIN.y0 + WIN.y1) / 2, zw));
  }
  const d0 = -Z.doorW / 2, d1 = Z.doorW / 2;
  for (const xw of [xa - t / 2, xb + t / 2]) {
    g.add(k.box(t, h, d0 - zA, M.rWall, xw, h / 2, (zA + d0) / 2));
    g.add(k.box(t, h, zB - d1, M.rWall, xw, h / 2, (d1 + zB) / 2));
    g.add(k.box(t, h - Z.doorH, d1 - d0, M.rWall, xw, (Z.doorH + h) / 2, 0));
  }
  // двери в торцах — открыты наружу; снаружи над дверью — «ЗРУ-10 кВ», на полотне — «Стой! Напряжение»
  for (const [xw, sx] of [[xa - t, -1], [xb + t, 1]]) {
    const leaf = k.group(xw, 0, d1 - 0.03); leaf.rotation.y = -sx * Math.PI * 0.55; g.add(leaf);
    leaf.add(k.box(0.05, Z.doorH - 0.05, Z.doorW - 0.08, M.rDoor, sx * 0.03, (Z.doorH - 0.05) / 2, -(Z.doorW - 0.08) / 2));
    const st = atlas.plane('stop', 0.36, 0.22); st.position.set(sx * 0.06, 1.55, -(Z.doorW - 0.08) / 2); st.rotation.y = sx * Math.PI / 2; leaf.add(st);
    const nm2 = atlas.plane('zru', 1.1, 0.32); nm2.position.set(xw + sx * 0.02, Z.doorH + 0.42, 0); nm2.rotation.y = sx * Math.PI / 2; g.add(nm2);
  }
  // потолок, светильники вдоль коридора
  g.add(k.box(BW + 2 * t, 0.1, BD + 2 * t, M.rCeil, cx, h + 0.05, cz));
  for (let lx = xa + 1.5; lx < xb - 0.5; lx += 2.6) {
    g.add(k.box(1.3, 0.07, 0.24, M.rLampBox, lx, h - 0.035, 0));
    g.add(k.box(1.22, 0.025, 0.14, M.rTube, lx, h - 0.08, 0));
  }
  // тамбур у входа: щит с заданием на стене (как в полигоне), однолинейная схема РП напротив, знаки «работать в перчатках, в каске»
  const hx = xa + Z.hall / 2;
  g.updateMatrixWorld(true);
  const bp = g.localToWorld(new T.Vector3(hx, 0.45, zA + 0.06));
  const board = v.makeBoard({ pos: [bp.x, bp.y, bp.z], ry: g.rotation.y, scale: 0.55 });
  const sch = atlas.plane('scheme', Math.min(Z.hall - 0.4, 2.8), Math.min(Z.hall - 0.4, 2.8) * 0.36); sch.position.set(hx, 1.75, zB - 0.01); sch.rotation.y = Math.PI; g.add(sch);
  for (const [key, dz] of [['gloves', -1.3], ['helmet', 1.3]]) { const p = atlas.plane(key, 0.42, 0.56); p.position.set(xa + 0.01, 1.55, dz * (Z.doorW / 2 + 0.55) / 1.3); p.rotation.y = Math.PI / 2; g.add(p); }
  g.updateMatrixWorld(true);
  const wpt = (o, x, y, z) => o.localToWorld(new T.Vector3(x, y, z));
  // ---------- ходьба: стены с дверями, ряды ячеек, щит в тамбуре; выкаченные тележки — тоже препятствия ----------
  const gx = g.position.x, gz = g.position.z, R = (x0, x1, za, zb) => ({ x0: gx + x0, x1: gx + x1, z0: gz + za, z1: gz + zb });
  const blocks = [R(xa - t, xb + t, zA - t, zA), R(xa - t, xb + t, zB, zB + t)];
  for (const xw of [[xa - t, xa], [xb, xb + t]]) blocks.push(R(xw[0], xw[1], zA, d0), R(xw[0], xw[1], d1, zB));
  for (const r of lay.rows) {
    const os = out.filter(o => o.q.row === r), x0 = Math.min(...os.map(o => o.x)) - CW / 2 - 0.02, x1 = Math.max(...os.map(o => o.x)) + CW / 2 + 0.02;
    blocks.push(r === 'B' ? R(x0, x1, hc - 0.02, hc + CD + 0.1) : R(x0, x1, -hc - CD - 0.1, -hc + 0.02));
  }
  blocks.push(R(hx - 1.0, hx + 1.0, zA, zA + 0.25));
  if (two) { const tb = ties.find(o => o.rowB) || ties[0]; if (tb) { /* мост — над головой, не мешает */ } }
  const dyn = () => {
    const bl = [];
    for (const o of out) {
      const sx = o.dc ? o.dc.slideX || 0 : 0;
      if (sx <= 0.05) continue;
      // выкаченная тележка: перед фасадом ячейки, в коридор (у ряда B — в −z)
      bl.push(o.rowB ? R(o.x - 0.36, o.x + 0.36, hc - sx - 0.04, hc - sx + 0.88) : R(o.x - 0.36, o.x + 0.36, -hc + sx - 0.88, -hc + sx + 0.04));
    }
    return bl;
  };
  // ---------- связь с улицей: КЛ — в траншею к муфте, к трансформатору и ТСН — шинный мост ----------
  const links = () => {
    for (const o of out) {
      const dn = o.c.down;
      if (!dn) continue;
      const d = v.dev.get(dn.el.id);
      if (!d || !d.ports) continue;
      const P = d.group.localToWorld(new T.Vector3(...(d.ports[dn.i] || d.ports[0])));
      // выход — через продольную стену за рядом этой ячейки (за ячейкой — её местная −z)
      const ws = wpt(o.g, 0, 0, -CD - Z.back - t - 0.4);
      if (dn.el.t === 'cable') {
        // траншея с плитами от стены до муфты кабеля (кабель — под плитами; спуск у муфты рисует модель КЛ)
        const pts = [[ws.x, ws.z], [P.x, ws.z], [P.x, P.z]];
        for (let j = 0; j < pts.length - 1; j++) {
          const a = pts[j], b = pts[j + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.05) continue;
          const along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
          for (let s0 = 0; s0 < len - 0.01; s0 += 1.0) {
            const sl = Math.min(1.0, len - s0) - 0.04, f = (s0 + sl / 2 + 0.02) / len;
            const mx = a[0] + (b[0] - a[0]) * f, mz = a[1] + (b[1] - a[1]) * f;
            root.add(v.box(along ? sl : 0.62, 0.07, along ? 0.62 : sl, M.concrete, mx, 0.04, mz));
          }
        }
        // кабель выходит из стены в траншею
        const wl = wpt(o.g, 0, 0, -CD - Z.back - t + 0.02);
        root.add(v.tube([wl.x, 0.35, wl.z], [ws.x, 0.06, ws.z], 0.045, M.dark));
      } else {
        // шинный мост: из ячейки вверх под потолок, через стену за рядом — к выводу трансформатора на высоте проводов
        const yb = Z.h - 0.5, top = wpt(o.g, 0, CH + 0.05, -CD / 2), mat = nm(dn.node), wb = wpt(o.g, 0, 0, -CD - Z.back - t - 0.6);
        const pts = [[top.x, top.y, top.z], [top.x, yb, top.z], [wb.x, yb, wb.z], [P.x, yb, wb.z], [P.x, yb, P.z], [P.x, P.y, P.z]];
        for (let j = 0; j < pts.length - 1; j++) if (Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1], pts[j + 1][2] - pts[j][2]) > 0.02) root.add(v.tube(pts[j], pts[j + 1], 0.07, mat));
      }
    }
  };
  // провод внутри ячейки (узел ячейки): невидимая коробка и место ПЗ — у нижних контактов в отсеке тележки
  const inner = wireNode => {
    const o = nodeCell.get(wireNode);
    if (o) return wpt(o.g, 0, CONTACT.lo, CONTACT.z + 0.14);
    for (const bus of kru.buses) if (termOf(bus, 0) === wireNode) { const d = v.dev.get(bus.id); return d ? d.group.localToWorld(new T.Vector3(0.6, CH + 0.36, d.group.children[0] ? d.group.children[0].position.z : 0)) : null; }
    return null;
  };
  const topMats = new Set([M.rCeil, M.rLampBox, M.rTube]);
  const view = wpt(g, (xa + xb) / 2, 0, 0);
  return { group: g, cells: out, blocks, dyn, links, inner, topMats, inside: kru.inside, nodes: kru.nodes, view: { x: view.x, z: view.z }, board };
}

// Материалы ЗРУ: материалы помещения (room.js) и свои — рифлёные плиты канала, стекло окон; цвета — PAL.room (kit.js)
function zruMats(v) {
  const M = roomMats(v);
  if (!M.rPlate) Object.assign(M, makeMaterials(v.kit.T, { rPlate: PAL.room.rPlate, rWin: PAL.room.rWin }));
  return M;
}

// Атлас ЗРУ: таблички ячеек «номер · присоединение», «ЗРУ-10 кВ», «Стой! Напряжение», однолинейная схема РП, знаки.
// Один холст и один материал на всё — после слияния один вызов отрисовки
function zruAtlas(v, lay) {
  const T = v.kit.T, W = 1024, PW = 256, PH = 52, perRow = W / PW, nP = lay.cells.length, plH = Math.ceil(nP / perRow) * PH;
  const H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), regions = {};
  const F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
  const area = (key, X, Y, w, h, draw) => { x.save(); x.translate(X, Y); draw(w, h); x.restore(); regions[key] = [X / W, 1 - (Y + h) / H, (X + w) / W, 1 - Y / H]; };
  const center = (tx, cxp, y, font, color) => { x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.fillText(tx, cxp, y); x.textAlign = 'left'; };
  // таблички ячеек: белое поле, номер крупно, присоединение
  lay.cells.forEach((q, i) => area('p' + q.no, (i % perRow) * PW, Math.floor(i / perRow) * PH, PW, PH, (w, h) => {
    x.fillStyle = '#f2f2ea'; x.fillRect(0, 0, w, h); x.strokeStyle = '#1b2330'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, w - 3, h - 3);
    x.fillStyle = '#1b2330'; x.fillRect(0, 0, 62, h);
    center(String(q.no), 31, 38, F(700, 32), '#ffffff');
    x.font = F(700, 26); x.fillStyle = '#1b2330'; let t = q.short; while (x.measureText(t).width > w - 80 && t.length > 2) t = t.slice(0, -1);
    x.fillText(t, 74, 36);
  }));
  const y0 = Math.max(plH, 160) + 8;
  area('zru', 0, y0, 384, 110, (w, h) => { x.fillStyle = '#21303a'; x.fillRect(0, 0, w, h); center('ЗРУ-10 кВ', w / 2, 72, F(700, 52), '#ffffff'); });
  area('stop', 384, y0, 256, 160, (w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d0202f'; x.lineWidth = 12; x.strokeRect(6, 6, w - 12, h - 12);
    center('СТОЙ', w / 2, 46, F(800, 32), '#111111'); center('НАПРЯЖЕНИЕ', w / 2, 146, F(800, 26), '#111111');
    x.fillStyle = '#d0202f'; x.beginPath(); x.moveTo(140, 56); x.lineTo(108, 96); x.lineTo(126, 96); x.lineTo(112, 124); x.lineTo(150, 84); x.lineTo(132, 84); x.closePath(); x.fill();
  });
  const must = (key, X, title, icon) => area(key, X, y0, 192, 256, (w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1a5fb4'; x.beginPath(); x.arc(w / 2, 82, 68, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; icon(w / 2, 82);
    x.fillStyle = '#1b2330'; x.font = F(700, 20); x.textAlign = 'center'; title.forEach((tt, i) => x.fillText(tt, w / 2, 186 + i * 24)); x.textAlign = 'left';
  });
  must('gloves', 640, ['Работать', 'в диэлектрических', 'перчатках'], (cx2, cy) => { x.fillRect(cx2 - 26, cy - 10, 52, 54); for (let i = 0; i < 4; i++) x.fillRect(cx2 - 24 + i * 13, cy - 46, 10, 40); x.fillRect(cx2 - 44, cy - 20, 20, 12); });
  must('helmet', 832, ['Работать', 'в защитной', 'каске'], (cx2, cy) => { x.beginPath(); x.arc(cx2, cy + 14, 44, Math.PI, 0); x.fill(); x.fillRect(cx2 - 58, cy + 10, 116, 12); });
  // однолинейная схема РП: секции шин, ячейки с номерами и присоединениями, секционирование
  const sy = y0 + 270, SW = 1024, SH = H - sy;
  area('scheme', 0, sy, SW, SH, (w, h) => {
    x.fillStyle = '#f6f4ec'; x.fillRect(0, 0, w, h); x.strokeStyle = '#2d3b9a'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    center('Однолинейная схема · ЗРУ-10 кВ', w / 2, 40, F(700, 28), '#1b2330');
    const rows = lay.rows, list = r => lay.cells.filter(q => q.row === r).sort((p, q) => p.no - q.no);
    const all = rows.length === 2 ? list('A').concat(list('B')) : list('A'), n = all.length, step = (w - 80) / Math.max(1, n), bus = 96;
    x.lineWidth = 6;
    rows.forEach((r, ri) => {
      const ids = all.map((q, i) => [q, i]).filter(([q]) => q.row === r), i0 = ids[0][1], i1 = ids[ids.length - 1][1];
      x.strokeStyle = '#8a3cae'; x.beginPath(); x.moveTo(40 + i0 * step + 6, bus); x.lineTo(40 + (i1 + 1) * step - 6, bus); x.stroke();
      center(`${ri + 1} секция`, 40 + (i0 + i1 + 1) / 2 * step, bus - 16, F(600, 18), '#56645e');
    });
    all.forEach((q, i) => {
      const cx2 = 40 + (i + 0.5) * step;
      x.strokeStyle = '#1b2330'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx2, bus); x.lineTo(cx2, bus + 110); x.stroke();
      x.fillStyle = q.c.tie ? '#cf2538' : '#ffffff'; x.fillRect(cx2 - 9, bus + 30, 18, 18); x.strokeRect(cx2 - 9, bus + 30, 18, 18);
      center(String(q.no), cx2, bus + 136, F(700, 18), '#1b2330');
      x.save(); x.translate(cx2 + 6, bus + 150); x.rotate(Math.PI / 2); x.font = F(500, 15); x.fillStyle = '#1b2330'; x.fillText(q.short, 0, 0); x.restore();
    });
    // перемычка между секциями (СВ — СР)
    const ties = all.map((q, i) => [q, i]).filter(([q]) => q.c.tie);
    if (ties.length === 2) { const a = 40 + (ties[0][1] + 0.5) * step, b = 40 + (ties[1][1] + 0.5) * step; x.strokeStyle = '#1b2330'; x.lineWidth = 3; x.beginPath(); x.moveTo(a, bus + 110); x.lineTo(b, bus + 110); x.stroke(); }
  });
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
  const plane = (key, w, h) => {
    const geo = new T.PlaneGeometry(w, h), uv = geo.attributes.uv, r = regions[key];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? r[2] : r[0], uv.getY(i) ? r[3] : r[1]);
    return new T.Mesh(geo, mat);
  };
  return { plane, mat };
}

export { findKRU, layoutZRU, buildZRU, shortName };
