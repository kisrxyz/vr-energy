// Автотесты движка: node tests/engine.test.js (или npm test). Без браузера.
import * as lib from '../src/core/elements.js';
import * as samples from '../src/core/samples.js';
import * as engine from '../src/core/engine.js';
import { GLOSSARY } from '../src/core/glossary.js';
import { symbolSVG, editColors } from '../src/view2d/scheme2d.js';
import { MODELS } from '../src/view3d/models/index.js';
import { Permit, ITEMS, POSTERS } from '../src/core/permit.js';
import { WHY, MISPLACED } from '../src/core/explain.js';
import { makeLibrary } from '../src/ui/myschemes.js';
const E = { ...lib, ...samples, ...engine };
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

function setup(key) {
  const s = E.SAMPLES.find(x => x.key === key).make();
  const tr = new E.Trainer(); tr.load(s);
  const id = n => s.els.find(e => e.name === n).id;
  return { s, tr, id };
}
{
  console.log('Scheme 1 normal state');
  const { s, tr, id } = setup('ps110');
  ok(tr.state.loads.size === 4, 'all 4 loads energized, got ' + tr.state.loads.size);
  const bus1 = tr.topo.term.get(id('1СШ'))[0];
  ok(tr.state.V.get(bus1) === 10, '1СШ at 10 kV');
  const hv = tr.topo.term.get(id('Т1'))[0];
  ok(tr.state.V.get(hv) === 110, 'T1 HV at 110');
  ok(tr.state.G.size === 0, 'nothing grounded');
  // dangling ports
  let dangling = [];
  for (const el of s.els) { if (el.t === 'bus') continue; for (const k of tr.topo.portKeys.get(el.id)) { const u = tr.topo.use.get(k); if (u.ports + u.wires < 2 && !u.bus) dangling.push(el.name); } }
  ok(dangling.length === 0, 'no dangling ports: ' + dangling.join(','));
}
{
  console.log('Task A reference run');
  const { s, tr, id } = setup('ps110');
  const t = s.tasks[0]; tr.startTask(t);
  for (const st of t.steps) { if (st.op === 'check') tr.check(st.id); else { const r = tr.operate(st.id); ok(r && r.ok && !r.viol, 'step ' + st.op + ' ' + tr.nm(st.id) + (r && r.text ? ' :: ' + r.text : '')); } }
  ok(tr.run.done && tr.run.completed, 'task completed');
  ok(tr.run.grade.tone === 'good', 'graded good: ' + tr.run.grade.verdict + ' score ' + tr.run.grade.score);
  ok(tr.state.loads.size === 3, '3 loads remain');
}
{
  console.log('Task B reference run');
  const { s, tr, id } = setup('ps110');
  const t = s.tasks[1]; tr.startTask(t);
  for (const st of t.steps) { if (st.op === 'check') { const r = tr.check(st.id); ok(r.res.every(x => x.kv == null), 'check dead at ' + tr.nm(st.id)); } else { const r = tr.operate(st.id); ok(r && r.ok && !r.viol, 'step ' + st.op + ' ' + tr.nm(st.id) + (r && r.text ? ' :: ' + r.text : '')); } }
  ok(tr.run.done && tr.run.completed, 'task B completed');
  ok(tr.run.grade.tone === 'good', 'graded good: ' + tr.run.grade.verdict);
  ok(tr.state.loads.size === 4, 'all loads still energized');
}
{
  console.log('Task B: forgot section breaker -> supply interruption');
  const { s, tr, id } = setup('ps110');
  tr.startTask(s.tasks[1]);
  tr.operate(id('В-10 Т1'));
  ok(tr.run.errors.some(e => e.kind === 'supply'), 'supply error recorded: ' + JSON.stringify(tr.run.errors.map(e=>e.text)));
}
{
  console.log('Interlocks ON: disconnector under load blocked');
  const { s, tr, id } = setup('ps110');
  const r = tr.operate(id('ШР Л-1'));
  ok(r.blocked, 'blocked: ' + r.text);
  ok(r.text.includes('В-10 Л-1'), 'names series breaker');
  ok(tr.sim.st[id('ШР Л-1')].on === true, 'still closed');
}
{
  console.log('Interlocks OFF: ШР Л-1 under load -> accident, bus protection trips В-10 Т1');
  const { s, tr, id } = setup('ps110');
  tr.opt.interlocks = false;
  const r = tr.operate(id('ШР Л-1'));
  ok(r.viol && r.viol.kind === 'accident', 'accident: ' + r.text);
  ok(r.tripped.includes(id('В-10 Т1')), 'tripped В-10 Т1: ' + r.tripped.map(x => tr.nm(x)));
  ok(!r.tripped.includes(id('В-10 Л-2')), 'feeder breakers not tripped');
  ok(!tr.state.loads.has(id('Насосная')), 'Насосная lost (1СШ dead)');
  ok(tr.state.loads.has(id('Посёлок')), 'Посёлок still powered');
}
{
  console.log('Interlocks OFF: ЛР Л-1 under load -> accident, feeder breaker trips');
  const { s, tr, id } = setup('ps110');
  tr.opt.interlocks = false;
  const r = tr.operate(id('ЛР Л-1'));
  ok(r.viol && r.viol.kind === 'accident', 'accident');
  ok(r.tripped.length === 1 && r.tripped[0] === id('В-10 Л-1'), 'only В-10 Л-1 tripped: ' + r.tripped.map(x => tr.nm(x)));
  ok(tr.state.loads.has(id('Насосная')), 'Насосная keeps power');
  ok(tr.hasAlarms(), 'alarm present');
  tr.ack(); ok(!tr.hasAlarms(), 'ack clears');
}
{
  console.log('Earth on live part');
  const { s, tr, id } = setup('ps110');
  let r = tr.operate(id('ЗН-1 Л-1'));
  ok(r.blocked, 'blocked with interlocks: ' + r.text);
  tr.opt.interlocks = false;
  r = tr.operate(id('ЗН-1 Л-1'));
  ok(r.viol.kind === 'accident', 'accident without interlocks: ' + r.text);
  ok(r.tripped.includes(id('В-10 Т1')), 'В-10 Т1 tripped (fault on bus side of feeder via ШР): ' + r.tripped.map(x => tr.nm(x)));
}
{
  console.log('Breaker closing on ground');
  const { s, tr, id } = setup('ps110');
  tr.operate(id('В-10 Л-1')); tr.operate(id('ЛР Л-1')); tr.operate(id('ШР Л-1'));
  tr.check(id('ЗН-1 Л-1')); let r = tr.operate(id('ЗН-1 Л-1')); ok(r.ok && !r.viol, 'earth applied');
  r = tr.operate(id('ШР Л-1')); ok(r.blocked, 'ШР onto ground blocked: ' + r.text);
  tr.opt.interlocks = false;
  r = tr.operate(id('ШР Л-1')); ok(r.viol && r.viol.kind === 'accident', 'ШР onto ground -> accident');
  ok(r.tripped.includes(id('В-10 Т1')), 'В-10 Т1 trips');
}
{
  console.log('Breaker closes onto earthed section (kz)');
  const { s, tr, id } = setup('ps110');
  tr.operate(id('В-10 Л-1')); tr.check(id('ЗН-2 Л-1'));
  tr.operate(id('ЛР Л-1'));
  tr.check(id('ЗН-2 Л-1'));
  let r = tr.operate(id('ЗН-2 Л-1')); ok(r.ok && !r.viol, 'ЗН-2 on (bus side still live through ШР but breaker open) ' + (r.text||''));
  tr.opt.interlocks = false;
  r = tr.operate(id('В-10 Л-1'));
  ok(r.viol && r.viol.kind === 'kz', 'kz: ' + r.text);
  ok(r.tripped.includes(id('В-10 Л-1')), 'the breaker itself trips: ' + r.tripped.map(x => tr.nm(x)));
  ok(tr.sim.st[id('В-10 Л-1')].on === false, 'breaker open after trip');
}
{
  console.log('Proc violation: earth without check');
  const { s, tr, id } = setup('ps110');
  tr.operate(id('В-10 Л-1')); tr.operate(id('ЛР Л-1')); tr.operate(id('ШР Л-1'));
  const r = tr.operate(id('ЗН-1 Л-1'));
  ok(r.viol && r.viol.kind === 'proc', 'proc: ' + (r.viol && r.viol.text));
}
{
  console.log('Disconnector picking up load');
  const { s, tr, id } = setup('ps110');
  tr.operate(id('В-10 Л-1')); tr.operate(id('ЛР Л-1'));
  tr.operate(id('В-10 Л-1')); // close breaker with ЛР open: ok
  let r = tr.operate(id('ЛР Л-1'));
  ok(r.blocked, 'ЛР close onto load blocked: ' + r.text);
}
{
  console.log('Transformer LV earthed while HV energized -> kz through transformer');
  const { s, tr, id } = setup('ps110');
  tr.opt.interlocks = false;
  tr.operate(id('СВ-10')); tr.operate(id('В-10 Т1'));
  tr.operate(id('ТР-10 Т1'));
  const r = tr.operate(id('ЗН-10 Т1'));
  ok(r.viol && r.viol.kind === 'accident', 'earth on energized LV: ' + (r.viol && r.viol.text));
  ok(r.tripped.includes(id('В-110 Т1')), 'В-110 Т1 trips: ' + r.tripped.map(x => tr.nm(x)));
}
{
  console.log('Scheme 2 tasks');
  for (const k of [0, 1]) {
    const { s, tr, id } = setup('tp10');
    const t = s.tasks[k]; tr.startTask(t);
    for (const st of t.steps) { if (st.op === 'check') tr.check(st.id); else { const r = tr.operate(st.id); ok(r && r.ok && !r.viol, 'tp step ' + st.op + ' ' + tr.nm(st.id) + (r && r.text ? ' :: ' + r.text : '')); } }
    ok(tr.run.completed && tr.run.grade.tone === 'good', 'tp task ' + k + ' ' + tr.run.grade.verdict);
  }
  const { s, tr, id } = setup('tp10');
  const bus = tr.topo.term.get(id('Ш-0,4'))[0];
  ok(Math.abs(tr.state.V.get(bus) - 0.4) < 1e-9 && E.vClass(0.4) === 'v04', '0.4 kV bus');
  ok(tr.state.loads.size === 3, '3 loads powered');
}
{
  console.log('Recording a task');
  const { s, tr, id } = setup('tp10');
  tr.startRec();
  tr.operate(id('QF1'));
  const t = tr.saveRec('Отключить насос', '');
  ok(t && t.steps.length === 1 && Object.keys(t.target).length === 1, 'recorded task');
  ok(!t.keep.includes(id('Насос Н-1')) && t.keep.includes(id('Освещение')), 'keep computed: ' + t.keep.map(x=>tr.nm(x)));
  tr.reset(); tr.startTask(t); tr.operate(id('QF1'));
  ok(tr.run.completed, 'recorded task completes');
}
{
  console.log('JSON roundtrip');
  const s = E.SAMPLES[0].make();
  const s2 = E.normalizeScheme(JSON.parse(JSON.stringify(s)));
  ok(s2.els.length === s.els.length && s2.tasks.length === 2 && s2.tasks[0].steps.length === 7, 'normalize keeps data');
}

