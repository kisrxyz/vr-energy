// Конденсаторная батарея: стеллаж с банками и ограждение; три фазы — к трём изоляторам на верху стеллажа
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, z = 0.9, p = k.poles(0);
  for (const x of [-0.9, 0.9]) for (const zz of [z - 0.5, z + 0.5]) g.add(k.box(0.08, 1.9, 0.08, M.galv, x, 0.95, zz));
  for (const y of [0.35, 1.1, 1.85]) g.add(k.box(1.9, 0.06, 1.1, M.galv, 0, y, z));
  for (const y of [0.38, 1.13]) for (const x of [-0.6, 0, 0.6]) g.add(k.box(0.42, 0.62, 0.34, M.cap, x, y + 0.34, z));
  k.tri(0.5, (x, j) => {
    g.add(k.cyl(0.06, 0.6, M.porcelain, x, 2.2, z));
    g.add(k.tube(p[j], [x, 2.5, z], 0.03, k.node(0)));
  });
  return { label: [0, 2.9, z] };
}
export function update() {}
