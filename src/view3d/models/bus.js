// Сборные шины: три фазы (по местной оси z — поперёк шины) выше проводов — к ним поднимается каждая фаза присоединения (phases.js).
// Опоры — решётчатая стойка, траверса и три опорных изолятора; ставятся через 3 клетки, но не под отпайками (d.taps — где фазы
// присоединений поднимаются к шинам, местная ось x), чтобы подъёмы не шли сквозь изоляторы
import { HB } from '../phases.js';
export function build(k, el, d) {
  const { M, S3 } = k, g = d.group, len = el.p.len * S3, step = 3, gap = k.gap(0);
  for (const j of [-1, 0, 1]) g.add(k.tube([0, HB, j * gap], [len, HB, j * gap], 0.06, k.node(0)));
  const taps = d.taps || [], free = x => taps.every(t => Math.abs(t - x) > 0.4);
  const want = [];
  for (let i = 0; i <= el.p.len; i += step) want.push(i * S3);
  if (el.p.len % step) want.push(len);
  const xs = [];
  for (const x0 of want) {
    // ближайшее свободное место в пределах полуклетки
    let x = x0;
    for (const dx of [0, 0.3, -0.3, 0.6, -0.6]) if (free(x0 + dx) && x0 + dx >= -0.01 && x0 + dx <= len + 0.01) { x = x0 + dx; break; }
    if (!xs.some(q => Math.abs(q - x) < 1)) xs.push(x);
  }
  const yb = HB - 0.95;
  for (const x of xs) {
    g.add(k.lattice(0.26, yb, 0.26, x, yb / 2, 0, 0.5));
    g.add(k.box(0.14, 0.14, 2 * gap + 0.36, M.galv, x, yb + 0.07, 0));
    for (const j of [-1, 0, 1]) g.add(k.lite(x, yb + 0.14, HB - 0.07, j * gap, 0.065));
  }
  return { label: [0.6, HB + 0.6, 0] };
}
export function update() {}
