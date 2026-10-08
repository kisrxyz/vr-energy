import { TYPES, POS, POS_NAME, isPzId } from './elements.js';
import { WHY, EARLY, MISPLACED } from './explain.js';

/* ===== VR-полигон «Допуск к работе»: предметы, места и технические мероприятия =====
   Дополнение к движку: tr.use(new Permit()). Работает, когда у схемы есть помещение s.room (ячейки КРУ в ряд).
   Правила движка не меняет — добавляет свои (тексты «почему опасно» — explain.js, их проверяет преподаватель):
   • операции с аппаратами и проверка указателем без диэлектрических перчаток и каски — нарушение;
   • замок на приводе ячейки механически не даёт переключать её тележку и выключатель;
   • включение выключателя или вкатывание тележки под плакатом «Не включать! Работают люди» — нарушение;
   • в задании с мероприятиями (task.measures) важен порядок этапов (stage): мероприятие раньше предыдущих этапов —
     ошибка «нарушен порядок», заземление без проверки указателем — ошибка, не сделанное к концу — «пропущено»;
     плакат, замок или ограждение не у места работ (task.workCell) — ошибка. Задание выполнено, когда сделаны все мероприятия.
   Без DOM: здесь предмет только «где логически» — надет, висит на месте или свободен.
   Где он физически (стенд, рука, пол) — забота 3D (src/view3d/items.js).

   Места (mount): drive:N — привод (ключ управления) ячейки N, door:N — дверь ячейки, earth:N — привод ЗН,
   cart:N — выкаченная тележка, shutter:N — шторка шинных контактов в отсеке тележки, contact:N:lo — нижние (линейные)
   разъёмные контакты, contact:N:up — верхние (шинные, закрыты шторкой), zone:N — пол перед ячейкой (ограждение),
   fence — на поставленном ограждении, tester — проверочное устройство на стенде (самопроверка указателя).
   Отсек тележки открыт только в ремонтном положении.
   Самопроверка указателя (как по ПТБ — непосредственно перед применением): коснуться проверочного устройства —
   «указатель исправен»; годна, пока указатель не вернули на стенд (untest). Проверка без самопроверки засчитывается,
   но с замечанием (run.remarks — баллы не снижает; нужна ли ошибка — вопрос преподавателю).
   Мероприятие задания: { k, stage, id?, wire?, pos?, poster?, at?: [места], title? },
   k: ppe — СИЗ надеты; off — аппарат id отключён; rack — тележка id в положении pos; sign — плакат poster на одном из мест at;
      lock — замок на месте at; check — проверено отсутствие напряжения в узле провода wire; earth — включён ЗН id
      или наложено ПЗ в узле wire; fence — ограждение на месте at. */

const POSTERS = {
  nevkl: { title: 'Не включать! Работают люди', type: 'запрещающий' },
  zazem: { title: 'Заземлено', type: 'указательный' },
  stop: { title: 'Стой! Напряжение', type: 'предупреждающий' },
  work: { title: 'Работать здесь', type: 'предписывающий' },
};
// Предметы на стенде у входа
const ITEMS = [
  { id: 'gloves', kind: 'gloves', title: 'Диэлектрические перчатки' },
  { id: 'helmet', kind: 'helmet', title: 'Каска' },
  { id: 'uvn', kind: 'uvn', title: 'Указатель напряжения УВН-10' },
  { id: 'pz', kind: 'pz', title: 'Переносное заземление ПЗ-10' },
  { id: 'lock', kind: 'lock', title: 'Замок с ключом' },
  { id: 'fence', kind: 'fence', title: 'Переносное ограждение' },
  { id: 'nevkl1', kind: 'poster', poster: 'nevkl' }, { id: 'nevkl2', kind: 'poster', poster: 'nevkl' },
  { id: 'zazem1', kind: 'poster', poster: 'zazem' },
  { id: 'stop1', kind: 'poster', poster: 'stop' }, { id: 'stop2', kind: 'poster', poster: 'stop' },
  { id: 'work1', kind: 'poster', poster: 'work' },
];
for (const i of ITEMS) if (i.poster) i.title = `Плакат «${POSTERS[i.poster].title}»`;
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
// Что физически вешают или ставят на место
const TAKES = { drive: ['poster', 'lock'], door: ['poster'], earth: ['poster'], cart: ['poster'], shutter: ['poster'], fence: ['poster'], contact: ['pz', 'uvn'], zone: ['fence'], tester: ['uvn'] };
const MAX_POSTERS = 3;
// Свободный режим: предупреждение «без СИЗ» (тост, баннер, звук) — не чаще раза в QUIET мс; в журнал — каждый раз
const QUIET = 15000;
// После чего мероприятие идёт «по смыслу»: если пропущено именно это — объяснение EARLY (почему рано),
// иначе — WHY пропущенного (почему его нельзя пропускать)
const AFTER = {
  sign_nevkl: ['off', 'rack'], lock: ['off', 'rack'], check: ['off', 'rack', 'sign_nevkl', 'lock'],
  earth: ['off', 'rack', 'sign_nevkl', 'lock', 'check'], sign_zazem: ['earth'], sign_work: ['earth', 'check'], fence: ['earth'], sign_stop: ['earth'],
};

