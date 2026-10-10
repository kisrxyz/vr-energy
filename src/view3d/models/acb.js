// Автомат 0,4 кВ на стойке: корпус, рукоятка, индикатор; выводы — по три (фазы)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, w = Math.min(0.13, k.gap(0));
  g.add(k.box(0.16, H3 + 0.35, 0.16, M.galv, -0.55, (H3 + 0.35) / 2, 0));
  g.add(k.box(0.45, 0.12, 0.12, M.galv, -0.33, H3 - 0.3, 0));
  g.add(k.box(0.44, 0.72, 0.62, M.qf, 0, H3, 0));
  for (const [i, sg] of [[0, -1], [1, 1]]) { const p = k.poles(i); k.tri(w, (x, j) => g.add(k.tube([x, H3, sg * 0.31], p[j], 0.03, k.node(i)))); }
  d.lever = k.group(0.24, H3 + 0.02, 0); d.lever.add(k.box(0.05, 0.28, 0.07, M.handle, 0.02, 0.14, 0)); g.add(d.lever);
  k.lamp(0.24, H3 + 0.27, 0, 0.07);
  return { label: [0, H3 + 0.85, 0] };
}
export function update(d, s) { d.lampState = s.on ? 'on' : 'off'; d.leverT = s.on ? -0.35 : -2.7; }
