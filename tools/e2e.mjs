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
const HELPER = readFileSync(new URL('./e2e-page.js', import.meta.url), 'utf8');
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
  // противоаварийное задание РП-10: СВ на повреждённый ввод — КЗ, отключается ближайший выключатель
  rp10: { task: 2, interlocks: false, kind: 'КЗ', text: 'СВ-10 включён на заземлённый участок', do: [{ do: 'switch', name: 'СВ-10', menu: 'Включить выключатель' }] },
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

// «Показ»: вручную — «Дальше» от начала до конца, каждый шаг готовится как в expect; выход возвращает схему, вид,
// блокировки и не трогает «Мои схемы»; телефон 390×844 — панель снизу и не закрывает схему
const demoReady = 'TS.app.demo.on && !TS.app.demo.busy && TS.app.demo.check().length === 0';
const myStore = `JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('ts.my')).sort().map(k => [k, localStorage.getItem(k)]))`;
SUITES.demo = { perScheme: false, fn: async () => {
  await check('demo', 'вручную', async () => {
    // до показа: своя схема (копия ТП в «Моих схемах»), вид 3D, блокировки выключены
    await closeModal();
    await setMode('train');
    const id = await page.eval(`(() => { const id = TS.app.lib.add(Object.assign(TS.SAMPLES.find(s => s.key === 'tp10').make(), { title: 'Моя ТП для проверки' })); TS.app.fillSchemeSelect(); return id; })()`);
    await chooseScheme('my:' + id);
    await setOpt('interlocks', false);
    await setMode('3d');
    const before = { src: 'my:' + id, store: await page.eval(myStore) };
    await clickBtn('#btnDemo', null, '«Показ»');
    const n = await page.eval('TS.app.demo.steps.length');
    const ids = await page.eval('TS.app.demo.steps.map(s => s.id)');
    for (let i = 0; i < n; i++) {
      try { await page.waitFor(demoReady, 15000, 'шаг готов'); }
      catch (e) { fail(`шаг ${i + 1} «${ids[i]}»: не совпало — ${(await page.eval('TS.app.demo.check()')).join(', ')}`); }
      if ((await page.eval('TS.app.demo.i')) !== i) fail(`ожидали шаг ${i + 1}`);
      const cap = await page.eval('document.getElementById("demoCap").textContent');
      if (!cap || (await page.eval('document.getElementById("demoCap").hidden'))) fail(`шаг ${i + 1}: нет подписи для заказчика`);
      if (SHOTS) await page.shot(`${OUT}/demo-${String(i + 1).padStart(2, '0')}-${ids[i]}.png`);
      // тёмная тема — снимок шага со схемой и шага в 3D
      if (SHOTS && (ids[i] === 'accident' || ids[i] === 'poly')) {
        await clickBtn('#btnTheme', null, 'тема');
        await sleep(200);
        await page.shot(`${OUT}/demo-dark-${ids[i]}.png`);
        await clickBtn('#btnTheme', null, 'тема');
      }
      if (i < n - 1) await clickBtn('#demo [data-d="next"]', null, '«Дальше»');
    }
    await clickBtn('#demo [data-d="exit"]', null, '«Выйти»');
    await page.waitFor('!TS.app.demo.on', 3000, 'выход из показа');
    await sleep(300);
    const after = await page.eval(`({ src: TS.app.source, mode: TS.app.mode, il: TS.app.tr.opt.interlocks, store: ${myStore}, bar: document.getElementById('demo').hidden })`);
    if (after.src !== before.src) fail(`после выхода схема ${after.src}, а была ${before.src}`);
    if (after.mode !== '3d') fail(`после выхода вид ${after.mode}, а был 3d`);
    if (after.il !== false) fail('после выхода блокировки не как были');
    if (after.store !== before.store) fail('«Мои схемы» изменились');
    if (!after.bar) fail('панель показа осталась');
    await page.eval(`TS.app.lib.remove('${id}')`);
    await setMode('train');
    await setOpt('interlocks', true);
    return `${n} шагов (${ids.join(', ')}); выход вернул схему, вид, блокировки`;
  });
  await check('demo', 'телефон 390×844', async () => {
    await page.viewport(390, 844, true);
    try {
      await page.goto(page.base + '?demo=1');
      await page.eval(HELPER);
      await page.waitFor(demoReady, 15000, 'показ открыт');
      const n = await page.eval('TS.app.demo.steps.length');
      for (let i = 0; i < n; i++) {
        await page.waitFor(demoReady, 15000, `шаг ${i + 1} готов`);
        const st = await page.eval(`(() => { const d = TS.app.demo, s = d.step, bar = document.getElementById('demo').getBoundingClientRect(),
          sch = (TS.app.mode === '3d' ? document.getElementById('view3d') : document.getElementById('sch')).getBoundingClientRect();
          return { id: s.id, wide: !!s.wide, note: !document.querySelector('#demo .demo-note').hidden, over: bar.top < sch.bottom - 1 && bar.bottom > sch.top + 1, h: Math.round(bar.height), sch: Math.round(sch.height) }; })()`);
        if (st.over) fail(`шаг ${i + 1}: панель закрывает схему`);
        if (st.wide !== st.note) fail(`шаг ${i + 1}: пометка «лучше на ноутбуке» ${st.note ? 'лишняя' : 'не показана'}`);
        if (st.sch < 250) fail(`шаг ${i + 1}: схеме осталось ${st.sch} px`);
        if (SHOTS && (i < 3 || st.wide)) await page.shot(`${OUT}/demo-phone-${String(i + 1).padStart(2, '0')}-${st.id}.png`);
        if (i === 1 && SHOTS) {
          await clickBtn('#demo [data-d="fold"]', null, 'свернуть');
          await page.shot(`${OUT}/demo-phone-folded.png`);
          await clickBtn('#demo [data-d="fold"]', null, 'развернуть');
        }
        if (i < n - 1) await clickBtn('#demo [data-d="next"]', null, '«Дальше»');
      }
      await clickBtn('#demo [data-d="exit"]', null, '«Выйти»');
      return `${n} шагов, панель снизу не закрывает схему`;
    } finally {
      await page.viewport(1366, 860);
      await page.goto(page.base);
      await page.eval(HELPER);
    }
  });
} };
// Автопоказ: ?demo=auto доходит до конца сам за 2–3 минуты, без ошибок
SUITES.auto = { perScheme: false, fn: async () => {
  await check('auto', '?demo=auto', async () => {
    await page.goto(page.base + '?demo=auto');
    await page.eval(HELPER);
    const t0 = Date.now();
    let shot = 0;
    while (!(await page.eval('TS.app.demo.done'))) {
      if (Date.now() - t0 > 240000) fail('автопоказ не закончился за 4 минуты');
      if (!(await page.eval('TS.app.demo.autoOn'))) fail('автопоказ остановился на шаге ' + ((await page.eval('TS.app.demo.i')) + 1));
      if (SHOTS && Date.now() - t0 > shot * 15000) { await page.shot(`${OUT}/auto-${String(shot).padStart(2, '0')}.png`); shot++; }
      await sleep(500);
    }
    const ms = await page.eval('TS.app.demo.autoMs');
    if (ms < 120000 || ms > 180000) fail(`автопоказ шёл ${Math.round(ms / 1000)} с — нужно 2–3 минуты`);
    await clickBtn('#demo [data-d="exit"]', null, '«Выйти»');
    await page.goto(page.base);
    await page.eval(HELPER);
    return `до конца за ${Math.round(ms / 1000)} с`;
  });
} };