function parseMount(id) {
  if (id === 'fence' || id === 'tester') return { type: id, n: null, side: null };
  const m = /^(drive|door|earth|cart|shutter|zone|contact):(\d+)(?::(up|lo))?$/.exec(String(id || ''));
  if (!m || (m[1] === 'contact') !== !!m[3]) return null;
  return { type: m[1], n: +m[2], side: m[3] || null };
}
// Место словами: куда (0), где (1), откуда (2), что это (3)
const PLACE = {
  drive: n => [`на привод яч.${n}`, `на приводе яч.${n}`, `с привода яч.${n}`, `Привод яч.${n}`],
  door: n => [`на дверь яч.${n}`, `на двери яч.${n}`, `с двери яч.${n}`, `Дверь яч.${n}`],
  earth: n => [`на привод ЗН яч.${n}`, `на приводе ЗН яч.${n}`, `с привода ЗН яч.${n}`, `Привод ЗН яч.${n}`],
  cart: n => [`на тележку яч.${n}`, `на тележке яч.${n}`, `с тележки яч.${n}`, `Тележка яч.${n}`],
  shutter: n => [`на шторку шин яч.${n}`, `на шторке шин яч.${n}`, `со шторки шин яч.${n}`, `Шторка шин яч.${n}`],
  zone: n => [`у яч.${n}`, `у яч.${n}`, `у яч.${n}`, `Место работ у яч.${n}`],
  fence: () => ['на ограждение', 'на ограждении', 'с ограждения', 'Ограждение'],
  tester: () => ['на проверочное устройство', 'на проверочном устройстве', 'с проверочного устройства', 'Проверочное устройство указателя'],
  contact: (n, side) => side === 'up' ? [`на верхние контакты яч.${n}`, `на верхних контактах яч.${n}`, `с верхних контактов яч.${n}`, `Верхние (шинные) контакты яч.${n}`]
                                      : [`на нижние контакты яч.${n}`, `на нижних контактах яч.${n}`, `с нижних контактов яч.${n}`, `Нижние (линейные) контакты яч.${n}`],
};
function placeText(mount, form = 0) { const m = parseMount(mount); return m ? PLACE[m.type](m.n, m.side)[form] : ''; }
const lowFirst = t => t.charAt(0).toLowerCase() + t.slice(1);
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);

class Permit {
  constructor() {
    this.tr = null; this.room = null; this.guide = true; this.pending = null;
    this.now = () => Date.now();   // часы: тест подменяет
    this.clear();
  }
  attach(tr) { this.tr = tr; this.setup(); }
  get active() { return !!this.room; }
  // Помещение текущей схемы
  setup() {
    const s = this.tr && this.tr.s, r = s && s.room;
    this.room = r && Array.isArray(r.cells) && r.cells.length ? r : null;
    this.clear();
  }
  clear() {
    this.at = new Map(ITEMS.filter(i => i.kind !== 'pz').map(i => [i.id, null]));   // null — свободен; 'worn' — надет; иначе место
    this.doneAt = new Map(); this.flagged = new Set(); this.miss = new Set(); this.ppeWarnAt = -Infinity;
    // самопроверка указателя и замечания задания (не ошибки)
    this.tested = false; this.remarks = []; this.remarkAt = -Infinity;
  }
  cell(n) { return this.room ? this.room.cells.find(c => c.n === n) || null : null; }
  cellByCart(id) { return this.room ? this.room.cells.find(c => c.cart === id) || null : null; }
  // Место контактов по проводу: 'contact:3:lo'
  contactMount(wire) {
    if (!this.room || !wire) return null;
    for (const c of this.room.cells) { if (c.lo === wire) return `contact:${c.n}:lo`; if (c.up === wire) return `contact:${c.n}:up`; }
    return null;
  }
  // Мероприятия идущего задания (или null — свободный режим, обычная схема)
  measures() {
    const r = this.tr && this.tr.run;
    return this.active && r && !r.done && Array.isArray(r.task.measures) && r.task.measures.length ? r.task.measures : null;
  }

