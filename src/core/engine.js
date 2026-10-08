import { TYPES, POS, POS_NAME, ptKey, clamp, portPoints, fmtKv, isSwitchable, windings, breaksLoad, isPzId, onWire, newId } from './elements.js';

/* ===== §3. Движок =====
   Схема → граф: узел = точки, соединённые проводами и шинами; ребро = включённый аппарат, элемент цепи (ТТ, реактор,
   КЛ, ВЛ) или трансформатор. Напряжение идёт от включённых источников по рёбрам, через трансформатор — с пересчётом класса.
   Земля идёт от включённых ЗН, КЗ и ПЗ только по аппаратам и элементам цепи (через трансформатор не проходит).

   ПРАВИЛА (их подтверждает преподаватель):
   1. ЗН (и ПЗ) на участок под напряжением → авария (дуга, КЗ).
   2. Разъединитель на заземлённый участок под напряжением → авария.
   3. Выключатель на заземлённый участок → КЗ, выключатель отключается защитой.
   4. Разъединителем отключён ток нагрузки (потребитель или БК потеряли питание) → авария.
   5. Разъединителем включена нагрузка → авария.
      Разъединителем можно отключать и включать ненагруженные шины, трансформаторы, ТН и линии.
   6. ЗН (и ПЗ) без проверки отсутствия напряжения указателем → нарушение порядка (если правило включено).
   7. В задании потребитель из списка «не обесточивать» потерял питание → ошибка «перерыв питания».
   С включёнными блокировками опасные операции 1–5 не выполняются, но считаются попыткой ошибки.
   При КЗ отключаются ближайшие выключатели (и перегорают предохранители), через которые КЗ питается; если таких нет — источник.

   НОВЫЕ ПРАВИЛА 0.2 (бесспорные, но тоже показать преподавателю):
   8.  Предохранитель при КЗ за ним перегорает вместо выключателя выше; перегоревший остаётся отключённым до замены.
       Снимать и ставить предохранитель — как разъединителем: без нагрузки (правила 2, 4, 5); установка на заземлённый
       участок — КЗ, новый предохранитель перегорает.
   9.  Выключатель нагрузки отключает и включает ток нагрузки, но не отключает КЗ: КЗ за ним отключает выключатель
       выше или предохранитель. Включение на заземлённый участок — КЗ (как правило 3).
   10. Тележку КРУ перемещают только при отключённом выключателе (механическая блокировка). Без блокировок —
       нарушение порядка, а если при этом рвётся или включается ток нагрузки или земля — авария (правила 2, 4, 5).
       Тележка разъединителя (СР, ТН) — как разъединитель.
   11. Рубильник без дугогасительных камер — как разъединитель; с камерами — отключает ток нагрузки.
   12. Отделитель вручную — как разъединитель; короткозамыкатель на напряжение — искусственное КЗ,
       отключение со стороны питания. TODO преподаватель: автоматика ОД+КЗ не моделируется.
   Логика — в Trainer.analyze и Trainer.clearFault.

   ДОПОЛНЕНИЯ (Trainer.use): правила выше не меняют, а добавляют свои — так сделан VR-полигон (src/core/permit.js:
   СИЗ, плакаты, замок, порядок технических мероприятий). Дополнение — объект с необязательными методами:
     event(type, data) — события движка, раньше остальных слушателей;
     guard(el, act) → { text, why } — механическая блокировка: операция не выполняется, попытка — ошибка;
     done(run) — ещё одно условие выполнения задания; finish(run, completed) — перед оценкой (пропущенное);
     hint(run) → { step, text } — подсказка вместо эталонных шагов; stepText(st) — текст шагов, которых движок не знает;
     checkWhere(target) → «на нижних контактах яч.3» — где проверяли указателем (для журнала), если движок назвал бы место хуже.
   Ошибка вида 'safety' (охрана труда) стоит в оценке как нарушение порядка. */

// Проводит ли аппарат в состоянии x (тележка — только в рабочем положении)
function conducts(el, x) {
  if (!x) return false;
  return TYPES[el.t].cart ? !!x.on && x.pos === 'work' : !!x.on;
}
// Узел переносного заземления: провод или шина
function pzNode(topo, at) {
  if (topo.wireNode.has(at)) return topo.wireNode.get(at);
  const t = topo.term.get(at);
  return t && t.length === 1 ? t[0] : null;
}

function buildTopo(s) {
  const parent = new Map();
  const add = k => { if (!parent.has(k)) parent.set(k, k); };
  const find = k => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const use = new Map();
  const U = k => { let u = use.get(k); if (!u) use.set(k, u = { ports: 0, wires: 0, bus: false }); return u; };
  const portKeys = new Map();
  for (const el of s.els) {
    const keys = portPoints(el).map(ptKey);
    keys.forEach(add);
    if (el.t === 'bus') { for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]); keys.forEach(k => { U(k).bus = true; }); }
    else keys.forEach(k => { U(k).ports++; });
    portKeys.set(el.id, keys);
  }
  for (const w of s.wires) { const a = ptKey(w.a), b = ptKey(w.b); union(a, b); U(a).wires++; U(b).wires++; }
  // ПЗ можно поставить на провод в любом месте, не только на конец
  for (const el of s.els) {
    if (!TYPES[el.t].onWire) continue;
    const k = portKeys.get(el.id)[0], u = U(k);
    if (u.wires || u.bus || u.ports > 1) continue;
    const p = k.split(',').map(Number), w = s.wires.find(v => onWire(v, p));
    if (w) { union(k, ptKey(w.a)); u.wires++; u.mid = true; }
  }
  const nid = new Map();
  let cnt = 0;
  const node = k => { add(k); const r = find(k); if (!nid.has(r)) nid.set(r, 'n' + (cnt++)); return nid.get(r); };
  const term = new Map(), nodeEls = new Map(), busNodes = new Set(), wireNode = new Map();
  for (const el of s.els) {
    const keys = portKeys.get(el.id);
    const t = el.t === 'bus' ? [node(keys[0])] : keys.map(node);
    term.set(el.id, t);
    for (const n of new Set(t)) { if (!nodeEls.has(n)) nodeEls.set(n, []); nodeEls.get(n).push(el.id); }
    if (el.t === 'bus') busNodes.add(t[0]);
  }
  for (const w of s.wires) wireNode.set(w.id, node(ptKey(w.a)));
  return { term, nodeEls, busNodes, wireNode, use, node, portKeys };
}

