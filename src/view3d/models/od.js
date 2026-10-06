// Отделитель: как разъединитель, плюс пружинный привод автоматического отключения
import * as disc from './disconnector.js';
export function build(k, el, d) {
  const r = disc.build(k, el, d);
  d.group.add(k.box(0.36, 0.7, 0.36, k.M.motor, -0.55, 0.95, 0));
  d.group.add(k.cyl(0.06, 0.5, k.M.stripe, -0.55, 1.55, 0));
  return r;
}
export const update = disc.update;