  // ---------- где предметы ----------
  pzMount() {
    if (!this.room) return null;
    for (const k of this.tr.pzOn()) { const m = this.contactMount(k.slice(3)); if (m) return m; }
    return null;
  }
  itemAt(id) { return id === 'pz' ? this.pzMount() : (this.at.get(id) || null); }
  onMount(mount) {
    const out = [...this.at].filter(([, a]) => a === mount).map(([k]) => k);
    if (this.pzMount() === mount) out.push('pz');
    return out;
  }
  has(pred, at) {
    if (!at) return false;
    for (const [id, a] of this.at) if (a && at.includes(a) && pred(ITEM[id])) return true;
    return false;
  }
  ppeOn() { return this.at.get('gloves') === 'worn' && this.at.get('helmet') === 'worn'; }
  ppeMissing() {
    const g = this.at.get('gloves') !== 'worn', h = this.at.get('helmet') !== 'worn';
    return g && h ? 'нет перчаток и каски' : g ? 'нет диэлектрических перчаток' : 'нет каски';
  }
  posterAt(n, poster) { return this.has(it => it.poster === poster, [`drive:${n}`, `door:${n}`]); }

  // Можно ли сейчас что-то повесить или поставить на место
  mountState(mount) {
    const m = parseMount(mount);
    if (!m || !this.active) return { ok: false, text: 'Сюда ничего не вешают.' };
    if (m.type === 'tester') return { ok: true, m };
    if (m.type === 'fence') {
      const f = this.at.get('fence');
      return f && f.startsWith('zone:') ? { ok: true, m } : { ok: false, text: 'Ограждение ещё не поставлено.' };
    }
    const c = this.cell(m.n);
    if (!c) return { ok: false, text: `Ячейки №${m.n} нет.` };
    if (m.type === 'earth' && !c.earth) return { ok: false, text: `В ячейке №${m.n} нет ЗН.` };
    if (m.type === 'contact' || m.type === 'shutter' || m.type === 'cart') {
      const x = this.tr.sim.st[c.cart];
      if (!x || x.pos !== 'repair') return { ok: false, text: m.type === 'cart' ? `Тележка яч.${m.n} не выкачена.` : `Отсек тележки яч.${m.n} закрыт: тележка не выкачена в ремонтное положение.` };
      if (m.type === 'contact' && m.side === 'up') return { ok: false, text: `Верхние (шинные) контакты яч.${m.n} закрыты шторкой: за ней шины под напряжением.` };
      if (m.type === 'contact' && !c.lo) return { ok: false, text: 'Контактов нет.' };
    }
    return { ok: true, m, c };
  }
  // Места, куда предмет можно повесить или поставить сейчас (для подсветки в 3D)
  mountsFor(id) {
    const it = ITEM[id];
    if (!it || !this.room) return [];
    const out = [];
    const add = mt => { const s = this.mountState(mt); if (s.ok && (TAKES[s.m.type] || []).includes(it.kind)) out.push(mt); };
    for (const c of this.room.cells) for (const t of ['drive', 'door', 'earth', 'cart', 'shutter', 'zone']) add(`${t}:${c.n}`);
    for (const c of this.room.cells) add(`contact:${c.n}:lo`);
    add('fence'); add('tester');
    return out;
  }

