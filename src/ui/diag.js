import { store } from './store.js';

/* ===== Диагностика для теста в шлеме =====
   Журнал ошибок (последние 20) и запись VR-теста (сессии с FPS, отметки) — в localStorage этого браузера.
   Ошибки ловятся глобально (window.onerror, unhandledrejection, console.error) и из XR-цикла — сессия не падает.
   Без three.js: отчёт собирается и показывается в 2D (справка → «Отчёт VR-теста»). */
const K_ERR = 'ts.errors', K_VR = 'ts.vrTest', MAX_ERR = 20, MAX_MARKS = 60, MAX_SESS = 10;
const load = (k, def) => { try { const v = JSON.parse(store.get(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } };
const clock = d => d.toTimeString().slice(0, 8);
const short = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 400);

const Diag = {
  ls: new Set(),
  on(fn) { this.ls.add(fn); return () => this.ls.delete(fn); },
  emit(type) { for (const fn of this.ls) { try { fn(type); } catch (e) { /* слушатель не должен ронять журнал */ } } },

  // ---------- ошибки ----------
  errors() { return load(K_ERR, []); },
  lastError() { const e = this.errors(); return e.length ? e[e.length - 1] : null; },
  addError(where, err) {
    const msg = short(err && (err.stack || err.message) ? (err.message || String(err)) : err);
    if (!msg) return;
    const list = this.errors(), last = list[list.length - 1], now = new Date();
    // одна и та же ошибка каждый кадр — одна запись со счётчиком
    if (last && last.msg === msg && last.where === where) { last.n = (last.n || 1) + 1; last.time = clock(now); }
    else {
      const stack = err && err.stack ? short(String(err.stack).split('\n').slice(1, 4).join(' | ')) : '';
      list.push({ date: now.toISOString().slice(0, 10), time: clock(now), where, msg, stack, n: 1, vr: !!this.cur });
      while (list.length > MAX_ERR) list.shift();
    }
    store.set(K_ERR, JSON.stringify(list));
    this.pageErrors = (this.pageErrors || 0) + 1;   // ошибки этого запуска показываем на щите и запястье
    this.emit('error');
  },
  clearErrors() { store.set(K_ERR, '[]'); this.emit('error'); },
  install() {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener('error', e => this.addError('страница', e.error || (e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''))));
    window.addEventListener('unhandledrejection', e => this.addError('промис', e.reason || 'unhandled rejection'));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      ce(...a);
      try { this.addError('консоль', a.map(x => x && x.message ? x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); } catch (e) { /* не мешаем выводу */ }
    };
  },

  // ---------- запись VR-теста ----------
  data() { const d = load(K_VR, null); return d && Array.isArray(d.sessions) && Array.isArray(d.marks) ? d : { sessions: [], marks: [] }; },
  save(d) { store.set(K_VR, JSON.stringify(d)); },
  // Начало сессии VR: sess — {ua, scheme, ref}
  sessionStart(sess) {
    const d = this.data();
    this.cur = Object.assign({ start: new Date().toISOString(), secs: 0, fps: [], calls: 0, callsMax: 0, tris: 0, inputs: [] }, sess);
    d.sessions.push(this.cur);
    while (d.sessions.length > MAX_SESS) d.sessions.shift();
    this.save(d);
    this.t0 = performance.now();
  },
  // Раз в секунду: замер кадра
  sessionTick(s) {
    const c = this.cur;
    if (!c) return;
    c.secs = Math.round((performance.now() - this.t0) / 1000);
    c.fps.push(Math.round(s.fps));
    if (c.fps.length > 3600) c.fps.shift();
    c.calls = s.calls; c.callsMax = Math.max(c.callsMax, s.calls); c.tris = s.tris;
    if (s.ref) c.ref = s.ref;
    for (const i of s.inputs || []) if (!c.inputs.includes(i)) c.inputs.push(i);
    // сохраняем не чаще раза в 5 с: запись в хранилище не бесплатная
    if (c.secs % 5 === 0) this.flush();
  },
  flush() {
    if (!this.cur) return;
    const d = this.data(), i = d.sessions.findIndex(x => x.start === this.cur.start);
    if (i >= 0) d.sessions[i] = this.cur; else d.sessions.push(this.cur);
    this.save(d);
  },
  sessionEnd() { if (!this.cur) return; this.cur.end = new Date().toISOString(); this.flush(); this.cur = null; },
  addMark(m) {
    const d = this.data();
    m.n = d.marks.length ? d.marks[d.marks.length - 1].n + 1 : 1;
    m.time = clock(new Date());
    m.sec = this.cur ? Math.round((performance.now() - this.t0) / 1000) : null;
    d.marks.push(m);
    while (d.marks.length > MAX_MARKS) d.marks.shift();
    this.save(d);
    return m;
  },
  clearTest() { this.save({ sessions: this.cur ? [this.cur] : [], marks: [] }); },

  // ---------- отчёт текстом ----------
  stats(fps) {
    if (!fps || !fps.length) return null;
    const sorted = fps.slice().sort((a, b) => a - b), avg = fps.reduce((a, b) => a + b, 0) / fps.length;
    return { avg: Math.round(avg), min: sorted[0], p5: sorted[Math.floor(sorted.length * 0.05)], low: fps.filter(v => v < 60).length, n: fps.length };
  },
  report(appVer) {
    const d = this.data(), errs = this.errors(), out = [];
    out.push(`Отчёт VR-теста — тренажёр переключений ${appVer || ''}`.trim());
    out.push(`Составлен: ${new Date().toLocaleString('ru-RU')}`);
    out.push(`Браузер: ${navigator.userAgent}`);
    out.push('');
    out.push(`Сессии VR (${d.sessions.length}):`);
    if (!d.sessions.length) out.push('- в VR ещё не входили');
    d.sessions.forEach((s, i) => {
      const st = this.stats(s.fps), t = new Date(s.start);
      out.push(`${i + 1}. ${t.toLocaleString('ru-RU')} · ${Math.floor(s.secs / 60)} мин ${s.secs % 60} с${s.end ? '' : ' (не завершена штатно)'} · схема «${s.scheme || '?'}»`);
      out.push(`   FPS: ${st ? `средний ${st.avg}, минимальный ${st.min}, 5-й процентиль ${st.p5}, секунд ниже 60 — ${st.low} из ${st.n}` : 'нет замеров'}`);
      out.push(`   Вызовов отрисовки за кадр, оба глаза: ${s.calls || 0} (макс. ${s.callsMax || 0}), треугольников: ${s.tris || 0}`);
      out.push(`   Пространство: ${s.ref || '?'} · ввод: ${s.inputs && s.inputs.length ? s.inputs.join('; ') : 'нет данных'}`);
    });
    out.push('');
    out.push(`Отметки (${d.marks.length}):`);
    if (!d.marks.length) out.push('- нет');
    for (const m of d.marks) {
      out.push(`${m.n}. ${m.time}${m.sec != null ? ` (${Math.floor(m.sec / 60)}:${String(m.sec % 60).padStart(2, '0')} от входа)` : ''} · FPS ${m.fps} · стою: ${m.where} · смотрю: ${m.look}${m.task ? ' · ' + m.task : ''}`);
    }
    out.push('');
    out.push(`Ошибки (${errs.length}, последние ${MAX_ERR}):`);
    if (!errs.length) out.push('- нет');
    for (const e of errs) out.push(`- ${e.date} ${e.time}${e.vr ? ' [VR]' : ''} ${e.where}: ${e.msg}${e.n > 1 ? ` (×${e.n})` : ''}${e.stack ? `\n    ${e.stack}` : ''}`);
    return out.join('\n');
  },
  errorsText() {
    const errs = this.errors();
    return errs.length ? errs.map(e => `${e.date} ${e.time}${e.vr ? ' [VR]' : ''} ${e.where}: ${e.msg}${e.n > 1 ? ` (×${e.n})` : ''}${e.stack ? '\n    ' + e.stack : ''}`).join('\n') : 'Ошибок нет.';
  },
};

export { Diag };
