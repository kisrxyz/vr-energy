// Генератор: корпус на фундаменте, вращающийся ротор с меткой; три фазы от выводов корпуса к проводу
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, p = k.poles(0);
  g.add(k.box(2.8, 0.4, 1.6, M.concrete, 0, 0.2, -0.6));
  g.add(k.cyl(0.75, 2.0, M.motor, 0, 1.15, -0.6, 'x'));
  const rotor = k.group(1.15, 1.15, -0.6);
  rotor.add(k.cyl(0.08, 0.3, M.blade, 0.1, 0, 0, 'x'), k.cyl(0.45, 0.08, M.dark, 0.25, 0, 0, 'x'), k.box(0.1, 0.86, 0.14, M.stripe, 0.25, 0, 0));
  g.add(rotor);
  k.tri(0.25, (x, j) => g.add(k.tube([x, 1.9, -0.6], p[j], 0.035, k.node(0))));
  d.spin = [rotor]; d.speed = 0; d.speedT = 0;
  return { label: [0, 2.6, -0.6] };
}
export function update(d, s) { d.speedT = s.live(0) ? 12 : 0; }
