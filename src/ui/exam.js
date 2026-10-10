import { SAMPLES } from '../core/samples.js';
import { esc } from '../core/elements.js';
import { Trainer, fmtTime } from '../core/engine.js';
import { planTask, runAction } from '../core/plan.js';
import * as X from '../core/exam.js';
import { store } from './store.js';

/* ===== Экзамен: выбор, ход, протокол, журнал (логика — src/core/exam.js) =====
   «Экзамен» — в панели заданий. Во время экзамена спрятаны подсказки, эталон в отчёте, «Следующее мероприятие» полигона,
   запись эталона, редактор и смена схемы; выйти — только «Прервать экзамен» с подтверждением.
   Перезагрузка посреди экзамена — в журнале «прерван». Протокол печатается (PDF — печатью браузера) только он сам: #print. */
class Exam {
  constructor(app) {
    this.app = app; this.log = X.makeExamLog(store);
    this.cur = null; this.i = 0; this.between = false; this.scheme = null; this.stopWhy = null; this.saved = null;
  }
  init() {
    const ab = this.log.abortRunning();
    if (ab.length) setTimeout(() => this.app.toast(`Экзамен (протокол № ${ab[0].no}) прерван: страницу перезагрузили или закрыли. Запись — в журнале экзаменов.`, 'warn'), 400);
  }
  active() { return !!this.cur; }
  task() { return this.cur && this.scheme ? this.scheme.tasks.find(t => t.id === this.cur.tasks[this.i].id) || null : null; }

