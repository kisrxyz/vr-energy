/* ===== ЗРУ на площадке: ячейки КРУ в здании (РП-10, КРУ-10 ПС 110/35/10, свои схемы) =====
   Движок и 2D не меняются: схема та же, меняется только, где элементы стоят в 3D.
   findKRU(s, topo) — без DOM и three (тест в Node): секции шин КРУ (шина, к которой прямо подключены ≥ 2 тележки) и их ячейки.
     Ячейка — ветка от шины: тележка (cart, cartdisc) и дальше по цепочке ТТ, предохранитель, ЗН, ТН этой ветки — до первого «уличного»
     элемента (КЛ, ВЛ, трансформатор, ТСН, нагрузка, разъединитель или ВН на ТП) — он остаётся на улице (down). Ветка из одного ОПН или ТН
     на шине — ячейка без тележки. Тележка СВ, за ней тележка СР ко второй секции — две ячейки секционирования. Что не распознано — на улице.
   buildZRU(v, s, topo, kru, W) — здание по габариту ряда с коридором перед фасадами и проёмами дверей в торцах, ячейки (cell.js),
     шины над рядом, КЛ — вниз и лотком к концевой муфте, к трансформатору и ТСН — шинный мост на высоте проводов. */
import { buildCell, CW, CD, CH, CONTACT } from './cell.js';
import { roomMats } from './room.js';
import { MODELS, PAL } from './models/index.js';

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


// ---------- здание ЗРУ и ячейки (three — через v.kit.T) ----------
// Местные координаты здания: x — вдоль ряда (середина ряда — 0), z — от фасадов ячеек (0) в коридор (+z), за ячейками — −z
const Z = { corr: 3.0, back: 0.5, end: 1.6, h: 3.6, t: 0.2, door0: 0.5, door1: 1.8, doorH: 2.3 };
const NOP = { update() {} };