  // Подсказка в 3D (только с «Подсказками мероприятий»): куда предмет id по ближайшему этапу — места, где его можно поставить сейчас.
  // [] — подсказок нет, свободный режим, или предмет не для ближайших мероприятий. Ничего не меняет и не считается подсказкой
  nextMounts(id) {
    const ms = this.measures(), it = ITEM[id];
    if (!ms || !it || !this.guide) return [];
    const open = ms.filter(m => !this.sat(m));
    if (!open.length) return [];
    const stage = Math.min(...open.map(m => m.stage));
    const fits = m => m.k === 'sign' ? it.kind === 'poster' && it.poster === m.poster : m.k === 'lock' ? it.kind === 'lock' : m.k === 'fence' ? it.kind === 'fence'
      : m.k === 'check' ? it.kind === 'uvn' : m.k === 'earth' ? it.kind === 'pz' && !!m.wire : false;
    const m = open.find(q => q.stage === stage && fits(q));
    if (!m) return [];
    // проверка: сначала самопроверка указателя на проверочном устройстве
    const at = m.k === 'check' && !this.tested ? ['tester'] : m.k === 'check' || m.k === 'earth' ? [this.contactMount(m.wire)] : m.at || [];
    return at.filter(a => a && this.mountState(a).ok);
  }

  // ---------- действия с предметами (их вызывает 3D) ----------
  wear(id) {
    const it = ITEM[id];
    if (!it || (it.kind !== 'gloves' && it.kind !== 'helmet')) return { err: true, text: 'Это не надевают.' };
    if (!this.active) return { err: true, text: 'Предметы — только в VR-полигоне.' };
    if (this.at.get(id) === 'worn') return { ok: true, text: '' };
    this.at.set(id, 'worn');
    const text = it.kind === 'gloves' ? 'Надеты диэлектрические перчатки.' : 'Надета каска.';
    this.tr.addLog('ok', text);
    this.tr.record({ op: 'wear', item: id });
    this.changed();
    return { ok: true, text };
  }
  place(id, mount) {
    const it = ITEM[id];
    if (!it || !this.active) return { err: true, text: 'Здесь это не применить.' };
    const ms = this.mountState(mount);
    if (!ms.ok) return { err: true, text: ms.text };
    if (!(TAKES[ms.m.type] || []).includes(it.kind)) return { err: true, text: `${it.title} — не сюда.` };
    if (it.kind === 'uvn') return this.touch(mount);
    if (it.kind === 'pz') return this.applyPz(mount, ms);
    const cur = this.at.get(id);
    if (cur === mount) return { ok: true, text: '' };
    if (cur === 'worn') return { err: true, text: 'Это надето.' };
    if (it.kind === 'poster' && this.onMount(mount).filter(k => ITEM[k].kind === 'poster').length >= MAX_POSTERS) return { err: true, text: 'Здесь уже нет места для плаката.' };
    if (cur) this.take(id, true);
    this.at.set(id, mount);
    const tr = this.tr;
    let text;
    if (it.kind === 'poster') { text = `Вывешен плакат «${POSTERS[it.poster].title}» ${placeText(mount)}.`; tr.record({ op: 'hang', poster: it.poster, at: mount }); }
    else if (it.kind === 'lock') { text = `${capFirst(placeText(mount).replace(/^на /, ''))} заперт на замок.`; tr.record({ op: 'lock', at: mount }); }
    else { text = `Поставлено ограждение ${placeText(mount)}.`; tr.record({ op: 'fence', at: mount }); }
    tr.addLog('info', text);
    this.checkPlace(id, mount);
    this.changed();
    return { ok: true, text };
  }
  // Снять с места (плакат, замок, ограждение, ПЗ). moving — перевешивают: оценка после нового места
  take(id, moving) {
    const it = ITEM[id];
    if (!it || !this.active) return { err: true, text: '' };
    if (it.kind === 'pz') { const mt = this.pzMount(); return mt ? this.removePz(mt) : { ok: true, text: '' }; }
    const cur = this.at.get(id);
    if (!cur) return { ok: true, text: '' };
    if (cur === 'worn') return { err: true, text: 'СИЗ снимают после окончания работ.' };
    this.at.set(id, null);
    const tr = this.tr;
    let text;
    if (it.kind === 'poster') { text = `Снят плакат «${POSTERS[it.poster].title}» ${placeText(cur, 2)}.`; tr.record({ op: 'unhang', poster: it.poster, at: cur }); }
    else if (it.kind === 'lock') { text = `Снят замок ${placeText(cur, 2)}.`; tr.record({ op: 'unlock', at: cur }); }
    else {
      text = `Убрано ограждение ${placeText(cur)}.`; tr.record({ op: 'unfence', at: cur });
      // плакаты с ограждения снимают вместе с ним
      for (const [k, a] of this.at) if (a === 'fence') { this.at.set(k, null); tr.record({ op: 'unhang', poster: ITEM[k].poster, at: 'fence' }); }
    }
    tr.addLog('info', text);
    if (!moving) this.changed();
    return { ok: true, text, from: cur };
  }
  // Указатель напряжения коснулся контактов: проверка идёт в движок; проверочного устройства — самопроверка
  touch(mount) {
    const ms = this.mountState(mount);
    if (!ms.ok) return { err: true, text: ms.text };
    if (ms.m.type === 'tester') return this.selfTest();
    if (ms.m.type !== 'contact') return { err: true, text: 'Указателем касаются токоведущих частей.' };
    return this.tr.check(ms.m.side === 'up' ? ms.c.up : ms.c.lo);
  }
  // Самопроверка: огонёк и звук на проверочном устройстве — указатель исправен. Не операция и не мероприятие
  selfTest() {
    this.tested = true;
    const text = 'Указатель исправен: на проверочном устройстве огонёк горит и звук есть.';
    this.tr.addLog('ok', text);
    this.tr.emit('field', { test: true });
    return { ok: true, test: true, text };
  }
  // Указатель вернули на стенд: перед следующей проверкой — снова самопроверка
  untest() { this.tested = false; }
  applyPz(mount, ms) {
    const wire = ms.m.side === 'up' ? ms.c.up : ms.c.lo, cur = this.pzMount();
    if (cur === mount) return { ok: true, text: '' };
    if (cur) return { err: true, text: `Переносное заземление одно: сначала снимите его ${placeText(cur, 2)}.` };
    const n = this.tr.topo.wireNode.get(wire);
    if (n != null && this.tr.pzAt(n)) return { err: true, text: 'Здесь уже наложено переносное заземление.' };
    const r = this.tr.pzToggle(wire);
    if (!r) return { err: true, text: 'Сюда ПЗ не накладывается.' };
    if (r.blocked) return { blocked: true, text: r.text };
    this.changed();
    return r;
  }
  removePz(mount) {
    const m = parseMount(mount), c = m && this.cell(m.n);
    if (!c) return { err: true, text: '' };
    const r = this.tr.pzToggle(m.side === 'up' ? c.up : c.lo);
    this.changed();
    return r || { ok: true, text: '' };
  }
  toggleGuide() { this.guide = !this.guide; this.tr.emit('field', {}); return this.guide; }

