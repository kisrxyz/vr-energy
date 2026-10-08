/* ===== Пешком на ноутбуке: VR-полигон и площадка, как в играх =====
   Мир (world.js) — где ходить: полигон (room.js) или площадка (view3d.buildYard). Сквозь стены, ячейки, тележки
   и аппараты не пройти (world.resolve). Щелчок по сцене — захват мыши (Esc — отпустить), мышь — смотреть,
   WASD или стрелки — ходить (≈3 м/с, как стиком в шлеме). Прицел в центре экрана, под ним — что под прицелом и что будет.
   Полигон: E или щелчок — взять, применить, переключить; Q (или правая кнопка) — положить.
   Площадка: E или щелчок по аппарату — как щелчок мышью в обзоре (у тележки — меню), с указателем (V) или ПЗ (P) —
   проверить или заземлить аппарат и провод; дальность REACH; щелчок по земле ближе FLOOR — перейти туда.
   Захват: Chrome около секунды после выхода по Esc отказывает в новом — такие отказы не считаются.
   Если отказы повторяются и вне этой паузы — смотреть перетаскиванием, действие — щелчком по месту.
   Состояние захвата меняют только lockChanged и lockFailed: их можно вызвать и без настоящего захвата (проверка в headless). */
import { store } from '../ui/store.js';
import { esc } from '../core/elements.js';

const EYE = 1.62, SPEED = 3.1, SENS = 0.0022, R = 0.25;
// Площадка: до аппарата и провода (они высокие), до щита и меню, до земли для перехода, м
const REACH = { dev: 6, board: 9, floor: 25 };
// После выхода из захвата Chrome ~1 с отказывает в новом: отказ в эту паузу не считается, мс
const LOCK_PAUSE = 1600;

