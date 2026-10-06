// Токоограничивающий реактор: бетонная катушка на трёх изоляторах
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  for (const a of [0, 2.1, 4.2]) g.add(k.insulator(Math.cos(a) * 0.45, 0, 0.6, Math.sin(a) * 0.45, 0.06));
  for (const y of [0.85, 1.25, 1.65]) g.add(k.cyl(0.7, 0.32, M.concrete, 0, y, 0));
  g.add(k.cyl(0.5, 1.15, M.coil, 0, 1.25, 0));
  g.add(k.tube(k.port(0), [0, 1.85, -0.5], 0.04, k.node(0)));
  g.add(k.tube([0, 0.7, 0.5], k.port(1), 0.04, k.node(1)));
  return { label: [0, 2.6, 0] };
}
export function update() {}
