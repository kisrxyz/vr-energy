// ТСН: небольшой трансформатор на площадке, без вентиляторов
import { tank } from './transformer.js';
export function build(k, el, d) {
  tank(k, d, { w: 1.0, h: 1.2, l: 0.9, fans: false, single: true, bush: [[0, -0.3, 0.5, 0], [0, 0.3, 0.35, 1]] });
  return { label: [0, 2.8, 0] };
}
export function update() {}
