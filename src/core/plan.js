import { TYPES, POS_NAME, isPzId, FIELD_OPS } from './elements.js';
import { ITEMS, ITEM } from './permit.js';

/* ===== План действий задания (без DOM) =====
   planTask(s, task) — из эталонных шагов (или, если шагов нет, из мероприятий полигона) список действий человека:
   что нажать, какой пункт меню выбрать, какой предмет взять и куда повесить. Его проходят автопроходка (tools/e2e.mjs)
   и автопоказ (src/ui/demo.js) — через те же обработчики, что у пользователя; тесты — через движок (runAction).
   Действие: { do, step, ... } — step: эталонный шаг (текст — tr.stepText(step)), у действий из мероприятий — мероприятие m.
     switch { id, menu? }   — щелчок по аппарату; у тележки — пункт меню menu («Отключить выключатель»)
     rack   { id, pos, menu } — тележку в положение pos (пункт меню)
     check  { target, mount?, item? } — указатель: аппарат или провод; в полигоне — предмет item коснуться места mount;
            перед первой проверкой в полигоне — самопроверка { mount: 'tester', self: true } (проверочное устройство на стенде)
     pz     { target }      — переносное заземление на провод или шину (наложить или снять)
     wear   { item }        — надеть (перчатки, каска)
     place  { item, at }    — взять со стенда и повесить или поставить на место at (плакат, замок, ограждение, ПЗ)
     take   { item, at }    — снять с места at */

// Пункты меню тележки — как в Trainer.actions
const menuOn = on => on ? 'Включить выключатель' : 'Отключить выключатель';
const menuPos = pos => `Тележку в ${POS_NAME[pos]} положение`;

// Место контактов по проводу в полигоне: 'contact:3:lo'
function contactMount(s, wire) {
  const cells = s.room && Array.isArray(s.room.cells) ? s.room.cells : [];
  for (const c of cells) { if (c.lo === wire) return `contact:${c.n}:lo`; if (c.up === wire) return `contact:${c.n}:up`; }
  return null;
}