function buildZRU(v, s, topo, kru, W) {
  const T = v.kit.T, k = v.kit, M = roomMats(v), root = v.root, cells = kru.cells, n = cells.length, L = n * CW;
  const nm = node => (node != null ? v.nodeMat(node) : M.galv);
  const termOf = (el, i) => (topo.term.get(el.id) || [])[i];
  // где здание: середина ряда — по x ячеек схемы, линия фасадов — у первой шины КРУ
  const xs = cells.map(c => W([c.x, 0]).x), b0 = kru.buses[0];
  const g = k.group((Math.min(...xs) + Math.max(...xs)) / 2, 0, W([b0.x, b0.y]).z + CD / 2);
  root.add(g);
  const proxyMat = v._proxyMat || (v._proxyMat = new T.MeshBasicMaterial({ color: PAL.ui.proxy }));
  const proxy = (parent, w, h, d, x, y, z, data) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), proxyMat);
    m.position.set(x, y, z); m.visible = false; Object.assign(m.userData, data, { proxy: true });
    parent.add(m); v.pickables.push(m);
    return m;
  };
  const rec = (el, group, extra) => { const d = Object.assign({ el, group, kind: el.t, trip: false, lamps: [], mod: MODELS[el.t] || NOP, zru: true }, extra); v.dev.set(el.id, d); return d; };
  const BW = L + 2 * Z.end, z0 = -CD - Z.back, BD = Z.corr - z0;
  // ---------- ячейки ----------
  const out = [], nodeCell = new Map();
  cells.forEach((c, i) => {
    const x = -L / 2 + CW * (i + 0.5), busNode = termOf(c.bus, 0);
    const o = { c, i, x };
    for (const nd of c.nodes) nodeCell.set(nd, o);
    if (c.cart) {
      const earth = (c.parts.find(p => SIDE[p.el.t]) || {}).el || null;
      const r = buildCell(v, { parent: g, x, z: 0, cart: c.cart, earth, kind: c.kind === 'vt' ? 'vt' : c.kind === 'disc' ? 'disc' : 'line', busMat: nm(busNode),
        loMat: nm(termOf(c.cart, c.liveTerm)), liveTerm: c.liveTerm, num: null, label: c.cart.name, labelY: CH + 0.55 + (i % 2) * 0.26, labelH: 0.2, proxy });
      r.dc.zru = true; if (r.dz) r.dz.zru = true;
      Object.assign(o, r);
    } else {
      // ячейка без тележки (ОПН, ТН на шине): закрытый шкаф
      const cg = k.group(x, 0, 0); g.add(cg);
      cg.add(k.box(CW - 0.01, CH, CD, M.kru, 0, CH / 2, -CD / 2));
      cg.add(k.box(CW - 0.06, 1.7, 0.02, M.rKruDoor, 0, 1.15, 0.01));
      cg.add(k.box(0.025, 0.12, 0.035, M.handle, CW / 2 - 0.07, 1.2, 0.035));
      cg.add(k.box(0.018, 0.5, 0.006, M.mimic, 0, 1.7, 0.023));
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
      // в шкафу без тележки — окошко на двери (сам аппарат за ней)
      if (!inCart) pg.add(k.box(0.2, 0.3, 0.01, M.porcelain, 0, 0.1, 0));
      else if (el.t === 'ct') for (let j = -1; j <= 1; j++) pg.add(k.cyl(0.06, 0.14, M.tank, j * 0.2, 0, 0, 'z'));
      else if (el.t === 'vt') pg.add(k.box(0.5, 0.24, 0.2, M.tank, 0, 0, 0));
      else pg.add(k.cyl(0.04, 0.4, M.porcelain, 0, 0.1, 0));
      rec(el, pg);
      proxy(pg, 0.62, inCart ? 0.24 : 0.8, 0.2, 0, 0, 0, { dev: el.id });
      back++;
    }
    out.push(o);
  });
  // ---------- шины над ячейками: по секциям ----------
  const busY = CH + 0.36, bz = -CD / 2;
  for (const bus of kru.buses) {
    const idx = out.filter(o => o.c.bus === bus && !o.c.tie).map(o => o.i);
    if (!idx.length) continue;
    const x0 = -L / 2 + CW * Math.min(...idx), x1 = -L / 2 + CW * (Math.max(...idx) + 1), len = x1 - x0, mat = nm(termOf(bus, 0));
    const bg = k.group(x0, 0, 0); g.add(bg);
    for (const dzb of [-0.22, 0, 0.22]) bg.add(k.box(len + 0.1, 0.08, 0.012, mat, len / 2, busY, bz + dzb));
    for (const i of idx) for (const dzb of [-0.22, 0, 0.22]) {
      const cx = CW * (i + 0.5) - (x0 + L / 2);
      bg.add(k.cyl(0.028, 0.26, M.porcelain, cx, CH + 0.17, bz + dzb));
      bg.add(k.box(0.012, 0.3, 0.012, mat, cx, CH + 0.2, bz + dzb + 0.03));
    }
    rec(bus, bg, { kind: 'bus', labelPos: [0.6, busY + 0.7, bz], labelH: 0.24 });
    proxy(bg, len + 0.1, 0.3, 0.6, len / 2, busY, bz, { dev: bus.id });
  }
  // секционирование: перемычка над ячейками СВ и СР
  const ties = out.filter(o => o.c.tie);
  if (ties.length === 2) g.add(k.box(Math.abs(ties[1].x - ties[0].x) + 0.1, 0.08, 0.012, nm(ties[0].c.nodes[0]), (ties[0].x + ties[1].x) / 2, busY + 0.25, bz));
  // ---------- здание: пол, стены с проёмами дверей в торцах, потолок со светильниками ----------
  const floor = new T.Mesh(new T.PlaneGeometry(BW, BD), M.rFloor), uv = floor.geometry.attributes.uv, rep = M.rFloor.map.repeat;
  for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * BW / 1.2 / rep.x, uv.getY(j) * BD / 1.2 / rep.y);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.025, (z0 + Z.corr) / 2); floor.userData.ground = true;
  g.add(floor); v.pickables.push(floor);
  const t = Z.t, h = Z.h, xe = BW / 2;
  g.add(k.box(BW + 2 * t, h, t, M.rWall, 0, h / 2, z0 - t / 2));
  g.add(k.box(BW + 2 * t, h, t, M.rWall, 0, h / 2, Z.corr + t / 2));
  for (const sx of [-1, 1]) {
    g.add(k.box(t, h, Z.door0 - z0, M.rWall, sx * (xe + t / 2), h / 2, (z0 + Z.door0) / 2));
    g.add(k.box(t, h, Z.corr - Z.door1, M.rWall, sx * (xe + t / 2), h / 2, (Z.door1 + Z.corr) / 2));
    g.add(k.box(t, h - Z.doorH, Z.door1 - Z.door0, M.rWall, sx * (xe + t / 2), (Z.doorH + h) / 2, (Z.door0 + Z.door1) / 2));
  }
  g.add(k.box(BW + 2 * t, 0.1, BD + 2 * t, M.rCeil, 0, h + 0.05, (z0 + Z.corr) / 2));
  for (let lx = -BW / 2 + 1.5; lx < BW / 2 - 0.5; lx += 3) {
    g.add(k.box(1.3, 0.07, 0.24, M.rLampBox, lx, h - 0.035, Z.corr * 0.55));
    g.add(k.box(1.22, 0.025, 0.14, M.rTube, lx, h - 0.08, Z.corr * 0.55));
  }
  // коврик и разметка зоны выкатки перед ячейками
  g.add(k.box(L, 0.012, 0.9, M.rMat, 0, 0.03, 0.5));
  g.add(k.box(L, 0.006, 0.05, M.rLine, 0, 0.032, 2.1));
  g.updateMatrixWorld(true);
  const wpt = (o, x, y, z) => o.localToWorld(new T.Vector3(x, y, z));
  // ---------- ходьба: стены с дверями, ряд ячеек; выкаченные тележки — тоже препятствия ----------
  const gx = g.position.x, gz = g.position.z, R = (x0, x1, za, zb) => ({ x0: gx + x0, x1: gx + x1, z0: gz + za, z1: gz + zb });
  const blocks = [R(-xe - t, xe + t, z0 - t, z0), R(-xe - t, xe + t, Z.corr, Z.corr + t), R(-L / 2 - 0.02, L / 2 + 0.02, -CD - 0.1, 0.02)];
  for (const sx of [-1, 1]) { const a = sx < 0 ? -xe - t : xe, b = sx < 0 ? -xe : xe + t; blocks.push(R(a, b, z0, Z.door0), R(a, b, Z.door1, Z.corr)); }
  const dyn = () => {
    const bl = [];
    for (const o of out) { const sx = o.dc ? o.dc.slideX || 0 : 0; if (sx > 0.05) bl.push(R(o.x - 0.36, o.x + 0.36, sx - 0.88, sx + 0.04)); }
    return bl;
  };
  // ---------- связь с улицей: КЛ — вниз и лотком к муфте, к трансформатору и ТСН — шинный мост ----------
  const links = () => {
    for (const o of out) {
      const dn = o.c.down;
      if (!dn) continue;
      const d = v.dev.get(dn.el.id);
      if (!d || !d.ports) continue;
      const P = d.group.localToWorld(new T.Vector3(...(d.ports[dn.i] || d.ports[0])));
      const side = P.z > gz ? Z.corr + t + 0.6 : z0 - t - 0.6, ws = wpt(g, o.x, 0, side);
      if (dn.el.t === 'cable') {
        // под полом — к стене, за стеной — лоток по земле до муфты кабеля (её спуск до земли рисует сама модель КЛ)
        const pts = [[ws.x, 0.08, ws.z], [P.x, 0.08, ws.z], [P.x, 0.08, P.z]];
        for (let j = 0; j < pts.length - 1; j++) {
          const a = pts[j], b = pts[j + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          if (len < 0.05) continue;
          root.add(v.tube(a, b, 0.04, M.dark));
          root.add(v.box(Math.abs(b[0] - a[0]) + 0.4, 0.06, Math.abs(b[2] - a[2]) + 0.4, M.concrete, (a[0] + b[0]) / 2, 0.03, (a[2] + b[2]) / 2));
        }
        const ins = wpt(g, o.x, 0.08, -CD + 0.15);
        root.add(v.tube([ws.x, 0.08, ws.z], [ins.x, 0.08, ws.z], 0.04, M.dark));
      } else {
        // шинный мост: из ячейки вверх под крышу, через стену — к выводу трансформатора на высоте проводов
        // мост выходит через заднюю стену (не через коридор обслуживания)
        const yb = Z.h - 0.5, top = wpt(g, o.x, CH + 0.05, -CD / 2), mat = nm(dn.node), wb = wpt(g, o.x, 0, z0 - t - 0.6);
        const pts = [[top.x, top.y, top.z], [top.x, yb, top.z], [wb.x, yb, wb.z], [P.x, yb, wb.z], [P.x, yb, P.z], [P.x, P.y, P.z]];
        for (let j = 0; j < pts.length - 1; j++) if (Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1], pts[j + 1][2] - pts[j][2]) > 0.02) root.add(v.tube(pts[j], pts[j + 1], 0.07, mat));
      }
    }
  };
  // провод внутри ячейки (узел ячейки): невидимая коробка и место ПЗ — у нижних контактов в отсеке тележки
  const inner = wireNode => {
    const o = nodeCell.get(wireNode);
    if (o) return wpt(o.g, 0, CONTACT.lo, CONTACT.z + 0.14);
    for (const bus of kru.buses) if (termOf(bus, 0) === wireNode) { const d = v.dev.get(bus.id); return d ? d.group.localToWorld(new T.Vector3(0.6, CH + 0.36, -CD / 2)) : null; }
    return null;
  };
  const topMats = new Set([M.rCeil, M.rLampBox, M.rTube]);
  return { group: g, cells: out, blocks, dyn, links, inner, topMats, inside: kru.inside, nodes: kru.nodes };
}

export { findKRU, buildZRU };
