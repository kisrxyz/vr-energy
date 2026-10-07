/* ===== §1. Библиотека элементов ===== */
const G = 20;          // пикселей в одной клетке сетки при масштабе 1
const APP_VER = '0.4';

// Категории палитры (порядок = порядок в палитре)
const CATS = [
  ['src', 'Источники'],
  ['line', 'Шины и линии'],
  ['sw', 'Коммутационные аппараты'],
  ['tr', 'Трансформаторы'],
  ['prot', 'Защита и измерения'],
  ['load', 'Потребители'],
];

/* Типы элементов.
   ports — точки подключения в клетках относительно центра (до поворота).
   cls: source — источник, bus — шина, switch — коммутационный аппарат, earth — заземление (ЗН, КЗ, ПЗ),
        transformer — трансформатор (обмотки wnd), link — элемент цепи без коммутации (ТТ, реактор, КЛ, ВЛ),
        passive — присоединение без тока (ТН, ОПН), load — присоединение с током нагрузки.
   Для switch: sw — вид аппарата; lb — отключает и включает ток нагрузки; prot — отключает КЗ (граница зоны КЗ);
               cart — аппарат на выкатной тележке (положения work / test / repair); by — «чем» (для текста ошибки).
   Для earth: ek — earth (ЗН), kz (короткозамыкатель), pz (переносное заземление).
   Для load: consumer — потребитель (контроль перерыва питания); у БК тока нагрузки хватает для дуги, но это не потребитель.
   code — обозначение для имён; gost — буквенный код по ГОСТ 2.710; syn — синонимы для поиска в палитре.
   verbs/did — глаголы для бланка и журнала, если не «включить/отключить».
   pmeta — свойства для правки: [ключ, подпись, шаг] или [ключ, подпись, 'bool'].
   TODO преподаватель: — вопросы собраны в docs/questions-for-teacher.md. */
