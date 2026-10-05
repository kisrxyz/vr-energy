/* ===== §1. Библиотека элементов ===== */
const G = 20;          // пикселей в одной клетке сетки при масштабе 1
const APP_VER = '0.1';

// Типы элементов. ports — точки подключения в клетках относительно центра (до поворота).
// cls: source — источник, bus — шина, switch — коммутационный аппарат, earth — заземляющий нож,
//      transformer — трансформатор, load — потребитель.
const TYPES = {
  source:       { title: 'Энергосистема',   code: 'С',  ports: [[0, 1]],           cls: 'source',      props: { kv: 110 } },
  gen:          { title: 'Генератор',       code: 'G',  ports: [[0, 1]],           cls: 'source',      props: { kv: 10.5, mw: 12 } },
  bus:          { title: 'Шина',            code: 'СШ', ports: null,               cls: 'bus',         props: { len: 8 } },
  breaker:      { title: 'Выключатель',     code: 'Q',  ports: [[0, -1], [0, 1]],  cls: 'switch', sw: 'breaker',      normal: true },
  acb:          { title: 'Автомат 0,4 кВ',  code: 'QF', ports: [[0, -1], [0, 1]],  cls: 'switch', sw: 'breaker',      normal: true },
  disconnector: { title: 'Разъединитель',   code: 'QS', ports: [[0, -1], [0, 1]],  cls: 'switch', sw: 'disconnector', normal: true },
  earth:        { title: 'Заземляющий нож', code: 'ЗН', ports: [[0, -1]],          cls: 'earth',       normal: false },
  transformer:  { title: 'Трансформатор',   code: 'T',  ports: [[0, -2], [0, 2]],  cls: 'transformer', props: { kv1: 110, kv2: 10, mva: 25 } },
  load:         { title: 'Нагрузка',        code: 'Н',  ports: [[0, -1]],          cls: 'load',        props: { kw: 800 } },
  motor:        { title: 'Двигатель',       code: 'M',  ports: [[0, -1]],          cls: 'load',        props: { kw: 250 } },
};
const PALETTE = ['source', 'gen', 'bus', 'breaker', 'acb', 'disconnector', 'earth', 'transformer', 'load', 'motor'];

// Габарит символа в клетках (до поворота): [x0, y0, x1, y1]
const BOX = {
  source: [-0.9, -1.4, 0.9, 1], gen: [-0.9, -1.4, 0.9, 1],
  breaker: [-0.6, -1, 0.6, 1], acb: [-0.55, -1, 0.55, 1], disconnector: [-0.6, -1, 0.7, 1],
  earth: [-0.6, -1, 0.75, 1.25], transformer: [-0.95, -2, 0.95, 2],
  load: [-0.55, -1, 0.55, 0.95], motor: [-0.75, -1, 0.75, 1.25],
};

// Поворот точки на r × 90° по часовой (ось y экрана смотрит вниз)
function rot(p, r) {
  const x = p[0], y = p[1];
  switch (((r % 4) + 4) % 4) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}
const ptKey = p => p[0] + ',' + p[1];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Точки подключения элемента в координатах схемы
function portPoints(el) {
  if (el.t === 'bus') {
    const pts = [];
    for (let i = 0; i <= el.p.len; i++) { const q = rot([i, 0], el.r); pts.push([el.x + q[0], el.y + q[1]]); }
    return pts;
  }
  return TYPES[el.t].ports.map(p => { const q = rot(p, el.r); return [el.x + q[0], el.y + q[1]]; });
}

// Габарит элемента в координатах схемы
function bbox(el) {
  if (el.t === 'bus') {
    const q = rot([el.p.len, 0], el.r), bx = el.x + q[0], by = el.y + q[1];
    return [Math.min(el.x, bx) - 0.3, Math.min(el.y, by) - 0.3, Math.max(el.x, bx) + 0.3, Math.max(el.y, by) + 0.3];
  }
  const [x0, y0, x1, y1] = BOX[el.t];
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(c => rot(c, el.r));
  const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
  return [el.x + Math.min(...xs), el.y + Math.min(...ys), el.x + Math.max(...xs), el.y + Math.max(...ys)];
}

// Класс напряжения → цвет. Цвета условные; сверить с принятыми на предприятии.
function vClass(kv) {
  if (kv >= 200) return 'v220';
  if (kv >= 90) return 'v110';
  if (kv >= 30) return 'v35';
  if (kv >= 8) return 'v10';
  if (kv >= 3) return 'v6';
  if (kv >= 0.2) return 'v04';
  return 'vlow';
}
const V_CLASSES = [['v220', '220 кВ'], ['v110', '110 кВ'], ['v35', '35 кВ'], ['v10', '10 кВ'], ['v6', '6 кВ'], ['v04', '0,4 кВ']];
const fmtNum = n => String(Math.round(n * 1000) / 1000).replace('.', ',');
const fmtKv = kv => fmtNum(kv) + ' кВ';

