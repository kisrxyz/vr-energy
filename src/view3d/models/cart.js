// Ячейка КРУ с выкатной тележкой: шкаф, вводы сверху, тележка выкатывается вперёд (+x).
// Рабочее положение — тележка в шкафу, контрольное — выдвинута на полметра, ремонтное — выкачена из шкафа.
export function build(k, el, d, disc) {
  const { M, S3, H3 } = k, g = d.group;
  g.add(k.box(1.0, 2.3, 1.7, M.kru, 0, 1.15, 0));
  g.add(k.box(0.03, 1.15, 1.3, M.dark, 0.5, 0.88, 0));
  g.add(k.box(1.02, 0.08, 1.72, M.galv, 0, 2.3, 0));
  for (const [i, z] of [[0, -0.45], [1, 0.45]]) {
    g.add(k.cyl(0.07, 0.45, M.porcelain, 0, 2.55, z));
    g.add(k.tube([0, 2.78, z], k.port(i), 0.035, k.node(i)));
  }
  d.slide = k.group(0, 0, 0);
  d.slide.add(k.box(0.8, 0.1, 1.0, M.dark, 0.15, 0.2, 0));
  if (disc) {
    d.slide.add(k.box(0.5, 0.9, 0.5, M.cabinet, 0.15, 0.7, 0));
    d.slide.add(k.box(0.08, 0.08, 0.9, M.blade, -0.15, 1.3, 0));
  } else {
    d.slide.add(k.box(0.55, 0.85, 0.95, M.qf, 0.2, 0.68, 0));
    for (const z of [-0.3, 0, 0.3]) d.slide.add(k.cyl(0.07, 0.45, M.dark, -0.2, 1.05, z, 'x'));
  }
  g.add(d.slide);
  d.slideX = 0; d.slideT = 0;
  k.lamp(0.53, 1.95, -0.45, 0.09);
  return { label: [0, H3 + 0.6, 0] };
}
export function update(d, s) {
  d.lampState = s.on ? 'on' : 'off';
  d.slideT = s.pos === 'work' ? 0 : s.pos === 'test' ? 0.45 : 1.5;
}
