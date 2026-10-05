import { isSwitchable, emptyScheme, newId, makeEl, makeWire } from './elements.js';

/* ===== §2. Готовые схемы и задания =====
   Схемы собираются кодом, чтобы координаты было легко поправить.
   Задание: init — исходное положение аппаратов, steps — эталонные шаги,
   target — положение, которое нужно получить, keep — потребители, которые нельзя обесточивать. */

function defTask(s, d) {
  const byName = new Map(s.els.map(e => [e.name, e.id]));
  const id = n => { const v = byName.get(n); if (!v) throw new Error('Нет элемента ' + n); return v; };
  const init = {};
  for (const e of s.els) if (isSwitchable(e)) init[e.id] = e.on;
  for (const [n, on] of Object.entries(d.init || {})) init[id(n)] = on;
  const steps = d.steps.map(([op, n]) => ({ op, id: id(n) }));
  const target = {};
  for (const st of steps) if (st.op !== 'check') target[st.id] = st.op === 'on';
  return { id: newId(s, 'task'), title: d.title, desc: d.desc, init, target, steps, keep: (d.keep || []).map(id), requireCheck: steps.some(x => x.op === 'check') };
}

// ПС 110/10 кВ: два ввода 110 кВ, два трансформатора, две секции 10 кВ с секционным выключателем
function sampleSubstation() {
  const s = emptyScheme('ПС 110/10 кВ «Учебная»');
  const E = (t, x, y, name, o = {}) => makeEl(s, t, x, y, Object.assign({ name }, o));
  const W = (a, b, vf) => makeWire(s, a, b, vf);
  const BUS_Y = 32;

  function inlet(x, i, line) {
    E('source', x, 1, line, { p: { kv: 110 } });                 // точка (x,2)
    E('disconnector', x, 4, `ЛР-110 Т${i}`); W([x, 2], [x, 3]);  // (x,3)-(x,5)
    E('breaker', x, 7, `В-110 Т${i}`); W([x, 5], [x, 6]);        // (x,6)-(x,8)
    E('disconnector', x, 10, `ТР-110 Т${i}`); W([x, 8], [x, 9]); // (x,9)-(x,11)
    W([x, 11], [x, 12]);
    E('earth', x + 2, 13, `ЗН-110 Т${i}`); W([x, 12], [x + 2, 12], false);
    W([x, 12], [x, 14]);
    E('transformer', x, 16, `Т${i}`, { p: { kv1: 110, kv2: 10, mva: 25 } }); // (x,14)-(x,18)
    W([x, 18], [x, 20]);
    E('earth', x + 2, 21, `ЗН-10 Т${i}`); W([x, 20], [x + 2, 20], false);
    E('disconnector', x, 24, `ТР-10 Т${i}`); W([x, 20], [x, 23]); // (x,23)-(x,25)
    E('breaker', x, 27, `В-10 Т${i}`); W([x, 25], [x, 26]);       // (x,26)-(x,28)
    E('disconnector', x, 30, `ШР-10 Т${i}`); W([x, 28], [x, 29]); // (x,29)-(x,31)
    W([x, 31], [x, BUS_Y]);
  }
  function feeder(x, n, loadName, loadType, kw, twoEarths) {
    W([x, BUS_Y], [x, 33]);
    E('disconnector', x, 34, `ШР Л-${n}`);                        // (x,33)-(x,35)
    if (twoEarths) {
      W([x, 35], [x, 36]);
      E('earth', x + 2, 37, `ЗН-1 Л-${n}`); W([x, 36], [x + 2, 36], false);
      W([x, 36], [x, 39]);
    } else W([x, 35], [x, 39]);
    E('breaker', x, 40, `В-10 Л-${n}`);                           // (x,39)-(x,41)
    W([x, 41], [x, 42]);
    E('earth', x + 2, 43, twoEarths ? `ЗН-2 Л-${n}` : `ЗН Л-${n}`); W([x, 42], [x + 2, 42], false);
    W([x, 42], [x, 45]);
    E('disconnector', x, 46, `ЛР Л-${n}`);                        // (x,45)-(x,47)
    W([x, 47], [x, 48]);
    E(loadType, x, 49, loadName, { p: { kw } });                  // (x,48)
  }

  inlet(9, 1, 'ВЛ-110 «Восток»');
  inlet(34, 2, 'ВЛ-110 «Запад»');
  E('bus', 2, BUS_Y, '1СШ', { p: { len: 14 } });   // x 2..16
  E('bus', 26, BUS_Y, '2СШ', { p: { len: 16 } });  // x 26..42
  // секционирование: СР-1 — СВ-10 — СР-2 (горизонтально)
  E('disconnector', 18, BUS_Y, 'СР-1', { r: 1 });  // (19,32)-(17,32)
  E('breaker', 21, BUS_Y, 'СВ-10', { r: 1, on: false });
  E('disconnector', 24, BUS_Y, 'СР-2', { r: 1 });
  W([16, BUS_Y], [17, BUS_Y]); W([19, BUS_Y], [20, BUS_Y]); W([22, BUS_Y], [23, BUS_Y]); W([25, BUS_Y], [26, BUS_Y]);

  feeder(4, 1, 'Цех №1', 'load', 1200, true);
  feeder(13, 2, 'Насосная', 'motor', 630, false);
  feeder(29, 3, 'Посёлок', 'load', 900, false);
  feeder(38, 4, 'Компрессорная', 'motor', 400, false);

  s.tasks.push(defTask(s, {
    title: 'Вывод в ремонт выключателя В-10 Л-1',
    desc: 'Отключите В-10 Л-1, создайте видимый разрыв разъединителями ЛР и ШР, проверьте отсутствие напряжения и заземлите выключатель с обеих сторон. Остальные потребители не должны терять питание.',
    steps: [['off', 'В-10 Л-1'], ['off', 'ЛР Л-1'], ['off', 'ШР Л-1'], ['check', 'ЗН-1 Л-1'], ['on', 'ЗН-1 Л-1'], ['check', 'ЗН-2 Л-1'], ['on', 'ЗН-2 Л-1']],
    keep: ['Насосная', 'Посёлок', 'Компрессорная'],
  }));
  s.tasks.push(defTask(s, {
    title: 'Вывод в ремонт трансформатора Т1 без перерыва питания',
    desc: 'Переведите нагрузку 1СШ на Т2 через секционный выключатель, отключите Т1 со стороны 10 и 110 кВ, проверьте отсутствие напряжения и наложите заземления с обеих сторон Т1. Ни один потребитель не должен потерять питание.',
    steps: [['on', 'СВ-10'], ['off', 'В-10 Т1'], ['off', 'ТР-10 Т1'], ['off', 'ШР-10 Т1'], ['off', 'В-110 Т1'], ['off', 'ТР-110 Т1'],
            ['check', 'ЗН-110 Т1'], ['on', 'ЗН-110 Т1'], ['check', 'ЗН-10 Т1'], ['on', 'ЗН-10 Т1']],
    keep: ['Цех №1', 'Насосная', 'Посёлок', 'Компрессорная'],
  }));
  return s;
}

