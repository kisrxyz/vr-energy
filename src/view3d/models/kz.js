// Короткозамыкатель: нож как у ЗН (полосатый) и пружинный привод включения
import * as earth from './earth.js';
export function build(k, el, d) {
  const r = earth.build(k, el, d);
  d.group.add(k.box(0.34, 0.6, 0.34, k.M.motor, 0.5, 0.3, 0.45));
  return r;
}
export const update = earth.update;
