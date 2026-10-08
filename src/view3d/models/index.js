/* Реестр 3D-моделей: каждый тип — свой модуль <тип>.js с общим интерфейсом.

   build(k, el, d) → { label: [x, y, z] }
     k — набор (kit.js): фигуры, материалы M, k.node(i) — материал узла у точки i, k.port(i) — точка подключения i,
         k.lamp(x, y, z) — сигнальная лампа положения (все лампы схемы рисуются одним вызовом);
     el — элемент схемы; d — запись модели: d.group (THREE.Group, уже создана), d.ports (точки подключения, местные координаты).
     Построитель кладёт фигуры в d.group и заводит подвижные части:
       d.pivot + d.ang/angT — поворотный нож (rotation.x), d.lever + d.leverT — рукоятка (rotation.x),
       d.slide + d.slideX/slideT — тележка (position.x), d.spin + d.speed/speedT — вращение (rotation.x),
       d.show, d.mark — части, которые показываются и прячутся; d.far — дальние части, не ловят щелчок.
     Возвращает позицию подписи (все подписи схемы рисуются одним вызовом).
   update(d, s) — состояние в цели анимации: s = { on, pos, trip, blown, src, live(i) }; d.lampState = 'on' | 'off' | 'blown'.
   Местные координаты: x — вбок, y — вверх, z — вдоль символа схемы (точки подключения на высоте проводов). */
import * as source from './source.js';
import * as gen from './gen.js';
import * as bus from './bus.js';
import * as ohl from './ohl.js';
import * as cable from './cable.js';
import * as breaker from './breaker.js';
import * as cart from './cart.js';
import * as disconnector from './disconnector.js';
import * as cartdisc from './cartdisc.js';
import * as loadbreak from './loadbreak.js';
import * as od from './od.js';
import * as knife from './knife.js';
import * as acb from './acb.js';
import * as earth from './earth.js';
import * as kz from './kz.js';
import * as transformer from './transformer.js';
import * as tr3 from './tr3.js';
import * as tsn from './tsn.js';
import * as reactor from './reactor.js';
import * as vt from './vt.js';
import * as ct from './ct.js';
import * as arrester from './arrester.js';
import * as fuse from './fuse.js';
import * as pz from './pz.js';
import * as load from './load.js';
import * as motor from './motor.js';
import * as capacitor from './capacitor.js';

const MODELS = { source, gen, bus, ohl, cable, breaker, cart, disconnector, cartdisc, loadbreak, od, knife, acb, earth, kz, transformer, tr3, tsn, reactor, vt, ct, arrester, fuse, pz, load, motor, capacitor };

export { MODELS };
export { S3, H3, PAL, css, texture, makeMaterials, makeKit } from './kit.js';
