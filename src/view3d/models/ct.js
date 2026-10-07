// Трансформатор тока: опора, цоколь с коробкой выводов, фарфоровая колонна с рёбрами, головка с фланцами, через неё — провод
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.5, 1.6, 0.5, M.galv, 0, 0.8, 0));
  g.add(k.box(0.5, 0.25, 0.5, M.tank, 0, 1.72, 0));
  g.add(k.box(0.2, 0.16, 0.06, M.cabinet, 0, 1.7, 0.28));
  g.add(k.insulator(0, 1.85, H3 - 0.32, 0, 0.13));
  g.add(k.cyl(0.26, 0.7, M.tank, 0, H3, 0, 'z'));
  for (const z of [-0.33, 0.33]) g.add(k.cyl(0.2, 0.05, M.galv, 0, H3, z, 'z'));
  g.add(k.tube(k.port(0), [0, H3, -0.35], 0.04, k.node(0)));
  g.add(k.tube([0, H3, 0.35], k.port(1), 0.04, k.node(1)));
  return { label: [0, H3 + 0.8, 0] };
}
export function update() {}
