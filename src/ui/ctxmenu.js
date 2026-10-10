import { TYPES, esc, isSwitchable, isPzId } from '../core/elements.js';
import { countText } from './panels.js';

/* ===== Меню по правой кнопке на 2D-схеме (на телефоне — долгое нажатие) =====
   Пункты — только те, что применимы сейчас; справа — клавиша, если она есть. Действие идёт тем же путём, что щелчок
   и кнопки панели (app.pick2D с инструментом, app.doAct, rotateSel, deleteSel…): движок, журнал, баллы, блокировки,
   звук и правило 5 — без второй логики. Инструмент панели (указатель, ПЗ) пункт меню не включает — нечему «залипать».
   В экзамене — только операции, указатель и ПЗ (без «Подробнее»: там и порядок переключений).
   c — что под курсором: { el?, w?, p — точка схемы в клетках, cx, cy — точка окна }. */

function itemsFor(app, c) {
  const out = [], tr = app.tr, v = app.view;
  const add = (label, run, o) => out.push(Object.assign({ label, run }, o || {}));
  const sep = () => { if (out.length && !out[out.length - 1].sep) out.push({ sep: true }); };
  if (app.mode === 'edit') {
    const sel = v.sel, group = sel && sel.type === 'group' && ((c.el && sel.els.has(c.el)) || (c.w && sel.wires.has(c.w)));
    if (group) {
      add('Повернуть', () => app.rotateSel(), { key: 'R' });
      add('Копировать', () => app.copySel(), { key: 'Ctrl+C' });
      sep();
      add('Удалить', () => app.deleteSel(), { key: 'Del', danger: true });
      return { title: 'Выбрано: ' + countText(sel.els.size, sel.wires.size), items: out };
    }
    if (c.el) {
      const el = app.scheme.els.find(e => e.id === c.el);
      if (!el) return { items: [] };
      v.select({ type: 'el', id: el.id });
      add('Повернуть', () => app.rotateSel(), { key: 'R' });
      add('Копировать', () => app.copySel(), { key: 'Ctrl+C' });
      add('Свойства', () => app.showProps());
      add('Подробнее', () => app.showMore(el.id));
      sep();
      add('Удалить', () => app.deleteSel(), { key: 'Del', danger: true });
      return { title: `${el.name} · ${TYPES[el.t].title}`, items: out };
    }
    if (c.w) {
      v.select({ type: 'wire', id: c.w });
      add('Изменить излом', () => app.sideAction('bend'), { key: '2× щелчок' });
      sep();
      add('Удалить', () => app.deleteSel(), { key: 'Del', danger: true });
      return { title: 'Провод', items: out };
    }
    if (app.clipboard()) add('Вставить сюда', () => app.paste(c.p), { key: 'Ctrl+V' });
    return { title: 'Схема', items: out };
  }
  // тренажёр
  const exam = !!(app.exam && app.exam.active()), task = !!(tr.run && !tr.run.done);
  const pzLabel = n => n != null && tr.pzAt(n) ? 'Снять ПЗ' : 'Наложить ПЗ';
  if (c.el) {
    const el = tr.elOf(c.el);
    if (!el) return { items: [] };
    if (isPzId(c.el)) {
      add('Снять ПЗ', () => app.pick2D(c, 'pz'), { key: 'P' });
      return { title: el.name, items: out };
    }
    const T = TYPES[el.t];
    if (isSwitchable(el)) for (const a of tr.actions(el.id)) add(a.label, () => app.doAct(el.id, a));
    else if (T.cls === 'source' && !task) {
      const ss = tr.sim.src[el.id], on = ss && ss.on && !ss.trip;
      add(on ? 'Снять напряжение со стороны энергосистемы' : 'Подать напряжение со стороны энергосистемы', () => app.pick2D(c, null));
    }
    sep();
    add('Проверить отсутствие напряжения', () => app.pick2D(c, 'check'), { key: 'V' });
    if (el.t === 'bus') add(pzLabel(tr.topo.term.get(el.id)[0]), () => app.pick2D(c, 'pz'), { key: 'P' });
    if (!exam) { sep(); add('Подробнее', () => app.showMore(el.id)); }
    return { title: `${el.name} · ${T.title}`, items: out };
  }
  if (c.w) {
    add('Проверить отсутствие напряжения', () => app.pick2D(c, 'check'), { key: 'V' });
    add(pzLabel(tr.topo.wireNode.get(c.w)), () => app.pick2D(c, 'pz'), { key: 'P' });
    return { title: 'Провод ' + tr.nodeName(tr.topo.wireNode.get(c.w)), items: out };
  }
  return { items: [] };
}

