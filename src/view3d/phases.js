import { TYPES, ptKey, portPoints, rot, wireRoute, isSwitchable } from '../core/elements.js';
import { compute, makeSim } from '../core/engine.js';
import { H3 } from './models/kit.js';

/* ===== Три фазы на площадке: трассировка проводов и шин (без three.js и DOM — проверяется в Node) =====
   2D-схема однолинейная; в 3D каждый провод и шина — три фазы. Расстояние между фазами — по классу напряжения узла
   в нормальной схеме (phaseGap), условное: в сетку 1,25 м настоящие 2,5–3 м для 110 кВ не помещаются.
   Полюса аппарата — в его местной оси x (поперёк символа): вывод ± gap. Высоты: выводы и провода — H3; отпайки (провод подходит
   поперёк полюсов) — выше на LIFT и опускаются на каждый полюс сверху; сборные шины — выше на BUS_UP, фаза поднимается к своей шине.
   Концы провода:
     A — «вдоль»: фазы провода и полюса на одной линии, фаза — к полюсу по порядку (если провод выше — спуск на полюс);
     M — узел из двух проводов: один провод с поворотом, углы «в ус» (внутренняя фаза короче, внешняя длиннее);
     C — «поперёк»: у узла с проходящей линией (отпайка к ЗН сбоку) — как у шины: фазы проходящей линии сплошные, каждая фаза отпайки
         идёт над ними до своей и опускается на неё сверху (встречные отпайки сходятся в тех же точках); у аппарата — гребёнка над полюсами:
         средняя фаза кончается над ближним полюсом, крайние — над средним и дальним, короткий поворот и спуск на полюс сверху;
     B — шина: фаза идёт под шинами до своей шины и поднимается к ней (у конца шины — подъём на месте);
     N — висящий конец (провод ни к чему не подключён).
   Точки — [x, y, z] в метрах мира; W(p) — точка схемы (клетки) → [x, z] мира. */

const LIFT = 0.75, BUS_UP = 1.3, HB = H3 + BUS_UP;
// Расстояние между фазами, м: 0,4 кВ — 0,15; 6–10 кВ — 0,35; 35 кВ — 0,55; 110 кВ — 0,8; 220 кВ и выше — 1,0
function phaseGap(kv) { return kv == null ? 0.35 : kv >= 200 ? 1.0 : kv >= 100 ? 0.8 : kv >= 30 ? 0.55 : kv >= 3 ? 0.35 : 0.15; }

// Напряжение узлов в нормальной схеме при всех включённых аппаратах и тележках в рабочем (как выбор указателя на площадке)
function nominalKv(s, topo) {
  const init = {}, pos = {};
  for (const el of s.els) { if (isSwitchable(el)) init[el.id] = TYPES[el.t].cls !== 'earth'; if (TYPES[el.t].cart) pos[el.id] = 'work'; }
  try { return compute(s, topo, makeSim(s, init, pos)).V; } catch (e) { return new Map(); }
}

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const nrm = t => [-t[1], t[0]];               // поперечная ось к направлению t (смещение фаз — вдоль неё)
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const p3 = (q, y) => [q[0], y, q[1]];

/* opts: { W, skipEl(id), skipWire(w) } → { gapOf(node), wires: Map(id → { node, level, gap, route, phases }), buses: Map(id → { node, gap, y, lines }), links: [{ node, pts }] }
   phases — три ломаные [[x, y, z], …]; route — ось провода на его высоте [[x, z], …] (для невидимых коробок и ПЗ) */
