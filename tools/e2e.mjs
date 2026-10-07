/* Автопроходка в headless-браузере: npm run e2e — то, что уйдёт на сайт (сборка и vite preview), через интерфейс.
   • tasks  — каждое задание каждой готовой схемы по плану (src/core/plan.js): в 2D — щелчки по схеме, меню тележки,
              кнопки панели; в VR-полигоне — пешком: прицел и E/Q. Итог: отчёт открыт, 100 баллов, «Выполнено без ошибок».
   • errors — одна типовая ошибка на схему: в отчёте ошибка нужного вида.
   Ловит ошибки консоли, необработанные исключения и промисы, журнал ошибок приложения (diag.js),
   «undefined», «NaN», «[object Object]» на экране и в отчётах.
   Флаги: --no-build (взять готовый dist/), --only=<схема|проверка>[,…] (ps110, tp10, ps35, poly, tasks, errors…),
   --shots (снимки в e2e-out/). Через npm: npm run e2e -- --only=poly --shots (или npm run e2e --part=poly --shots).
   Код выхода: 0 — всё прошло, 1 — сбой, 2 — нет браузера. */
import { build, preview } from 'vite';
import { readFileSync, rmSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

// флаги из командной строки или из npm (npm run e2e --shots кладёт их в npm_config_*)
const argv = process.argv.slice(2), env = process.env;
const flag = (n, envName = n) => argv.includes('--' + n) || env['npm_config_' + envName.replace(/-/g, '_')] === 'true';
const val = n => { const a = argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : env['npm_config_' + n] || ''; };
// npm сам забирает --only (своя настройка) и превращает --no-build в пустой npm_config_build:
// поэтому через npm — npm run e2e -- --only=poly или npm run e2e --part=poly
const NO_BUILD = argv.includes('--no-build') || env.npm_config_build === '' || env.npm_config_build === 'false';
const SHOTS = flag('shots');
const ONLY = (val('only') || val('part')).split(',').map(s => s.trim()).filter(Boolean);
const OUT = 'e2e-out';
const T0 = Date.now();
const rows = [];
let page = null;

// ---------- проверки ----------
const SUITES = {};
// Набор проверок: SUITES[name] = { fn(keys), perScheme } — perScheme: идёт по схемам (ключи SAMPLES), --only=<схема> его сужает
const onlySuites = () => ONLY.filter(o => SUITES[o]), onlyKeys = () => ONLY.filter(o => !SUITES[o]);
async function check(name, key, fn) {
  const t = Date.now(), e0 = page.errors.length;
  let ok = true, info = '';
  try { info = (await fn()) || ''; }
  catch (e) { ok = false; info = e.message || String(e); }
  const errs = page.errors.slice(e0);
  const diag = await page.eval('TS.Diag.errors().length').catch(() => 0);
  if (errs.length) { ok = false; info += ' · ошибки консоли: ' + errs.slice(0, 3).join(' | '); }
  if (diag) { ok = false; info += ` · журнал ошибок приложения: ${diag}`; await page.eval('TS.Diag.clearErrors()').catch(() => {}); }
  const bad = await page.eval('E2E.badText()').catch(() => null);
  if (bad) { ok = false; info += ` · на экране: «${bad}»`; }
  rows.push({ проверка: name, схема: key || '', итог: ok ? 'ok' : 'СБОЙ', подробно: info.slice(0, 160), с: ((Date.now() - t) / 1000).toFixed(1) });
  console.log(`${ok ? '  ok ' : '  СБОЙ'} ${name}${key ? ' · ' + key : ''}${info ? ' — ' + info : ''}`);
  if (!ok && SHOTS) await page.shot(`${OUT}/fail-${name}-${key}.png`.replace(/[^\w./-]+/g, '_'));
  return ok;
}
const fail = msg => { throw new Error(msg); };

// ---------- действия, как у человека ----------
async function clickAt(p, what) {
  if (!p || p.ok === false) fail(`не нажать ${what}${p && p.why ? ': ' + p.why : ''}`);
  await page.click(p.x, p.y);
  await sleep(40);
}
const clickBtn = async (sel, text, what) => clickAt(await page.fn((s, t) => E2E.box(s, t), sel, text ?? null), what || text || sel);
async function chooseScheme(key) {
  await closeModal();
  await page.fn(k => { const s = document.getElementById('schemeSel'); s.value = k; s.dispatchEvent(new Event('change', { bubbles: true })); }, key);
  await page.waitFor(`TS.app.source === ${JSON.stringify(key)}`, 3000, 'схема ' + key);
}
async function closeModal() {
  if (await page.eval('document.getElementById("modal").hidden')) return;
  const b = await page.fn(() => E2E.box('#modal footer .btn', 'Закрыть') || E2E.box('#modal footer .btn.primary') || E2E.box('#modal [data-m="close"]'));
  await clickAt(b, 'закрыть окно');
  await page.waitFor('document.getElementById("modal").hidden', 2000, 'окно закрылось');
}
async function setMode(m) {
  if (await page.eval(`TS.app.mode === '${m}'`)) return;
  await clickBtn(`#tab-${m}`, null, 'вкладка ' + m);
  await page.waitFor(`TS.app.mode === '${m}'`, 2000);
}
async function selectTask(i) {
  await page.fn(i => { const s = document.getElementById('taskSel'); if (s) { s.value = String(i); s.dispatchEvent(new Event('change', { bubbles: true })); } }, i);
}
async function setOpt(name, on) {
  const o = await page.fn(n => E2E.opt(n), name);
  if (!o) fail('нет настройки ' + name);
  if (o.on !== on) { await page.click(o.x, o.y); await sleep(40); }
  if ((await page.eval(`TS.app.tr.opt.${name}`)) !== on) fail(`настройка ${name} не переключилась`);
}
// Задание открыто и идёт: ждём отчёт
async function waitReport(ms = 4000) {
  await page.waitFor('!!E2E.report() && E2E.report().score != null', ms, 'отчёт');
  return page.eval('E2E.report()');
}

// 2D: одно действие плана — щелчки по схеме, меню тележки, инструменты панели
async function act2D(a) {
  const hitEl = async (id, what) => clickAt(await page.fn(t => E2E.hit(t), id), what);
  if (a.do === 'switch' || a.do === 'rack') {
    await hitEl(a.id, 'аппарат');
    if (a.menu) {
      await page.waitFor('!!document.getElementById("actmenu")', 1500, 'меню тележки');
      await clickBtn('#actmenu button', a.menu);
    }
    return;
  }
  if (a.do === 'check' || a.do === 'pz') {
    const tool = a.do === 'check' ? 'tool-check' : 'tool-pz', want = a.do;
    await clickBtn(`[data-act="${tool}"]`, null, 'инструмент');
    if ((await page.eval('TS.app.tool')) !== want) fail('инструмент не включился');
    await hitEl(a.target, a.do === 'check' ? 'место проверки' : 'место ПЗ');
    await clickBtn(`[data-act="${tool}"]`, null, 'инструмент');
    return;
  }
  fail('действие не для 2D: ' + a.do);
}

// 3D-полигон пешком: прицел и E/Q
async function aimE(what, label) {
  const r = await page.fn(w => E2E.aim(w), what);
  if (!r.ok) fail(`прицел на ${label}: ${r.why}`);
  await page.key('KeyE');
  await sleep(60);
}
async function grab(item) {
  const held = await page.eval('E2E.held()');
  if (held === item) return;
  if (held) { await page.key('KeyQ'); await sleep(40); }
  await aimE({ item }, 'предмет ' + item);
  await page.waitFor(`E2E.held() === ${JSON.stringify(item)}`, 1500, 'предмет в руке: ' + item);
}
async function act3D(a) {
  switch (a.do) {
    case 'wear': {
      if (await page.eval('E2E.held()')) { await page.key('KeyQ'); await sleep(40); }
      return aimE({ item: a.item }, a.item);
    }
    case 'place': await grab(a.item); return aimE({ mount: a.at }, 'место ' + a.at);
    case 'take': if (await page.eval('E2E.held()')) { await page.key('KeyQ'); await sleep(40); } return aimE({ item: a.item }, a.item);
    case 'check': await grab(a.item || 'uvn'); return aimE({ mount: a.mount }, 'контакты ' + a.mount);
    case 'switch': case 'rack':
      await aimE({ dev: a.id }, 'аппарат');
      if (a.menu) {
        await page.waitFor('!!TS.app.v3.menu3d', 1500, 'меню тележки в 3D');
        await aimE({ menu: a.menu }, 'пункт «' + a.menu + '»');
      }
      return;
  }
  fail('действие не для 3D: ' + a.do);
}
// Одно действие плана: каждое добавляет ровно одну операцию в задание и не даёт ошибок
async function doAction(a, i, poly) {
  const before = await page.eval('E2E.run()');
  const text = await page.fn((a) => TS.Plan.actionText(TS.app.tr, a), a);
  try { if (poly) await act3D(a); else await act2D(a); }
  catch (e) { fail(`шаг ${i + 1} «${text}»: ${e.message}`); }
  await sleep(30);
  const after = await page.eval('E2E.run()');
  if (!after) fail(`шаг ${i + 1} «${text}»: задание пропало`);
  if (after.errors.length > before.errors.length) fail(`шаг ${i + 1} «${text}»: ошибка — ${after.errors.slice(before.errors.length).join('; ')}`);
  if (after.ops !== before.ops + 1) fail(`шаг ${i + 1} «${text}»: щелчок не сработал (операций ${before.ops} → ${after.ops})`);
}
// Открыть схему для задания: 2D — вкладка «Тренажёр», полигон — 3D пешком (захват мыши в headless — вызовом)
async function openScheme(key) {
  await chooseScheme(key);
  const poly = await page.eval('!!TS.app.scheme.room');
  if (!poly) { await setMode('train'); return false; }
  await setMode('3d');
  await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.items && TS.app.v3.walk.on)', 15000, '3D-полигон');
  const intro = await page.fn(() => E2E.box('.v3-intro [data-intro]'));
  if (intro) await clickAt(intro, '«Понятно» на карточке полигона');
  await page.eval('TS.app.v3.walk.lockChanged(true)');
  return true;
}
async function startTask(ti) {
  await selectTask(ti);
  await clickBtn('[data-act="task-start"]', null, '«Начать задание»');
  await page.waitFor('!!TS.app.tr.run && !TS.app.tr.run.done', 2000, 'задание началось');
}

