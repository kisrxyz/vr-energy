import { TYPES, isSwitchable, emptyScheme, newId, makeEl, makeWire } from './elements.js';

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
  const initPos = {};
  for (const e of s.els) if (TYPES[e.t].cart) initPos[e.id] = e.pos;
  // шаг: [op, имя] или ['pos', имя, положение]; переносное заземление — имя 'pz:' + id провода
  const ref = n => n.startsWith('pz:') ? n : id(n);
  const steps = d.steps.map(([op, n, pos]) => op === 'pos' ? { op, id: ref(n), pos } : { op, id: ref(n) });
  const target = {}, targetPos = {};
  for (const st of steps) {
    if (st.op === 'pos') targetPos[st.id] = st.pos;
    else if (st.op !== 'check') target[st.id] = st.op === 'on';
  }
  return { id: newId(s, 'task'), title: d.title, desc: d.desc, init, target, initPos, targetPos, steps, keep: (d.keep || []).map(id), requireCheck: steps.some(x => x.op === 'check') };
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

// ПС 110/35/10 кВ: два трёхобмоточных трансформатора, ОРУ-35 кВ с секционным выключателем,
// КРУ-10 кВ на выкатных тележках, ТН и ТСН на каждой секции.
// Т1 нарисован зеркально: левый вывод — 10 кВ, правый — 35 кВ (у трансформатора важны напряжения обмоток, а не сторона).
function sampleSubstation35() {
  const s = emptyScheme('ПС 110/35/10 кВ «Степная»');
  const E = (t, x, y, name, o = {}) => makeEl(s, t, x, y, Object.assign({ name }, o));
  const W = (a, b, vf) => makeWire(s, a, b, vf);
  const B35 = 39, B10 = 62;
  const side = (t, at, dx, name, o) => { E(t, at[0] + dx, at[1] + 1, name, o); W(at, [at[0] + dx, at[1]], false); };

  // ОРУ-110: ВЛ — ЛР — В — ТТ — ТР — (ЗН, ОПН) — трансформатор
  function inlet110(x, i, src, line, km, kv2, kv3) {
    E('source', x, 1, src, { p: { kv: 110 } });                         // (x,2)
    E('ohl', x, 5, line, { p: { km } }); W([x, 2], [x, 3]);              // (x,3)-(x,7)
    E('disconnector', x, 9, `ЛР-110 Т${i}`); W([x, 7], [x, 8]);          // (x,8)-(x,10)
    E('breaker', x, 12, `В-110 Т${i}`); W([x, 10], [x, 11]);             // (x,11)-(x,13)
    E('ct', x, 15, `ТТ-110 Т${i}`); W([x, 13], [x, 14]);                 // (x,14)-(x,16)
    E('disconnector', x, 18, `ТР-110 Т${i}`); W([x, 16], [x, 17]);       // (x,17)-(x,19)
    W([x, 19], [x, 20]);
    side('earth', [x, 20], 2, `ЗН-110 Т${i}`);
    side('arrester', [x, 20], -6, `ОПН-110 Т${i}`);
    W([x, 20], [x, 22]);
    E('tr3', x, 24, `Т${i}`, { p: { kv1: 110, kv2, kv3, mva: 40 } });  // (x,22), (x-1,26), (x+1,26)
  }
  // ОРУ-35: от вывода трансформатора — ЗН — ТР — В — ШР — шина (вертикаль x)
  function in35(x, i, from) {
    W(from, [x, 26]); W([x, 26], [x, 27]);
    side('earth', [x, 27], 2, `ЗН-35 Т${i}`);
    W([x, 27], [x, 30]);
    E('disconnector', x, 31, `ТР-35 Т${i}`);                             // (x,30)-(x,32)
    E('breaker', x, 34, `В-35 Т${i}`); W([x, 32], [x, 33]);              // (x,33)-(x,35)
    E('disconnector', x, 37, `ШР-35 Т${i}`); W([x, 35], [x, 36]);        // (x,36)-(x,38)
    W([x, 38], [x, B35]);
  }
  function feeder35(x, n, load) {
    W([x, B35], [x, 40]);
    E('disconnector', x, 41, `ШР-35 Л-${n}`);                           // (x,40)-(x,42)
    E('breaker', x, 44, `В-35 Л-${n}`); W([x, 42], [x, 43]);             // (x,43)-(x,45)
    E('disconnector', x, 47, `ЛР-35 Л-${n}`); W([x, 45], [x, 46]);       // (x,46)-(x,48)
    W([x, 48], [x, 49]);
    side('earth', [x, 49], 2, `ЗН-35 Л-${n}`);
    W([x, 49], [x, 51]);
    E('ohl', x, 53, `ВЛ-35 Л-${n}`, { p: { km: 9 } });                  // (x,51)-(x,55)
    W([x, 55], [x, 56]);
    E('load', x, 57, load, { p: { kw: 6000 } });                         // (x,56)
  }
  // Ввод 10 кВ в КРУ: провод от трансформатора — ЗН — тележка ввода — секция
  function in10(x, i, edx) {
    W([x, 26], [x, 54]);
    side('earth', [x, 54], edx, `ЗН-10 Т${i}`);
    W([x, 54], [x, 57]);
    E('cart', x, 59, `В-10 Т${i}`);                                      // (x,57)-(x,61)
    W([x, 61], [x, B10]);
  }
  // Ячейка КРУ с кабельной линией: тележка — ТТ — ЗН — КЛ — РВ на ТП — потребитель
  function cell(x, n, load, t = 'load', kw = 900) {
    W([x, B10], [x, 63]);
    E('cart', x, 65, `В-10 Л-${n}`);                                     // (x,63)-(x,67)
    E('ct', x, 69, `ТТ Л-${n}`); W([x, 67], [x, 68]);                    // (x,68)-(x,70)
    W([x, 70], [x, 71]);
    side('earth', [x, 71], 2, `ЗН Л-${n}`);
    E('cable', x, 74, `КЛ-10 Л-${n}`, { p: { km: 1.8 } }); W([x, 71], [x, 72]); // (x,72)-(x,76)
    const end = W([x, 76], [x, 77]);                                       // конец КЛ у ТП: место для ПЗ
    E('disconnector', x, 78, `РВ Л-${n}`);                               // (x,77)-(x,79)
    W([x, 79], [x, 80]);
    E(t, x, 81, load, { p: { kw } });                                    // (x,80)
    return end;
  }
  function vtCell(x, sec) {
    W([x, B10], [x, 63]);
    E('cartdisc', x, 65, `ТН-${sec} тележка`);                           // (x,63)-(x,67)
    E('fuse', x, 69, `FU ТН-${sec}`); W([x, 67], [x, 68]);               // (x,68)-(x,70)
    E('vt', x, 72, `ТН-10 ${sec}`); W([x, 70], [x, 71]);                 // (x,71)
  }
  function tsnCell(x, i) {
    W([x, B10], [x, 63]);
    E('cartdisc', x, 65, `ТСН-${i} тележка`);                            // (x,63)-(x,67)
    E('fuse', x, 69, `FU ТСН-${i}`); W([x, 67], [x, 68]);                // (x,68)-(x,70)
    E('tsn', x, 73, `ТСН-${i}`); W([x, 70], [x, 71]);                    // (x,71)-(x,75)
    E('acb', x, 77, `QF СН-${i}`); W([x, 75], [x, 76]);                  // (x,76)-(x,78)
    E('load', x, 80, `Собственные нужды ${i}`, { p: { kw: 40 } }); W([x, 78], [x, 79]); // (x,79)
  }
  function arresterCell(x, sec) { W([x, B10], [x, 63]); E('arrester', x, 64, `ОПН-10 ${sec}`); }

  inlet110(14, 1, 'ПС «Центральная» 110 кВ', 'ВЛ-110 «Центр»', 24, 10, 35);
  inlet110(66, 2, 'ПС «Западная» 110 кВ', 'ВЛ-110 «Запад»', 31, 35, 10);
  // 35 кВ: от Т1 — правый вывод (15,26), от Т2 — левый вывод (65,26)
  in35(18, 1, [15, 26]);
  in35(60, 2, [65, 26]);
  E('bus', 16, B35, '1СШ-35', { p: { len: 18 } });   // x 16..34
  E('bus', 44, B35, '2СШ-35', { p: { len: 20 } });   // x 44..64
  E('disconnector', 36, B35, 'СР-35-1', { r: 1 });   // (37,y)-(35,y)
  E('breaker', 39, B35, 'СВ-35', { r: 1, on: false });
  E('disconnector', 42, B35, 'СР-35-2', { r: 1 });
  W([34, B35], [35, B35]); W([37, B35], [38, B35]); W([40, B35], [41, B35]); W([43, B35], [44, B35]);
  feeder35(26, 1, 'ПС «Аул» 35 кВ');
  feeder35(54, 2, 'ПС «Ферма» 35 кВ');
  // КРУ-10 кВ: от Т1 — левый вывод (13,26), от Т2 — правый вывод (67,26)
  in10(13, 1, -2);
  in10(67, 2, 2);
  E('bus', 2, B10, '1С-10', { p: { len: 34 } });    // x 2..36
  E('bus', 46, B10, '2С-10', { p: { len: 34 } });   // x 46..80
  E('cart', 39, B10, 'СВ-10', { r: 1, on: false });  // (41,y)-(37,y)
  E('cartdisc', 43, B10, 'СР-10', { r: 1 });         // (45,y)-(41,y)
  W([36, B10], [37, B10]); W([45, B10], [46, B10]);
  vtCell(4, '1С'); tsnCell(12, 1);
  const kl1 = cell(20, 1, 'ТП-1 «Школа»', 'load', 400);
  cell(28, 3, 'ТП-3 «Насосная»', 'motor', 630);
  arresterCell(34, '1С');
  arresterCell(48, '2С');
  cell(54, 2, 'ТП-2 «Больница»', 'load', 500);
  cell(62, 4, 'ТП-4 «Мкр. Самал»', 'load', 1100);
  tsnCell(70, 2); vtCell(78, '2С');

  const all = s.els.filter(e => TYPES[e.t].consumer).map(e => e.name);
  s.tasks.push(defTask(s, {
    title: 'Вывод в ремонт кабельной линии КЛ-10 Л-1',
    desc: 'Отключите выключатель В-10 Л-1 и выкатите тележку в контрольное положение, отключите РВ Л-1 на ТП-1. Проверьте отсутствие напряжения, включите ЗН Л-1 в ячейке КРУ и наложите переносное заземление на конце кабеля у РВ Л-1. Остальные потребители не должны терять питание.',
    steps: [['off', 'В-10 Л-1'], ['pos', 'В-10 Л-1', 'test'], ['off', 'РВ Л-1'], ['check', 'ЗН Л-1'], ['on', 'ЗН Л-1'], ['check', 'РВ Л-1'], ['on', 'pz:' + kl1.id]],
    keep: all.filter(n => n !== 'ТП-1 «Школа»'),
  }));
  s.tasks.push(defTask(s, {
    title: 'Вывод в ремонт трансформатора Т1 без перерыва питания',
    desc: 'Переведите нагрузку 1С-10 и 1СШ-35 на Т2 секционными выключателями. Отключите Т1 со стороны 10 кВ (тележку ввода — в контрольное положение), 35 кВ и 110 кВ, проверьте отсутствие напряжения и заземлите Т1 со всех трёх сторон. Ни один потребитель не должен потерять питание.',
    steps: [['on', 'СВ-10'], ['on', 'СВ-35'], ['off', 'В-10 Т1'], ['pos', 'В-10 Т1', 'test'],
            ['off', 'В-35 Т1'], ['off', 'ТР-35 Т1'], ['off', 'ШР-35 Т1'], ['off', 'В-110 Т1'], ['off', 'ТР-110 Т1'],
            ['check', 'ЗН-110 Т1'], ['on', 'ЗН-110 Т1'], ['check', 'ЗН-35 Т1'], ['on', 'ЗН-35 Т1'], ['check', 'ЗН-10 Т1'], ['on', 'ЗН-10 Т1']],
    keep: all,
  }));
  return s;
}