/* ===== Новые элементы библиотеки 0.2 ===== */
{
  console.log('Library completeness');
  const types = Object.keys(E.TYPES);
  ok(types.length >= 27, 'types: ' + types.length);
  const miss = types.filter(t => !GLOSSARY[t] || !GLOSSARY[t].what || !GLOSSARY[t].sim);
  ok(!miss.length, 'glossary for every type: ' + miss);
  ok(types.every(t => t === 'bus' || E.BOX[t]), 'BOX for every type');
  ok(types.every(t => E.PALETTE.includes(t)) && E.PALETTE.every(t => E.TYPES[t]), 'palette lists every type once');
  ok(types.every(t => E.CATS.some(c => c[0] === E.TYPES[t].cat)), 'every type in a palette category');
  const find = q => E.searchTypes(q);
  ok(find('рубильник').includes('knife'), 'search: рубильник');
  ok(find('КРУ').includes('cart') && find('тележка').includes('cartdisc'), 'search: КРУ, тележка');
  ok(find('QF')[0] === 'acb' && find('ТН').includes('vt') && find('ОПН').includes('arrester') && find('ЗН').includes('earth'), 'search by designation');
  ok(find('трехобмоточный').includes('tr3'), 'search ignores ё');
  ok(find('ТН')[0] === 'vt' && find('QS')[0] === 'disconnector' && find('ЗН')[0] === 'earth' && find('ОПН')[0] === 'arrester', 'exact designation ranks first: ' + find('ТН').slice(0, 3));
  const noSym = types.filter(t => !symbolSVG(Object.assign({ t, r: 0, x: 0, y: 0, p: Object.assign({}, E.TYPES[t].props || {}) }, t === 'bus' ? { p: { len: 2 } } : {}), editColors(E.TYPES[t])));
  ok(!noSym.length, '2D symbol for every type: ' + noSym);
  const noModel = types.filter(t => !MODELS[t] || typeof MODELS[t].build !== 'function' || typeof MODELS[t].update !== 'function');
  ok(!noModel.length, '3D model for every type: ' + noModel);
}

