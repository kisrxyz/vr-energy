// Двигатель с насосом: ротор вращается под напряжением; три фазы к коробке выводов
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, z = 0.9, p = k.poles(0);
  g.add(k.box(2.2, 0.3, 0.9, M.concrete, 0.3, 0.15, z));
  g.add(k.cyl(0.38, 1.0, M.motor, -0.25, 0.68, z, 'x'));
  g.add(k.box(0.36, 0.26, 0.3, M.motor, -0.25, 1.15, z));
  const rotor = k.group(0.4, 0.68, z);
  rotor.add(k.cyl(0.05, 0.4, M.blade, 0.1, 0, 0, 'x'), k.cyl(0.3, 0.08, M.dark, 0.3, 0, 0, 'x'), k.box(0.09, 0.58, 0.12, M.stripe, 0.3, 0, 0));
  g.add(rotor);
  g.add(k.cyl(0.32, 0.55, M.pump, 1.05, 0.62, z, 'x'));
  k.tri(0.1, (x, j) => g.add(k.tube(p[j], [-0.25 + x, 1.28, z], 0.03, k.node(0))));
  d.spin = [rotor]; d.speed = 0; d.speedT = 0;
  return { label: [0, 2.0, z] };
}
export function update(d, s) { d.speedT = s.live(0) ? 16 : 0; }
