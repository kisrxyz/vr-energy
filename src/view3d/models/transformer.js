// Силовой трансформатор: фундамент, бак, радиаторы с вентиляторами, расширитель, вводы.
// tank() общий для двух- и трёхобмоточного трансформатора и ТСН.
// o.bush — группы вводов: [x, z, высота, номер точки подключения]; у группы три ввода по x, провод — от среднего.
export function tank(k, d, o) {
  const { M } = k, g = d.group, w = o.w || 1.9, h = o.h || 2.1, l = o.l || 2.3, top = 0.3 + h;
  g.add(k.box(w + 0.5, 0.3, l + 0.7, M.concrete, 0, 0.15, 0));
  g.add(k.box(w, h, l, M.tank, 0, 0.3 + h / 2, 0));
  d.spin = [];
  if (o.fans !== false) for (const sx of [-1, 1]) {
    g.add(k.box(0.28, h * 0.8, l * 0.82, M.radiator, sx * (w / 2 + 0.17), 0.3 + h * 0.48, 0));
    for (const z of [-l * 0.22, l * 0.22]) {
      const f = k.group(sx * (w / 2 + 0.36), 0.72, z);
      f.add(k.box(0.04, 0.5, 0.08, M.fan), k.box(0.04, 0.08, 0.5, M.fan));
      g.add(f); d.spin.push(f);
    }
  }
  g.add(k.cyl(0.25, w * 0.75, M.tank, 0, top + 0.38, -l * 0.15, 'x'));
  for (const [x, z, hb, i, dx = 0.3] of o.bush) {
    for (const bx of o.single ? [x] : [x - dx, x, x + dx]) g.add(k.cyl(0.07, hb, M.porcelain, bx, top + hb / 2, z));
    g.add(k.tube([x, top + hb, z], k.port(i), 0.04, k.node(i)));
  }
  d.speed = 0; d.speedT = 0;
}
export function build(k, el, d) {
  tank(k, d, { bush: [[0, -0.75, 1.2, 0, 0.5], [0, 0.75, 0.6, 1, 0.45]] });
  return { label: [0, 4.5, 0] };
}
export function update(d, s) { d.speedT = s.live(0) || s.live(1) ? 7 : 0; }
