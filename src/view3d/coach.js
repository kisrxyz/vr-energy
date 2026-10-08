/* ===== Обучение «за руку» на площадке: первые минуты на настоящем задании =====
   При первом входе в 3D площадки — предложение (карточка сверху: «Начать» / «Пропустить»), потом — по «Обучение» на щите.
   Обучение: задание площадки с проверкой отсутствия напряжения, «Подсказки шагов» включены (бесплатно, как всегда),
   «Пешком» — от щита у первого аппарата (view3d.placeBoard). Карточки идут за заданием:
     1 подойти (G) → 2 навести прицел → 3 переключить (E) → [так же дальше] → 4 проверить (V, затем E) → 5 заземлить → дальше сами.
   Ноутбук и телефон — карточка сверху (нужная клавиша подсвечена и в блоке «Управление»), шлем — строка на щите и на запястье.
   «Пропустить» — в любой момент. В экзамене и показе — нет. Баллы задания считаются как обычно (подсказки шагов бесплатны). */
import { store } from '../ui/store.js';
import { esc, isPzId, TYPES } from '../core/elements.js';

const SEEN = 'ts.coach';
const N = 5;   // шагов в счёте «шаг N из 5»

class Coach {
  constructor(v) {
    this.v = v; this.on = false; this.cur = null; this.offered = false;
    const el = this.el = document.createElement('div');
    el.className = 'v3-coach'; el.hidden = true; el.setAttribute('role', 'status');
    v.host.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-coach]');
      if (!b) return;
      const a = b.dataset.coach;
      if (a === 'start') this.start(); else if (a === 'go') this.v.goNext(); else this.stop(true);
    });
  }
  get app() { return this.v.app; }
  // Можно ли учить здесь: площадка с заданиями, не экзамен, не показ
  can() {
    const app = this.app;
    return !this.v.room && !!app.scheme.tasks.length && !(app.exam && app.exam.active()) && !app.demoOn;
  }
  // Первый вход в 3D площадки: предложить (ничего не меняя, пока не нажали «Начать»)
  offer() {
    if (this.on || this.offered || store.get(SEEN) === '1' || !this.can() || (this.app.tr.run && !this.app.tr.run.done)) return;
    this.offered = true;
    this.show('Обучение за руку · 2–3 минуты', `Пять шагов на настоящем задании: <b>подойти</b>, <b>навести</b>, <b>отключить</b>, <b>проверить</b>, <b>заземлить</b>. Подсказки бесплатны.`,
      `<button class="btn primary" type="button" data-coach="start">Начать</button><button class="btn" type="button" data-coach="skip">Пропустить</button>`);
  }
  // Задание с проверкой отсутствия напряжения (есть все пять шагов), «Пешком», подсказки шагов
  start() {
    if (!this.can()) return false;
    const app = this.app, v = this.v, tasks = app.scheme.tasks;
    const task = tasks.find(t => t.steps.some(st => st.op === 'check') && t.steps.some(st => this.earthStep(st))) || tasks[0];
    if (!app.stepGuide) app.setStepGuide(true);
    this.on = true; this.cur = 'go'; this.ops = 0; this.checks = 0;
    app.taskIdx = tasks.indexOf(task);
    app.startTask(task);
    if (!v.renderer.xr.isPresenting && !v.yardWalk) v.toggleWalk();
    this.update(true);
    return true;
  }
  stop(seen) {
    this.on = false; this.cur = null;
    if (seen) store.set(SEEN, '1');
    this.el.hidden = true;
    delete this.v.host.dataset.coach;
    this.keys([]);
    if (this.v.ready) this.v.drawBoard();
  }
  earthStep(st) {
    if (!st || st.op !== 'on') return false;
    if (isPzId(st.id)) return true;
    const el = this.app.tr.elOf(st.id);
    return !!el && TYPES[el.t].cls === 'earth';
  }
  // Каждый кадр и после событий: какой шаг сейчас (по заданию, прицелу и сделанному)
  update(force) {
    if (!this.on) return;
    const app = this.app, tr = app.tr, run = tr.run, v = this.v;
    if (!run || !this.can()) { this.stop(true); return; }
    // задание выполнено — последняя карточка «Обучение пройдено» (уходит сама через 9 с или по «Понятно»)
    const g = run.done ? null : tr.peek(), st = g && g.step, ops = run.ops.filter(o => o.op !== 'check').length, checks = run.ops.filter(o => o.op === 'check').length;
    const t = st ? v.guideTarget(st.id) : null, id = t && (t.dev || t.wire);
    const xr = v.renderer.xr.isPresenting, aim = v.walk && v.walk.aim;
    // навели: пешком — прицел на аппарате (рядом), в шлеме — луч на нём
    const aimed = !!id && (xr ? v.hover === id : !!(aim && aim.id === id && aim.type !== 'far'));
    let cur = this.cur;
    if (cur === 'go' && (aimed || (xr && this.nearTo(t)))) cur = 'aim';
    if (cur === 'aim' && aimed) cur = 'act';
    if ((cur === 'go' || cur === 'aim' || cur === 'act') && ops > this.ops) cur = 'more';
    if (cur === 'more' && st && st.op === 'check') cur = 'check';
    if (cur === 'more' && this.earthStep(st) && checks > 0) cur = 'earth';
    if (cur === 'check' && checks > this.checks) cur = this.earthStep(st) ? 'earth' : 'more';
    if (cur === 'earth' && run.ops.some(o => this.earthStep(o))) cur = 'done';
    if (!st && cur !== 'done') cur = 'done';
    if (cur === 'done' && this.cur !== 'done') this.doneAt = performance.now();
    if (cur === 'more' && this.cur !== 'more') { this.ops = ops; }
    if (cur === 'check' && this.cur !== 'check') this.checks = checks;
    const changed = cur !== this.cur || force || (st && st !== this.step);
    this.cur = cur; this.step = st;
    if (cur === 'done' && performance.now() - this.doneAt > 9000) { this.stop(true); return; }
    if (changed) this.render(g);
  }
  nearTo(t) {
    if (!t) return false;
    const p = this.v.guidePoint(t), c = this.v.camera.getWorldPosition(this.v.tmp.v);
    return !!p && Math.hypot(p.x - c.x, p.z - c.z) < 6;
  }
  // Текст шага: ноутбук (клавиши), телефон (касание), шлем (кнопки контроллера) — одна функция
  texts(g) {
    const v = this.v, touch = v.walk && v.walk.touch, st = g && g.step, what = g ? g.text : '';
    const name = st ? v.app.tr.nm(isPzId(st.id) ? st.id : st.id) : '';
    const K = k => `<kbd>${k}</kbd>`;
    const pz = st && isPzId(st.id);
    switch (this.cur) {
      case 'go': return { n: 1, keys: ['G'], go: true, html: touch ? `Подойдите к аппарату <b>${esc(name)}</b>: «Перейти» — или касание земли у маяка.` : `Подойдите к аппарату <b>${esc(name)}</b>: нажмите ${K('G')} — или идите ${K('W')}${K('A')}${K('S')}${K('D')} к маяку.`,
        vr: `Подойдите к аппарату ${name}: кнопка B или Y (или курок по земле у маяка).` };
      case 'aim': return { n: 2, keys: [], html: touch ? `Посмотрите на <b>${esc(name)}</b>: перетащите сцену пальцем.` : `Наведите прицел (крестик в центре) на <b>${esc(name)}</b> — подпись внизу скажет, что будет.`,
        vr: `Наведите луч на ${name}: он станет жёлтым.` };
      case 'act': return { n: 3, keys: ['E'], html: touch ? `Коснитесь аппарата — <b>${esc(what)}</b>.` : `${K('E')} или щелчок — <b>${esc(what)}</b>.`, vr: `Курок — ${what}.` };
      case 'more': return { n: 3, keys: ['G', 'E'], go: true, html: `Так же — дальше: <b>${esc(what)}</b>. ${touch ? '«Перейти»' : K('G')} — к аппарату, ${touch ? 'касание' : K('E')} — операция.`, vr: `Так же: ${what}. B или Y — к аппарату.` };
      case 'check': return { n: 4, keys: ['V', 'E'], html: touch ? `Проверьте отсутствие напряжения: «Указатель напряжения» в панели, затем коснитесь <b>${esc(name)}</b>. Горит и пищит — напряжение есть, молчит — нет.`
        : `Проверьте отсутствие напряжения: ${K('V')} — указатель в руке, прицел на <b>${esc(name)}</b>, ${K('E')}. Горит и пищит — напряжение есть, молчит — нет.`,
        vr: `Проверьте отсутствие напряжения: боковая кнопка по ${name}. Горит и пищит — напряжение есть, молчит — нет.` };
      case 'earth': return { n: 5, keys: pz ? ['P', 'E'] : ['E'], html: pz ? `Заземлите: ${touch ? '«Переносное заземление» в панели' : K('P') + ' — ПЗ'}, затем ${touch ? 'коснитесь провода' : K('E') + ' по проводу'} — <b>${esc(what)}</b>.` : `Заземлите: ${touch ? 'коснитесь' : K('E') + ' по'} <b>${esc(name)}</b> — ${esc(what)}.`,
        vr: pz ? `Заземлите: ${what} (ПЗ — кнопка «ПЗ» на щите, затем курок по проводу).` : `Заземлите: курок по ${name}.` };
      default: return { n: N, keys: [], html: `Готово! Дальше — сами: следующий шаг вверху, ${touch ? '«Перейти»' : K('G')} — к аппарату. Ошиблись — у прицела объяснение, почему опасно.`, vr: 'Готово! Дальше — сами: следующий шаг на щите и запястье, B или Y — к аппарату.', done: true };
    }
  }
  render(g) {
    const t = this.texts(g);
    this.vr = t.vr; this.n = t.n; this.plain = t.html.replace(/<[^>]+>/g, '');
    const touch = this.v.walk && this.v.walk.touch;
    this.show(t.done ? 'Обучение пройдено' : `Обучение · шаг ${t.n} из ${N}`, t.html,
      t.done ? '<button class="btn primary" type="button" data-coach="ok">Понятно</button>'
        : (t.go ? `<button class="btn primary" type="button" data-coach="go">${touch ? 'Перейти' : 'Перейти · G'}</button>` : '') + '<button class="btn" type="button" data-coach="skip">Пропустить обучение</button>');
    this.keys(t.keys);
    if (this.v.ready) this.v.drawBoard();
  }
  show(title, html, btns) {
    this.el.innerHTML = `<b class="t">${esc(title)}</b><p>${html}</p><div class="row">${btns}</div>`;
    this.el.hidden = this.v.renderer && this.v.renderer.xr.isPresenting;
    this.v.host.dataset.coach = '1';
  }
  // нужные клавиши подсвечены и в блоке «Управление»
  keys(list) {
    const box = this.v.walk && this.v.walk.hud.root.querySelector('.v3-keys');
    if (!box) return;
    for (const k of box.querySelectorAll('kbd')) k.classList.toggle('hot', list.includes(k.textContent.trim()));
  }
  // Строка для щита и запястья в шлеме (null — обучения нет)
  // на ноутбуке щит — тем же текстом, что карточка (без разметки клавиш), в шлеме — кнопками контроллера
  boardLine() {
    if (!this.on || !this.vr) return null;
    const xr = this.v.renderer && this.v.renderer.xr.isPresenting;
    return `Обучение ${this.n}/${N}: ${xr ? this.vr : this.plain}`;
  }
  hide() { this.el.hidden = true; }
}

export { Coach };