function makeSim(s, init, initPos) {
  const st = {}, src = {};
  for (const el of s.els) {
    if (isSwitchable(el)) {
      const x = st[el.id] = { on: init && el.id in init ? !!init[el.id] : !!el.on, trip: false };
      if (TYPES[el.t].cart) x.pos = initPos && POS.includes(initPos[el.id]) ? initPos[el.id] : (el.pos || 'work');
    } else if (TYPES[el.t].cls === 'source') src[el.id] = { on: true, trip: false };
  }
  // переносные заземления из исходного положения задания
  if (init) for (const k in init) if (isPzId(k) && init[k]) st[k] = { on: true, trip: false };
  return { st, src, checked: new Set(), pzPt: {} };
}

// Состояние сети. ov = {id, st} — «что будет, если у аппарата id станет состояние st».
function compute(s, topo, sim, ov) {
  const stOf = id => (ov && ov.id === id) ? ov.st : sim.st[id];
  const adj = new Map();
  const link = (a, e) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(e); };
  for (const el of s.els) {
    const T = TYPES[el.t], tm = topo.term.get(el.id);
    if (T.cls === 'switch' || T.cls === 'link') {
      if (tm[0] === tm[1] || (T.cls === 'switch' && !conducts(el, stOf(el.id)))) continue;
      // br — граница зоны КЗ (отключает КЗ), lb — может разорвать ток нагрузки
      const e = { id: el.id, k: 'sw', br: !!T.prot, lb: breaksLoad(el) };
      link(tm[0], Object.assign({ to: tm[1] }, e));
      link(tm[1], Object.assign({ to: tm[0] }, e));
    } else if (T.cls === 'transformer') {
      const kv = windings(el);
      for (let i = 0; i < tm.length; i++) for (let j = 0; j < tm.length; j++)
        if (i !== j && tm[i] !== tm[j]) link(tm[i], { to: tm[j], id: el.id, k: 'tr', kv: kv[j] });
    }
  }
  const V = new Map(), src = new Map(), srcNodes = new Set(), q = [];
  for (const el of s.els) {
    if (TYPES[el.t].cls !== 'source') continue;
    const ss = sim.src[el.id];
    if (!ss || !ss.on || ss.trip) continue;
    const n = topo.term.get(el.id)[0];
    srcNodes.add(n);
    if (!V.has(n)) { V.set(n, +el.p.kv); src.set(n, el.id); q.push(n); }
  }
  for (let i = 0; i < q.length; i++) {
    const n = q[i];
    for (const e of adj.get(n) || []) {
      if (V.has(e.to)) continue;
      V.set(e.to, e.k === 'tr' ? e.kv : V.get(n));
      src.set(e.to, src.get(n));
      q.push(e.to);
    }
  }
  const Gd = new Set(), gq = [];
  const seed = n => { if (n != null && !Gd.has(n)) { Gd.add(n); gq.push(n); } };
  for (const el of s.els) if (TYPES[el.t].cls === 'earth') { const x = stOf(el.id); if (x && x.on) seed(topo.term.get(el.id)[0]); }
  // переносные заземления, наложенные в тренажёре
  const pz = Object.keys(sim.st).filter(isPzId);
  if (ov && isPzId(ov.id) && !pz.includes(ov.id)) pz.push(ov.id);
  for (const k of pz) { const x = stOf(k); if (x && x.on) seed(pzNode(topo, k.slice(3))); }
  for (let i = 0; i < gq.length; i++) for (const e of adj.get(gq[i]) || []) { if (e.k !== 'sw' || Gd.has(e.to)) continue; Gd.add(e.to); gq.push(e.to); }
  // loads — потребители под напряжением; cur — всё, что тянет ток нагрузки (потребители и БК)
  const loads = new Set(), cur = new Set();
  for (const el of s.els) {
    const T = TYPES[el.t];
    if (T.cls !== 'load' || !V.has(topo.term.get(el.id)[0])) continue;
    cur.add(el.id);
    if (T.consumer) loads.add(el.id);
  }
  return { V, G: Gd, loads, cur, adj, src, srcNodes };
}

const fmtTime = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);

class Trainer {
  constructor() {
    this.ls = new Set();
    this.opt = { interlocks: true, requireCheck: true };
    this.log = []; this.run = null; this.rec = null;
    this.addons = [];
  }
  on(fn) { this.ls.add(fn); return () => this.ls.delete(fn); }
  emit(type, data = {}) {
    // дополнения узнают о событии первыми: их ошибки должны попасть в задание раньше, чем его покажут
    for (const a of this.addons) if (a.event) { try { a.event(type, data); } catch (e) { console.error(e); } }
    for (const fn of this.ls) { try { fn(type, data); } catch (e) { console.error(e); } }
  }
  // Подключить дополнение (см. заголовок файла)
  use(addon) { this.addons.push(addon); if (addon.attach) addon.attach(this); return addon; }
  addon(name, ...args) {
    for (const a of this.addons) if (a[name]) { const r = a[name](...args); if (r != null) return r; }
    return null;
  }