  // ---------- выбор экзамена ----------
  // Схемы для экзамена: готовые и свои; у каждой — её задания
  schemes() {
    const out = SAMPLES.map(s => ({ v: s.key, title: s.title, load: () => s.make() }));
    for (const m of this.app.lib.list()) out.push({ v: 'my:' + m.id, title: m.title, load: () => this.app.lib.load(m.id) });
    return out;
  }
  loadScheme(v) { const r = this.schemes().find(x => x.v === v); return r ? r.load() : null; }
  setup() {
    const app = this.app;
    if (this.active()) return;
    if (app.tr.run && !app.tr.run.done) { app.toast('Сначала завершите задание.', 'warn'); return; }
    const list = this.schemes(), cur = list.some(x => x.v === app.source) ? app.source : list[0].v;
    const last = this.log.list().slice(-1)[0], lastX = last ? this.log.load(last.id) : null, lp = lastX ? lastX.person : {};
    const f = (id, label, v = '', extra = '') => `<div class="field"><label for="${id}">${label}</label><input class="inp" id="${id}" value="${esc(v)}" maxlength="120" ${extra}></div>`;
    app.openModal('Экзамен', `
      <div class="field"><label for="exScheme">Схема</label><select class="inp" id="exScheme">${list.map(x => `<option value="${esc(x.v)}" ${x.v === cur ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></div>
      <div class="field"><b>Задания <span class="muted">— от 1 до ${X.MAX_TASKS}</span></b><div id="exTasks" class="ex-tasks"></div></div>
      <div class="field"><b>Вид</b><div class="ex-kind">${Object.entries(X.EXAM_KINDS).map(([k, t], i) => `<label><input type="radio" name="exKind" value="${k}" ${i ? '' : 'checked'}> ${esc(t)}</label>`).join('')}</div></div>
      <div class="row ex-opts"><label class="switch"><span>Блокировки<small>Не дают выполнить опасную операцию</small></span><input type="checkbox" id="exLocks" checked></label>
        ${f('exLimit', 'Лимит времени, мин', '', 'type="number" min="1" max="180" placeholder="без лимита"')}${f('exMin', 'Порог: балл каждого не ниже', X.MIN_SCORE, 'type="number" min="0" max="100"')}</div>
      <p class="muted ex-rule">«Сдал»: все задания выполнены, без аварий и КЗ, балл каждого не ниже порога. Подсказок и эталона в экзамене нет.</p>
      <div class="field"><b>Экзаменуемый</b><div class="ex-person">${f('exFio', 'ФИО', '', 'autocomplete="off" required')}${f('exPost', 'Должность')}${f('exDept', 'Подразделение', lp.dept || '')}${f('exOrg', 'Предприятие', lp.org || '')}</div>
      <p class="muted">ФИО и результаты хранятся только в этом браузере (журнал экзаменов). Для архива — распечатайте протокол или скачайте CSV.</p></div>`, [
      { label: 'Журнал экзаменов', act: () => this.showLog() },
      { label: 'Отмена', act: () => app.closeModal() },
      { label: 'Начать экзамен', primary: true, act: () => this.startFromForm() },
    ]);
    const sel = document.getElementById('exScheme');
    sel.addEventListener('change', () => this.fillTasks(sel.value));
    this.fillTasks(cur);
    setTimeout(() => { const i = document.getElementById('exFio'); if (i) i.focus(); }, 40);
  }
  fillTasks(v) {
    const s = this.loadScheme(v), box = document.getElementById('exTasks');
    if (!box) return;
    const ts = s ? s.tasks : [];
    box.innerHTML = ts.length ? ts.map((t, i) => `<label class="ex-task"><input type="checkbox" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''}> ${esc(t.title)}${t.measures ? ' <span class="chip">VR-полигон, 3D</span>' : ''}</label>`).join('')
      : '<p class="muted">У этой схемы нет заданий. Запишите их в режиме инструктора или выберите другую схему.</p>';
    const sync = () => { const c = [...box.querySelectorAll('input')], n = c.filter(x => x.checked).length; c.forEach(x => { x.disabled = !x.checked && n >= X.MAX_TASKS; }); };
    box.addEventListener('change', sync);
    sync();
  }
  startFromForm() {
    const app = this.app, v = id => (document.getElementById(id) || {}).value || '';
    const src = v('exScheme'), s = this.loadScheme(src);
    const ids = [...document.querySelectorAll('#exTasks input:checked')].map(x => x.value);
    const fio = v('exFio').trim();
    if (!s) { app.toast('Схема не открылась: запись в браузере повреждена.', 'warn'); return; }
    if (!ids.length) { app.toast('Отметьте хотя бы одно задание.', 'warn'); return; }
    if (!fio) { app.toast('Впишите ФИО экзаменуемого.', 'warn'); document.getElementById('exFio').focus(); return; }
    const kind = (document.querySelector('input[name="exKind"]:checked') || {}).value;
    this.start(s, src, {
      kind, interlocks: document.getElementById('exLocks').checked, limitMin: v('exLimit'), minScore: v('exMin'),
      person: { fio, post: v('exPost'), dept: v('exDept'), org: v('exOrg') },
      tasks: ids.map(id => s.tasks.find(t => t.id === id)).filter(Boolean),
    });
  }

  // ---------- ход экзамена ----------
  start(s, src, cfg) {
    const app = this.app;
    const x = X.newExam(Object.assign({}, cfg, { schemeTitle: s.title, source: src }));
    if (!this.log.save(x)) app.toast('Журнал экзаменов в этом браузере не записался — протокол можно распечатать в конце.', 'warn');
    this.saved = { opt: Object.assign({}, app.tr.opt), guide: app.permit.guide };
    this.cur = x; this.i = 0; this.between = false; this.scheme = s; this.stopWhy = null;
    app.closeModal();
    if (app.tr.rec) app.tr.cancelRec();
    if (app.mode === 'edit') app.setMode('train');
    app.setScheme(s, src.startsWith('my:') || SAMPLES.some(q => q.key === src) ? src : 'file');
    app.tr.opt.interlocks = x.interlocks; app.tr.opt.requireCheck = true;
    // «Допустимо: … ток холостого хода» в журнале — оценка операции: в экзамене её нет
    app.tr.opt.explain = false;
    // «Следующее мероприятие» полигона — подсказка: в экзамене её нет
    app.permit.guide = false;
    this.lock(true);
    app.syncMax3D();
    this.startTask();
    app.toast(`Экзамен начат: ${x.person.fio}, заданий ${x.tasks.length}.`, 'ok');
  }
  startTask() {
    const app = this.app, t = this.task();
    this.between = false;
    if (!t) { this.finish(false); return; }
    app.startTask(t);
    app.renderSide();
    if (app.v3 && app.v3.ready) app.v3.drawBoard();
  }
  // Задание закончилось (выполнено, «Завершить задание», прервали или вышло время)
  onDone(run) {
    const x = this.cur, t = this.task();
    if (!x || !t || run.task.id !== t.id) return;
    x.results[this.i] = X.taskResult(run);
    this.log.save(x);
    this.app.tr.exitTask();
    if (this.stopWhy) { this.finish(this.stopWhy === 'abort'); return; }
    if (this.i + 1 < x.tasks.length) {
      this.between = true;
      this.app.toast(`Задание ${this.i + 1} из ${x.tasks.length} завершено. Следующее — «${x.tasks[this.i + 1].title}».`, 'ok');
      this.app.renderSide();
      if (this.app.v3 && this.app.v3.ready) this.app.v3.drawBoard();
      return;
    }
    this.finish(false);
  }
  next() { if (this.cur && this.between) { this.i++; this.startTask(); } }
  // Остановить экзамен: why = 'abort' (прервали) или 'time' (вышло время)
  stop(why) {
    const tr = this.app.tr;
    if (!this.cur) return;
    this.stopWhy = why;
    if (why === 'time') this.cur.timeUp = true;
    if (tr.run && !tr.run.done) tr.stopTask(); else this.finish(why === 'abort');
  }
  confirmAbort() {
    const app = this.app;
    app.openModal('Прервать экзамен?', `<p>Текущее задание будет записано как «не завершено», остальные — «не начато»; итог протокола — «Прерван».</p>`, [
      { label: 'Продолжить экзамен', primary: true, act: () => app.closeModal() },
      { label: 'Прервать', act: () => { app.closeModal(); this.stop('abort'); } },
    ]);
  }
  finish(aborted) {
    const app = this.app, x = this.cur;
    if (!x) return;
    X.finishExam(x, Date.now(), aborted);
    if (!this.log.save(x)) app.toast('Журнал экзаменов не записался в браузере — распечатайте протокол.', 'warn');
    this.cur = null; this.between = false; this.stopWhy = null;
    if (app.tr.run) app.tr.exitTask();
    this.lock(false);
    app.syncMax3D();
    if (this.saved) { Object.assign(app.tr.opt, this.saved.opt); app.permit.guide = this.saved.guide; this.saved = null; }
    app.renderSide();
    if (app.v3 && app.v3.ready) app.v3.drawBoard();
    this.showProtocol(x);
  }
  // Время экзамена: лимит — общий на все задания
  left() { const x = this.cur; return x && x.limitMin ? x.limitMin * 60 - (Date.now() - x.t0) / 1000 : null; }
  tick() {
    if (!this.cur) return;
    const l = this.left(), e = document.getElementById('exLeft');
    if (e && l != null) e.textContent = fmtTime(Math.max(0, l));
    if (l != null && l <= 0) { this.app.toast('Время экзамена вышло.', 'warn'); this.stop('time'); }
  }
  // Подсказки, эталон, редактор, смена схемы, показ — спрятаны
  lock(on) {
    const root = document.getElementById('app');
    if (on) root.dataset.exam = '1'; else delete root.dataset.exam;
    for (const id of ['schemeSel', 'btnFile', 'tab-edit']) { const b = document.getElementById(id); if (b) b.disabled = on; }
  }
  // Строка на щите в 3D и в шлеме
  boardLine() {
    const x = this.cur;
    if (!x) return null;
    const l = this.left();
    return `Экзамен: задание ${this.i + 1} из ${x.tasks.length}${this.between ? ' завершено' : ''}${l != null ? ` · осталось ${fmtTime(Math.max(0, l))}` : ''}`;
  }
  // Панель заданий во время экзамена
  taskHTML() {
    const app = this.app, x = this.cur, tr = app.tr, run = tr.run, l = this.left();
    const head = `<h3>Экзамен <span class="chip">идёт</span></h3>`;
    const who = `<div class="exam-who">${esc(x.person.fio)} · ${esc(X.EXAM_KINDS[x.kind])}${l != null ? ` · осталось <b id="exLeft">${fmtTime(Math.max(0, l))}</b>` : ''}</div>`;
    if (this.between) {
      const nx = x.tasks[this.i + 1];
      return `${head}<div class="task-card">${who}<p>Задание ${this.i + 1} из ${x.tasks.length} завершено.</p><h4>Следующее: ${esc(nx.title)}</h4>
        <div class="row"><button class="btn primary" data-act="exam-next">Начать задание ${this.i + 2}</button><button class="btn danger" data-act="exam-abort">Прервать экзамен</button></div></div>`;
    }
    if (!run || run.done) return `${head}<div class="task-card">${who}</div>`;
    const g = tr.grade(run);
    return `${head}<div class="task-card">${who}<div class="exam-n">Задание ${this.i + 1} из ${x.tasks.length}</div><h4>${esc(run.task.title)}</h4><div class="desc">${esc(run.task.desc)}</div>
      <div class="task-stats"><div><b id="tTime">${fmtTime(tr.elapsed())}</b><span>время</span></div><div><b id="tOps">${g.myOps}</b><span>операций</span></div>
      <div class="${run.errors.length ? 'bad' : ''}" id="tErrBox"><b id="tErr">${run.errors.length}</b><span>ошибок</span></div></div>
      <div class="row"><button class="btn" data-act="task-stop">Завершить задание</button><button class="btn danger" data-act="exam-abort">Прервать экзамен</button></div>
      <p class="muted">Подсказок и эталона в экзамене нет. Выйти — только «Прервать экзамен».</p></div>`;
  }
  action(act) {
    if (act === 'exam') this.setup();
    else if (act === 'exam-next') this.next();
    else if (act === 'exam-abort') this.confirmAbort();
    else if (act === 'exam-log') this.showLog();
  }

  // ---------- протокол ----------
  protocolHTML(x, sample) {
    const P = X.protocol(x);
    const verdict = P.status === 'passed' ? 'ok' : 'bad';
    return `<article class="proto">
      <div class="proto-h"><h2>${sample ? 'Образец протокола' : esc(P.title)}</h2><p>${esc(P.kind)} на тренажёре оперативных переключений</p></div>
      <dl class="proto-f">${P.fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <table class="proto-t"><thead><tr><th>№</th><th>Задание</th><th>Баллы</th><th>Время</th><th>Ошибки</th><th>Итог</th></tr></thead>
        <tbody>${P.rows.map(r => `<tr><td>${r.n}</td><td>${esc(r.title)}</td><td>${esc(r.score)}</td><td>${esc(r.time)}</td><td>${esc(r.errors)}</td><td>${esc(r.result)}</td></tr>`).join('')}</tbody></table>
      <p class="proto-v ${verdict}">Итог: <b>${esc(P.verdict)}</b>${P.status !== 'passed' && P.reasons.length ? ` — ${esc(P.reasons.join('; '))}` : ''}</p>
      <div class="proto-s">${P.signs.map(s => `<div><span>${esc(s)}</span><i></i><em>подпись</em><i></i><em>ФИО</em></div>`).join('')}</div>
      <p class="proto-n">${esc(P.note)}</p></article>`;
  }
  showProtocol(x, sample) {
    const app = this.app;
    app.openModal(sample ? 'Экзамен: образец протокола' : 'Протокол экзамена', this.protocolHTML(x, sample), [
      { label: 'Печать или PDF', primary: true, act: () => this.print(x, sample) },
      { label: 'Скопировать текст', act: () => app.copyText(X.protocolText(x), 'Текст протокола скопирован.') },
      ...(sample ? [] : [{ label: 'Журнал экзаменов', act: () => this.showLog() }]),
      { label: 'Закрыть', act: () => app.closeModal() },
    ]);
    const d = document.querySelector('#modal .dialog');
    if (d) d.classList.add('wide');
  }
  // Печать: только протокол, чёрное на белом, A4 (@media print в styles.css)
  print(x, sample) {
    let p = document.getElementById('print');
    if (!p) { p = document.createElement('div'); p.id = 'print'; document.body.appendChild(p); }
    p.innerHTML = this.protocolHTML(x, sample);
    try { window.print(); } catch (e) { this.app.toast('Печать недоступна в этом окне.', 'warn'); }
  }
  // Образец протокола для показа: настоящие прогоны движка (задание 1 — по эталону, задание 2 — ЗН без проверки), без записи в журнал
  demoPrepare() {
    const s = SAMPLES[0].make(), runs = s.tasks.map((t, i) => {
      const tr = new Trainer(); tr.load(s); tr.startTask(t);
      planTask(s, t).forEach((a, k, all) => { if (!(i === 1 && a.do === 'check' && all.slice(0, k).every(b => b.do !== 'check'))) runAction(tr, null, a); });
      if (!tr.run.done) tr.stopTask();
      return tr.run;
    });
    const t0 = Date.now() - 21 * 60000;
    const x = X.newExam({ kind: 'skills', schemeTitle: s.title, source: 'ps110', interlocks: true, person: { fio: 'Образец: ФИО экзаменуемого', post: 'электромонтёр ОВБ' }, tasks: s.tasks.map(t => ({ id: t.id, title: t.title })) }, t0);
    x.results = runs.map(X.taskResult);
    X.finishExam(x, Date.now());
    x.no = 'образец';
    this.showProtocol(x, true);
  }

  // ---------- журнал ----------
  showLog(st = {}) {
    const app = this.app, list = this.log.list().slice().reverse();
    const when = t => { try { return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    const row = r => {
      if (st.del === r.id) return `<li class="sch-row confirm" role="alert"><p>Удалить протокол № ${esc(r.no)} (${esc(r.fio || 'без ФИО')})? Вернуть его будет нельзя.</p>
        <div class="row"><button class="btn danger-fill" data-m="ex-del-ok" data-id="${esc(r.id)}">Удалить</button><button class="btn" data-m="ex-del-no">Отмена</button></div></li>`;
      const broken = !this.log.load(r.id);
      return `<li class="sch-row"><div class="sch-t"><b>№ ${esc(r.no)} · ${esc(r.fio || 'без ФИО')}</b><span>${esc(when(r.t))} · ${esc(X.EXAM_KINDS[r.kind])} · ${esc(r.scheme)} · ${broken ? 'запись повреждена, протокол не открывается' : esc(X.STATUS[r.status])}</span></div>
        <div class="row">${broken ? '' : `<button class="btn primary" data-m="ex-open" data-id="${esc(r.id)}">Протокол</button>`}<button class="btn danger" data-m="ex-del" data-id="${esc(r.id)}">Удалить</button></div></li>`;
    };
    app.openModal('Журнал экзаменов', `<div class="field"><div class="row sch-head"><b>Протоколов · ${list.length}</b><button class="btn" data-m="ex-csv" ${list.length ? '' : 'disabled'}>Скачать CSV</button></div>
      ${list.length ? `<ul class="sch-list">${list.map(row).join('')}</ul>` : '<p class="muted">Экзаменов ещё не было. «Экзамен» — в панели заданий тренажёра.</p>'}
      <p class="muted">Журнал хранится только в этом браузере. Для архива — распечатайте протоколы или скачайте CSV (открывается в Excel).</p></div>`,
    [{ label: 'Закрыть', primary: true, act: () => app.closeModal() }]);
    const no = document.querySelector('.sch-row.confirm [data-m="ex-del-no"]');
    if (no) setTimeout(() => no.focus(), 40);
  }
  csv() { return this.log.csv(); }
  modal(m, b) {
    const app = this.app, id = b && b.dataset ? b.dataset.id : null;
    if (m === 'ex-open') { const x = this.log.load(id); if (x) this.showProtocol(x); else app.toast('Запись повреждена — её можно только удалить.', 'warn'); }
    else if (m === 'ex-del') this.showLog({ del: id });
    else if (m === 'ex-del-no') this.showLog();
    else if (m === 'ex-del-ok') { this.log.remove(id); this.showLog(); app.toast('Протокол удалён из журнала.'); }
    else if (m === 'ex-csv') app.saveFile(`Журнал экзаменов ${new Date().toISOString().slice(0, 10)}.csv`, this.csv(), 'text/csv;charset=utf-8');
  }
}

export { Exam };
