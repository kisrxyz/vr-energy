import { APP_VER, TYPES, ptKey, clamp, esc, portPoints, bbox, isSwitchable, isPzId, emptyScheme, makeEl, makeWire, FIELD_OPS, normalizeScheme } from './core/elements.js';
import { GLOSSARY } from './core/glossary.js';
import { SAMPLES } from './core/samples.js';
import { buildTopo, makeSim, compute, Trainer } from './core/engine.js';
import { Permit } from './core/permit.js';
import { whyOf } from './core/explain.js';
import * as Ed from './core/edit.js';
import { elSubtitle, nearestOnWire, Scheme2D } from './view2d/scheme2d.js';
import { Panels, countText } from './ui/panels.js';
import { store } from './ui/store.js';
import { makeLibrary } from './ui/myschemes.js';
import { Diag } from './ui/diag.js';
import { Sound } from './ui/sound.js';
import { View3D } from './view3d/view3d.js';
import { Demo } from './ui/demo.js';
import { Exam } from './ui/exam.js';

/* ===== Приложение: режимы, правка схемы, связка движка с 2D, 3D и панелями =====
   source — откуда схема: ключ готовой схемы (SAMPLES) или 'my:<id>' — запись в «Моих схемах» (src/ui/myschemes.js).
   Готовые схемы не меняются: первая правка создаёт копию в «Моих схемах». */
