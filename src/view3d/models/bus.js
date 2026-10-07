// Шина: труба на решётчатых опорах с изоляторами через каждые 3 клетки
export function build(k, el, d) {
  const { M, S3, H3 } = k, g = d.group, len = el.p.len * S3, step = 3;
  g.add(k.tube([0, H3, 0], [len, H3, 0], 0.08, k.node(0)));
  const xs = [];
  for (let i = 0; i <= el.p.len; i += step) xs.push(i * S3);
  if (el.p.len % step) xs.push(len);
  for (const x of xs) { g.add(k.lattice(0.26, 2.3, 0.26, x, 1.15, 0, 0.5)); g.add(k.insulator(x, 2.3, H3 - 0.06, 0, 0.07)); }
  return { label: [0.6, H3 + 0.7, 0] };
}
export function update() {}