// VR-полигон «Допуск к работе»: ЗРУ-10 кВ, шесть ячеек КРУ в ряд на одной секции шин.
// Под 3D-помещением — обычная схема, переключения считает тот же движок. s.room — как ячейки стоят в помещении:
// тележка, ЗН, провода у верхних (шинных) и нижних (линейных) разъёмных контактов. Мероприятия задания — src/core/permit.js.
// ЗН ячейки стоит в узле нижних контактов (до ТТ): проверка указателем и ПЗ на контактах — тот же участок, что заземляет ЗН.
function samplePolygon() {
  const s = emptyScheme('VR-полигон: ЗРУ-10 кВ, допуск к работе');
  const E = (t, x, y, name, o = {}) => makeEl(s, t, x, y, Object.assign({ name }, o));
  const W = (a, b, vf) => makeWire(s, a, b, vf);
  const B = 10;
  const room = { kind: 'zru', title: 'ЗРУ-10 кВ', cells: [] };
  // яч.1 — ввод от трансформатора Т1: сверху питание, тележка ввода, снизу шины
  E('source', 4, 1, 'Т1 10 кВ', { p: { kv: 10 } });                  // (4,2)
  const in1 = W([4, 2], [4, 3]);
  const q1 = E('cart', 4, 5, 'В-10 Ввод');                           // (4,3)-(4,7)
  const up1 = W([4, 7], [4, B]);
  E('bus', 2, B, '1С-10', { p: { len: 44 } });                       // x 2..46
  room.cells.push({ n: 1, title: 'Ввод от Т1', kind: 'input', cart: q1.id, earth: null, up: up1.id, lo: in1.id });
  // Линейная ячейка: шины — тележка — нижние контакты (ЗН) — ТТ — КЛ — потребитель
  function line(n, x, load, t, kw) {
    const up = W([x, B], [x, 11]);
    const q = E('cart', x, 13, `В-10 яч.${n}`);                       // (x,11)-(x,15)
    const lo = W([x, 15], [x, 16]);
    const zn = E('earth', x + 2, 17, `ЗН яч.${n}`); W([x, 16], [x + 2, 16], false);
    E('ct', x, 18, `ТТ яч.${n}`); W([x, 16], [x, 17]);                // (x,17)-(x,19)
    E('cable', x, 22, `КЛ яч.${n}`, { p: { km: 0.8 } }); W([x, 19], [x, 20]); // (x,20)-(x,24)
    E(t, x, 26, load, { p: { kw } }); W([x, 24], [x, 25]);            // (x,25)
    room.cells.push({ n, title: `Л-${n} «${load}»`, kind: 'line', cart: q.id, earth: zn.id, up: up.id, lo: lo.id });
  }
  function vtCell(n, x) {
    const up = W([x, B], [x, 11]);
    const q = E('cartdisc', x, 13, 'ТН-10 тележка');                  // (x,11)-(x,15)
    const lo = W([x, 15], [x, 16]);
    E('fuse', x, 17, 'FU ТН-10');                                      // (x,16)-(x,18)
    E('vt', x, 20, 'ТН-10'); W([x, 18], [x, 19]);                      // (x,19)
    room.cells.push({ n, title: 'ТН-10', kind: 'vt', cart: q.id, earth: null, up: up.id, lo: lo.id });
  }
  line(2, 12, 'Котельная', 'load', 600);
  line(3, 20, 'Цех №3', 'load', 900);
  line(4, 28, 'Насосная', 'motor', 400);
  vtCell(5, 36);
  line(6, 44, 'Склад', 'load', 250);
  s.room = room;

  const id = n => s.els.find(e => e.name === n).id, c3 = room.cells[2], q3 = id('В-10 яч.3'), zn3 = id('ЗН яч.3');
  const init = {}, initPos = {};
  for (const e of s.els) { if (isSwitchable(e)) init[e.id] = e.on; if (TYPES[e.t].cart) initPos[e.id] = e.pos; }
  s.tasks.push({
    id: newId(s, 'task'), title: 'Подготовка рабочего места для ремонта выключателя ячейки №3',
    desc: 'Ремонт выключателя В-10 яч.3 (Л-3 «Цех №3»). Выполните технические мероприятия в правильном порядке — руками, предметами со стенда у входа. Цех №3 отключается, остальные потребители не должны терять питание.',
    init, initPos, target: { [q3]: false }, targetPos: { [q3]: 'repair' },
    steps: [
      { op: 'wear', item: 'gloves' }, { op: 'wear', item: 'helmet' },
      { op: 'off', id: q3 }, { op: 'pos', id: q3, pos: 'repair' },
      { op: 'hang', poster: 'nevkl', at: 'drive:3' }, { op: 'lock', at: 'drive:3' },
      { op: 'check', id: c3.lo }, { op: 'on', id: zn3 },
      { op: 'hang', poster: 'zazem', at: 'drive:3' }, { op: 'hang', poster: 'work', at: 'cart:3' },
      { op: 'fence', at: 'zone:3' }, { op: 'hang', poster: 'stop', at: 'fence' },
    ],
    keep: ['Котельная', 'Насосная', 'Склад'].map(id),
    // проверку перед заземлением оценивают мероприятия (с объяснением), а не правило движка — чтобы не считать дважды
    requireCheck: false,
    workCell: 3,
    // этапы технических мероприятий: 0 СИЗ, 1 отключения и видимый разрыв, 2 запрещающий плакат и замок,
    // 3 проверка отсутствия напряжения, 4 заземление, 5 указательные плакаты и ограждение
    // TODO преподаватель: куда в КРУ вешать «Заземлено» (на привод тележки или у ЗН) и «Стой! Напряжение» (ограждение, шторка шин, соседние ячейки)?
    measures: [
      { k: 'ppe', stage: 0 },
      { k: 'off', stage: 1, id: q3 },
      { k: 'rack', stage: 1, id: q3, pos: 'repair', title: 'Выкатить тележку В-10 яч.3 в ремонтное положение (видимый разрыв)' },
      { k: 'sign', stage: 2, poster: 'nevkl', at: ['drive:3', 'door:3'] },
      { k: 'lock', stage: 2, at: ['drive:3'] },
      { k: 'check', stage: 3, wire: c3.lo },
      { k: 'earth', stage: 4, id: zn3, wire: c3.lo },
      { k: 'sign', stage: 5, poster: 'zazem', at: ['drive:3', 'earth:3'] },
      { k: 'sign', stage: 5, poster: 'work', at: ['cart:3'], title: 'Вывесить «Работать здесь» на выкаченную тележку яч.3' },
      { k: 'fence', stage: 5, at: ['zone:3'] },
      { k: 'sign', stage: 5, poster: 'stop', at: ['fence', 'shutter:3', 'door:2', 'door:4'], title: 'Вывесить «Стой! Напряжение» на ограждение или шторку шин яч.3' },
    ],
  });
  return s;
}

const SAMPLES = [
  { key: 'ps110', title: 'ПС 110/10 кВ «Учебная»', make: sampleSubstation },
  { key: 'tp10', title: 'ТП 10/0,4 кВ «Цех»', make: sampleTP },
  { key: 'ps35', title: 'ПС 110/35/10 кВ «Степная»', make: sampleSubstation35 },
  // отдельный пункт в выборе схем: в 3D — помещение ЗРУ с предметами в руках
  { key: 'poly', title: 'VR-полигон: допуск к работе', make: samplePolygon, poly: true },
];

export { defTask, sampleSubstation, sampleTP, sampleSubstation35, samplePolygon, SAMPLES };
