/* Снимок самопроверки: node tools/shot.mjs <файл сценария.js> [--phone] [--dark]
   Сценарий — тело async-функции в странице (есть TS и E2E), возвращает имя снимка или { name, data }; снимок — в e2e-out/.
   Vite — на свободном порту от 5184 (5173 не трогаем). Для своих проверок при разработке, в npm-скрипты не входит. */
import { createServer } from 'vite';
import { readFileSync, mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const file = process.argv[2];
const phone = process.argv.includes('--phone'), dark = process.argv.includes('--dark');
const server = await createServer({ server: { port: 5184, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await launch();
let code = 0;
try {
  const p = await browser.newPage();
  if (phone) await p.viewport(390, 844, true);
  await p.goto(url);
  await p.eval(readFileSync(new URL('./e2e-page.js', import.meta.url), 'utf8'));
  if (dark) await p.eval(`document.documentElement.dataset.theme = 'dark'`);
  mkdirSync('e2e-out', { recursive: true });
  const body = readFileSync(file, 'utf8');
  const shots = [];
  await p.eval(`window.__shot = async name => { window.__shots = (window.__shots || []).concat(name); }`);
  // как действие пользователя: сценарий может войти в VR (эмулятор iwer), включить звук, полноэкранный режим
  const r = await p.send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
  const res = r.result && r.result.result.value;
  console.log(JSON.stringify(res, null, 1));
  await sleep(300);
  const name = (res && res.name) || res || 'shot';
  await p.shot(`e2e-out/${name}${phone ? '-phone' : ''}${dark ? '-dark' : ''}.png`);
  if (p.errors.length) { console.error('Ошибки:', p.errors.slice(0, 5).join(' | ')); code = 1; }
  const de = await p.eval('TS.Diag.errors()').catch(() => []);
  if (de.length) { console.error('Diag:', JSON.stringify(de.slice(0, 3))); code = 1; }
} catch (e) { console.error(e.message || e); code = 1; }
finally { await browser.close(); await server.close(); }
process.exit(code);