  // ---------- правила (дополнение движка) ----------
  event(type, d) {
    const tr = this.tr;
    if (type === 'task') { if (d.start) { this.setup(); this.changed(false); } return; }
    if (type === 'state') {
      if (d.reset) { if (!(tr.run && !tr.run.done)) { this.setup(); this.changed(false); } return; }
      this.evaluate();
      return;
    }
    if (!this.active) return;
    if (type === 'op' && d.ok) this.afterOp(d);
    else if (type === 'check') this.afterCheck(d);
  }
  // Замок на приводе — механическая блокировка: тележку и выключатель ячейки не переключить
  guard(el) {
    if (!this.active) return null;
    this.pending = { id: el.id, before: Object.assign({}, this.tr.sim.st[el.id] || {}) };
    const c = this.cellByCart(el.id);
    if (!c || !this.onMount(`drive:${c.n}`).includes('lock')) return null;
    return { text: `Привод яч.${c.n} заперт на замок: тележку и выключатель не переключить. Замок снимают после окончания работ.`, why: WHY.lockBlock };
  }
  afterOp(d) {
    const tr = this.tr, el = tr.elOf(d.id), prev = this.pending && this.pending.id === d.id ? this.pending.before : null;
    this.pending = null;
    if (!el) return;
    const T = TYPES[el.t], racked = !!(T.cart && prev && prev.pos && prev.pos !== d.pos);
    const what = racked ? `тележка ${el.name} — в ${POS_NAME[d.pos]} положение` : `${lowFirst((T.did || ['Включён', 'Отключён'])[d.on ? 0 : 1])} ${el.name}`;
    if (!this.ppeOn()) this.violation(`Операция без СИЗ: ${what} — ${this.ppeMissing()}.`, el.id, WHY.ppe);
    // под плакатом «Не включать! Работают люди» — только в сторону отключения
    const c = this.cellByCart(el.id);
    const toward = racked ? POS.indexOf(d.pos) < POS.indexOf(prev.pos) : !!(prev && d.on && !prev.on);
    if (c && toward && this.posterAt(c.n, 'nevkl')) {
      const t = `Операция под плакатом «Не включать! Работают люди»: ${what} (яч.${c.n}).`;
      tr.addLog('err', t, el.id);
      tr.note('safety', t, el.id, { why: WHY.nevklOp });
      this.warn(t);
    }
  }
  afterCheck(d) {
    if (!this.tested) this.remark(d.target);
    if (this.ppeOn()) return;
    this.violation(`Проверка указателем без СИЗ ${this.checkWhere(d.target) || 'у ' + this.tr.nm(d.target)} — ${this.ppeMissing()}.`, d.target, WHY.ppeCheck);
  }
  // Проверка без самопроверки: в журнал каждый раз, в задание — одно замечание (баллы не снижает), показать — сразу
  // (в свободном режиме — не чаще раза в 15 с, как «без СИЗ»)
  remark(target) {
    const tr = this.tr, text = `Замечание: проверка указателем ${this.checkWhere(target) || 'у ' + tr.nm(target)} без самопроверки — исправность указателя не проверена на проверочном устройстве (стенд у входа).`;
    tr.addLog('warn', text, target);
    if (this.measures()) {
      if (this.remarks.length) return;
      this.remarks.push({ text, t: Math.round(tr.elapsed()) });
    } else {
      const t = this.now();
      if (t - this.remarkAt < QUIET) return;
      this.remarkAt = t;
    }
    this.warn(text);
  }
  // Где проверяли указателем — для журнала движка: «на нижних контактах яч.3» (остальное движок называет сам)
  checkWhere(target) {
    const mt = this.contactMount(target);
    return mt ? placeText(mt, 1) : null;
  }
  // Работа без СИЗ: в журнал каждый раз, в задание — одной ошибкой (мероприятие «СИЗ»).
  // Предупреждение (тост, баннер, звук) в задании — каждый раз, в свободном режиме — не чаще раза в 15 с
  violation(text, id, why) {
    const tr = this.tr, ms = this.measures(), i = ms ? ms.findIndex(m => m.k === 'ppe') : -1;
    tr.addLog('warn', text, id);
    if (i >= 0 && !this.flagged.has(i) && !this.doneAt.has(i)) { this.flagged.add(i); tr.note('safety', text, id, { why }); }
    if (!ms) {
      const t = this.now();
      if (t - this.ppeWarnAt < QUIET) return;
      this.ppeWarnAt = t;
    }
    this.warn(text);
  }
  warn(text) { this.tr.emit('field', { warn: text }); }
  changed(full = true) {
    if (full) this.evaluate();
    this.tr.emit('field', {});
    if (full) this.tr.checkDone();
  }

