/* Проверка 3D без шлема: открывает каждую готовую схему в 3D в headless Chrome и печатает вызовы отрисовки.
   npm run check3d  (нужны Node 22+ — встроенный WebSocket — и установленный Chrome или Edge; путь можно задать в CHROME).
   Vite запускается на свободном порту от 5180: 5173 не трогаем — там может работать dev-сервер владельца.
   Захват мыши в headless не работает: ходьба проверяется вызовами walk.lockChanged(true) и событиями keydown. */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chromePath = CHROMES.find(p => existsSync(p));
if (!chromePath) { console.error('Не найден Chrome. Укажите путь: CHROME=... npm run check3d'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- vite на свободном порту ---
const server = await createServer({ server: { port: 5180, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

// --- headless Chrome ---
const profile = mkdtempSync(join(tmpdir(), 'check3d-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1366,860',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]); });
  chrome.on('exit', c => rej(new Error('Chrome закрылся, код ' + c)));
  setTimeout(() => rej(new Error('Chrome не ответил за 15 с')), 15000);
});

// --- CDP: минимальный клиент ---
let ws, seq = 0;
const wait = new Map();
function connect(u) {
  return new Promise(res => {
    ws = new WebSocket(u);
    ws.onopen = res;
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  });
}
const send = (method, params = {}, sessionId) => new Promise(res => {
  const id = ++seq; wait.set(id, res);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

let code = 0;
try {
  await connect(wsUrl);
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 100 && !(await ev('!!window.TS').catch(() => false)); i++) await sleep(200);

  // вызовы отрисовки последнего кадра (renderer.info обнуляется перед каждым render)
  const calls = `new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r(TS.app.v3.renderer.info.render.calls))), 500))`;
  const keys = await ev('TS.SAMPLES.map(s => s.key)');
  const rows = [];
  for (const key of keys) {
    await ev(`(async () => { TS.app.chooseScheme('${key}'); TS.app.setMode('3d'); await TS.app.v3.show(); })()`);
    const v3 = await ev(`({ poly: !!TS.app.scheme.room, title: TS.app.scheme.title })`);
    const row = { схема: v3.title, обзор: null, пешком: null };
    if (v3.poly) {
      row.пешком = await ev(calls);                     // полигон открывается от первого лица
      await ev('TS.app.v3.toggleTopView()'); row.обзор = await ev(calls); await ev('TS.app.v3.toggleTopView()');
    } else {
      row.обзор = await ev(calls);
      await ev('TS.app.v3.toggleWalk()'); row.пешком = await ev(calls); await ev('TS.app.v3.toggleWalk()');
    }
    rows.push(row);
  }
  console.table(rows);
  const errs = await ev('TS.Diag && TS.Diag.errors ? TS.Diag.errors().length : 0').catch(() => 0);
  if (errs) { console.error(`Ошибок в журнале: ${errs}`); code = 1; }
  if (rows.some(r => (r.обзор || 0) > 200 || (r.пешком || 0) > 200)) { console.error('Больше 200 вызовов отрисовки — тяжело для шлема.'); code = 1; }
} catch (e) {
  console.error(e.message || e); code = 1;
} finally {
  try { ws && ws.close(); } catch (e) { /* уже закрыт */ }
  chrome.kill();
  await server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome ещё держит файлы */ }
}
process.exit(code);
