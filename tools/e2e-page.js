/* Помощник автопроходки внутри страницы (tools/e2e.mjs вставляет этот файл в страницу).
   Здесь только «где щёлкнуть» и «куда повернуться»: сами действия — настоящие события мыши и клавиш из CDP,
   через те же обработчики, что у пользователя. Прямые вызовы — только чтобы переместиться (вид 2D, место в 3D). */
window.E2E = (() => {
  const app = () => window.TS.app;
  const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const topIs = (x, y, el) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };

  // Кнопка или поле интерфейса: центр после прокрутки в видимую область. text — точный текст кнопки
  function box(sel, text) {
    const list = [...document.querySelectorAll(sel)].filter(e => shown(e) && !e.disabled && (text == null || e.textContent.trim() === text));
    const el = list[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { x, y, ok: topIs(x, y, el) };
  }
  // Переключатель настройки (label.switch с input[data-opt]) — щелчок по подписи
  function opt(name) {
    const inp = document.querySelector(`input[data-opt="${name}"]`);
    const lab = inp && inp.closest('label');
    if (!lab) return null;
    lab.scrollIntoView({ block: 'center' });
    const r = lab.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + r.height / 2, on: inp.checked };
  }

  // ---------- 2D ----------
  const G = () => { const v = app().view, m = /scale\(([\d.]+)\)/.exec(v.world.getAttribute('transform') || ''); return m ? +m[1] / v.k : 20; };
  // Сдвинуть вид так, чтобы точка схемы p была в середине поля (это «перетащить схему мышью»)
  function centerOn(p, k) {
    const v = app().view, r = v.svg.getBoundingClientRect(), g = G();
    if (k) v.k = k;
    v.tx = r.width / 2 - p[0] * v.k * g; v.ty = r.height / 2 - p[1] * v.k * g;
    v.applyView();
  }
  function candidates(target) {
    const pts = [];
    const g = document.querySelector(`#le [data-el="${CSS.escape(target)}"]`);
    if (g) {
      const hit = g.querySelector('.hit') || g, r = hit.getBoundingClientRect();
      for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) pts.push([r.left + r.width * fx, r.top + r.height * fy]);
      return { el: g, pts };
    }
    const w = document.querySelector(`#lw [data-w="${CSS.escape(target)}"]`);
    if (!w) return null;
    const pl = w.querySelector('.hitw'), m = pl.getScreenCTM(), P = [...pl.points].map(q => new DOMPoint(q.x, q.y).matrixTransform(m));
    for (let i = 0; i < P.length - 1; i++) for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) pts.push([P[i].x + (P[i + 1].x - P[i].x) * f, P[i].y + (P[i + 1].y - P[i].y) * f]);
    return { el: w, pts };
  }
  // Точка, где щелчок попадёт в аппарат (или провод) target; не видно или закрыто — сдвинуть вид и искать снова
  function hit(target) {
    const r = app().view.svg.getBoundingClientRect();
    const find = () => {
      const c = candidates(target);
      if (!c) return null;
      for (const [x, y] of c.pts) {
        if (x < r.left + 4 || y < r.top + 4 || x > r.right - 4 || y > r.bottom - 4) continue;
        const t = document.elementFromPoint(x, y), own = t && t.closest('[data-el], [data-w]');
        if (own === c.el) return { x, y, ok: true };
      }
      return null;
    };
    let p = find();
    if (p) return p;
    const s = app().scheme, el = s.els.find(e => e.id === target), w = s.wires.find(e => e.id === target);
    const at = el ? [el.x, el.y] : w ? [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] : null;
    if (!at) return { ok: false, why: 'нет на схеме' };
    centerOn(at, Math.max(app().view.k, 0.9));
    p = find();
    return p || { ok: false, why: 'закрыто другими элементами' };
  }

  // ---------- 3D: прицел пешком ----------
  const v3 = () => app().v3;
  function proxyOf(key, val) { return v3().pickables.find(o => o.userData[key] === val) || null; }
  // Повернуться (и при нужде перейти) так, чтобы прицел был на нужном: what = { item | mount | dev | menu }
  function aim(what) {
    const v = v3(), w = v.walk, T = v.kit.T;
    const want = a => {
      if (!a) return false;
      if (what.menu) return a.type === 'menu' && !!v.menuBtn(a.h.uv) && v.menuBtn(a.h.uv).a.label === what.menu;
      if (what.item) return a.type === 'item' && a.id === what.item;
      if (what.mount) return a.type === 'mount' && a.id === what.mount;
      if (what.dev) return a.type === 'dev' && a.id === what.dev;
      return false;
    };
    let p;
    if (what.menu) {
      const mm = v.menu3d;
      if (!mm) return { ok: false, why: 'меню не открыто' };
      const b = mm.btns.find(q => q.a.label === what.menu);
      if (!b) return { ok: false, why: 'в меню нет пункта' };
      const ph = mm.m.geometry.parameters.height;
      mm.m.updateWorldMatrix(true, false);
      p = mm.m.localToWorld(new T.Vector3(0, (0.5 - (b.y0 + b.y1) / 2 / mm.H) * ph, 0));
    } else {
      const o = proxyOf(what.item ? 'item' : what.mount ? 'mount' : 'dev', what.item || what.mount || what.dev);
      if (!o) return { ok: false, why: 'нет такого объекта в сцене' };
      o.updateWorldMatrix(true, false);
      p = o.getWorldPosition(new T.Vector3());
    }
    const look = (x, z) => {
      w.x = x; w.z = z; w.vx = 0; w.vz = 0;
      const dx = p.x - x, dz = p.z - z;
      w.yaw = Math.atan2(-dx, -dz); w.pitch = Math.atan2(p.y - 1.62, Math.hypot(dx, dz));
      w.apply(); w.updateAim();
      return want(w.aim);
    };
    // сначала — повернуться на месте; меню — только так (отойдёшь — закроется)
    if (look(w.x, w.z)) return { ok: true };
    if (what.menu) return { ok: false, why: 'прицел не попадает в пункт меню' };
    for (const d of [1.1, 0.8, 1.5, 1.9, 2.3]) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (!w.world.walkable(x, z)) continue;
      if (look(x, z)) return { ok: true, x, z };
    }
    return { ok: false, why: 'не нашлось места, откуда видно' };
  }
  function held() { const it = v3().items; return it ? it.heldIn('desk') : null; }

  // ---------- общее ----------
  // Видимый текст страницы и отчёта без «undefined», «NaN», «[object Object]»
  function badText() {
    const bad = /undefined|NaN|\[object Object\]/;
    const texts = [document.body.innerText, app().reportText || ''];
    for (const t of texts) { const m = bad.exec(t); if (m) return t.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' '); }
    return null;
  }
  function report() {
    const m = document.getElementById('modal');
    if (m.hidden) return null;
    const sc = m.querySelector('.verdict .score'), vb = m.querySelector('.verdict b');
    return { title: (m.querySelector('#dlgT') || {}).textContent || '', score: sc ? +sc.textContent : null, verdict: vb ? vb.textContent : '', text: m.innerText };
  }
  const KIND = { accident: 'авария', kz: 'КЗ', blocked: 'блокировка', supply: 'перерыв питания', proc: 'порядок', safety: 'охрана труда' };
  function run() {
    const r = app().tr.run;
    return r ? { ops: r.ops.length, errors: r.errors.map(e => (KIND[e.kind] || e.kind) + ': ' + e.text), done: r.done } : null;
  }
  return { box, opt, hit, centerOn, aim, held, badText, report, run };
})();
true;
