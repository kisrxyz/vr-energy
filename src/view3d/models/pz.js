// Переносное заземление трёхфазное: три зажима на фазах провода (шины), закоротки между фазами, гибкий провод к заземлителю, штырь в земле.
// Фазы — поперёк провода (местная ось z), высота и шаг — у провода или шины в этой точке (d.at = { y, gap } задаёт вид; без него — провод на H3).
// Снято — на месте наложения стоит жёлто-чёрный указатель места.
export function build(k, el, d) {
  const { M, H3 } = k, g = d.group, gx = 0.9, gz = 0.6, y = d.at ? d.at.y : H3, gap = d.at ? d.at.gap : k.gap(0);
  d.show = k.group();
  for (const j of [-1, 0, 1]) {
    d.show.add(k.box(0.12, 0.16, 0.14, M.earthBlade, 0, y - 0.04, j * gap));
    d.show.add(k.tube([0, y - 0.12, j * gap], [0, y - 0.32, j * gap], 0.022, M.pzCable));
  }
  // закоротка между фазами и спуск от неё к заземлителю
  d.show.add(k.tube([0, y - 0.32, -gap], [0, y - 0.32, gap], 0.025, M.pzCable));
  d.show.add(k.tube([0, y - 0.32, 0], [gx * 0.5, 1.4, gz * 0.5], 0.025, M.pzCable));
  d.show.add(k.tube([gx * 0.5, 1.4, gz * 0.5], [gx, 0.25, gz], 0.025, M.pzCable));
  d.show.add(k.box(0.14, 0.12, 0.14, M.earthBlade, gx, 0.2, gz));
  d.show.add(k.cyl(0.025, 0.5, M.galv, gx, 0.05, gz));
  g.add(d.show);
  if (!el.pseudo) {
    d.mark = k.group(gx, 0, gz);
    d.mark.add(k.cyl(0.05, 0.9, M.stripe, 0, 0.45, 0));
    g.add(d.mark);
  }
  k.lamp(gx, 0.95, gz, 0.07);
  return { label: [gx, 1.6, gz] };
}
export function update(d, s) {
  d.show.visible = !!s.on;
  if (d.mark) d.mark.visible = !s.on;
  d.lampState = s.on ? 'on' : 'off';
}