// Экзамен: два задания (первое по эталону, второе с аварией) → протокол «Не сдал» с этой ошибкой; подсказку и эталон не открыть;
// протокол на 3 задания в PDF — одна страница A4; перезагрузка посреди экзамена → «прерван»; CSV с кириллицей
const pdfPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
async function typeIn(sel, text) {
  await clickBtn(sel, null, 'поле ' + sel);
  // как Ctrl+A перед набором: поле могло быть заполнено с прошлого экзамена
  await page.fn(s => document.querySelector(s).select(), sel);
  await page.type(text);
}
async function examSetup({ tasks = 2, locks = true, fio }) {
  await clickBtn('[data-act="exam"]', null, '«Экзамен»');
  await page.waitFor('!!document.getElementById("exTasks")', 2000, 'окно экзамена');
  const boxes = await page.eval('[...document.querySelectorAll("#exTasks input")].map(x => x.checked)');
  for (let i = 1; i < Math.min(tasks, boxes.length); i++) if (!boxes[i]) await clickBtn(`#exTasks label:nth-child(${i + 1})`, null, 'задание ' + (i + 1));
  if (!locks) await clickAt(await page.fn(() => { const l = document.getElementById('exLocks').closest('label'); const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }), 'блокировки');
  await typeIn('#exFio', fio);
  await typeIn('#exPost', 'электромонтёр по оперативным переключениям');
  await typeIn('#exOrg', 'Проверочное предприятие');
  if (SHOTS) await page.shot(`${OUT}/exam-setup.png`);
  await clickBtn('#modal footer .btn', 'Начать экзамен');
  await page.waitFor('TS.app.exam.active() && !!TS.app.tr.run', 3000, 'экзамен начался');
  if (SHOTS) await page.shot(`${OUT}/exam-running.png`);
}
SUITES.exam = { perScheme: false, fn: async () => {
  await check('exam', '2 задания → «Не сдал»', async () => {
    await chooseScheme('ps110');
    await setMode('train');
    await examSetup({ tasks: 2, locks: false, fio: 'Сидоров Сидор Сидорович' });
    const lockUi = await page.eval(`({ sel: document.getElementById('schemeSel').disabled, ed: document.getElementById('tab-edit').disabled,
      demo: !!E2E.box('#btnDemo'), hint: !!E2E.box('[data-act="task-hint"]'), n: document.querySelector('.exam-n') && document.querySelector('.exam-n').textContent })`);
    if (!lockUi.sel || !lockUi.ed || lockUi.demo) fail('в экзамене доступны смена схемы, редактор или показ');
    if (lockUi.hint) fail('в экзамене видна кнопка «Подсказка»');
    if (lockUi.n !== 'Задание 1 из 2') fail('нет «Задание 1 из 2»: ' + lockUi.n);
    // попытки открыть подсказку и эталон
    await page.eval(`TS.app.sideAction('task-hint'); TS.app.showReport(TS.app.tr.run); TS.app.setMode('edit'); TS.app.chooseScheme('tp10')`);
    await sleep(100);
    const tried = await page.eval(`({ hints: TS.app.tr.run.hints, modal: !document.getElementById('modal').hidden, mode: TS.app.mode, src: TS.app.source })`);
    if (tried.hints || tried.modal || tried.mode !== 'train' || tried.src !== 'ps110') fail('подсказку, эталон, редактор или другую схему удалось открыть: ' + JSON.stringify(tried));
    // в 3D и шлеме — так же: на щите «Экзамен: задание 1 из 2», без «Подсказки»
    await setMode('3d');
    await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.boardBtns)', 15000, '3D');
    await page.eval('TS.app.v3.drawBoard()');
    const board = await page.eval(`({ acts: TS.app.v3.boardBtns.map(b => b.act), line: TS.app.exam.boardLine() })`);
    if (board.acts.includes('hint') || board.acts.includes('guide') || !board.acts.includes('stop') || !/^Экзамен: задание 1 из 2/.test(board.line)) fail('щит в 3D во время экзамена: ' + JSON.stringify(board));
    await setMode('train');
    const plan = await page.eval('TS.Plan.planTask(TS.app.scheme, TS.app.tr.run.task)');
    for (let i = 0; i < plan.length; i++) await doAction(plan[i], i, false);
    await page.waitFor('TS.app.exam.between', 3000, 'задание 1 завершено');
    if (SHOTS) await page.shot(`${OUT}/exam-between.png`);
    if (await page.eval('!document.getElementById("modal").hidden')) fail('после задания открылся отчёт с эталоном');
    await clickBtn('[data-act="exam-next"]', null, '«Начать задание 2»');
    await page.waitFor('!!TS.app.tr.run && !TS.app.tr.run.done', 2000, 'задание 2');
    await act2D({ do: 'switch', id: await page.eval(`TS.app.scheme.els.find(e => e.name === 'ТР-10 Т1').id`) });
    await sleep(100);
    if (await page.eval('TS.app.tr.hasAlarms()')) await clickBtn('[data-act="ack"]', null, '«Квитировать»');
    await clickBtn('[data-act="task-stop"]', null, '«Завершить задание»');
    await page.waitFor('!!document.querySelector("#modal .proto")', 3000, 'протокол');
    const t = await page.eval('document.querySelector("#modal .proto").innerText');
    if (SHOTS) await page.shot(`${OUT}/exam-protocol.png`);
    if (!/Итог:\s*Не сдал/.test(t)) fail('в протоколе нет «Не сдал»');
    if (!t.includes('Авария: разъединителем ТР-10 Т1')) fail('в протоколе нет ошибки задания 2');
    if (!t.includes('Сидоров Сидор Сидорович') || !/Протокол № \d{8}-\d{2}/.test(t)) fail('нет ФИО или номера протокола');
    if (/Эталон/.test(t)) fail('в протоколе эталон');
    if (SHOTS) { await page.eval('TS.app.toggleTheme()'); await sleep(150); await page.shot(`${OUT}/exam-protocol-dark.png`); await page.eval('TS.app.toggleTheme()'); }
    await clickBtn('#modal footer .btn', 'Печать или PDF');
    const pdf = await page.pdf(SHOTS ? `${OUT}/exam-protocol-2.pdf` : null);
    if (pdfPages(pdf) !== 1) fail(`протокол в PDF — ${pdfPages(pdf)} стр.`);
    await closeModal();
    const after = await page.eval(`({ active: TS.app.exam.active(), sel: document.getElementById('schemeSel').disabled, il: TS.app.tr.opt.interlocks })`);
    if (after.active || after.sel || !after.il) fail('после экзамена не вернулись настройки: ' + JSON.stringify(after));
    return 'протокол «Не сдал» с аварией задания 2, PDF — 1 страница';
  });
  await check('exam', 'протокол на 3 задания — 1 страница A4', async () => {
    // запись в журнале из настоящих прогонов движка: два задания ПС 110/35/10 и одно ПС 110/10 с ошибками
    const id = await page.eval(`(() => {
      const X = TS.ExamCore, runs = [];
      const go = (key, ti, wrong) => { const s = TS.SAMPLES.find(q => q.key === key).make(), tr = new TS.Trainer(); tr.load(s); const t = s.tasks[ti]; tr.startTask(t);
        if (wrong) { tr.opt.interlocks = false; for (const n of wrong) tr.operate(s.els.find(e => e.name === n).id); tr.stopTask(); }
        else TS.Plan.planTask(s, t).forEach(a => TS.Plan.runAction(tr, null, a));
        runs.push({ t, r: tr.run }); };
      go('ps35', 0); go('ps35', 1); go('ps110', 1, ['В-10 Т1', 'ТР-10 Т1', 'ШР-10 Т1', 'ЗН-10 Т1', 'В-110 Т1']);
      const x = X.newExam({ kind: 'drill', schemeTitle: 'ПС 110/35/10 кВ «Степная» и ПС 110/10 кВ «Учебная»', person: { fio: 'Константинопольский Константин Константинович', post: 'старший электромонтёр по оперативным переключениям', dept: 'Оперативно-выездная бригада № 2', org: 'Проверочное предприятие электрических сетей' },
        tasks: runs.map(q => ({ id: q.t.id, title: q.t.title })), limitMin: 40 }, Date.now() - 30 * 60000);
      x.results = runs.map(q => X.taskResult(q.r)); X.finishExam(x);
      TS.app.exam.log.save(x); return x.id; })()`);
    await clickBtn('[data-act="exam"]', null, '«Экзамен»');
    await clickBtn('#modal footer .btn', 'Журнал экзаменов');
    await clickBtn(`[data-m="ex-open"][data-id="${id}"]`, null, '«Протокол»');
    await page.waitFor('!!document.querySelector("#modal .proto")', 2000, 'протокол');
    if (SHOTS) await page.shot(`${OUT}/exam-protocol-3.png`);
    await clickBtn('#modal footer .btn', 'Печать или PDF');
    const pdf = await page.pdf(SHOTS ? `${OUT}/exam-protocol-3.pdf` : null);
    const n = pdfPages(pdf);
    if (n !== 1) fail(`протокол на 3 задания в PDF — ${n} стр.`);
    await closeModal();
    return '1 страница A4';
  });
  await check('exam', 'перезагрузка → «прерван», CSV', async () => {
    await chooseScheme('tp10');
    await examSetup({ tasks: 1, fio: 'Перезагрузкин Пётр' });
    const no = await page.eval('TS.app.exam.cur.id');
    await act2D({ do: 'switch', id: await page.eval(`TS.app.scheme.els.find(e => e.name === 'QF-ввод').id`) });
    await page.goto(page.base);
    await page.eval(HELPER);
    await sleep(600);
    const rec = await page.eval(`TS.app.exam.log.load('${no}')`);
    if (!rec || rec.status !== 'aborted') fail('после перезагрузки экзамен не «прерван»: ' + (rec && rec.status));
    if (await page.eval('TS.app.exam.active()')) fail('экзамен идёт после перезагрузки');
    const csv = await page.eval('TS.app.exam.csv()');
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    if (csv.charCodeAt(0) !== 0xFEFF) fail('CSV без BOM');
    if (!lines[0].startsWith('№ протокола;Дата;Начало;Окончание;Вид;ФИО')) fail('колонки CSV: ' + lines[0]);
    if (!csv.includes('Перезагрузкин Пётр') || !csv.includes('Прерван') || !csv.includes('Сидоров Сидор Сидорович;')) fail('в CSV нет записей экзаменов');
    if (lines.filter(l => l).some(l => l.split(';').length < 15)) fail('в строке CSV меньше колонок');
    await clickBtn('[data-act="exam"]', null, '«Экзамен»');
    await clickBtn('#modal footer .btn', 'Журнал экзаменов');
    if (SHOTS) await page.shot(`${OUT}/exam-journal.png`);
    await clickBtn('[data-m="ex-csv"]', null, '«Скачать CSV»');
    await closeModal();
    return `«прерван»; CSV: ${lines.filter(l => l).length - 1} записей, BOM, «;»`;
  });
  await check('exam', 'телефон 390×844', async () => {
    await page.viewport(390, 844, true);
    try {
      await page.goto(page.base);
      await page.eval(HELPER);
      await clickBtn('[data-act="exam"]', null, '«Экзамен»');
      await page.waitFor('!!document.getElementById("exTasks")', 2000, 'окно экзамена');
      const w = await page.eval('document.querySelector("#modal .dialog").scrollWidth <= document.querySelector("#modal .dialog").clientWidth + 1');
      if (!w) fail('окно экзамена шире экрана');
      if (SHOTS) await page.shot(`${OUT}/exam-setup-phone.png`);
      await clickBtn('#modal footer .btn', 'Журнал экзаменов');
      if (SHOTS) await page.shot(`${OUT}/exam-journal-phone.png`);
      await clickBtn('[data-m="ex-open"]', null, '«Протокол»');
      if (SHOTS) await page.shot(`${OUT}/exam-protocol-phone.png`);
      await closeModal();
      return 'окно, журнал и протокол помещаются';
    } finally {
      await page.viewport(1366, 860);
      await page.goto(page.base);
      await page.eval(HELPER);
    }
  });
} };

