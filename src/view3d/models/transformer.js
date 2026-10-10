// Силовой трансформатор: фундамент, бак с рёбрами жёсткости и крышкой, пластинчатые радиаторы с вентиляторами,
// расширитель на опорах с маслоуказателем, вводы с рёбрами, шкаф привода РПН.
// tank() общий для двух- и трёхобмоточного трансформатора и ТСН.
// o.bush — группы вводов: [x, z, высота, номер точки подключения, шаг]; у группы три ввода по x — по фазе, от каждого — отвод к своему полюсу вывода.
export function tank(k, d, o) {
  const { M } = k, g = d.group, w = o.w || 1.9, h = o.h || 2.1, l = o.l || 2.3, top = 0.3 + h;
  g.add(k.box(w + 0.5, 0.3, l + 0.7, M.concrete, 0, 0.15, 0));
  g.add(k.box(w, h, l, M.tank, 0, 0.3 + h / 2, 0));
  // крышка с бортиком и рёбра жёсткости на торцах бака
  g.add(k.box(w + 0.06, 0.07, l + 0.06, M.tank, 0, top + 0.035, 0));
  for (const sz of [-1, 1]) for (const fx of [-0.3, 0, 0.3]) g.add(k.box(0.07, h * 0.92, 0.05, M.tank, fx * w, 0.3 + h * 0.48, sz * (l / 2 + 0.025)));
  d.spin = [];
  if (o.fans !== false) for (const sx of [-1, 1]) {
    // радиатор — пластины поперёк бака, коллекторы сверху и снизу, патрубки к баку
    g.add(k.fins(sx * (w / 2 + 0.17), 0.3 + h * 0.48, 0, Math.max(8, Math.round(l * 5)), l * 0.82, 0.28, h * 0.8, M.radiator));
    for (const yy of [0.3 + h * 0.86, 0.3 + h * 0.12]) g.add(k.cyl(0.05, 0.12, M.radiator, sx * (w / 2 + 0.04), yy, 0, 'x'));
    for (const z of [-l * 0.22, l * 0.22]) {
      const f = k.group(sx * (w / 2 + 0.36), 0.72, z);
      f.add(k.box(0.04, 0.5, 0.08, M.fan), k.box(0.04, 0.08, 0.5, M.fan));
      g.add(f); d.spin.push(f);
    }
  }
  // расширитель: на двух опорах, торцевые крышки, маслоуказатель, труба к баку (газовое реле)
  const cz = -l * 0.15, cy = top + 0.38, cl = w * 0.75;
  g.add(k.cyl(0.25, cl, M.tank, 0, cy, cz, 'x'));
  for (const sx of [-1, 1]) { g.add(k.cyl(0.26, 0.04, M.tank, sx * cl / 2, cy, cz, 'x')); g.add(k.box(0.06, 0.3, 0.06, M.tank, sx * cl * 0.33, top + 0.15, cz)); }
  g.add(k.cyl(0.07, 0.03, M.dark, cl / 2 + 0.02, cy, cz, 'x'));
  g.add(k.cyl(0.035, 0.3, M.tank, -cl * 0.1, top + 0.15, cz + 0.12));
  g.add(k.box(0.12, 0.1, 0.1, M.cabinet, -cl * 0.1, top + 0.08, cz + 0.12));
  // шкаф привода РПН на торце бака
  if (o.fans !== false) g.add(k.box(0.5, 0.75, 0.22, M.cabinet, w * 0.22, 0.3 + h * 0.4, -(l / 2 + 0.11)));
  for (const [x, z, hb, i, dx = 0.3] of o.bush) {
    const r = Math.min(0.07, dx * 0.24), poles = k.poles(i);
    [-1, 0, 1].forEach((j, n) => {
      g.add(k.lite(x + j * dx, top, top + hb, z, r, M.porcelain));
      g.add(k.tube([x + j * dx, top + hb, z], poles[n], 0.035, k.node(i)));
    });
  }
  d.speed = 0; d.speedT = 0;
}
export function build(k, el, d) {
  tank(k, d, { bush: [[0, -0.75, 1.2, 0, 0.5], [0, 0.75, 0.6, 1, 0.45]] });
  return { label: [0, 4.5, 0] };
}
export function update(d, s) { d.speedT = s.live(0) || s.live(1) ? 7 : 0; }
