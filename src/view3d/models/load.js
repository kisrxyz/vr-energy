// Потребитель: здание, окна светятся под напряжением; ввод — три фазы на изоляторах на стене
export function build(k, el, d) {
  const { T, M, S3, H3 } = k, g = d.group;
  const bw = 4.4, bd = 3.6, bh = 3.1, z0 = 0.5, wt = k.winTex(), p = k.poles(0), s = Math.min(k.gap(0), 0.5);
  g.add(k.box(bw, bh, bd, M.wall, 0, bh / 2, z0 + bd / 2));
  g.add(k.box(bw + 0.3, 0.22, bd + 0.3, M.roof, 0, bh + 0.11, z0 + bd / 2));
  d.win = new T.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.mask, emissive: 0, emissiveIntensity: 1, roughness: 0.6 });
  for (const [z, ry] of [[z0 - 0.01, Math.PI], [z0 + bd + 0.01, 0]]) {
    const m = new T.Mesh(new T.PlaneGeometry(bw - 0.3, bh - 0.5), d.win);
    m.position.set(0, bh / 2, z); m.rotation.y = ry; g.add(m);
  }
  k.tri(s, (x, j) => {
    g.add(k.tube(p[j], [x, bh - 0.35, z0 - 0.05], 0.035, k.node(0)));
    g.add(k.cyl(0.06, 0.35, M.porcelain, x, bh - 0.35, z0 - 0.12, 'z'));
  });
  d.winOn = k.PAL.ui.window;
  return { label: [0, bh + 1.0, z0 + bd / 2] };
}
export function update(d, s) { d.win.emissive.setHex(s.live(0) ? d.winOn : 0); }
