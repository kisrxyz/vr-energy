// Разъединитель: рама на опоре, две колонки изоляторов с рёбрами, контакты, поворотный нож, шкаф привода и тяга к раме
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.3, 1.95, 0.3, M.galv, 0, 0.975, 0));
  g.add(k.box(0.3, 0.05, 0.4, M.galv, 0, 0.025, 0));
  g.add(k.box(0.28, 0.22, 2 * S3 + 0.5, M.galv, 0, 2.06, 0));
  for (const [i, z] of [[0, -S3], [1, S3]]) {
    g.add(k.cyl(0.13, 0.06, M.galv, 0, 2.2, z));
    g.add(k.insulator(0, 2.23, H3 - 0.06, z, 0.075));
    g.add(k.box(0.18, 0.1, 0.24, k.node(i), 0, H3, z));
  }
  // шкаф привода с дверью и вертикальная тяга к валу на раме
  g.add(k.box(0.4, 0.55, 0.32, M.cabinet, 0.75, 0.9, 0));
  g.add(k.box(0.006, 0.45, 0.26, M.cabinet, 0.951, 0.9, 0));
  g.add(k.box(0.006, 0.05, 0.03, M.handle, 0.954, 0.82, 0.08));
  g.add(k.tube([0.75, 1.18, 0], [0.75, 1.95, 0], 0.025, M.galv));
  g.add(k.tube([0.75, 1.95, 0], [0.14, 2.0, 0], 0.025, M.galv));
  d.pivot = k.group(0, H3 + 0.06, -S3);
  d.pivot.add(k.box(0.08, 0.08, 2 * S3, M.blade, 0, 0, S3));
  g.add(d.pivot);
  k.lamp(0.75, 1.24, 0, 0.1);
  d.ang = 0; d.angT = 0;
  return { label: [0, H3 + 1.0, 0] };
}
export function update(d, s) { d.angT = s.on ? 0 : -1.35; d.lampState = s.on ? 'on' : 'off'; }