  load(s) {
    this.s = s;
    this.topo = buildTopo(s);
    this.byId = new Map(s.els.map(e => [e.id, e]));
    this.run = null; this.rec = null;
    this.reset();
  }
  reset(init, initPos) {
    this.sim = makeSim(this.s, init, initPos);
    for (const k in this.sim.st) if (isPzId(k)) this.elOf(k);
    this.state = compute(this.s, this.topo, this.sim);
    this.log = [];
    this.emit('state', { reset: true });
  }
  resetToNormal() {
    if (this.run && !this.run.done) return false;
    this.run = null;
    this.reset();
    this.addLog('info', 'Схема приведена в нормальное положение.');
    this.emit('task', { exit: true });
    return true;
  }
  // Элемент схемы или переносное заземление, наложенное в тренажёре (создаётся при первом обращении)
  elOf(id) {
    if (this.byId.has(id)) return this.byId.get(id);
    if (!isPzId(id)) return null;
    const at = id.slice(3), n = pzNode(this.topo, at);
    if (n == null) return null;
    const el = { id, t: 'pz', name: 'ПЗ ' + this.nodeName(n), at, pseudo: true };
    this.byId.set(id, el);
    this.topo.term.set(id, [n]);
    if (!this.topo.nodeEls.has(n)) this.topo.nodeEls.set(n, []);
    this.topo.nodeEls.get(n).push(id);
    return el;
  }
  // Название точки схемы по соседним аппаратам: «на 1СШ», «между ЛР Л-1 и Цех №1», «у Q1»
  nodeName(n) {
    const ids = (this.topo.nodeEls.get(n) || []).filter(i => !isPzId(i) && TYPES[this.byId.get(i).t].cls !== 'earth');
    const bus = ids.find(i => this.byId.get(i).t === 'bus');
    if (bus) return 'на ' + this.nm(bus);
    return ids.length >= 2 ? `между ${this.nm(ids[0])} и ${this.nm(ids[1])}` : ids.length ? 'у ' + this.nm(ids[0]) : 'на проводе';
  }
  // Узел шага задания: аппарат (первая точка), провод или переносное заземление
  stepNode(id) {
    if (isPzId(id)) return pzNode(this.topo, id.slice(3));
    const t = this.topo.term.get(id);
    return t ? t[0] : this.topo.wireNode.get(id);
  }
  // Наложено ли переносное заземление в узле n (на любом проводе этой точки)
  pzAt(n) { return this.pzOn().some(k => pzNode(this.topo, k.slice(3)) === n); }
  nm(id) { const e = this.elOf(id); return e ? e.name : '?'; }
  names(ids) { return ids.map(i => this.nm(i)).join(', '); }
  addLog(level, text, id) {
    const e = { time: new Date().toTimeString().slice(0, 8), level, text, id };
    this.log.unshift(e);
    if (this.log.length > 300) this.log.pop();
    this.emit('log', e);
    return e;
  }
  elapsed() { return this.run ? (Date.now() - this.run.t0) / 1000 : 0; }
  needCheck() { return this.run ? !!this.run.task.requireCheck : this.opt.requireCheck; }
  // extra — дополнительные поля ошибки, например why (почему опасно) у ошибок полигона
  note(kind, text, id, extra) {
    if (this.run && !this.run.done) this.run.errors.push(Object.assign({ kind, text, id, t: Math.round(this.elapsed()) }, extra || {}));
    if (this.rec) this.rec.errors++;
  }
  record(step) {
    if (this.rec) this.rec.steps.push(step);
    if (this.run && !this.run.done) this.run.ops.push(Object.assign({ t: Math.round(this.elapsed()) }, step));
  }
  hasAlarms() {
    return Object.values(this.sim.st).some(x => x.trip) || Object.values(this.sim.src).some(x => x.trip);
  }
  // Переносные заземления, наложенные сейчас
  pzOn() { return Object.keys(this.sim.st).filter(k => isPzId(k) && this.sim.st[k].on); }

  // Что можно сделать с аппаратом: для меню в 2D и 3D
  actions(id) {
    const el = this.elOf(id);
    if (!el || !isSwitchable(el)) return [];
    const T = TYPES[el.t], x = this.sim.st[id] || { on: false };
    if (T.cart) {
      const out = [];
      if (T.sw === 'breaker') out.push({ label: x.on ? 'Отключить выключатель' : 'Включить выключатель' });
      for (const p of POS) if (p !== x.pos) out.push({ pos: p, label: `Тележку в ${POS_NAME[p]} положение` });
      return out;
    }
    if (x.blown) return [{ label: 'Заменить предохранитель' }];
    const v = T.verbs || ['включить', 'отключить'];
    return [{ label: capFirst(x.on ? v[1] : v[0]) }];
  }