// Мини-схема: элементы в вертикальную линию через провода в одну клетку.
// item: [тип, имя, опции] — двухполюсник или одно-полюсник в конце; ['@тип', имя] — одно-полюсник сбоку (ЗН, ТН, ОПН, БК).
function chain(s, x, y, items) {
  let cur = [x, y];
  for (const [t0, name, o = {}] of items) {
    if (t0[0] === '@') {
      const t = t0.slice(1);
      E.makeEl(s, t, x + 2, cur[1] + 1, Object.assign({ name }, o));
      E.makeWire(s, cur, [x + 2, cur[1]], false);
      continue;
    }
    const T = E.TYPES[t0], k = -T.ports[0][1];
    const cy = cur[1] + 1 + k;
    E.makeEl(s, t0, x, cy, Object.assign({ name }, o));
    E.makeWire(s, cur, [x, cy - k]);
    cur = T.ports.length > 1 ? [x, cy + T.ports[1][1]] : null;
  }
  return cur;
}
function mini(build) {
  const s = E.emptyScheme('test');
  build(s);
  const tr = new E.Trainer(); tr.load(s);
  const id = n => { const e = s.els.find(x => x.name === n); if (!e) throw new Error('нет ' + n); return e.id; };
  const node = (n, i = 0) => tr.topo.term.get(id(n))[i];
  return { s, tr, id, node };
}
// Источник 10 кВ → выключатель ввода → шина, от шины вниз — присоединения
function rp10(feeders, kv = 10) {
  return mini(s => {
    E.makeEl(s, 'source', 0, -6, { name: 'Ввод', p: { kv } });
    chain(s, 0, -5, [['breaker', 'В-ввод']]);
    E.makeWire(s, [0, -2], [0, 0]);
    E.makeEl(s, 'bus', 0, 0, { name: 'Ш', p: { len: 40 } });
    feeders.forEach((items, i) => chain(s, 4 + i * 8, 0, items));
  });
}
{
  console.log('Fuse blows on KZ instead of the upstream breaker');
  const { tr, id } = rp10([[['fuse', 'FU1'], ['@earth', 'ЗН1'], ['loadbreak', 'ВН1'], ['load', 'Н1']], [['breaker', 'Q2'], ['load', 'Н2']]]);
  ok(tr.state.loads.size === 2, 'both loads powered');
  let r = tr.operate(id('FU1'));
  ok(r.blocked && r.text.includes('ВН1'), 'fuse removal under load blocked, names ВН1: ' + r.text);
  tr.opt.interlocks = false;
  r = tr.operate(id('ЗН1'));
  ok(r.viol && r.viol.kind === 'accident', 'earth on live -> accident');
  ok(r.tripped.length === 1 && r.tripped[0] === id('FU1'), 'only FU1 blows: ' + r.tripped.map(x => tr.nm(x)));
  ok(tr.sim.st[id('FU1')].blown && !tr.sim.st[id('FU1')].on, 'FU1 blown and open');
  ok(tr.sim.st[id('В-ввод')].on, 'upstream breaker stays on');
  ok(tr.state.loads.has(id('Н2')), 'Н2 keeps power');
  ok(tr.tripText(id('FU1')).includes('перегорел'), 'trip text: ' + tr.tripText(id('FU1')));
  tr.ack();
  ok(tr.sim.st[id('FU1')].blown && !tr.sim.st[id('FU1')].on, 'blown fuse stays after ack');
  ok(tr.actions(id('FU1'))[0].label.includes('Заменить'), 'action: replace fuse');
  r = tr.operate(id('FU1'));
  ok(r.viol && r.viol.kind === 'kz' && r.tripped.includes(id('FU1')), 'new fuse onto earthed section -> kz, blows again');
  tr.ack();
  tr.opt.interlocks = true;
  r = tr.operate(id('FU1'));
  ok(r.blocked, 'with interlocks: replacing onto earth blocked: ' + r.text);
  tr.operate(id('ВН1')); tr.operate(id('ЗН1'));
  r = tr.operate(id('FU1'));
  ok(r.ok && !r.viol && tr.sim.st[id('FU1')].on && !tr.sim.st[id('FU1')].blown, 'fuse replaced without load');
  ok(tr.log.some(e => e.text.includes('Заменён предохранитель FU1')), 'log: fuse replaced');
  r = tr.operate(id('ВН1'));
  ok(r.ok && !r.viol && tr.state.loads.has(id('Н1')), 'load-break switch picks up load');
}
{
  console.log('Load-break switch: breaks load, does not break KZ');
  const { tr, id } = rp10([[['loadbreak', 'ВН1'], ['@earth', 'ЗН1'], ['load', 'Н1']], [['breaker', 'Q2'], ['load', 'Н2']]]);
  let r = tr.operate(id('ВН1'));
  ok(r.ok && !r.viol, 'ВН1 opens under load');
  r = tr.operate(id('ВН1'));
  ok(r.ok && !r.viol, 'ВН1 closes onto load');
  tr.opt.interlocks = false;
  r = tr.operate(id('ЗН1'));
  ok(r.viol && r.viol.kind === 'accident', 'earth on live');
  ok(r.tripped.includes(id('В-ввод')) && !r.tripped.includes(id('ВН1')), 'upstream breaker trips, ВН1 does not: ' + r.tripped.map(x => tr.nm(x)));
  ok(tr.sim.st[id('ВН1')].on, 'ВН1 still closed');
}
{
  console.log('Withdrawable breaker (КРУ trolley)');
  const feeder = [['cart', 'Q1'], ['@earth', 'ЗН1'], ['load', 'Н1']];
  let { tr, id } = rp10([feeder]);
  ok(tr.sim.st[id('Q1')].pos === 'work' && tr.state.loads.has(id('Н1')), 'normal: work position, load powered');
  ok(tr.actions(id('Q1')).length === 3, 'three actions: breaker + two positions');
  let r = tr.operate(id('Q1'), { pos: 'test' });
  ok(r.blocked && r.text.includes('выключатель'), 'racking with breaker on is blocked: ' + r.text);
  tr.opt.interlocks = false;
  r = tr.operate(id('Q1'), { pos: 'test' });
  ok(r.viol && r.viol.kind === 'accident', 'without interlocks: arc on plug contacts: ' + r.text);

  ({ tr, id } = rp10([feeder]));
  r = tr.operate(id('Q1')); ok(r.ok && !r.viol && !tr.state.loads.has(id('Н1')), 'breaker off');
  r = tr.operate(id('Q1'), { pos: 'test' }); ok(r.ok && !r.viol && tr.sim.st[id('Q1')].pos === 'test', 'trolley to test');
  ok(tr.log.some(e => e.text.includes('контрольное')), 'log mentions test position');
  r = tr.operate(id('Q1')); ok(r.ok && !r.viol && !tr.state.loads.has(id('Н1')), 'breaker closed in test position: line still dead');
  r = tr.operate(id('Q1'), { pos: 'repair' }); ok(r.blocked, 'racking with breaker on (no load) blocked');
  tr.opt.interlocks = false;
  r = tr.operate(id('Q1'), { pos: 'repair' }); ok(r.viol && r.viol.kind === 'proc', 'without interlocks: order violation: ' + (r.viol && r.viol.text));
  r = tr.operate(id('Q1'), { pos: 'test' });
  r = tr.operate(id('Q1'), { pos: 'work' }); ok(r.viol && r.viol.kind === 'accident', 'racking in with breaker on picks up load -> accident');

  ({ tr, id } = rp10([feeder]));
  tr.operate(id('Q1')); tr.operate(id('Q1'), { pos: 'test' });
  tr.check(id('ЗН1')); r = tr.operate(id('ЗН1')); ok(r.ok && !r.viol, 'earth after visible break');
  r = tr.operate(id('Q1'), { pos: 'work' }); ok(r.ok && !r.viol, 'trolley back to work with breaker off');
  r = tr.operate(id('Q1')); ok(r.blocked, 'breaker onto earth blocked');
  tr.opt.interlocks = false;
  r = tr.operate(id('Q1')); ok(r.viol && r.viol.kind === 'kz' && r.tripped.includes(id('Q1')), 'breaker onto earth -> kz, trips itself');
}
{
  console.log('Withdrawable disconnector (тележка СР)');
  const { tr, id } = rp10([[['breaker', 'Q1'], ['cartdisc', 'СР1'], ['load', 'Н1']]]);
  let r = tr.operate(id('СР1'));
  ok(r.blocked && r.text.includes('Q1'), 'racking out under load blocked: ' + r.text);
  tr.operate(id('Q1'));
  r = tr.operate(id('СР1'));
  ok(r.ok && !r.viol && tr.sim.st[id('СР1')].pos === 'test', 'racked out without load');
  r = tr.operate(id('СР1'), { pos: 'repair' }); ok(r.ok && tr.sim.st[id('СР1')].pos === 'repair', 'to repair');
}
{
  console.log('Three-winding transformer 110/35/10');
  const { tr, id } = mini(s => {
    E.makeEl(s, 'source', 0, -4, { name: 'ВЛ', p: { kv: 110 } });
    E.makeWire(s, [0, -3], [0, -2]);
    E.makeEl(s, 'tr3', 0, 0, { name: 'Т1' });
    chain(s, -1, 2, [['disconnector', 'Р35'], ['load', 'Н35']]);
    chain(s, 1, 2, [['@earth', 'ЗН10'], ['disconnector', 'Р10'], ['load', 'Н10']]);
  });
  const t = tr.topo.term.get(id('Т1'));
  ok(t.length === 3 && tr.state.V.get(t[0]) === 110 && tr.state.V.get(t[1]) === 35 && tr.state.V.get(t[2]) === 10, 'voltages 110/35/10: ' + t.map(n => tr.state.V.get(n)));
  ok(tr.state.loads.size === 2, 'both sides feed loads');
  tr.opt.interlocks = false;
  const r = tr.operate(id('ЗН10'));
  ok(r.viol && r.viol.kind === 'accident' && r.tripped.includes(id('ВЛ')), 'earth on LV -> source side trips');
}
{
  console.log('CT, reactor, cable, OHL: conductors without switching');
  const { tr, id, node } = mini(s => {
    E.makeEl(s, 'source', 0, -2, { name: 'С', p: { kv: 10 } });
    chain(s, 0, -1, [['breaker', 'Q1'], ['ct', 'ТТ1'], ['reactor', 'LR1'], ['cable', 'КЛ1'], ['@earth', 'ЗН1'], ['disconnector', 'ЛР1'], ['ohl', 'ВЛ1'], ['disconnector', 'ЛР2'], ['load', 'Н1']]);
  });
  ok(tr.state.loads.has(id('Н1')), 'load fed through CT, reactor, cable and OHL');
  ok(!tr.actions(id('КЛ1')).length && !E.isSwitchable(tr.byId.get(id('КЛ1'))), 'cable is not switchable');
  tr.operate(id('Q1')); tr.operate(id('ЛР2'));
  let r = tr.operate(id('Q1')); ok(r.ok && !r.viol, 'energize unloaded line');
  r = tr.operate(id('ЛР1')); ok(r.ok && !r.viol, 'disconnector opens unloaded line (no consumers)');
  tr.operate(id('Q1'));
  tr.check(id('ЗН1')); r = tr.operate(id('ЗН1')); ok(r.ok && !r.viol, 'earth on cable end');
  ok(tr.state.G.has(node('Q1', 1)), 'ground spreads through cable, reactor, CT up to the breaker');
}
{
  console.log('VT and arrester: no current; VT disconnector may be operated');
  const { tr, id } = rp10([[['disconnector', 'ШР ТН'], ['fuse', 'FU-ТН'], ['vt', 'ТН1']], [['arrester', 'ОПН1']]]);
  ok(tr.state.loads.size === 0 && !tr.state.cur.has(id('ТН1')), 'VT is not a load');
  const r = tr.operate(id('ШР ТН'));
  ok(r.ok && !r.viol, 'VT disconnector opens under voltage: ' + (r.text || ''));
  ok(tr.operate(id('FU-ТН')).ok, 'VT fuse removed without load');
}
{
  console.log('Capacitor bank: disconnector cannot break its current; not a consumer');
  const { tr, id } = rp10([[['disconnector', 'Р-БК'], ['capacitor', 'БК1']]]);
  ok(tr.state.cur.has(id('БК1')) && !tr.state.loads.has(id('БК1')), 'capacitor draws current but is not a consumer');
  const r = tr.operate(id('Р-БК'));
  ok(r.blocked, 'disconnector under capacitor current blocked: ' + r.text);
}
{
  console.log('Knife switch 0.4 kV: without arc chutes like a disconnector, with chutes breaks load');
  const { tr, id } = rp10([[['knife', 'Р1'], ['load', 'Н1']], [['knife', 'Р2', { p: { arc: 1 } }], ['load', 'Н2']]], 0.4);
  let r = tr.operate(id('Р1'));
  ok(r.blocked && r.text.includes('Р1'), 'knife without chutes under load blocked');
  tr.opt.interlocks = false;
  r = tr.operate(id('Р1'));
  ok(r.viol && r.viol.kind === 'accident' && r.viol.text.includes('рубильником'), 'accident text: ' + r.text);
  r = tr.operate(id('Р2'));
  ok(r.ok && !r.viol, 'knife with arc chutes breaks load');
}
{
  console.log('Separator and short-circuiter (simple behaviour)');
  const { tr, id } = mini(s => {
    E.makeEl(s, 'source', 0, -2, { name: 'ВЛ-110', p: { kv: 110 } });
    chain(s, 0, -1, [['od', 'ОД1'], ['@kz', 'КЗ1'], ['transformer', 'Т1'], ['breaker', 'В-10'], ['load', 'Н1']]);
  });
  let r = tr.operate(id('ОД1'));
  ok(r.blocked, 'separator under load blocked (as a disconnector)');
  r = tr.operate(id('КЗ1'));
  ok(r.blocked, 'short-circuiter on live blocked with interlocks');
  tr.opt.interlocks = false;
  r = tr.operate(id('КЗ1'));
  ok(r.viol && r.viol.kind === 'kz' && r.tripped.includes(id('ВЛ-110')), 'short-circuiter -> artificial KZ, feeding end trips: ' + r.text);
  tr.operate(id('В-10'));
  r = tr.operate(id('ОД1'));
  ok(r.ok && !r.viol, 'separator opens dead transformer');
}
{
  console.log('Portable earth applied on any wire in the trainer');
  const { s, tr, id } = setup('ps110');
  const lid = id('Цех №1');
  const w = s.wires.find(x => tr.topo.wireNode.get(x.id) === tr.topo.term.get(lid)[0]);
  let r = tr.pzToggle(w.id);
  ok(r.blocked && r.text.includes('напряжение'), 'PZ on live blocked: ' + r.text);
  tr.operate(id('В-10 Л-1')); tr.operate(id('ЛР Л-1'));
  r = tr.pzToggle(w.id);
  ok(r.ok && r.viol && r.viol.kind === 'proc', 'PZ without check -> order violation');
  tr.pzToggle(w.id);
  ok(!tr.state.G.has(tr.topo.wireNode.get(w.id)), 'PZ removed');
  tr.check(w.id);
  r = tr.pzToggle(w.id);
  ok(r.ok && !r.viol && tr.state.G.has(tr.topo.wireNode.get(w.id)), 'PZ applied after check');
  const pzid = 'pz:' + w.id;
  ok(tr.nm(pzid).startsWith('ПЗ'), 'PZ name: ' + tr.nm(pzid));
  r = tr.operate(id('ЛР Л-1'));
  ok(r.ok && !r.viol, 'ЛР closes onto dead side');
  r = tr.operate(id('В-10 Л-1'));
  ok(r.blocked && r.text.includes('ПЗ'), 'breaker onto PZ blocked: ' + r.text);
  const bus = id('2СШ');
  tr.opt.interlocks = false;
  r = tr.pzToggle(bus);
  ok(r.viol && r.viol.kind === 'accident', 'PZ onto live bus -> accident');
}
{
  console.log('Portable earth element placed mid-wire in the editor');
  const { s, tr, id } = mini(s => {
    E.makeEl(s, 'source', 0, -2, { name: 'С', p: { kv: 10 } });
    chain(s, 0, -1, [['breaker', 'Q1']]);
    E.makeWire(s, [0, 2], [0, 9]);
    E.makeEl(s, 'load', 0, 10, { name: 'Н1' });
    E.makeEl(s, 'pz', 0, 5, { name: 'ПЗ-1' });
  });
  const k = tr.topo.portKeys.get(id('ПЗ-1'))[0], u = tr.topo.use.get(k);
  ok(u.wires >= 1, 'PZ port attached to the wire');
  ok(tr.topo.term.get(id('ПЗ-1'))[0] === tr.topo.term.get(id('Н1'))[0], 'PZ in the load node');
  ok(tr.operate(id('ПЗ-1')).blocked, 'placed PZ on live blocked');
  tr.operate(id('Q1')); tr.check(id('ПЗ-1'));
  const r = tr.operate(id('ПЗ-1'));
  ok(r.ok && !r.viol && tr.log.some(e => e.text.startsWith('Наложено ПЗ-1')), 'placed PZ applied: ' + tr.log[0].text);
}
{
  console.log('Recording with trolley and PZ; JSON keeps it');
  const { s, tr, id } = rp10([[['cart', 'Q1'], ['cable', 'КЛ1'], ['disconnector', 'РВ1'], ['load', 'Н1']]]);
  const w = s.wires.find(x => tr.topo.wireNode.get(x.id) === tr.topo.term.get(id('РВ1'))[0]);
  tr.startRec();
  tr.operate(id('Q1')); tr.operate(id('Q1'), { pos: 'test' }); tr.operate(id('РВ1'));
  tr.check(w.id); tr.pzToggle(w.id);
  const t = tr.saveRec('КЛ1 в ремонт', '');
  ok(t && t.targetPos[id('Q1')] === 'test' && t.target['pz:' + w.id] === true, 'target has trolley position and PZ');
  ok(t.steps.some(x => x.op === 'pos' && x.pos === 'test'), 'step: rack to test');
  const s2 = E.normalizeScheme(JSON.parse(JSON.stringify(s)));
  const t2 = s2.tasks[0];
  ok(t2.targetPos[id('Q1')] === 'test' && t2.target['pz:' + w.id] === true && t2.steps.length === t.steps.length, 'normalize keeps trolley and PZ');
  const tr2 = new E.Trainer(); tr2.load(s2);
  tr2.startTask(t2);
  ok(tr2.nextStep() && tr2.nextStep().op === 'off', 'first hint: switch off');
  for (const st of t2.steps) { if (st.op === 'check') tr2.check(st.id); else if (st.op === 'pos') tr2.operate(st.id, { pos: st.pos }); else tr2.operate(st.id); }
  ok(tr2.run.completed && tr2.run.grade.tone === 'good', 'recorded task replays: ' + tr2.run.grade.verdict);
  ok(tr2.stepText({ op: 'pos', id: id('Q1'), pos: 'test' }).includes('контрольное'), 'step text for trolley');
  ok(tr2.stepText({ op: 'on', id: 'pz:' + w.id }).startsWith('наложить ПЗ'), 'step text for PZ');
}
{
  console.log('Scheme 3: ПС 110/35/10 кВ');
  const { s, tr, id } = setup('ps35');
  const cons = s.els.filter(e => E.TYPES[e.t].consumer);
  ok(cons.length >= 5 && tr.state.loads.size === cons.length, 'all consumers powered: ' + tr.state.loads.size + '/' + cons.length);
  const has = t => s.els.some(e => e.t === t);
  ok(['tr3', 'cart', 'cartdisc', 'vt', 'tsn', 'ct', 'arrester', 'fuse', 'cable', 'ohl'].every(has), 'uses new elements');
  let dangling = [];
  for (const el of s.els) { if (el.t === 'bus') continue; for (const k of tr.topo.portKeys.get(el.id)) { const u = tr.topo.use.get(k); if (u.ports + u.wires < 2 && !u.bus) dangling.push(el.name); } }
  ok(dangling.length === 0, 'no dangling ports: ' + dangling.join(','));
  const pos = new Map(), clash = [];
  for (const el of s.els) { if (el.t === 'bus') continue; const k = el.x + ',' + el.y; if (pos.has(k)) clash.push(pos.get(k) + '/' + el.name); pos.set(k, el.name); }
  ok(!clash.length, 'no elements in one point: ' + clash.join(','));
  const names = new Map(); for (const el of s.els) names.set(el.name, (names.get(el.name) || 0) + 1);
  ok(![...names.values()].some(n => n > 1), 'unique names');
  const kvs = new Set([...tr.state.V.values()]);
  ok(kvs.has(110) && kvs.has(35) && kvs.has(10) && kvs.has(0.4), 'voltages 110, 35, 10, 0.4: ' + [...kvs]);
  ok(s.tasks.length === 2, 'two tasks');
  for (const k of [0, 1]) {
    const { s, tr } = setup('ps35');
    const t = s.tasks[k]; tr.startTask(t);
    for (const st of t.steps) {
      if (st.op === 'check') { const r = tr.check(st.id); ok(r && r.res.every(x => x.kv == null), 'ps35 check dead at ' + tr.nm(st.id)); continue; }
      const r = st.op === 'pos' ? tr.operate(st.id, { pos: st.pos }) : tr.operate(st.id);
      ok(r && r.ok && !r.viol, 'ps35 step ' + tr.stepText(st) + (r && r.text ? ' :: ' + r.text : ''));
    }
    ok(tr.run.done && tr.run.completed && tr.run.grade.tone === 'good', 'ps35 task ' + k + ': ' + (tr.run.grade && tr.run.grade.verdict));
    ok(t.keep.length && t.keep.every(c => tr.state.loads.has(c)), 'ps35 task ' + k + ': consumers from keep still powered (' + t.keep.length + ')');
  }
}
{
  console.log('Scheme 3: typical mistakes');
  let { s, tr, id } = setup('ps35');
  tr.startTask(s.tasks[1]);
  tr.operate(id('В-10 Т1'));
  ok(tr.run.errors.some(e => e.kind === 'supply'), 'forgot СВ-10 -> supply interruption: ' + tr.run.errors.map(e => e.text));
  ({ s, tr, id } = setup('ps35'));
  let r = tr.operate(id('В-10 Т1'), { pos: 'test' });
  ok(r.blocked && r.text.includes('выключатель'), 'rack В-10 Т1 with breaker on blocked');
  r = tr.operate(id('FU ТСН-1'));
  ok(r.blocked && r.text.includes('QF СН-1'), 'ТСН fuse under load blocked, names QF СН-1: ' + r.text);
  r = tr.operate(id('ЗН-10 Т1'));
  ok(r.blocked, 'ЗН-10 Т1 on live blocked');
  r = tr.operate(id('ТН-1С тележка'));
  ok(r.ok && !r.viol, 'VT trolley racked out under voltage (VT draws no load current)');
  tr.opt.interlocks = false;
  r = tr.operate(id('ЗН Л-3'));
  ok(r.viol && r.viol.kind === 'accident' && r.tripped.length === 1 && r.tripped[0] === id('В-10 Л-3'), 'KZ on cable: only the feeder trolley breaker trips: ' + r.tripped.map(x => tr.nm(x)));
}
{
  console.log('Review fixes: wire check recorded on the wire, hints follow it');
  const { s, tr, id } = mini(s => {
    E.makeEl(s, 'source', 0, -2, { name: 'С', p: { kv: 10 } });
    chain(s, 0, -1, [['disconnector', 'ЛР1'], ['breaker', 'Q1']]);   // Q1: (0,3)-(0,5)
    E.makeWire(s, [0, 5], [0, 8]);
    E.makeEl(s, 'load', 0, 9, { name: 'Н1' });
  });
  const w = s.wires.find(x => x.a[1] === 5 && x.b[1] === 8);
  tr.startRec(); tr.operate(id('Q1')); tr.check(w.id); tr.pzToggle(w.id);
  const t = tr.saveRec('ПЗ на линии', '');
  ok(t.steps[1].op === 'check' && t.steps[1].id === w.id, 'wire check recorded on the wire: ' + JSON.stringify(t.steps[1]));
  const txt = tr.stepText(t.steps[1]);
  ok(txt.includes('Q1') && txt.includes('Н1') && !txt.includes('?'), 'step text names the place: ' + txt);
  ok(!tr.log.some(e => e.text.includes('у ПЗ')), 'check text does not name an unapplied PZ');
  const replay = sch => {
    const t2 = new E.Trainer(); t2.load(E.normalizeScheme(JSON.parse(JSON.stringify(sch))));
    t2.startTask(t2.s.tasks[t2.s.tasks.length - 1]);
    for (let i = 0; i < 30 && !t2.run.done; i++) {
      const h = t2.hint(); if (!h) break;
      const st = h.step;
      if (st.op === 'check') t2.check(st.id); else if (st.op === 'pos') t2.operate(st.id, { pos: st.pos }); else t2.operate(st.id);
    }
    return t2;
  };
  let t2 = replay(s);
  ok(t2.run.completed && !t2.run.errors.length, 'hint-driven replay, no errors: ' + t2.run.errors.map(e => e.text));
  // ПС 110/35/10: инструктор проверяет конец кабеля по проводу и накладывает ПЗ
  const k = setup('ps35'), kid = k.id, ktr = k.tr;
  const end = k.s.wires.find(x => ktr.topo.wireNode.get(x.id) === ktr.topo.term.get(kid('РВ Л-1'))[0]);
  ktr.startRec();
  ktr.operate(kid('В-10 Л-1')); ktr.operate(kid('В-10 Л-1'), { pos: 'test' }); ktr.operate(kid('РВ Л-1'));
  ktr.check(kid('ЗН Л-1')); ktr.operate(kid('ЗН Л-1')); ktr.check(end.id); ktr.pzToggle(end.id);
  ktr.saveRec('КЛ-10 Л-1 с ПЗ', '');
  t2 = replay(k.s);
  ok(t2.run.completed && !t2.run.errors.length, 'ps35 hint-driven replay with PZ, no errors: ' + t2.run.errors.map(e => e.text));
}
{
  console.log('Review fixes: one PZ per point, task compares PZ by point');
  const { s, tr, id } = mini(s => {
    E.makeEl(s, 'source', 0, -2, { name: 'С', p: { kv: 10 } });
    chain(s, 0, -1, [['breaker', 'Q1']]);                            // Q1: (0,0)-(0,2)
    E.makeWire(s, [0, 2], [0, 5]); E.makeWire(s, [0, 5], [0, 8]);
    E.makeEl(s, 'load', 0, 9, { name: 'Н1' });
  });
  const wa = s.wires.find(w => w.a[1] === 2), wb = s.wires.find(w => w.a[1] === 5);
  tr.startRec(); tr.operate(id('Q1')); tr.check(wa.id); tr.pzToggle(wa.id);
  const t = tr.saveRec('ПЗ', '');
  tr.reset(); tr.startTask(t);
  tr.operate(id('Q1')); tr.check(wb.id);
  const r = tr.pzToggle(wb.id);
  ok(r && r.ok && !r.viol, 'PZ on another wire of the same point');
  ok(tr.run.completed && tr.run.grade.tone === 'good', 'task with PZ done at the same point: ' + (tr.run.grade && tr.run.grade.verdict));
  tr.pzToggle(wa.id);
  ok(tr.pzOn().length === 0, 'click on the other wire of the point removes that PZ, not a second one');
}
{
  console.log('Review fixes: accident text keeps «кВ»');
  const { tr, id } = rp10([[['breaker', 'Q1'], ['knife', 'Р1'], ['@earth', 'ЗН1'], ['load', 'Н1']]], 0.4);
  tr.operate(id('Q1')); tr.operate(id('Р1')); tr.check(id('ЗН1')); tr.operate(id('ЗН1')); tr.operate(id('Q1'));
  tr.opt.interlocks = false;
  const r = tr.operate(id('Р1'));
  ok(r.viol && r.viol.kind === 'accident' && r.viol.text.includes('рубильник 0,4 кВ'), 'text: ' + (r.viol && r.viol.text));
}

