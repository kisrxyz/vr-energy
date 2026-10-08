/* Снимки 3D для PR «до/после»: одни и те же ракурсы — обзор РП-10 и ПС 110/35/10, ячейка РП-10 пешком, ПС 110/10 «Пешком» у ворот,
   полигон у стенда и с ограждением в руке у яч.3 (набор 0.5: не больше 6 пар).
   node tools/screens.mjs --tag=before|after  →  docs/screens/<n>-<ракурс>-<tag>.png (только сцена, без панелей; ≤ 300 КБ).
   Ракурсы считаются от координат схемы, а не от моделей: после правки моделей камера стоит там же.
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
  { n: 1, name: 'rp10-obzor', key: 'rp10' },
  { n: 2, name: 'rp10-yacheyka', key: 'rp10', walk: { el: 'В-10 Л-3', dx: 3.2, dz: 3.4, look: 1.3 } },
  { n: 3, name: 'ps35-obzor', key: 'ps35' },
  { n: 4, name: 'ps110-vorota', key: 'ps110', gate: true },
  { n: 5, name: 'poly-stend', key: 'poly', room: { x: 2.7, z: 2.6, look: [4.6, 1.2, 1.9] } },
  // ограждение в руке, прицел на пол перед яч.3 (−0,45; 0,2)
  { n: 6, name: 'poly-ograzhdenie', key: 'poly', hold: 'fence', room: { x: 0.6, z: 2.7, look: [-0.45, 0, 0.3] } },
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
      const v = TS.app.v3, T = v.kit.T, w = v.walk;
      if (s.walk) {
        if (!v.yardWalk) v.toggleWalk();
        // аппарат в ЗРУ (с 0.5) — стоим в коридоре перед ячейкой, на улице — как задано от точки схемы
        const el = TS.app.scheme.els.find(e => e.name === s.walk.el), d = v.dev.get(el.id), zru = d && d.zru;
        const c = zru ? d.group.getWorldPosition(new T.Vector3()) : v.toWorld([el.x, el.y]);
        const x = c.x + (zru ? -1.9 : s.walk.dx), z = c.z + (zru ? 2.5 : s.walk.dz);
        w.pose({ x, z, yaw: Math.atan2(-(c.x - x), -(c.z - z)), pitch: Math.atan2(s.walk.look - 1.62, Math.hypot(c.x - x, c.z - z)) });
      } else if (s.gate) {
        if (!v.yardWalk) v.toggleWalk(); else w.reset(v.world.start);
      } else if (s.room) {
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
