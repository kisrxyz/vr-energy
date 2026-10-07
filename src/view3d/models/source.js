// Энергосистема: решётчатый портал с маяком и уходящая вдаль линия к опоре (дальние части не ловят щелчок)
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  for (const x of [-1.5, 1.5]) g.add(k.lattice(0.3, H3 + 1.3, 0.3, x, (H3 + 1.3) / 2, 0));
  g.add(k.lattice(3.3, 0.3, 0.3, 0, H3 + 1.15, 0));
  g.add(k.insulator(0, H3 + 0.2, H3 + 1.0, 0, 0.05));
  g.add(k.tube([0, H3 + 0.2, 0], [0, H3, S3], 0.04, k.node(0)));
  d.far = [k.tube([0, H3 + 0.2, 0], [0, H3 + 9, -60], 0.05, k.node(0)), k.lattice(0.7, H3 + 11, 0.7, 0, (H3 + 11) / 2, -60.5, 0.9), k.lattice(5, 0.35, 0.35, 0, H3 + 9.3, -60.5, 0.9)];
  g.add(...d.far);
  d.beacon = new k.T.Mesh(k.sphere, new k.T.MeshStandardMaterial({ color: k.PAL.ui.beacon, emissive: k.PAL.ui.beaconGlow, emissiveIntensity: 1 }));
  d.beacon.scale.setScalar(0.13); d.beacon.position.set(0, H3 + 1.45, 0); g.add(d.beacon);
  return { label: [0, H3 + 2.2, 0] };
}
export function update(d, s) { d.beacon.material.emissiveIntensity = s.src ? 1.2 : 0; }
