// Трансформаторы напряжения — однофазные, по одному на фазу: общая опора и рама, бак с крышкой и коробкой вторичных выводов,
// ввод с рёбрами и отвод к своей фазе провода. Фазы — по местной оси x (k.gap)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, gap = k.gap(0), w = Math.min(0.6, gap * 0.85), p = k.poles(0);
  g.add(k.box(0.36, 1.3, 0.36, M.galv, 0, 0.65, 0));
  g.add(k.box(2 * gap + w, 0.05, 0.5, M.galv, 0, 1.325, 0));
  k.tri(gap, (x, j) => {
    g.add(k.box(w, 0.7, 0.6, M.tank, x, 1.65, 0));
    g.add(k.box(w - 0.04, 0.05, 0.56, M.tank, x, 2.025, 0));
    g.add(k.box(0.05, 0.6, 0.02, M.tank, x, 1.65, 0.3));
    g.add(k.lite(x, 2.05, 2.75, 0, Math.min(0.08, w * 0.2), M.porcelain));
    g.add(k.tube([x, 2.75, 0], p[j], 0.03, k.node(0)));
  });
  g.add(k.box(0.22, 0.2, 0.08, M.cabinet, 0, 1.0, -0.22));
  return { label: [0, 3.0, 0.5] };
}
export function update() {}