  // ---------- анализ операции: что будет, если у аппарата станет состояние nxt ----------
  analyze(el, nxt) {
    const T = TYPES[el.t], tm = this.topo.term.get(el.id);
    const cur = this.sim.st[el.id] || { on: false, trip: false };
    const before = this.state;
    const after = compute(this.s, this.topo, this.sim, { id: el.id, st: nxt });
    const racking = !!T.cart && nxt.pos !== cur.pos;
    const res = this.analyzeNet(el, T, tm, nxt, racking, before, after);
    // TODO преподаватель: требовать ли видимый разрыв (разъединитель отключён, тележка в контрольном) перед включением ЗН и ПЗ,
    // и блокировать ли вкатывание тележки при включённом ЗН в ячейке? Сейчас проверяется только отсутствие напряжения.
    // Механическая блокировка КРУ: тележка перемещается только при отключённом выключателе
    if (racking && T.sw === 'breaker' && cur.on) {
      const block = `Блокировка: тележка ${el.name} не перемещается — выключатель включён. Сначала отключите выключатель.`;
      if (res.viol) res.viol.block = block;
      else res.viol = { kind: 'proc', lock: true, text: `Нарушение порядка: тележка ${el.name} перемещена при включённом выключателе.`, block };
    }
    return res;
  }
  analyzeNet(el, T, tm, nxt, racking, before, after) {
    const conflict = [...after.V.keys()].filter(n => after.G.has(n));
    if (conflict.length) {
      const earths = this.earthsNear(after, conflict, el.id, nxt.on);
      const en = this.names(earths) || 'заземление';
      // место КЗ — включённые ножи на участке, где встретились напряжение и земля
      const fn = [...new Set(earths.map(i => this.topo.term.get(i)[0]))];
      const faultNodes = fn.length ? fn : conflict;
      if (T.cls === 'earth') {
        const kv = this.state.V.get(tm[0]), kvt = kv != null ? ' ' + fmtKv(kv) : '';
        if (T.ek === 'kz') {
          // TODO преподаватель: блокировать ли ручное включение КЗ на напряжение и как вести автоматику ОД+КЗ
          return {
            viol: { kind: 'kz', text: `КЗ: короткозамыкатель ${el.name} включён на участок под напряжением${kvt}. Искусственное короткое замыкание.`,
                    block: `Блокировка: ${el.name} не включается — на участке напряжение${kvt}.` },
            faultNodes };
        }
        return {
          viol: { kind: 'accident', text: `Авария: ${el.name} ${T.ek === 'pz' ? 'наложено' : 'включён'} на участок под напряжением${kvt}. Дуга, короткое замыкание.`,
                  block: `Блокировка: ${el.name} не ${T.ek === 'pz' ? 'накладывается' : 'включается'} — на участке есть напряжение${kvt}. Отключите выключатель и разъединители, проверьте отсутствие напряжения.` },
          faultNodes };
      }
      if (racking) {
        return {
          viol: { kind: 'accident', text: `Авария: тележка ${el.name} вкачена в рабочее положение на заземлённый участок (${en}). Дуга, короткое замыкание.`,
                  block: `Блокировка: тележка ${el.name} не вкатывается — участок заземлён (${en}). Сначала отключите заземление.` },
          faultNodes };
      }
      if (T.sw === 'fuse') {
        return {
          viol: { kind: 'kz', text: `КЗ: предохранитель ${el.name} установлен на заземлённый участок (${en}).`,
                  block: `Блокировка: ${el.name} не устанавливается — участок заземлён (${en}). Сначала снимите заземление.` },
          faultNodes };
      }
      if (T.sw === 'disconnector') {
        return {
          viol: { kind: 'accident', text: `Авария: ${T.title.charAt(0).toLowerCase() + T.title.slice(1)} ${el.name} включён на заземлённый участок (${en}). Дуга, короткое замыкание.`,
                  block: `Блокировка: ${el.name} не включается — участок заземлён (${en}). Сначала отключите заземляющие ножи.` },
          faultNodes };
      }
      return {
        viol: { kind: 'kz', text: `КЗ: ${el.name} включён на заземлённый участок (${en}).`,
                block: `Блокировка: ${el.name} не включается — в зоне включения заземление (${en}).` },
        faultNodes };
    }
    // Ток нагрузки рвёт или включает аппарат без дугогашения: разъединитель, отделитель, рубильник без камер,
    // предохранитель, разъёмные контакты тележки
    const noLoadDevice = T.cls === 'switch' && (racking || (!T.cart && !breaksLoad(el) && T.sw !== 'breaker'));
    if (noLoadDevice) {
      const what = racking ? `при перемещении тележки ${el.name}` : T.sw === 'fuse' ? `предохранителем ${el.name}` : `${T.by || 'аппаратом'} ${el.name}`;
      const arcAt = racking ? 'Дуга на разъёмных контактах.' : 'Электрическая дуга.';
      const lost = [...before.cur].filter(l => !after.cur.has(l));
      const gained = [...after.cur].filter(l => !before.cur.has(l));
      if (lost.length || gained.length) {
        const q = this.seriesBreaker(el.id, before);
        const opening = lost.length > 0;
        const side = opening ? tm.filter(n => before.V.has(n) && after.V.has(n)) : tm.filter(n => before.V.has(n));
        const head = racking ? `тележка ${el.name}` : el.name;
        return {
          viol: { kind: 'accident',
                  text: opening ? `Авария: ${what} разорван ток нагрузки (${this.names(lost)}). ${arcAt}` : `Авария: ${what} включена нагрузка (${this.names(gained)}). ${arcAt}`,
                  block: opening ? `Блокировка: ${head} под нагрузкой. ${q ? 'Сначала отключите ' + this.nm(q) + '.' : 'Сначала снимите нагрузку выключателем.'}`
                                 : `Блокировка: нагрузку ${racking ? 'тележкой' : T.sw === 'fuse' ? 'предохранителем' : T.by || 'этим аппаратом'} не включают. ${q ? 'Отключите ' + this.nm(q) + ', затем включайте.' : 'Включайте нагрузку выключателем.'}` },
          faultNodes: side.length ? side : [tm[0]] };
      }
    }
    if (T.cls === 'earth' && T.ek !== 'kz' && nxt.on && this.needCheck() && !this.sim.checked.has(tm[0])) {
      return { viol: { kind: 'proc', text: `Нарушение порядка: ${el.name} ${T.ek === 'pz' ? 'наложено' : 'включён'} без проверки отсутствия напряжения указателем.` }, faultNodes: [] };
    }
    return { viol: null, faultNodes: [] };
  }