function isSwitchable(el) { const c = TYPES[el.t].cls; return c === 'switch' || c === 'earth'; }

// ---------- схема: создание, имена, провода ----------
function emptyScheme(title) { return { v: 1, title: title || 'Новая схема', els: [], wires: [], tasks: [], seq: 1 }; }
function cloneScheme(s) { return JSON.parse(JSON.stringify(s)); }
function newId(s, p) { if (!s.seq) s.seq = 1; return p + (s.seq++); }
function nameFor(t, n) { return t === 'bus' ? n + 'СШ' : TYPES[t].code + n; }
function nextName(s, t) {
  const used = new Set(s.els.map(e => e.name));
  for (let n = 1; ; n++) { const nm = nameFor(t, n); if (!used.has(nm)) return nm; }
}
function makeEl(s, t, x, y, o = {}) {
  const T = TYPES[t];
  const el = { id: newId(s, 'e'), t, x, y, r: o.r || 0, name: o.name || nextName(s, t), p: Object.assign({}, T.props || {}, o.p || {}) };
  if (T.cls === 'switch' || T.cls === 'earth') el.on = o.on != null ? !!o.on : T.normal;
  s.els.push(el);
  return el;
}
// vf = сначала по вертикали, потом по горизонтали
function makeWire(s, a, b, vf) {
  const w = { id: newId(s, 'w'), a: [a[0], a[1]], b: [b[0], b[1]], vf: vf !== false };
  s.wires.push(w);
  return w;
}
function wireRoute(w) {
  const [ax, ay] = w.a, [bx, by] = w.b;
  if (ax === bx || ay === by) return [w.a, w.b];
  return w.vf ? [w.a, [ax, by], w.b] : [w.a, [bx, ay], w.b];
}
// Проверка и починка файла схемы
function normalizeScheme(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.els) || !Array.isArray(s.wires)) throw new Error('Это не файл схемы тренажёра');
  s.v = 1; s.title = String(s.title || 'Схема'); s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  let maxN = 0;
  const bump = id => { const m = /(\d+)$/.exec(String(id)); if (m) maxN = Math.max(maxN, +m[1]); };
  s.els = s.els.filter(e => e && TYPES[e.t]).map(e => {
    const T = TYPES[e.t];
    const el = { id: String(e.id), t: e.t, x: Math.round(+e.x || 0), y: Math.round(+e.y || 0), r: ((+e.r || 0) % 4 + 4) % 4, name: String(e.name || T.code), p: Object.assign({}, T.props || {}, e.p || {}) };
    if (T.cls === 'switch' || T.cls === 'earth') el.on = e.on != null ? !!e.on : T.normal;
    if (el.t === 'bus') el.p.len = clamp(Math.round(+el.p.len || 4), 1, 200);
    bump(el.id);
    return el;
  });
  s.wires = s.wires.filter(w => w && Array.isArray(w.a) && Array.isArray(w.b)).map(w => {
    bump(w.id);
    return { id: String(w.id), a: [Math.round(+w.a[0]), Math.round(+w.a[1])], b: [Math.round(+w.b[0]), Math.round(+w.b[1])], vf: w.vf !== false };
  });
  const ids = new Set(s.els.map(e => e.id));
  s.tasks = s.tasks.filter(t => t && t.target && t.steps).map(t => {
    bump(t.id);
    return {
      id: String(t.id || 'task' + (++maxN)), title: String(t.title || 'Задание'), desc: String(t.desc || ''),
      init: Object.fromEntries(Object.entries(t.init || {}).filter(([k]) => ids.has(k))),
      target: Object.fromEntries(Object.entries(t.target).filter(([k]) => ids.has(k))),
      steps: t.steps.filter(x => x && ids.has(x.id) && ['on', 'off', 'check'].includes(x.op)),
      keep: (t.keep || []).filter(k => ids.has(k)), requireCheck: !!t.requireCheck,
    };
  });
  s.seq = Math.max(+s.seq || 1, maxN + 1);
  return s;
}

export { G, APP_VER, TYPES, PALETTE, BOX, rot, ptKey, clamp, esc, portPoints, bbox, vClass, V_CLASSES, fmtNum, fmtKv, isSwitchable, emptyScheme, cloneScheme, newId, nameFor, nextName, makeEl, makeWire, wireRoute, normalizeScheme };
