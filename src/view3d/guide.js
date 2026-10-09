/* ===== Подсказки шагов на площадке и щит у первого аппарата задания (методы View3D, подключаются в view3d.js) =====
   Маяк над аппаратом следующего шага (бесплатно, Trainer.peek), «Перейти к аппарату» (G, «Перейти», B/Y в шлеме, «→» в журнале),
   карточка указателя при первом взятии; задание началось — щит переезжает к первому аппарату, начало пешком — у щита.
   Вынесено из view3d.js без изменения поведения. */
import { THREE } from './three.js';
import { isPzId } from '../core/elements.js';
import { store } from '../ui/store.js';
import { PAL } from './models/index.js';
import { wireMid } from '../view2d/scheme2d.js';
import { footprints } from './world.js';

const Guide = {
  // ---------- щит у первого аппарата задания (площадка) ----------
  // Задание началось: щит — рядом с первым аппаратом задания, начало пешком — перед ним (аппарат под прицелом, щит сбоку);
  // уже пешком — переход туда, в шлеме — затемнением. Без задания щит у ворот и начало у ворот (как было)
  onTaskStart() {
    if (!this.ready || this.room || !this.boardG) return;
    const q = this.placeBoard();
    if (!q || !this.active) return;
    if (this.renderer.xr.isPresenting) {
      const T = THREE, head = this.camera.getWorldPosition(new T.Vector3());
      this.tp.go(head, q, (x, z) => {
        const c = this.camera.getWorldPosition(new T.Vector3()), d = this.camera.getWorldDirection(new T.Vector3()), hy = Math.atan2(-d.x, -d.z);
        const ang = Math.atan2(Math.sin(q.yaw - hy), Math.cos(q.yaw - hy));
        this.rig.position.sub(c).applyAxisAngle(this.tmp.up, ang).add(c); this.rig.rotation.y += ang; this.rig.updateMatrixWorld(true);
        const c2 = this.camera.getWorldPosition(new T.Vector3());
        this.rig.position.x += x - c2.x; this.rig.position.z += z - c2.z;
      }, 'fade');
    } else if (this.fpsOn()) this.walk.goPose(q);
    else this.walkPose = q;
  },
  // Щит — к первому аппарату задания: место, откуда аппарат под прицелом (walk.seek), щит — впереди слева или справа от него.
  // Возвращает место начала { x, z, yaw, pitch } или null (задания нет — щит у ворот)
  placeBoard() {
    const T = THREE, g = this.boardG, run = this.app.tr.run;
    if (!g) return null;
    const home = () => { g.position.copy(this.boardHome.pos); g.rotation.y = this.boardHome.ry; this.boardBlocks = footprints(T, g); this.taskStart = null; return null; };
    if (!run || run.done) return home();
    const st = run.task.steps.find(x => this.guideTarget(x.id)), t = st && this.guideTarget(st.id), a = t && this.aimTarget(t);
    if (!a) return home();
    // щит на время поиска — у ворот (не загораживает); камера и rig — как были (поиск двигает камеру ходьбы)
    g.position.copy(this.boardHome.pos); g.rotation.y = this.boardHome.ry; this.boardBlocks = footprints(T, g);
    // первый аппарат — в ЗРУ: начало в тамбуре перед щитом ЗРУ (как вход в полигон), щит площадки — у ворот
    const zd = t.dev && this.dev.get(t.dev), zn = t.wire && this.zru ? this.app.tr.topo.wireNode.get(t.wire) : null;
    if (this.zru && this.zru.board && ((zd && zd.zru) || (zn != null && this.zru.nodes.has(zn)))) {
      const bp = this.zru.board.getWorldPosition(new T.Vector3()), n = new T.Vector3(0, 0, 1).applyQuaternion(this.zru.board.getWorldQuaternion(new T.Quaternion()));
      const x = bp.x + n.x * 2.3, z = bp.z + n.z * 2.3;
      if (this.world.walkable(x, z)) { this.taskStart = { x, z, yaw: Math.atan2(n.x, n.z), pitch: 0.03 }; return this.taskStart; }
    }
    const cam = this.camera, rig = this.rig, w = this.walk, keep = [cam.position.clone(), cam.quaternion.clone(), rig.position.clone(), rig.rotation.y, w.x, w.z, w.yaw, w.pitch];
    const xr = this.renderer.xr.isPresenting;
    if (xr) { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true); }
    let q = null;
    this.wireAim = !!t.wire;
    // поиск начинается «с ворот»: место ходьбы в «Обзоре» не определено (0, 0 может оказаться в стене или ячейке ЗРУ)
    w.x = this.world.start.x; w.z = this.world.start.z;
    try { q = w.seek(a.p, a.want, false, [5.5, 5, 4.5, 4, 3.5]); } finally {
      this.wireAim = false;
      [w.x, w.z, w.yaw, w.pitch] = keep.slice(4);
      cam.position.copy(keep[0]); cam.quaternion.copy(keep[1]); rig.position.copy(keep[2]); rig.rotation.set(0, keep[3], 0); rig.updateMatrixWorld(true);
      if (this.fpsOn()) w.apply(); else if (!xr) this.applyOrbit();
    }
    if (!q) return home();
    // щит: на 3 м вперёд и на 2,4 м вбок от места, откуда виден аппарат, лицом к нему; начало — лицом к щиту
    // (задание на щите перед глазами, аппарат — рядом; к нему — G, это первый шаг обучения)
    const f = [-Math.sin(q.yaw), -Math.cos(q.yaw)], r = [Math.cos(q.yaw), -Math.sin(q.yaw)];
    this.taskStart = q;
    const spots = [];
    for (const fw of [3, 2.4, 3.6, 1.8]) for (const lat of [2.4, 3, 1.8]) for (const side of [-1, 1]) spots.push([fw, lat * side]);
    // в здание ЗРУ щит площадки не ставится: там свой щит в тамбуре (zru.js), в коридоре большой щит перегородил бы проход
    const zb = this.zru ? new T.Box3().setFromObject(this.zru.group).expandByScalar(1) : null;
    const inZru = (x, z) => !!zb && x > zb.min.x && x < zb.max.x && z > zb.min.z && z < zb.max.z;
    for (const [fw, lt] of inZru(q.x, q.z) ? [] : spots) {
      const bx = q.x + f[0] * fw + r[0] * lt, bz = q.z + f[1] * fw + r[1] * lt;
      const ry = Math.atan2(q.x - bx, q.z - bz), ex = Math.cos(ry) * 1.6, ez = -Math.sin(ry) * 1.6;
      if (![[bx, bz], [bx + ex, bz + ez], [bx - ex, bz - ez]].every(([x, z]) => this.world.walkable(x, z, 0.35) && !inZru(x, z))) continue;
      g.position.set(bx, 0, bz); g.rotation.y = ry;
      this.boardBlocks = footprints(T, g);
      this.taskStart = { x: q.x, z: q.z, yaw: Math.atan2(-(bx - q.x), -(bz - q.z)), pitch: Math.atan2(2.25 - 1.62, Math.hypot(bx - q.x, bz - q.z)) };
      break;
    }
    return this.taskStart;
  },
  // ---------- подсказки шагов на площадке: маяк, «Перейти к аппарату» ----------
  // Маяк — столб света над аппаратом следующего шага: виден издалека, один вызов, только с подсказками
  makeBeacon() {
    const T = THREE, c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(0.08, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 4, 128);
    const tex = new T.CanvasTexture(c);
    const m = new T.Mesh(new T.CylinderGeometry(0.22, 0.32, 16, 16, 1, true), new T.MeshBasicMaterial({ color: PAL.ui.guide, map: tex, transparent: true, opacity: 0.85,
      blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.visible = false; m.renderOrder = 3; m.raycast = () => {}; m.frustumCulled = false;
    this.scene.add(m);
    this.beacon = m;
  },
  // Куда идти, чтобы выполнить шаг: аппарат (или модель ПЗ), иначе провод, на который накладывают ПЗ или ставят указатель
  guideTarget(id) {
    if (!id || this.room) return null;
    if (this.dev.has(id)) return { dev: id };
    const s = this.app.scheme, at = isPzId(id) ? id.slice(3) : id;
    if (this.dev.has(at)) return { dev: at };
    return s.wires.some(w => w.id === at) ? { wire: at } : null;
  },
  guidePoint(t) {
    if (!t) return null;
    if (t.dev) return this.dev.get(t.dev).group.getWorldPosition(new THREE.Vector3());
    if (this.zru) { const n = this.app.tr.topo.wireNode.get(t.wire), q = this.zru.nodes.has(n) ? this.zru.inner(n) : null; if (q) return q; }
    const w = this.app.scheme.wires.find(q => q.id === t.wire);
    return w ? this.toWorld(wireMid(w)) : null;
  },
  // После каждого изменения: маяк — над аппаратом следующего шага
  syncGuide() {
    const g = this.room ? null : this.app.guideNext(), p = g ? this.guidePoint(this.guideTarget(g.step.id)) : null;
    this.beacon.visible = !!p;
    if (p) this.beacon.position.set(p.x, 8, p.z);
  },
  say(text, level = 'info') { this.app.toast(text, level); this.banner(text, level); },
  // Карточка «Указатель: как понять результат» — при первом взятии указателя (в обучении; в экзамене и показе — нет)
  uvnCard() {
    const app = this.app;
    if ((app.exam && app.exam.active()) || app.demoOn || store.get('ts.uvnCard') === '1') return;
    if (this.renderer.xr.isPresenting) this.showTutor(true, 'uvn'); else this.walk.intro(true, false, 'uvn');
  },
  // G, «Перейти · G», «К следующему» (щит, B/Y в шлеме): к аппарату следующего шага
  goNext() {
    const app = this.app, g = app.guideNext();
    if (!g) { this.say(app.exam && app.exam.active() ? 'В экзамене подсказок нет.' : !app.stepGuide ? 'Подсказки шагов выключены.' : 'Задание не идёт — начните задание.'); return false; }
    return this.goTo(g.step.id);
  },
  // G пешком: аппарат вдали под прицелом — к нему, иначе — к следующему шагу. В экзамене G нет
  goG(aim) {
    if (this.app.exam && this.app.exam.active()) { this.say('В экзамене подсказок нет: к аппарату — пешком или щелчком по земле.'); return; }
    if (aim && aim.type === 'far') this.goTo(aim.id); else this.goNext();
  },
  // Перейти к аппарату id: пешком — к месту перед ним (прицел на нём), в «Обзоре» — камера на него, в шлеме — затемнением
  goTo(id) {
    const t = this.guideTarget(id);
    if (!t || !this.ready) return false;
    const a = this.aimTarget(t);
    if (!a) return false;
    if (this.renderer.xr.isPresenting) return this.xrGoTo(t, a);
    if (!this.yardWalk) {
      const o = this.orbit;
      o.target.set(a.p.x, 1.5, a.p.z); o.r = Math.min(o.r, 20);
      if (this.top) { o.ph = 0.98; this.top = false; }
      this.applyOrbit(); this.setHover(t.dev || null);
      return true;
    }
    const q = this.seekFor(t, a);
    if (!q) { this.say(`Не нашлось места, откуда видно ${this.app.tr.nm(id)}.`, 'warn'); return false; }
    this.walk.goPose(q);
    return true;
  },
  seekFor(t, a) {
    this.wireAim = !!t.wire;
    try { return this.walk.seek(a.p, a.want, false, [3.2, 2.5, 4, 1.8, 5, 2.2, 5.6]); } finally { this.wireAim = false; }
  },
  // Шлем: место ищет тот же walk.seek (на время — rig в начале координат), переход — затемнением, взгляд — на аппарат
  xrGoTo(t, a) {
    const T = THREE, rig = this.rig, cam = this.camera, w = this.walk;
    const head = cam.getWorldPosition(new T.Vector3()), dir = cam.getWorldDirection(new T.Vector3());
    const rp = rig.position.clone(), ry = rig.rotation.y, cp = cam.position.clone(), cq = cam.quaternion.clone();
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true);
    w.x = head.x; w.z = head.z; w.yaw = Math.atan2(-dir.x, -dir.z); w.pitch = 0;
    let q = null;
    try { q = this.seekFor(t, a); } finally {
      rig.position.copy(rp); rig.rotation.set(0, ry, 0); cam.position.copy(cp); cam.quaternion.copy(cq); rig.updateMatrixWorld(true);
    }
    if (!q) { this.banner('Не нашлось места, откуда видно аппарат.', 'warn'); return false; }
    this.tp.go(head, q, (x, z) => {
      const c = cam.getWorldPosition(new T.Vector3()), d = cam.getWorldDirection(new T.Vector3()), hy = Math.atan2(-d.x, -d.z);
      const ang = Math.atan2(Math.sin(q.yaw - hy), Math.cos(q.yaw - hy));
      rig.position.sub(c).applyAxisAngle(this.tmp.up, ang).add(c); rig.rotation.y += ang;
      rig.updateMatrixWorld(true);
      const c2 = cam.getWorldPosition(new T.Vector3());
      rig.position.x += x - c2.x; rig.position.z += z - c2.z;
    }, 'fade');
    return true;
  }
};

export { Guide };