class Walk {
  constructor(v) {
    this.v = v; this.on = false; this.keys = new Set();
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.vx = 0; this.vz = 0;
    // noLock — смотреть перетаскиванием (нет API или отказы вне паузы); lockReq — запрос захвата ждёт ответа
    this.locked = false; this.noLock = !('requestPointerLock' in HTMLElement.prototype); this.lockFails = 0;
    this.lockReq = null; this.unlockedAt = -Infinity; this.lockWait = false;
    this.drag = null; this.cursor = null; this.aim = null; this.hudText = {};
    this.makeHud();
    this.bind();
  }
  makeHud() {
    const host = this.v.host, el = document.createElement('div');
    el.className = 'v3-fps'; el.hidden = true;
    el.innerHTML = `<div class="v3-cross" aria-hidden="true"></div><div class="v3-aim" aria-live="polite"></div>
      <div class="v3-said" role="status" hidden></div>
      <div class="v3-next" hidden></div>
      <div class="v3-hand"><span class="ppe"></span><span class="held"></span></div>
      <div class="v3-keys" aria-label="Управление"><b>Управление</b>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить</span>
        <span>мышь — смотреть · <kbd>Esc</kbd> отпустить мышь</span>
        <span><kbd>E</kbd> или щелчок — <i data-w="room">взять, надеть, повесить, </i>переключить</span>
        <span data-w="room"><kbd>Q</kbd> или правая кнопка — положить</span>
        <span data-w="yard"><kbd>V</kbd> указатель · <kbd>P</kbd> ПЗ · щелчок по земле — перейти</span></div>
      <button class="v3-click" type="button"><b>Мышь свободна — щёлкните по сцене</b><small></small></button>
      <div class="v3-intro" role="dialog" aria-labelledby="v3IntroT" hidden><h3 id="v3IntroT">VR-полигон: как брать предметы</h3>
        <ol><li><b>Подойдите к стенду справа от входа</b> — WASD и мышь (в шлеме — стик или курок по полу).</li>
        <li><b>E — взять предмет.</b> Перчатки и каска надеваются сразу. С предметом в руке E — применить: повесить плакат, запереть замок, коснуться указателем контактов. Q — положить. В шлеме — боковая кнопка: взять (СИЗ — сразу надеть) и отпустить у места.</li>
        <li><b>Аппараты переключают</b> щелчком или E: тележка ячейки — меню положений, рукоятка на правой стойке — ЗН. Щит с заданием — на правой стене.</li></ol>
        <button class="btn primary" type="button" data-intro="ok">Понятно</button></div>`;
    host.appendChild(el);
    this.hud = {
      root: el, aim: el.querySelector('.v3-aim'), next: el.querySelector('.v3-next'), ppe: el.querySelector('.ppe'),
      held: el.querySelector('.held'), click: el.querySelector('.v3-click'), clickWhy: el.querySelector('.v3-click small'),
      intro: el.querySelector('.v3-intro'), cross: el.querySelector('.v3-cross'), said: el.querySelector('.v3-said'),
    };
    this.hud.click.addEventListener('click', () => this.lock());
    this.hud.intro.querySelector('[data-intro]').addEventListener('click', () => this.intro(false));
  }
  bind() {
    const cv = () => this.v.renderer && this.v.renderer.domElement;
    const typing = e => { const t = (e.target && e.target.tagName || '').toLowerCase(); return t === 'input' || t === 'textarea' || t === 'select'; };
    const live = () => this.on && this.v.active && !(this.v.renderer && this.v.renderer.xr.isPresenting) && document.getElementById('modal').hidden;
    document.addEventListener('keydown', e => {
      if (!live() || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const c = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) {
        this.keys.add(c);
        if (c.startsWith('Arrow')) e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (c === 'KeyE') { e.preventDefault(); this.action(); }
      else if (c === 'KeyQ') { e.preventDefault(); this.drop(); }
    });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    // ушли из окна или со вкладки — мышь отпускаем сами, чтобы курсор не остался спрятанным
    window.addEventListener('blur', () => { this.keys.clear(); this.unlock(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.keys.clear(); this.unlock(); } });
    document.addEventListener('pointerlockchange', () => this.lockChanged(!!cv() && document.pointerLockElement === cv()));
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    document.addEventListener('mousemove', e => {
      if (!this.locked || !live()) return;
      this.look(e.movementX || 0, e.movementY || 0);
    });
  }
  // Пешком и обратно. world — полигон или площадка (world.js)
  enable(world) {
    this.world = world; this.on = true;
    this.hud.root.hidden = false;
    this.hud.root.dataset.world = world.kind;
    this.v.host.dataset.fps = '1';
    if (world.kind === 'room' && store.get('ts.polyIntro') !== '1') this.intro(true); else this.intro(false, true);
    this.showClick();
  }
  disable() {
    this.on = false; this.keys.clear();
    if (this.v.items) { this.v.items.hover(null); this.v.items.preview(null); }
    this.hud.root.hidden = true;
    delete this.v.host.dataset.fps;
    this.unlock();
    if (this.v.renderer) this.v.renderer.domElement.style.cursor = '';
    this.cur = null;
  }
  // Итог действия у прицела на 2,6 с (проверка указателем): туда, куда человек смотрит; live — красным
  said(text, live) {
    const el = this.hud.said;
    el.textContent = text; el.classList.toggle('live', !!live); el.hidden = false;
    clearTimeout(this._saidT);
    this._saidT = setTimeout(() => { el.hidden = true; }, 2600);
  }
  // Карточка «как брать предметы» (полигон); quiet — спрятать, не отмечая «прочитано»
  intro(on, quiet) {
    this.hud.intro.hidden = !on;
    if (!on && !quiet) store.set('ts.polyIntro', '1');
    this.showClick();
  }
  // Надпись «Мышь свободна» — пока мышь не захвачена и захват возможен; после отказа в паузе — «щёлкните ещё раз»
  showClick() {
    const h = this.hud;
    h.click.hidden = !this.on || this.locked || this.noLock || !h.intro.hidden;
    h.clickWhy.textContent = this.lockWait ? 'Браузер ещё не отпустил мышь — щёлкните ещё раз' : 'Esc — снова отпустить мышь';
  }
  lock() {
    if (this.noLock || this.locked || !this.v.renderer) return;
    const req = this.lockReq = {};
    try {
      const p = this.v.renderer.domElement.requestPointerLock();
      // отказ приходит дважды — обещанием и событием pointerlockerror; lockFailed считает его один раз
      if (p && p.catch) p.catch(() => this.lockFailed(performance.now(), req));
    } catch (e) { this.lockFailed(performance.now(), req); }
  }
  unlock() {
    const cv = this.v.renderer && this.v.renderer.domElement;
    if (cv && document.pointerLockElement === cv) try { document.exitPointerLock(); } catch (e) { /* уже отпущена */ }
  }
  // Мышь захвачена или отпущена (событие pointerlockchange)
  lockChanged(on, now = performance.now()) {
    if (this.locked && !on) this.unlockedAt = now;
    this.locked = on;
    if (on) { this.lockFails = 0; this.lockReq = null; this.lockWait = false; }
    this.hud.root.classList.toggle('locked', on);
    this.showClick();
  }
  // Браузер отказал в захвате. В паузе после выхода — не считаем, просим щёлкнуть ещё раз;
  // вне паузы два отказа подряд — смотреть перетаскиванием до конца сеанса
  lockFailed(now = performance.now(), req = this.lockReq) {
    if (!req || req !== this.lockReq) return;
    this.lockReq = null;
    if (now - this.unlockedAt < LOCK_PAUSE) { this.lockWait = true; this.showClick(); return; }
    this.lockWait = false;
    if (++this.lockFails < 2) { this.showClick(); return; }
    this.noLock = true; this.showClick();
    this.v.app.toast('Мышь не захватывается: смотрите, перетаскивая мышью, действие — щелчок по месту.');
  }
  reset(start) {
    this.x = start.x; this.z = start.z; this.yaw = start.yaw; this.pitch = -0.12; this.vx = 0; this.vz = 0;
    this.apply();
  }
  apply() {
    const c = this.v.camera;
    c.position.set(this.x, EYE, this.z);
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  look(dx, dy) {
    this.yaw -= dx * SENS;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * SENS));
  }
  // Откуда смотреть на точку p (мир), чтобы под прицелом было нужное (want(aim) → true): сначала — повернуться на месте,
  // потом (если не stay) — места вокруг точки на расстояниях dists, где можно стоять. Возвращает { x, z, yaw, pitch } или null.
  // Место и взгляд не меняет — нужен автопоказу (src/ui/demo.js) и автопроходке (tools/e2e-page.js)
  seek(p, want, stay, dists = [1.1, 0.8, 1.5, 1.9, 2.3, 3, 4]) {
    const save = [this.x, this.z, this.yaw, this.pitch];
    const look = (x, z) => {
      const dx = p.x - x, dz = p.z - z;
      this.x = x; this.z = z; this.yaw = Math.atan2(-dx, -dz); this.pitch = Math.atan2(p.y - EYE, Math.hypot(dx, dz));
      this.apply(); this.updateAim();
      return want(this.aim) ? { x, z, yaw: this.yaw, pitch: this.pitch } : null;
    };
    let pose = look(this.x, this.z);
    if (!pose && !stay) {
      search: for (const d of dists) for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2, x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (this.world.walkable(x, z, R) && (pose = look(x, z))) break search;
      }
    }
    [this.x, this.z, this.yaw, this.pitch] = save;
    this.apply(); this.updateAim();
    return pose;
  }
  // Встать и посмотреть (прямо, без анимации)
  pose(q) { this.x = q.x; this.z = q.z; this.yaw = q.yaw; this.pitch = q.pitch; this.vx = 0; this.vz = 0; this.apply(); this.updateAim(); }

  // ---------- мышь по холсту (view3d передаёт сюда, пока полигон открыт от первого лица) ----------
  pointer(e) {
    const t = e.type;
    if (t === 'pointerdown') {
      this.v.app.userGesture();
      if (!this.hud.intro.hidden) return;
      if (this.locked) { if (e.button === 0) this.action(); else if (e.button === 2) this.drop(); return; }
      if (!this.noLock) { this.lock(); return; }
      this.drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* без захвата */ }
      return;
    }
    if (t === 'pointermove') {
      if (this.locked) return;
      this.cursor = { x: e.clientX, y: e.clientY };
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true; d.x = e.clientX; d.y = e.clientY;
      this.look(-dx * 1.4, -dy * 1.4);
      return;
    }
    if (t === 'pointerup' || t === 'pointercancel') {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && t === 'pointerup') { if (d.btn === 0) this.action(); else if (d.btn === 2) this.drop(); }
    }
    if (t === 'pointerleave') this.cursor = null;
  }

  // ---------- каждый кадр ----------
  step(dt) {
    if (!this.on) return;
    const k = this.keys, has = (...a) => a.some(c => k.has(c));
    const f = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    const sp = SPEED, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let tx = -sy * f + cy * s, tz = -cy * f - sy * s;
    const l = Math.hypot(tx, tz);
    if (l > 1) { tx /= l; tz /= l; }
    const a = Math.min(1, dt * 10);
    this.vx += (tx * sp - this.vx) * a; this.vz += (tz * sp - this.vz) * a;
    // стены, ячейки, тележки и аппараты не пускают; тележка, выкаченная туда, где стоишь, отодвигает
    [this.x, this.z] = this.world.resolve(this.x + this.vx * dt, this.z + this.vz * dt, R);
    this.apply();
    this.updateAim();
  }
  // Что под прицелом (или под курсором, если мышь не захвачена)
  updateAim() {
    const v = this.v, T = v.kit.T, cv = v.renderer.domElement, r = cv.getBoundingClientRect();
    let nx = 0, ny = 0;
    if (!this.locked && this.noLock && this.cursor) { nx = ((this.cursor.x - r.left) / r.width) * 2 - 1; ny = -((this.cursor.y - r.top) / r.height) * 2 + 1; }
    this._ndc = this._ndc || new T.Vector2();
    this._ndc.set(nx, ny);
    v.camera.updateMatrixWorld();
    v.ray.setFromCamera(this._ndc, v.camera);
    const yard = this.world.kind === 'yard';
    v.ray.far = yard ? REACH.floor + 1 : 12;
    const hits = v.ray.intersectObjects(v.pickables, false);
    if (yard) {
      this.aim = this.pickYard(hits);
      // на землю — только если перед ней ничего нет (провода над головой не в счёт) и там можно стоять
      const first = hits.find(h => !h.object.userData.wire);
      this.floor = !this.aim && first && first.object.userData.ground && first.distance <= REACH.floor && this.world.walkable(first.point.x, first.point.z) ? first : null;
    } else {
      this.aim = v.items ? v.items.pick(hits, 'desk', 2.6) : null;
      this.floor = hits.find(h => h.object.userData.ground) || null;
    }
    this.drawHud();
  }
  // Площадка: аппарат, провод (с указателем или ПЗ), щит или меню под прицелом — как щелчок мышью в обзоре (view3d.firstHit)
  pickYard(hits) {
    const h = this.v.firstHit(hits);
    if (!h) return null;
    const u = h.object.userData, type = u.menu ? 'menu' : u.board ? 'board' : u.dev ? 'dev' : u.wire ? 'wire' : null;
    if (!type || h.distance > (type === 'menu' || type === 'board' ? REACH.board : REACH.dev)) return null;
    return { h, type, id: u.dev || u.wire || null };
  }
  drawHud() {
    const v = this.v, it = v.items, pm = v.app.permit, h = this.hud, yard = this.world.kind === 'yard';
    const set = (key, el, html) => { if (this.hudText[key] !== html) { this.hudText[key] = html; el.innerHTML = html; } };
    // подпись — та же, что у подсказки мыши в обзоре (view3d.targetText); пустая — прицел на заголовке меню
    const lab = !this.aim ? '' : yard ? v.targetText(this.aim.h) : it ? it.label(this.aim, 'desk') : '', hot = !!(this.aim && lab);
    const key = !this.aim ? '' : this.aim.type === 'item' || this.aim.type === 'mount' || this.aim.type === 'stand' ? 'E' : 'E или щелчок';
    // у места подпись уже начинается с клавиши: «E — поставить ограждение у яч.2»
    set('aim', h.aim, hot ? (lab.startsWith('E — ') ? esc(lab) : `${esc(lab)}<small>${key}</small>`) : yard && this.floor ? 'Перейти сюда<small>щелчок или E</small>' : '');
    h.cross.classList.toggle('hot', hot);
    // без захвата курсор над сценой — обычная стрелка (перекрестие на сцене не видно); без захвата вообще — рука над предметом
    const cur = this.noLock && hot ? 'pointer' : 'default';
    if (this.cur !== cur) { this.cur = cur; v.renderer.domElement.style.cursor = cur; }
    // площадка: кольцо под аппаратом, как при наведении мышью; СИЗ, руки и мероприятия — только в полигоне
    if (yard) { v.setHover(this.aim && this.aim.type === 'dev' ? this.aim.id : null); return; }
    if (it) {
      it.hover(this.aim && this.aim.type === 'item' ? this.aim.id : null);
      // призрак предмета — у места под прицелом
      it.preview(it.heldIn('desk'), this.aim && this.aim.type === 'mount' ? this.aim.id : null);
    }
    const st = pm.status();
    set('ppe', h.ppe, `СИЗ: перчатки ${st.ppe.gloves ? 'надеты' : 'не надеты'}, каска ${st.ppe.helmet ? 'надета' : 'не надета'}`);
    const held = it && it.heldIn('desk');
    set('held', h.held, held ? `В руке: <b>${esc(it.list.get(held).it.title)}</b> · E — применить · Q — положить` : 'Руки свободны');
    const nx = st.guide && st.next ? `Следующее мероприятие: ${esc(st.next)}` : '';
    set('next', h.next, nx);
    h.next.hidden = !nx;
  }

  // ---------- действия ----------
  action() {
    const v = this.v, tgt = this.aim;
    if (this.world.kind === 'yard') { this.actYard(tgt); return; }
    if (!v.items) return;
    const r = v.items.act('desk', tgt);
    if (r !== 'pass') return;
    // без захвата мыши (тачпад, планшет): щелчок по полу — перейти туда, как курок по полу в шлеме
    if (!tgt) {
      const f = this.floor;
      if (this.noLock && f && f.distance < 9 && this.world.walkable(f.point.x, f.point.z)) { this.x = f.point.x; this.z = f.point.z; this.apply(); }
      return;
    }
    if (tgt.type === 'dev') v.app.pickEl(tgt.id, false, { menu3d: acts => v.showMenu3D(tgt.id, acts, tgt.h.point) });
    else if (tgt.type === 'board') v.boardClick(tgt.h.uv);
    else if (tgt.type === 'menu') v.menuClick(tgt.h.uv);
  }
  // Площадка: аппарат — как щелчок мышью (с инструментом — проверка или ПЗ, у тележки — меню), провод — с инструментом,
  // земля — перейти туда (площадка большая, как курок по полу в шлеме)
  actYard(t) {
    const v = this.v, app = v.app;
    if (!t) {
      const f = this.floor;
      if (f) { this.x = f.point.x; this.z = f.point.z; this.vx = 0; this.vz = 0; this.apply(); }
      return;
    }
    if (t.type === 'menu') v.menuClick(t.h.uv);
    else if (t.type === 'board') v.boardClick(t.h.uv);
    else if (t.type === 'wire') { v.closeMenu3D(); app.pickWire3D(t.id, false); }
    else { v.closeMenu3D(); app.pick3D(t.id, false, { menu3d: acts => v.showMenu3D(t.id, acts, t.h.point) }); }
  }
  drop() {
    const it = this.v.items;
    if (!it || !it.heldIn('desk')) return;
    it.release('desk', this.aim && this.aim.type === 'stand' ? this.aim : null);
  }
}

export { Walk, EYE };
