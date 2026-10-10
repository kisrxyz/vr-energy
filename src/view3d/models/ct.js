// Трансформатор тока, по одному на фазу: опора с траверсой, цоколь с коробкой выводов, фарфоровая колонна с рёбрами, головка с фланцами,
// через головку — провод своей фазы. Фазы — по местной оси x (k.gap), головка тоньше при малом шаге
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, gap = k.gap(0), rh = Math.min(0.26, gap * 0.4), p0 = k.poles(0), p1 = k.poles(1);
  g.add(k.box(0.4, 1.5, 0.4, M.galv, 0, 0.75, 0));
  g.add(k.box(2 * gap + 0.5, 0.1, 0.4, M.galv, 0, 1.55, 0));
  k.tri(gap, (x, j) => {
    g.add(k.box(rh * 1.9, 0.25, 0.46, M.tank, x, 1.72, 0));
    g.add(k.box(0.2, 0.16, 0.06, M.cabinet, x, 1.7, 0.26));
    g.add(k.lite(x, 1.85, H3 - rh - 0.06, 0, Math.min(0.13, rh * 0.5), M.porcelain));
    g.add(k.cyl(rh, 0.7, M.tank, x, H3, 0, 'z'));
    for (const z of [-0.33, 0.33]) g.add(k.cyl(rh * 0.77, 0.05, M.galv, x, H3, z, 'z'));
    g.add(k.tube(p0[j], [x, H3, -0.35], 0.035, k.node(0)));
    g.add(k.tube([x, H3, 0.35], p1[j], 0.035, k.node(1)));
  });
  return { label: [0, H3 + 0.8, 0] };
}
export function update() {}
