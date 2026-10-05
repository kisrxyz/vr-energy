import { APP_VER, TYPES, PALETTE, esc, vClass, V_CLASSES, isSwitchable } from '../core/elements.js';
import { fmtTime, capFirst } from '../core/engine.js';
import { symbolIcon } from '../view2d/scheme2d.js';

/* ===== §5. Панели и окна ===== */
const Panels = {
  // ---------- уведомления ----------
  toast(text, level = 'info') {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + level;
    t.textContent = text;
    box.prepend(t);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => t.remove(), level === 'err' ? 6000 : level === 'warn' ? 4500 : 3000);
  },
  flash() {
    const f = document.getElementById('flash');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  },

  // ---------- палитра ----------
  buildPalette() {
    const pal = document.getElementById('palette');
    pal.innerHTML = '<div class="pal-h">Элементы</div>' + PALETTE.map(t =>
      `<button class="pal-item" data-type="${t}" aria-pressed="false" title="${esc(TYPES[t].title)}">${symbolIcon(t)}<span class="txt"><span class="nm">${esc(TYPES[t].title)}</span><span class="cd">${esc(TYPES[t].code)}</span></span></button>`).join('') +
      '<p class="pal-note">Выберите элемент и щёлкните по полю. Shift — поставить несколько.</p>';
    pal.addEventListener('click', e => {
      const b = e.target.closest('.pal-item');
      if (!b) return;
      const t = b.dataset.type;
      const next = this.view.placing === t ? null : t;
      this.view.setPlacing(next);
      this.paletteState(next);
      if (next) this.toast(`${TYPES[t].title}: щёлкните по полю, чтобы поставить.`);
    });
  },
  paletteState(t) {
    for (const b of document.querySelectorAll('.pal-item')) b.setAttribute('aria-pressed', String(b.dataset.type === t));
  },

  // ---------- легенда и строка подсказок ----------
  renderLegend() {
    const box = document.getElementById('legend');
    if (this.mode === 'edit') {
      box.hidden = false;
      box.innerHTML = '<span><i class="sq" style="background:var(--on)"></i>включён</span><span><i class="sq" style="border:2px solid var(--off);background:transparent"></i>отключён</span><span>в редакторе — нормальное положение</span>';
      return;
    }
    if (this.mode === '3d') { box.hidden = true; return; }
    box.hidden = false;
    const present = new Set();
    for (const el of this.scheme.els) {
      if (TYPES[el.t].cls === 'source') present.add(vClass(+el.p.kv));
      if (el.t === 'transformer') { present.add(vClass(+el.p.kv1)); present.add(vClass(+el.p.kv2)); }
    }
    box.innerHTML = V_CLASSES.filter(([c]) => present.has(c)).map(([c, t]) => `<span><i style="background:var(--${c})"></i>${t}</span>`).join('') +
      '<span><i style="background:var(--dead)"></i>без напряжения</span>' +
      '<span><i style="background:repeating-linear-gradient(90deg,var(--gnd) 0 5px,transparent 5px 8px)"></i>заземлено</span>' +
      '<span><i class="sq" style="background:var(--on)"></i>включён</span><span><i class="sq" style="border:2px solid var(--off)"></i>отключён</span>';
  },
  renderStatus() {
    const st = document.getElementById('status');
    const k = s => `<kbd>${s}</kbd>`;
    if (this.mode === 'edit') st.innerHTML = `Элемент: выберите в палитре и щёлкните по полю · Провод: тяните от точки подключения · ${k('R')} повернуть · ${k('Del')} удалить · ${k('Ctrl+Z')} отменить · ${k('Ctrl+D')} копия · двойной щелчок по проводу — излом`;
    else if (this.mode === 'train') st.innerHTML = `Щелчок по аппарату — переключить · ${k('V')} указатель напряжения · ${k('K')} квитировать · колесо — масштаб, перетаскивание — сдвиг`;
    else st.innerHTML = 'Мышь: левая кнопка — повернуть, правая — сдвинуть, колесо — приблизить, щелчок по аппарату — переключить · В шлеме: курок — операция или телепорт, боковая кнопка — указатель напряжения, стики — ходьба и поворот';
  },

  // ---------- боковая панель ----------
  renderSide() {
    const side = document.getElementById('side');
    if (this.mode === 'edit') { side.innerHTML = this.editSideHTML(); return; }
    side.innerHTML = this.trainSideHTML();
    this.renderTask();
    this.renderRec();
    this.renderLog();
  },
  editSideHTML() {
    const s = this.scheme, sel = this.view.sel;
    let prop = '<h3>Выбрано</h3><p>Выберите элемент на схеме или возьмите новый из палитры слева.</p>';
    if (sel && sel.type === 'el') {
      const el = s.els.find(e => e.id === sel.id);
      if (el) {
        const T = TYPES[el.t], p = el.p;
        const num = (key, label, step) => `<div class="field"><label for="pp-${key}">${label}</label><input class="inp mono" type="number" step="${step}" min="0" id="pp-${key}" data-prop="p.${key}" value="${esc(p[key])}"></div>`;
        let f = `<div class="field"><label for="pp-name">Обозначение</label><input class="inp mono" id="pp-name" data-prop="name" value="${esc(el.name)}" maxlength="40"></div>`;
        if (el.t === 'source' || el.t === 'gen') f += num('kv', 'Напряжение, кВ', '0.1');
        if (el.t === 'transformer') f += `<div class="row">${num('kv1', 'ВН, кВ', '0.1')}${num('kv2', 'НН, кВ', '0.1')}${num('mva', 'Мощность, МВА', '0.01')}</div>`;
        if (el.t === 'load' || el.t === 'motor') f += num('kw', 'Мощность, кВт', '1');
        if (el.t === 'bus') f += num('len', 'Длина, клеток', '1');
        if (isSwitchable(el)) f += `<div class="field"><label>Нормальное положение</label><div class="seg"><button class="v-on" data-act="normal-on" aria-pressed="${el.on}">Включён</button><button class="v-off" data-act="normal-off" aria-pressed="${!el.on}">Отключён</button></div></div>`;
        f += '<div class="row"><button class="btn" data-act="rotate">Повернуть</button><button class="btn" data-act="dup">Копия</button><button class="btn danger" data-act="del">Удалить</button></div>';
        prop = `<h3>${esc(T.title)} <span class="chip">${esc(T.code)}</span></h3>${f}`;
      }
    } else if (sel && sel.type === 'wire') {
      prop = '<h3>Провод</h3><p>Соединяет только концы. Двойной щелчок меняет излом.</p><div class="row"><button class="btn" data-act="bend">Изменить излом</button><button class="btn danger" data-act="del">Удалить</button></div>';
    }
    const tasks = s.tasks.length ? '<ul class="issues">' + s.tasks.map(t => `<li>${esc(t.title)} <button class="btn" style="padding:2px 8px;margin-left:4px" data-act="task-del" data-id="${t.id}">Удалить</button></li>`).join('') + '</ul>'
      : '<p>Заданий нет. Их записывают во вкладке «Тренажёр» → «Режим инструктора».</p>';
    return `<div class="sec"><h3>Схема</h3>
      <div class="field"><label for="schTitle">Название</label><input class="inp" id="schTitle" data-prop="title" value="${esc(s.title)}" maxlength="80"></div>
      <dl class="kv"><dt>Элементов</dt><dd>${s.els.length}</dd><dt>Проводов</dt><dd>${s.wires.length}</dd><dt>Заданий</dt><dd>${s.tasks.length}</dd></dl>
      <div class="row"><button class="btn" data-act="validate">Проверить схему</button><button class="btn" data-act="undo" ${this.undoStack.length ? '' : 'disabled'}>Отменить</button><button class="btn" data-act="redo" ${this.redoStack.length ? '' : 'disabled'}>Вернуть</button></div>
      <div id="issues"></div></div>
      <div class="sec" id="propSec">${prop}</div>
      <div class="sec"><h3>Задания схемы</h3>${tasks}</div>
      <div class="sec"><h3>Как собирать</h3><ul class="issues">
        <li>Аппараты соединяются только концами проводов; точка в месте соединения — признак связи.</li>
        <li>Красный кружок на конце — точка ни к чему не подключена.</li>
        <li>У шины можно подключаться в любой точке. Длину меняет квадрат на её конце.</li>
        <li>Двойной щелчок по аппарату поворачивает его.</li></ul></div>`;
  },
  trainSideHTML() {
    const welcome = this.welcomeSeen ? '' : `<div class="sec"><div class="welcome"><b>${esc(this.scheme.title)}</b>
      <ol><li>Нажмите на выключатель или разъединитель: он переключится, а цвет шин покажет, где напряжение.</li>
      <li>Выберите задание и нажмите «Начать» — программа оценит переключения.</li>
      <li>Вкладка «3D и VR» — та же схема в объёме, в шлеме Quest — в VR.</li></ol>
      <div class="row"><button class="btn" data-act="welcome-close">Понятно</button><button class="btn" data-act="help">Подробнее</button></div></div></div>`;
    const o = this.tr.opt;
    return `${welcome}<div class="sec" id="taskSec"></div>
      <div class="sec"><h3>Инструменты</h3>
        <div class="row"><button class="btn" data-act="tool-check" aria-pressed="${this.tool === 'check'}">Указатель напряжения</button>
        <button class="btn" data-act="ack" id="ackBtn" ${this.tr.hasAlarms() ? '' : 'disabled'}>Квитировать</button>
        <button class="btn" data-act="reset">Нормальный режим</button></div>
        <label class="switch"><span>Блокировки<small>Не дают выполнить опасную операцию</small></span><input type="checkbox" data-opt="interlocks" ${o.interlocks ? 'checked' : ''}></label>
        <label class="switch"><span>Проверка напряжения перед ЗН<small>В свободной тренировке; в задании — по эталону</small></span><input type="checkbox" data-opt="requireCheck" ${o.requireCheck ? 'checked' : ''}></label>
      </div>
      <div class="sec"><h3>Журнал <span class="chip" id="logCount">0</span></h3><ul class="log" id="log"></ul></div>
      <div class="sec" id="recSec"></div>`;
  },
  renderTask() {
    const box = document.getElementById('taskSec');
    if (!box) return;
    const tr = this.tr, run = tr.run, tasks = this.scheme.tasks;
    if (run && !run.done) {
      const g = tr.grade(run);
      box.innerHTML = `<h3>Задание <span class="chip">идёт</span></h3><div class="task-card"><h4>${esc(run.task.title)}</h4><div class="desc">${esc(run.task.desc)}</div>
        <div class="task-stats"><div><b id="tTime">${fmtTime(tr.elapsed())}</b><span>время</span></div><div><b id="tOps">${g.myOps}</b><span>операций</span></div>
        <div class="${run.errors.length ? 'bad' : ''}" id="tErrBox"><b id="tErr">${run.errors.length}</b><span>ошибок</span></div></div>
        <div class="row"><button class="btn" data-act="task-hint">Подсказка</button><button class="btn" data-act="task-stop">Завершить</button></div>
        <div id="hintBox"></div></div>`;
      return;
    }
    if (run && run.done) {
      const g = run.grade;
      box.innerHTML = `<h3>Задание</h3><div class="task-card"><h4>${esc(run.task.title)}</h4>
        <div class="verdict ${g.tone}"><span class="score">${g.score}</span><div><b>${esc(g.verdict)}</b><div class="desc">Время ${fmtTime(g.secs)} · операций ${g.myOps} (эталон ${g.refOps}) · ошибок ${run.errors.length}</div></div></div>
        <div class="row"><button class="btn primary" data-act="report">Отчёт</button><button class="btn" data-act="task-again">Ещё раз</button><button class="btn" data-act="task-exit">Свободный режим</button></div></div>`;
      return;
    }
    if (tr.rec) { box.innerHTML = '<h3>Задание</h3><p>Идёт запись эталона — задания недоступны.</p>'; return; }
    if (!tasks.length) { box.innerHTML = '<h3>Задание</h3><p>У этой схемы пока нет заданий. Запишите эталон в режиме инструктора ниже.</p>'; return; }
    if (this.taskIdx >= tasks.length) this.taskIdx = 0;
    box.innerHTML = `<h3>Задание</h3><select class="inp" id="taskSel" aria-label="Задание">${tasks.map((t, i) => `<option value="${i}" ${i === this.taskIdx ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select>
      <p>${esc(tasks[this.taskIdx].desc)}</p>
      <div class="row"><button class="btn primary" data-act="task-start">Начать задание</button></div>
      <p>Или тренируйтесь свободно: нажимайте на аппараты на схеме.</p>`;
  },
  renderTaskStats() {
    const run = this.tr.run;
    if (!run || run.done) return;
    const t = document.getElementById('tTime'), o = document.getElementById('tOps'), e = document.getElementById('tErr'), eb = document.getElementById('tErrBox');
    if (t) t.textContent = fmtTime(this.tr.elapsed());
    if (o) o.textContent = run.ops.filter(x => x.op !== 'check').length;
    if (e) e.textContent = run.errors.length;
    if (eb) eb.classList.toggle('bad', run.errors.length > 0);
  },
  showHint(text) {
    const b = document.getElementById('hintBox');
    if (b) b.innerHTML = `<div class="hint-box">${esc(text)}</div>`;
    this.toast(text);
  },
  renderRec() {
    const box = document.getElementById('recSec');
    if (!box) return;
    const r = this.tr.rec;
    if (this.tr.run && !this.tr.run.done) { box.innerHTML = '<h3>Режим инструктора</h3><p>Доступен после завершения задания.</p>'; return; }
    if (!r) {
      box.innerHTML = '<h3>Режим инструктора</h3><p>Запишите эталон: выполните переключения сами, и программа сделает из них задание для ученика.</p><div class="row"><button class="btn" data-act="rec-start">Записать задание</button></div>';
      return;
    }
    box.innerHTML = `<h3>Режим инструктора <span class="chip rec">запись</span></h3><p>Шагов записано: ${r.steps.length}${r.errors ? ` · ошибок: ${r.errors}` : ''}. Исходное положение аппаратов уже запомнено.</p>
      <div class="row"><button class="btn primary" data-act="rec-save" ${r.steps.length ? '' : 'disabled'}>Сохранить задание</button><button class="btn" data-act="rec-cancel">Отменить</button></div>`;
  },
  renderLog() {
    const ul = document.getElementById('log');
    if (!ul) return;
    const items = this.tr.log.slice(0, 80);
    ul.innerHTML = items.length ? items.map(e => `<li class="${e.level}"><time>${e.time}</time><span>${esc(e.text)}</span></li>`).join('') : '<li class="none"><span class="empty">Пока пусто. Действия и события появятся здесь.</span></li>';
    const c = document.getElementById('logCount');
    if (c) c.textContent = this.tr.log.length;
  },
  updateAlarmsBtn() {
    const b = document.getElementById('ackBtn');
    if (b) b.disabled = !this.tr.hasAlarms();
  },

  // ---------- окна ----------
  openModal(title, body, actions = []) {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT"><header><h2 id="dlgT">${esc(title)}</h2><button class="btn icon-btn" data-m="close" aria-label="Закрыть">×</button></header>
      <div class="body">${body}</div>${actions.length ? `<footer>${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''}" data-ma="${i}">${esc(a.label)}</button>`).join('')}</footer>` : ''}</div>`;
    m.hidden = false;
    this.modalActions = actions;
    const f = m.querySelector('.body input, .body textarea') || m.querySelector('footer .btn.primary') || m.querySelector('footer .btn, header .btn');
    if (f) setTimeout(() => f.focus(), 30);
    return m;
  },
  closeModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; this.modalActions = []; },

  showReport(run) {
    if (!run || !run.grade) return;
    const tr = this.tr, g = run.grade;
    const kindName = { accident: 'Авария', kz: 'КЗ', blocked: 'Блокировка', supply: 'Перерыв питания', proc: 'Порядок' };
    const errs = run.errors.length ? '<ul class="issues">' + run.errors.map(e => `<li class="bad"><span class="mono">${fmtTime(e.t)}</span> · ${kindName[e.kind] || e.kind}: ${esc(e.text)}</li>`).join('') + '</ul>' : '<p>Ошибок нет.</p>';
    const mine = run.ops.length ? '<ol>' + run.ops.map(o => `<li><span class="mono">${fmtTime(o.t)}</span> ${esc(capFirst(tr.stepText(o)))}</li>`).join('') + '</ol>' : '<p>Действий не было.</p>';
    const ref = '<ol>' + run.task.steps.map(s => `<li>${esc(capFirst(tr.stepText(s)))}</li>`).join('') + '</ol>';
    const body = `<div class="verdict ${g.tone}"><span class="score">${g.score}</span><div><b>${esc(g.verdict)}</b><div class="desc">из 100 баллов</div></div></div>
      <dl class="kv"><dt>Время</dt><dd>${fmtTime(g.secs)}</dd><dt>Операций</dt><dd>${g.myOps} (эталон ${g.refOps}${g.extra ? `, лишних ${g.extra}` : ''})</dd>
      <dt>Аварии и КЗ</dt><dd>${g.acc}</dd><dt>Блокировки</dt><dd>${g.blk}</dd><dt>Перерывы питания</dt><dd>${g.sup}</dd><dt>Нарушения порядка</dt><dd>${g.prc}</dd><dt>Подсказки</dt><dd>${g.hints}</dd></dl>
      <div><h4 style="margin:0 0 6px;font-size:13px">Ошибки</h4>${errs}</div>
      <div class="cols"><div><h4>Ваши действия (бланк)</h4>${mine}</div><div><h4>Эталон</h4>${ref}</div></div>
      <p class="desc" style="color:var(--muted);font-size:12px">Баллы: −40 за аварию или КЗ, −15 за перерыв питания, −10 за блокировку и нарушение порядка, −5 за подсказку, −2 за лишнюю операцию.</p>`;
    this.reportText = [
      `Тренажёр переключений — отчёт`, `Схема: ${this.scheme.title}`, `Задание: ${run.task.title}`, `Итог: ${g.verdict}, ${g.score} из 100`,
      `Время: ${fmtTime(g.secs)}; операций: ${g.myOps} (эталон ${g.refOps})`, '', 'Ошибки:',
      ...(run.errors.length ? run.errors.map(e => `- ${fmtTime(e.t)} ${kindName[e.kind] || e.kind}: ${e.text}`) : ['- нет']), '', 'Действия:',
      ...run.ops.map((o, i) => `${i + 1}. ${fmtTime(o.t)} ${capFirst(tr.stepText(o))}`),
    ].join('\n');
    this.openModal('Отчёт: ' + run.task.title, body, [
      { label: 'Скопировать отчёт', act: () => this.copyText(this.reportText) },
      { label: 'Скачать отчёт', act: () => this.saveFile(`Отчёт — ${run.task.title}`.replace(/[\\/:*?"<>|«»]+/g, '').slice(0, 120) + '.txt', this.reportText, 'text/plain') },
      { label: 'Ещё раз', act: () => { this.closeModal(); this.startTask(run.task); } },
      { label: 'Закрыть', primary: true, act: () => this.closeModal() },
    ]);
  },
  copyText(text, okMsg = 'Скопировано.') {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      this.toast(ok ? okMsg : 'Не удалось скопировать: выделите текст и нажмите Ctrl+C.', ok ? 'ok' : 'warn');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => this.toast(okMsg, 'ok'), fallback);
      else fallback();
    } catch (e) { fallback(); }
  },
  showSaveTask() {
    const r = this.tr.rec;
    if (!r) return;
    const warn = r.errors ? `<p style="color:var(--fault)">В записи ${r.errors} ошибок. Ученик будет сравниваться с эталоном с ошибками — лучше записать заново.</p>` : '';
    this.openModal('Сохранить задание', `${warn}
      <div class="field"><label for="tskTitle">Название задания</label><input class="inp" id="tskTitle" maxlength="120" placeholder="Например: вывод в ремонт В-10 Л-2"></div>
      <div class="field"><label for="tskDesc">Что нужно сделать (увидит ученик)</label><textarea class="inp" id="tskDesc" rows="3" maxlength="600"></textarea></div>
      <p style="color:var(--muted);font-size:13px">Шагов в эталоне: ${r.steps.length}. Потребители, которые не теряли питание при записи, ученику обесточивать нельзя.</p>`, [
      { label: 'Отмена', act: () => this.closeModal() },
      { label: 'Сохранить', primary: true, act: () => {
        const title = document.getElementById('tskTitle').value.trim() || 'Новое задание';
        const desc = document.getElementById('tskDesc').value.trim();
        const res = this.tr.saveRec(title, desc);
        if (res && res.error) { this.toast(res.error, 'warn'); return; }
        this.closeModal();
        this.taskIdx = this.scheme.tasks.length - 1;
        this.renderTask();
        this.toast('Задание сохранено в схеме.', 'ok');
      } },
    ]);
  },
  showFile() {
    const json = JSON.stringify(this.scheme, null, 1);
    this.fileJson = json;
    this.openModal('Файл схемы', `
      <div class="field"><b>Сохранить</b><p style="margin:0;color:var(--muted);font-size:13px">Схема сохраняется вместе с заданиями. Если кнопка «Скачать» не сработала (в окне предпросмотра так бывает), скопируйте текст и сохраните его в файл с расширением .json.</p>
      <div class="row"><button class="btn primary" data-m="download">Скачать файл</button><button class="btn" data-m="copy">Скопировать текст</button></div></div>
      <div class="field"><b>Открыть</b><div class="row"><button class="btn" data-m="open-file">Открыть файл .json</button></div>
      <label for="pasteJson">или вставьте текст схемы</label><textarea class="inp mono" id="pasteJson" rows="4" spellcheck="false"></textarea>
      <div class="row"><button class="btn" data-m="open-paste">Открыть из текста</button></div></div>
      <div class="field"><b>Новая схема</b><p style="margin:0;color:var(--muted);font-size:13px">Пустая схема заменит «Мою схему» в этом браузере. Нужное сохраните в файл заранее.</p>
      <div class="row"><button class="btn" data-m="new">Создать пустую схему</button></div></div>`);
  },
  showHelp() {
    this.openModal('Как пользоваться', `
      <div><b>Три режима</b><ul class="issues"><li><b>Редактор</b> — собрать схему из элементов: палитра слева, провода тянутся от точек подключения.</li>
      <li><b>Тренажёр</b> — переключения по щелчку. Цвет показывает напряжение, землю и положение аппаратов. Задания оцениваются, в конце — отчёт.</li>
      <li><b>3D и VR</b> — та же схема в объёме: щелчок мышью или луч контроллера переключает аппараты.</li></ul></div>
      <div><b>VR в шлеме Meta Quest</b><ol class="issues"><li>Выложите файл index.html на GitHub Pages (нужна ссылка https).</li><li>Откройте ссылку в браузере шлема, вкладка «3D и VR», кнопка «Войти в VR».</li>
      <li>Курок — переключить аппарат или переместиться в точку на земле. Боковая кнопка — указатель напряжения. Левый стик — ходьба, правый — поворот.</li>
      <li>Щит с заданием стоит перед вами: его кнопки нажимаются лучом.</li></ol></div>
      <div><b>Правила логики (проверить с преподавателем)</b><ol class="issues">
      <li>Заземляющий нож на участок под напряжением — авария: дуга, КЗ.</li>
      <li>Разъединитель на заземлённый участок под напряжением — авария.</li>
      <li>Выключатель на заземлённый участок — КЗ, выключатель отключается защитой.</li>
      <li>Разъединителем нельзя отключать и включать ток нагрузки — дуга. Ненагруженные шины и трансформаторы разъединителем отключать можно.</li>
      <li>Перед включением ЗН нужна проверка отсутствия напряжения указателем (правило включается в настройках).</li>
      <li>В задании нельзя обесточивать потребителей, которые в эталоне питание не теряли.</li>
      <li>При КЗ отключаются ближайшие к месту КЗ выключатели, через которые КЗ питается; если их нет — отключение со стороны энергосистемы.</li>
      <li>Блокировки не дают выполнить опасную операцию; попытка считается ошибкой.</li></ol></div>
      <div><b>Цвета</b><p style="margin:4px 0 0;color:var(--muted);font-size:13px">Цвета классов напряжения условные и настраиваются под стандарт предприятия. Красный аппарат — включён, зелёный — отключён. Мигает — отключился защитой, нужно квитировать.</p></div>
      <div><b>Клавиши</b><p style="margin:4px 0 0;color:var(--muted);font-size:13px">Редактор: R — повернуть, Del — удалить, Ctrl+Z / Ctrl+Y — отменить и вернуть, Ctrl+D — копия, Esc — отмена. Тренажёр: V — указатель напряжения, K — квитировать.</p></div>
      <p style="color:var(--muted);font-size:12px">Демо-бета ${APP_VER}. Схемы хранятся в этом браузере; для переноса сохраните файл.</p>`,
      [{ label: 'Понятно', primary: true, act: () => this.closeModal() }]);
  },
};

export { Panels };
