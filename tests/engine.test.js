// Автотесты движка: node tests/engine.test.js (или npm test). Без браузера.
import * as lib from '../src/core/elements.js';
import * as samples from '../src/core/samples.js';
import * as engine from '../src/core/engine.js';
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
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
