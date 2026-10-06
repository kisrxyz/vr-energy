// Трансформатор напряжения: опора, бак, ввод к проводу
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.36, 1.3, 0.36, M.galv, 0, 0.65, 0));
  g.add(k.box(0.7, 0.7, 0.6, M.tank, 0, 1.65, 0));
  g.add(k.insulator(0, 2.0, 2.75, 0, 0.08));
  g.add(k.tube([0, 2.75, 0], k.port(0), 0.035, k.node(0)));
  return { label: [0, 3.0, 0.5] };
}
export function update() {}
