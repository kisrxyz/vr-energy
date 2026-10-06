// Воздушная линия: опора посередине, гирлянда изоляторов, провод на высоте шин
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, h = H3 + 1.4;
  for (const sx of [-1, 1]) g.add(k.tube([sx * 0.55, 0, 0], [sx * 0.15, h, 0], 0.07, M.galv));
  for (const y of [1.2, 2.4]) g.add(k.box(0.06 + 0.5 * (1 - y / h) * 2, 0.06, 0.06, M.galv, 0, y, 0));
  g.add(k.box(2.2, 0.14, 0.14, M.galv, 0, H3 + 0.85, 0));
  g.add(k.insulator(0.9, H3 + 0.08, H3 + 0.8, 0, 0.05));
  g.add(k.tube(k.port(0), [0.9, H3, 0], 0.04, k.node(0)));
  g.add(k.tube([0.9, H3, 0], k.port(1), 0.04, k.node(1)));
  return { label: [0, h + 0.6, 0] };
}
export function update() {}
