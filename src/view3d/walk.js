/* ===== VR-полигон на ноутбуке: ходьба и руки, как в играх =====
   Щелчок по сцене — захват мыши (Esc — отпустить), мышь — смотреть, WASD или стрелки — ходить (≈3 м/с, как стиком в шлеме),
   E или щелчок — взять, применить, переключить; Q (или правая кнопка) — положить. Прицел в центре экрана,
   под ним — что под прицелом и что будет. Сквозь стены, ячейки и выкаченные тележки не пройти (room.resolve).
   Захват: Chrome около секунды после выхода по Esc отказывает в новом — такие отказы не считаются.
   Если отказы повторяются и вне этой паузы — смотреть перетаскиванием, действие — щелчком по месту.
   Состояние захвата меняют только lockChanged и lockFailed: их можно вызвать и без настоящего захвата (проверка в headless). */
import { store } from '../ui/store.js';
import { esc } from '../core/elements.js';

const EYE = 1.62, SPEED = 3.1, SENS = 0.0022, R = 0.25;
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
      <div class="v3-next" hidden></div>
      <div class="v3-hand"><span class="ppe"></span><span class="held"></span></div>
      <div class="v3-keys" aria-label="Управление"><b>Управление</b>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить</span>
        <span>мышь — смотреть · <kbd>Esc</kbd> отпустить мышь</span>
        <span><kbd>E</kbd> или щелчок — взять, надеть, повесить, переключить</span>
        <span><kbd>Q</kbd> или правая кнопка — положить</span></div>
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
      intro: el.querySelector('.v3-intro'), cross: el.querySelector('.v3-cross'),
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
  // Вход в полигон и выход
  enable(room) {
    this.room = room; this.on = true;
    this.hud.root.hidden = false;
    this.v.host.dataset.fps = '1';
    this.showClick();
    if (store.get('ts.polyIntro') !== '1') this.intro(true);
  }
  disable() {
    this.on = false; this.keys.clear();
    this.hud.root.hidden = true;
    delete this.v.host.dataset.fps;
    this.unlock();
    if (this.v.renderer) this.v.renderer.domElement.style.cursor = '';
    this.cur = null;
  }
  intro(on) {
    this.hud.intro.hidden = !on;
    if (!on) store.set('ts.polyIntro', '1');
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
    // стены, ячейки и выкаченные тележки не пускают; тележка, выкаченная туда, где стоишь, отодвигает
    [this.x, this.z] = this.room.resolve(this.x + this.vx * dt, this.z + this.vz * dt, R);
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
    v.ray.far = 12;
    const hits = v.ray.intersectObjects(v.pickables, false);
    this.aim = v.items ? v.items.pick(hits, 'desk', 2.6) : null;
    this.floor = hits.find(h => h.object.userData.ground) || null;
    this.drawHud();
  }
  drawHud() {
    const v = this.v, it = v.items, pm = v.app.permit, h = this.hud;
    const set = (key, el, html) => { if (this.hudText[key] !== html) { this.hudText[key] = html; el.innerHTML = html; } };
    // пустая подпись — прицел на заголовке меню: нажимать там нечего
    const lab = it ? it.label(this.aim, 'desk') : '', hot = !!(this.aim && lab);
    set('aim', h.aim, hot ? `${esc(lab)}<small>${this.aim.type === 'item' || this.aim.type === 'mount' || this.aim.type === 'stand' ? 'E' : 'E или щелчок'}</small>` : '');
    h.cross.classList.toggle('hot', hot);
    // без захвата курсор над сценой — обычная стрелка (перекрестие на сцене не видно); без захвата вообще — рука над предметом
    const cur = this.noLock && hot ? 'pointer' : 'default';
    if (this.cur !== cur) { this.cur = cur; v.renderer.domElement.style.cursor = cur; }
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
    if (!v.items) return;
    const r = v.items.act('desk', tgt);
    if (r !== 'pass') return;
    // без захвата мыши (тачпад, планшет): щелчок по полу — перейти туда, как курок по полу в шлеме
    if (!tgt) {
      const f = this.floor;
      if (this.noLock && f && f.distance < 9 && this.room.walkable(f.point.x, f.point.z)) { this.x = f.point.x; this.z = f.point.z; this.apply(); }
      return;
    }
    if (tgt.type === 'dev') v.app.pickEl(tgt.id, false, { menu3d: acts => v.showMenu3D(tgt.id, acts, tgt.h.point) });
    else if (tgt.type === 'board') v.boardClick(tgt.h.uv);
    else if (tgt.type === 'menu') v.menuClick(tgt.h.uv);
  }
  drop() {
    const it = this.v.items;
    if (!it || !it.heldIn('desk')) return;
    it.release('desk', this.aim && this.aim.type === 'stand' ? this.aim : null);
  }
}

export { Walk, EYE };