const TYPES = {
  source:       { title: 'Энергосистема', code: 'С', gost: 'GS', cat: 'src', ports: [[0, 1]], cls: 'source', props: { kv: 110 },
                  pmeta: [['kv', 'Напряжение, кВ', 0.1]], syn: ['система', 'сеть', 'питание', 'ввод', 'источник', 'подстанция'] },
  gen:          { title: 'Генератор', code: 'G', gost: 'G', cat: 'src', ports: [[0, 1]], cls: 'source', props: { kv: 10.5, mw: 12 },
                  pmeta: [['kv', 'Напряжение, кВ', 0.1]], syn: ['дизель', 'ДГУ', 'ДЭС', 'резервное питание'] },

  bus:          { title: 'Шина', code: 'СШ', gost: 'WB', cat: 'line', ports: null, cls: 'bus', props: { len: 8 },
                  pmeta: [['len', 'Длина, клеток', 1]], syn: ['сборные шины', 'секция', 'система шин', 'СШ', 'шинный мост'] },
  // TODO преподаватель: ограничивать ли отключение ненагруженной ВЛ и КЛ разъединителем по длине (зарядный ток)? Сейчас — можно всегда.
  ohl:          { title: 'Воздушная линия', code: 'ВЛ', gost: 'W', cat: 'line', ports: [[0, -2], [0, 2]], cls: 'link', props: { km: 12 },
                  pmeta: [['km', 'Длина, км', 0.1]], syn: ['ВЛ', 'линия', 'провод', 'опора', 'воздушка'] },
  cable:        { title: 'Кабельная линия', code: 'КЛ', gost: 'W', cat: 'line', ports: [[0, -2], [0, 2]], cls: 'link', props: { km: 1.2 },
                  pmeta: [['km', 'Длина, км', 0.1]], syn: ['КЛ', 'кабель', 'муфта', 'ААБл', 'АСБ'] },

  breaker:      { title: 'Выключатель', code: 'Q', gost: 'Q', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'breaker', lb: true, prot: true, normal: true,
                  syn: ['выключатель', 'масляный', 'вакуумный', 'элегазовый', 'ВМП', 'ВВ', 'МВ'] },
  cart:         { title: 'Выкатной выключатель', code: 'Q', gost: 'Q', cat: 'sw', ports: [[0, -2], [0, 2]], cls: 'switch', sw: 'breaker', cart: true, lb: true, prot: true, normal: true,
                  syn: ['КРУ', 'тележка', 'выкатной', 'выкатная тележка', 'ячейка КРУ', 'рабочее положение', 'контрольное положение', 'ремонтное положение'] },
  disconnector: { title: 'Разъединитель', code: 'QS', gost: 'QS', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'disconnector', by: 'разъединителем', normal: true,
                  syn: ['ШР', 'ЛР', 'ТР', 'СР', 'РЛНД', 'РНД', 'РВ', 'разъединитель ТН', 'видимый разрыв'] },
  cartdisc:     { title: 'Выкатной разъединитель', code: 'QS', gost: 'QS', cat: 'sw', ports: [[0, -2], [0, 2]], cls: 'switch', sw: 'disconnector', cart: true, by: 'тележкой', normal: true,
                  syn: ['КРУ', 'тележка', 'тележка СР', 'тележка ТН', 'секционный разъединитель', 'выкатной'] },
  loadbreak:    { title: 'Выключатель нагрузки', code: 'ВН', gost: 'QW', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'loadbreak', lb: true, normal: true,
                  syn: ['ВН', 'ВНА', 'ВНП', 'КСО', 'выключатель нагрузки'] },
  // TODO преподаватель: какие токи разрешено отключать отделителем вручную (намагничивания Т)? Сейчас — как разъединитель.
  od:           { title: 'Отделитель', code: 'ОД', gost: 'QR', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'disconnector', by: 'отделителем', normal: true,
                  syn: ['ОД', 'отделитель', 'упрощённая схема'] },
  // TODO преподаватель: какой рубильник ставить по умолчанию на щитах 0,4 кВ — с камерами или без? Сейчас — без (как разъединитель).
  knife:        { title: 'Рубильник 0,4 кВ', code: 'Р', gost: 'QS', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'disconnector', by: 'рубильником', normal: true,
                  props: { arc: 0 }, pmeta: [['arc', 'С дугогасительными камерами', 'bool']], syn: ['рубильник', 'РПС', 'щит 0,4', 'ЩО'] },
  acb:          { title: 'Автомат 0,4 кВ', code: 'QF', gost: 'QF', cat: 'sw', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'breaker', lb: true, prot: true, normal: true,
                  syn: ['автомат', 'автоматический выключатель', 'ВА', 'щит 0,4'] },
  earth:        { title: 'Заземляющий нож', code: 'ЗН', gost: 'QSG', cat: 'sw', ports: [[0, -1]], cls: 'earth', ek: 'earth', normal: false,
                  syn: ['ЗН', 'заземлитель', 'заземление', 'земля', 'QSG'] },
  // TODO преподаватель: разрешать ли ручное включение КЗ и показывать ли цикл «защита → КЗ → отключение линии → ОД в паузу → АПВ»?
  kz:           { title: 'Короткозамыкатель', code: 'КЗ', gost: 'QK', cat: 'sw', ports: [[0, -1]], cls: 'earth', ek: 'kz', normal: false,
                  syn: ['КЗ', 'короткозамыкатель', 'отделитель', 'упрощённая схема'] },

  transformer:  { title: 'Трансформатор', code: 'T', gost: 'T', cat: 'tr', ports: [[0, -2], [0, 2]], cls: 'transformer', wnd: ['kv1', 'kv2'], props: { kv1: 110, kv2: 10, mva: 25 },
                  pmeta: [['kv1', 'ВН, кВ', 0.1], ['kv2', 'НН, кВ', 0.1], ['mva', 'Мощность, МВА', 0.01]], syn: ['силовой', 'двухобмоточный', 'ТМ', 'ТДН', 'ТРДН', 'ТП'] },
  tr3:          { title: 'Трёхобмоточный трансформатор', code: 'T', gost: 'T', cat: 'tr', ports: [[0, -2], [-1, 2], [1, 2]], cls: 'transformer', wnd: ['kv1', 'kv2', 'kv3'], props: { kv1: 110, kv2: 35, kv3: 10, mva: 40 },
                  pmeta: [['kv1', 'ВН, кВ', 0.1], ['kv2', 'Вывод слева, кВ', 0.1], ['kv3', 'Вывод справа, кВ', 0.1], ['mva', 'Мощность, МВА', 0.01]], syn: ['трёхобмоточный', 'трехобмоточный', 'ТДТН', '110/35/10'] },
  tsn:          { title: 'ТСН', code: 'ТСН', gost: 'T', cat: 'tr', ports: [[0, -2], [0, 2]], cls: 'transformer', wnd: ['kv1', 'kv2'], props: { kv1: 10, kv2: 0.4, mva: 0.063 },
                  pmeta: [['kv1', 'ВН, кВ', 0.1], ['kv2', 'НН, кВ', 0.1], ['mva', 'Мощность, МВА', 0.001]], syn: ['трансформатор собственных нужд', 'собственные нужды', 'СН', 'ТМ-63'] },
  // TODO преподаватель: нужны ли дугогасящий (ДГР) и шунтирующий реакторы и какие операции с ними разрешены? Сейчас — токоограничивающий, без коммутации.
  reactor:      { title: 'Реактор', code: 'LR', gost: 'LR', cat: 'tr', ports: [[0, -1], [0, 1]], cls: 'link',
                  syn: ['реактор', 'токоограничивающий', 'РБ', 'РБА', 'Р'] },

  // TODO преподаватель: требовать ли перед отключением разъединителя (тележки) ТН отключение автоматов вторичных цепей и перевод цепей напряжения?
  vt:           { title: 'Трансформатор напряжения', code: 'ТН', gost: 'TV', cat: 'prot', ports: [[0, -1]], cls: 'passive',
                  syn: ['ТН', 'НАМИ', 'НТМИ', 'ЗНОЛ', 'НКФ', 'измерение напряжения'] },
  ct:           { title: 'Трансформатор тока', code: 'ТТ', gost: 'TA', cat: 'prot', ports: [[0, -1], [0, 1]], cls: 'link',
                  syn: ['ТТ', 'ТОЛ', 'ТФЗМ', 'ТПЛ', 'измерение тока'] },
  arrester:     { title: 'ОПН', code: 'ОПН', gost: 'FV', cat: 'prot', ports: [[0, -1]], cls: 'passive',
                  syn: ['ограничитель перенапряжений', 'разрядник', 'РВ', 'перенапряжения', 'грозозащита'] },
  fuse:         { title: 'Предохранитель', code: 'FU', gost: 'FU', cat: 'prot', ports: [[0, -1], [0, 1]], cls: 'switch', sw: 'fuse', prot: true, normal: true,
                  verbs: ['установить', 'снять'], did: ['Установлен', 'Снят'],
                  syn: ['ПР', 'плавкая вставка', 'ПК', 'ПКТ', 'ПКН', 'ПН-2', 'ППН'] },
  pz:           { title: 'Переносное заземление', code: 'ПЗ', gost: '', cat: 'prot', ports: [[0, 0]], cls: 'earth', ek: 'pz', onWire: true, normal: false,
                  verbs: ['наложить', 'снять'], did: ['Наложено', 'Снято'], syn: ['ПЗ', 'переносное', 'закоротка', 'заземление'] },

  load:         { title: 'Нагрузка', code: 'Н', gost: '', cat: 'load', ports: [[0, -1]], cls: 'load', consumer: true, props: { kw: 800 },
                  pmeta: [['kw', 'Мощность, кВт', 1]], syn: ['потребитель', 'фидер', 'цех', 'посёлок'] },
  motor:        { title: 'Двигатель', code: 'M', gost: 'M', cat: 'load', ports: [[0, -1]], cls: 'load', consumer: true, props: { kw: 250 },
                  pmeta: [['kw', 'Мощность, кВт', 1]], syn: ['двигатель', 'мотор', 'насос', 'электродвигатель'] },
  // TODO преподаватель: требовать ли паузу 1 мин перед повторным включением БК и разряд перед заземлением?
  capacitor:    { title: 'Конденсаторная батарея', code: 'БК', gost: 'C', cat: 'load', ports: [[0, -1]], cls: 'load', consumer: false, props: { kvar: 450 },
                  pmeta: [['kvar', 'Мощность, квар', 1]], syn: ['БК', 'конденсатор', 'компенсация', 'КРМ', 'УКРМ', 'косинусная'] },
};
// Порядок в палитре внутри категорий
const PALETTE = ['source', 'gen',
  'bus', 'ohl', 'cable',
  'breaker', 'cart', 'disconnector', 'cartdisc', 'loadbreak', 'od', 'earth', 'kz', 'knife', 'acb',
  'transformer', 'tr3', 'tsn', 'reactor',
  'vt', 'ct', 'arrester', 'fuse', 'pz',
  'load', 'motor', 'capacitor'];