// Площадка: в 2D на 1366×860 подписи не налезают друг на друга; пешком к каждой тележке можно подойти и навести прицел
SUITES.yard = { perScheme: true, fn: async keys => {
  for (const key of keys) {
    if (await page.eval(`!!TS.SAMPLES.find(s => s.key === '${key}').poly`)) continue;
    await check('yard', key, async () => {
      await chooseScheme(key);
      await setMode('train');
      await clickBtn('#zFit', null, '«Вписать»');
      await sleep(100);
      // пересечения подписей (в клетках схемы), заметные глазу: больше 0,05 клетки по обеим осям
      const over = await page.eval(`(() => {
        // рамка строки выше букв (межстрочный запас): берём середину по высоте — высоту строчных и прописных букв
        const t = [...document.querySelectorAll('#ll text')].map(e => { const b = e.getBBox(); return { s: e.textContent, b: { x: b.x, width: b.width, y: b.y + b.height * 0.22, height: b.height * 0.56 } }; }).filter(q => q.b.width > 0);
        const out = [];
        for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
          const a = t[i].b, b = t[j].b, dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (dx > 0.05 && dy > 0.05) out.push(t[i].s + ' / ' + t[j].s);
        }
        return out; })()`);
      if (SHOTS) await page.shot(`${OUT}/yard-${key}-2d.png`);
      if (over.length) fail(`подписи налезают: ${over.slice(0, 4).join('; ')}${over.length > 4 ? ` и ещё ${over.length - 4}` : ''}`);
      await setMode('3d');
      await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.world)', 15000, '3D');
      if (!(await page.eval('TS.app.v3.yardWalk'))) await clickBtn('#btnWalk', null, '«Пешком»');
      await page.eval('TS.app.v3.walk.lockChanged(true)');
      const res = await page.eval(`(() => {
        const v = TS.app.v3, w = v.walk, carts = TS.app.scheme.els.filter(e => TS.TYPES[e.t].cart), bad = [];
        for (const el of carts) {
          const t = v.aimTarget({ dev: el.id }), q = t && w.seek(t.p, t.want, false, [2.5, 3.2, 4, 1.8, 5]);
          if (!q) bad.push(el.name);
        }
        return { n: carts.length, bad };
      })()`);
      if (SHOTS && res.n) {
        const first = await page.eval(`TS.app.scheme.els.find(e => TS.TYPES[e.t].cart).id`);
        await page.fn(id => { const v = TS.app.v3, t = v.aimTarget({ dev: id }), q = v.walk.seek(t.p, t.want, false, [3.2, 4, 2.5]); if (q) v.walk.pose(q); }, first);
        await sleep(400);
        await page.shot(`${OUT}/yard-${key}-walk.png`);
      }
      await clickBtn('#btnWalk', null, '«Обзор»');
      await setMode('train');
      if (res.bad.length) fail(`пешком не подойти к тележкам: ${res.bad.join(', ')}`);
      return `подписи не налезают; ${res.n ? `тележек ${res.n}, к каждой можно подойти` : 'тележек нет'}`;
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
    page.base = url;
    await page.goto(url);
    await page.eval(HELPER);
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
