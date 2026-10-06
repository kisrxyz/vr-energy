// Трёхобмоточный трансформатор: вводы ВН сзади, выводы 1 и 2 спереди слева и справа
import { tank } from './transformer.js';
export function build(k, el, d) {
  tank(k, d, { w: 2.3, h: 2.4, l: 2.7, bush: [[0, -0.95, 1.3, 0, 0.5], [-0.65, 0.95, 0.8, 1, 0.22], [0.65, 0.95, 0.8, 2, 0.22]] });
  return { label: [0, 4.9, 0] };
}
export function update(d, s) { d.speedT = s.live(0) || s.live(1) || s.live(2) ? 7 : 0; }
