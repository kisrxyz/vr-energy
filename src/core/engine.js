import { G, TYPES, ptKey, clamp, portPoints, fmtKv, isSwitchable, newId } from './elements.js';

/* ===== §3. Движок =====
   Схема → граф: узел = точки, соединённые проводами и шинами; ребро = включённый аппарат или трансформатор.
   Напряжение идёт от включённых источников по включённым аппаратам, через трансформатор — с пересчётом класса.
   Земля идёт от включённых ЗН только по аппаратам (через трансформатор не проходит).

   ПРАВИЛА (их подтверждает преподаватель):
   1. ЗН на участок под напряжением → авария (дуга, КЗ).
   2. Разъединитель на заземлённый участок под напряжением → авария.
   3. Выключатель на заземлённый участок → КЗ, выключатель отключается защитой.
   4. Разъединителем отключён ток нагрузки (потребитель потерял питание) → авария.
   5. Разъединителем включена нагрузка → авария.
      Разъединителем можно отключать и включать ненагруженные шины и трансформаторы.
   6. ЗН без проверки отсутствия напряжения указателем → нарушение порядка (если правило включено).
   7. В задании потребитель из списка «не обесточивать» потерял питание → ошибка «перерыв питания».
   С включёнными блокировками опасные операции 1–5 не выполняются, но считаются попыткой ошибки.
   При КЗ отключаются ближайшие выключатели, через которые КЗ питается; если таких нет — источник. */

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

function makeSim(s, init) {
  const st = {}, src = {};
  for (const el of s.els) {
    if (isSwitchable(el)) st[el.id] = { on: init && el.id in init ? !!init[el.id] : !!el.on, trip: false };
    else if (TYPES[el.t].cls === 'source') src[el.id] = { on: true, trip: false };
  }
  return { st, src, checked: new Set() };
}

// Состояние сети. ov = {id, on} — «что будет, если переключить этот аппарат».
function compute(s, topo, sim, ov) {
  const isOn = id => (ov && ov.id === id) ? ov.on : sim.st[id].on;
  const adj = new Map();
  const link = (a, e) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(e); };
  for (const el of s.els) {
    const T = TYPES[el.t], tm = topo.term.get(el.id);
    if (T.cls === 'switch') {
      if (isOn(el.id) && tm[0] !== tm[1]) {
        const br = T.sw === 'breaker';
        link(tm[0], { to: tm[1], id: el.id, k: 'sw', br });
        link(tm[1], { to: tm[0], id: el.id, k: 'sw', br });
      }
    } else if (T.cls === 'transformer' && tm[0] !== tm[1]) {
      link(tm[0], { to: tm[1], id: el.id, k: 'tr', kv: +el.p.kv2 });
      link(tm[1], { to: tm[0], id: el.id, k: 'tr', kv: +el.p.kv1 });
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
  for (const el of s.els) if (el.t === 'earth' && isOn(el.id)) { const n = topo.term.get(el.id)[0]; if (!Gd.has(n)) { Gd.add(n); gq.push(n); } }
  for (let i = 0; i < gq.length; i++) for (const e of adj.get(gq[i]) || []) { if (e.k !== 'sw' || Gd.has(e.to)) continue; Gd.add(e.to); gq.push(e.to); }
  const loads = new Set();
  for (const el of s.els) if (TYPES[el.t].cls === 'load' && V.has(topo.term.get(el.id)[0])) loads.add(el.id);
  return { V, G: Gd, loads, adj, src, srcNodes };
}

const fmtTime = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);

class Trainer {
  constructor() {
    this.ls = new Set();
    this.opt = { interlocks: true, requireCheck: true };
    this.log = []; this.run = null; this.rec = null;
  }
  on(fn) { this.ls.add(fn); return () => this.ls.delete(fn); }
  emit(type, data = {}) { for (const fn of this.ls) { try { fn(type, data); } catch (e) { console.error(e); } } }

