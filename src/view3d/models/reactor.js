// Токоограничивающий реактор трёхфазный: три катушки одна над другой (фазы — снизу вверх) на трёх изоляторах; к каждой катушке —
// отвод своей фазы с одного вывода и от неё — к другому
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, p0 = k.poles(0), p1 = k.poles(1);
  for (const a of [0, 2.1, 4.2]) g.add(k.lite(Math.cos(a) * 0.45, 0, 0.6, Math.sin(a) * 0.45, 0.06, M.porcelain));
  const ys = [0.85, 1.25, 1.65];
  for (const y of ys) g.add(k.cyl(0.7, 0.32, M.concrete, 0, y, 0));
  g.add(k.cyl(0.5, 1.15, M.coil, 0, 1.25, 0));
  // фаза j (по оси x выводов) — к катушке j: отводы в сторону выводов, не пересекаются (верхняя катушка — к ближней по высоте фазе)
  [2, 1, 0].forEach((c, j) => {
    g.add(k.tube(p0[j], [p0[j][0] * 0.6, ys[c] + 0.1, -0.68], 0.03, k.node(0)));
    g.add(k.tube([p1[j][0] * 0.6, ys[c] - 0.1, 0.68], p1[j], 0.03, k.node(1)));
  });
  return { label: [0, 2.6, 0] };
}
export function update() {}