SUITES.tasks = { perScheme: true, fn: async keys => {
  for (const key of keys) {
    const n = await page.eval(`TS.SAMPLES.find(s => s.key === '${key}').make().tasks.length`);
    for (let ti = 0; ti < n; ti++) {
      await check('tasks', `${key} #${ti + 1}`, async () => {
        const poly = await openScheme(key);
        await startTask(ti);
        const plan = await page.eval('TS.Plan.planTask(TS.app.scheme, TS.app.tr.run.task)');
        for (let i = 0; i < plan.length; i++) await doAction(plan[i], i, poly);
        const r = await waitReport();
        if (SHOTS) await page.shot(`${OUT}/tasks-${key}-${ti + 1}.png`);
        if (r.score !== 100 || r.verdict !== 'Выполнено без ошибок') fail(`отчёт: ${r.score}, «${r.verdict}»`);
        await closeModal();
        return `${plan.length} действий, 100 баллов`;
      });
    }
  }
} };

// Типовая ошибка на схему: что сделать и какого вида ошибка должна попасть в отчёт
const MISTAKES = {
  ps110: { task: 0, interlocks: false, kind: 'Авария', text: 'разорван ток нагрузки', do: [{ do: 'switch', name: 'ШР Л-1' }] },
  tp10: { task: 1, interlocks: false, kind: 'Авария', text: 'включён на участок под напряжением', do: [{ do: 'switch', name: 'ЗН-10' }] },
  ps35: { task: 0, interlocks: true, kind: 'Блокировка', text: 'выключатель включён', do: [{ do: 'rack', name: 'В-10 Л-1', pos: 'test', menu: 'Тележку в контрольное положение' }] },
  poly: { task: 0, interlocks: true, kind: 'Охрана труда', text: 'Операция без СИЗ', do: [{ do: 'switch', name: 'В-10 яч.3', menu: 'Отключить выключатель' }] },
};
SUITES.errors = { perScheme: true, fn: async keys => {
  for (const key of keys) {
    const m = MISTAKES[key];
    if (!m) continue;
    await check('errors', key, async () => {
      const poly = await openScheme(key);
      if (!poly) await setOpt('interlocks', m.interlocks);
      await startTask(m.task);
      for (const d of m.do) {
        const id = await page.eval(`TS.app.scheme.els.find(e => e.name === ${JSON.stringify(d.name)}).id`);
        const a = Object.assign({}, d, { id });
        if (poly) await act3D(a); else await act2D(a);
        await sleep(60);
      }
      const run = await page.eval('E2E.run()');
      if (!run.errors.length) fail('ошибка не засчитана');
      if (await page.eval('TS.app.tr.hasAlarms()')) await clickBtn('[data-act="ack"]', null, '«Квитировать»');
      await clickBtn('[data-act="task-stop"]', null, '«Завершить»');
      const r = await waitReport();
      if (SHOTS) await page.shot(`${OUT}/errors-${key}.png`);
      if (!r.text.includes(m.kind + ':') || !r.text.includes(m.text)) fail(`в отчёте нет «${m.kind}: …${m.text}…»`);
      if (r.score >= 100) fail('балл не снижен');
      await closeModal();
      if (!poly) await setOpt('interlocks', true);
      return `${run.errors[0].split(': ').slice(1).join(': ').slice(0, 80)}… · ${r.score} баллов`;
    });
  }
} };

