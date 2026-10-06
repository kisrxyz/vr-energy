// Потребитель: здание, окна светятся под напряжением
export function build(k, el, d) {
  const { T, M, S3, H3 } = k, g = d.group;
  const bw = 4.4, bd = 3.6, bh = 3.1, z0 = 0.5, wt = k.winTex();
  g.add(k.box(bw, bh, bd, M.wall, 0, bh / 2, z0 + bd / 2));
  g.add(k.box(bw + 0.3, 0.22, bd + 0.3, M.roof, 0, bh + 0.11, z0 + bd / 2));
  d.win = new T.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.mask, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.6 });
  for (const [z, ry] of [[z0 - 0.01, Math.PI], [z0 + bd + 0.01, 0]]) {
    const m = new T.Mesh(new T.PlaneGeometry(bw - 0.3, bh - 0.5), d.win);
    m.position.set(0, bh / 2, z); m.rotation.y = ry; g.add(m);
  }
  g.add(k.tube([0, H3, -S3], [0, bh - 0.35, z0 - 0.05], 0.04, k.node(0)));
  g.add(k.cyl(0.07, 0.35, M.porcelain, 0, bh - 0.35, z0 - 0.12, 'z'));
  return { label: [0, bh + 1.0, z0 + bd / 2] };
}
export function update(d, s) { d.win.emissive.setHex(s.live(0) ? 0xffcf70 : 0x000000); }