// Положения выкатной тележки
const POS = ['work', 'test', 'repair'];
const POS_NAME = { work: 'рабочее', test: 'контрольное', repair: 'ремонтное' };

// Габарит символа в клетках (до поворота): [x0, y0, x1, y1]
const BOX = {
  source: [-0.9, -1.4, 0.9, 1], gen: [-0.9, -1.4, 0.9, 1],
  breaker: [-0.6, -1, 0.6, 1], acb: [-0.55, -1, 0.55, 1], disconnector: [-0.6, -1, 0.7, 1],
  earth: [-0.6, -1, 0.75, 1.25], transformer: [-0.95, -2, 0.95, 2],
  load: [-0.55, -1, 0.55, 0.95], motor: [-0.75, -1, 0.75, 1.25],
  ohl: [-0.5, -2, 0.5, 2], cable: [-0.45, -2, 0.45, 2],
  cart: [-0.6, -2, 0.6, 2], cartdisc: [-0.5, -2, 0.5, 2], loadbreak: [-0.6, -1, 0.7, 1], od: [-0.6, -1, 0.7, 1], knife: [-0.6, -1, 0.75, 1],
  kz: [-0.6, -1, 0.75, 1.25], tr3: [-1.25, -2, 1.25, 2], tsn: [-0.75, -2, 0.75, 2], reactor: [-0.6, -1, 0.6, 1],
  vt: [-0.6, -1, 0.6, 1.05], ct: [-0.45, -1, 0.45, 1], arrester: [-0.45, -1, 0.45, 1.25], fuse: [-0.35, -1, 0.35, 1],
  pz: [-0.5, -0.15, 0.5, 1.4], capacitor: [-0.55, -1, 0.55, 0.85],
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
// Напряжения обмоток трансформатора по порядку выводов
function windings(el) { return (TYPES[el.t].wnd || []).map(k => +el.p[k]); }
// Аппарат может отключать и включать ток нагрузки (рубильник — только с дугогасительными камерами)
function breaksLoad(el) { const T = TYPES[el.t]; return !!T.lb || (el.t === 'knife' && !!(el.p && +el.p.arc)); }
// Переносное заземление, наложенное в тренажёре: id = 'pz:' + id провода или шины
const isPzId = id => typeof id === 'string' && id.startsWith('pz:');

// Поиск по палитре: название, обозначения, синонимы (без регистра, ё = е).
// Порядок: точное обозначение (ТН, QS) → целое слово → начало слова → часть слова; при равенстве — порядок палитры.
const normText = s => String(s).toLowerCase().replace(/ё/g, 'е');
function searchScore(t, w) {
  const T = TYPES[t];
  if ([T.code, T.gost].some(c => c && normText(c) === w)) return 4;
  const hay = normText([T.title, T.code, T.gost, ...(T.syn || [])].join(' '));
  const words = hay.split(/[^a-zа-я0-9,]+/).filter(Boolean);
  if (words.includes(w)) return 3;
  if (words.some(x => x.startsWith(w))) return 2;
  return hay.includes(w) ? 1 : 0;
}
function searchTypes(q) {
  const words = normText(q).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return PALETTE.slice();
  return PALETTE.map((t, i) => {
    const sc = words.map(w => searchScore(t, w));
    return { t, i, score: sc.every(x => x > 0) ? sc.reduce((a, b) => a + b, 0) : 0 };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map(x => x.t);
}

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
  if (T.cart) el.pos = POS.includes(o.pos) ? o.pos : 'work';
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
// Лежит ли точка на проводе (не только на концах)
function onWire(w, p) {
  const r = wireRoute(w);
  for (let i = 0; i < r.length - 1; i++) {
    const [a, b] = [r[i], r[i + 1]];
    if (a[0] === b[0] && p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])) return true;
    if (a[1] === b[1] && p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])) return true;
  }
  return false;
}
// Шаги задания без аппаратов схемы (VR-полигон, src/core/permit.js): надеть СИЗ, вывесить и снять плакат, замок, ограждение
const FIELD_OPS = ['wear', 'hang', 'unhang', 'lock', 'unlock', 'fence', 'unfence'];
// Только строковые поля из списка: шаги и мероприятия полигона хранятся в файле как есть, лишнее отбрасывается
function pickStr(o, keys) { const out = {}; for (const k of keys) if (typeof o[k] === 'string') out[k] = o[k]; return out; }

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
    if (T.cart) el.pos = POS.includes(e.pos) ? e.pos : 'work';
    if (el.t === 'bus') el.p.len = clamp(Math.round(+el.p.len || 4), 1, 200);
    bump(el.id);
    return el;
  });
  s.wires = s.wires.filter(w => w && Array.isArray(w.a) && Array.isArray(w.b)).map(w => {
    bump(w.id);
    return { id: String(w.id), a: [Math.round(+w.a[0]), Math.round(+w.a[1])], b: [Math.round(+w.b[0]), Math.round(+w.b[1])], vf: w.vf !== false };
  });
  const ids = new Set(s.els.map(e => e.id)), wids = new Set(s.wires.map(w => w.id));
  const carts = new Set(s.els.filter(e => TYPES[e.t].cart).map(e => e.id));
  // ссылка задания: аппарат схемы или переносное заземление на проводе или шине
  const ok = k => ids.has(k) || (isPzId(k) && (wids.has(k.slice(3)) || ids.has(k.slice(3))));
  const okPos = ([k, v]) => carts.has(k) && POS.includes(v);
  const field = x => FIELD_OPS.includes(x.op);
  s.tasks = s.tasks.filter(t => t && t.target && t.steps).map(t => {
    bump(t.id);
    const task = {
      id: String(t.id || 'task' + (++maxN)), title: String(t.title || 'Задание'), desc: String(t.desc || ''),
      init: Object.fromEntries(Object.entries(t.init || {}).filter(([k]) => ok(k))),
      target: Object.fromEntries(Object.entries(t.target).filter(([k]) => ok(k))),
      initPos: Object.fromEntries(Object.entries(t.initPos || {}).filter(okPos)),
      targetPos: Object.fromEntries(Object.entries(t.targetPos || {}).filter(okPos)),
      steps: t.steps.filter(x => x && (field(x) || ((ok(x.id) || (x.op === 'check' && wids.has(x.id))) && (['on', 'off', 'check'].includes(x.op) || (x.op === 'pos' && carts.has(x.id) && POS.includes(x.pos))))))
        .map(x => field(x) ? Object.assign({ op: x.op }, pickStr(x, ['item', 'poster', 'at'])) : x.op === 'pos' ? { op: 'pos', id: x.id, pos: x.pos } : { op: x.op, id: x.id }),
      keep: (t.keep || []).filter(k => ids.has(k)), requireCheck: !!t.requireCheck,
    };
    // мероприятия VR-полигона: ссылки на аппараты и провода — только существующие
    if (Array.isArray(t.measures)) {
      task.measures = t.measures.filter(m => m && typeof m.k === 'string' && (m.id == null || ids.has(m.id)) && (m.wire == null || wids.has(m.wire)))
        .map(m => Object.assign({ k: m.k, stage: Math.round(+m.stage) || 0 }, pickStr(m, ['id', 'wire', 'pos', 'poster', 'title']),
          Array.isArray(m.at) ? { at: m.at.filter(a => typeof a === 'string') } : {}));
      if (+t.workCell > 0) task.workCell = Math.round(+t.workCell);
    }
    return task;
  });
  // VR-полигон: как ячейки КРУ стоят в помещении (тележка, ЗН, провода у верхних и нижних контактов)
  if (s.room && typeof s.room === 'object' && Array.isArray(s.room.cells)) {
    const cells = s.room.cells.filter(c => c && carts.has(c.cart) && +c.n > 0).map(c => ({
      n: Math.round(+c.n), title: String(c.title || ''), kind: String(c.kind || 'line'), cart: c.cart,
      earth: ids.has(c.earth) ? c.earth : null, up: wids.has(c.up) ? c.up : null, lo: wids.has(c.lo) ? c.lo : null,
    }));
    if (cells.length) s.room = { kind: 'zru', title: String(s.room.title || 'ЗРУ'), cells };
    else delete s.room;
  } else delete s.room;
  s.seq = Math.max(+s.seq || 1, maxN + 1);
  return s;
}

export { G, APP_VER, CATS, TYPES, PALETTE, POS, POS_NAME, BOX, rot, ptKey, clamp, esc, portPoints, bbox, vClass, V_CLASSES, fmtNum, fmtKv, isSwitchable, windings, breaksLoad, isPzId, normText, searchTypes, emptyScheme, cloneScheme, newId, nameFor, nextName, makeEl, makeWire, wireRoute, onWire, FIELD_OPS, normalizeScheme };
