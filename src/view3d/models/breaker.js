// Выключатель ОРУ: бак на опоре, два ввода, шкаф привода с лампой и рукояткой
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(0.4, 1.95, 0.4, M.galv, 0, 0.975, 0));
  g.add(k.cyl(0.34, 2 * S3 + 0.4, M.tank, 0, 2.3, 0, 'z'));
  for (const [i, z] of [[0, -S3], [1, S3]]) { g.add(k.cyl(0.1, H3 - 2.55, M.porcelain, 0, (2.55 + H3) / 2, z)); g.add(k.cyl(0.07, 0.14, k.node(i), 0, H3, z)); }
  g.add(k.box(0.7, 1.3, 0.5, M.cabinet, 1.05, 0.65, 0));
  k.lamp(1.05, 1.44, 0);
  d.lever = k.group(1.42, 0.8, 0); d.lever.add(k.box(0.06, 0.38, 0.06, M.handle, 0, 0.19, 0)); g.add(d.lever);
  return { label: [0, H3 + 0.9, 0] };
}
export function update(d, s) { d.lampState = s.on ? 'on' : 'off'; d.leverT = s.on ? -0.6 : 0.6; }
