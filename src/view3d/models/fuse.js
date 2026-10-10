// Предохранители, по одному на фазу: на общей раме по два опорных изолятора, патрон между ними (снят — патронов нет).
// Фазы — по местной оси x (k.gap); патроны трёх фаз — одна часть (ставят и снимают вместе)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, y = 2.4, z0 = 0.45, gap = k.gap(0), p0 = k.poles(0), p1 = k.poles(1);
  g.add(k.box(0.22, y - 0.55, 0.22, M.galv, 0, (y - 0.55) / 2, 0));
  g.add(k.box(2 * gap + 0.2, 0.12, 1.3, M.galv, 0, y - 0.5, 0));
  d.show = k.group(0, y + 0.04, 0);
  k.tri(gap, (x, j) => {
    for (const [i, z] of [[0, -z0], [1, z0]]) {
      g.add(k.lite(x, y - 0.44, y - 0.06, z, 0.06, M.porcelain));
      g.add(k.box(0.12, 0.12, 0.14, M.galv, x, y, z));
      g.add(k.tube([x, y + 0.06, z], (i ? p1 : p0)[j], 0.025, k.node(i)));
    }
    d.show.add(k.cyl(Math.min(0.09, gap * 0.3), 2 * z0 - 0.1, M.porcelain, x, 0, 0, 'z'));
    d.show.add(k.cyl(Math.min(0.1, gap * 0.32), 0.08, M.galv, x, 0, -z0 + 0.06, 'z'), k.cyl(Math.min(0.1, gap * 0.32), 0.08, M.galv, x, 0, z0 - 0.06, 'z'));
  });
  g.add(d.show);
  k.lamp(gap + 0.16, y - 0.5, 0, 0.08);
  return { label: [0, H3 + 0.6, 0] };
}
export function update(d, s) {
  d.show.visible = s.on || s.blown;
  d.lampState = s.blown ? 'blown' : s.on ? 'on' : 'off';
}
