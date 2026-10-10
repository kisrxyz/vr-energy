// Энергосистема: решётчатый портал с маяком, три гирлянды на траверсе и три провода линии вдаль к опоре (дальние части не ловят щелчок).
// Фазы — по местной оси x (k.gap); на дальней опоре провода расходятся шире, как на настоящей ВЛ
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, gap = k.gap(0), p = k.poles(0), far = Math.max(1.6, gap * 2.4);
  for (const x of [-1.5, 1.5]) g.add(k.lattice(0.3, H3 + 1.3, 0.3, x, (H3 + 1.3) / 2, 0));
  g.add(k.lattice(3.3, 0.3, 0.3, 0, H3 + 1.15, 0));
  d.far = [k.lattice(0.7, H3 + 11, 0.7, 0, (H3 + 11) / 2, -60.5, 0.9), k.lattice(2 * far + 1.2, 0.35, 0.35, 0, H3 + 9.3, -60.5, 0.9)];
  k.tri(gap, (x, j) => {
    g.add(k.lite(x, H3 + 0.2, H3 + 1.0, 0, 0.05, M.porcelain));
    g.add(k.tube([x, H3 + 0.2, 0], p[j], 0.035, k.node(0)));
    d.far.push(k.tube([x, H3 + 0.2, 0], [x / gap * far || 0, H3 + 9, -60], 0.045, k.node(0)));
  });
  g.add(...d.far);
  d.beacon = new k.T.Mesh(k.sphere, new k.T.MeshStandardMaterial({ color: k.PAL.ui.beacon, emissive: k.PAL.ui.beaconGlow, emissiveIntensity: 1 }));
  d.beacon.scale.setScalar(0.13); d.beacon.position.set(0, H3 + 1.45, 0); g.add(d.beacon);
  return { label: [0, H3 + 2.2, 0] };
}
export function update(d, s) { d.beacon.material.emissiveIntensity = s.src ? 1.2 : 0; }
