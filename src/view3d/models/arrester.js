// ОПН, по одному на фазу: опора с траверсой, полимерные колонны с рёбрами, отводы к фазам провода и спуски к заземлителю.
// Фазы — по местной оси x (k.gap)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, gap = k.gap(0), p = k.poles(0);
  g.add(k.box(0.3, 1.45, 0.3, M.galv, 0, 0.725, 0));
  g.add(k.box(2 * gap + 0.3, 0.08, 0.26, M.galv, 0, 1.47, 0));
  k.tri(gap, (x, j) => {
    g.add(k.lite(x, 1.5, 2.8, 0, 0.09, M.polymer));
    g.add(k.cyl(0.13, 0.08, M.galv, x, 2.84, 0));
    g.add(k.tube([x, 2.88, 0], p[j], 0.03, k.node(0)));
    g.add(k.tube([x + 0.17, 1.4, 0], [x + 0.17, 0.05, 0], 0.02, M.earthBlade));
  });
  return { label: [0, 3.2, 0.5] };
}
export function update() {}
