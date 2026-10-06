// ОПН: опора, колонна с юбками, отвод к проводу и спуск к заземлителю
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.3, 1.5, 0.3, M.galv, 0, 0.75, 0));
  g.add(k.insulator(0, 1.5, 2.8, 0, 0.09));
  g.add(k.cyl(0.13, 0.08, M.galv, 0, 2.84, 0));
  g.add(k.tube([0, 2.88, 0], k.port(0), 0.035, k.node(0)));
  g.add(k.tube([0.17, 1.4, 0], [0.17, 0.05, 0], 0.025, M.earthBlade));
  return { label: [0, 3.2, 0.5] };
}
export function update() {}
