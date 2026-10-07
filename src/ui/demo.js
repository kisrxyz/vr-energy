import { SAMPLES } from '../core/samples.js';
import { demoSteps, pilotLines } from '../core/demo.js';
import { planTask } from '../core/plan.js';
import { esc, normalizeScheme } from '../core/elements.js';
import * as Ed from '../core/edit.js';

/* ===== «Показ»: панель ведущего и автопоказ (сценарий — src/core/demo.js) =====
   Кнопка «Показ» вверху, ссылка ?demo=1 — показ с первого шага, ?demo=auto — автопоказ (2–3 минуты, для записи видео).
   Панель ведущего: «Шаг N из M», заголовок, «Что сказать», «Подготовить», «Назад», «Дальше», «Автопоказ», «Выйти»;
   заказчику — подпись к шагу на экране. «Дальше» и «Назад» сразу готовят шаг; «Подготовить» — вернуть шаг к началу.
   Показ не трогает «Мои схемы»: схемы — свежие копии готовых, правки не сохраняются (app.demoOn). После выхода —
   прежние схема, вид и настройки блокировок. Автопоказ делает видимые действия через те же обработчики, что у пользователя;
   любое нажатие клавиши или щелчок — пауза. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

class Demo {
  constructor(app) {
    this.app = app; this.on = false; this.i = 0; this.steps = [];
    this.autoOn = false; this.paused = false; this.done = false; this.saved = null; this.pasted = [];
  }
  init() {
    const bar = this.bar = document.getElementById('demo');
    bar.innerHTML = `<div class="demo-h"><span class="demo-n"></span><b class="demo-t"></b>
        <div class="demo-btns">
          <button class="btn" data-d="prep" title="Вернуть шаг к началу: схема, вид, задание, положения аппаратов">Подготовить</button>
          <button class="btn" data-d="prev">Назад</button><button class="btn primary" data-d="next">Дальше</button>
          <button class="btn" data-d="auto" title="Шаги сами, с подписями — 2–3 минуты">Автопоказ</button>
          <button class="btn icon-btn demo-fold" data-d="fold" aria-expanded="true" title="Свернуть или развернуть" aria-label="Свернуть или развернуть">▾</button>
          <button class="btn" data-d="exit">Выйти</button></div></div>
      <div class="demo-b"><p class="demo-capm"></p><p class="demo-say"></p><p class="demo-note" hidden>Этот шаг лучше показывать на ноутбуке или в шлеме.</p><p class="demo-pilot" hidden></p><p class="demo-auto" hidden></p></div>`;
    this.cap = document.getElementById('demoCap');
    bar.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b && !b.disabled) this.action(b.dataset.d); });
    document.getElementById('btnDemo').addEventListener('click', () => { if (this.on) this.exit(); else this.open(); });
    // автопоказ: любое нажатие человека — пауза (свои действия автопоказ делает без событий ввода)
    const stop = e => { if (this.autoOn && !this.paused && e.isTrusted && !(e.target.closest && e.target.closest('#demo [data-d]'))) this.pause(); };
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('keydown', stop, true);
    let q = '';
    try { q = new URLSearchParams(location.search).get('demo') || ''; } catch (e) { q = ''; }
    if (q === '1' || q === 'auto') this.open(0).then(() => { if (q === 'auto') this.auto(); });
  }
  has(need) { return need === 'exam' ? !!this.app.exam : SAMPLES.some(s => s.key === need); }
  get step() { return this.steps[this.i]; }

  // ---------- вход и выход ----------
  async open(i = 0) {
    const app = this.app;
    if (app.exam && app.exam.active && app.exam.active()) { app.toast('Сначала завершите или прервите экзамен.', 'warn'); return; }
    if (!this.on) {
      // что вернуть после показа: схему (готовую — заново, свою — из «Моих схем», из файла — копией), вид, настройки
      const mine = app.isMine() || SAMPLES.some(s => s.key === app.source);
      this.saved = { source: app.source, json: mine ? null : JSON.stringify(app.scheme), mode: app.mode, opt: Object.assign({}, app.tr.opt), taskIdx: app.taskIdx };
      this.on = true; app.demoOn = true;
      document.getElementById('app').dataset.demo = '1';
      document.getElementById('btnDemo').setAttribute('aria-pressed', 'true');
      this.steps = demoSteps(n => this.has(n));
      this.bar.hidden = false;
    }
    await this.go(i);
  }
  async exit() {
    const app = this.app, sv = this.saved;
    this.autoOn = false; this.paused = false;
    this.on = false; app.demoOn = false;
    delete document.getElementById('app').dataset.demo;
    document.body.classList.remove('demo-auto');
    document.getElementById('btnDemo').setAttribute('aria-pressed', 'false');
    this.bar.hidden = true; this.caption('');
    app.closeModal(); app.closeActMenu();
    if (app.tr.run && !app.tr.run.done) app.tr.run = null;
    if (sv) {
      const smp = SAMPLES.find(s => s.key === sv.source);
      let s = null;
      if (sv.source.startsWith('my:')) s = app.lib.load(sv.source.slice(3));
      else if (smp) s = smp.make();
      else if (sv.json) { try { s = normalizeScheme(JSON.parse(sv.json)); } catch (e) { s = null; } }
      if (s) app.setScheme(s, sv.source); else app.setScheme(SAMPLES[0].make(), SAMPLES[0].key);
      Object.assign(app.tr.opt, sv.opt);
      app.taskIdx = sv.taskIdx || 0;
      app.setMode(sv.mode, true);
    }
    this.saved = null;
    try { history.replaceState(null, '', location.pathname + '#' + app.mode); } catch (e) { /* адрес не меняем */ }
  }
  action(d) {
    if (d === 'fold') { this.fold(); return; }
    if (d === 'exit') { this.exit(); return; }
    if (d === 'auto') { if (this.autoOn && this.paused) this.resume(); else if (!this.autoOn) this.auto(); return; }
    // ручное управление во время автопоказа — автопоказ заканчивается, ведущий продолжает сам
    this.autoOn = false; this.paused = false; document.body.classList.remove('demo-auto');
    if (d === 'prep') this.go(this.i);
    else if (d === 'prev' && this.i > 0) this.go(this.i - 1);
    else if (d === 'next' && this.i < this.steps.length - 1) this.go(this.i + 1);
    this.render();
  }
  fold(open) {
    const b = this.bar.querySelector('.demo-fold'), now = open != null ? open : b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(now));
    b.textContent = now ? '▾' : '▸';
    this.bar.classList.toggle('folded', !now);
    this.measure();
  }

  // ---------- шаг ----------
  async go(i) {
    this.i = Math.max(0, Math.min(i, this.steps.length - 1));
    this.capOv = null; this.busy = true;
    this.render();
    try { await this.prepare(this.step); } finally { this.busy = false; }
    this.render();
  }
  render() {
    const st = this.step, b = this.bar;
    if (!st) return;
    b.querySelector('.demo-n').textContent = `Показ · шаг ${this.i + 1} из ${this.steps.length}`;
    b.querySelector('.demo-t').textContent = st.title;
    b.querySelector('.demo-say').innerHTML = `<b>Что сказать.</b> ${esc(st.say)}`;
    const narrow = window.matchMedia && matchMedia('(max-width: 760px)').matches;
    b.querySelector('.demo-note').hidden = !(st.wide && narrow);
    const pl = st.id === 'pilot' ? pilotLines() : [];
    const pe = b.querySelector('.demo-pilot');
    pe.hidden = !pl.length;
    pe.innerHTML = pl.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(' · ');
    b.querySelector('[data-d="prev"]').disabled = this.i === 0;
    b.querySelector('[data-d="next"]').disabled = this.i >= this.steps.length - 1;
    const ab = b.querySelector('[data-d="auto"]');
    ab.textContent = this.autoOn ? (this.paused ? 'Продолжить' : 'Автопоказ идёт') : 'Автопоказ';
    ab.setAttribute('aria-pressed', String(this.autoOn && !this.paused));
    const an = b.querySelector('.demo-auto');
    an.hidden = !this.autoOn;
    an.textContent = this.paused ? 'Автопоказ на паузе: «Продолжить» — дальше сам, «Назад» / «Дальше» — вручную.' : 'Автопоказ: любое нажатие — пауза.';
    this.caption(this.capOv || st.caption);
    this.measure();
  }
  // Высота панели — отступ для окон (отчёт, протокол), чтобы они не заходили под неё
  measure() {
    requestAnimationFrame(() => {
      const r = this.bar.getBoundingClientRect(), st = document.documentElement.style, on = !this.bar.hidden;
      st.setProperty('--demo-top', (on ? Math.round(r.bottom) : 0) + 'px');
      st.setProperty('--demo-bot', (on ? Math.round(window.innerHeight - r.top) : 0) + 'px');
    });
  }
  // Подпись для заказчика: на сцене (на телефоне — в панели); setCap — подпись автопоказа поверх подписи шага
  caption(text) {
    if (this.cap) { this.cap.hidden = !text || !this.on; this.cap.textContent = text || ''; }
    if (this.bar) this.bar.querySelector('.demo-capm').textContent = text || '';
  }
  setCap(text) { this.capOv = text; this.caption(text); }
  // Поставить всё для шага: свежая схема, вид, блокировки, задание, выделение
  async prepare(st) {
    const app = this.app, p = st.prepare;
    app.closeModal(); app.closeActMenu();
    if (app.tr.rec) app.tr.cancelRec();
    if (app.tool) app.toggleTool(app.tool);
    const smp = SAMPLES.find(s => s.key === p.scheme);
    if (!smp) return;
    const s = smp.make();
    // шина длиннее — чтобы в конструкторе было куда поставить копию ячейки (только в памяти)
    for (const [n, len] of Object.entries(p.bus || {})) { const b = s.els.find(e => e.name === n); if (b) b.p.len = len; }
    app.tr.run = null;
    app.tr.opt.interlocks = p.interlocks !== false;
    app.tr.opt.requireCheck = true;
    app.setScheme(s, p.scheme);
    app.setMode(p.mode, true);
    if (p.mode === '3d') {
      await app.show3D();
      const v = app.v3;
      if (v && v.ready) {
        if (v.room) { if (v.top) v.toggleTopView(); v.walk.intro(false, true); }
        else if (!!p.walk !== v.yardWalk) v.toggleWalk();
      }
    }
    if (p.select) { const r = Ed.inRect(s, ...p.select); app.view.setSel(r.els, r.wires); }
    if (p.task != null && s.tasks[p.task]) { app.taskIdx = p.task; app.startTask(s.tasks[p.task]); }
    if (p.exam && app.exam && app.exam.demoPrepare) app.exam.demoPrepare();
    app.renderSide();
    document.getElementById('side').scrollTop = 0;
    if (p.mode !== '3d') requestAnimationFrame(() => app.view.fit());
  }
  // Что не совпало с expect шага (пусто — всё как надо). Проверяет автопроходка
  check(st = this.step) {
    const e = st.expect || {}, app = this.app, out = [];
    if (e.scheme && app.source !== e.scheme) out.push(`схема ${app.source}`);
    if (e.mode && app.mode !== e.mode) out.push(`вид ${app.mode}`);
    if (e.interlocks != null && app.tr.opt.interlocks !== e.interlocks) out.push('блокировки');
    if (e.task != null && !!(app.tr.run && !app.tr.run.done) !== e.task) out.push('задание');
    if (e.walk != null && !!(app.v3 && app.v3.ready && app.v3.walking()) !== e.walk) out.push('пешком');
    if (e.selected != null) { const s = app.view.selSets(); if (s.els.length + s.wires.length !== e.selected) out.push(`выделено ${s.els.length + s.wires.length}`); }
    return out;
  }

  // ---------- автопоказ ----------
  async auto() {
    if (!this.on) await this.open(0);
    this.autoOn = true; this.paused = false; this.done = false;
    document.body.classList.add('demo-auto');
    this.fold(true);
    const t0 = Date.now();
    for (let i = this.i; i < this.steps.length; i++) {
      if (!this.autoOn) return;
      await this.go(i);
      for (const a of this.step.auto || []) {
        await this.hold();
        if (!this.autoOn) return;
        try { await this.play(a); } catch (e) { console.warn('Автопоказ:', e); }
      }
    }
    if (!this.autoOn) return;
    this.autoOn = false; this.done = true; this.autoMs = Date.now() - t0;
    document.body.classList.remove('demo-auto');
    this.render();
    this.setCap('Конец показа. Спасибо! Вопросы?');
  }
  pause() { this.paused = true; this.render(); }
  resume() { this.paused = false; this.render(); }
  async hold() { while (this.autoOn && this.paused) await sleep(100); }
  // Пауза автопоказа: время идёт, только пока он не на паузе
  async wait(ms) {
    for (let t = 0; t < ms && this.autoOn; t += 100) { await this.hold(); await sleep(Math.min(100, ms - t)); }
  }
  idOf(name) { const el = this.app.scheme.els.find(e => e.name === name); return el ? el.id : null; }
  // Щелчок по аппарату в 2D: сначала вспышка на месте — зрителю видно, куда нажали
  async click2D(id) {
    const app = this.app;
    if (!id) return;
    app.view.burst(id, 'var(--accent)');
    await this.wait(450);
    const g = document.querySelector(`#le [data-el="${CSS.escape(id)}"] .hit`), r = g && g.getBoundingClientRect();
    app.pick2D({ el: id, cx: r ? r.left + r.width / 2 : null, cy: r ? r.top + r.height / 2 : null });
  }
  async menu2D(id, label) {
    await this.click2D(id);
    await this.wait(900);
    const b = [...document.querySelectorAll('#actmenu button')].find(x => x.textContent.trim() === label);
    if (b) b.click(); else this.app.closeActMenu();
  }
  async play(a) {
    const app = this.app;
    if (a.cap) this.setCap(a.cap);
    if (a.wait) await this.wait(a.wait);
    if (a.click) await this.click2D(this.idOf(a.click));
    if (a.menu) await this.menu2D(this.idOf(a.menu), a.item);
    if (a.ack) app.sideAction('ack');
    if (a.hint) app.sideAction('task-hint');
    if (a.plan) await this.playPlan(a.every || 1500);
    if (a.report) {
      for (let t = 0; t < 3000 && document.getElementById('modal').hidden; t += 100) await sleep(100);
      await this.wait(a.report);
      app.closeModal();
    }
    if (a.go) await this.goTo(a.go, a.ms || 2000);
    if (a.e && app.v3 && app.v3.walk.on) { app.v3.walk.updateAim(); app.v3.walk.action(); await this.wait(400); }
    if (a.copy) app.copySel();
    if (a.paste) this.pasteAt(a.paste);
    if (a.mode) app.setMode(a.mode);
    if (a.clickNew) { const el = app.scheme.els.find(e => this.pasted.includes(e.id) && e.t === a.clickNew); if (el) await this.click2D(el.id); }
  }
  // Остаток плана задания — как человек: щелчки, меню тележки, указатель
  async playPlan(every) {
    const app = this.app, tr = app.tr;
    if (!tr.run || tr.run.done) return;
    for (const a of planTask(app.scheme, tr.run.task)) {
      if (!this.autoOn || !tr.run || tr.run.done) return;
      if ((a.do === 'switch' && !a.menu && tr.isOn(a.id) === (a.step.op === 'on'))) continue;
      const t = tr.stepText(a.step);
      this.setCap(t.charAt(0).toUpperCase() + t.slice(1));
      if (a.do === 'switch' && !a.menu) await this.click2D(a.id);
      else if (a.do === 'switch' || a.do === 'rack') await this.menu2D(a.id, a.menu);
      else if (a.do === 'check' || a.do === 'pz') {
        app.toggleTool(a.do === 'check' ? 'check' : 'pz');
        const isEl = app.scheme.els.some(e => e.id === a.target);
        if (isEl) await this.click2D(a.target); else { await this.wait(450); app.pick2D({ w: a.target }); }
        app.toggleTool(app.tool);
      }
      await this.wait(every);
    }
  }
  // Подойти пешком и навести прицел: плавно, за ms
  async goTo(what, ms) {
    const v = this.app.v3;
    if (!v || !v.ready || !v.walk.on) return;
    const t = v.aimTarget(what.dev ? { dev: this.idOf(what.dev) } : what), w = v.walk;
    // на площадке аппарат видно целиком с 3–5 м; в помещении предметы и места — на расстоянии руки
    const q = t && (v.room ? w.seek(t.p, t.want) : w.seek(t.p, t.want, false, [4, 3.4, 4.8, 2.8, 5.5, 2.2]));
    if (!q) return;
    const s = { x: w.x, z: w.z, yaw: w.yaw, pitch: w.pitch };
    let dy = q.yaw - s.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const t0 = performance.now();
    for (;;) {
      await this.hold();
      if (!this.autoOn) return;
      const k = ease(Math.min(1, (performance.now() - t0) / ms));
      w.x = s.x + (q.x - s.x) * k; w.z = s.z + (q.z - s.z) * k; w.yaw = s.yaw + dy * k; w.pitch = s.pitch + (q.pitch - s.pitch) * k;
      w.vx = 0; w.vz = 0; w.apply();
      if (k >= 1) break;
      await sleep(16);
    }
    w.pose(q);
  }
  // Ctrl+V так, чтобы точка подключения группы к шине встала в to: курсор туда, где окажется середина копии
  pasteAt(to) {
    const app = this.app, sel = app.view.selSets(), clip = app.clip;
    if (!clip) return;
    const els = app.scheme.els.filter(e => sel.els.includes(e.id)), ws = app.scheme.wires.filter(w => sel.wires.includes(w.id));
    const box = Ed.groupBox(els, ws);
    // точка подключения — самый верхний конец провода группы
    let top = null;
    for (const w of ws) for (const q of [w.a, w.b]) if (!top || q[1] < top[1]) top = q;
    if (!box || !top) return;
    const x0 = to[0] - (top[0] - Math.floor(box[0])), y0 = to[1] - (top[1] - Math.floor(box[1]));
    app.view.cursorW = [x0 + clip.w / 2, y0 + clip.h / 2];
    app.paste();
    this.pasted = app.view.selSets().els;
  }
}

export { Demo };
