// Выключатель ОРУ (баковый): бак на раме, торцевые днища, два ввода с рёбрами и трансформаторами тока у основания,
// шкаф привода с дверью, решёткой и рукояткой, лампа положения
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group;
  // опора: стойка и рама под баком
  g.add(k.box(0.4, 1.95, 0.4, M.galv, 0, 0.975, 0));
  g.add(k.box(0.5, 0.06, 0.5, M.galv, 0, 0.03, 0));
  g.add(k.box(0.12, 0.12, 2.2, M.galv, 0, 1.9, 0));
  for (const z of [-1, 1]) g.add(k.box(0.1, 0.3, 0.1, M.galv, 0, 2.0, z));
  // бак с днищами и сварными поясами
  g.add(k.cyl(0.34, 2 * S3 + 0.4, M.tank, 0, 2.3, 0, 'z'));
  for (const z of [-0.6, 0, 0.6]) g.add(k.cyl(0.345, 0.05, M.tank, 0, 2.3, z, 'z'));
  for (const [i, z] of [[0, -S3], [1, S3]]) {
    g.add(k.cyl(0.16, 0.22, M.tank, 0, 2.66, z));
    g.add(k.insulator(0, 2.77, H3 - 0.04, z, 0.085));
    g.add(k.cyl(0.07, 0.14, k.node(i), 0, H3, z));
  }
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
