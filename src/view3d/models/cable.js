// Кабельная линия: концевые муфты на кронштейнах, спуски в землю и кабельный канал между концами
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, L = 2 * S3 - 0.35, y = H3 - 0.75;
  for (const [i, z] of [[0, -L], [1, L]]) {
    g.add(k.box(0.12, y - 0.3, 0.12, M.galv, 0.35, (y - 0.3) / 2, z));
    g.add(k.box(0.5, 0.08, 0.12, M.galv, 0.15, y - 0.3, z));
    g.add(k.cone(0.13, 0.06, 0.55, M.porcelain, 0, y, z));
    g.add(k.tube([0, y + 0.27, z], k.port(i), 0.03, k.node(i)));
    g.add(k.tube([0, y - 0.27, z], [0, 0.06, z], 0.045, M.dark));
  }
  g.add(k.box(0.5, 0.08, 2 * L + 0.4, M.concrete, 0, 0.04, 0));
  return { label: [0.4, H3 + 0.6, 0] };
}
export function update() {}
