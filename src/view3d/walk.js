/* ===== VR-полигон на ноутбуке: ходьба и руки, как в играх =====
   Щелчок по сцене — захват мыши (Esc — отпустить), мышь — смотреть, WASD или стрелки — ходить, Shift — быстрее,
   E или щелчок — взять, применить, переключить; Q (или правая кнопка) — положить. Прицел в центре экрана,
   под ним — что под прицелом и что будет. Сквозь стены, ячейки и выкаченные тележки не пройти (room.resolve).
   Если браузер не даёт захватить мышь — смотреть перетаскиванием, действие — щелчком по месту. */
import { store } from '../ui/store.js';
import { esc } from '../core/elements.js';

const EYE = 1.62, SPEED = 1.6, RUN = 3.1, SENS = 0.0022, R = 0.25;

class Walk {
  constructor(v) {
    this.v = v; this.on = false; this.keys = new Set();
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.vx = 0; this.vz = 0;
    this.locked = false; this.noLock = !('requestPointerLock' in HTMLElement.prototype); this.lockFails = 0;
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
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить · <kbd>Shift</kbd> быстрее</span>
        <span>мышь — смотреть · <kbd>Esc</kbd> отпустить мышь</span>
        <span><kbd>E</kbd> или щелчок — взять, надеть, повесить, переключить</span>
        <span><kbd>Q</kbd> или правая кнопка — положить</span></div>
      <button class="v3-click" type="button">Щёлкните по сцене, чтобы управлять</button>
      <div class="v3-intro" role="dialog" aria-labelledby="v3IntroT" hidden><h3 id="v3IntroT">VR-полигон: как брать предметы</h3>
        <ol><li><b>Подойдите к стенду справа от входа</b> — WASD и мышь (в шлеме — стик или курок по полу).</li>
        <li><b>E — взять предмет, ещё раз E — применить:</b> надеть перчатки и каску, повесить плакат, запереть замок, коснуться указателем контактов. Q — положить. В шлеме — боковая кнопка: взять и отпустить у места.</li>
        <li><b>Аппараты переключают</b> щелчком или E: тележка ячейки — меню положений, рукоятка на правой стойке — ЗН. Щит с заданием — на правой стене.</li></ol>
        <button class="btn primary" type="button" data-intro="ok">Понятно</button></div>`;
    host.appendChild(el);
    this.hud = {
      root: el, aim: el.querySelector('.v3-aim'), next: el.querySelector('.v3-next'), ppe: el.querySelector('.ppe'),
      held: el.querySelector('.held'), click: el.querySelector('.v3-click'), intro: el.querySelector('.v3-intro'), cross: el.querySelector('.v3-cross'),
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
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(c)) {
        this.keys.add(c);
        if (c.startsWith('Arrow')) e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (c === 'KeyE') { e.preventDefault(); this.action(); }
      else if (c === 'KeyQ') { e.preventDefault(); this.drop(); }
    });
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = !!cv() && document.pointerLockElement === cv();
      if (this.locked) this.lockFails = 0;
      this.hud.root.classList.toggle('locked', this.locked);
      this.showClick();
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFails++;
      // после Esc браузер ненадолго не даёт захват — со второй неудачи смотрим перетаскиванием
      if (this.lockFails >= 2) { this.noLock = true; this.showClick(); this.v.app.toast('Мышь не захватывается: смотрите, перетаскивая мышью, действие — щелчок по месту.'); }
    });
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
    if (this.locked) try { document.exitPointerLock(); } catch (e) { /* уже отпущена */ }
  }
  intro(on) {
    this.hud.intro.hidden = !on;
    if (!on) store.set('ts.polyIntro', '1');
    this.showClick();
  }
  showClick() { this.hud.click.hidden = !this.on || this.locked || this.noLock || !this.hud.intro.hidden; }
  lock() {
    const c = this.v.renderer.domElement;
    if (this.noLock || this.locked) return;
    try {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFails++; if (this.lockFails >= 2) { this.noLock = true; this.showClick(); } });
    } catch (e) { this.noLock = true; this.showClick(); }
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
    const sp = has('ShiftLeft', 'ShiftRight') ? RUN : SPEED, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
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
    const lab = it ? it.label(this.aim, 'desk') : '';
    set('aim', h.aim, this.aim ? `${esc(lab)}<small>${this.aim.type === 'item' || this.aim.type === 'mount' || this.aim.type === 'stand' ? 'E' : 'E или щелчок'}</small>` : '');
    h.cross.classList.toggle('hot', !!this.aim);
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
