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
import { pathFree } from './teleport.js';

const EYE = 1.62, SPEED = 3.1, SENS = 0.0022, R = 0.25;
// Площадка: до аппарата и провода (они высокие), до щита и меню, до земли для перехода, м
const REACH = { dev: 6, board: 9, floor: 25 };
// После выхода из захвата Chrome ~1 с отказывает в новом: отказ в эту паузу не считается, мс
const LOCK_PAUSE = 1600;
// Карточка «как управлять» на ноутбуке (кнопка «Понятно» — data-intro)
const INTRO = {
  room: `<h3 id="v3IntroT">VR-полигон: как брать предметы</h3>
    <ol><li><b>Подойдите к стенду справа от входа</b> — WASD и мышь (в шлеме — стик или курок по полу).</li>
    <li><b>E — взять предмет.</b> Перчатки и каска надеваются сразу. С предметом в руке E — применить: повесить плакат, запереть замок, коснуться указателем контактов. Q — положить. В шлеме — боковая кнопка: взять (СИЗ — сразу надеть) и отпустить у места.</li>
    <li><b>Аппараты переключают</b> щелчком или E: тележка ячейки — меню положений, рукоятка на правой стойке — ЗН. Щит с заданием — на правой стене.</li></ol>
    <button class="btn primary" type="button" data-intro="ok">Понятно</button>`,
  yard: `<h3 id="v3IntroT">Площадка: как управлять</h3>
    <ol><li><b>«Обзор»</b> — мышь вращает площадку, правая кнопка — сдвиг, колесо — ближе. Щелчок по аппарату — операция, Shift + щелчок — указатель напряжения.</li>
    <li><b>«Пешком»</b> — WASD и мышь, Shift — бегом. E или щелчок — операция, V — указатель, P — ПЗ, щелчок по земле — перейти, G — к аппарату следующего шага.</li>
    <li><b>В шлеме</b> — курок по аппарату — операция, боковая кнопка — указатель, курок по земле — переход, B или Y — к следующему шагу.</li></ol>
    <button class="btn primary" type="button" data-intro="ok">Понятно</button>`,
};

