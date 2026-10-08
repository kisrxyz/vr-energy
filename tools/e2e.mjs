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
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
// --save-scene: записать невидимые коробки и места сцены как базу (tests/scene3d-base.json) — до правки графики
const SAVE_SCENE = argv.includes('--save-scene');
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
  // первый щелчок сразу после загрузки страницы headless-браузер иногда теряет — второй раз щёлкаем, если вкладка не открылась
  for (let i = 0; ; i++) {
    await clickBtn(`#tab-${m}`, null, 'вкладка ' + m);
    try { await page.waitFor(`TS.app.mode === '${m}'`, 2000); return; } catch (e) { if (i) throw e; }
  }
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

// Предметы полигона через интерфейс (прицел, E и Q), свободный режим: каждый вид поставить не туда → снять → поставить туда;
// плакат на ограждении → убрать ограждение → поднять плакат с пола. Подпись под прицелом у поставленного — «… — снять/убрать»
const ITEM_MOVES = [
  { item: 'nevkl1', wrong: 'drive:2', right: 'drive:3', verb: 'снять' },
  { item: 'lock', wrong: 'drive:2', right: 'drive:3', verb: 'снять' },
  { item: 'fence', wrong: 'zone:2', right: 'zone:3', verb: 'убрать', label: 'Переносное ограждение у яч.2 — убрать' },
  { item: 'pz', wrong: 'contact:4:lo', right: 'contact:3:lo', verb: 'снять' },
];
async function aimLabel(what) {
  const r = await page.fn(w => E2E.aim(w), what);
  if (!r.ok) fail(`прицел на ${JSON.stringify(what)}: ${r.why}`);
  return page.eval('TS.app.v3.walk.hud.aim.textContent');
}
SUITES.items = { perScheme: false, fn: async () => {
  await check('items', 'не туда → снять → туда', async () => {
    await openScheme('poly');
    await page.eval('TS.app.tr.resetToNormal()');
    await act3D({ do: 'wear', item: 'gloves' }); await act3D({ do: 'wear', item: 'helmet' });
    // отсеки яч.3 и яч.4 открыты: выключатель отключён, тележка в ремонтном положении (линия 4 без напряжения — ПЗ туда можно)
    for (const n of ['В-10 яч.3', 'В-10 яч.4']) {
      const id = await page.eval(`TS.app.scheme.els.find(e => e.name === ${JSON.stringify(n)}).id`);
      await act3D({ do: 'switch', id, menu: 'Отключить выключатель' });
      await act3D({ do: 'rack', id, menu: 'Тележку в ремонтное положение' });
      await sleep(2800);   // тележка едет
    }
    const out = [];
    for (const m of ITEM_MOVES) {
      await act3D({ do: 'place', item: m.item, at: m.wrong });
      await sleep(80);
      let st = await page.eval(`({ at: TS.app.permit.itemAt('${m.item}'), s: TS.app.v3.items.list.get('${m.item}').state, held: E2E.held() })`);
      if (st.at !== m.wrong || st.s !== 'mount' || st.held) fail(`${m.item}: не встал ${m.wrong} — ${JSON.stringify(st)}`);
      const lab = await aimLabel({ item: m.item });
      if (!lab.includes('— ' + m.verb) || (m.label && !lab.startsWith(m.label))) fail(`${m.item}: подпись под прицелом «${lab}»`);
      if (SHOTS && m.item === 'fence') await page.shot(`${OUT}/items-fence-aim.png`);
      await page.key('KeyE'); await sleep(80);
      st = await page.eval(`({ at: TS.app.permit.itemAt('${m.item}'), held: E2E.held() })`);
      if (st.held !== m.item || st.at) fail(`${m.item}: не снялся с ${m.wrong} — ${JSON.stringify(st)}`);
      await aimE({ mount: m.right }, 'место ' + m.right);
      st = await page.eval(`({ at: TS.app.permit.itemAt('${m.item}'), s: TS.app.v3.items.list.get('${m.item}').state, held: E2E.held() })`);
      if (st.at !== m.right || st.s !== 'mount' || st.held) fail(`${m.item}: не встал ${m.right} — ${JSON.stringify(st)}`);
      out.push(m.item);
    }
    // плакат на ограждении → убрать ограждение (плакат падает) → поднять плакат с пола
    await act3D({ do: 'place', item: 'stop1', at: 'fence' });
    if ((await page.eval(`TS.app.permit.itemAt('stop1')`)) !== 'fence') fail('плакат не повешен на ограждение');
    await aimE({ item: 'fence' }, 'ограждение');
    await page.waitFor(`E2E.held() === 'fence'`, 1500, 'ограждение в руке');
    await sleep(700);   // плакат падает на пол
    const fl = await page.eval(`({ s: TS.app.v3.items.list.get('stop1').state, at: TS.app.permit.itemAt('stop1') })`);
    if (fl.s !== 'floor' || fl.at) fail('плакат с ограждения не упал на пол: ' + JSON.stringify(fl));
    await page.key('KeyQ'); await sleep(60);
    await aimE({ item: 'stop1' }, 'плакат на полу');
    await page.waitFor(`E2E.held() === 'stop1'`, 1500, 'плакат с пола в руке');
    await page.key('KeyQ'); await sleep(60);
    await page.eval('TS.app.tr.resetToNormal()');
    return `${out.join(', ')} переставлены; плакат с упавшего ограждения поднят с пола`;
  });
  // Предпросмотр: призрак под прицелом — там же, где предмет встанет (±2 см); подсвечены ровно места из mountsFor;
  // с подсказками — кольцо у места ближайшего мероприятия; в экзамене кольца и «место работ» нет
  const frames = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))';
  const ghostAt = `(() => { const g = TS.app.v3.items.ghostShown; if (!g || !g.visible) return null; const p = g.getWorldPosition(new TS.app.v3.kit.T.Vector3()); return [p.x, p.y, p.z]; })()`;
  const objAt = id => `(() => { const p = TS.app.v3.items.list.get('${id}').obj.getWorldPosition(new TS.app.v3.kit.T.Vector3()); return [p.x, p.y, p.z]; })()`;
  const near = (a, b) => !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) <= 0.02);
  await check('items', 'призрак и подсветка мест', async () => {
    await openScheme('poly');
    await page.eval('TS.app.tr.resetToNormal()');
    await act3D({ do: 'wear', item: 'gloves' }); await act3D({ do: 'wear', item: 'helmet' });
    await grab('fence');
    await aimLabel({ mount: 'zone:2' });
    await page.eval(frames);
    const g = await page.eval(ghostAt);
    if (!g) fail('держим ограждение, прицел на zone:2 — призрака нет');
    const sp = await page.eval(`({ on: TS.app.v3.items.spotIds.slice().sort().join(), want: TS.app.permit.mountsFor('fence').sort().join(), vis: TS.app.v3.items.spots.visible })`);
    if (sp.on !== sp.want || !sp.vis) fail(`подсвечены ${sp.on}, а можно ${sp.want}`);
    if (SHOTS) await page.shot(`${OUT}/items-ghost-fence.png`);
    await page.key('KeyE'); await sleep(80);
    const f = await page.eval(objAt('fence'));
    if (!near(g, f)) fail(`ограждение встало не там, где призрак: ${g.map(x => x.toFixed(2))} → ${f.map(x => x.toFixed(2))}`);
    // плакат вторым на место: призрак в слоте со смещением
    await act3D({ do: 'place', item: 'nevkl2', at: 'drive:2' });
    await grab('nevkl1');
    await aimLabel({ mount: 'drive:2' });
    await page.eval(frames);
    const pg = await page.eval(ghostAt);
    await page.key('KeyE'); await sleep(80);
    const pp = await page.eval(objAt('nevkl1'));
    if (!near(pg, pp)) fail(`второй плакат встал не там, где призрак: ${pg} → ${pp}`);
    if ((await page.eval(`TS.app.v3.items.spots.visible`))) { await page.eval(frames); if (await page.eval(`TS.app.v3.items.spots.visible`)) fail('рука пустая, а места подсвечены'); }
    // задание с подсказками: кольцо у привода и двери яч.3 для «Не включать»
    await page.eval('TS.app.tr.resetToNormal()');
    await page.eval(`(() => { const app = TS.app; app.startTask(app.scheme.tasks[0]); const pl = TS.Plan.planTask(app.scheme, app.tr.run.task); for (const a of pl.slice(0, 4)) TS.Plan.runAction(app.tr, app.permit, a); })()`);
    await sleep(2800);
    await grab('nevkl1');
    await page.eval(frames);
    const mk = await page.eval(`TS.app.v3.items.markIds.slice().sort().join()`);
    if (mk !== 'door:3,drive:3') fail('кольцо следующего мероприятия: ' + mk);
    const lab = await aimLabel({ mount: 'drive:2' });
    if (!lab.includes('место работ — яч.3')) fail('нет мягкой подсказки «место работ — яч.3»: ' + lab);
    if (SHOTS) await page.shot(`${OUT}/items-ghost-guide.png`);
    await page.key('KeyQ'); await sleep(60);
    await page.eval('TS.app.tr.exitTask(); TS.app.tr.resetToNormal()');
    // экзамен: подсказок нет — ни кольца, ни «место работ»
    await page.eval(`(() => { const app = TS.app, s = app.scheme; app.exam.start(s, 'poly', { kind: 'skills', interlocks: true, person: { fio: 'Проверка Призрака' }, tasks: [s.tasks[0]] }); })()`);
    await page.waitFor('TS.app.exam.active() && !!TS.app.tr.run', 3000, 'экзамен начался');
    await page.eval(`(() => { const app = TS.app; const pl = TS.Plan.planTask(app.scheme, app.tr.run.task); for (const a of pl.slice(0, 4)) TS.Plan.runAction(app.tr, app.permit, a); })()`);
    await sleep(2800);
    await page.eval('TS.app.v3.walk.lockChanged(true)');
    await grab('nevkl1');
    await page.eval(frames);
    const ex = await page.eval(`({ mk: TS.app.v3.items.markIds.length, vis: TS.app.v3.items.marks.visible })`);
    const exLab = await aimLabel({ mount: 'drive:2' });
    await page.eval(frames);
    const exG = await page.eval(ghostAt);
    await page.key('KeyQ'); await sleep(60);
    await page.eval(`TS.app.exam.stop('abort')`);
    await page.waitFor('!TS.app.exam.active() && !!document.querySelector("#modal .proto")', 3000, 'протокол прерванного экзамена');
    await closeModal();
    if (ex.mk || ex.vis) fail('в экзамене видно кольцо следующего мероприятия');
    if (exLab.includes('место работ') || exLab.includes('по порядку')) fail('в экзамене подсказка места: ' + exLab);
    if (!exG) fail('в экзамене нет нейтрального призрака');
    // полигон — в нормальный режим, тележки на место сразу (следующие проверки снимают сцену)
    await page.eval('TS.app.tr.resetToNormal(); TS.app.v3.update(true)');
    return 'призрак = место (ограждение, второй плакат), подсвечены места из mountsFor, кольцо и «место работ» — только с подсказками';
  });
  // Шлем (эмулятор iwer): ограждение рукой — подсветка у руки, взять боковой кнопкой, призрак у яч.2, поставить ровно в призрак,
  // снова взять у дальней стойки (раньше рука мерилась до угла у фасада — Б2)
  await check('items', 'шлем (эмулятор iwer): ограждение рукой', async () => {
    try {
      if (!(await installIwer())) return 'пропущено: iwer с CDN не загрузился (нет сети)';
      await openScheme('poly');
      await page.eval('TS.app.tr.resetToNormal()');
      await gesture('TS.app.v3.enterVR()');
      await page.waitFor('TS.app.v3.renderer.xr.isPresenting', 5000, 'вход в VR');
      const r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms)), d = __iwer, R = d.controllers.right, v = TS.app.v3, it = v.items, T = v.kit.T, out = {};
        const press = async b => { R.updateButtonValue(b, 1); await sleep(120); R.updateButtonValue(b, 0); await sleep(150); };
        await sleep(400);
        for (let i = 0; i < 3 && v.tutor && v.tutor.m.visible; i++) await press('trigger');
        v.rig.position.set(0, 0, 0); v.rig.rotation.set(0, 0, 0);
        const fh = v.room.fenceHome, c2 = v.room.cells.find(c => c.n === 2), ZF = v.room.ZF;
        d.position.set(3.6, 1.6, 1.4); R.position.set(fh.x, 0.6, fh.z); R.quaternion.set(0, 0, 0, 1);
        await sleep(300); out.hot = it.hot;
        await press('squeeze'); out.held = it.heldIn(R === d.controllers.right ? 1 : 0) || it.heldIn(0) || it.heldIn(1);
        d.position.set(c2.x + 0.3, 1.6, ZF + 2.8); R.position.set(c2.x, 1.1, ZF + 1.4);
        await sleep(400);
        const g = it.ghostShown, gp = g && g.visible ? g.getWorldPosition(new T.Vector3()) : null;
        out.ghost = gp ? it.ghostAt : null;
        await press('squeeze'); out.placed = TS.app.permit.itemAt('fence');
        out.match = gp ? gp.distanceTo(it.list.get('fence').obj.getWorldPosition(new T.Vector3())) : null;
        R.position.set(c2.x + 0.62, 0.7, ZF + 2.55);
        await sleep(300); out.hotPost = it.hot;
        await press('squeeze'); out.retaken = it.heldIn(0) || it.heldIn(1);
        return out; })()`);
      await page.eval('TS.app.v3.renderer.xr.getSession().end()');
      await page.waitFor('!TS.app.v3.renderer.xr.isPresenting', 3000, 'выход из VR');
      if (r.hot !== 'fence' || r.held !== 'fence') fail('рука у ограждения на стенде: ' + JSON.stringify(r));
      if (r.ghost !== 'zone:2' || r.placed !== 'zone:2' || !(r.match < 0.02)) fail('призрак и место у яч.2: ' + JSON.stringify(r));
      if (r.hotPost !== 'fence' || r.retaken !== 'fence') fail('поставленное ограждение не взять у дальней стойки: ' + JSON.stringify(r));
      return 'взято рукой, призрак у яч.2 = место, снова взято у дальней стойки';
    } finally {
      await page.goto(page.base);
      await page.eval(HELPER);
    }
  });
} };

// Переход и телепорт: метка на земле видна и прячется на аппарате; щелчок (E) — место сменилось, эффект кончился, экран не тёмный;
// за ограждением и в ячейке — «Туда не пройти», место прежнее. Площадка — E по прицелу, полигон без захвата мыши — щелчок мышью,
// телефон — касание пола
const IWER = 'https://cdn.jsdelivr.net/npm/iwer@2.5.0/+esm';
// Выражение как действие пользователя (вход в VR требует жеста)
const gesture = expr => page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }).then(r => {
  if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
  return r.result && r.result.result.value;
});
// Эмулятор шлема iwer (Quest 3) с CDN — только в странице проверки; false — нет сети
const installIwer = () => gesture(`(async () => { try { const m = await import('${IWER}'); window.__iwer = new m.XRDevice(m.metaQuest3); window.__iwer.installRuntime({ forceInstall: true }); return true; } catch (e) { return false; } })()`);
const tpState = `(() => { const v = TS.app.v3, w = v.walk, tp = v.tp; return { x: w.x, z: w.z, mark: tp.mark.visible, ok: tp.ok, busy: tp.busy,
  dark: tp.fade.visible && tp.fade.material.opacity > 0.02, aim: w.hud.aim.textContent, said: w.hud.said.hidden ? '' : w.hud.said.textContent,
  fx: w.floor ? w.floor.point.x : null, fz: w.floor ? w.floor.point.z : null }; })()`;
// Точка пола (x, z) на экране
const screenOf = (x, z) => page.fn((x, z) => { const v = TS.app.v3, T = v.kit.T, p = new T.Vector3(x, 0.01, z).project(v.camera), r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }, x, z);
const settle = () => page.eval('new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 650))');
async function tpCheck(where, st, to) {
  if (st.busy || st.dark) fail(`${where}: переход не закончился или экран тёмный`);
  if (to && Math.hypot(st.x - to.x, st.z - to.z) > 0.08) fail(`${where}: пришли в ${st.x.toFixed(2)}, ${st.z.toFixed(2)}, а метка была ${to.x.toFixed(2)}, ${to.z.toFixed(2)}`);
}
SUITES.teleport = { perScheme: false, fn: async () => {
  await check('teleport', 'площадка: метка, переход, «Туда не пройти»', async () => {
    await chooseScheme('ps110');
    await setMode('3d');
    await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.world)', 15000, '3D');
    if (!(await page.eval('TS.app.v3.yardWalk'))) await clickBtn('#btnWalk', null, '«Пешком»');
    await page.eval('TS.app.v3.walk.lockChanged(true)');
    // у ворот, взгляд под ноги вперёд — земля в 4–5 м
    await page.eval(`(() => { const w = TS.app.v3.walk, s = TS.app.v3.world.start; w.pose({ x: s.x, z: s.z, yaw: s.yaw, pitch: -0.36 }); })()`);
    let st = await page.eval(tpState);
    if (!st.mark || st.ok !== true || !st.aim.startsWith('Перейти сюда')) fail('на земле нет метки «можно»: ' + JSON.stringify(st));
    const to = { x: st.fx, z: st.fz };
    if (SHOTS) await page.shot(`${OUT}/teleport-mark.png`);
    await page.key('KeyE');
    await sleep(80);
    if (!(await page.eval('TS.app.v3.tp.busy'))) fail('переход не начался');
    await settle();
    st = await page.eval(tpState);
    await tpCheck('площадка', st, to);
    // на аппарате метки нет
    const dev = await page.eval(`TS.app.scheme.els.find(e => e.name === 'ЛР Л-1').id`);
    const r = await page.fn(id => E2E.aim({ dev: id }), dev);
    if (!r.ok) fail('прицел на ЛР Л-1: ' + r.why);
    st = await page.eval(tpState);
    if (st.mark) fail('метка видна, когда прицел на аппарате');
    // за дальним ограждением — нельзя
    await page.eval(`(() => { const v = TS.app.v3, w = v.walk, [x, z] = v.world.resolve(0, -v.bounds.hz + 1.4); w.pose({ x, z, yaw: 0, pitch: -0.36 }); })()`);
    st = await page.eval(tpState);
    if (!st.mark || st.ok !== false || st.aim !== 'Туда не пройти') fail('за ограждением нет метки «нельзя»: ' + JSON.stringify(st));
    if (SHOTS) await page.shot(`${OUT}/teleport-no.png`);
    const was = { x: st.x, z: st.z };
    await page.key('KeyE');
    await settle();
    st = await page.eval(tpState);
    if (Math.hypot(st.x - was.x, st.z - was.z) > 0.01) fail('за ограждение всё-таки перешли');
    if (st.said !== 'Туда не пройти') fail('нет «Туда не пройти» у прицела: ' + st.said);
    await tpCheck('за ограждением', st);
    await clickBtn('#btnWalk', null, '«Обзор»');
    return 'метка на земле, нет на аппарате; переход по E; за ограждение — «Туда не пройти»';
  });
  await check('teleport', 'полигон без захвата мыши: щелчок по полу и в ячейку', async () => {
    await openScheme('poly');
    await page.eval('TS.app.tr.resetToNormal(); (() => { const w = TS.app.v3.walk; w.lockChanged(false); w.noLock = true; w.showClick(); w.reset(TS.app.v3.room.start); })()');
    try {
      // пол коридора перед ячейками: встать лицом к нему
      await page.eval(`TS.app.v3.walk.pose({ x: 2.2, z: 2.6, yaw: Math.atan2(1.6, 1.2), pitch: -0.5 })`);
      let p = await screenOf(0.6, 1.4);
      await page.move(p.x, p.y); await settle();
      let st = await page.eval(tpState);
      if (!st.mark || st.ok !== true) fail('под курсором на полу нет метки: ' + JSON.stringify(st));
      const to = { x: st.fx, z: st.fz };
      await page.click(p.x, p.y);
      await settle();
      st = await page.eval(tpState);
      await tpCheck('полигон', st, to);
      // пол внутри ячейки №1 (между тележкой и ЗН не попасть): нельзя
      await page.eval(`TS.app.v3.walk.pose({ x: -1.86, z: 1.2, yaw: 0, pitch: -0.62 })`);
      p = await screenOf(-1.86, -1.6);
      await page.move(p.x, p.y); await settle();
      st = await page.eval(tpState);
      if (!st.mark || st.ok !== false || st.aim !== 'Туда не пройти') fail('в ячейке нет «Туда не пройти»: ' + JSON.stringify(st));
      const was = { x: st.x, z: st.z };
      await page.click(p.x, p.y);
      await settle();
      st = await page.eval(tpState);
      if (Math.hypot(st.x - was.x, st.z - was.z) > 0.01) fail('в ячейку всё-таки перешли');
      return 'метка под курсором, щелчок — переход; в ячейку — «Туда не пройти»';
    } finally {
      await page.eval('(() => { const w = TS.app.v3.walk; w.noLock = false; w.cursor = null; w.lockChanged(true); })()');
    }
  });
  // Шлем — эмулятор WebXR iwer (Quest 3) с CDN, только в странице проверки (в сборку не входит). Нет сети — проверка пропускается
  await check('teleport', 'шлем (эмулятор iwer): курок по земле', async () => {
    try {
      if (!(await installIwer())) return 'пропущено: iwer с CDN не загрузился (нет сети)';
      await chooseScheme('ps110');
      await setMode('3d');
      await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready)', 15000, '3D');
      await gesture('TS.app.v3.enterVR()');
      await page.waitFor('TS.app.v3.renderer.xr.isPresenting', 5000, 'вход в VR');
      const press = `(async () => { const R = __iwer.controllers.right; R.updateButtonValue('trigger', 1); await new Promise(r => setTimeout(r, 120)); R.updateButtonValue('trigger', 0); await new Promise(r => setTimeout(r, 120)); })()`;
      // первый вход: обучение из 3 шагов — его закрывает курок
      await sleep(400);
      for (let i = 0; i < 3 && (await page.eval('!!(TS.app.v3.tutor && TS.app.v3.tutor.m.visible)')); i++) { await page.eval(press); await sleep(200); }
      if (await page.eval('!!(TS.app.v3.tutor && TS.app.v3.tutor.m.visible)')) fail('обучение в шлеме не закрылось курком');
      // контроллер у пояса, луч вперёд-вниз на землю
      await page.eval(`(() => { const d = __iwer, R = d.controllers.right, a = -0.6; d.position.set(0, 1.6, 0); R.position.set(0.2, 1.2, -0.3); R.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2)); })()`);
      await settle();
      let st = await page.eval(`(() => { const v = TS.app.v3, tp = v.tp; return { mark: tp.mark.visible, ok: tp.ok, mx: tp.mark.position.x, mz: tp.mark.position.z, calls: v.renderer.info.render.calls }; })()`);
      if (!st.mark || st.ok !== true) fail('в шлеме под лучом на земле нет метки: ' + JSON.stringify(st));
      await page.eval(press);
      await settle();
      const c = await page.eval(`(() => { const v = TS.app.v3, p = v.camera.getWorldPosition(new v.kit.T.Vector3()); return { x: p.x, z: p.z, busy: v.tp.busy, dark: v.tp.fade.visible }; })()`);
      if (Math.hypot(c.x - st.mx, c.z - st.mz) > 0.1 || c.busy || c.dark) fail(`курок по земле: камера ${c.x.toFixed(2)}, ${c.z.toFixed(2)}, метка ${st.mx.toFixed(2)}, ${st.mz.toFixed(2)}${c.dark ? ', экран тёмный' : ''}`);
      await page.eval('TS.app.v3.renderer.xr.getSession().end()');
      await page.waitFor('!TS.app.v3.renderer.xr.isPresenting', 3000, 'выход из VR');
      const after = await page.eval('({ dark: TS.app.v3.tp.fade.visible, mark: TS.app.v3.tp.mark.visible })');
      if (after.dark || after.mark) fail('после выхода из VR осталось затемнение или метка');
      return `метка, затемнение и переход к метке; вызовов в шлеме (оба глаза, у ворот): ${st.calls}`;
    } finally {
      await page.goto(page.base);
      await page.eval(HELPER);
    }
  });
  await check('teleport', 'телефон 390×844: касание пола', async () => {
    await page.viewport(390, 844, true);
    try {
      await page.goto(page.base);
      await page.eval(HELPER);
      await openScheme('poly');
      await page.eval('TS.app.v3.walk.lockChanged(false)');
      if (!(await page.eval('TS.app.v3.walk.touch'))) fail('телефон не распознан как касание');
      if (!(await page.eval('TS.app.v3.walk.hud.click.hidden'))) fail('на телефоне видно «Мышь свободна — щёлкните по сцене»');
      await page.eval(`TS.app.v3.walk.pose({ x: 2.2, z: 2.6, yaw: Math.atan2(1.6, 1.2), pitch: -0.5 })`);
      const p = await screenOf(0.6, 1.4);
      const was = await page.eval(tpState);
      await page.tap(p.x, p.y);
      await settle();
      const st = await page.eval(tpState);
      if (SHOTS) await page.shot(`${OUT}/teleport-phone.png`);
      if (Math.hypot(st.x - was.x, st.z - was.z) < 0.3) fail('касание пола не перевело: ' + JSON.stringify(st));
      await tpCheck('телефон', st);
      return `касание — переход на ${Math.hypot(st.x - was.x, st.z - was.z).toFixed(1)} м`;
    } finally {
      await page.viewport(1366, 860);
      await page.goto(page.base);
      await page.eval(HELPER);
    }
  });
} };

// Подсказки шагов на площадках: каждое задание проходится в 3D пешком только по подсказкам — строка «Следующий шаг» верна на всём ходе,
// G ставит прицел на нужный аппарат (или провод), дальше — как человек: V/P, E, пункт меню. Итог — 100 баллов.
// В экзамене нет ни строки, ни маяка, ни G. «Обзор»: G наводит камеру на аппарат
const frames2 = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))';
const guideState = `(() => { const v = TS.app.v3, w = v.walk, g = TS.app.guideNext(); return { next: w.hud.next.hidden ? '' : w.hud.next.textContent,
  peek: g ? g.text : null, id: g ? g.step.id : null, op: g ? g.step.op : null, beacon: v.beacon.visible, aim: w.aim ? { type: w.aim.type, id: w.aim.id } : null,
  x: w.x, z: w.z, busy: v.tp.busy }; })()`;
SUITES.guide = { perScheme: true, fn: async keys => {
  for (const key of keys) {
    if (await page.eval(`!!TS.SAMPLES.find(s => s.key === '${key}').make().room`)) continue;
    const n = await page.eval(`TS.SAMPLES.find(s => s.key === '${key}').make().tasks.length`);
    for (let ti = 0; ti < n; ti++) {
      await check('guide', `${key} #${ti + 1}`, async () => {
        await chooseScheme(key);
        await setMode('3d');
        await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.world)', 15000, '3D');
        if (!(await page.eval('TS.app.v3.yardWalk'))) await clickBtn('#btnWalk', null, '«Пешком»');
        await page.eval('TS.app.v3.walk.lockChanged(true); TS.app.stepGuide = true');
        await startTask(ti);
        await page.eval('TS.app.v3.walk.reset(TS.app.v3.world.start)');
        let steps = 0;
        for (let i = 0; i < 40; i++) {
          if (await page.eval('!TS.app.tr.run || TS.app.tr.run.done')) break;
          await page.eval(frames2);
          const st = await page.eval(guideState);
          if (!st.peek) fail(`шаг ${i + 1}: подсказки нет, а задание идёт`);
          if (!st.next.startsWith('Следующий шаг: ' + st.peek)) fail(`шаг ${i + 1}: строка «${st.next}», а следующий — «${st.peek}»`);
          if (!st.beacon) fail(`шаг ${i + 1}: нет маяка над «${st.peek}»`);
          const before = await page.eval('E2E.run()');
          await page.key('KeyG');
          await sleep(30);
          await page.waitFor('!TS.app.v3.tp.busy', 3000, 'переход по G');
          await page.eval(frames2);
          const tool = st.op === 'check' ? 'check' : String(st.id).startsWith('pz:') ? 'pz' : null;
          if (tool) { await page.key(tool === 'check' ? 'KeyV' : 'KeyP'); await page.eval(frames2); }
          const aim = (await page.eval(guideState)).aim;
          const want = String(st.id).startsWith('pz:') && aim && aim.type === 'dev' ? st.id : String(st.id).startsWith('pz:') ? st.id.slice(3) : st.id;
          if (!aim || aim.id !== want) fail(`шаг ${i + 1} «${st.peek}»: после G под прицелом ${aim ? aim.type + ' ' + aim.id : 'ничего'}, а нужен ${want}`);
          await page.key('KeyE'); await sleep(80);
          // тележка: меню в 3D — пункт по шагу
          if (await page.eval('!!TS.app.v3.menu3d')) {
            const item = await page.eval(`(() => { const st = TS.app.tr.peek().step, el = TS.app.tr.elOf(st.id); return st.op === 'pos' ? TS.Plan.menuPos(st.pos) : TS.Plan.menuOn(st.op === 'on'); })()`);
            await aimE({ menu: item }, 'пункт «' + item + '»');
          }
          if (tool) { await page.key(tool === 'check' ? 'KeyV' : 'KeyP'); await sleep(40); }
          await sleep(60);
          const after = await page.eval('E2E.run()');
          if (after.errors.length > before.errors.length) fail(`шаг ${i + 1} «${st.peek}»: ошибка — ${after.errors.slice(before.errors.length).join('; ')}`);
          if (after.ops !== before.ops + 1) fail(`шаг ${i + 1} «${st.peek}»: E не сработало (операций ${before.ops} → ${after.ops})`);
          steps++;
          if (SHOTS && i === 0) await page.shot(`${OUT}/guide-${key}-${ti + 1}.png`);
        }
        const r = await waitReport();
        if (r.score !== 100 || r.verdict !== 'Выполнено без ошибок') fail(`отчёт: ${r.score}, «${r.verdict}»`);
        if (!r.text.includes('подсказки шагов были включены')) fail('в отчёте нет «подсказки шагов были включены»');
        await closeModal();
        await clickBtn('#btnWalk', null, '«Обзор»');
        return `${steps} шагов по подсказкам и G, 100 баллов`;
      });
    }
  }
  if (keys.length && keys.includes('ps110')) await check('guide', 'экзамен и «Обзор»', async () => {
    await chooseScheme('ps110');
    await setMode('3d');
    await page.waitFor('!!(TS.app.v3 && TS.app.v3.ready && TS.app.v3.world)', 15000, '3D');
    // «Обзор»: G — камера на аппарат следующего шага
    await page.eval('TS.app.stepGuide = true');
    await startTask(0);
    const o0 = await page.eval('TS.app.v3.orbit.target.toArray()');
    await page.eval('TS.app.v3.goNext()');
    const o1 = await page.eval(`(() => { const v = TS.app.v3, d = v.aimTarget({ dev: TS.app.tr.peek().step.id }).p; return { t: v.orbit.target.toArray(), d: [d.x, d.z] }; })()`);
    if (Math.hypot(o1.t[0] - o1.d[0], o1.t[2] - o1.d[1]) > 0.5) fail('в «Обзоре» камера не навелась на аппарат: ' + JSON.stringify({ o0, o1 }));
    await clickBtn('[data-act="task-stop"]', null, '«Завершить»');
    await waitReport(); await closeModal();
    // экзамен: ни строки, ни маяка, ни G, ни «Перейти к аппарату» в панели
    await page.eval(`(() => { const app = TS.app, s = app.scheme; app.exam.start(s, 'ps110', { kind: 'skills', interlocks: true, person: { fio: 'Проверка Подсказок' }, tasks: [s.tasks[0]] }); })()`);
    await page.waitFor('TS.app.exam.active() && !!TS.app.tr.run', 3000, 'экзамен начался');
    await setMode('3d');
    if (!(await page.eval('TS.app.v3.yardWalk'))) await clickBtn('#btnWalk', null, '«Пешком»');
    await page.eval('TS.app.v3.walk.lockChanged(true)');
    await settle();
    const ex = await page.eval(guideState);
    const panel = await page.eval(`({ line: !!document.getElementById('guideLine'), go: !!document.querySelector('[data-act="goto-next"]'), goto: !!document.querySelector('[data-act="goto"]') })`);
    await page.key('KeyG'); await settle();
    const ex2 = await page.eval(guideState);
    await page.eval(`TS.app.exam.stop('abort')`);
    await page.waitFor('!TS.app.exam.active() && !!document.querySelector("#modal .proto")', 3000, 'протокол');
    await closeModal();
    await clickBtn('#btnWalk', null, '«Обзор»');
    if (ex.next || ex.peek || ex.beacon) fail('в экзамене видна подсказка шага или маяк: ' + JSON.stringify(ex));
    if (panel.line || panel.go || panel.goto) fail('в экзамене в панели подсказка или «Перейти»');
    if (Math.hypot(ex2.x - ex.x, ex2.z - ex.z) > 0.01 || ex2.busy) fail('в экзамене G перевело к аппарату');
    return '«Обзор» — камера на аппарат; в экзамене нет строки, маяка, G';
  });
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

