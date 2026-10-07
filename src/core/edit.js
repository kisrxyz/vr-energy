import { TYPES, bbox, portPoints, ptKey, rot, newId, nextName } from './elements.js';

/* ===== Группа в редакторе: выделить, перенести, копировать, вставить, повернуть, удалить. Без DOM =====
   Выделение — { els: [id], wires: [id] }. Провода группы («свои») — выделенные и те, у которых оба конца
   на точках подключения выделенных элементов. Провода к невыделенным при переносе и повороте тянутся за своим концом.
   Буфер (copyGroup) — элементы и свои провода в координатах от левого верхнего угла группы: его можно вставить
   в другую схему (pasteGroup), элементы получают новые id, а имена — новые, если такие уже есть в схеме. */

// Что целиком попадает в рамку: элемент — габарит, провод — оба конца
function inRect(s, x0, y0, x1, y1) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0], [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by;
  return {
    els: s.els.filter(e => { const b = bbox(e); return inside(b[0], b[1]) && inside(b[2], b[3]); }).map(e => e.id),
    wires: s.wires.filter(w => inside(w.a[0], w.a[1]) && inside(w.b[0], w.b[1])).map(w => w.id),
  };
}
// Элементы группы, их точки подключения и свои провода: выделенные, а также провода между точками выделенных
// элементов — и через узлы без аппаратов (ответвление к ЗН), если из узла никуда наружу не уходит
function parts(s, sel) {
  const ids = new Set(sel.els || []), els = s.els.filter(e => ids.has(e.id)), wids = new Set(sel.wires || []);
  const ports = new Set(), anyPort = new Set();
  for (const e of s.els) for (const p of portPoints(e)) { const k = ptKey(p); anyPort.add(k); if (ids.has(e.id)) ports.add(k); }
  const ends = w => [ptKey(w.a), ptKey(w.b)];
  let cand = s.wires.filter(w => ends(w).every(k => ports.has(k) || !anyPort.has(k)));
  // узел, к которому подходит провод снаружи, — не свой: провода от него отбрасываем, пока что-то меняется
  for (let changed = true; changed;) {
    const inC = new Set(cand), leak = new Set();
    for (const w of s.wires) if (!inC.has(w)) for (const k of ends(w)) if (!anyPort.has(k)) leak.add(k);
    const next = cand.filter(w => !ends(w).some(k => leak.has(k)));
    changed = next.length !== cand.length; cand = next;
  }
  // только связанные с выделенными элементами (не чужие обрывки проводов)
  const reached = new Set(ports), own = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const w of cand) if (!own.has(w) && ends(w).some(k => reached.has(k))) { own.add(w); for (const k of ends(w)) reached.add(k); changed = true; }
  }
  return { els, own: s.wires.filter(w => wids.has(w.id) || own.has(w)), ports };
}
// Точки, которые едут вместе с группой: точки подключения элементов и концы своих проводов
function movingPoints(p) {
  const pts = new Set(p.ports);
  for (const w of p.own) { pts.add(ptKey(w.a)); pts.add(ptKey(w.b)); }
  return pts;
}
// Захват для переноса: исходные места элементов, своих проводов и концов чужих проводов, которые тянутся
function grip(s, sel) {
  const p = parts(s, sel), pts = movingPoints(p), own = new Set(p.own.map(w => w.id)), ends = [];
  for (const w of s.wires) {
    if (own.has(w.id)) { ends.push({ w, end: 'a', x: w.a[0], y: w.a[1] }, { w, end: 'b', x: w.b[0], y: w.b[1] }); continue; }
    for (const end of ['a', 'b']) if (pts.has(ptKey(w[end]))) ends.push({ w, end, x: w[end][0], y: w[end][1] });
  }
  return { els: p.els.map(e => ({ e, x: e.x, y: e.y })), ends };
}
function moveGrip(g, dx, dy) {
  for (const q of g.els) { q.e.x = q.x + dx; q.e.y = q.y + dy; }
  for (const q of g.ends) q.w[q.end] = [q.x + dx, q.y + dy];
}
function moveGroup(s, sel, dx, dy) { moveGrip(grip(s, sel), dx, dy); }