  // Включённые ЗН, КЗ и ПЗ, которые заземляют участок с конфликтом
  earthsNear(st, nodes, opId, opOn) {
    const seen = new Set(nodes), q = [...nodes], out = [];
    for (let i = 0; i < q.length; i++) for (const e of st.adj.get(q[i]) || []) if (e.k === 'sw' && !seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    if (opId != null && isPzId(opId)) this.elOf(opId);
    for (const n of seen) for (const id of this.topo.nodeEls.get(n) || []) {
      const e = this.elOf(id);
      if (TYPES[e.t].cls !== 'earth') continue;
      const x = this.sim.st[id];
      const on = id === opId ? opOn : !!(x && x.on);
      if (on && !out.includes(id)) out.push(id);
    }
    return out;
  }

  // Аппарат того же присоединения (без выхода на шины, можно через трансформатор), которым можно снять нагрузку
  seriesBreaker(id, st) {
    const start = this.topo.term.get(id).filter(n => !this.topo.busNodes.has(n));
    const seen = new Set(start), q = start.map(n => [n, 0]);
    for (let i = 0; i < q.length; i++) {
      const [n, d] = q[i];
      if (d > 8) continue;
      for (const e of st.adj.get(n) || []) {
        if (e.id === id) continue;
        if (e.lb) return e.id;
        if (!seen.has(e.to) && !this.topo.busNodes.has(e.to)) { seen.add(e.to); q.push([e.to, d + 1]); }
      }
    }
    return null;
  }

  // Отключение КЗ: зона КЗ — всё, что связано с местом КЗ без выключателей и предохранителей;
  // отключаются выключатели и перегорают предохранители на границе зоны, через которые она питается.
  // Выключатель нагрузки ток КЗ не отключает — зона проходит через него.
  clearFault(F) {
    const st = compute(this.s, this.topo, this.sim);
    const zone = new Set(F), q = [...F];
    for (let i = 0; i < q.length; i++) for (const e of st.adj.get(q[i]) || []) {
      if (e.k === 'sw' && e.br) continue;
      if (!zone.has(e.to)) { zone.add(e.to); q.push(e.to); }
    }
    const tripped = [];
    for (const el of this.s.els) {
      const T = TYPES[el.t], x = this.sim.st[el.id];
      if (!T.prot || !conducts(el, x)) continue;
      const [a, b] = this.topo.term.get(el.id), ia = zone.has(a), ib = zone.has(b);
      if (ia === ib) continue;
      if (this.fedFrom(st, ia ? b : a, zone, el.id)) {
        x.on = false; x.trip = true;
        if (T.sw === 'fuse') x.blown = true;
        tripped.push(el.id);
      }
    }
    for (const el of this.s.els) {
      if (TYPES[el.t].cls !== 'source') continue;
      const ss = this.sim.src[el.id];
      if (ss.on && !ss.trip && zone.has(this.topo.term.get(el.id)[0])) { ss.trip = true; tripped.push(el.id); }
    }
    return tripped;
  }
  fedFrom(st, start, zone, skip) {
    const seen = new Set([start]), q = [start];
    for (let i = 0; i < q.length; i++) {
      if (st.srcNodes.has(q[i])) return true;
      for (const e of st.adj.get(q[i]) || []) {
        if (e.id === skip || zone.has(e.to) || seen.has(e.to)) continue;
        seen.add(e.to); q.push(e.to);
      }
    }
    return false;
  }
  tripText(id) {
    const e = this.byId.get(id), T = TYPES[e.t];
    if (T.cls === 'source') return `отключение со стороны «${e.name}»`;
    return T.sw === 'fuse' ? `перегорел предохранитель ${e.name}` : `отключился ${e.name}`;
  }
  // Если после изменения где-то напряжение встретилось с землёй — отключить КЗ
  settle() {
    const conflict = [...this.state.V.keys()].filter(n => this.state.G.has(n));
    if (!conflict.length) return [];
    const fn = [...new Set(this.earthsNear(this.state, conflict).map(i => this.topo.term.get(i)[0]))];
    const tripped = this.clearFault(fn.length ? fn : conflict);
    this.state = compute(this.s, this.topo, this.sim);
    if (tripped.length) this.addLog('warn', 'Сработала защита: ' + tripped.map(t => this.tripText(t)).join('; ') + '.', tripped[0]);
    return tripped;
  }

  // ---------- операции ----------
  // act: не задан — включить/отключить (у тележки — выключатель); { pos } — переместить тележку
  operate(id, act) {
    const el = this.elOf(id);
    if (!el || !isSwitchable(el)) return null;
    // механическая блокировка дополнения (замок на приводе в VR-полигоне) — сильнее любых настроек
    const g = this.addon('guard', el, act);
    if (g) {
      this.addLog('warn', g.text, id);
      this.note('blocked', g.text, id, g.why ? { why: g.why } : null);
      this.emit('op', { id, blocked: true, text: g.text });
      return { blocked: true, text: g.text };
    }
    const T = TYPES[el.t], cur = this.sim.st[id] || { on: false, trip: false };
    const nxt = Object.assign({}, cur, { trip: false });
    let pos = null;
    if (act && act.pos) {
      if (!T.cart || !POS.includes(act.pos) || act.pos === cur.pos) return null;
      pos = act.pos;
    } else if (T.cart && T.sw !== 'breaker') pos = cur.pos === 'work' ? 'test' : 'work';  // тележка разъединителя
    if (pos) nxt.pos = pos;
    else { nxt.on = !cur.on; nxt.blown = false; }
    const a = this.analyze(el, nxt);
    const severe = !!a.viol && (a.viol.kind === 'accident' || a.viol.kind === 'kz');
    if ((severe || (a.viol && a.viol.lock)) && this.opt.interlocks) {
      this.addLog('warn', a.viol.block, id);
      this.note('blocked', a.viol.block, id);
      this.emit('op', { id, blocked: true, text: a.viol.block });
      return { blocked: true, text: a.viol.block };
    }
    const before = this.state;
    this.sim.st[id] = nxt;
    if (pos) {
      this.addLog('info', `Тележка ${el.name} переведена в ${POS_NAME[pos]} положение.`, id);
      this.record({ op: 'pos', id, pos });
    } else {
      const did = T.did || ['Включён', 'Отключён'];
      this.addLog('info', cur.blown ? `Заменён предохранитель ${el.name}.` : `${nxt.on ? did[0] : did[1]} ${el.name}${T.cart && cur.pos !== 'work' ? ` (тележка в ${POS_NAME[cur.pos]} положении)` : ''}.`, id);
      this.record({ op: nxt.on ? 'on' : 'off', id });
    }
    let tripped = [];
    if (severe) {
      this.addLog('err', a.viol.text, id);
      this.note(a.viol.kind, a.viol.text, id);
      tripped = this.clearFault(a.faultNodes);
      if (tripped.length) this.addLog('warn', 'Сработала защита: ' + tripped.map(t => this.tripText(t)).join('; ') + '.', tripped[0]);
    } else if (a.viol) {
      this.addLog('warn', a.viol.text, id);
      this.note(a.viol.kind, a.viol.text, id);
    }
    this.state = compute(this.s, this.topo, this.sim);
    tripped = tripped.concat(this.settle());
    this.afterChange(before);
    const res = { ok: true, id, on: nxt.on, pos: nxt.pos, viol: a.viol, tripped, text: a.viol ? a.viol.text : null };
    if (severe) this.emit('fx', { kind: a.viol.kind, id, tripped });
    this.emit('op', res);
    this.emit('state', {});
    this.checkDone();
    return res;
  }
  // Наложить или снять переносное заземление на провод или шину (pt — точка на схеме для рисунка)
  // В одной точке схемы — одно ПЗ: щелчок по другому проводу той же точки снимает уже наложенное.
  pzToggle(target, pt) {
    const n = pzNode(this.topo, target);
    if (n == null) return null;
    const here = this.pzOn().find(k => pzNode(this.topo, k.slice(3)) === n);
    if (here) return this.operate(here);
    const id = 'pz:' + target;
    const el = this.elOf(id);
    if (!el) return null;
    if (pt && !(this.sim.st[id] && this.sim.st[id].on)) this.sim.pzPt[id] = pt;
    return this.operate(id);
  }
  afterChange(before) {
    const lost = [...before.loads].filter(l => !this.state.loads.has(l));
    const got = [...this.state.loads].filter(l => !before.loads.has(l));
    if (lost.length) {
      const keepList = this.run && !this.run.done ? this.run.task.keep : [];
      const bad = lost.filter(l => keepList.includes(l));
      if (bad.length) { const t = `Перерыв питания: ${this.names(bad)}.`; this.addLog('err', t, bad[0]); this.note('supply', t, bad[0]); }
      const rest = lost.filter(l => !bad.includes(l));
      if (rest.length) this.addLog('info', `Без питания: ${this.names(rest)}.`, rest[0]);
      if (this.rec) lost.forEach(l => this.rec.lost.add(l));
    }
    if (got.length) this.addLog('ok', `Питание подано: ${this.names(got)}.`, got[0]);
    for (const n of [...this.sim.checked]) if (this.state.V.has(n)) this.sim.checked.delete(n);
  }

  toggleSource(id) {
    const ss = this.sim.src[id];
    if (!ss) return null;
    if (this.run && !this.run.done) {
      const t = 'Во время задания питание источника не меняется.';
      this.emit('op', { id, info: t, text: t });
      return null;
    }
    const before = this.state;
    if (ss.trip) { ss.trip = false; ss.on = true; } else ss.on = !ss.on;
    this.addLog(ss.on ? 'ok' : 'warn', ss.on ? `«${this.nm(id)}»: напряжение со стороны энергосистемы есть.` : `«${this.nm(id)}»: пропало напряжение со стороны энергосистемы.`, id);
    this.state = compute(this.s, this.topo, this.sim);
    this.settle();
    this.afterChange(before);
    this.emit('op', { id, src: true });
    this.emit('state', {});
    return ss.on;
  }

  // Квитирование: снять мигание отключившихся аппаратов, вернуть питание от системы (АПВ на том конце).
  // Перегоревший предохранитель остаётся отключённым — его заменяют.
  ack() {
    let n = 0;
    for (const id in this.sim.st) if (this.sim.st[id].trip) { this.sim.st[id].trip = false; n++; }
    const before = this.state;
    for (const id in this.sim.src) {
      const ss = this.sim.src[id];
      if (ss.trip && !this.state.G.has(this.topo.term.get(id)[0])) {
        ss.trip = false; n++;
        this.addLog('info', `«${this.nm(id)}»: напряжение восстановлено (АПВ на питающем конце).`, id);
      }
    }
    if (!n) return 0;
    this.state = compute(this.s, this.topo, this.sim);
    this.settle();
    this.afterChange(before);
    this.addLog('info', 'Сигналы квитированы.');
    this.emit('state', {});
    this.checkDone();
    return n;
  }

  // ---------- указатель напряжения ----------
  nodesOf(target) {
    if (this.byId.has(target)) return [...new Set(this.topo.term.get(target))];
    const n = this.topo.wireNode.get(target);
    return n ? [n] : [];
  }
  placeOf(n) {
    const ids = (this.topo.nodeEls.get(n) || []).filter(i => !isPzId(i) || (this.sim.st[i] && this.sim.st[i].on));
    const by = t => ids.find(i => this.byId.get(i).t === t);
    return by('earth') || by('pz') || by('bus') || ids[0] || null;
  }
  check(target) {
    const nodes = this.nodesOf(target);
    if (!nodes.length) return null;
    const el = this.byId.get(target);
    const res = nodes.map(n => ({ n, kv: this.state.V.get(n), g: this.state.G.has(n) }));
    for (const r of res) if (r.kv == null) this.sim.checked.add(r.n);
    const say = r => r.kv != null ? `напряжение есть, ${fmtKv(r.kv)}` : r.g ? 'напряжения нет, заземлено' : 'напряжения нет';
    let text;
    if (res.length === 1) {
      // место может назвать дополнение: в полигоне — контакты ячейки, а не ближайший к ним ЗН
      const place = this.addon('checkWhere', target) || 'у ' + (el ? el.name : (this.placeOf(res[0].n) ? this.nm(this.placeOf(res[0].n)) : 'провод'));
      text = `Указатель напряжения ${place}: ${say(res[0])}.`;
    } else {
      text = `Указатель напряжения на ${el.name}: ` + res.map((r, i) => { const p = this.placeOf(r.n); return `сторона ${i + 1}${p && p !== el.id ? ' (' + this.nm(p) + ')' : ''} — ${say(r)}`; }).join('; ') + '.';
    }
    this.addLog(res.some(r => r.kv != null) ? 'warn' : 'ok', text, target);
    // в эталон записывается то, что проверяли: аппарат, провод или место ПЗ
    this.record({ op: 'check', id: target });
    this.emit('check', { target, res, text, live: res.some(r => r.kv != null) });
    this.emit('state', {});
    return { res, text };
  }

  // ---------- задания ----------
  startTask(task) {
    this.rec = null;
    this.run = null;
    this.sim = makeSim(this.s, task.init, task.initPos);
    for (const k in this.sim.st) if (isPzId(k)) this.elOf(k);
    this.state = compute(this.s, this.topo, this.sim);
    this.log = [];
    this.run = { task, t0: Date.now(), ops: [], errors: [], hints: 0, done: false };
    this.addLog('info', `Задание начато: ${task.title}.`);
    this.emit('task', { start: true });
    this.emit('state', { reset: true });
  }
  stopTask() { if (this.run && !this.run.done) this.finish(false); }
  // Положение аппарата для задания; ПЗ сравнивается по точке, а не по отрезку провода
  isOn(id) {
    if (isPzId(id)) { const n = pzNode(this.topo, id.slice(3)); return n != null && this.pzAt(n); }
    return !!(this.sim.st[id] && this.sim.st[id].on);
  }
  exitTask() { this.run = null; this.emit('task', { exit: true }); }
  checkDone() {
    const r = this.run;
    if (!r || r.done) return;
    const ok = Object.entries(r.task.target).every(([id, on]) => this.isOn(id) === on) &&
      Object.entries(r.task.targetPos || {}).every(([id, p]) => this.sim.st[id] && this.sim.st[id].pos === p) &&
      this.addons.every(a => !a.done || a.done(r));
    if (ok && !Object.values(this.sim.src).some(x => x.trip)) this.finish(true);
  }
  finish(completed) {
    const r = this.run;
    // дополнения дописывают пропущенное, пока задание ещё идёт (note пишет только в идущее задание)
    for (const a of this.addons) if (a.finish) { try { a.finish(r, completed); } catch (e) { console.error(e); } }
    r.done = true; r.completed = completed; r.t1 = Date.now();
    r.grade = this.grade(r);
    this.addLog(completed ? 'ok' : 'warn', completed ? `Задание выполнено за ${fmtTime(r.grade.secs)}. ${r.grade.verdict}.` : 'Задание завершено без выполнения.');
    this.emit('task', { done: true, run: r });
  }
  grade(r) {
    const c = k => r.errors.filter(e => e.kind === k).length;
    const acc = c('accident') + c('kz'), blk = c('blocked'), sup = c('supply'), prc = c('proc'), saf = c('safety');
    const refOps = r.task.steps.filter(x => x.op !== 'check').length;
    const myOps = r.ops.filter(x => x.op !== 'check').length;
    const extra = Math.max(0, myOps - refOps);
    // saf — охрана труда (VR-полигон): СИЗ, плакаты, порядок мероприятий; стоит как нарушение порядка
    let score = 100 - 40 * acc - 10 * blk - 15 * sup - 10 * prc - 10 * saf - 5 * r.hints - 2 * extra;
    if (!r.completed) score = Math.min(score, 40);
    score = clamp(Math.round(score), 0, 100);
    let verdict, tone;
    if (acc) { verdict = 'Не сдано: допущена авария'; tone = 'bad'; }
    else if (!r.completed) { verdict = 'Не выполнено'; tone = 'bad'; }
    else if (blk + sup + prc + saf) { verdict = 'Выполнено с ошибками'; tone = 'mid'; }
    else { verdict = 'Выполнено без ошибок'; tone = 'good'; }
    return { score, verdict, tone, acc, blk, sup, prc, saf, extra, refOps, myOps, hints: r.hints, secs: Math.round(((r.t1 || Date.now()) - r.t0) / 1000) };
  }
  stepText(st) {
    // шаги дополнений (надеть СИЗ, вывесить плакат, запереть привод…)
    const ad = this.addon('stepText', st);
    if (ad) return ad;
    const n = this.nm(st.id), el = this.elOf(st.id), T = el ? TYPES[el.t] : {};
    if (st.op === 'pos') return `перевести тележку ${n} в ${POS_NAME[st.pos]} положение`;
    if (st.op === 'check') return el && !el.pseudo ? `проверить отсутствие напряжения у ${n}` : `проверить отсутствие напряжения на проводе ${this.nodeName(this.stepNode(st.id))}`;
    const v = T.verbs || ['включить', 'отключить'];
    return `${st.op === 'on' ? v[0] : v[1]} ${n}`;
  }
  nextStep() {
    const r = this.run;
    if (!r || r.done) return null;
    for (const st of r.task.steps) {
      const x = this.sim.st[st.id];
      if (st.op === 'check') {
        const n = this.stepNode(st.id), dev = this.byId.get(st.id);
        // проверка перед ЗН не нужна, если ЗН уже включён; на проводе — если в этой точке уже наложено ПЗ
        const done = dev && !dev.pseudo ? !!(x && x.on) : this.pzAt(n);
        if (!done && !this.sim.checked.has(n)) return st;
        continue;
      }
      if (st.op === 'pos') { if (x && x.pos !== st.pos) return st; continue; }
      if (this.isOn(st.id) !== (st.op === 'on')) return st;
    }
    return null;
  }
  // Подсмотреть следующий шаг — то же, что даст hint(), но без счёта подсказок, журнала и событий.
  // Для «Подсказок шагов» в 3D (строка «Следующий шаг», маяк, «Перейти к аппарату»): баллы и правила не меняются
  peek() {
    const r = this.run;
    if (!r || r.done) return null;
    const ad = this.addon('hint', r);
    if (ad) return { step: ad.step, text: ad.text };
    const st = this.nextStep();
    return st ? { step: st, text: this.stepText(st) } : null;
  }
  hint() {
    // в задании с мероприятиями (VR-полигон) подсказка — следующее мероприятие
    const ad = this.run && !this.run.done ? this.addon('hint', this.run) : null;
    if (ad) {
      this.run.hints++;
      const text = 'Подсказка: ' + ad.text + '.';
      this.addLog('info', text, ad.step && ad.step.id);
      this.emit('hint', { step: ad.step, text });
      return { step: ad.step, text };
    }
    const st = this.nextStep();
    if (!st) return null;
    this.run.hints++;
    const text = 'Подсказка: ' + this.stepText(st) + '.';
    this.addLog('info', text, st.id);
    this.emit('hint', { step: st, text });
    return { step: st, text };
  }

  // ---------- запись эталона (режим инструктора) ----------
  snapshot() {
    const o = {}, pos = {};
    for (const id in this.sim.st) { o[id] = this.sim.st[id].on; if (this.sim.st[id].pos) pos[id] = this.sim.st[id].pos; }
    return { st: o, pos };
  }
  startRec() {
    this.run = null;
    this.rec = { init: this.snapshot(), steps: [], errors: 0, powered: new Set(this.state.loads), lost: new Set() };
    this.addLog('info', 'Запись эталона начата: выполните переключения так, как их должен выполнить ученик.');
    this.emit('rec', { start: true });
  }
  saveRec(title, desc) {
    const r = this.rec;
    if (!r) return null;
    const fin = this.snapshot(), target = {}, targetPos = {};
    for (const id in fin.st) if (fin.st[id] !== !!r.init.st[id]) target[id] = fin.st[id];
    for (const id in fin.pos) if (fin.pos[id] !== r.init.pos[id]) targetPos[id] = fin.pos[id];
    if (!Object.keys(target).length && !Object.keys(targetPos).length) return { error: 'В записи нет переключений: положение аппаратов не изменилось.' };
    const task = {
      id: newId(this.s, 'task'), title: title || 'Новое задание', desc: desc || '', init: r.init.st, target, initPos: r.init.pos, targetPos,
      steps: r.steps.slice(), keep: [...r.powered].filter(l => !r.lost.has(l)), requireCheck: r.steps.some(x => x.op === 'check'),
    };
    this.s.tasks.push(task);
    this.rec = null;
    this.addLog('ok', `Задание «${task.title}» сохранено: ${task.steps.length} шагов.`);
    this.emit('rec', { saved: task });
    return task;
  }
  cancelRec() { this.rec = null; this.addLog('info', 'Запись отменена.'); this.emit('rec', { cancel: true }); }
}

export { buildTopo, makeSim, compute, conducts, pzNode, fmtTime, capFirst, Trainer };