class Walk {
  constructor(v) {
    this.v = v; this.on = false; this.keys = new Set();
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.vx = 0; this.vz = 0;
    // noLock — смотреть перетаскиванием (нет API или отказы вне паузы); lockReq — запрос захвата ждёт ответа
    this.locked = false; this.noLock = !('requestPointerLock' in HTMLElement.prototype); this.lockFails = 0;
    this.lockReq = null; this.unlockedAt = -Infinity; this.lockWait = false;
    this.drag = null; this.cursor = null; this.aim = null; this.hudText = {};
    // touch — касание (телефон, планшет): мышь не захватывают, смотрят перетаскиванием, действие — касанием по месту
    this.touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
    this.makeHud();
    this.bind();
  }
  makeHud() {
    const host = this.v.host, el = document.createElement('div');
    el.className = 'v3-fps'; el.hidden = true;
    el.innerHTML = `<div class="v3-cross" aria-hidden="true"></div><div class="v3-aim" aria-live="polite"></div>
      <div class="v3-said" role="status" hidden></div>
      <div class="v3-tool" hidden></div>
      <div class="v3-next" hidden></div>
      <div class="v3-hand"><span class="ppe"></span><span class="held"></span><button class="v3-drop" type="button" hidden>Положить</button></div>
      <div class="v3-keys" aria-label="Управление"><b>Управление</b>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить</span>
        <span>мышь — смотреть · <kbd>Esc</kbd> отпустить мышь</span>
        <span><kbd>E</kbd> или щелчок — <i data-w="room">взять, надеть, повесить, </i>переключить</span>
        <span data-w="room"><kbd>Q</kbd> или правая кнопка — положить</span>
        <span data-w="yard"><kbd>V</kbd> указатель · <kbd>P</kbd> ПЗ · щелчок по земле — перейти</span>
        <span><kbd>Shift</kbd> бегом<i data-w="yard"> · <kbd>G</kbd> к аппарату</i></span></div>
      <button class="v3-click" type="button"><b>Мышь свободна — щёлкните по сцене</b><small></small></button>`;
    host.appendChild(el);
    // карточка «как управлять» — поверх 3D и в «Обзоре», и пешком (не внутри HUD ходьбы: он в «Обзоре» спрятан);
    // закрывается «Понятно», Esc, Enter, E или пробелом
    const intro = document.createElement('div');
    intro.className = 'v3-intro'; intro.hidden = true;
    intro.setAttribute('role', 'dialog'); intro.setAttribute('aria-labelledby', 'v3IntroT');
    host.appendChild(intro);
    this.hud = {
      root: el, aim: el.querySelector('.v3-aim'), next: el.querySelector('.v3-next'), ppe: el.querySelector('.ppe'),
      held: el.querySelector('.held'), click: el.querySelector('.v3-click'), clickWhy: el.querySelector('.v3-click small'),
      intro, cross: el.querySelector('.v3-cross'), said: el.querySelector('.v3-said'), drop: el.querySelector('.v3-drop'), tool: el.querySelector('.v3-tool'),
    };
    this.hud.click.addEventListener('click', () => this.lock());
    // телефон: клавиши Q нет — «Положить» рядом с тем, что в руке
    this.hud.drop.addEventListener('click', () => this.drop());
    // «Перейти · G» в строке следующего шага
    this.hud.next.addEventListener('click', e => { if (e.target.closest('button')) this.v.goNext(); });
    intro.addEventListener('click', e => { if (e.target.closest('[data-intro]')) this.intro(false); });
  }
  bind() {
    const cv = () => this.v.renderer && this.v.renderer.domElement;
    const typing = e => { const t = (e.target && e.target.tagName || '').toLowerCase(); return t === 'input' || t === 'textarea' || t === 'select'; };
    const live = () => this.on && this.v.active && !(this.v.renderer && this.v.renderer.xr.isPresenting) && document.getElementById('modal').hidden;
    // открытая карточка «как управлять» закрывается клавишей, и клавиша дальше не идёт (E не переключит аппарат за карточкой)
    document.addEventListener('keydown', e => {
      if (this.hud.intro.hidden || !this.v.active || typing(e) || !['Escape', 'Enter', 'KeyE', 'Space'].includes(e.code)) return;
      e.preventDefault(); e.stopPropagation();
      this.intro(false);
    }, true);
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
      else if (c === 'KeyG' && this.world && this.world.kind === 'yard') { e.preventDefault(); this.v.goG(this.aim); }
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
    if (this.v.tp) this.v.tp.aim(null);
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
  // Карточка «как управлять» на ноутбуке: полигон — как брать предметы, площадка — «Обзор», «Пешком», шлем.
  // Открывается сама при первом входе в полигон и кнопкой «Обучение» на щите; quiet — спрятать, не отмечая «прочитано».
  // Мышь на время карточки отпускается — иначе «Понятно» не нажать (курсор спрятан захватом)
  intro(on, quiet) {
    const el = this.hud.intro, room = this.v.room ? 'room' : 'yard';
    if (on) {
      if (el.dataset.kind !== room) { el.dataset.kind = room; el.innerHTML = INTRO[room]; }
      this.unlock(); this.keys.clear();
      if (this.locked) this.lockChanged(false);
    }
    el.hidden = !on;
    if (!on && !quiet && room === 'room') store.set('ts.polyIntro', '1');
    this.showClick();
    if (on) { const b = el.querySelector('[data-intro]'); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* без фокуса */ } }
  }
  // Надпись «Мышь свободна» — пока мышь не захвачена и захват возможен; после отказа в паузе — «щёлкните ещё раз»
  showClick() {
    const h = this.hud;
    h.click.hidden = !this.on || this.locked || this.noLock || this.touch || !h.intro.hidden;
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
      if (e.pointerType === 'touch' && !this.touch) { this.touch = true; this.showClick(); }
      if (this.locked) { if (e.button === 0) this.action(); else if (e.button === 2) this.drop(); return; }
      // касание — не захват: щелчок по месту там, где коснулись
      if (e.pointerType === 'touch') this.cursor = { x: e.clientX, y: e.clientY };
      if (!this.noLock && e.pointerType !== 'touch') { this.lock(); return; }
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
      if (d && !d.moved && t === 'pointerup') {
        // действие — по тому, что под пальцем или курсором сейчас (касание не двигало курсор до нажатия)
        this.cursor = { x: e.clientX, y: e.clientY }; this.updateAim();
        if (d.btn === 0) this.action(); else if (d.btn === 2) this.drop();
      }
    }
    if (t === 'pointerleave') this.cursor = null;
  }

  // ---------- каждый кадр ----------
  step(dt) {
    if (!this.on) return;
    // идёт переход (teleport.js): место меняет он, клавиши ждут
    if (this.v.tp && this.v.tp.busy) { this.vx = 0; this.vz = 0; this.updateAim(); return; }
    const k = this.keys, has = (...a) => a.some(c => k.has(c));
    const f = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    // Shift — бегом, вдвое быстрее
    const sp = SPEED * (has('ShiftLeft', 'ShiftRight') ? 2 : 1), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
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
    if (!this.locked && (this.noLock || this.touch) && this.cursor) { nx = ((this.cursor.x - r.left) / r.width) * 2 - 1; ny = -((this.cursor.y - r.top) / r.height) * 2 + 1; }
    this._ndc = this._ndc || new T.Vector2();
    this._ndc.set(nx, ny);
    v.camera.updateMatrixWorld();
    v.ray.setFromCamera(this._ndc, v.camera);
    const yard = this.world.kind === 'yard';
    v.ray.far = yard ? REACH.floor + 1 : 12;
    const hits = v.ray.intersectObjects(v.pickables, false);
    if (yard) {
      this.aim = this.pickYard(hits);
      // на землю — только если перед ней ничего нет (провода над головой не в счёт); можно ли там стоять — метка покажет
      const first = hits.find(h => !h.object.userData.wire);
      this.floor = !this.aim && first && first.object.userData.ground && first.distance <= REACH.floor ? first : null;
    } else {
      this.aim = v.items ? v.items.pick(hits, 'desk', 2.6) : null;
      // полигон: переход по полу — без захвата мыши (тачпад, телефон); с захватом ходят клавишами.
      // Места для предметов на полу (коробки ограждения перед ячейками) пол не закрывают
      const first = hits.find(h => !h.object.userData.mount);
      this.floor = !this.aim && (this.noLock || this.touch) && first && first.object.userData.ground && first.distance < 9 ? first : null;
    }
    this.floorOk = !!this.floor && this.world.walkable(this.floor.point.x, this.floor.point.z);
    if (v.tp) v.tp.aim(this.floor && !v.tp.busy ? this.floor.point : null, this.floorOk);
    this.drawHud();
  }
  // Площадка: аппарат, провод (с указателем или ПЗ), щит или меню под прицелом — как щелчок мышью в обзоре (view3d.firstHit)
  // Аппарат дальше REACH.dev — 'far': не переключается, но подписан («подойдите ближе») и щелчком к нему подходят
  pickYard(hits) {
    const h = this.v.firstHit(hits);
    if (!h) return null;
    const u = h.object.userData, type = u.menu ? 'menu' : u.board ? 'board' : u.dev ? 'dev' : u.wire ? 'wire' : null;
    if (type === 'dev' && h.distance > REACH.dev) return { h, type: 'far', id: u.dev };
    if (!type || h.distance > (type === 'menu' || type === 'board' ? REACH.board : REACH.dev)) return null;
    return { h, type, id: u.dev || u.wire || null };
  }
  drawHud() {
    const v = this.v, it = v.items, pm = v.app.permit, h = this.hud, yard = this.world.kind === 'yard';
    const set = (key, el, html) => { if (this.hudText[key] !== html) { this.hudText[key] = html; el.innerHTML = html; } };
    // подпись — та же, что у подсказки мыши в обзоре (view3d.targetText); пустая — прицел на заголовке меню
    const far = this.aim && this.aim.type === 'far', exam = !!(v.app.exam && v.app.exam.active());
    const lab = !this.aim ? '' : far ? `${v.app.tr.nm(this.aim.id)} — подойдите ближе` : yard ? v.targetText(this.aim.h) : it ? it.label(this.aim, 'desk') : '', hot = !!(this.aim && lab);
    // на телефоне и планшете клавиш нет — «касание»
    const tap = this.touch, key = !this.aim ? '' : far ? (tap ? 'касание — перейти' : exam ? 'щелчок — перейти' : 'G или щелчок — перейти')
      : tap ? 'касание' : this.aim.type === 'item' || this.aim.type === 'mount' || this.aim.type === 'stand' ? 'E' : 'E или щелчок';
    // у места подпись уже начинается с клавиши: «E — поставить ограждение у яч.2»
    const go = !this.floor ? '' : this.floorOk ? `Перейти сюда<small>${this.touch ? 'касание' : 'щелчок или E'}</small>` : 'Туда не пройти';
    set('aim', h.aim, hot ? (lab.startsWith('E — ') ? esc(tap ? lab.replace(/^E — /, 'Касание — ') : lab) : `${esc(lab)}<small>${key}</small>`) : go);
    h.cross.classList.toggle('hot', hot);
    // без захвата курсор над сценой — обычная стрелка (перекрестие на сцене не видно); без захвата вообще — рука над предметом
    const cur = this.noLock && hot ? 'pointer' : 'default';
    if (this.cur !== cur) { this.cur = cur; v.renderer.domElement.style.cursor = cur; }
    // площадка: кольцо под аппаратом, как при наведении мышью; СИЗ, руки и мероприятия — только в полигоне
    if (yard) {
      v.setHover(this.aim && (this.aim.type === 'dev' || far) ? this.aim.id : null);
      // включённый инструмент виден всё время, пока он включён: указатель (V) или ПЗ (P)
      const tool = v.app.tool, tt = tool === 'check' ? `Указатель напряжения включён · ${this.touch ? 'кнопка в панели' : 'V'} — выключить`
        : tool === 'pz' ? `Переносное заземление: наложить или снять · ${this.touch ? 'кнопка в панели' : 'P'} — выключить` : '';
      set('tool', h.tool, tt);
      h.tool.hidden = !tt;
      // с подсказками шагов — следующий шаг и «Перейти · G»
      const g = v.app.guideNext();
      const nx = g ? `Следующий шаг: ${esc(g.text)}${g.step.op === 'check' ? '<small>V — указатель, затем E</small>' : String(g.step.id).startsWith('pz:') ? '<small>P — ПЗ, затем E</small>' : ''}<button type="button">${this.touch ? 'Перейти' : 'Перейти · G'}</button>` : '';
      set('next', h.next, nx);
      h.next.hidden = !nx;
      return;
    }
    if (it) {
      it.hover(this.aim && this.aim.type === 'item' ? this.aim.id : null);
      // призрак предмета — у места под прицелом
      it.preview(it.heldIn('desk'), this.aim && this.aim.type === 'mount' ? this.aim.id : null);
    }
    const st = pm.status();
    set('ppe', h.ppe, `СИЗ: перчатки ${st.ppe.gloves ? 'надеты' : 'не надеты'}, каска ${st.ppe.helmet ? 'надета' : 'не надета'}`);
    const held = it && it.heldIn('desk');
    set('held', h.held, held ? `В руке: <b>${esc(it.list.get(held).it.title)}</b> · ${this.touch ? 'касание места — применить' : 'E — применить · Q — положить'}` : 'Руки свободны');
    h.drop.hidden = !(this.touch && held);
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
    // без захвата мыши (тачпад, планшет, телефон): щелчок по полу — перейти туда, как курок по полу в шлеме
    if (!tgt) { this.goFloor(); return; }
    if (tgt.type === 'dev') v.app.pickEl(tgt.id, false, { menu3d: acts => v.showMenu3D(tgt.id, acts, tgt.h.point) });
    else if (tgt.type === 'board') v.boardClick(tgt.h.uv);
    else if (tgt.type === 'menu') v.menuClick(tgt.h.uv);
  }
  // Площадка: аппарат — как щелчок мышью (с инструментом — проверка или ПЗ, у тележки — меню), провод — с инструментом,
  // земля — перейти туда (площадка большая, как курок по полу в шлеме)
  actYard(t) {
    const v = this.v, app = v.app;
    if (!t) { this.goFloor(); return; }
    if (t.type === 'menu') v.menuClick(t.h.uv);
    else if (t.type === 'board') v.boardClick(t.h.uv);
    else if (t.type === 'far') v.goTo(t.id);
    else if (t.type === 'wire') { v.closeMenu3D(); app.pickWire3D(t.id, false); }
    else { v.closeMenu3D(); app.pick3D(t.id, false, { menu3d: acts => v.showMenu3D(t.id, acts, t.h.point) }); }
  }
  // Перейти к метке на полу: путь по прямой свободен — плавно, иначе затемнением; туда нельзя — сказать у прицела
  goFloor() {
    const f = this.floor, tp = this.v.tp;
    if (!f || tp.busy) return;
    if (!this.floorOk) { this.said('Туда не пройти'); return; }
    const from = { x: this.x, z: this.z }, to = { x: f.point.x, z: f.point.z, y: f.point.y };
    tp.go(from, to, (x, z) => { this.x = x; this.z = z; this.vx = 0; this.vz = 0; this.apply(); }, pathFree(this.world, from, to, R) ? 'glide' : 'fade');
  }
  // Перейти и встать так, чтобы под прицелом было нужное (q — из seek): путь свободен — плавно, иначе затемнением;
  // взгляд поворачивается по ходу перехода
  goPose(q) {
    const tp = this.v.tp;
    if (tp.busy) return;
    const from = { x: this.x, z: this.z }, to = { x: q.x, z: q.z };
    const y0 = this.yaw, dy = Math.atan2(Math.sin(q.yaw - y0), Math.cos(q.yaw - y0)), p0 = this.pitch;
    // k — доля перехода: взгляд доворачивается и тогда, когда стоять остаёмся на месте
    tp.go(from, to, (x, z, k = 1) => {
      this.x = x; this.z = z; this.vx = 0; this.vz = 0;
      this.yaw = y0 + dy * k; this.pitch = p0 + (q.pitch - p0) * k;
      this.apply();
    }, pathFree(this.world, from, to, R) ? 'glide' : 'fade');
  }
  drop() {
    const it = this.v.items;
    if (!it || !it.heldIn('desk')) return;
    it.release('desk', this.aim && this.aim.type === 'stand' ? this.aim : null);
  }
}

export { Walk, EYE, REACH };
