import { G, TYPES, BOX, rot, ptKey, clamp, esc, portPoints, bbox, vClass, fmtNum, fmtKv, isSwitchable, wireRoute } from '../core/elements.js';
import { buildTopo } from '../core/engine.js';

/* ===== §4. 2D: схема и редактор ===== */
const CVAR = { 'c-edit': '--edit', 'c-dead': '--dead', 'c-gnd': '--gnd', 'c-v220': '--v220', 'c-v110': '--v110', 'c-v35': '--v35', 'c-v10': '--v10', 'c-v6': '--v6', 'c-v04': '--v04', 'c-vlow': '--vlow' };
const colorVar = c => `var(${CVAR[c] || '--edit'})`;

// Символ элемента в клетках, до поворота. c: p0/p1 — цвет у точек подключения, st — класс состояния, open — отключён
function symbolSVG(el, c) {
  const r = el.r || 0;
  switch (el.t) {
    case 'breaker':
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="-0.5"/><line class="ld ${c.p1}" x1="0" y1="0.5" x2="0" y2="1"/>` +
        `<rect class="dev ${c.st}" x="-0.5" y="-0.5" width="1" height="1" rx="0.08"/>`;
    case 'acb':
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="-0.45"/><line class="ld ${c.p1}" x1="0" y1="0.45" x2="0" y2="1"/>` +
        `<rect class="dev ${c.st}" x="-0.42" y="-0.45" width="0.84" height="0.9" rx="0.32"/>`;
    case 'disconnector': {
      const bx = c.open ? 0.57 : 0, by = c.open ? -0.32 : -0.5;
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="-0.5"/><line class="ld ${c.p0}" x1="-0.24" y1="-0.5" x2="0.24" y2="-0.5"/>` +
        `<line class="ld ${c.p1}" x1="0" y1="0.5" x2="0" y2="1"/><line class="blade ${c.st}" x1="0" y1="0.5" x2="${bx}" y2="${by}"/>` +
        `<circle class="pivot ${c.st}" cx="0" cy="0.5" r="0.11"/>`;
    }
    case 'earth': {
      const bx = c.open ? 0.52 : 0, by = c.open ? -0.17 : -0.35;
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="-0.35"/><line class="ld ${c.p0}" x1="-0.22" y1="-0.35" x2="0.22" y2="-0.35"/>` +
        `<line class="blade ${c.st}" x1="0" y1="0.45" x2="${bx}" y2="${by}"/><circle class="pivot ${c.st}" cx="0" cy="0.45" r="0.1"/>` +
        `<path class="gnd-sym" d="M0 0.45V0.78M-0.42 0.78H0.42M-0.27 0.95H0.27M-0.12 1.12H0.12"/>`;
    }
    case 'transformer':
      return `<line class="ld ${c.p0}" x1="0" y1="-2" x2="0" y2="-1.3"/><circle class="tr-c ${c.p0}" cx="0" cy="-0.55" r="0.75"/>` +
        `<circle class="tr-c ${c.p1}" cx="0" cy="0.55" r="0.75"/><line class="ld ${c.p1}" x1="0" y1="1.3" x2="0" y2="2"/>`;
    case 'source':
      return `<circle class="tr-c ${c.p0}" cx="0" cy="-0.5" r="0.75"/><path class="srcwave ${c.p0}" d="M-0.42 -0.5c0.14 -0.42 0.28 -0.42 0.42 0s0.28 0.42 0.42 0"/>` +
        `<line class="ld ${c.p0}" x1="0" y1="0.25" x2="0" y2="1"/>`;
    case 'gen':
      return `<circle class="tr-c ${c.p0}" cx="0" cy="-0.5" r="0.75"/><text class="sym-txt" x="0" y="-0.27" transform="rotate(${-r * 90} 0 -0.5)">G</text>` +
        `<line class="ld ${c.p0}" x1="0" y1="0.25" x2="0" y2="1"/>`;
    case 'load':
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="0.2"/><path d="M-0.4 0.2H0.4L0 0.9Z" style="fill:${c.f0}"/>`;
    case 'motor':
      return `<line class="ld ${c.p0}" x1="0" y1="-1" x2="0" y2="-0.12"/><circle class="tr-c ${c.p0}" cx="0" cy="0.55" r="0.66"/>` +
        `<text class="sym-txt" x="0" y="0.78" transform="rotate(${-r * 90} 0 0.55)">M</text>`;
    case 'bus':
      return `<line class="busbar ${c.p0}" x1="0" y1="0" x2="${el.p.len}" y2="0"/>`;
  }
  return '';
}
function symbolIcon(t) {
  const T = TYPES[t];
  const el = { t, r: 0, x: 0, y: 0, p: Object.assign({}, T.props || {}) };
  if (t === 'bus') el.p.len = 2;
  const open = T.normal === false;
  const c = { p0: 'c-edit', p1: 'c-edit', st: open ? 's-off' : 's-on', open, f0: colorVar('c-edit') };
  const vb = t === 'bus' ? '-0.5 -1.5 3 3' : t === 'transformer' ? '-2.2 -2.2 4.4 4.4' : '-1.5 -1.5 3 3';
  return `<svg viewBox="${vb}" aria-hidden="true">${symbolSVG(el, c)}</svg>`;
}
function elSubtitle(el) {
  const p = el.p;
  switch (el.t) {
    case 'source': case 'gen': return fmtKv(p.kv);
    case 'transformer': return `${fmtNum(p.kv1)}/${fmtNum(p.kv2)} кВ · ${p.mva < 1 ? fmtNum(p.mva * 1000) + ' кВА' : fmtNum(p.mva) + ' МВА'}`;
    case 'load': case 'motor': return fmtNum(p.kw) + ' кВт';
  }
  return '';
}
const hitBox = el => el.t === 'bus' ? [0, -0.4, el.p.len, 0.4] : BOX[el.t];

class Scheme2D {
  constructor(app, svg) {
    this.app = app; this.svg = svg;
    this.k = 1; this.tx = 40; this.ty = 40;
    this.sel = null; this.placing = null; this.drag = null; this.down = null;
    this.pointers = new Map();
    svg.innerHTML = '<defs><pattern id="gridp" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.055"/></pattern></defs>' +
      '<g id="world"><rect x="-600" y="-600" width="1200" height="1200" fill="url(#gridp)"/><g id="lw"></g><g id="le"></g><g id="ll"></g><g id="lo"></g><g id="lfx"></g></g>';
    this.world = svg.querySelector('#world');
    this.lw = svg.querySelector('#lw'); this.le = svg.querySelector('#le'); this.ll = svg.querySelector('#ll');
    this.lo = svg.querySelector('#lo'); this.lfx = svg.querySelector('#lfx');
    this.bind();
    this.applyView();
  }
  applyView() { this.world.setAttribute('transform', `translate(${this.tx} ${this.ty}) scale(${this.k * G})`); }
  toWorld(cx, cy) { const r = this.svg.getBoundingClientRect(); return [(cx - r.left - this.tx) / (this.k * G), (cy - r.top - this.ty) / (this.k * G)]; }
  zoomAt(cx, cy, f) {
    const r = this.svg.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    const k2 = clamp(this.k * f, 0.2, 5), m = k2 / this.k;
    this.tx = px - (px - this.tx) * m; this.ty = py - (py - this.ty) * m; this.k = k2;
    this.applyView();
  }
  zoomCenter(f) { const r = this.svg.getBoundingClientRect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
  fit() {
    const s = this.app.scheme, r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of s.els) { const b = bbox(el); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2] + 4); y1 = Math.max(y1, b[3]); }
    for (const w of s.wires) for (const p of [w.a, w.b]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (!isFinite(x0)) { this.k = 1; this.tx = r.width / 2; this.ty = r.height / 2; this.applyView(); return; }
    const pad = r.width < 600 ? 24 : 56;
    this.k = clamp(Math.min((r.width - 2 * pad) / ((x1 - x0) * G), (r.height - 2 * pad) / ((y1 - y0 + 1) * G)), 0.2, 2.2);
    this.tx = r.width / 2 - (x0 + x1) / 2 * G * this.k;
    this.ty = r.height / 2 - (y0 + y1) / 2 * G * this.k;
    this.applyView();
  }

  // ---------- отрисовка ----------
  render() {
    const app = this.app, s = app.scheme, edit = app.mode === 'edit';
    const tr = app.tr;
    const topo = edit ? buildTopo(s) : tr.topo;
    this.topo = topo;
    const st = edit ? null : tr.state;
    const cls = n => {
      if (edit) return 'c-edit';
      if (st.V.has(n)) return 'c-' + vClass(st.V.get(n));
      if (st.G.has(n)) return 'c-gnd';
      return 'c-dead';
    };
    let hw = '';
    for (const w of s.wires) {
      const pts = wireRoute(w).map(p => p[0] + ',' + p[1]).join(' ');
      const selw = this.sel && this.sel.type === 'wire' && this.sel.id === w.id;
      hw += `<g data-w="${w.id}"><polyline class="hitw" points="${pts}"/><polyline class="wire ${cls(topo.wireNode.get(w.id))}${selw ? ' selw' : ''}" points="${pts}"/></g>`;
    }
    for (const [k, u] of topo.use) {
      if ((u.bus && u.wires > 0) || u.ports + u.wires >= 3) {
        const [x, y] = k.split(',').map(Number);
        hw += `<circle class="dot" cx="${x}" cy="${y}" r="0.17" style="fill:${colorVar(cls(topo.node(k)))}"/>`;
      }
    }
    this.lw.innerHTML = hw;

    let he = '', hl = '', ho = '';
    for (const el of s.els) {
      const tm = topo.term.get(el.id);
      const c = { p0: cls(tm[0]), p1: cls(tm[1] != null ? tm[1] : tm[0]) };
      c.f0 = colorVar(c.p0);
      let hot = false;
      if (isSwitchable(el)) {
        const on = edit ? el.on : tr.sim.st[el.id].on;
        const trip = !edit && tr.sim.st[el.id].trip;
        c.open = !on; c.st = (on ? 's-on' : 's-off') + (trip ? ' trip' : '');
        hot = !edit;
      } else if (TYPES[el.t].cls === 'source') hot = !edit;
      if (!edit && app.tool === 'check') hot = true;
      const hb = hitBox(el);
      he += `<g class="el${hot ? ' hot' : ''}" data-el="${el.id}" transform="translate(${el.x} ${el.y}) rotate(${el.r * 90})">` +
        `<rect class="hit" x="${hb[0] - 0.15}" y="${hb[1] - 0.15}" width="${hb[2] - hb[0] + 0.3}" height="${hb[3] - hb[1] + 0.3}" rx="0.2"/>${symbolSVG(el, c)}</g>`;
      hl += this.labelSVG(el, edit ? null : st, topo);
      if (edit) {
        if (this.sel && this.sel.type === 'el' && this.sel.id === el.id) {
          const b = bbox(el);
          ho += `<rect class="selbox" x="${b[0] - 0.25}" y="${b[1] - 0.25}" width="${b[2] - b[0] + 0.5}" height="${b[3] - b[1] + 0.5}" rx="0.25"/>`;
          if (el.t === 'bus') { const q = rot([el.p.len, 0], el.r); ho += `<rect class="bh" data-bh="${el.id}" x="${el.x + q[0] - 0.28}" y="${el.y + q[1] - 0.28}" width="0.56" height="0.56" rx="0.1"/>`; }
        }
        const pts = portPoints(el);
        for (const p of pts) {
          const u = topo.use.get(ptKey(p));
          if (el.t !== 'bus') ho += `<circle class="port${u && u.ports + u.wires < 2 && !u.bus ? ' free' : ''}" cx="${p[0]}" cy="${p[1]}" r="0.16"/>`;
          ho += `<circle class="pt-hit" data-pt="${p[0]},${p[1]}" cx="${p[0]}" cy="${p[1]}" r="0.36"/>`;
        }
      }
    }
    if (edit) {
      for (const w of s.wires) {
        for (const end of ['a', 'b']) {
          const p = w[end], u = topo.use.get(ptKey(p));
          const selw = this.sel && this.sel.type === 'wire' && this.sel.id === w.id;
          if (selw) ho += `<circle class="wend" data-we="${w.id}:${end}" cx="${p[0]}" cy="${p[1]}" r="0.24"/>`;
          else if (u && u.ports === 0 && !u.bus) ho += `<circle class="port${u.wires < 2 ? ' free' : ''}" cx="${p[0]}" cy="${p[1]}" r="0.13"/><circle class="pt-hit" data-pt="${p[0]},${p[1]}" cx="${p[0]}" cy="${p[1]}" r="0.36"/>`;
        }
      }
    }
    this.le.innerHTML = he;
    this.ll.innerHTML = hl;
    this.lo.innerHTML = ho;
    this.overlayExtra();
  }
  labelSVG(el, st, topo) {
    const b = bbox(el);
    if (el.t === 'bus') {
      let t = el.name;
      if (st) { const kv = st.V.get(topo.term.get(el.id)[0]); if (kv != null) t += ' · ' + fmtKv(kv); else if (st.G.has(topo.term.get(el.id)[0])) t += ' · заземлена'; }
      const horiz = el.r % 2 === 0;
      return horiz ? `<text class="lbl busl" x="${b[0] + 0.35}" y="${b[1] - 0.22}">${esc(t)}</text>`
                   : `<text class="lbl busl" x="${b[2] + 0.25}" y="${b[1] + 0.7}">${esc(t)}</text>`;
    }
    const sub = elSubtitle(el);
    const lines = [[el.name, 'lbl']];
    if (sub) lines.push([sub, 'lbl2']);
    let x, y, anchor;
    if (el.r % 2 === 0) { x = b[2] + 0.3; const cy = (b[1] + b[3]) / 2; y = lines.length > 1 ? cy - 0.14 : cy + 0.25; anchor = 'start'; }
    else { x = (b[0] + b[2]) / 2; y = b[1] - 0.3 - (lines.length - 1) * 0.7; anchor = 'middle'; }
    return lines.map((l, i) => `<text class="${l[1]}" x="${x}" y="${y + i * 0.7}" text-anchor="${anchor}">${esc(l[0])}</text>`).join('');
  }
  overlayExtra() {
    const d = this.drag;
    let h = '';
    if (d && d.kind === 'wire') {
      const pts = wireRoute({ a: d.a, b: d.b, vf: d.vf }).map(p => p.join(',')).join(' ');
      h += `<polyline class="wire-ghost" points="${pts}"/>`;
    }
    if (this.placing && this.ghostAt) {
      const T = TYPES[this.placing];
      const el = { t: this.placing, x: this.ghostAt[0], y: this.ghostAt[1], r: 0, p: Object.assign({}, T.props || {}) };
      const open = T.normal === false;
      const c = { p0: 'c-edit', p1: 'c-edit', st: open ? 's-off' : 's-on', open, f0: colorVar('c-edit') };
      h += `<g class="ghost" transform="translate(${el.x} ${el.y})">${symbolSVG(el, c)}</g>`;
    }
    let g = this.lo.querySelector('#ovx');
    if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.id = 'ovx'; this.lo.appendChild(g); }
    g.innerHTML = h;
  }
  burst(id, color) {
    const el = this.app.scheme.els.find(e => e.id === id);
    if (!el) return;
    const b = bbox(el), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = `<circle class="burst" cx="${cx}" cy="${cy}" r="0.4" style="fill:${color}"><animate attributeName="r" from="0.4" to="3.2" dur="1.1s" fill="freeze"/><animate attributeName="opacity" from="0.75" to="0" dur="1.1s" fill="freeze"/></circle>`;
    this.lfx.appendChild(g);
    setTimeout(() => g.remove(), 1300);
  }
  checkMark(id, live) {
    const el = this.app.scheme.els.find(e => e.id === id);
    let x, y;
    if (el) { const b = bbox(el); x = b[0] - 0.2; y = b[1] - 0.2; }
    else { const w = this.app.scheme.wires.find(v => v.id === id); if (!w) return; x = (w.a[0] + w.b[0]) / 2; y = (w.a[1] + w.b[1]) / 2; }
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'vcheck');
    const col = live ? 'var(--fault)' : 'var(--ok)';
    g.innerHTML = `<circle cx="${x}" cy="${y}" r="0.55" style="fill:var(--panel);stroke:${col};stroke-width:.1"/><text x="${x}" y="${y + 0.22}" text-anchor="middle" style="font:700 .6px var(--f-mono);fill:${col}">U</text><animate attributeName="opacity" from="1" to="0" begin="1.6s" dur="0.6s" fill="freeze"/>`;
    this.lfx.appendChild(g);
    setTimeout(() => g.remove(), 2400);
  }

  // ---------- мышь и касания ----------
  bind() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', e => this.onDown(e));
    svg.addEventListener('pointermove', e => this.onMove(e));
    svg.addEventListener('pointerup', e => this.onUp(e, false));
    svg.addEventListener('pointercancel', e => this.onUp(e, true));
    svg.addEventListener('pointerleave', () => { if (this.placing && !this.drag) { this.ghostAt = null; this.overlayExtra(); } });
    svg.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('dblclick', e => {
      if (this.app.mode !== 'edit') return;
      const wG = e.target.closest('[data-w]'), elG = e.target.closest('[data-el]');
      if (elG) { this.app.rotateSel(); return; }
      if (wG) { const w = this.app.scheme.wires.find(v => v.id === wG.dataset.w); if (w) { this.app.history(); w.vf = !w.vf; this.app.commit(); } }
    });
  }
  vfFor(p) {
    const k = ptKey(p);
    for (const el of this.app.scheme.els) {
      if (el.t === 'bus') { if (portPoints(el).some(q => ptKey(q) === k)) return el.r % 2 === 0; continue; }
      const T = TYPES[el.t];
      for (let i = 0; i < T.ports.length; i++) {
        const q = rot(T.ports[i], el.r);
        if (el.x + q[0] === p[0] && el.y + q[1] === p[1]) { const vert = Math.abs(T.ports[i][1]) >= Math.abs(T.ports[i][0]); return vert !== (el.r % 2 === 1); }
      }
    }
    return true;
  }
  attached(el) {
    const keys = new Set(portPoints(el).map(ptKey)), out = [];
    for (const w of this.app.scheme.wires) for (const end of ['a', 'b']) if (keys.has(ptKey(w[end]))) out.push({ w, end, x: w[end][0], y: w[end][1] });
    return out;
  }
  onDown(e) {
    this.app.userGesture();
    try { this.svg.setPointerCapture(e.pointerId); } catch (_) { /* старые браузеры */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const r = this.svg.getBoundingClientRect();
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      this.drag = { kind: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, k0: this.k, wm: [(mx - r.left - this.tx) / (this.k * G), (my - r.top - this.ty) / (this.k * G)] };
      this.overlayExtra();
      return;
    }
    if (this.pointers.size > 2) return;
    const app = this.app, edit = app.mode === 'edit';
    const p = this.toWorld(e.clientX, e.clientY), g = [Math.round(p[0]), Math.round(p[1])];
    const t = e.target;
    const elG = t.closest('[data-el]'), wG = t.closest('[data-w]');
    const pt = t.getAttribute('data-pt'), we = t.getAttribute('data-we'), bh = t.getAttribute('data-bh');
    this.down = { x: e.clientX, y: e.clientY, moved: false };
    const pan = extra => Object.assign({ kind: 'pan', x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty }, extra || {});
    if (e.button === 1 || e.button === 2) { this.drag = pan(); return; }
    if (!edit) { this.drag = pan({ click: elG ? { el: elG.dataset.el } : wG ? { w: wG.dataset.w } : null }); return; }
    if (this.placing) { app.placeAt(this.placing, g, e.shiftKey); this.drag = null; return; }
    if (we) { const [wid, end] = we.split(':'); app.history(); this.drag = { kind: 'wend', wid, end }; return; }
    if (bh) { app.history(); this.drag = { kind: 'bus', id: bh }; return; }
    if (pt) { const a = pt.split(',').map(Number); this.drag = { kind: 'wire', a, b: a, vf: this.vfFor(a) }; this.overlayExtra(); return; }
    if (elG) {
      const id = elG.dataset.el, el = app.scheme.els.find(x => x.id === id);
      this.select({ type: 'el', id });
      this.drag = { kind: 'move', id, sx: el.x, sy: el.y, p0: p, att: this.attached(el), started: false };
      return;
    }
    if (wG) { this.select({ type: 'wire', id: wG.dataset.w }); this.drag = null; return; }
    if (this.sel) this.select(null);
    this.drag = pan();
  }
  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (d && d.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [p1, p2] = [...this.pointers.values()];
      const r = this.svg.getBoundingClientRect();
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      this.k = clamp(d.k0 * Math.hypot(p1.x - p2.x, p1.y - p2.y) / d.d0, 0.2, 5);
      this.tx = mx - r.left - d.wm[0] * this.k * G; this.ty = my - r.top - d.wm[1] * this.k * G;
      this.applyView();
      return;
    }
    const p = this.toWorld(e.clientX, e.clientY), g = [Math.round(p[0]), Math.round(p[1])];
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) this.down.moved = true;
    if (!d) {
      if (this.placing) { if (!this.ghostAt || this.ghostAt[0] !== g[0] || this.ghostAt[1] !== g[1]) { this.ghostAt = g; this.overlayExtra(); } }
      return;
    }
    const app = this.app;
    if (d.kind === 'pan') { if (this.down && this.down.moved) { this.tx = d.tx + e.clientX - d.x; this.ty = d.ty + e.clientY - d.y; this.applyView(); } return; }
    if (d.kind === 'move') {
      const dx = Math.round(p[0] - d.p0[0]), dy = Math.round(p[1] - d.p0[1]);
      const el = app.scheme.els.find(x => x.id === d.id);
      if (!el || (el.x === d.sx + dx && el.y === d.sy + dy)) return;
      if (!d.started) { app.history(); d.started = true; }
      el.x = d.sx + dx; el.y = d.sy + dy;
      for (const a of d.att) a.w[a.end] = [a.x + dx, a.y + dy];
      this.render();
      return;
    }
    if (d.kind === 'wire') { if (d.b[0] !== g[0] || d.b[1] !== g[1]) { d.b = g; this.overlayExtra(); } return; }
    if (d.kind === 'wend') {
      const w = app.scheme.wires.find(v => v.id === d.wid);
      if (w && (w[d.end][0] !== g[0] || w[d.end][1] !== g[1])) { w[d.end] = g; this.render(); }
      return;
    }
    if (d.kind === 'bus') {
      const el = app.scheme.els.find(x => x.id === d.id);
      if (!el) return;
      const loc = rot([g[0] - el.x, g[1] - el.y], 4 - el.r);
      const len = clamp(Math.round(loc[0]), 1, 200);
      if (len !== el.p.len) { el.p.len = len; this.render(); }
    }
  }
  onUp(e, cancel) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d && d.kind === 'pinch') { if (this.pointers.size === 0) this.drag = null; return; }
    this.drag = null;
    const moved = this.down && this.down.moved;
    this.down = null;
    if (!d) return;
    if (d.kind === 'wire') {
      if (!cancel && (d.b[0] !== d.a[0] || d.b[1] !== d.a[1])) this.app.addWire(d.a, d.b, d.vf);
      this.overlayExtra();
      return;
    }
    if (d.kind === 'move') { if (d.started) this.app.commit(); return; }
    if (d.kind === 'wend' || d.kind === 'bus') { this.app.commit(); return; }
    if (d.kind === 'pan' && d.click && !moved && !cancel) this.app.pick2D(d.click);
  }
  select(sel) {
    this.sel = sel;
    this.render();
    this.app.renderSide();
  }
  setPlacing(t) {
    this.placing = t;
    this.ghostAt = null;
    this.svg.style.cursor = t ? 'copy' : '';
    this.overlayExtra();
  }
}

export { CVAR, colorVar, symbolSVG, symbolIcon, elSubtitle, hitBox, Scheme2D };