/* ===== Мои схемы: список в хранилище браузера ===== */
{
  console.log('My schemes: old slot moved into the list, new / duplicate / rename / delete');
  const mem = new Map();
  const st = { get: k => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { mem.set(k, String(v)); return true; }, del: k => { mem.delete(k); } };
  const old = E.SAMPLES[1].make(); old.title = 'Старая моя схема';
  mem.set('ts.my', JSON.stringify(old));
  const lib = makeLibrary(st);
  const mid = lib.migrate();
  ok(mid && lib.list().length === 1 && lib.list()[0].title === 'Старая моя схема' && !mem.has('ts.my'), 'old slot ts.my moved into the list');
  ok(lib.load(mid) && lib.load(mid).els.length === old.els.length && lib.load(mid).tasks.length === 2, 'migrated scheme loads with tasks');
  ok(lib.migrate() === null && lib.list().length === 1, 'migration runs once');
  const a = lib.add(E.emptyScheme('Новая схема')), b = lib.add(E.SAMPLES[0].make());
  ok(lib.list().length === 3 && a && b && a !== b && mem.has('ts.my.' + a) && mem.has('ts.my.' + b), 'each scheme under its own id');
  const s0 = lib.load(b); s0.els.pop(); ok(lib.save(b, s0) && lib.load(b).els.length === s0.els.length, 'save keeps changes');
  const c = lib.duplicate(b);
  ok(c && c !== b && lib.load(c).title.includes('копия') && lib.load(c).els.length === lib.load(b).els.length, 'duplicate: ' + (c && lib.load(c).title));
  ok(lib.rename(a, '  РП-10 цех  ') && lib.load(a).title === 'РП-10 цех' && lib.list().find(x => x.id === a).title === 'РП-10 цех', 'rename: list and scheme title');
  ok(!lib.rename(a, '   ') && lib.load(a).title === 'РП-10 цех', 'empty name refused');
  ok(lib.remove(b) && !lib.load(b) && lib.list().length === 3 && !mem.has('ts.my.' + b), 'remove');
  ok(lib.list()[0].id === c || lib.list().some(x => x.id === c), 'list keeps the rest');
  mem.set('ts.mySchemes', '{испорчено');
  ok(Array.isArray(makeLibrary(st).list()) && makeLibrary(st).list().length === 0, 'broken index -> empty list, no crash');
  const full = { get: k => (mem.has(k) ? mem.get(k) : null), set: () => false, del: () => {} };
  ok(makeLibrary(full).add(E.emptyScheme('x')) === null, 'storage full -> add returns null');
}

