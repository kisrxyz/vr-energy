// Предохранитель: два опорных изолятора на раме, патрон между ними (снят — патрона нет)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, y = 2.4, z0 = 0.45;
  g.add(k.box(0.22, y - 0.55, 0.22, M.galv, 0, (y - 0.55) / 2, 0));
  g.add(k.box(0.2, 0.12, 1.3, M.galv, 0, y - 0.5, 0));
  for (const [i, z] of [[0, -z0], [1, z0]]) {
    g.add(k.insulator(0, y - 0.44, y - 0.06, z, 0.07));
    g.add(k.box(0.14, 0.12, 0.14, M.galv, 0, y, z));
    g.add(k.tube([0, y + 0.06, z], k.port(i), 0.03, k.node(i)));
  }
  d.show = k.group(0, y + 0.04, 0);
  d.show.add(k.cyl(0.09, 2 * z0 - 0.1, M.porcelain, 0, 0, 0, 'z'));
  d.show.add(k.cyl(0.1, 0.08, M.galv, 0, 0, -z0 + 0.06, 'z'), k.cyl(0.1, 0.08, M.galv, 0, 0, z0 - 0.06, 'z'));
  g.add(d.show);
  k.lamp(0.14, y - 0.5, 0, 0.08);
  return { label: [0, H3 + 0.6, 0] };
}
export function update(d, s) {
  d.show.visible = s.on || s.blown;
  d.lampState = s.blown ? 'blown' : s.on ? 'on' : 'off';
}