class CtxMenu {
  constructor(app) { this.app = app; this.box = null; this.items = []; }
  isOpen() { return !!this.box; }
  // Открыть у точки окна; пунктов нет — ничего не открывать
  open(c) {
    this.close();
    const { title, items } = itemsFor(this.app, c);
    if (!items.some(i => !i.sep)) return false;
    while (items.length && items[items.length - 1].sep) items.pop();
    const m = document.createElement('div');
    m.className = 'ctxmenu'; m.id = 'ctxmenu'; m.setAttribute('role', 'menu');
    if (title) m.setAttribute('aria-label', title);
    m.innerHTML = (title ? `<div class="ctxmenu-h">${esc(title)}</div>` : '') + items.map((it, i) => it.sep ? '<div class="ctxmenu-sep" role="separator"></div>'
      : `<button type="button" class="ctxmenu-i${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}"><span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
    document.body.appendChild(m);
    // рядом с точкой, целиком на экране: не влезает справа — левее точки, снизу — выше
    const W = window.innerWidth, H = window.innerHeight, w = m.offsetWidth, h = Math.min(m.offsetHeight, H - 16);
    let x = c.cx + 6, y = c.cy + 6;
    if (x + w > W - 8) x = c.cx - w - 6;
    if (y + h > H - 8) y = c.cy - h - 6;
    m.style.left = Math.round(Math.max(8, Math.min(x, W - w - 8))) + 'px';
    m.style.top = Math.round(Math.max(8, Math.min(y, H - h - 8))) + 'px';
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const it = items[+b.dataset.i];
      this.close();
      it.run();
    });
    m.addEventListener('keydown', e => this.onKey(e));
    m.addEventListener('contextmenu', e => e.preventDefault());
    this.box = m; this.items = items;
    const first = m.querySelector('[data-i]');
    if (first) first.focus({ preventScroll: true });
    // закрыть: нажатие мимо, прокрутка, колесо (масштаб схемы), смена размера окна
    this.off = e => { if (!m.contains(e.target)) this.close(); };
    this.offScroll = e => { if (!m.contains(e.target)) this.close(); };
    this.offResize = () => this.close();
    setTimeout(() => { if (this.box === m) document.addEventListener('pointerdown', this.off, true); }, 0);
    window.addEventListener('wheel', this.offScroll, { capture: true, passive: true });
    window.addEventListener('scroll', this.offScroll, true);
    window.addEventListener('resize', this.offResize);
    return true;
  }
  close() {
    if (!this.box) return;
    const had = this.box.contains(document.activeElement);
    this.box.remove(); this.box = null; this.items = [];
    document.removeEventListener('pointerdown', this.off, true);
    window.removeEventListener('wheel', this.offScroll, { capture: true });
    window.removeEventListener('scroll', this.offScroll, true);
    window.removeEventListener('resize', this.offResize);
    if (had) { try { this.app.view.svg.focus({ preventScroll: true }); } catch (e) { /* фокус не важен */ } }
  }
  // Стрелки, Home/End — по пунктам, Enter и пробел — выбрать (кнопка), Esc и Tab — закрыть
  onKey(e) {
    const bs = [...this.box.querySelectorAll('[data-i]')], i = bs.indexOf(document.activeElement);
    const go = j => { e.preventDefault(); bs[(j + bs.length) % bs.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); bs[i].click(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); this.close(); }
    else return;
    // клавиши меню не доходят до клавиш редактора и тренажёра (Esc там снимает выделение)
    e.stopPropagation();
  }
}

export { CtxMenu, itemsFor };