// Габарит группы по сетке: элементы и концы своих проводов
function groupBox(els, wires) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const b = bbox(e); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  for (const w of wires) for (const q of [w.a, w.b]) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
// Поворот на 90° по часовой вокруг центра группы (центр — по сетке, чтобы точки подключения остались в узлах).
// Возвращает центр: при повторных поворотах той же группы его передают снова — четыре поворота вернут всё на место
function rotateGroup(s, sel, pivot) {
  const p = parts(s, sel), b = groupBox(p.els, p.own);
  if (!b) return null;
  const [cx, cy] = pivot || [Math.round((b[0] + b[2]) / 2), Math.round((b[1] + b[3]) / 2)];
  const turn = q => { const r = rot([q[0] - cx, q[1] - cy], 1); return [cx + r[0], cy + r[1]]; };
  const pts = movingPoints(p), own = new Set(p.own.map(w => w.id));
  for (const w of s.wires) {
    if (own.has(w.id)) { w.a = turn(w.a); w.b = turn(w.b); w.vf = !w.vf; continue; }   // излом поворачивается вместе с проводом
    for (const end of ['a', 'b']) if (pts.has(ptKey(w[end]))) w[end] = turn(w[end]);
  }
  for (const e of p.els) { [e.x, e.y] = turn([e.x, e.y]); e.r = (e.r + 1) % 4; }
  return [cx, cy];
}
function deleteGroup(s, sel) {
  const ids = new Set(sel.els || []), wids = new Set(sel.wires || []);
  s.els = s.els.filter(e => !ids.has(e.id));
  s.wires = s.wires.filter(w => !wids.has(w.id));
}
// В буфер: элементы и свои провода от левого верхнего угла группы (целые клетки)
function copyGroup(s, sel) {
  const p = parts(s, sel), b = groupBox(p.els, p.own);
  if (!b) return null;
  const ox = Math.floor(b[0]), oy = Math.floor(b[1]);
  return {
    kind: 'ts-group', v: 1, w: Math.ceil(b[2]) - ox, h: Math.ceil(b[3]) - oy,
    els: p.els.map(e => Object.assign(JSON.parse(JSON.stringify(e)), { x: e.x - ox, y: e.y - oy })),
    wires: p.own.map(w => ({ a: [w.a[0] - ox, w.a[1] - oy], b: [w.b[0] - ox, w.b[1] - oy], vf: w.vf !== false })),
  };
}
// Вставить буфер: левый верхний угол — в (x, y). Возвращает выделение вставленного
function pasteGroup(s, clip, x, y) {
  if (!clip || clip.kind !== 'ts-group' || !Array.isArray(clip.els) || !Array.isArray(clip.wires)) return null;
  const out = { els: [], wires: [] }, used = new Set(s.els.map(e => e.name));
  for (const c of clip.els) {
    if (!TYPES[c.t]) continue;
    const el = JSON.parse(JSON.stringify(c));
    el.id = newId(s, 'e'); el.x = c.x + x; el.y = c.y + y;
    el.name = used.has(c.name) ? nextName(s, c.t) : String(c.name || nextName(s, c.t));
    used.add(el.name);
    s.els.push(el); out.els.push(el.id);
  }
  for (const c of clip.wires) {
    const w = { id: newId(s, 'w'), a: [c.a[0] + x, c.a[1] + y], b: [c.b[0] + x, c.b[1] + y], vf: c.vf !== false };
    s.wires.push(w); out.wires.push(w.id);
  }
  return out;
}
// Копия группы рядом: +dx клеток по горизонтали, новые id и имена
function duplicateGroup(s, sel, dx = 3) {
  const p = parts(s, sel), b = groupBox(p.els, p.own), clip = copyGroup(s, sel);
  return clip ? pasteGroup(s, clip, Math.floor(b[0]) + dx, Math.floor(b[1])) : null;
}

export { inRect, grip, moveGrip, moveGroup, groupBox, rotateGroup, deleteGroup, copyGroup, pasteGroup, duplicateGroup };
