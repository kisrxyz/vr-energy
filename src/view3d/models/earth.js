// Заземляющий нож: стойка, нож от земли к проводу, лампа положения
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, hz = 0.45, hy = 1.15;
  g.add(k.box(0.26, hy, 0.26, M.galv, 0, hy / 2, hz));
  g.add(k.box(0.8, 0.04, 0.8, M.plate, 0, 0.02, hz + 0.3));
  g.add(k.box(0.2, 0.12, 0.26, k.node(0), 0, H3, -S3));
  const L = Math.hypot(H3 - hy, S3 + hz);
  d.pivot = k.group(0, hy, hz);
  d.pivot.add(k.box(0.07, L, 0.07, el.t === 'kz' ? M.stripe : M.earthBlade, 0, L / 2, 0));
  g.add(d.pivot);
  d.closedAng = -Math.atan2(S3 + hz, H3 - hy); d.openAng = 1.2;
  k.lamp(0, hy + 0.14, hz + 0.24, 0.1);
  d.ang = d.openAng; d.angT = d.openAng;
  return { label: [0, 2.3, hz + 0.4] };
}
export function update(d, s) { d.angT = s.on ? d.closedAng : d.openAng; d.lampState = s.on ? 'on' : 'off'; }
