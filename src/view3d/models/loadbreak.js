// Выключатель нагрузки: нож разъединителя и дугогасительная камера у неподвижного контакта
import * as disc from './disconnector.js';
export function build(k, el, d) {
  const r = disc.build(k, el, d);
  d.group.add(k.box(0.26, 0.42, 0.34, k.M.dark, 0, k.H3 + 0.24, -k.S3 * 0.55));
  return r;
}
export const update = disc.update;
