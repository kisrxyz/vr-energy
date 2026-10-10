// Рубильник 0,4 кВ: панель щита, вводы сверху — по три (фазы), рукоятка на лицевой стороне
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, w = Math.min(0.14, k.gap(0));
  g.add(k.box(0.5, 1.9, 1.1, M.cabinet, 0, 0.95, 0));
  for (const [i, z] of [[0, -0.35], [1, 0.35]]) { const p = k.poles(i); k.tri(w, (x, j) => g.add(k.tube([x, 1.9, z], p[j], 0.025, k.node(i)))); }
  if (+el.p.arc) g.add(k.box(0.06, 0.25, 0.7, M.dark, 0.27, 1.6, 0));
  d.lever = k.group(0.28, 1.2, 0);
  d.lever.add(k.box(0.06, 0.45, 0.06, M.handle, 0.02, 0.22, 0), k.box(0.08, 0.08, 0.2, M.handle, 0.02, 0.45, 0));
  g.add(d.lever);
  k.lamp(0.27, 1.75, -0.38, 0.06);
  return { label: [0, 2.6, 0] };
}
export function update(d, s) { d.lampState = s.on ? 'on' : 'off'; d.leverT = s.on ? 0 : -2.2; }