function tracePhases(s, topo, opts) {
  const W = opts.W, skipEl = opts.skipEl || (() => false), skipWire = opts.skipWire || (() => false);
  const nom = nominalKv(s, topo), gapOf = n => phaseGap(nom.get(n));
  const pts = new Map();
  const at = p => { const k = ptKey(p); let q = pts.get(k); if (!q) pts.set(k, q = { P: W(p), devs: [], bus: null, ends: [] }); return q; };
  const buses = new Map(), links = [];
  // аппараты: полюса каждого вывода; шины: ось шины и поперечная ось фаз
  for (const el of s.els) {
    if (skipEl(el.id)) continue;
    const tm = topo.term.get(el.id) || [];
    if (el.t === 'bus') {
      const pp = portPoints(el), e = unit(rot([1, 0], el.r)), w = unit(rot([0, 1], el.r)), gap = gapOf(tm[0]);
      const a = W(pp[0]), b = W(pp[pp.length - 1]);
      buses.set(el.id, { node: tm[0], gap, y: HB, e, w, lines: [-1, 0, 1].map(j => [p3(add(a, w, j * gap), HB), p3(add(b, w, j * gap), HB)]) });
      for (const p of pp) at(p).bus = { id: el.id, w, gap, node: tm[0], y: HB };
      continue;
    }
    const u = unit(rot([1, 0], el.r));
    portPoints(el).forEach((p, i) => { const q = at(p); q.devs.push({ id: el.id, i, u, gap: gapOf(tm[i] != null ? tm[i] : tm[0]), node: tm[i] != null ? tm[i] : tm[0] }); });
  }
  // провода: ось, концы и направления от концов
  const wires = new Map();
  for (const w of s.wires) {
    if (skipWire(w)) continue;
    const r = [];
    for (const p of wireRoute(w)) { const q = W(p); if (!r.length || !same(r[r.length - 1], q)) r.push(q); }
    if (r.length < 2) continue;
    const node = topo.wireNode.get(w.id), dirs = [];
    for (let i = 0; i < r.length - 1; i++) dirs.push(unit(sub(r[i + 1], r[i])));
    const rec = { id: w.id, node, gap: gapOf(node), level: H3, route: r, dirs, end: {} };
    wires.set(w.id, rec);
    // n — поперечная ось фаз у этого конца (по направлению провода от a к b), d — направление от точки внутрь провода
    rec.end.a = { q: at(w.a), d: dirs[0], n: nrm(dirs[0]), kind: 'N' };
    rec.end.b = { q: at(w.b), d: [-dirs[dirs.length - 1][0], -dirs[dirs.length - 1][1]], n: nrm(dirs[dirs.length - 1]), kind: 'N' };
    rec.end.a.q.ends.push({ w: rec, e: 'a' }); rec.end.b.q.ends.push({ w: rec, e: 'b' });
  }
  // вид концов в каждой точке; полюса узла (проходящая линия) — поперёк её направления
  for (const q of pts.values()) {
    const E = q.ends;
    if (!E.length) continue;
    if (q.bus) { for (const x of E) x.w.end[x.e].kind = 'B'; continue; }
    if (q.devs.length) {
      const dv = q.devs[0];
      q.poles = [-1, 0, 1].map(j => add(q.P, dv.u, j * dv.gap)); q.u = dv.u; q.h = H3;
      for (const x of E) { const en = x.w.end[x.e]; en.kind = Math.abs(dot(en.n, dv.u)) > 0.7 ? 'A' : 'C'; }
      continue;
    }
    if (E.length === 1) continue;
    if (E.length === 2) { const [x, y] = E; x.w.end[x.e].kind = 'M'; y.w.end[y.e].kind = 'M'; x.w.end[x.e].mate = y; y.w.end[y.e].mate = x; continue; }
    let pair = null;
    for (let i = 0; i < E.length && !pair; i++) for (let j = i + 1; j < E.length; j++) {
      const di = E[i].w.end[E[i].e].d, dj = E[j].w.end[E[j].e].d;
      if (dot(di, dj) < -0.99) { pair = [E[i], E[j]]; break; }
    }
    if (!pair) pair = [E[0]];
    const d0 = pair[0].w.end[pair[0].e].d, u = nrm(d0), gap = pair[0].w.gap;
    q.poles = [-1, 0, 1].map(j => add(q.P, u, j * gap)); q.u = u; q.m = d0; q.gap = gap; q.through = pair.length === 2 ? pair : null;
    for (const x of E) x.w.end[x.e].kind = pair.includes(x) ? 'A' : 'C';
  }
  // высоты: отпайка — выше полюсов, к которым спускается; узел из двух проводов — одна высота
  for (let it = 0; it < 8; it++) {
    let moved = false;
    const raise = (rec, y) => { if (y > rec.level + 1e-9) { rec.level = y; moved = true; } };
    for (const q of pts.values()) {
      // проходящая линия через узел — на одной высоте (на неё садятся спуски отпаек)
      if (q.through) { q.h = Math.max(...q.through.map(x => x.w.level)); for (const x of q.through) raise(x.w, q.h); }
      for (const x of q.ends) {
        const en = x.w.end[x.e];
        if (en.kind === 'C') raise(x.w, (q.h != null ? q.h : H3) + LIFT);
        if (en.kind === 'M') raise(x.w, en.mate.w.level);
      }
    }
    if (!moved) break;
  }
  // три ломаные каждого провода
  for (const rec of wires.values()) {
    const r = rec.route, L = rec.level, n = rec.dirs.map(nrm);
    rec.phases = [-1, 0, 1].map(j => {
      const o = j * rec.gap, line = [];
      for (let i = 0; i < r.length; i++) {
        if (i === 0) line.push(add(r[0], n[0], o));
        else if (i === r.length - 1) line.push(add(r[i], n[i - 1], o));
        else { const m = add(n[i - 1], n[i]), k = o / (1 + dot(n[i - 1], n[i])); line.push(add(r[i], m, k)); }
      }
      return { o, line };
    });
    rec.phases = rec.phases.map(ph => {
      let path = ph.line.map(q => p3(q, L));
      for (const e of ['a', 'b']) {
        const en = rec.end[e], seg = endPath(rec, en, ph.o, L);
        if (!seg) continue;
        // seg — путь от точки на оси провода у конца (заменяет крайнюю точку) к полюсу
        if (e === 'a') path = seg.slice().reverse().concat(path.slice(1));
        else path = path.slice(0, -1).concat(seg);
      }
      return dedup(path);
    });
    rec.route = r.map(q => q.slice());
  }
  // шины и аппараты в одной точке без провода: каждый полюс — под шинами поперёк к своей шине и вверх к ней
  for (const q of pts.values()) {
    if (!q.bus || !q.devs.length) continue;
    for (const dv of q.devs) {
      const w = q.bus.w, poles = [-1, 0, 1].map(j => add(q.P, dv.u, j * dv.gap)), along = Math.abs(dot(dv.u, w)) > 0.7;
      poles.forEach((pl, j) => {
        const t = (j - 1) * q.bus.gap, bp = along ? add(q.P, w, t) : add(pl, w, t);
        links.push({ node: q.bus.node, pts: dedup([p3(pl, H3), p3(bp, H3), p3(bp, HB)]) });
      });
    }
  }
  return { gapOf, wires, buses, links, H: { H3, HB, LIFT } };

  // Путь конца фазы: от точки фазы на оси у конца — к полюсу (шине, углу); null — конец как есть
  function endPath(rec, en, o, L) {
    const q = en.q, d = en.d, base = add(q.P, en.n, o);
    if (en.kind === 'N') return null;
    if (en.kind === 'M') {
      // угол «в ус» с соседним проводом: смещение фазы по ходу — от провода к соседу
      const x = en.mate, other = x.w.end[x.e];
      const tin = [-d[0], -d[1]], tout = other.d, nin = nrm(tin), nout = nrm(tout);
      const so = dot(sub(base, q.P), nin), k = so / (1 + dot(nin, nout));
      const c = add(q.P, add(nin, nout), k);
      // угол лежит на продолжении крайнего отрезка: крайняя точка заменяется углом (провод удлиняется или укорачивается)
      return [p3(c, L)];
    }
    if (en.kind === 'B') {
      const b = q.bus, lat = dot(sub(base, q.P), en.n);
      if (Math.abs(dot(d, b.w)) > 0.7) {
        // поперёк шины: под шинами до своей шины (фаза по порядку — к шине по порядку), подъём
        const j = Math.round(o / rec.gap), t = j * b.gap, along = t * dot(b.w, d), e = add(add(q.P, d, along), en.n, lat);
        return [p3(e, L), p3(e, b.y)];
      }
      // вдоль шины (у её конца): на месте — к своей шине и вверх
      const t = Math.sign(dot(en.n, b.w)) * lat * b.gap / rec.gap, e = add(q.P, b.w, t);
      return [p3(base, L), p3(e, L), p3(e, b.y)];
    }
    const poles = q.poles, hp = q.h != null ? q.h : H3;
    if (en.kind === 'A') {
      // по порядку вдоль общей линии
      const s = dot(sub(base, q.P), q.u), j = Math.round(s / (rec.gap || 1)), pl = add(q.P, q.u, j * (dot(sub(poles[2], q.P), q.u)));
      const out = [p3(base, L)];
      if (!same(pl, base)) out.push(p3(pl, L));
      if (Math.abs(L - hp) > 1e-6) out.push(p3(pl, hp));
      return out;
    }
    // C у узла с проходящей линией: фаза отпайки со смещением λ вдоль линии — над фазой линии с тем же номером по оси u, спуск на неё
    if (q.through) {
      const lam = dot(sub(base, q.P), q.m), j = Math.round(lam / (rec.gap || 1)), tj = j * q.gap * Math.sign(dot(q.u, d) || 1);
      const e = add(add(q.P, d, tj), q.m, lam);
      return [p3(e, L), p3(e, hp)];
    }
    // C у аппарата — гребёнка: средняя фаза — над ближним полюсом, крайние — над средним и дальним; спуск сверху
    const lat = dot(sub(base, q.P), en.n), sorted = poles.slice().sort((p, r) => dot(sub(r, q.P), d) - dot(sub(p, q.P), d));
    const pl = Math.abs(lat) < 1e-6 ? sorted[0] : lat < 0 ? sorted[1] : sorted[2];
    const e1 = add(add(q.P, d, dot(sub(pl, q.P), d)), en.n, lat);
    return [p3(e1, L), p3(pl, L), p3(pl, hp)];
  }
}

// Ломаная (точки [x, z]), сдвинутая поперёк хода на o; углы — «в ус»
function offsetLine(r, o) {
  const dirs = [];
  for (let i = 0; i < r.length - 1; i++) dirs.push(unit(sub(r[i + 1], r[i])));
  const n = dirs.map(nrm), out = [];
  for (let i = 0; i < r.length; i++) {
    if (i === 0) out.push(add(r[0], n[0], o));
    else if (i === r.length - 1) out.push(add(r[i], n[i - 1], o));
    else out.push(add(r[i], add(n[i - 1], n[i]), o / (1 + dot(n[i - 1], n[i]))));
  }
  return out;
}

function dedup(path) {
  const out = [];
  for (const p of path) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1], l[2] - p[2]) > 1e-6) out.push(p); }
  return out;
}

export { phaseGap, nominalKv, tracePhases, offsetLine, LIFT, BUS_UP, HB };
