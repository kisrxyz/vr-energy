// Энергосистема: портал с маяком и уходящая вдаль линия (дальние части не ловят щелчок)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  for (const x of [-1.5, 1.5]) g.add(k.box(0.3, H3 + 1.3, 0.3, M.galv, x, (H3 + 1.3) / 2, 0));
  g.add(k.box(3.3, 0.3, 0.3, M.galv, 0, H3 + 1.15, 0));
  g.add(k.cyl(0.07, 0.8, M.porcelain, 0, H3 + 0.6, 0));
  g.add(k.tube([0, H3 + 0.2, 0], [0, H3, S3], 0.04, k.node(0)));
  d.far = [k.tube([0, H3 + 0.2, 0], [0, H3 + 9, -60], 0.05, k.node(0)), k.box(0.7, H3 + 11, 0.7, M.galv, 0, (H3 + 11) / 2, -60.5), k.box(5, 0.35, 0.35, M.galv, 0, H3 + 9.3, -60.5)];
  g.add(...d.far);
  d.beacon = new k.T.Mesh(k.sphere, new k.T.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff2020, emissiveIntensity: 1 }));
  d.beacon.scale.setScalar(0.13); d.beacon.position.set(0, H3 + 1.45, 0); g.add(d.beacon);
  return { label: [0, H3 + 2.2, 0] };
}
export function update(d, s) { d.beacon.material.emissiveIntensity = s.src ? 1.2 : 0; }
