// Воздушная линия: опора посередине, траверса с тремя изоляторами в сторону от опоры, три провода — от фаз выводов к своим изоляторам.
// Фазы — по местной оси x (k.gap); на опоре фазы шире и сдвинуты от стойки (провода не пересекаются: порядок фаз сохранён)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, h = H3 + 1.4, gap = k.gap(0), p0 = k.poles(0), p1 = k.poles(1), s = Math.max(0.45, gap);
  for (const sx of [-1, 1]) g.add(k.tube([sx * 0.55, 0, 0], [sx * 0.15, h, 0], 0.07, M.galv));
  for (const y of [1.2, 2.4]) g.add(k.box(0.06 + 0.5 * (1 - y / h) * 2, 0.06, 0.06, M.galv, 0, y, 0));
  g.add(k.box(1.25 + 2 * s, 0.14, 0.14, M.galv, 0.375 + s, H3 + 0.85, 0));
  k.tri(gap, (x, j) => {
    const xi = 0.75 + (j + 1) * s;
    g.add(k.lite(xi, H3 + 0.08, H3 + 0.8, 0, 0.05, M.porcelain));
    g.add(k.tube(p0[j], [xi, H3, 0], 0.035, k.node(0)));
    g.add(k.tube([xi, H3, 0], p1[j], 0.035, k.node(1)));
  });
  return { label: [0, h + 0.6, 0] };
}
export function update() {}