  load(s) {
    this.s = s;
    this.topo = buildTopo(s);
    this.byId = new Map(s.els.map(e => [e.id, e]));
    this.run = null; this.rec = null;
    this.reset();
  }
  reset(init) {
    this.sim = makeSim(this.s, init);
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
  nm(id) { const e = this.byId.get(id); return e ? e.name : '?'; }
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
  note(kind, text, id) {
    if (this.run && !this.run.done) this.run.errors.push({ kind, text, id, t: Math.round(this.elapsed()) });
    if (this.rec) this.rec.errors++;
  }
  record(step) {
    if (this.rec) this.rec.steps.push(step);
    if (this.run && !this.run.done) this.run.ops.push(Object.assign({ t: Math.round(this.elapsed()) }, step));
  }
  hasAlarms() {
    return Object.values(this.sim.st).some(x => x.trip) || Object.values(this.sim.src).some(x => x.trip);
  }

  // ---------- анализ операции: что будет, если переключить ----------
  analyze(el, next) {
    const T = TYPES[el.t], tm = this.topo.term.get(el.id);
    const before = this.state;
    const after = compute(this.s, this.topo, this.sim, { id: el.id, on: next });
    const conflict = [...after.V.keys()].filter(n => after.G.has(n));
    if (conflict.length) {
      const earths = this.earthsNear(after, conflict, el.id, next);
      const en = this.names(earths) || 'заземление';
      // место КЗ — включённые ножи на участке, где встретились напряжение и земля
      const fn = [...new Set(earths.map(i => this.topo.term.get(i)[0]))];
      const faultNodes = fn.length ? fn : conflict;
      if (T.cls === 'earth') {
        const kv = before.V.get(tm[0]);
        return {
          viol: { kind: 'accident', text: `Авария: ${el.name} включён на участок под напряжением${kv != null ? ' ' + fmtKv(kv) : ''}. Дуга, короткое замыкание.`,
                  block: `Блокировка: ${el.name} не включается — на участке есть напряжение${kv != null ? ' ' + fmtKv(kv) : ''}. Отключите выключатель и разъединители, проверьте отсутствие напряжения.` },
          faultNodes };
      }
      if (T.sw === 'disconnector') {
        return {
          viol: { kind: 'accident', text: `Авария: разъединитель ${el.name} включён на заземлённый участок (${en}). Дуга, короткое замыкание.`,
                  block: `Блокировка: ${el.name} не включается — участок заземлён (${en}). Сначала отключите заземляющие ножи.` },
          faultNodes };
      }
      return {
        viol: { kind: 'kz', text: `КЗ: ${el.name} включён на заземлённый участок (${en}).`,
                block: `Блокировка: ${el.name} не включается — в зоне включения заземление (${en}).` },
        faultNodes };
    }
    if (T.sw === 'disconnector') {
      if (!next) {
        const lost = [...before.loads].filter(l => !after.loads.has(l));
        if (lost.length) {
          const q = this.seriesBreaker(el.id, before);
          const side = tm.filter(n => before.V.has(n) && after.V.has(n));
          return {
            viol: { kind: 'accident', text: `Авария: разъединителем ${el.name} разорван ток нагрузки (${this.names(lost)}). Электрическая дуга.`,
                    block: `Блокировка: ${el.name} под нагрузкой. ${q ? 'Сначала отключите выключатель ' + this.nm(q) + '.' : 'Сначала снимите нагрузку выключателем.'}` },
            faultNodes: side.length ? side : [tm[0]] };
        }
      } else {
        const gained = [...after.loads].filter(l => !before.loads.has(l));
        if (gained.length) {
          const q = this.seriesBreaker(el.id, before);
          const side = tm.filter(n => before.V.has(n));
          return {
            viol: { kind: 'accident', text: `Авария: разъединителем ${el.name} включена нагрузка (${this.names(gained)}). Электрическая дуга.`,
                    block: `Блокировка: нагрузку разъединителем не включают. ${q ? 'Отключите ' + this.nm(q) + ', включите разъединитель, затем выключатель.' : 'Включайте нагрузку выключателем.'}` },
            faultNodes: side.length ? side : [tm[0]] };
        }
      }
    }
    if (T.cls === 'earth' && next && this.needCheck() && !this.sim.checked.has(tm[0])) {
      return { viol: { kind: 'proc', text: `Нарушение порядка: ${el.name} включён без проверки отсутствия напряжения указателем.` }, faultNodes: [] };
    }
    return { viol: null, faultNodes: [] };
  }

  // Включённые ЗН, которые заземляют участок с конфликтом
  earthsNear(st, nodes, opId, opOn) {
    const seen = new Set(nodes), q = [...nodes], out = [];
    for (let i = 0; i < q.length; i++) for (const e of st.adj.get(q[i]) || []) if (e.k === 'sw' && !seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    for (const n of seen) for (const id of this.topo.nodeEls.get(n) || []) {
      const e = this.byId.get(id);
      if (e.t !== 'earth') continue;
      const on = id === opId ? opOn : this.sim.st[id].on;
      if (on && !out.includes(id)) out.push(id);
    }
    return out;
  }

  // Выключатель того же присоединения (без выхода на шины)
  seriesBreaker(id, st) {
    const start = this.topo.term.get(id).filter(n => !this.topo.busNodes.has(n));
    const seen = new Set(start), q = start.map(n => [n, 0]);
    for (let i = 0; i < q.length; i++) {
      const [n, d] = q[i];
      if (d > 8) continue;
      for (const e of st.adj.get(n) || []) {
        if (e.id === id || e.k !== 'sw') continue;
        if (e.br) return e.id;
        if (!seen.has(e.to) && !this.topo.busNodes.has(e.to)) { seen.add(e.to); q.push([e.to, d + 1]); }
      }
    }
    return null;
  }

  // Отключение КЗ: зона КЗ — всё, что связано с местом КЗ без выключателей;
  // отключаются выключатели на границе зоны, через которые она питается.
  clearFault(F) {
    const st = compute(this.s, this.topo, this.sim);
    const zone = new Set(F), q = [...F];
    for (let i = 0; i < q.length; i++) for (const e of st.adj.get(q[i]) || []) {
      if (e.k === 'sw' && e.br) continue;
      if (!zone.has(e.to)) { zone.add(e.to); q.push(e.to); }
    }
    const tripped = [];
    for (const el of this.s.els) {
      if (TYPES[el.t].sw !== 'breaker' || !this.sim.st[el.id].on) continue;
      const [a, b] = this.topo.term.get(el.id), ia = zone.has(a), ib = zone.has(b);
      if (ia === ib) continue;
      if (this.fedFrom(st, ia ? b : a, zone, el.id)) { this.sim.st[el.id].on = false; this.sim.st[el.id].trip = true; tripped.push(el.id); }
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
    const e = this.byId.get(id);
    return TYPES[e.t].cls === 'source' ? `отключение со стороны «${e.name}»` : `отключился ${e.name}`;
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
  operate(id) {
    const el = this.byId.get(id);
    if (!el || !isSwitchable(el)) return null;
    const next = !this.sim.st[id].on;
    const a = this.analyze(el, next);
    const severe = !!a.viol && (a.viol.kind === 'accident' || a.viol.kind === 'kz');
    if (severe && this.opt.interlocks) {
      this.addLog('warn', a.viol.block, id);
      this.note('blocked', a.viol.block, id);
      this.emit('op', { id, blocked: true, text: a.viol.block });
      return { blocked: true, text: a.viol.block };
    }
    const before = this.state;
    this.sim.st[id].on = next;
    this.sim.st[id].trip = false;
    this.addLog('info', `${next ? 'Включён' : 'Отключён'} ${el.name}.`, id);
    this.record({ op: next ? 'on' : 'off', id });
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
    const res = { ok: true, id, on: next, viol: a.viol, tripped, text: a.viol ? a.viol.text : null };
    if (severe) this.emit('fx', { kind: a.viol.kind, id, tripped });
    this.emit('op', res);
    this.emit('state', {});
    this.checkDone();
    return res;
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

  // Квитирование: снять мигание отключившихся аппаратов, вернуть питание от системы (АПВ на том конце)
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
    const ids = this.topo.nodeEls.get(n) || [];
    const by = t => ids.find(i => this.byId.get(i).t === t);
    return by('earth') || by('bus') || ids[0] || null;
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
      const place = el ? el.name : (this.placeOf(res[0].n) ? this.nm(this.placeOf(res[0].n)) : 'провод');
      text = `Указатель напряжения у ${place}: ${say(res[0])}.`;
    } else {
      text = `Указатель напряжения на ${el.name}: ` + res.map((r, i) => { const p = this.placeOf(r.n); return `сторона ${i + 1}${p && p !== el.id ? ' (' + this.nm(p) + ')' : ''} — ${say(r)}`; }).join('; ') + '.';
    }
    this.addLog(res.some(r => r.kv != null) ? 'warn' : 'ok', text, target);
    const sid = el ? target : this.placeOf(nodes[0]);
    if (sid) this.record({ op: 'check', id: sid });
    this.emit('check', { target, res, text, live: res.some(r => r.kv != null) });
    this.emit('state', {});
    return { res, text };
  }

  // ---------- задания ----------
  startTask(task) {
    this.rec = null;
    this.run = null;
    this.sim = makeSim(this.s, task.init);
    this.state = compute(this.s, this.topo, this.sim);
    this.log = [];
    this.run = { task, t0: Date.now(), ops: [], errors: [], hints: 0, done: false };
    this.addLog('info', `Задание начато: ${task.title}.`);
    this.emit('task', { start: true });
    this.emit('state', { reset: true });
  }
  stopTask() { if (this.run && !this.run.done) this.finish(false); }
  exitTask() { this.run = null; this.emit('task', { exit: true }); }
  checkDone() {
    const r = this.run;
    if (!r || r.done) return;
    const ok = Object.entries(r.task.target).every(([id, on]) => this.sim.st[id] && this.sim.st[id].on === on);
    if (ok && !Object.values(this.sim.src).some(x => x.trip)) this.finish(true);
  }
  finish(completed) {
    const r = this.run;
    r.done = true; r.completed = completed; r.t1 = Date.now();
    r.grade = this.grade(r);
    this.addLog(completed ? 'ok' : 'warn', completed ? `Задание выполнено за ${fmtTime(r.grade.secs)}. ${r.grade.verdict}.` : 'Задание завершено без выполнения.');
    this.emit('task', { done: true, run: r });
  }
  grade(r) {
    const c = k => r.errors.filter(e => e.kind === k).length;
    const acc = c('accident') + c('kz'), blk = c('blocked'), sup = c('supply'), prc = c('proc');
    const refOps = r.task.steps.filter(x => x.op !== 'check').length;
    const myOps = r.ops.filter(x => x.op !== 'check').length;
    const extra = Math.max(0, myOps - refOps);
    let score = 100 - 40 * acc - 10 * blk - 15 * sup - 10 * prc - 5 * r.hints - 2 * extra;
    if (!r.completed) score = Math.min(score, 40);
    score = clamp(Math.round(score), 0, 100);
    let verdict, tone;
    if (acc) { verdict = 'Не сдано: допущена авария'; tone = 'bad'; }
    else if (!r.completed) { verdict = 'Не выполнено'; tone = 'bad'; }
    else if (blk + sup + prc) { verdict = 'Выполнено с ошибками'; tone = 'mid'; }
    else { verdict = 'Выполнено без ошибок'; tone = 'good'; }
    return { score, verdict, tone, acc, blk, sup, prc, extra, refOps, myOps, hints: r.hints, secs: Math.round(((r.t1 || Date.now()) - r.t0) / 1000) };
  }
  stepText(st) {
    const n = this.nm(st.id);
    return st.op === 'on' ? `включить ${n}` : st.op === 'off' ? `отключить ${n}` : `проверить отсутствие напряжения у ${n}`;
  }
  nextStep() {
    const r = this.run;
    if (!r || r.done) return null;
    for (const st of r.task.steps) {
      if (st.op === 'check') {
        const n = this.topo.term.get(st.id)[0];
        const earthOn = this.sim.st[st.id] && this.sim.st[st.id].on;
        if (!earthOn && !this.sim.checked.has(n)) return st;
        continue;
      }
      if (this.sim.st[st.id] && this.sim.st[st.id].on !== (st.op === 'on')) return st;
    }
    return null;
  }
  hint() {
    const st = this.nextStep();
    if (!st) return null;
    this.run.hints++;
    const text = 'Подсказка: ' + this.stepText(st) + '.';
    this.addLog('info', text, st.id);
    this.emit('hint', { step: st, text });
    return { step: st, text };
  }

  // ---------- запись эталона (режим инструктора) ----------
  snapshot() { const o = {}; for (const id in this.sim.st) o[id] = this.sim.st[id].on; return o; }
  startRec() {
    this.run = null;
    this.rec = { init: this.snapshot(), steps: [], errors: 0, powered: new Set(this.state.loads), lost: new Set() };
    this.addLog('info', 'Запись эталона начата: выполните переключения так, как их должен выполнить ученик.');
    this.emit('rec', { start: true });
  }
  saveRec(title, desc) {
    const r = this.rec;
    if (!r) return null;
    const fin = this.snapshot(), target = {};
    for (const id in fin) if (fin[id] !== r.init[id]) target[id] = fin[id];
    if (!Object.keys(target).length) return { error: 'В записи нет переключений: положение аппаратов не изменилось.' };
    const task = {
      id: newId(this.s, 'task'), title: title || 'Новое задание', desc: desc || '', init: r.init, target,
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

export { buildTopo, makeSim, compute, fmtTime, capFirst, Trainer };