const app = Object.assign({
  scheme: null, mode: 'train', tool: null, source: 'ps110', schemeVersion: 0, taskIdx: 0,
  tr: new Trainer(), view: null, v3: null, undoStack: [], redoStack: [], welcomeSeen: false, welcome3d: false, modalActions: [],
  // «Подсказки шагов» на площадках в 3D: строка «Следующий шаг», маяк, «Перейти к аппарату» (G). В обучении по умолчанию включены
  stepGuide: true,

  init() {
    this.dl = null;
    try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(d => { this.dl = d; }, () => {}); } catch (e) { this.dl = null; }
    this.welcomeSeen = store.get('ts.welcome') === '1';
    this.welcome3d = store.get('ts.welcome3d') === '1';
    // раскрытые разделы боковой панели в 3D (инструменты, журнал…): по умолчанию свёрнуты
    try { this.folds = new Set(JSON.parse(store.get('ts.folds') || '[]')); } catch (e) { this.folds = new Set(); }
    document.getElementById('side').addEventListener('toggle', e => {
      const d = e.target;
      if (!d.dataset || !d.dataset.fold) return;
      if (d.open) this.folds.add(d.dataset.fold); else this.folds.delete(d.dataset.fold);
      store.set('ts.folds', JSON.stringify([...this.folds]));
    }, true);
    this.stepGuide = store.get('ts.stepGuide') !== '0';
    const th = store.get('ts.theme');
    if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
    this.lib = makeLibrary(store);
    const moved = this.lib.migrate();
    // VR-полигон: СИЗ, плакаты, замок, порядок мероприятий — дополнение движка (до остальных слушателей)
    this.permit = this.tr.use(new Permit());
    this.view = new Scheme2D(this, document.getElementById('sch'));
    this.buildPalette();
    this.bindUI();
    this.tr.on((type, d) => this.onTrainer(type, d));
    let hash = '';
    try { hash = (location.hash || '').slice(1); } catch (e) { hash = ''; }
    this.setScheme(SAMPLES[0].make(), 'ps110');
    this.setMode(['edit', 'train', '3d'].includes(hash) ? hash : 'train', true);
    if (moved) this.toast('«Моя схема» перенесена в список «Мои схемы» (кнопка «Схемы»).', 'ok');
    // экзамен с протоколом (src/ui/exam.js): прерванный перезагрузкой — в журнал «прерван»
    this.exam = new Exam(this);
    this.exam.init();
    // «Показ» для заказчика: кнопка вверху, ?demo=1 и ?demo=auto (src/ui/demo.js)
    this.demo = new Demo(this);
    this.demo.init();
    setInterval(() => this.tick(), 1000);
  },
  userGesture() { Sound.init(); },

  // ---------- схемы ----------
  isMine() { return this.source.startsWith('my:'); },
  myId() { return this.isMine() ? this.source.slice(3) : null; },
  fillSchemeSelect() {
    const sel = document.getElementById('schemeSel');
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`, my = this.lib.list();
    sel.innerHTML = `<optgroup label="Готовые схемы">${SAMPLES.filter(s => !s.poly).map(s => opt(s.key, s.title)).join('')}</optgroup>` +
      `<optgroup label="VR-полигон">${SAMPLES.filter(s => s.poly).map(s => opt(s.key, s.title)).join('')}</optgroup>` +
      (my.length ? `<optgroup label="Мои схемы">${my.map(x => opt('my:' + x.id, x.title)).join('')}</optgroup>` : '');
    sel.value = this.source;
  },
  examLocked() {
    if (!this.exam || !this.exam.active()) return false;
    this.toast('Во время экзамена схема и редактор недоступны. Выйти — «Прервать экзамен».', 'warn');
    return true;
  },
  chooseScheme(v) {
    if (this.examLocked()) { this.fillSchemeSelect(); return; }
    if (v.startsWith('my:')) {
      const s = this.lib.load(v.slice(3));
      if (s) this.setScheme(s, v);
      else { this.toast('Схема не открылась: запись в браузере повреждена.', 'warn'); this.fillSchemeSelect(); }
      return;
    }
    const smp = SAMPLES.find(x => x.key === v);
    if (!smp) return;
    this.setScheme(smp.make(), v);
    // полигон сделан для 3D и VR: из тренажёра сразу туда
    if (smp.poly && this.mode === 'train') this.setMode('3d');
  },
  setScheme(s, source) {
    this.scheme = s; this.source = source; this.schemeVersion++;
    this.undoStack = []; this.redoStack = []; this.taskIdx = 0;
    this.view.sel = null; this.view.setPlacing(null); this.paletteState(null);
    this.tr.load(s);
    this.fillSchemeSelect();
    this.polyTools();
    this.view.render(); this.renderSide(); this.renderLegend(); this.renderStatus();
    requestAnimationFrame(() => this.view.fit());
    if (this.mode === '3d') this.show3D();
  },
  // В 3D-полигоне указатель и ПЗ — предметы в руках: 2D-инструмент снимаем
  polyTools() {
    if (this.mode !== '3d' || !this.scheme.room || !this.tool) return;
    this.tool = null;
    document.getElementById('app').dataset.tool = '';
  },
  autosave() {
    if (this.isMine() && !this.lib.save(this.myId(), this.scheme)) this.storeWarn();
  },
  // force — ответ на действие человека (переименовать, дублировать): сразу; автосохранение — не чаще раза в 30 с
  storeWarn(force) {
    const now = Date.now();
    if (!force && now - (this._storeWarnT || 0) < 30000) return;
    this._storeWarnT = now;
    this.toast('Не удалось сохранить в браузере: хранилище переполнено или запрещено. Скачайте схему в файл: «Схемы» → «Скачать файл».', 'warn');
  },
  // Первая правка готовой схемы: копия в «Моих схемах», дальше правки идут в неё
  markMine() {
    // в показе правки живут только в памяти: «Мои схемы» показ не трогает
    if (this.isMine() || this.demoOn) return;
    const base = this.scheme.title;
    this.scheme.title = `${base} (копия)`;
    const id = this.lib.add(this.scheme);
    if (!id) { this.scheme.title = base; this.storeWarn(); return; }
    // «Отменить» не должно возвращать копии название готовой схемы
    this.undoStack = this.undoStack.map(j => { try { const o = JSON.parse(j); o.title = this.scheme.title; return JSON.stringify(o); } catch (e) { return j; } });
    this.source = 'my:' + id;
    this.fillSchemeSelect();
    this.toast(`Готовая схема не меняется: правки сохраняются в копию «${this.scheme.title}» (кнопка «Схемы»).`);
  },
  openJson(text) {
    let s;
    try { s = normalizeScheme(JSON.parse(text)); }
    catch (e) { this.toast('Не получилось открыть: ' + (e.message || 'файл повреждён') + '.', 'warn'); return false; }
    const id = this.lib.add(s);
    if (!id) this.storeWarn();
    this.setScheme(s, id ? 'my:' + id : 'file');
    this.toast(`Открыта схема «${s.title}»${id ? ' — она в «Моих схемах»' : ''}.`, 'ok');
    return true;
  },
  newScheme() {
    const s = emptyScheme('Новая схема'), id = this.lib.add(s);
    if (!id) { this.storeWarn(); return; }
    this.setScheme(s, 'my:' + id);
    this.closeModal();
    this.setMode('edit');
    this.toast('Пустая схема в «Моих схемах». Возьмите элементы из палитры слева.');
  },

  // ---------- режимы ----------
  setMode(m, force) {
    if (m === this.mode && !force) return;
    if (m === 'edit' && this.examLocked()) return;
    const prev = this.mode;
    if (prev === 'edit' && m !== 'edit') this.tr.load(this.scheme);
    if (m === 'edit') {
      if (this.tr.run && !this.tr.run.done) this.toast('Задание прервано: открыт редактор.', 'warn');
      if (this.tr.rec) this.tr.cancelRec();
      this.tr.run = null; this.tool = null;
    } else { this.view.setPlacing(null); this.paletteState(null); }
    this.mode = m;
    this.polyTools();
    const root = document.getElementById('app');
    root.dataset.mode = m; root.dataset.tool = this.tool || '';
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    document.getElementById('sch').style.display = m === '3d' ? 'none' : '';
    document.getElementById('view3d').hidden = m !== '3d';
    document.getElementById('zoomTools').hidden = m === '3d';
    // «Выделение» (рамка пальцем) — только в редакторе
    document.getElementById('zSel').hidden = m !== 'edit';
    if (m !== 'edit') this.view.setBoxMode(false);
    if (m === '3d') this.show3D(); else if (this.v3) this.v3.hide();
    this.syncMax3D();
    this.view.render(); this.renderSide(); this.renderLegend(); this.renderStatus();
    try { history.replaceState(null, '', '#' + m); } catch (e) { /* адрес не меняем */ }
  },
  // Телефон (узкий экран): 3D-вид — на весь экран по умолчанию (на 390×844 иначе остаётся 350 px), «Панель» — вернуть задание и журнал.
  // В показе и экзамене — как раньше: панель ведущего и «задание N из M» нужны на экране
  phone() { return !!(window.matchMedia && matchMedia('(max-width: 760px)').matches); },
  setMax3D(on, byUser) {
    if (byUser) this.max3dOff = !on;
    this.max3d = !!on;
    const root = document.getElementById('app');
    if (on) root.dataset.max = '1'; else delete root.dataset.max;
    const b = document.getElementById('btnFull');
    if (b) b.textContent = this.phone() ? (on ? 'Панель' : 'Во весь экран') : 'На весь экран';
    if (this.v3 && this.v3.ready) this.v3.resize();
  },
  syncMax3D() {
    const want = this.mode === '3d' && this.phone() && !this.max3dOff && !this.demoOn && !(this.exam && this.exam.active());
    if (want !== !!this.max3d || (this.mode !== '3d' && this.max3d)) this.setMax3D(want && this.mode === '3d');
    else this.setMax3D(this.max3d);
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
  // Инструменты тренажёра: check — указатель напряжения, pz — переносное заземление
  toggleTool(tool = 'check') {
    this.tool = this.tool === tool ? null : tool;
    document.getElementById('app').dataset.tool = this.tool || '';
    if (this.tool === 'check') this.toast('Указатель напряжения: нажмите на аппарат, шину или провод.');
    if (this.tool === 'pz') this.toast('Переносное заземление: нажмите на провод или шину — наложить, на значок ПЗ — снять.');
    this.closeActMenu();
    this.renderSide(); this.view.render();
    if (this.v3) this.v3.drawBoard();
  },

  // ---------- действия на схеме ----------
  pick2D(c) {
    if (this.tool === 'pz') {
      if (c.w) { const w = this.scheme.wires.find(v => v.id === c.w); this.tr.pzToggle(c.w, w && c.p ? nearestOnWire(w, c.p) : null); return; }
      if (c.el) this.pzAt(c.el, c.p);
      return;
    }
    if (c.el) { this.pickEl(c.el, this.tool === 'check', c); return; }
    if (c.w && this.tool === 'check') this.tr.check(c.w);
  },
  // ПЗ инструментом: на шину — наложить, на значок ПЗ — снять, на аппарат — подсказать
  pzAt(id, p) {
    if (isPzId(id)) { this.tr.operate(id); return; }
    const el = this.scheme.els.find(e => e.id === id);
    if (el && el.t === 'bus') {
      let pt = null;
      if (p) { const b = bbox(el); pt = el.r % 2 ? [el.x, clamp(Math.round(p[1]), Math.ceil(b[1]), Math.floor(b[3]))] : [clamp(Math.round(p[0]), Math.ceil(b[0]), Math.floor(b[2])), el.y]; }
      this.tr.pzToggle(id, pt);
    } else if (el && el.t === 'pz') this.tr.operate(id);
    else this.toast('Переносное заземление накладывается на провод или шину.', 'warn');
  },
  pick3D(id, alt, at) {
    if (this.tool === 'pz' && !alt) { this.pzAt(id, null); return; }
    this.pickEl(id, alt || this.tool === 'check', at);
  },
  pickWire3D(wid, alt) {
    if (this.tool === 'pz' && !alt) { this.tr.pzToggle(wid); return; }
    if (alt || this.tool === 'check') this.tr.check(wid);
  },
  pickEl(id, check, at) {
    const el = this.scheme.els.find(e => e.id === id) || this.tr.elOf(id);
    if (!el) return;
    if (check) { this.tr.check(id); return; }
    if (isSwitchable(el)) {
      const acts = this.tr.actions(id);
      if (acts.length > 1) { if (at && at.menu3d) at.menu3d(acts); else this.showActMenu(id, acts, at); return; }
      this.tr.operate(id);
    } else if (TYPES[el.t].cls === 'source') this.tr.toggleSource(id);
    else {
      // справка о неизменяемом аппарате: тостом; в 3D — и у прицела (пешком), в шлеме — табличкой у аппарата и на щите
      const sub = elSubtitle(el), g = GLOSSARY[el.t], text = `${el.name}${sub ? ' (' + sub + ')' : ''}: ${g ? g.what : TYPES[el.t].title} Не переключается.`;
      this.toast(text);
      if (this.mode === '3d' && this.v3 && this.v3.ready) this.v3.infoFx(text, id);
    }
  },
  // Меню аппарата с несколькими действиями (выкатная тележка)
  showActMenu(id, acts, at) {
    this.closeActMenu();
    const stage = document.getElementById('stage'), r = stage.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'actmenu'; m.id = 'actmenu'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="actmenu-h">${esc(this.tr.nm(id))}</div>` + acts.map((a, i) => `<button class="btn" role="menuitem" data-i="${i}">${esc(a.label)}</button>`).join('');
    stage.appendChild(m);
    const x = at && at.cx != null ? at.cx - r.left : r.width / 2, y = at && at.cy != null ? at.cy - r.top : r.height / 2;
    m.style.left = clamp(x + 8, 8, Math.max(8, r.width - m.offsetWidth - 8)) + 'px';
    m.style.top = clamp(y + 8, 8, Math.max(8, r.height - m.offsetHeight - 8)) + 'px';
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const a = acts[+b.dataset.i];
      this.closeActMenu();
      this.tr.operate(id, a.pos ? { pos: a.pos } : undefined);
    });
    const f = m.querySelector('button');
    if (f) f.focus();
    this._menuOff = e => { if (!m.contains(e.target)) this.closeActMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', this._menuOff, true), 0);
  },
  closeActMenu() {
    const m = document.getElementById('actmenu');
    if (m) m.remove();
    if (this._menuOff) { document.removeEventListener('pointerdown', this._menuOff, true); this._menuOff = null; }
  },
  startTask(task) {
    if (!task) return;
    if (this.tr.rec) { this.toast('Сначала сохраните или отмените запись.', 'warn'); return; }
    this.tool = null;
    document.getElementById('app').dataset.tool = '';
    // задание полигона выполняют руками в 3D: СИЗ, указатель и плакаты есть только там
    if (this.scheme.room && this.mode !== '3d') {
      this.setMode('3d');
      this.toast('Задание полигона выполняют в 3D: средства защиты, указатель и плакаты — на стенде у входа.');
    }
    this.tr.startTask(task);
    this.renderSide();
  },
  // «Почему опасно» в тосте — в 3D, кроме «Пешком» (там оно у прицела, view3d.errFx)
  whyToast(e) { return this.mode === '3d' && !(this.v3 && this.v3.ready && this.v3.fpsOn()) ? whyOf(e) : null; },
  onTrainer(type, d) {
    if (type === 'state') {
      this.closeActMenu();
      if (this.mode !== 'edit') this.view.render();
      if (this.v3 && this.v3.ready) this.v3.update();
      // «Нормальный режим», новое задание, «Ещё раз»: предметы полигона — с рук и с пола на стенд
      if (d.reset && this.v3 && this.v3.ready) this.v3.onField({ reset: true });
      // мероприятия полигона: «отключить» и «выкатить» выполняют аппаратом — список в панели обновляется и после операции
      if (this.permit.active && this.tr.run && !this.tr.run.done) this.renderMeasures();
      this.renderGuide();
      this.updateAlarmsBtn();
      return;
    }
    if (type === 'log') {
      this.renderLog();
      // перерыв питания приходит записью журнала (не событием операции): объяснение — у прицела
      if (d && d.level === 'err' && /^Перерыв питания/.test(d.text) && this.mode === '3d' && this.v3 && this.v3.ready) this.v3.errFx({ kind: 'supply', text: d.text });
      return;
    }
    if (type === 'op') {
      if (d.blocked) { this.toast(d.text, 'warn'); Sound.play('blocked'); if (this.v3) this.v3.banner(d.text, 'warn'); }
      else if (d.info) this.toast(d.text);
      else if (d.viol && (d.viol.kind === 'accident' || d.viol.kind === 'kz')) {
        this.toast(d.viol.text, 'err', this.whyToast(d.viol)); this.flash(); Sound.play('arc');
        this.view.burst(d.id, 'var(--fault)');
        if (d.tripped && d.tripped.length) setTimeout(() => this.toast('Сработала защита: ' + d.tripped.map(t => this.tr.tripText(t)).join('; ') + '.', 'warn'), 700);
        if (this.v3) { this.v3.banner(d.viol.text, 'err', whyOf(d.viol)); this.v3.errFx(d.viol); }
      } else if (d.viol) { this.toast(d.viol.text, 'warn', this.whyToast(d.viol)); Sound.play('disc'); if (this.v3) { this.v3.banner(d.viol.text, 'warn', whyOf(d.viol)); this.v3.errFx(d.viol); } }
      else if (d.ok) { const el = this.tr.elOf(d.id); Sound.play(el && TYPES[el.t].sw === 'breaker' && !d.pos ? 'breaker' : 'disc'); }
      this.renderTaskStats(); this.renderRec();
      return;
    }
    if (type === 'fx') { if (this.v3 && this.v3.ready) this.v3.fx(d); return; }
    if (type === 'check') {
      this.toast(d.text, d.live ? 'warn' : 'ok');
      this.view.checkMark(d.target, d.live);
      // указатель в полигоне звучит и светит, только если напряжение есть; без напряжения — лёгкий щелчок касания
      Sound.play(d.live ? 'checklive' : this.mode === '3d' && this.scheme.room ? 'touch' : 'check');
      if (this.v3 && this.v3.ready) this.v3.checkFx(d);
      this.renderTaskStats(); this.renderRec();
      return;
    }
    if (type === 'task') {
      this.renderTask(); this.renderRec();
      // площадка в 3D: щит с заданием — к первому аппарату, начало пешком — у щита
      if (d.start && this.v3 && this.v3.ready && this.mode === '3d') this.v3.onTaskStart();
      if (d.done && d.run) {
        Sound.play(d.run.grade.tone === 'good' ? 'ok' : 'fail');
        // в экзамене отчёта с эталоном нет: результат — в протокол
        if (this.exam && this.exam.active()) { const r = d.run; setTimeout(() => this.exam.onDone(r), 500); }
        else setTimeout(() => this.showReport(d.run), 600);
      }
      if (this.v3 && this.v3.ready) this.v3.drawBoard();
      return;
    }
    if (type === 'hint') { this.showHint(d.text); if (this.v3) this.v3.banner(d.text, 'info'); return; }
    if (type === 'rec') { this.renderRec(); this.renderTask(); if (d.saved) { this.markMine(); this.autosave(); } return; }
    // VR-полигон: предметы, плакаты, мероприятия; warn — нарушение (без СИЗ, не по порядку, не на месте)
    if (type === 'field') {
      if (d.warn) { this.toast(d.warn, 'warn', this.whyToast({ text: d.warn, why: d.why })); Sound.play('blocked'); if (this.v3) { this.v3.banner(d.warn, 'warn', d.why); this.v3.errFx({ text: d.warn, why: d.why }); } }
      // самопроверка указателя: огонёк и звук, как при напряжении
      if (d.test) { this.toast('Указатель исправен: огонёк горит, звук есть.', 'ok'); Sound.play('checklive'); }
      this.renderMeasures(); this.renderTaskStats();
      if (this.v3 && this.v3.ready) this.v3.onField(d);
    }
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
  // После удаления элемента или провода: убрать из заданий ссылки на него (ПЗ ссылается на провод или шину)
  cleanTasks() {
    const ids = new Set(this.scheme.els.map(e => e.id)), wids = new Set(this.scheme.wires.map(w => w.id));
    const ok = k => ids.has(k) || (isPzId(k) && (ids.has(k.slice(3)) || wids.has(k.slice(3))));
    const pick = (o, f) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => f(k)));
    // шаги и мероприятия VR-полигона без аппаратов схемы (СИЗ, плакаты, замок) остаются
    const okMeasure = m => (m.id == null || ids.has(m.id)) && (m.wire == null || wids.has(m.wire));
    this.scheme.tasks = this.scheme.tasks.map(t => Object.assign({
      ...t,
      init: pick(t.init, ok), target: pick(t.target, ok),
      initPos: pick(t.initPos, k => ids.has(k)), targetPos: pick(t.targetPos, k => ids.has(k)),
      steps: t.steps.filter(x => FIELD_OPS.includes(x.op) || ok(x.id) || (x.op === 'check' && wids.has(x.id))), keep: t.keep.filter(k => ids.has(k)),
    }, t.measures ? { measures: t.measures.filter(okMeasure) } : {})).filter(t => Object.keys(t.target).length || Object.keys(t.targetPos).length);
  },
  // Каждая операция с выделенным — один шаг «Отменить»; после удаления — один cleanTasks
  deleteSel() {
    const sel = this.view.sel;
    if (!sel) return;
    this.history();
    Ed.deleteGroup(this.scheme, this.view.selSets());
    this.cleanTasks();
    this.view.sel = null;
    this.commit();
  },
  rotateSel() {
    if (this.view.sel && this.view.sel.type === 'group') { this.rotateGroup(); return; }
    const el = this.selEl();
    if (!el) return;
    this.history();
    const old = portPoints(el).map(ptKey);
    el.r = (el.r + 1) % 4;
    const now = portPoints(el);
    for (const w of this.scheme.wires) for (const end of ['a', 'b']) { const i = old.indexOf(ptKey(w[end])); if (i >= 0) w[end] = now[i].slice(); }
    this.commit();
  },
  // Группа поворачивается вокруг своего центра; пока после поворота ничего не менялось, центр тот же — 4 поворота вернут на место
  rotateGroup() {
    const sel = this.view.selSets(), sig = JSON.stringify(sel), r = this._rot;
    const pivot = r && r.sig === sig && r.ver === this.schemeVersion ? r.pivot : null;
    this.history();
    const used = Ed.rotateGroup(this.scheme, sel, pivot);
    this.commit();
    this._rot = { sig, pivot: used, ver: this.schemeVersion };
  },
  // Копия рядом (+3 клетки): элемент или группа со своими проводами, новые имена
  duplicateSel() {
    if (!this.view.sel || this.view.sel.type === 'wire') return;
    this.history();
    const r = Ed.duplicateGroup(this.scheme, this.view.selSets(), 3);
    this.commit();
    if (r) this.view.setSel(r.els, r.wires);
  },
  selectAll() { this.view.setSel(this.scheme.els.map(e => e.id), this.scheme.wires.map(w => w.id)); },
  // Буфер: в памяти и в хранилище браузера — вставить можно и в другую схему, и после перезагрузки
  copySel() {
    const sel = this.view.selSets();
    if (!sel.els.length && !sel.wires.length) return false;
    const clip = Ed.copyGroup(this.scheme, sel);
    if (!clip) return false;
    this.clip = clip;
    if (!this.demoOn) store.set('ts.clip', JSON.stringify(clip));
    this.toast(`Скопировано: ${countText(clip.els.length, clip.wires.length)}. Ctrl+V — вставить (и в другую схему).`);
    return true;
  },
  // Вставка под курсор (центр группы — в клетку под курсором); курсор не над схемой — в середину видимого
  paste() {
    let clip = this.clip;
    if (!clip) { try { clip = JSON.parse(store.get('ts.clip') || 'null'); } catch (e) { clip = null; } }
    if (!clip || clip.kind !== 'ts-group') { this.toast('Буфер пуст: выделите элементы и нажмите Ctrl+C.'); return; }
    const v = this.view, r = v.svg.getBoundingClientRect();
    const at = v.cursorW || v.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    this.history();
    const res = Ed.pasteGroup(this.scheme, clip, Math.round(at[0] - clip.w / 2), Math.round(at[1] - clip.h / 2));
    this.commit();
    if (res) { v.setSel(res.els, res.wires); this.toast(`Вставлено: ${countText(res.els.length, res.wires.length)}.`); }
  },
  setNormal(on) { const el = this.selEl(); if (!el || !isSwitchable(el)) return; this.history(); el.on = on; this.commit(); },
  setNormalPos(pos) { const el = this.selEl(); if (!el || !TYPES[el.t].cart) return; this.history(); el.pos = pos; this.commit(); },
  setProp(path, raw) {
    const s = this.scheme;
    if (path === 'title') { this.history(); s.title = String(raw).trim() || 'Схема'; this.commit(); this.fillSchemeSelect(); return; }
    const el = this.selEl();
    if (!el) return;
    if (path === 'name') { const v = String(raw).trim(); if (!v) { this.renderSide(); return; } this.history(); el.name = v; this.commit(); return; }
    if (path.startsWith('p.')) {
      const key = path.slice(2);
      const meta = (TYPES[el.t].pmeta || []).find(m => m[0] === key);
      if (meta && meta[2] === 'bool') { this.history(); el.p[key] = raw ? 1 : 0; this.commit(); return; }
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
      if (TYPES[el.t].cls === 'transformer' && new Set(t).size < t.length) issues.push(['bad', `${el.name}: обмотки замкнуты проводом.`]);
      if ((TYPES[el.t].cls === 'switch' || TYPES[el.t].cls === 'link') && t[0] === t[1]) issues.push(['bad', `${el.name} закорочен проводом.`]);
    }
    const st = compute(s, topo, makeSim(s));
    if ([...st.V.keys()].some(n => st.G.has(n))) issues.push(['bad', 'В нормальном положении напряжение встречается с заземлением — КЗ.']);
    const dead = s.els.filter(e => TYPES[e.t].consumer && !st.loads.has(e.id)).map(e => e.name);
    if (dead.length) issues.push(['', `В нормальном положении без питания: ${dead.join(', ')}.`]);
    const box = document.getElementById('issues');
    if (box) box.innerHTML = issues.length ? '<ul class="issues">' + issues.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join('') + '</ul>' : '<p style="color:var(--ok)">Ошибок не найдено.</p>';
    return issues;
  },

  // ---------- интерфейс ----------
  bindUI() {
    for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => this.setMode(b.dataset.mode));
    document.getElementById('schemeSel').addEventListener('change', e => this.chooseScheme(e.target.value));
    document.getElementById('btnFile').addEventListener('click', () => this.showSchemes());
    document.getElementById('btnHelp').addEventListener('click', () => this.showHelp());
    document.getElementById('btnTheme').addEventListener('click', () => this.toggleTheme());
    const snd = document.getElementById('btnSound');
    snd.addEventListener('click', () => { Sound.init(); Sound.on = !Sound.on; snd.setAttribute('aria-pressed', String(Sound.on)); this.toast(Sound.on ? 'Звук включён.' : 'Звук выключен.'); });
    document.getElementById('zIn').addEventListener('click', () => this.view.zoomCenter(1.25));
    document.getElementById('zOut').addEventListener('click', () => this.view.zoomCenter(0.8));
    document.getElementById('zFit').addEventListener('click', () => this.view.fit());
    document.getElementById('zSel').addEventListener('click', () => this.view.setBoxMode(!this.view.boxMode));
    document.addEventListener('pointerdown', () => this.userGesture(), true);

    const side = document.getElementById('side');
    side.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      this.sideAction(b.dataset.act, b);
    });
    side.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.prop) this.setProp(t.dataset.prop, t.type === 'checkbox' ? t.checked : t.value);
      else if (t.dataset.opt === 'stepGuide') this.setStepGuide(t.checked);
      else if (t.dataset.opt === 'guide') {
        // подсказка «следующее мероприятие» на щите и в панели (VR-полигон)
        this.permit.guide = t.checked;
        this.tr.emit('field', {});
        this.toast(`Подсказки мероприятий: ${t.checked ? 'включены' : 'выключены'}.`);
      } else if (t.dataset.opt) {
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
      if (m) this.modalAction(m.dataset.m, m);
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
      // телефон: 3D на весь экран и обратно (панель с заданием) — без Fullscreen API (в Safari его нет); компьютер — полноэкранный режим
      if (this.phone()) { this.setMax3D(!this.max3d, true); return; }
      const v = document.getElementById('view3d');
      try { if (document.fullscreenElement) document.exitFullscreen(); else if (v.requestFullscreen) v.requestFullscreen().catch(() => this.toast('Полноэкранный режим недоступен в этом окне.', 'warn')); }
      catch (e) { this.toast('Полноэкранный режим недоступен в этом окне.', 'warn'); }
    });
    document.getElementById('btnCam').addEventListener('click', () => { if (this.v3) this.v3.toggleTopView(); });
    document.getElementById('btnWalk').addEventListener('click', () => { if (this.v3) this.v3.toggleWalk(); });
  },
  sideAction(act, b) {
    const tr = this.tr;
    switch (act) {
      case 'welcome-close':
        if (this.mode === '3d') { this.welcome3d = true; store.set('ts.welcome3d', '1'); } else { this.welcomeSeen = true; store.set('ts.welcome', '1'); }
        this.renderSide(); break;
      case 'goto-next': if (this.v3) this.v3.goNext(); break;
      case 'goto': if (this.v3 && b.dataset.id) this.v3.goTo(b.dataset.id); break;
      case 'help': this.showHelp(); break;
      case 'go3d': this.setMode('3d'); break;
      case 'tool-check': this.toggleTool('check'); break;
      case 'tool-pz': this.toggleTool('pz'); break;
      case 'ack': if (!tr.ack()) this.toast('Сигналов нет.'); break;
      case 'reset': if (!tr.resetToNormal()) this.toast('Сначала завершите задание.', 'warn'); break;
      case 'task-start': this.startTask(this.scheme.tasks[this.taskIdx]); break;
      case 'task-hint':
        if (this.exam && this.exam.active()) { this.toast('В экзамене подсказок нет.', 'warn'); break; }
        if (!tr.hint()) this.toast('Все эталонные шаги выполнены — проверьте положение аппаратов.'); break;
      case 'exam': case 'exam-next': case 'exam-abort': case 'exam-log': this.exam.action(act); break;
      case 'task-stop': tr.stopTask(); break;
      case 'report': this.showReport(tr.run); break;
      case 'task-again': if (tr.run && !(this.exam && this.exam.active())) this.startTask(tr.run.task); break;
      case 'task-exit': tr.exitTask(); this.renderSide(); break;
      case 'rec-start': tr.startRec(); break;
      case 'rec-save': this.showSaveTask(); break;
      case 'rec-cancel': tr.cancelRec(); break;
      case 'validate': this.validate(); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'normal-on': this.setNormal(true); break;
      case 'normal-off': this.setNormal(false); break;
      case 'normal-pos': this.setNormalPos(b.dataset.pos); break;
      case 'rotate': this.rotateSel(); break;
      case 'dup': this.duplicateSel(); break;
      case 'del': this.deleteSel(); break;
      case 'bend': { const s = this.view.sel; const w = s && this.scheme.wires.find(x => x.id === s.id); if (w) { this.history(); w.vf = !w.vf; this.commit(); } break; }
      case 'task-del': { this.history(); this.scheme.tasks = this.scheme.tasks.filter(t => t.id !== b.dataset.id); this.commit(); break; }
    }
  },
  modalAction(m, b) {
    if (m === 'close') { this.closeModal(); return; }
    if (m.startsWith('ex-')) { this.exam.modal(m, b); return; }
    // отчёт VR-теста и журнал ошибок (справка); очистка — только со второго нажатия
    if (m === 'vr-copy') { this.copyText(Diag.report(APP_VER), 'Отчёт VR-теста скопирован — вставьте его в сообщение.'); return; }
    if (m === 'vr-dl') { this.saveFile(`Отчёт VR-теста ${new Date().toISOString().slice(0, 10)}.txt`, Diag.report(APP_VER), 'text/plain'); return; }
    if (m === 'err-copy') { this.copyText(Diag.errorsText(), 'Журнал ошибок скопирован.'); return; }
    if (m === 'vr-clear' || m === 'err-clear') {
      if (b && !b.dataset.sure) {
        const t = b.textContent;
        b.dataset.sure = '1'; b.textContent = 'Точно? Нажмите ещё раз';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = t; } }, 4000);
        return;
      }
      if (m === 'vr-clear') Diag.clearTest(); else Diag.clearErrors();
      this.toast(m === 'vr-clear' ? 'Запись VR-теста очищена.' : 'Журнал ошибок очищен.');
      this.showHelp();
      return;
    }
    if (m === 'copy') { this.copyText(this.fileJson, 'Текст схемы скопирован.'); return; }
    if (m === 'download') { this.saveFile((this.scheme.title || 'schema').replace(/[\\/:*?"<>|«»]+/g, '').trim() + '.json', this.fileJson, 'application/json'); return; }
    if (m === 'open-file') { document.getElementById('fileInput').click(); return; }
    if (m === 'open-paste') { const t = document.getElementById('pasteJson').value; if (t.trim() && this.openJson(t)) this.closeModal(); return; }
    if (m === 'new') { this.newScheme(); return; }
    // «Мои схемы»: открыть, дублировать, переименовать, удалить (с подтверждением в этом же окне)
    const id = b && b.dataset ? b.dataset.id : null, row = id && this.lib.list().find(x => x.id === id);
    // запись не читается — не «переполнено», а «повреждена»: её можно только удалить
    const fail = () => { if (!this.lib.load(id)) this.toast(`Схема «${row.title}»: запись в браузере повреждена — её можно только удалить.`, 'warn'); else this.storeWarn(true); };
    if (m === 'sch-open' && row) { this.closeModal(); this.chooseScheme('my:' + id); return; }
    if (m === 'sch-dup' && row) {
      const n = this.lib.duplicate(id);
      if (n) this.toast(`Создана копия «${row.title} (копия)».`, 'ok'); else fail();
      this.fillSchemeSelect(); this.showSchemes();
      return;
    }
    if (m === 'sch-ren' && row) { this.showSchemes({ ren: id }); return; }
    if (m === 'sch-ren-ok' && row) {
      const inp = document.getElementById('schRen'), v = inp ? inp.value.trim() : '';
      if (!v) { this.toast('Название не может быть пустым.', 'warn'); return; }
      if (!this.lib.rename(id, v)) { fail(); return; }
      if (this.myId() === id) { this.scheme.title = v.slice(0, 80); this.renderSide(); if (this.v3 && this.v3.ready) this.v3.drawBoard(); }
      this.fillSchemeSelect(); this.showSchemes();
      this.toast(`Схема переименована: «${v.slice(0, 80)}».`, 'ok');
      return;
    }
    if (m === 'sch-del' && row) { this.showSchemes({ del: id }); return; }
    if (m === 'sch-del-ok' && row) {
      this.lib.remove(id);
      if (this.myId() === id) this.setScheme(SAMPLES[0].make(), SAMPLES[0].key);
      this.fillSchemeSelect(); this.showSchemes();
      this.toast(`Схема «${row.title}» удалена.`);
      return;
    }
    if (m === 'sch-ren-no' || m === 'sch-del-no') this.showSchemes();
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
      else if (mod && e.code === 'KeyA') { e.preventDefault(); this.selectAll(); }
      else if (mod && e.code === 'KeyC') { if (this.copySel()) e.preventDefault(); }
      else if (mod && e.code === 'KeyV') { e.preventDefault(); this.paste(); }
      else if (e.key === 'Escape') { this.view.setPlacing(null); this.paletteState(null); this.view.select(null); this.view.setBoxMode(false); }
      return;
    }
    if (mod) return;
    // в 3D-полигоне указатель и ПЗ — предметы в руках, а WASD, E, Q — ходьба и действия (src/view3d/walk.js)
    const poly3d = this.mode === '3d' && this.scheme.room;
    if (poly3d && (e.code === 'KeyV' || e.code === 'KeyP')) return;
    if (e.code === 'KeyV') this.toggleTool('check');
    else if (e.code === 'KeyP') this.toggleTool('pz');
    else if (e.code === 'KeyK') { if (!this.tr.ack()) this.toast('Сигналов нет.'); }
    else if (e.code === 'KeyF' && this.mode === '3d' && this.v3 && this.v3.ready) this.v3.toggleDebug();
    else if (e.key === 'Escape') {
      if (document.getElementById('actmenu')) this.closeActMenu();
      else if (this.v3 && this.v3.menu3d) this.v3.closeMenu3D();
      else if (this.tool) this.toggleTool(this.tool);
    }
  },
  toggleTheme() {
    const root = document.documentElement;
    const cur = root.dataset.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('ts.theme', next);
  },
  tick() {
    if (this.exam) this.exam.tick();
    if (this.tr.run && !this.tr.run.done) {
      this.renderTaskStats();
      if (this.v3 && this.v3.ready && this.mode === '3d') this.v3.drawBoard();
    }
  },
}, Panels);

export { app };