  // ---------- мероприятия задания ----------
  key(m) { return m.k === 'sign' ? 'sign_' + m.poster : m.k; }
  node(wire) { return wire && this.tr.topo ? this.tr.topo.wireNode.get(wire) : null; }
  // Выполнено ли мероприятие сейчас
  sat(m) {
    const tr = this.tr, x = m.id ? tr.sim.st[m.id] : null;
    switch (m.k) {
      case 'ppe': return this.ppeOn();
      case 'off': return !!x && !x.on;
      case 'rack': return !!x && x.pos === m.pos;
      case 'sign': return this.has(it => it.poster === m.poster, m.at);
      case 'lock': return this.has(it => it.kind === 'lock', m.at);
      case 'fence': return this.has(it => it.kind === 'fence', m.at);
      // проверка не нужна, если участок уже заземлён (как у эталонных шагов движка)
      case 'check': { const n = this.node(m.wire); return n != null && (tr.sim.checked.has(n) || tr.state.G.has(n)); }
      case 'earth': { const n = this.node(m.wire); return (!!m.id && tr.isOn(m.id)) || (n != null && tr.pzAt(n)); }
    }
    return false;
  }
  // Сделано ли самим человеком (проверку «закрывает» и заземление, но сделанной она от этого не становится)
  performed(m) {
    if (m.k !== 'check') return this.sat(m);
    const n = this.node(m.wire);
    return n != null && this.tr.sim.checked.has(n);
  }
  // После каждого изменения: что сделано впервые и не раньше ли времени
  evaluate() {
    const ms = this.measures();
    if (!ms) return;
    const tr = this.tr, fresh = [];
    ms.forEach((m, i) => { if (!this.doneAt.has(i) && this.performed(m)) fresh.push(i); });
    fresh.sort((a, b) => ms[a].stage - ms[b].stage);
    let warn = null;
    for (const i of fresh) {
      this.doneAt.set(i, Math.round(tr.elapsed()));
      const m = ms[i], missing = [];
      ms.forEach((q, j) => { if (q.stage < m.stage && !this.doneAt.has(j) && !this.flagged.has(j)) missing.push(j); });
      if (!missing.length) continue;
      // заземление без проверки — отдельная ошибка: после заземления проверку уже не сделать
      const chk = m.k === 'earth' ? missing.find(j => ms[j].k === 'check') : undefined;
      if (chk !== undefined) {
        this.flagged.add(chk);
        const t = `${this.earthText(m)} без проверки отсутствия напряжения указателем.`;
        tr.addLog('err', t, m.id); tr.note('safety', t, m.id, { why: WHY.check });
        warn = warn || t;
        missing.splice(missing.indexOf(chk), 1);
      }
      if (!missing.length || this.flagged.has(i)) continue;
      this.flagged.add(i);
      const nm = j => lowFirst(this.title(ms[j]));
      const names = missing.length === 1 ? nm(missing[0]) : missing.length === 2 ? `${nm(missing[0])} и ${nm(missing[1])}` : `${nm(missing[0])}, ${nm(missing[1])} и ещё ${missing.length - 2}`;
      const t = `Нарушен порядок: ${lowFirst(this.title(m))} — раньше, чем ${names}.`;
      const own = (AFTER[this.key(m)] || []).some(k => missing.some(j => this.key(ms[j]) === k));
      tr.addLog('warn', t, m.id);
      tr.note('safety', t, m.id, { why: (own && EARLY[this.key(m)]) || WHY[this.key(ms[missing[0]])] });
      warn = warn || t;
    }
    if (warn) this.warn(warn);
  }
  earthText(m) {
    if (m.id && this.tr.isOn(m.id)) return `${this.tr.nm(m.id)} включён`;
    return `ПЗ наложено ${placeText(this.contactMount(m.wire))}`;
  }
  // Плакат, замок или ограждение не у места работ — ошибка (один раз на предмет и место)
  checkPlace(id, mount) {
    const ms = this.measures(), run = this.tr.run;
    if (!ms || !run.task.workCell) return;
    const it = ITEM[id], m = parseMount(mount), W = run.task.workCell;
    const accepted = ms.some(q => q.at && q.at.includes(mount) && (it.kind === 'poster' ? q.k === 'sign' && q.poster === it.poster : q.k === it.kind));
    if (accepted || !m) return;
    let bad = null;
    if (it.kind === 'poster') {
      if (it.poster === 'stop') { if (m.n === W && m.type !== 'shutter') bad = MISPLACED.stop; }
      else if (it.poster === 'work') { if (m.type !== 'fence' && m.n !== W) bad = MISPLACED.work; }
      else if (m.n != null && m.n !== W) bad = MISPLACED[it.poster];
    } else if ((it.kind === 'lock' || it.kind === 'fence') && m.n !== W) bad = MISPLACED[it.kind];
    if (!bad || this.miss.has(id + '@' + mount)) return;
    this.miss.add(id + '@' + mount);
    const text = bad.text(m.n);
    this.tr.addLog('err', text);
    this.tr.note('safety', text, null, { why: bad.why });
    this.warn(text);
  }
  title(m) {
    if (m.title) return m.title;
    const tr = this.tr, at = m.at && m.at[0];
    switch (m.k) {
      case 'ppe': return 'Надеть диэлектрические перчатки и каску';
      case 'off': return `Отключить ${tr.nm(m.id)}`;
      case 'rack': return `Выкатить тележку ${tr.nm(m.id)} в ${POS_NAME[m.pos] || ''} положение`;
      case 'sign': return `Вывесить «${(POSTERS[m.poster] || { title: '?' }).title}» ${placeText(at)}`;
      case 'lock': return `Запереть ${placeText(at).replace(/^на /, '')} на замок`;
      case 'check': return `Проверить отсутствие напряжения указателем ${placeText(this.contactMount(m.wire), 1)}`.trim();
      case 'earth': return `Включить ${tr.nm(m.id)} или наложить ПЗ ${placeText(this.contactMount(m.wire))}`.trim();
      case 'fence': return `Оградить место работ ${placeText(at)}`;
    }
    return m.k;
  }
  statusList(ms) {
    return ms.map((m, i) => ({ title: this.title(m), stage: m.stage, sat: this.sat(m), done: this.doneAt.has(i), flagged: this.flagged.has(i) }));
  }
  // Для щита и боковой панели: СИЗ, список мероприятий, следующее
  status() {
    const ms = this.measures(), list = ms ? this.statusList(ms) : [], nx = list.find(m => !m.sat);
    return {
      active: this.active, guide: this.guide,
      ppe: { gloves: this.at.get('gloves') === 'worn', helmet: this.at.get('helmet') === 'worn' },
      measures: list, next: nx ? nx.title : null, n: list.filter(m => m.sat).length, total: list.length,
    };
  }
  done(run) {
    if (!this.active || !Array.isArray(run.task.measures) || !run.task.measures.length) return true;
    return run.task.measures.every(m => this.sat(m));
  }
  finish(run) {
    const ms = this.measures();
    if (!ms) return;
    ms.forEach((m, i) => {
      if (this.sat(m) || this.flagged.has(i)) return;
      this.flagged.add(i);
      this.tr.note('safety', `Пропущено мероприятие: ${lowFirst(this.title(m))}.`, m.id, { why: WHY[this.key(m)] });
    });
    run.measures = this.statusList(ms);
    run.guide = this.guide;
    run.remarks = this.remarks.slice();
  }
  hint() {
    const ms = this.measures();
    if (!ms) return null;
    const i = ms.findIndex(m => !this.sat(m));
    return i < 0 ? null : { step: { op: 'measure', i, id: ms[i].id }, text: 'следующее мероприятие — ' + lowFirst(this.title(ms[i])) };
  }
  stepText(st) {
    if (!st) return null;
    const P = p => (POSTERS[p] ? `«${POSTERS[p].title}»` : 'плакат');
    switch (st.op) {
      case 'wear': return st.item === 'gloves' ? 'надеть диэлектрические перчатки' : st.item === 'helmet' ? 'надеть каску' : null;
      case 'hang': return `вывесить ${P(st.poster)} ${placeText(st.at)}`;
      case 'unhang': return `снять ${P(st.poster)} ${placeText(st.at, 2)}`;
      case 'lock': return `запереть ${placeText(st.at).replace(/^на /, '')} на замок`;
      case 'unlock': return `снять замок ${placeText(st.at, 2)}`;
      case 'fence': return `поставить ограждение ${placeText(st.at)}`;
      case 'unfence': return `убрать ограждение ${placeText(st.at)}`;
      case 'check': { const mt = this.contactMount(st.id); return mt ? `проверить отсутствие напряжения указателем ${placeText(mt, 1)}` : null; }
      case 'on': case 'off': {
        if (!isPzId(st.id)) return null;
        const mt = this.contactMount(st.id.slice(3));
        return mt ? `${st.op === 'on' ? 'наложить ПЗ' : 'снять ПЗ'} ${placeText(mt, st.op === 'on' ? 0 : 2)}` : null;
      }
    }
    return null;
  }
}

export { POSTERS, ITEMS, ITEM, TAKES, parseMount, placeText, Permit };
