// Заземляющий нож трёхполюсный: стойка, вал поперёк фаз, три ножа от земли к контактам (одна подвижная часть), лампа положения.
// Фазы — по местной оси x (k.gap); контакт каждой фазы — на высоте проводов у вывода
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, hz = 0.45, hy = 1.15, gap = k.gap(0);
  g.add(k.box(0.26, hy, 0.26, M.galv, 0, hy / 2, hz));
  g.add(k.box(0.8, 0.04, 0.8, M.plate, 0, 0.02, hz + 0.3));
  g.add(k.cyl(0.04, 2 * gap + 0.16, M.galv, 0, hy, hz, 'x'));
  // неподвижные контакты фаз — на опорных изоляторах; стойка с траверсой под ними
  g.add(k.box(0.18, 2.6, 0.18, M.galv, 0, 1.3, -S3));
  g.add(k.box(2 * gap + 0.2, 0.1, 0.14, M.galv, 0, 2.63, -S3));
  k.tri(gap, x => {
    g.add(k.box(0.2, 0.12, 0.26, k.node(0), x, H3, -S3));
    g.add(k.cyl(0.05, H3 - 2.74, M.porcelain, x, (H3 + 2.74) / 2 - 0.03, -S3));
  });
  const L = Math.hypot(H3 - hy, S3 + hz);
  d.pivot = k.group(0, hy, hz);
  k.tri(gap, x => d.pivot.add(k.solo(k.box(0.07, L, 0.07, el.t === 'kz' ? M.stripe : M.earthBlade, x, L / 2, 0))));
  g.add(d.pivot);
  d.closedAng = -Math.atan2(S3 + hz, H3 - hy); d.openAng = 1.2;
  k.lamp(0, hy + 0.14, hz + 0.24, 0.1);
  d.ang = d.openAng; d.angT = d.openAng;
  return { label: [0, 2.3, hz + 0.4] };
}
export function update(d, s) { d.angT = s.on ? d.closedAng : d.openAng; d.lampState = s.on ? 'on' : 'off'; }
