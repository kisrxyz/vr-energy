// Выключатель ОРУ трёхполюсный (баковый): на раме три бака — по баку на фазу, у каждого два ввода с рёбрами и трансформаторами тока
// у основания; шкаф привода с дверью, решёткой и рукояткой, лампа положения. Фазы — по местной оси x (k.gap), бак тоньше при малом шаге
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, gap = k.gap(0), rt = Math.min(0.34, gap * 0.42), yt = 2.3;
  // опора: стойка, рама под баками поперёк фаз и стойки баков
  g.add(k.box(0.4, 1.95, 0.4, M.galv, 0, 0.975, 0));
  g.add(k.box(0.5, 0.06, 0.5, M.galv, 0, 0.03, 0));
  g.add(k.box(0.12, 0.12, 2.2, M.galv, 0, 1.9, 0));
  g.add(k.box(2 * gap + 0.2, 0.12, 0.12, M.galv, 0, 1.9, -0.9), k.box(2 * gap + 0.2, 0.12, 0.12, M.galv, 0, 1.9, 0.9));
  k.tri(gap, x => {
    for (const z of [-0.9, 0.9]) g.add(k.box(0.1, yt - rt - 1.9, 0.1, M.galv, x, (yt - rt + 1.9) / 2, z));
    // бак с днищами и сварными поясами
    g.add(k.cyl(rt, 2 * S3 + 0.4, M.tank, x, yt, 0, 'z', 10));
    for (const z of [-0.6, 0.6]) g.add(k.cyl(rt + 0.006, 0.05, M.tank, x, yt, z, 'z', 10));
    for (const [i, z] of [[0, -S3], [1, S3]]) {
      g.add(k.cyl(rt * 0.47, 0.22, M.tank, x, yt + rt + 0.02, z, undefined, 8));
      g.add(k.lite(x, yt + rt + 0.13, H3 - 0.04, z, Math.min(0.085, rt * 0.3), M.porcelain));
      g.add(k.cyl(0.07, 0.14, k.node(i), x, H3, z, undefined, 8));
    }
  });
  // шкаф привода: корпус, дверь со щелью, решётка, табличка
  g.add(k.box(0.7, 1.3, 0.5, M.cabinet, 1.05, 0.65, 0));
  g.add(k.box(0.02, 1.1, 0.42, M.cabinet, 1.405, 0.67, 0));
  g.add(k.box(0.012, 1.1, 0.012, M.dark, 1.415, 0.67, 0.12));
  for (let i = 0; i < 4; i++) g.add(k.box(0.012, 0.02, 0.22, M.dark, 1.415, 0.3 + i * 0.05, -0.06));
  g.add(k.box(0.012, 0.08, 0.14, M.qf, 1.415, 1.08, -0.08));
  k.lamp(1.05, 1.44, 0);
  d.lever = k.group(1.42, 0.8, 0); d.lever.add(k.box(0.06, 0.38, 0.06, M.handle, 0, 0.19, 0)); g.add(d.lever);
  return { label: [0, H3 + 0.9, 0] };
}
export function update(d, s) { d.lampState = s.on ? 'on' : 'off'; d.leverT = s.on ? -0.6 : 0.6; }
