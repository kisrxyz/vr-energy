// Трансформатор напряжения: опора, бак с крышкой и коробкой вторичных выводов, ввод с рёбрами к проводу
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.36, 1.3, 0.36, M.galv, 0, 0.65, 0));
  g.add(k.box(0.5, 0.05, 0.5, M.galv, 0, 1.325, 0));
  g.add(k.box(0.7, 0.7, 0.6, M.tank, 0, 1.65, 0));
  g.add(k.box(0.66, 0.05, 0.56, M.tank, 0, 2.025, 0));
  for (const fx of [-0.2, 0, 0.2]) g.add(k.box(0.05, 0.6, 0.02, M.tank, fx, 1.65, 0.3));
  g.add(k.box(0.22, 0.2, 0.08, M.cabinet, 0.18, 1.55, -0.33));
  g.add(k.insulator(0, 2.05, 2.75, 0, 0.08));
  g.add(k.tube([0, 2.75, 0], k.port(0), 0.035, k.node(0)));
  return { label: [0, 3.0, 0.5] };
}
export function update() {}
