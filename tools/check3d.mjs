/* Проверка 3D без шлема: каждая готовая схема в 3D в headless-браузере — вызовы отрисовки и треугольники в кадре.
   Площадка — «Обзор» и «Пешком» (от ворот), VR-полигон — пешком (у входа) и «Обзор».
   --vr — то же в шлеме: эмулятор WebXR iwer (Quest 3, с CDN, только в странице проверки), вызовы за оба глаза
   (three.js рисует глаза отдельно). Места: у ворот (полигон — у входа), внутри ЗРУ (площадка с ячейками КРУ) или в середине
   площадки, полигон — в середине помещения; в каждом месте — четыре стороны, в таблице — худшая.
   npm run check3d (-- --vr). Нужны Node 22+ и установленный Chrome, Chromium или Edge (путь — CHROME_PATH, см. tools/cdp.mjs).
   Vite — на свободном порту от 5180: 5173 не трогаем, там может работать dev-сервер владельца.
   Больше 200 вызовов (бюджет шлема) или 300 тыс. треугольников, ошибки страницы — код выхода 1.
   FPS в headless не меряем: отрисовка программная, цифра ничего не значит. */
import { createServer } from 'vite';
import { launch, sleep } from './cdp.mjs';

const MAX_CALLS = 200, MAX_TRIS = 300000;
const VR = process.argv.includes('--vr');
const IWER = 'https://cdn.jsdelivr.net/npm/iwer@2.5.0/+esm';
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
  if (VR) {
    // эмулятор шлема ставится один раз на страницу; нет сети — проверка не проводится
    const ok = await p.gesture(`(async () => { try { const m = await import('${IWER}'); window.__iwer = new m.XRDevice(m.metaQuest3); window.__iwer.installRuntime({ forceInstall: true }); return true; } catch (e) { return false; } })()`);
    if (!ok) { console.error('iwer с CDN не загрузился (нет сети) — замер в шлеме пропущен.'); process.exitCode = 0; throw new Error('skip'); }
  }
  for (const key of keys) {
    await p.eval(`(async () => { TS.app.chooseScheme('${key}'); TS.app.setMode('3d'); await TS.app.v3.show(); })()`);
    const info = await p.eval('({ poly: !!TS.app.scheme.room, title: TS.app.scheme.title, zru: !!TS.app.v3.zru })');
    if (VR) { rows.push(...await vrRows(p, key, info)); continue; }
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
  const calls = rows.flatMap(r => Object.keys(r).filter(k => k.includes('вызовы')).map(k => r[k]));
  const tris = rows.flatMap(r => Object.keys(r).filter(k => k.includes('треуг')).map(k => r[k]));
  if (calls.some(c => c > MAX_CALLS)) { console.error(`Больше ${MAX_CALLS} вызовов отрисовки — тяжело для шлема.`); code = 1; }
  if (tris.some(t => t > MAX_TRIS)) { console.error(`Больше ${MAX_TRIS / 1000} тыс. треугольников в кадре.`); code = 1; }
} catch (e) {
  if (e.message !== 'skip') { console.error(e.message || e); code = 1; }
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);

// Шлем: войти в VR, в каждом месте повернуть rig на четыре стороны (шлем смотрит вперёд, на высоте глаз), взять худший кадр
async function vrRows(p, key, info) {
  await p.gesture('TS.app.v3.enterVR()');
  for (let i = 0; i < 100 && !(await p.eval('TS.app.v3.renderer.xr.isPresenting')); i++) await sleep(100);
  if (!(await p.eval('TS.app.v3.renderer.xr.isPresenting'))) throw new Error(`${key}: не вошли в VR`);
  // обучение перед глазами в замер не входит
  await p.eval('TS.app.v3.tutor && (TS.app.v3.tutor.m.visible = false)');
  const spots = await p.eval(`(() => {
    const v = TS.app.v3, T = v.kit.T, out = [{ name: ${info.poly ? "'у входа'" : "'у ворот'"}, x: v.start.x, z: v.start.z }];
    if (v.room) out.push({ name: 'в середине', x: v.room.view.x, z: v.room.view.z });
    else if (v.zru) { const c = v.zru.group.localToWorld(new T.Vector3(0, 0, 1.5)); out.push({ name: 'в ЗРУ', x: c.x, z: c.z }); }
    else out.push({ name: 'в середине', x: 0, z: 0 });
    return out;
  })()`);
  const rows = [];
  for (const s of spots) {
    let best = { calls: 0, tris: 0 };
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const r = await p.eval(`(async () => {
        const v = TS.app.v3, d = __iwer;
        d.position.set(0, 1.6, 0); d.quaternion.set(0, 0, 0, 1);
        v.rig.position.set(${s.x}, 0, ${s.z}); v.rig.rotation.set(0, ${yaw}, 0);
        // кадры шлема идут своим циклом (requestAnimationFrame сессии): счётчик — после 4 кадров на новом месте
        const s = v.renderer.xr.getSession();
        await new Promise(r => { let n = 0; const f = () => { if (++n >= 4) r(); else s.requestAnimationFrame(f); }; s.requestAnimationFrame(f); });
        const i = v.renderer.info.render; return { calls: i.calls, tris: i.triangles };
      })()`);
      if (r.calls > best.calls) best = r;
    }
    rows.push({ схема: info.title, ключ: key, место: s.name, 'шлем: вызовы': best.calls, 'шлем: треуг.': best.tris });
  }
  await p.eval('TS.app.v3.renderer.xr.getSession().end()');
  for (let i = 0; i < 50 && (await p.eval('TS.app.v3.renderer.xr.isPresenting')); i++) await sleep(100);
  return rows;
}