// Сцена 3D: невидимые коробки (щелчок, луч, прицел), места для предметов и предметы на стенде — там же, где в базе
// (tests/scene3d-base.json): графика не должна ломать ходьбу, предметы и автопроходку
const SCENE_BASE = new URL('../tests/scene3d-base.json', import.meta.url);
SUITES.scene3d = { perScheme: true, fn: async keys => {
  const base = existsSync(SCENE_BASE) ? JSON.parse(readFileSync(SCENE_BASE, 'utf8')) : {};
  for (const key of keys) {
    await check('scene3d', key, async () => {
      await page.eval(`(async () => { TS.app.chooseScheme('${key}'); TS.app.setMode('3d'); await TS.app.v3.show(); })()`);
      const snap = await page.eval(`(() => {
        const v = TS.app.v3, T = v.kit.T, b = new T.Box3(), c = new T.Vector3(), z = new T.Vector3(), r = x => Math.round(x * 100) / 100, out = {};
        v.root.updateMatrixWorld(true);
        for (const o of v.pickables) {
          const u = o.userData;
          let k = u.dev ? 'dev:' + TS.app.tr.nm(u.dev) : u.item ? 'item:' + u.item : u.mount ? 'mount:' + u.mount : u.wire ? 'wire:' + u.wire : u.board ? 'board' : null;
          if (!k) continue;
          // поставленное ограждение: коробки стоек и ленты — каждая под своим номером
          if (u.part === 'open') { let i = 1; while (out[k + ':open' + i]) i++; k += ':open' + i; }
          b.setFromObject(o); b.getCenter(c); b.getSize(z);
          out[k] = [r(c.x), r(c.y), r(c.z), r(z.x), r(z.y), r(z.z)];
        }
        return out; })()`);
      const n = Object.keys(snap).length;
      if (SAVE_SCENE) { base[key] = snap; return `записано в базу: ${n}`; }
      const was = base[key];
      if (!was) fail('нет базы сцены — запустите с --save-scene до правки графики');
      const bad = [];
      for (const k of new Set([...Object.keys(was), ...Object.keys(snap)])) {
        const a = was[k], q = snap[k];
        if (!a || !q) { bad.push(`${k}: ${a ? 'пропал' : 'новый'}`); continue; }
        if (a.some((x, i) => Math.abs(x - q[i]) > 0.02)) bad.push(`${k}: ${JSON.stringify(a)} → ${JSON.stringify(q)}`);
      }
      if (bad.length) fail(`сдвинулось ${bad.length}: ${bad.slice(0, 3).join('; ')}`);
      return `${n} коробок и мест на месте`;
    });
  }
  if (SAVE_SCENE) writeFileSync(SCENE_BASE, JSON.stringify(base, null, 1) + '\n');
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