// ---------- запуск ----------
async function main() {
  if (!NO_BUILD) {
    console.log('Сборка…');
    await build({ logLevel: 'warn' });
  }
  if (SHOTS) rmSync(OUT, { recursive: true, force: true });
  const server = await preview({ preview: { port: 5181, strictPort: false, host: '127.0.0.1' }, logLevel: 'warn' });
  const url = server.resolvedUrls.local[0];
  const browser = await launch();
  let code = 0;
  try {
    page = await browser.newPage();
    await page.goto(url);
    await page.eval(readFileSync(new URL('./e2e-page.js', import.meta.url), 'utf8'));
    const keys = await page.eval('TS.SAMPLES.map(s => s.key)');
    const su = onlySuites(), ok = onlyKeys();
    for (const [name, s] of Object.entries(SUITES)) {
      if (su.length && !su.includes(name)) continue;
      // --only=<схема> без названия проверки — только проверки по схемам
      if (!s.perScheme && !su.length && ok.length) continue;
      await s.fn(ok.length ? keys.filter(k => ok.includes(k)) : keys);
    }
  } catch (e) {
    console.error('Сбой прогона:', e.message || e);
    rows.push({ проверка: 'прогон', схема: '', итог: 'СБОЙ', подробно: String(e.message || e).slice(0, 160), с: '' });
  } finally {
    await browser.close();
    await new Promise(r => server.httpServer.close(r));
  }
  console.table(rows);
  if (page && page.warnings.length) console.log(`Предупреждения загрузки (внешние ресурсы): ${page.warnings.length}`);
  const bad = rows.filter(r => r.итог !== 'ok').length;
  console.log(`${rows.length - bad} из ${rows.length} проверок прошли за ${((Date.now() - T0) / 1000).toFixed(0)} с.${SHOTS ? ' Снимки — ' + OUT + '/' : ''}`);
  if (bad || !rows.length) code = 1;
  process.exit(code);
}
main();
