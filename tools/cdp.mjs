/* Голый CDP для проверок в браузере без шлема (tools/e2e.mjs, tools/check3d.mjs): без зависимостей, нужен Node 22+
   (встроенный WebSocket) и уже установленный Chrome, Chromium или Edge.
   Браузер: CHROME_PATH (или CHROME) → /opt/pw-browsers → стандартные пути Chrome и Edge в Windows, Linux и macOS. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const list = [process.env.CHROME_PATH, process.env.CHROME];
  // браузеры Playwright: /opt/pw-browsers/chromium-1234/chrome-linux/chrome
  try {
    for (const d of readdirSync('/opt/pw-browsers').sort().reverse()) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) list.push(join('/opt/pw-browsers', d, sub));
    }
  } catch (e) { /* нет папки */ }
  const local = process.env.LOCALAPPDATA;
  list.push(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local && join(local, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
  return list.filter(Boolean).find(p => { try { return existsSync(p); } catch (e) { return false; } }) || null;
}

// Запустить headless-браузер. Не найден — понятное сообщение и код 2 (npm test от браузера не зависит)
async function launch({ width = 1366, height = 860 } = {}) {
  const path = findChrome();
  if (!path) {
    console.error('Не найден Chrome, Chromium или Edge. Укажите путь: CHROME_PATH=/путь/к/chrome npm run e2e');
    process.exit(2);
  }
  const profile = mkdtempSync(join(tmpdir(), 'ts-cdp-'));
  const proc = spawn(path, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]); });
    proc.on('exit', c => rej(new Error('Браузер закрылся, код ' + c)));
    setTimeout(() => rej(new Error('Браузер не ответил за 20 с')), 20000);
  });
  const b = new Browser(proc, profile);
  await b.connect(wsUrl);
  return b;
}

class Browser {
  constructor(proc, profile) { this.proc = proc; this.profile = profile; this.seq = 0; this.wait = new Map(); this.subs = new Map(); }
  connect(u) {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(u);
      ws.onopen = res; ws.onerror = rej;
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && this.wait.has(m.id)) { this.wait.get(m.id)(m); this.wait.delete(m.id); return; }
        if (m.method) for (const fn of this.subs.get(m.method) || []) fn(m.params, m.sessionId);
      };
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise(res => {
      const id = ++this.seq; this.wait.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, fn) { if (!this.subs.has(method)) this.subs.set(method, []); this.subs.get(method).push(fn); }
  async newPage({ width = 1366, height = 860 } = {}) {
    const { result: { targetId } } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(this, sessionId, targetId);
    await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Page.enable');
    await p.viewport(width, height);
    return p;
  }
  async close() {
    try { this.ws && this.ws.close(); } catch (e) { /* уже закрыт */ }
    this.proc.kill();
    await sleep(300);
    try { rmSync(this.profile, { recursive: true, force: true }); } catch (e) { /* браузер ещё держит файлы */ }
  }
}

class Page {
  constructor(b, sessionId, targetId) {
    this.b = b; this.sid = sessionId; this.targetId = targetId; this.errors = []; this.warnings = [];
    // ошибки консоли, необработанные исключения и промисы, ошибки загрузки
    b.on('Runtime.consoleAPICalled', (p, s) => { if (s === this.sid && p.type === 'error') this.errors.push('console.error: ' + p.args.map(a => a.value ?? a.description ?? '').join(' ')); });
    b.on('Runtime.exceptionThrown', (p, s) => { if (s === this.sid) this.errors.push('исключение: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)); });
    b.on('Log.entryAdded', (p, s) => {
      if (s !== this.sid || p.entry.level !== 'error') return;
      // внешние шрифты без интернета — не ошибка приложения
      if (p.entry.url && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.entry.url)) this.warnings.push(p.entry.text + ' ' + p.entry.url);
      else this.errors.push('загрузка: ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : ''));
    });
  }
  send(method, params = {}) { return this.b.send(method, params, this.sid); }
  async viewport(width, height, mobile = false) {
    this.w = width; this.h = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    else await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  async goto(url, ready = '!!window.TS && !!TS.app && !!TS.app.scheme') {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) { if (await this.eval(ready).catch(() => false)) return; await sleep(100); }
    throw new Error('Страница не загрузилась: ' + url);
  }
  // Выражение в странице (можно с await); результат — по значению
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (!r.result) throw new Error('CDP: ' + JSON.stringify(r.error || r));
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
    return r.result.result.value;
  }
  // Функция в странице с аргументами (JSON)
  fn(f, ...args) { return this.eval(`(${f})(...${JSON.stringify(args)})`); }
  async waitFor(expr, ms = 5000, what = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await this.eval(expr).catch(() => false)) return true; await sleep(50); }
    throw new Error('Не дождались: ' + what);
  }
  async move(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
  // Щелчок мышью в точке окна: настоящие события мыши (браузер сам делает из них pointer- и click-события)
  async click(x, y, button = 'left') {
    await this.move(x, y);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, buttons: button === 'left' ? 1 : 2 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  }
  async tap(x, y) {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // Клавиша: code — 'KeyE', 'Escape'…
  async key(code, { down = true, up = true, mods = 0 } = {}) {
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code;
    const vk = code.startsWith('Key') ? code.charCodeAt(3) : code === 'Escape' ? 27 : code === 'Enter' ? 13 : code.startsWith('Digit') ? code.charCodeAt(5) : 0;
    const base = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods };
    if (down) await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
    if (up) await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }
  // Набрать текст в поле с фокусом (как с клавиатуры)
  async type(text) { await this.send('Input.insertText', { text }); }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (!r.result) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    return true;
  }
  async pdf(path, opts = {}) {
    const r = await this.send('Page.printToPDF', Object.assign({ printBackground: true, preferCSSPageSize: true }, opts));
    if (!r.result) throw new Error('PDF: ' + JSON.stringify(r.error || r));
    const buf = Buffer.from(r.result.data, 'base64');
    if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); }
    return buf;
  }
}

export { findChrome, launch, sleep };
