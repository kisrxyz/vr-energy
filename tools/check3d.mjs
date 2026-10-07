/* Проверка 3D без шлема: каждая готовая схема в 3D в headless-браузере — вызовы отрисовки и треугольники в кадре.
   Площадка — «Обзор» и «Пешком» (от ворот), VR-полигон — пешком (у входа) и «Обзор».
   npm run check3d. Нужны Node 22+ и установленный Chrome, Chromium или Edge (путь — CHROME_PATH, см. tools/cdp.mjs).
   Vite — на свободном порту от 5180: 5173 не трогаем, там может работать dev-сервер владельца.
   Больше 200 вызовов (бюджет шлема) или 300 тыс. треугольников, ошибки страницы — код выхода 1.
   FPS в headless не меряем: отрисовка программная, цифра ничего не значит. */
import { createServer } from 'vite';
import { launch, sleep } from './cdp.mjs';

const MAX_CALLS = 200, MAX_TRIS = 300000;
const server = await createServer({ server: { port: 5180, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await launch();
let code = 0;
try {
  const p = await browser.newPage();
  await p.goto(url);
  // счётчики последнего кадра (renderer.info обнуляется перед каждым render): подождать, пока сцена устоится
  const frame = `new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    const i = TS.app.v3.renderer.info.render; r({ calls: i.calls, tris: i.triangles });
  })), 500))`;
  const keys = await p.eval('TS.SAMPLES.map(s => s.key)');
  const rows = [];
  for (const key of keys) {
    await p.eval(`(async () => { TS.app.chooseScheme('${key}'); TS.app.setMode('3d'); await TS.app.v3.show(); })()`);
    const info = await p.eval('({ poly: !!TS.app.scheme.room, title: TS.app.scheme.title })');
    let over, walk;
    if (info.poly) {
      walk = await p.eval(frame);                       // полигон открывается от первого лица
      await p.eval('TS.app.v3.toggleTopView()'); over = await p.eval(frame); await p.eval('TS.app.v3.toggleTopView()');
    } else {
      over = await p.eval(frame);
      await p.eval('TS.app.v3.toggleWalk()'); walk = await p.eval(frame); await p.eval('TS.app.v3.toggleWalk()');
    }
    rows.push({ схема: info.title, ключ: key, 'обзор: вызовы': over.calls, 'обзор: треуг.': over.tris, 'пешком: вызовы': walk.calls, 'пешком: треуг.': walk.tris });
  }
  console.table(rows);
  const errs = await p.eval('TS.Diag.errors().length').catch(() => 0);
  if (errs || p.errors.length) { console.error(`Ошибки страницы: ${errs + p.errors.length}`, p.errors.slice(0, 3).join(' | ')); code = 1; }
  if (rows.some(r => r['обзор: вызовы'] > MAX_CALLS || r['пешком: вызовы'] > MAX_CALLS)) { console.error(`Больше ${MAX_CALLS} вызовов отрисовки — тяжело для шлема.`); code = 1; }
  if (rows.some(r => r['обзор: треуг.'] > MAX_TRIS || r['пешком: треуг.'] > MAX_TRIS)) { console.error(`Больше ${MAX_TRIS / 1000} тыс. треугольников в кадре.`); code = 1; }
} catch (e) {
  console.error(e.message || e); code = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
