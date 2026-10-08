/* ===== Переход и телепорт: метка на полу, затемнение, кольцо прибытия =====
   Общий для шлема и ноутбука (view3d — курок по полу, walk.js — щелчок или E по земле, касание на телефоне).
   • Метка — плоскость на полу под лучом или прицелом: можно стоять — светлое кольцо с мягким свечением и лёгкой пульсацией;
     нельзя — красное перечёркнутое кольцо (подпись «Туда не пройти» — у прицела или баннером в шлеме). Видна, только пока луч на полу.
   • Переход: в шлеме — короткое затемнение (плавный полёт укачивает): 0,12 с в темноту → перенос → 0,18 с из темноты;
     на ноутбуке — плавно за 0,3–0,45 с (ease-out), если путь по прямой свободен, иначе тем же затемнением.
   • На месте прибытия — расходящееся кольцо ≈ 0,5 с и тихий звук шага.
   Сетки: метка, кольцо прибытия и затемнение — по одному вызову и только пока видны. Затемнение не залипает:
   cancel() — при выходе из VR и смене сцены, и само гаснет, если кадр с переносом сломался или кадров долго не было. Цвета — PAL.ui (kit.js). */
import { PAL, css } from './models/kit.js';
import { Sound } from '../ui/sound.js';

const FADE = { out: 0.12, in: 0.18, max: 1.2 };     // затемнение: в темноту, из темноты, с; дольше max — гасим принудительно
const GLIDE = { min: 0.3, max: 0.45 };              // плавный переход на ноутбуке, с
const MARK = 0.55, ARRIVE = 0.5;                    // диаметр метки, м; кольцо прибытия, с

// Рисунок метки: можно (светлое кольцо со свечением) или нельзя (красное кольцо с перечёркиванием)
function markTexture(T, ok) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), col = ok ? PAL.ui.tpOk : PAL.ui.tpNo;
  const g = x.createRadialGradient(128, 128, 30, 128, 128, 126);
  g.addColorStop(0, css(col, 1, 0)); g.addColorStop(0.62, css(col, 1, ok ? 0.28 : 0.18)); g.addColorStop(0.8, css(col, 1, 0.05)); g.addColorStop(1, css(col, 1, 0));
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = css(col, 1, 0.95); x.lineWidth = 14;
  x.beginPath(); x.arc(128, 128, 88, 0, Math.PI * 2); x.stroke();
  if (ok) { x.fillStyle = css(col, 1, 0.9); x.beginPath(); x.arc(128, 128, 10, 0, Math.PI * 2); x.fill(); }
  else { x.lineWidth = 16; x.beginPath(); x.moveTo(66, 66); x.lineTo(190, 190); x.stroke(); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  return t;
}

class Teleport {
  constructor(v) {
    this.v = v;
    const T = this.T = v.kit.T;
    this.tex = { ok: markTexture(T, true), no: markTexture(T, false) };
    const flat = (geo, mat) => { const m = new T.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 8; m.raycast = () => {}; m.frustumCulled = false; return m; };
    this.mark = flat(new T.PlaneGeometry(MARK, MARK), new T.MeshBasicMaterial({ map: this.tex.ok, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 }));
    this.ring = flat(new T.RingGeometry(0.42, 0.5, 48), new T.MeshBasicMaterial({ color: PAL.ui.tpOk, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    v.scene.add(this.mark, this.ring);
    // затемнение — квадрат перед глазами (и в шлеме, и на ноутбуке), поверх всего
    this.fade = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: PAL.ui.fade, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    this.fade.position.z = -0.1; this.fade.renderOrder = 999; this.fade.visible = false; this.fade.raycast = () => {};
    v.camera.add(this.fade);
    this.job = null; this.arrive = null; this.ok = null; this.t = 0;
  }
  get busy() { return !!this.job; }

  // Метка под лучом или прицелом: p — точка на полу (или null — спрятать), ok — можно ли туда встать
  aim(p, ok) {
    const m = this.mark;
    if (!p) { m.visible = false; this.ok = null; return; }
    if (this.ok !== ok) { m.material.map = ok ? this.tex.ok : this.tex.no; m.material.needsUpdate = true; this.ok = ok; }
    m.position.set(p.x, (p.y || 0) + 0.035, p.z);
    m.visible = true;
  }
  // Перейти: from, to — точки на полу { x, z }; apply(x, z, k) двигает человека (камеру или rig), k — доля перехода 0…1
  // (по ней же поворачивают взгляд); mode — 'fade' или 'glide'
  go(from, to, apply, mode = 'fade') {
    this.finish();
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = mode === 'glide' ? Math.min(GLIDE.max, Math.max(GLIDE.min, GLIDE.min + d / 60)) : FADE.out + FADE.in;
    this.job = { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, apply, mode, t: 0, dur, moved: false };
    this.mark.visible = false;
    if (mode === 'fade') { this.fade.visible = true; this.fade.material.opacity = 0; }
  }
  // Сразу на место: выход из VR, смена сцены, ошибка кадра — затемнение не остаётся
  finish() {
    const j = this.job;
    this.job = null;
    if (j && !j.moved) { try { j.apply(j.to.x, j.to.z, 1); } catch (e) { /* перенос не обязателен */ } }
    this.fade.visible = false; this.fade.material.opacity = 0;
  }
  cancel() { this.finish(); this.mark.visible = false; this.ring.visible = false; this.arrive = null; this.ok = null; }
  // Кольцо прибытия и тихий шаг
  landed(p) {
    this.arrive = { t: 0, x: p.x, z: p.z, y: p.y || 0 };
    this.ring.position.set(p.x, (p.y || 0) + 0.04, p.z);
    this.ring.visible = true;
    Sound.play('step');
  }
  // Каждый кадр (view3d.step): ход перехода, затемнение, пульсация метки, кольцо прибытия
  step(dt) {
    this.t += dt;
    if (this.mark.visible) this.mark.scale.setScalar(1 + 0.06 * Math.sin(this.t * 6));
    const j = this.job;
    if (j) {
      j.t += dt;
      try {
        if (j.mode === 'glide') {
          const k = Math.min(1, j.t / j.dur), e = 1 - Math.pow(1 - k, 3);
          j.apply(j.from.x + (j.to.x - j.from.x) * e, j.from.z + (j.to.z - j.from.z) * e, e);
          if (k >= 1) { j.moved = true; this.job = null; this.landed(j.to); }
        } else {
          const f = this.fade.material;
          if (!j.moved && j.t >= FADE.out) { j.apply(j.to.x, j.to.z, 1); j.moved = true; this.landed(j.to); }
          f.opacity = j.t < FADE.out ? j.t / FADE.out : Math.max(0, 1 - (j.t - FADE.out) / FADE.in);
          if (j.t >= FADE.out + FADE.in || j.t > FADE.max) this.finish();
        }
      } catch (e) { this.finish(); throw e; }
    }
    const a = this.arrive;
    if (a) {
      a.t += dt;
      const k = a.t / ARRIVE;
      this.ring.scale.setScalar(0.5 + 1.3 * k);
      this.ring.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { this.ring.visible = false; this.arrive = null; }
    }
  }
  dispose() {
    this.cancel();
    this.v.scene.remove(this.mark, this.ring);
    this.v.camera.remove(this.fade);
  }
}

// Свободен ли путь по прямой: точки через 0,25 м, где можно стоять (world.walkable)
function pathFree(world, from, to, r = 0.25) {
  const d = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(1, Math.ceil(d / 0.25));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    if (!world.walkable(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k, r)) return false;
  }
  return true;
}

export { Teleport, pathFree };