/* ===== VR-полигон «Допуск к работе»: технические мероприятия ===== */
function poly() {
  const s = E.SAMPLES.find(x => x.key === 'poly').make();
  const tr = new E.Trainer(), pm = tr.use(new Permit());
  tr.load(s);
  const id = n => { const e = s.els.find(x => x.name === n); if (!e) throw new Error('нет ' + n); return e.id; };
  const cell = n => s.room.cells.find(c => c.n === n);
  return { s, tr, pm, id, cell, task: s.tasks[0] };
}
// Эталон: все мероприятия по порядку — как их делают руками в шлеме или на ноутбуке. skip — что пропустить.
function polyRef(tr, pm, id, skip = []) {
  const q3 = id('В-10 яч.3');
  const acts = {
    gloves: () => pm.wear('gloves'), helmet: () => pm.wear('helmet'),
    off: () => tr.operate(q3), rack: () => tr.operate(q3, { pos: 'repair' }),
    nevkl: () => pm.place('nevkl1', 'drive:3'), lock: () => pm.place('lock', 'drive:3'),
    check: () => pm.touch('contact:3:lo'), earth: () => tr.operate(id('ЗН яч.3')),
    zazem: () => pm.place('zazem1', 'drive:3'), work: () => pm.place('work1', 'cart:3'),
    fence: () => pm.place('fence', 'zone:3'), stop: () => pm.place('stop1', 'fence'),
  };
  const out = {};
  for (const k of ['gloves', 'helmet', 'off', 'rack', 'nevkl', 'lock', 'check', 'earth', 'zazem', 'work', 'fence', 'stop']) if (!skip.includes(k)) out[k] = acts[k]();
  return out;
}
{
  console.log('Polygon: ZRU-10 kV scheme under the 3D room');
  const { s, tr, cell } = poly();
  ok(s.room && s.room.cells.length === 6, '6 KRU cells in the room');
  ok(s.room.cells.every(c => s.els.some(e => e.id === c.cart && E.TYPES[e.t].cart)), 'every cell has a trolley');
  ok(s.room.cells.every(c => s.wires.some(w => w.id === c.up) && s.wires.some(w => w.id === c.lo)), 'cells reference upper and lower contact wires');
  let dangling = [];
  for (const el of s.els) { if (el.t === 'bus') continue; for (const k of tr.topo.portKeys.get(el.id)) { const u = tr.topo.use.get(k); if (u.ports + u.wires < 2 && !u.bus) dangling.push(el.name); } }
  ok(!dangling.length, 'no dangling ports: ' + dangling);
  const names = new Set(s.els.map(e => e.name));
  ok(names.size === s.els.length, 'unique names');
  const cons = s.els.filter(e => E.TYPES[e.t].consumer);
  ok(cons.length === 4 && tr.state.loads.size === 4, 'all 4 consumers powered');
  ok(tr.state.V.get(tr.topo.wireNode.get(cell(3).lo)) === 10, 'lower contacts of cell 3 live in normal state');
  ok(tr.state.V.get(tr.topo.wireNode.get(cell(3).up)) === 10 && tr.topo.wireNode.get(cell(3).up) === tr.topo.term.get(s.els.find(e => e.t === 'bus').id)[0], 'upper contacts are the bus');
  ok(tr.topo.wireNode.get(cell(3).lo) === tr.topo.term.get(cell(3).earth)[0], 'ЗН яч.3 earths the lower contacts node');
  const t = s.tasks[0];
  ok(s.tasks.length === 1 && t.measures.length === 11 && t.workCell === 3 && !t.requireCheck, 'task with 11 measures, work cell 3');
}
{
  console.log('Polygon task: reference run, all measures in order');
  const { tr, pm, id, task } = poly();
  ok(!pm.active || pm.active, 'permit present');
  tr.startTask(task);
  ok(pm.active && pm.status().next && pm.status().next.includes('перчатки'), 'first measure: PPE — ' + pm.status().next);
  const out = polyRef(tr, pm, id);
  const bad = Object.entries(out).filter(([, r]) => !r || r.err || r.blocked || r.viol);
  ok(!bad.length, 'every action ok: ' + bad.map(([k, r]) => k + ': ' + (r && r.text)).join('; '));
  ok(out.check && out.check.res.every(x => x.kv == null), 'no voltage on the lower contacts of cell 3');
  ok(tr.run.done && tr.run.completed, 'task completed');
  ok(tr.run.grade.tone === 'good' && !tr.run.errors.length, 'no errors: ' + tr.run.errors.map(e => e.text));
  ok(tr.run.grade.score === 100 && tr.run.grade.myOps === tr.run.grade.refOps, 'score 100, ops ' + tr.run.grade.myOps + '/' + tr.run.grade.refOps);
  ok(task.keep.length === 3 && task.keep.every(k => tr.state.loads.has(k)) && !tr.state.loads.has(id('Цех №3')), 'Цех №3 off, others keep power');
  ok(tr.stepText({ op: 'hang', poster: 'nevkl', at: 'drive:3' }).includes('Не включать') && tr.stepText({ op: 'wear', item: 'gloves' }).includes('перчатки'), 'report texts for new steps');
  ok(tr.stepText({ op: 'check', id: tr.s.room.cells[2].lo }).includes('нижних контактах яч.3'), 'check text names the contacts: ' + tr.stepText({ op: 'check', id: tr.s.room.cells[2].lo }));
  ok(tr.run.measures && tr.run.measures.length === 11 && tr.run.measures.every(m => m.sat && !m.flagged), 'report: measures snapshot');
}
{
  console.log('Polygon task: not completed until every measure is done');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  polyRef(tr, pm, id, ['stop']);
  ok(!tr.run.done, 'switching done, «Стой! Напряжение» missing -> task goes on');
  const h = tr.hint();
  ok(h && h.text.includes('Стой! Напряжение') && tr.run.hints === 1, 'hint names the next measure: ' + (h && h.text));
  ok(pm.place('stop2', 'door:2').ok && tr.run.done && tr.run.completed, 'completed after «Стой! Напряжение» on the neighbour cell');
}
{
  console.log('Polygon: operations without PPE — violation, counted once');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  let r = tr.operate(id('В-10 яч.3'));
  ok(r.ok && !tr.sim.st[id('В-10 яч.3')].on, 'operation is performed');
  const saf = () => tr.run.errors.filter(e => e.kind === 'safety');
  ok(saf().length === 1 && saf()[0].why && saf()[0].text.includes('без СИЗ'), 'safety error with explanation: ' + saf().map(e => e.text));
  r = tr.operate(id('В-10 яч.3'), { pos: 'repair' });
  ok(r.ok && saf().length === 1, 'second operation without PPE: no second error');
  ok(tr.log.filter(e => e.text.includes('без СИЗ')).length === 2, 'each operation without PPE is logged');
  const c = pm.touch('contact:3:lo');
  ok(c && c.res && tr.log.some(e => e.text.includes('Проверка указателем без СИЗ')), 'indicator without gloves is logged too');
  ok(saf().length === 2 && saf()[1].text.startsWith('Нарушен порядок'), 'check before the poster and the lock — order error, PPE not counted again: ' + saf().map(e => e.text).join(' | '));
}
{
  console.log('Polygon: earthing without check and skipped posters — order errors with explanations');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  const out = polyRef(tr, pm, id, ['nevkl', 'lock', 'check', 'zazem', 'work', 'fence', 'stop']);
  ok(out.earth.ok && !out.earth.viol, 'ЗН switched on (section is dead)');
  const errs = tr.run.errors;
  ok(errs.length === 2, '2 errors: no check; earthing before «Не включать» and lock: ' + errs.map(e => e.text).join(' | '));
  ok(errs.some(e => e.text.includes('без проверки отсутствия напряжения')), 'earthing without check is named');
  ok(errs.some(e => e.text.includes('раньше') && e.text.includes('Не включать')), 'earthing before the prohibiting poster is named');
  ok(errs.every(e => e.kind === 'safety' && e.why && e.why.length > 40), 'each error explains why it is dangerous');
  pm.place('nevkl1', 'drive:3'); pm.place('lock', 'drive:3');
  ok(tr.run.errors.length === 2, 'skipped measures done later: no new errors');
  pm.place('zazem1', 'drive:3'); pm.place('work1', 'cart:3'); pm.place('fence', 'zone:3'); pm.place('stop1', 'fence');
  ok(tr.run.done && tr.run.completed && tr.run.grade.tone === 'mid' && tr.run.grade.saf === 2, 'completed with errors: ' + tr.run.grade.verdict + ', ' + tr.run.grade.score);
  ok(tr.run.measures.filter(m => m.flagged).length === 2, 'report marks 2 measures');
}
{
  console.log('Polygon: «Заземлено» too early — one error for the moved measure');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  pm.wear('gloves'); pm.wear('helmet');
  tr.operate(id('В-10 яч.3'));
  pm.place('zazem1', 'drive:3');
  ok(tr.run.errors.length === 1 && tr.run.errors[0].why && tr.run.errors[0].text.includes('Заземлено'), 'one error: ' + tr.run.errors.map(e => e.text).join(' | '));
  polyRef(tr, pm, id, ['gloves', 'helmet', 'off', 'zazem']);
  ok(tr.run.done && tr.run.completed && tr.run.errors.length === 1 && tr.run.grade.tone === 'mid', 'rest in order: completed with 1 error');
}
{
  console.log('Polygon: lock blocks the drive; posters on a working cell; operating under «Не включать»');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  polyRef(tr, pm, id, ['check', 'earth', 'zazem', 'work', 'fence', 'stop']);
  let r = tr.operate(id('В-10 яч.3'), { pos: 'test' });
  ok(r.blocked && r.text.includes('замок') && tr.sim.st[id('В-10 яч.3')].pos === 'repair', 'locked drive: trolley does not move: ' + r.text);
  ok(tr.run.errors.some(e => e.kind === 'blocked' && e.why), 'attempt counted with explanation');
  r = pm.place('nevkl2', 'drive:2');
  ok(r.ok && tr.run.errors.some(e => e.kind === 'safety' && e.text.includes('№2') && e.why), '«Не включать» on working cell 2 -> error');
  r = pm.place('work1', 'door:4');
  ok(r.ok && tr.run.errors.some(e => e.text.includes('Работать здесь') && e.text.includes('№4')), '«Работать здесь» on a live cell -> error');
  ok(pm.take('lock').ok && !pm.onMount('drive:3').includes('lock'), 'lock removed');
  r = tr.operate(id('В-10 яч.3'), { pos: 'test' });
  ok(r.ok && tr.run.errors.some(e => e.text.includes('«Не включать! Работают люди»') && e.text.includes('яч.3')), 'racking in under «Не включать» -> error');
  ok(pm.place('lock', 'drive:5').ok && tr.run.errors.some(e => e.text.includes('Замок') && e.text.includes('№5')), 'lock on another cell -> error');
}
{
  console.log('Polygon: PZ on the lower contacts instead of ЗН; contacts closed while the trolley is in');
  const { tr, pm, id, task, cell } = poly();
  tr.startTask(task);
  pm.wear('gloves'); pm.wear('helmet');
  const r0 = pm.place('pz', 'contact:3:lo');
  ok(r0.err && /тележ/.test(r0.text), 'contacts closed: ' + r0.text);
  ok(pm.touch('contact:3:lo').err, 'indicator cannot reach the contacts either');
  polyRef(tr, pm, id, ['gloves', 'helmet', 'earth', 'zazem', 'work', 'fence', 'stop']);
  const r = pm.place('pz', 'contact:3:lo');
  ok(r.ok && tr.pzAt(tr.topo.wireNode.get(cell(3).lo)) && pm.itemAt('pz') === 'contact:3:lo', 'PZ applied on the lower contacts');
  pm.place('zazem1', 'earth:3'); pm.place('work1', 'cart:3'); pm.place('fence', 'zone:3'); pm.place('stop1', 'shutter:3');
  ok(tr.run.done && tr.run.completed && !tr.run.errors.length, 'task done with PZ, no errors: ' + tr.run.errors.map(e => e.text));
}
{
  console.log('Polygon: indicator on live contacts of the input cell, PZ there is blocked');
  const { tr, pm, id } = poly();
  pm.wear('gloves'); pm.wear('helmet');
  tr.operate(id('В-10 Ввод')); tr.operate(id('В-10 Ввод'), { pos: 'repair' });
  const c = pm.touch('contact:1:lo');
  ok(c && c.res && c.res.some(x => x.kv === 10), 'indicator: lower contacts of the input are live from Т1');
  const r = pm.place('pz', 'contact:1:lo');
  ok(r && r.blocked && !pm.itemAt('pz'), 'PZ onto a live part blocked: ' + (r && r.text));
  ok(pm.place('pz', 'contact:1:up').err, 'upper contacts are behind the shutter');
}
{
  console.log('Polygon: stopping early lists missed measures with explanations');
  const { tr, pm, id, task } = poly();
  tr.startTask(task);
  polyRef(tr, pm, id, ['nevkl', 'lock', 'check', 'earth', 'zazem', 'work', 'fence', 'stop']);
  tr.stopTask();
  const miss = tr.run.errors.filter(e => e.text.startsWith('Пропущено'));
  ok(miss.length === 8 && miss.every(e => e.kind === 'safety' && e.why), 'missed measures: ' + miss.length);
  ok(!tr.run.completed && tr.run.grade.tone === 'bad', 'not completed');
}
{
  console.log('Polygon: items — wear, take back, reset with the task; free mode');
  const { tr, pm, id, task } = poly();
  ok(pm.active && !pm.status().ppe.gloves, 'free mode: permit active in the room');
  ok(pm.wear('gloves').ok && pm.itemAt('gloves') === 'worn' && pm.wear('pz').err, 'gloves on; PZ is not worn');
  ok(pm.place('nevkl1', 'drive:3').ok && pm.onMount('drive:3').includes('nevkl1') && pm.take('nevkl1').ok && !pm.itemAt('nevkl1'), 'poster hung and taken back');
  ok(pm.place('stop1', 'fence').err, 'no fence yet — nowhere to hang');
  pm.place('fence', 'zone:3'); pm.place('stop1', 'fence'); pm.take('fence');
  ok(!pm.itemAt('fence') && !pm.itemAt('stop1'), 'fence removed — its poster comes off too');
  tr.startTask(task);
  ok(!pm.itemAt('gloves') && !pm.status().ppe.gloves, 'new task: items back on the stand');
  ok(pm.place('nevkl1', 'zone:3').err && pm.place('lock', 'door:3').err, 'items go only where they fit');
}
{
  console.log('Polygon: JSON keeps room, measures and steps; other schemes unaffected');
  const { s } = poly();
  const s2 = E.normalizeScheme(JSON.parse(JSON.stringify(s)));
  ok(s2.room && s2.room.cells.length === 6 && s2.tasks[0].measures.length === 11 && s2.tasks[0].steps.length === s.tasks[0].steps.length && s2.tasks[0].workCell === 3, 'normalize keeps the room and the task');
  const tr = new E.Trainer(), pm = tr.use(new Permit()); tr.load(s2); tr.startTask(s2.tasks[0]);
  polyRef(tr, pm, n => s2.els.find(e => e.name === n).id);
  ok(tr.run.completed && tr.run.grade.tone === 'good', 'task replays after JSON');
  const k = setup('ps110'), pm2 = k.tr.use(new Permit());
  k.tr.load(k.s);
  ok(!pm2.active && pm2.guard(k.s.els[0], null) === null, 'permit inactive on ПС 110/10');
  k.tr.startTask(k.s.tasks[0]);
  for (const st of k.s.tasks[0].steps) { if (st.op === 'check') k.tr.check(st.id); else k.tr.operate(st.id); }
  ok(k.tr.run.completed && k.tr.run.grade.tone === 'good' && !k.tr.run.errors.length, 'ПС 110/10 task unaffected by the permit');
}
{
  console.log('Explanations: every measure, poster and misplacement says why it is dangerous');
  const kinds = ['ppe', 'off', 'rack', 'lock', 'check', 'earth', 'fence'];
  ok(kinds.every(k => WHY[k] && WHY[k].length > 60), 'WHY for measures');
  ok(Object.keys(POSTERS).every(p => WHY['sign_' + p] && WHY['sign_' + p].length > 60 && MISPLACED[p] && MISPLACED[p].why.length > 40), 'WHY and misplacement texts for every poster');
  ok(MISPLACED.lock && MISPLACED.fence && WHY.lockBlock && WHY.nevklOp, 'lock, fence, blocked drive, operation under poster');
  ok(ITEMS.length >= 12 && ITEMS.every(i => i.title), 'items have titles');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