function planTask(s, task) {
  const els = new Map(s.els.map(e => [e.id, e]));
  const room = !!(s.room && Array.isArray(s.room.cells) && s.room.cells.length);
  // плакаты одного вида на стенде разные (nevkl1, nevkl2): берём свободный, снятый — снова свободен
  const used = new Map();
  const itemFor = (kind, poster) => {
    const it = ITEMS.find(i => i.kind === kind && (!poster || i.poster === poster) && !used.has(i.id));
    return it ? it.id : null;
  };
  const itemAt = (at, kind, poster) => { for (const [id, a] of used) if (a === at && ITEM[id].kind === kind && (!poster || ITEM[id].poster === poster)) return id; return null; };
  const out = [];
  // самопроверка указателя — один раз, перед первой проверкой в полигоне (указатель потом из рук не выпускают)
  let tested = false;
  const selfTest = st => { if (!tested) { tested = true; out.push({ do: 'check', target: null, mount: 'tester', item: 'uvn', self: true, step: st }); } };
  const sw = (st, id, on) => {
    const el = els.get(id), T = el ? TYPES[el.t] : null;
    out.push(T && T.cart && T.sw === 'breaker' ? { do: 'switch', id, menu: menuOn(on), step: st } : { do: 'switch', id, step: st });
  };
  const put = (st, kind, at, poster) => {
    const item = itemFor(kind, poster);
    if (!item) return;
    used.set(item, at);
    out.push({ do: 'place', item, at, step: st });
  };
  const steps = Array.isArray(task.steps) ? task.steps : [];
  if (steps.length) {
    for (const st of steps) {
      if (FIELD_OPS.includes(st.op)) {
        if (st.op === 'wear') out.push({ do: 'wear', item: st.item, step: st });
        else if (st.op === 'hang') put(st, 'poster', st.at, st.poster);
        else if (st.op === 'lock') put(st, 'lock', st.at);
        else if (st.op === 'fence') put(st, 'fence', st.at);
        else {
          // снять: тот предмет, что висит на этом месте
          const kind = st.op === 'unhang' ? 'poster' : st.op === 'unlock' ? 'lock' : 'fence';
          const item = itemAt(st.at, kind, st.poster) || (ITEMS.find(i => i.kind === kind && (kind !== 'poster' || i.poster === st.poster)) || {}).id;
          if (item) { used.delete(item); out.push({ do: 'take', item, at: st.at, step: st }); }
        }
        continue;
      }
      if (st.op === 'pos') { out.push({ do: 'rack', id: st.id, pos: st.pos, menu: menuPos(st.pos), step: st }); continue; }
      if (st.op === 'check') {
        const mount = room ? contactMount(s, st.id) : null;
        if (mount) selfTest(st);
        out.push(mount ? { do: 'check', target: st.id, mount, item: 'uvn', step: st } : { do: 'check', target: st.id, step: st });
        continue;
      }
      if (isPzId(st.id)) {
        const mount = room ? contactMount(s, st.id.slice(3)) : null;
        if (mount && st.op === 'on') { used.set('pz', mount); out.push({ do: 'place', item: 'pz', at: mount, step: st }); }
        else if (mount) { used.delete('pz'); out.push({ do: 'take', item: 'pz', at: mount, step: st }); }
        else out.push({ do: 'pz', target: st.id.slice(3), step: st });
        continue;
      }
      sw(st, st.id, st.op === 'on');
    }
    return out;
  }
  // шагов нет — по мероприятиям полигона, этап за этапом
  const ms = Array.isArray(task.measures) ? task.measures.map((m, i) => [m, i]) : [];
  ms.sort((a, b) => (a[0].stage - b[0].stage) || (a[1] - b[1]));
  for (const [m] of ms) {
    const at = Array.isArray(m.at) ? m.at[0] : null;
    if (m.k === 'ppe') { out.push({ do: 'wear', item: 'gloves', step: m }, { do: 'wear', item: 'helmet', step: m }); }
    else if (m.k === 'off') sw(m, m.id, false);
    else if (m.k === 'rack') out.push({ do: 'rack', id: m.id, pos: m.pos, menu: menuPos(m.pos), step: m });
    else if (m.k === 'sign') put(m, 'poster', at, m.poster);
    else if (m.k === 'lock') put(m, 'lock', at);
    else if (m.k === 'fence') put(m, 'fence', at);
    else if (m.k === 'check') {
      const mount = contactMount(s, m.wire);
      if (mount) selfTest(m);
      out.push(mount ? { do: 'check', target: m.wire, mount, item: 'uvn', step: m } : { do: 'check', target: m.wire, step: m });
    } else if (m.k === 'earth') {
      if (m.id) sw(m, m.id, true);
      else { const mount = contactMount(s, m.wire); if (mount) { used.set('pz', mount); out.push({ do: 'place', item: 'pz', at: mount, step: m }); } }
    }
  }
  return out;
}

// Выполнить действие плана прямо в движке (тесты, подготовка шага показа): то же, что сделает человек через интерфейс
function runAction(tr, pm, a) {
  switch (a.do) {
    case 'switch': return tr.operate(a.id);
    case 'rack': return tr.operate(a.id, { pos: a.pos });
    case 'check': return a.mount && pm ? pm.touch(a.mount) : tr.check(a.target);
    case 'pz': return tr.pzToggle(a.target);
    case 'wear': return pm ? pm.wear(a.item) : null;
    case 'place': return pm ? pm.place(a.item, a.at) : null;
    case 'take': return pm ? pm.take(a.item) : null;
  }
  return null;
}

// Текст действия для подписи: «Отключить В-10 Л-1», «Взять плакат „Не включать!“ и вывесить на привод яч.3»
function actionText(tr, a) {
  if (a.self) return 'Самопроверка указателя на проверочном устройстве';
  const t = a.step && a.step.op ? tr.stepText(a.step) : a.step && a.step.k ? (tr.addon('title', a.step) || '') : '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : (ITEM[a.item] ? ITEM[a.item].title : '');
}

export { planTask, runAction, actionText, contactMount, menuOn, menuPos };
