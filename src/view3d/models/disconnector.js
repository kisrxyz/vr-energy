// Разъединитель: рама на опоре, два изолятора, поворотный нож, шкаф привода
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.3, 1.95, 0.3, M.galv, 0, 0.975, 0));
  g.add(k.box(0.28, 0.22, 2 * S3 + 0.5, M.galv, 0, 2.06, 0));
  for (const [i, z] of [[0, -S3], [1, S3]]) { g.add(k.cyl(0.1, H3 - 2.23, M.porcelain, 0, (2.17 + H3 - 0.06) / 2, z)); g.add(k.box(0.18, 0.1, 0.24, k.node(i), 0, H3, z)); }
  d.pivot = k.group(0, H3 + 0.06, -S3);
  d.pivot.add(k.box(0.08, 0.08, 2 * S3, M.blade, 0, 0, S3));
  g.add(d.pivot);
  g.add(k.box(0.4, 0.55, 0.32, M.cabinet, 0.75, 0.9, 0));
  k.lamp(0.75, 1.24, 0, 0.1);
  d.ang = 0; d.angT = 0;
  return { label: [0, H3 + 1.0, 0] };
}
export function update(d, s) { d.angT = s.on ? 0 : -1.35; d.lampState = s.on ? 'on' : 'off'; }
