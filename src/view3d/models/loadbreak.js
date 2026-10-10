// Выключатель нагрузки: нож разъединителя и дугогасительная камера у неподвижного контакта
import * as disc from './disconnector.js';
export function build(k, el, d) {
  const r = disc.build(k, el, d);
  k.tri(k.gap(0), x => d.group.add(k.box(Math.min(0.26, k.gap(0) * 0.6), 0.42, 0.34, k.M.dark, x, k.H3 + 0.24, -k.S3 * 0.55)));
  return r;
}
export const update = disc.update;
