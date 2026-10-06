// Выкатной разъединитель КРУ (тележка СР, ТН): шкаф как у ячейки, на тележке — перемычка
import * as cart from './cart.js';
export function build(k, el, d) { return cart.build(k, el, d, true); }
export function update(d, s) { cart.update(d, s); d.lampState = s.pos === 'work' ? 'on' : 'off'; }
