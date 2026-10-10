/* Снимки 3D для PR «до/после»: одни и те же ракурсы (набор 0.7 «три фазы»: не больше 6 пар) — отпайка к ЗН-110 Т1 от проходящей
   линии, сборные шины 1СШ с присоединениями, трёхобмоточный Т2 ПС 110/35/10, портал ВЛ-110 «Восток», ТП 10/0,4 кВ, обзор ПС 110/35/10.
   node tools/screens.mjs --tag=before|after  →  docs/screens/<n>-<ракурс>-<tag>.png (только сцена, без панелей; ≤ 300 КБ).
   Ракурсы считаются от координат схемы и здания ЗРУ, а не от моделей: после правки моделей камера стоит там же.
   Снимки «до» снимаются этим же скриптом на копии main (git worktree) — поэтому только через TS, без новых функций.
   Vite — на свободном порту от 5182 (5173 не трогаем). Нужен Chrome (tools/cdp.mjs). */
import { createServer } from 'vite';
import { statSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const tag = (process.argv.find(a => a.startsWith('--tag=')) || '--tag=after').slice(6);
// --review: ракурсы для проверки моделей глазами — в e2e-out/, а не в docs/screens
const REVIEW = process.argv.includes('--review');
const OUT = REVIEW ? 'e2e-out' : 'docs/screens';
// где стоять пешком: элемент схемы, смещение от него в метрах (x, z) и высота взгляда на него
const SHOTS = [
  // отпайка от проходящей линии к ЗН сбоку: фазы над линией и спуск на каждую фазу, гребёнка над полюсами ЗН
  { n: 1, name: 'ps110-otpayka', key: 'ps110', walk: { el: 'ЗН-110 Т1', dx: 5, dz: 4, look: 3.6 } },
  // сборные шины выше проводов: каждая фаза присоединения поднимается к своей шине
  { n: 2, name: 'ps110-shiny', key: 'ps110', walk: { el: 'ШР Л-2', dx: 4.5, dz: 4.5, look: 4.2 } },
  { n: 3, name: 'ps35-t2', key: 'ps35', walk: { el: 'Т2', dx: -6, dz: 5, look: 3.2 } },
  { n: 4, name: 'ps110-portal', key: 'ps110', walk: { el: 'ВЛ-110 «Восток»', dx: 5, dz: 6, look: 3.8 } },
  { n: 5, name: 'tp10-tp', key: 'tp10', walk: { el: 'Т-1', dx: 4.5, dz: 3.5, look: 3.0 } },
  { n: 6, name: 'ps35-obzor', key: 'ps35' },
];
const REVIEW_SHOTS = [
  { n: 'r1', name: 'breaker110', key: 'ps110', walk: { el: 'В-110 Т1', dx: 3.6, dz: 2.6, look: 2.0 } },
  { n: 'r2', name: 'disconnector', key: 'ps110', walk: { el: 'ЛР-110 Т1', dx: 3.2, dz: 2.4, look: 2.6 } },
  { n: 'r3', name: 'tr3', key: 'ps35', walk: { el: 'Т2', dx: -6, dz: 5, look: 2.4 } },
  { n: 'r4', name: 'opn-tt', key: 'ps35', walk: { el: 'ТТ-110 Т1', dx: 4.5, dz: 3, look: 2.4 } },
  { n: 'r5', name: 'gate', key: 'ps110', walk: { el: 'В-10 Л-2', dx: 0, dz: 22, look: 2 } },
  { n: 'r6', name: 'poly-cells', key: 'poly', room: { x: -1.2, z: 1.6, look: [0.2, 1.3, -1.2] } },
  { n: 'r7', name: 'source', key: 'ps110', walk: { el: 'ВЛ-110 «Восток»', dx: 5, dz: 5, look: 3.5 } },
  { n: 'r8', name: 'rp-walk', key: 'rp10', walk: { el: 'СВ-10', dx: 2, dz: 12, look: 1.6 } },
];

const server = await createServer({ server: { port: 5182, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await launch();
let code = 0;
try {
  const p = await browser.newPage();
  await p.goto(url);
  // снимок — без кнопок и подсказок поверх сцены
  await p.eval(`(() => { const s = document.createElement('style'); s.textContent = '.v3-top, .v3-fps, .v3-intro, .v3-coach, .v3-tip, .v3-note, .toasts, .v3-load { display: none !important; }'; document.head.appendChild(s); })()`);
  for (const s of REVIEW ? REVIEW_SHOTS : SHOTS) {
    await p.eval(`(async () => { TS.app.chooseScheme('${s.key}'); TS.app.setMode('3d'); await TS.app.v3.show(); })()`);
    await p.fn(s => {
      const v = TS.app.v3, T = v.kit.T, w = v.walk, tr = TS.app.tr;
      tr.opt.interlocks = true;
      if (s.walk) {
        if (!v.yardWalk) v.toggleWalk();
        // аппарат в ЗРУ (с 0.5) — стоим в коридоре перед ячейкой (в её местных осях: ряд лицом в коридор), на улице — как задано от точки схемы
        const el = TS.app.scheme.els.find(e => e.name === s.walk.el), d = v.dev.get(el.id), zru = d && d.zru;
        const c = zru ? d.group.getWorldPosition(new T.Vector3()) : v.toWorld([el.x, el.y]);
        const at = zru ? d.group.localToWorld(new T.Vector3(-1.9, 0, 2.5)) : { x: c.x + s.walk.dx, z: c.z + s.walk.dz };
        const x = at.x, z = at.z;
        w.pose({ x, z, yaw: Math.atan2(-(c.x - x), -(c.z - z)), pitch: Math.atan2(s.walk.look - 1.62, Math.hypot(c.x - x, c.z - z)) });
      } else if (s.zruIn) {
        if (!v.yardWalk) v.toggleWalk();
        // вход в здание ЗРУ: 0.6 — тамбур у xa (view — середина коридора), 0.5 — проём в торце у ряда (коридор при z = 1,5)
        const g = v.zru.group, zr = v.zru, bb = new T.Box3().setFromObject(g), at = zr.view ? g.worldToLocal(new T.Vector3(zr.view.x, 0, zr.view.z)) : null;
        const p = at ? g.localToWorld(new T.Vector3(bb.min.x - g.position.x + 0.7, 0, 0)) : g.localToWorld(new T.Vector3(bb.min.x - g.position.x + 0.9, 0, 1.5));
        const tgt = at ? g.localToWorld(new T.Vector3(bb.max.x - g.position.x, 1.1, 0)) : g.localToWorld(new T.Vector3(bb.max.x - g.position.x, 1.1, 1.5));
        w.pose({ x: p.x, z: p.z, yaw: Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z)), pitch: -0.05 });
      } else if (s.task != null) {
        if (v.yardWalk) v.toggleWalk();
        v.walkPose = null;
        TS.app.startTask(TS.app.scheme.tasks[s.task]);
        v.toggleWalk();
        if (v.tp) v.tp.cancel();
      } else if (s.gate) {
        if (!v.yardWalk) v.toggleWalk(); else w.reset(v.world.start);
      } else if (s.room) {
        if (s.cart) { tr.opt.interlocks = false; const id = TS.app.scheme.els.find(e => e.name === s.cart).id; tr.operate(id); tr.operate(id, { pos: 'repair' }); v.update(true); }
        const [lx, ly, lz] = s.room.look;
        if (v.items) { for (const h of ['desk']) { const id = v.items.heldIn(h); if (id) v.items.toHome(v.items.list.get(id)); } if (s.hold) v.items.grab(s.hold, 'desk'); }
        w.pose({ x: s.room.x, z: s.room.z, yaw: Math.atan2(-(lx - s.room.x), -(lz - s.room.z)), pitch: Math.atan2(ly - 1.62, Math.hypot(lx - s.room.x, lz - s.room.z)) });
      } else if (v.yardWalk) v.toggleWalk();
      w.lockChanged(true);
      // без кольца наведения: оно от прицела, а снимок — про модели
      v.ring.material.visible = false;
    }, s);
    await p.eval('new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 900))');
    const r = await p.eval(`(() => { const b = document.getElementById('view3d').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const file = `${OUT}/${s.n}-${s.name}-${tag}.png`;
    for (const scale of [0.62, 0.52, 0.44]) {
      const res = await p.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale }, r) });
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(OUT, { recursive: true });
      writeFileSync(file, Buffer.from(res.result.data, 'base64'));
      if (statSync(file).size <= 300 * 1024) break;
    }
    const kb = Math.round(statSync(file).size / 1024);
    console.log(`${file} — ${kb} КБ`);
    if (kb > 300) { console.error('  больше 300 КБ'); code = 1; }
  }
  const errs = await p.eval('TS.Diag.errors().length').catch(() => 0);
  if (errs || p.errors.length) { console.error('Ошибки страницы:', p.errors.slice(0, 3).join(' | ')); code = 1; }
} catch (e) {
  console.error(e.message || e); code = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
