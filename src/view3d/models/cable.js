// Кабельная линия: на каждом конце — три концевые муфты на кронштейне (по фазе), отводы к фазам провода, под муфтами — разделка
// трёхжильного кабеля, один спуск в землю; кабельный канал между концами. Фазы — по местной оси x (k.gap)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, L = 2 * S3 - 0.35, y = H3 - 0.75, gap = k.gap(0);
  for (const [i, z] of [[0, -L], [1, L]]) {
    const p = k.poles(i);
    g.add(k.box(0.12, y - 0.3, 0.12, M.galv, gap + 0.35, (y - 0.3) / 2, z));
    g.add(k.box(2 * gap + 0.6, 0.08, 0.12, M.galv, 0.15, y - 0.3, z));
    k.tri(gap, (x, j) => {
      g.add(k.cone(0.11, 0.05, 0.55, M.porcelain, x, y, z));
      g.add(k.tube([x, y + 0.27, z], p[j], 0.028, k.node(i)));
      g.add(k.tube([x, y - 0.27, z], [0, y - 0.62, z], 0.03, M.dark));
    });
    g.add(k.tube([0, y - 0.62, z], [0, 0.06, z], 0.05, M.dark));
  }
  g.add(k.box(0.5, 0.08, 2 * L + 0.4, M.concrete, 0, 0.04, 0));
  return { label: [0.4, H3 + 0.6, 0] };
}
export function update() {}