// ТП 10/0,4 кВ: одна линия 10 кВ, трансформатор 630 кВА, щит 0,4 кВ с тремя автоматами
function sampleTP() {
  const s = emptyScheme('ТП 10/0,4 кВ «Цех»');
  const E = (t, x, y, name, o = {}) => makeEl(s, t, x, y, Object.assign({ name }, o));
  const W = (a, b, vf) => makeWire(s, a, b, vf);
  E('source', 10, 1, 'РП-10, яч. 12', { p: { kv: 10 } });
  E('disconnector', 10, 4, 'РВ-10'); W([10, 2], [10, 3]);
  E('breaker', 10, 7, 'В-10 Т-1'); W([10, 5], [10, 6]);
  W([10, 8], [10, 10]);
  E('earth', 12, 11, 'ЗН-10'); W([10, 10], [12, 10], false);
  W([10, 10], [10, 12]);
  E('transformer', 10, 14, 'Т-1', { p: { kv1: 10, kv2: 0.4, mva: 0.63 } });
  E('acb', 10, 19, 'QF-ввод'); W([10, 16], [10, 18]);
  E('bus', 2, 22, 'Ш-0,4', { p: { len: 16 } });
  W([10, 20], [10, 22]);
  const out = [[4, 'QF1', 'motor', 'Насос Н-1', 30], [10, 'QF2', 'load', 'Освещение', 15], [16, 'QF3', 'motor', 'Вентилятор В-1', 22]];
  for (const [x, q, t, n, kw] of out) {
    W([x, 22], [x, 24]);
    E('acb', x, 25, q);
    W([x, 26], [x, 27]);
    E(t, x, 28, n, { p: { kw } });
  }
  s.tasks.push(defTask(s, {
    title: 'Подача напряжения на ТП после ремонта',
    desc: 'ТП выведена в ремонт: включён ЗН-10, аппараты отключены. Снимите заземление и подайте напряжение в правильном порядке: сначала разъединитель, потом выключатель, затем автоматы 0,4 кВ.',
    init: { 'РВ-10': false, 'В-10 Т-1': false, 'ЗН-10': true, 'QF-ввод': false, 'QF1': false, 'QF2': false, 'QF3': false },
    steps: [['off', 'ЗН-10'], ['on', 'РВ-10'], ['on', 'В-10 Т-1'], ['on', 'QF-ввод'], ['on', 'QF1'], ['on', 'QF2'], ['on', 'QF3']],
  }));
  s.tasks.push(defTask(s, {
    title: 'Вывод ТП в ремонт',
    desc: 'Отключите ТП от сети 10 кВ: снимите нагрузку автоматом QF-ввод, отключите выключатель и разъединитель, проверьте отсутствие напряжения и включите ЗН-10.',
    steps: [['off', 'QF-ввод'], ['off', 'В-10 Т-1'], ['off', 'РВ-10'], ['check', 'ЗН-10'], ['on', 'ЗН-10']],
  }));
  return s;
}

const SAMPLES = [
  { key: 'ps110', title: 'ПС 110/10 кВ «Учебная»', make: sampleSubstation },
  { key: 'tp10', title: 'ТП 10/0,4 кВ «Цех»', make: sampleTP },
];

export { defTask, sampleSubstation, sampleTP, SAMPLES };
