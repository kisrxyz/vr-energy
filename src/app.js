import { TYPES, ptKey, clamp, esc, portPoints, isSwitchable, emptyScheme, makeEl, makeWire, normalizeScheme } from './core/elements.js';
import { SAMPLES } from './core/samples.js';
import { buildTopo, makeSim, compute, Trainer } from './core/engine.js';
import { elSubtitle, Scheme2D } from './view2d/scheme2d.js';
import { Panels } from './ui/panels.js';
import { store } from './ui/store.js';
import { Sound } from './ui/sound.js';
import { View3D } from './view3d/view3d.js';

/* ===== Приложение: режимы, правка схемы, связка движка с 2D, 3D и панелями ===== */
const app = Object.assign({
  scheme: null, mode: 'train', tool: null, source: 'ps110', schemeVersion: 0, taskIdx: 0,
  tr: new Trainer(), view: null, v3: null, undoStack: [], redoStack: [], welcomeSeen: false, modalActions: [],

  init() {
    this.dl = null;
    try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(d => { this.dl = d; }, () => {}); } catch (e) { this.dl = null; }
    this.welcomeSeen = store.get('ts.welcome') === '1';
    const th = store.get('ts.theme');
    if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
    this.view = new Scheme2D(this, document.getElementById('sch'));
    this.buildPalette();
    this.bindUI();
    this.tr.on((type, d) => this.onTrainer(type, d));
    let hash = '';
    try { hash = (location.hash || '').slice(1); } catch (e) { hash = ''; }
    this.setScheme(SAMPLES[0].make(), 'ps110');
    this.setMode(['edit', 'train', '3d'].includes(hash) ? hash : 'train', true);
    setInterval(() => this.tick(), 1000);
  },
  userGesture() { Sound.init(); },

  // ---------- схемы ----------
  fillSchemeSelect() {
    const sel = document.getElementById('schemeSel');
    const hasMy = !!store.get('ts.my') || this.source === 'my';
    sel.innerHTML = SAMPLES.map(s => `<option value="${s.key}">${esc(s.title)}</option>`).join('') +
      (hasMy ? `<option value="my">Моя схема${this.source === 'my' && this.scheme ? ': ' + esc(this.scheme.title) : ''}</option>` : '');
    sel.value = this.source;
  },
  chooseScheme(v) {
    if (v === 'my') { const s = this.loadSaved(); if (s) this.setScheme(s, 'my'); else this.toast('Сохранённой схемы нет.', 'warn'); return; }
    const smp = SAMPLES.find(x => x.key === v);
    if (smp) this.setScheme(smp.make(), v);
  },
  setScheme(s, source) {
    this.scheme = s; this.source = source; this.schemeVersion++;
    this.undoStack = []; this.redoStack = []; this.taskIdx = 0;
    this.view.sel = null; this.view.setPlacing(null); this.paletteState(null);
    this.tr.load(s);
    this.fillSchemeSelect();
    this.view.render(); this.renderSide(); this.renderLegend();
    requestAnimationFrame(() => this.view.fit());
    if (this.mode === '3d') this.show3D();
  },
  loadSaved() {
    const j = store.get('ts.my');
    if (!j) return null;
    try { return normalizeScheme(JSON.parse(j)); } catch (e) { return null; }
  },
  autosave() { store.set('ts.my', JSON.stringify(this.scheme)); },
  markMine() {
    if (this.source === 'my') return;
    this.source = 'my';
    this.fillSchemeSelect();
    this.toast('Изменения сохраняются в этом браузере как «Моя схема».');
  },
  openJson(text) {
    let s;
    try { s = normalizeScheme(JSON.parse(text)); }
    catch (e) { this.toast('Не получилось открыть: ' + (e.message || 'файл повреждён') + '.', 'warn'); return false; }
    this.setScheme(s, 'my');
    this.autosave();
    this.fillSchemeSelect();
    this.toast(`Открыта схема «${s.title}».`, 'ok');
    return true;
  },

  // ---------- режимы ----------
  setMode(m, force) {
    if (m === this.mode && !force) return;
    const prev = this.mode;
    if (prev === 'edit' && m !== 'edit') this.tr.load(this.scheme);
    if (m === 'edit') {
      if (this.tr.run && !this.tr.run.done) this.toast('Задание прервано: открыт редактор.', 'warn');
      if (this.tr.rec) this.tr.cancelRec();
      this.tr.run = null; this.tool = null;
    } else { this.view.setPlacing(null); this.paletteState(null); }
    this.mode = m;
    const root = document.getElementById('app');
    root.dataset.mode = m; root.dataset.tool = this.tool || '';
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    document.getElementById('sch').style.display = m === '3d' ? 'none' : '';
    document.getElementById('view3d').hidden = m !== '3d';
    document.getElementById('zoomTools').hidden = m === '3d';
    if (m === '3d') this.show3D(); else if (this.v3) this.v3.hide();
    this.view.render(); this.renderSide(); this.renderLegend(); this.renderStatus();
    try { history.replaceState(null, '', '#' + m); } catch (e) { /* адрес не меняем */ }
  },
  async show3D() {
    const load = document.getElementById('v3load');
    try {
      if (!this.v3) this.v3 = new View3D(this, document.getElementById('view3d'));
      if (!this.v3.ready) { load.hidden = false; load.textContent = 'Загружаю 3D…'; }
      await this.v3.show();
      load.hidden = true;
    } catch (e) {
      console.error(e);
      load.hidden = false;
      load.textContent = 'Не удалось загрузить 3D-библиотеку. Проверьте интернет и обновите страницу.';
    }
  },
  toggleTool() {
    this.tool = this.tool === 'check' ? null : 'check';
    document.getElementById('app').dataset.tool = this.tool || '';
    if (this.tool) this.toast('Указатель напряжения: нажмите на аппарат, шину или провод.');
    this.renderSide(); this.view.render();
    if (this.v3) this.v3.drawBoard();
  },

  // ---------- действия на схеме ----------
  pick2D(c) {
    if (c.el) { this.pickEl(c.el, this.tool === 'check'); return; }
    if (c.w && this.tool === 'check') this.tr.check(c.w);
  },
  pick3D(id, alt) { this.pickEl(id, alt || this.tool === 'check'); },
  pickEl(id, check) {
    const el = this.scheme.els.find(e => e.id === id);
    if (!el) return;
    if (check) { this.tr.check(id); return; }
    if (isSwitchable(el)) this.tr.operate(id);
    else if (TYPES[el.t].cls === 'source') this.tr.toggleSource(id);
    else { const sub = elSubtitle(el); this.toast(`${el.name}: ${TYPES[el.t].title.toLowerCase()}${sub ? ', ' + sub : ''}. Переключаются выключатели, разъединители, автоматы и ЗН.`); }
  },
  startTask(task) {
    if (!task) return;
    if (this.tr.rec) { this.toast('Сначала сохраните или отмените запись.', 'warn'); return; }
    this.tool = null;
    document.getElementById('app').dataset.tool = '';
    this.tr.startTask(task);
    this.renderSide();
  },
  onTrainer(type, d) {
    if (type === 'state') {
      if (this.mode !== 'edit') this.view.render();
      if (this.v3 && this.v3.ready) this.v3.update();
      this.updateAlarmsBtn();
      return;
    }
    if (type === 'log') { this.renderLog(); return; }
    if (type === 'op') {
      if (d.blocked) { this.toast(d.text, 'warn'); Sound.play('blocked'); if (this.v3) this.v3.banner(d.text, 'warn'); }
      else if (d.info) this.toast(d.text);
      else if (d.viol && (d.viol.kind === 'accident' || d.viol.kind === 'kz')) {
        this.toast(d.viol.text, 'err'); this.flash(); Sound.play('arc');
        this.view.burst(d.id, 'var(--fault)');
        if (d.tripped && d.tripped.length) setTimeout(() => this.toast('Сработала защита: ' + d.tripped.map(t => this.tr.tripText(t)).join('; ') + '.', 'warn'), 700);
        if (this.v3) this.v3.banner(d.viol.text, 'err');
      } else if (d.viol) { this.toast(d.viol.text, 'warn'); Sound.play('disc'); if (this.v3) this.v3.banner(d.viol.text, 'warn'); }
      else if (d.ok) { const el = this.scheme.els.find(e => e.id === d.id); Sound.play(el && TYPES[el.t].sw === 'breaker' ? 'breaker' : 'disc'); }
      this.renderTaskStats(); this.renderRec();
      return;
    }
    if (type === 'fx') { if (this.v3 && this.v3.ready) this.v3.fx(d); return; }
    if (type === 'check') {
      this.toast(d.text, d.live ? 'warn' : 'ok');
      this.view.checkMark(d.target, d.live);
      Sound.play(d.live ? 'checklive' : 'check');
      if (this.v3 && this.v3.ready) this.v3.checkFx(d);
      this.renderTaskStats(); this.renderRec();
      return;
    }
    if (type === 'task') {
      this.renderTask(); this.renderRec();
      if (d.done && d.run) { Sound.play(d.run.grade.tone === 'good' ? 'ok' : 'fail'); setTimeout(() => this.showReport(d.run), 600); }
      if (this.v3 && this.v3.ready) this.v3.drawBoard();
      return;
    }
    if (type === 'hint') { this.showHint(d.text); if (this.v3) this.v3.banner(d.text, 'info'); return; }
    if (type === 'rec') { this.renderRec(); this.renderTask(); if (d.saved) { this.markMine(); this.autosave(); } }
  },

  // ---------- правка схемы ----------
  history() { this.undoStack.push(JSON.stringify(this.scheme)); if (this.undoStack.length > 120) this.undoStack.shift(); this.redoStack = []; },
  restore(json) { this.scheme = normalizeScheme(JSON.parse(json)); this.tr.load(this.scheme); this.view.sel = null; this.commit(true); },
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.scheme)); this.restore(this.undoStack.pop()); },
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.scheme)); this.restore(this.redoStack.pop()); },
  commit() {
    this.schemeVersion++;
    this.markMine();
    this.autosave();
    this.view.render(); this.renderSide(); this.renderLegend();
  },
  selEl() { const s = this.view.sel; return s && s.type === 'el' ? this.scheme.els.find(e => e.id === s.id) : null; },
  placeAt(t, g, keep) {
    this.history();
    let x = g[0];
    if (t === 'bus') x -= Math.floor(TYPES.bus.props.len / 2);
    const el = makeEl(this.scheme, t, x, g[1]);
    this.view.sel = { type: 'el', id: el.id };
    if (!keep) { this.view.setPlacing(null); this.paletteState(null); }
    this.commit();
  },
  addWire(a, b, vf) { this.history(); makeWire(this.scheme, a, b, vf); this.commit(); },
  cleanTasks() {
    const ids = new Set(this.scheme.els.map(e => e.id));
    this.scheme.tasks = this.scheme.tasks.map(t => ({
      ...t,
      init: Object.fromEntries(Object.entries(t.init).filter(([k]) => ids.has(k))),
      target: Object.fromEntries(Object.entries(t.target).filter(([k]) => ids.has(k))),
      steps: t.steps.filter(x => ids.has(x.id)), keep: t.keep.filter(k => ids.has(k)),
    })).filter(t => Object.keys(t.target).length);
  },
  deleteSel() {
    const sel = this.view.sel;
    if (!sel) return;
    this.history();
    if (sel.type === 'el') { this.scheme.els = this.scheme.els.filter(e => e.id !== sel.id); this.cleanTasks(); }
    else this.scheme.wires = this.scheme.wires.filter(w => w.id !== sel.id);
    this.view.sel = null;
    this.commit();
  },
  rotateSel() {
    const el = this.selEl();
    if (!el) return;
    this.history();
    const old = portPoints(el).map(ptKey);
    el.r = (el.r + 1) % 4;
    const now = portPoints(el);
    for (const w of this.scheme.wires) for (const end of ['a', 'b']) { const i = old.indexOf(ptKey(w[end])); if (i >= 0) w[end] = now[i].slice(); }
    this.commit();
  },
  duplicateSel() {
    const el = this.selEl();
    if (!el) return;
    this.history();
    const c = makeEl(this.scheme, el.t, el.x + 3, el.y, { r: el.r, p: JSON.parse(JSON.stringify(el.p)), on: el.on });
    this.view.sel = { type: 'el', id: c.id };
    this.commit();
  },
  setNormal(on) { const el = this.selEl(); if (!el || !isSwitchable(el)) return; this.history(); el.on = on; this.commit(); },
  setProp(path, raw) {
    const s = this.scheme;
    if (path === 'title') { this.history(); s.title = String(raw).trim() || 'Схема'; this.commit(); this.fillSchemeSelect(); return; }
    const el = this.selEl();
    if (!el) return;
    if (path === 'name') { const v = String(raw).trim(); if (!v) { this.renderSide(); return; } this.history(); el.name = v; this.commit(); return; }
    if (path.startsWith('p.')) {
      const key = path.slice(2);
      let v = parseFloat(String(raw).replace(',', '.'));
      if (!isFinite(v) || v <= 0) { this.toast('Нужно положительное число.', 'warn'); this.renderSide(); return; }
      if (key === 'len') v = clamp(Math.round(v), 1, 200);
      this.history(); el.p[key] = v; this.commit();
    }
  },
  validate() {
    const s = this.scheme, topo = buildTopo(s), issues = [];
    if (!s.els.some(e => TYPES[e.t].cls === 'source')) issues.push(['bad', 'Нет источника питания: добавьте энергосистему или генератор.']);
    const free = [];
    for (const el of s.els) {
      if (el.t === 'bus') continue;
      if (topo.portKeys.get(el.id).some(k => { const u = topo.use.get(k); return u.ports + u.wires < 2 && !u.bus; })) free.push(el.name);
    }
    if (free.length) issues.push(['bad', `Не подключены: ${free.slice(0, 12).join(', ')}${free.length > 12 ? ' и ещё ' + (free.length - 12) : ''}.`]);
    const cnt = new Map();
    for (const el of s.els) cnt.set(el.name, (cnt.get(el.name) || 0) + 1);
    const dup = [...cnt].filter(([, n]) => n > 1).map(([k]) => k);
    if (dup.length) issues.push(['bad', `Повторяются обозначения: ${dup.join(', ')}.`]);
    const pos = new Map();
    for (const el of s.els) { if (el.t === 'bus') continue; const k = el.x + ',' + el.y; if (pos.has(k)) issues.push(['bad', `${pos.get(k)} и ${el.name} стоят в одной точке.`]); else pos.set(k, el.name); }
    for (const el of s.els) {
      const t = topo.term.get(el.id);
      if (el.t === 'transformer' && t[0] === t[1]) issues.push(['bad', `${el.name}: обмотки ВН и НН замкнуты проводом.`]);
      if (TYPES[el.t].cls === 'switch' && t[0] === t[1]) issues.push(['bad', `${el.name} закорочен проводом.`]);
    }
    const st = compute(s, topo, makeSim(s));
    if ([...st.V.keys()].some(n => st.G.has(n))) issues.push(['bad', 'В нормальном положении напряжение встречается с заземлением — КЗ.']);
    const dead = s.els.filter(e => TYPES[e.t].cls === 'load' && !st.loads.has(e.id)).map(e => e.name);
    if (dead.length) issues.push(['', `В нормальном положении без питания: ${dead.join(', ')}.`]);
    const box = document.getElementById('issues');
    if (box) box.innerHTML = issues.length ? '<ul class="issues">' + issues.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join('') + '</ul>' : '<p style="color:var(--ok)">Ошибок не найдено.</p>';
    return issues;
  },

  // ---------- интерфейс ----------
  bindUI() {
    for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => this.setMode(b.dataset.mode));
    document.getElementById('schemeSel').addEventListener('change', e => this.chooseScheme(e.target.value));
    document.getElementById('btnFile').addEventListener('click', () => this.showFile());
    document.getElementById('btnHelp').addEventListener('click', () => this.showHelp());
    document.getElementById('btnTheme').addEventListener('click', () => this.toggleTheme());
    const snd = document.getElementById('btnSound');
    snd.addEventListener('click', () => { Sound.init(); Sound.on = !Sound.on; snd.setAttribute('aria-pressed', String(Sound.on)); this.toast(Sound.on ? 'Звук включён.' : 'Звук выключен.'); });
    document.getElementById('zIn').addEventListener('click', () => this.view.zoomCenter(1.25));
    document.getElementById('zOut').addEventListener('click', () => this.view.zoomCenter(0.8));
    document.getElementById('zFit').addEventListener('click', () => this.view.fit());
    document.addEventListener('pointerdown', () => this.userGesture(), true);

    const side = document.getElementById('side');
    side.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      this.sideAction(b.dataset.act, b);
    });
    side.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.prop) this.setProp(t.dataset.prop, t.value);
      else if (t.dataset.opt) {
        this.tr.opt[t.dataset.opt] = t.checked;
        const names = { interlocks: 'Блокировки', requireCheck: 'Проверка напряжения перед ЗН' };
        this.toast(`${names[t.dataset.opt]}: ${t.checked ? 'включено' : 'выключено'}.`);
        if (this.v3 && this.v3.ready) this.v3.drawBoard();
      } else if (t.id === 'taskSel') { this.taskIdx = +t.value; this.renderTask(); if (this.v3 && this.v3.ready) this.v3.drawBoard(); }
    });

    const modal = document.getElementById('modal');
    modal.addEventListener('click', e => {
      if (e.target === modal) { this.closeModal(); return; }
      const a = e.target.closest('[data-ma]');
      if (a) { const act = this.modalActions[+a.dataset.ma]; if (act && act.act) act.act(); return; }
      const m = e.target.closest('[data-m]');
      if (m) this.modalAction(m.dataset.m);
    });
    const fi = document.getElementById('fileInput');
    fi.addEventListener('change', () => {
      const f = fi.files && fi.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { if (this.openJson(String(rd.result))) this.closeModal(); fi.value = ''; };
      rd.onerror = () => this.toast('Файл не прочитался.', 'warn');
      rd.readAsText(f);
    });

    document.addEventListener('keydown', e => this.onKey(e));
    document.getElementById('btnVR').addEventListener('click', () => { if (this.v3) this.v3.enterVR(); });
    document.getElementById('btnFull').addEventListener('click', () => {
      const v = document.getElementById('view3d');
      try { if (document.fullscreenElement) document.exitFullscreen(); else if (v.requestFullscreen) v.requestFullscreen().catch(() => this.toast('Полноэкранный режим недоступен в этом окне.', 'warn')); }
      catch (e) { this.toast('Полноэкранный режим недоступен в этом окне.', 'warn'); }
    });
    document.getElementById('btnCam').addEventListener('click', () => { if (this.v3) this.v3.toggleTopView(); });
  },
  sideAction(act, b) {
    const tr = this.tr;
    switch (act) {
      case 'welcome-close': this.welcomeSeen = true; store.set('ts.welcome', '1'); this.renderSide(); break;
      case 'help': this.showHelp(); break;
      case 'tool-check': this.toggleTool(); break;
      case 'ack': if (!tr.ack()) this.toast('Сигналов нет.'); break;
      case 'reset': if (!tr.resetToNormal()) this.toast('Сначала завершите задание.', 'warn'); break;
      case 'task-start': this.startTask(this.scheme.tasks[this.taskIdx]); break;
      case 'task-hint': if (!tr.hint()) this.toast('Все эталонные шаги выполнены — проверьте положение аппаратов.'); break;
      case 'task-stop': tr.stopTask(); break;
      case 'report': this.showReport(tr.run); break;
      case 'task-again': if (tr.run) this.startTask(tr.run.task); break;
      case 'task-exit': tr.exitTask(); this.renderSide(); break;
      case 'rec-start': tr.startRec(); break;
      case 'rec-save': this.showSaveTask(); break;
      case 'rec-cancel': tr.cancelRec(); break;
      case 'validate': this.validate(); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'normal-on': this.setNormal(true); break;
      case 'normal-off': this.setNormal(false); break;
      case 'rotate': this.rotateSel(); break;
      case 'dup': this.duplicateSel(); break;
      case 'del': this.deleteSel(); break;
      case 'bend': { const s = this.view.sel; const w = s && this.scheme.wires.find(x => x.id === s.id); if (w) { this.history(); w.vf = !w.vf; this.commit(); } break; }
      case 'task-del': { this.history(); this.scheme.tasks = this.scheme.tasks.filter(t => t.id !== b.dataset.id); this.commit(); break; }
    }
  },
  modalAction(m) {
    if (m === 'close') { this.closeModal(); return; }
    if (m === 'copy') { this.copyText(this.fileJson, 'Текст схемы скопирован.'); return; }
    if (m === 'download') { this.saveFile((this.scheme.title || 'schema').replace(/[\\/:*?"<>|«»]+/g, '').trim() + '.json', this.fileJson, 'application/json'); return; }
    if (m === 'open-file') { document.getElementById('fileInput').click(); return; }
    if (m === 'open-paste') { const t = document.getElementById('pasteJson').value; if (t.trim() && this.openJson(t)) this.closeModal(); return; }
    if (m === 'new') {
      this.setScheme(emptyScheme('Новая схема'), 'my');
      this.autosave(); this.fillSchemeSelect(); this.closeModal();
      this.setMode('edit');
      this.toast('Пустая схема. Возьмите элементы из палитры слева.');
    }
  },
  // Сохранение файла: в окне Claude — через разрешённое сохранение, на своём сайте — обычной загрузкой
  async saveFile(filename, text, type) {
    if (this.dl) {
      try { await this.dl.save({ filename, data: text }); this.toast('Файл сохранён.', 'ok'); }
      catch (e) {
        const c = e && e.code;
        if (c === 'declined') this.toast('Сохранение отменено.');
        else if (c === 'rate_limited') this.toast('Окно сохранения уже открыто — подождите.', 'warn');
        else this.toast('Скачивание здесь недоступно — нажмите «Скопировать текст».', 'warn');
      }
      return;
    }
    try {
      const blob = new Blob([text], { type: type || 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      this.toast('Файл сохраняется. Если ничего не скачалось — нажмите «Скопировать текст».');
    } catch (e) { this.toast('Скачивание недоступно — нажмите «Скопировать текст».', 'warn'); }
  },
  onKey(e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (!document.getElementById('modal').hidden) { if (e.key === 'Escape') this.closeModal(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (this.mode === 'edit') {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSel(); }
      else if (e.code === 'KeyR' && !mod) this.rotateSel();
      else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (mod && e.code === 'KeyD') { e.preventDefault(); this.duplicateSel(); }
      else if (e.key === 'Escape') { this.view.setPlacing(null); this.paletteState(null); this.view.select(null); }
      return;
    }
    if (mod) return;
    if (e.code === 'KeyV') this.toggleTool();
    else if (e.code === 'KeyK') { if (!this.tr.ack()) this.toast('Сигналов нет.'); }
    else if (e.key === 'Escape' && this.tool) this.toggleTool();
  },
  toggleTheme() {
    const root = document.documentElement;
    const cur = root.dataset.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('ts.theme', next);
  },
  tick() {
    if (this.tr.run && !this.tr.run.done) {
      this.renderTaskStats();
      if (this.v3 && this.v3.ready && this.mode === '3d') this.v3.drawBoard();
    }
  },
}, Panels);

export { app };
