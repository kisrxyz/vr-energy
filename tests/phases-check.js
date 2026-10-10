// Проверка трассировки трёх фаз (src/view3d/phases.js) без браузера: концы фаз — на полюсах, шинах или у соседнего провода,
// каждый полюс вывода получает свою фазу, разные фазы (и фазы разных узлов) не сближаются меньше CLEAR м — нет пересечений.
import { TYPES, portPoints, rot } from '../src/core/elements.js';
import { H3 } from '../src/view3d/models/kit.js';

const CLEAR = 0.1;
const eq = (a, b, e = 1e-5) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e && Math.abs(a[2] - b[2]) < e;
// Наименьшее расстояние между отрезками pq и rs в 3D
function segDist(p, q, r, s) {
  const d1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], d2 = [s[0] - r[0], s[1] - r[1], s[2] - r[2]], w = [p[0] - r[0], p[1] - r[1], p[2] - r[2]];
  const D = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = D(d1, d1), b = D(d1, d2), c = D(d2, d2), d = D(d1, w), e = D(d2, w), den = a * c - b * b;
  let sc, tc;
  if (a < 1e-12 && c < 1e-12) { sc = 0; tc = 0; }
  else if (a < 1e-12) { sc = 0; tc = Math.min(1, Math.max(0, e / c)); }
  else if (c < 1e-12) { tc = 0; sc = Math.min(1, Math.max(0, -d / a)); }
  else {
    sc = den > 1e-12 ? Math.min(1, Math.max(0, (b * e - c * d) / den)) : 0;
    tc = (b * sc + e) / c;
    if (tc < 0) { tc = 0; sc = Math.min(1, Math.max(0, -d / a)); } else if (tc > 1) { tc = 1; sc = Math.min(1, Math.max(0, (b - d) / a)); }
  }
  const x = [w[0] + sc * d1[0] - tc * d2[0], w[1] + sc * d1[1] - tc * d2[1], w[2] + sc * d1[2] - tc * d2[2]];
  return Math.sqrt(D(x, x));
}
const onSeg = (p, a, b) => segDist(p, p, a, b) < 1e-5;
// конец фазы на другой ломаной: в её точке или на её отрезке (спуск на фазу проходящей линии, подъём к шине)
const touches = (p, y) => y.path.some((q, i) => eq(q, p) || (i > 0 && onSeg(p, y.path[i - 1], q)));

function checkPhases(s, topo, T, W, kru) {
  const bad = [];
  const paths = [];   // { id, path } — фазы проводов, шины, перемычки
  for (const [id, rec] of T.wires) rec.phases.forEach((ph, k) => paths.push({ id: `${id}#${k}`, path: ph, wire: rec }));
  for (const [id, b] of T.buses) b.lines.forEach((ln, k) => paths.push({ id: `${id}#${k}`, path: ln, bus: true }));
  T.links.forEach((l, k) => paths.push({ id: `link${k}`, path: l.pts }));
  // полюса выводов аппаратов, к которым подходят провода: каждый получает ровно одну фазу каждого провода
  const inside = id => !!(kru && kru.inside.has(id));
  for (const el of s.els) {
    if (el.t === 'bus' || inside(el.id)) continue;
    const u = rot([1, 0], el.r), tm = topo.term.get(el.id) || [];
    portPoints(el).forEach((pp, i) => {
      const P = W(pp), gap = T.gapOf(tm[i] != null ? tm[i] : tm[0]);
      const poles = [-1, 0, 1].map(j => [P[0] + u[0] * j * gap, H3, P[1] + u[1] * j * gap]);
      const attached = [...T.wires.values()].filter(r => r.phases.some(ph => eq(ph[0], poles[0]) || eq(ph[0], poles[1]) || eq(ph[0], poles[2]) || eq(ph[ph.length - 1], poles[0]) || eq(ph[ph.length - 1], poles[1]) || eq(ph[ph.length - 1], poles[2])));
      for (const r of attached) {
        const hit = poles.map(pl => r.phases.filter(ph => eq(ph[0], pl) || eq(ph[ph.length - 1], pl)).length);
        if (hit.some(h => h !== 1)) bad.push(`${el.name} вывод ${i}: фазы провода ${r.id} на полюсах ${hit.join('/')}`);
      }
    });
  }
  // концы фаз: на полюсе аппарата, на шине или на другой фазе (угол, узел) — иначе висит
  const poleSet = [];
  for (const el of s.els) {
    if (el.t === 'bus' || inside(el.id)) continue;
    const u = rot([1, 0], el.r), tm = topo.term.get(el.id) || [];
    portPoints(el).forEach((pp, i) => { const P = W(pp), gap = T.gapOf(tm[i] != null ? tm[i] : tm[0]); for (const j of [-1, 0, 1]) poleSet.push([P[0] + u[0] * j * gap, H3, P[1] + u[1] * j * gap]); });
  }
  // концы висящих в схеме проводов (точка ни к чему не подключена) не проверяем
  const loose = new Set();
  for (const rec of T.wires.values()) for (const e of ['a', 'b']) if (rec.end[e].kind === 'N') loose.add(rec.id + e);
  for (const x of paths) {
    if (x.bus) continue;
    for (const [pt, e] of [[x.path[0], 'a'], [x.path[x.path.length - 1], 'b']]) {
      if (x.wire && loose.has(x.wire.id + e)) continue;
      const ok = poleSet.some(p => eq(p, pt)) || paths.some(y => y !== x && touches(pt, y));
      if (!ok) bad.push(`${x.id}: висящий конец ${pt.map(v => v.toFixed(2)).join(',')}`);
    }
  }
  // сети фаз: соединённые концами (и шина с поднятыми к ней фазами); у разных сетей — зазор
  const parent = paths.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = (i, j) => { parent[find(i)] = find(j); };
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const A = paths[i], B = paths[j];
    const ends = (X, Y) => [X.path[0], X.path[X.path.length - 1]].some(p => touches(p, Y));
    if (ends(A, B) || ends(B, A)) join(i, j);
  }
  const segs = [];
  paths.forEach((x, i) => { for (let k = 0; k < x.path.length - 1; k++) segs.push({ a: x.path[k], b: x.path[k + 1], net: find(i), id: x.id }); });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    if (A.net === B.net) continue;
    const dd = segDist(A.a, A.b, B.a, B.b);
    if (dd < CLEAR) bad.push(`${A.id} и ${B.id}: ${dd.toFixed(3)} м`);
  }
  return { bad, segs: segs.length, nets: new Set(segs.map(x => x.net)).size };
}

export { checkPhases, segDist, CLEAR };
