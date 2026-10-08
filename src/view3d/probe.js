/* ===== Указатель напряжения на площадке: модель в руке и касание по месту =====
   Две модели: УВН-10 (до 20 кВ, ≈ 0,8 м) и изолирующая штанга с указателем на 35–110 кВ (≈ 3 м); какая — по классу
   напряжения места (в нормальной схеме: всё включено — nominal). Начало модели — у рукоятки, наконечник — по −z.
   В руке: пешком с включённым указателем (V) — у правого края кадра (модель — по аппарату под прицелом); в шлеме — в руке
   контроллера, пока включён инструмент. Проверка (touch): указатель уходит к выводу аппарата или к проводу, касается
   каждой проверяемой стороны по очереди — огонёк мигает красным и пищит, если напряжение есть, без него — серый;
   потом возвращается в руку. В «Обзоре» руки нет — указатель появляется у места. В шлеме у рукоятки — табличка итога на 2 с.
   Модели из цилиндров, фигуры слиты по материалам (≤ 5 вызовов и только пока указатель виден). Цвета — PAL.items. */
import { compute, makeSim } from '../core/engine.js';
import { TYPES, isSwitchable } from '../core/elements.js';

// Как держать: смещение и поворот от камеры (ноутбук) и контроллера (шлем); scale — на ноутбуке модель чуть меньше
const HOLD = {
  desk: { uvn: [[0.18, -0.22, -0.3], [0.12, 0.12, 0], 0.8], rod: [[0.24, -0.5, -0.12], [0.62, 0.08, 0], 0.8] },
  xr: { uvn: [[0, 0, 0.05], [0, 0, 0], 1], rod: [[0, 0, 0.3], [0, 0, 0], 1] },
};
const GO = 0.25, HOLD_T = 0.9, BACK = 0.25;   // анимация касания: туда, на месте, обратно, с
const ROD_KV = 35;                             // с 35 кВ — штанга

class Probe {
  constructor(v) {
    this.v = v; this.T = v.kit.T;
    const T = this.T, C = v.kit.PAL.items, S = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.05 }, o));
    this.M = { handle: S(C.handle), rod: S(C.rod, { roughness: 0.4 }), head: S(C.head, { roughness: 0.4 }), metal: S(C.metal, { metalness: 0.7, roughness: 0.3 }) };
    this.C = C;
    this.models = { uvn: this.make('uvn'), rod: this.make('rod') };
    this.held = null; this.anim = null; this.nom = null; this.nomTopo = null;
  }
  make(kind) {
    const T = this.T, k = this.v.kit, M = this.M, g = new T.Group(), body = new T.Group();
    g.add(body);
    if (kind === 'uvn') {
      body.add(k.cyl(0.02, 0.3, M.handle, 0, 0, -0.03, 'z'), k.cyl(0.036, 0.016, M.rod, 0, 0, -0.19, 'z'), k.cyl(0.016, 0.44, M.rod, 0, 0, -0.41, 'z'));
      body.add(k.cyl(0.03, 0.13, M.head, 0, 0, -0.69, 'z'), k.cyl(0.006, 0.07, M.metal, 0, 0, -0.79, 'z'));
    } else {
      // изолирующая штанга: рукоятка, ограничительное кольцо, звенья с муфтами, указатель и крюк-наконечник
      body.add(k.cyl(0.025, 0.6, M.handle, 0, 0, -0.15, 'z'), k.cyl(0.05, 0.02, M.rod, 0, 0, -0.46, 'z'), k.cyl(0.02, 2.2, M.rod, 0, 0, -1.57, 'z'));
      for (const z of [-1.2, -1.95]) body.add(k.cyl(0.027, 0.05, M.metal, 0, 0, z, 'z'));
      body.add(k.cyl(0.04, 0.22, M.head, 0, 0, -2.78, 'z'), k.cyl(0.008, 0.12, M.metal, 0, 0, -2.95, 'z'));
    }
    this.v.mergeInto(body);
    const lamp = new T.Mesh(this.v.geo.sphere, new T.MeshBasicMaterial({ color: this.C.lampOff, toneMapped: false }));
    lamp.scale.setScalar(kind === 'uvn' ? 0.021 : 0.03); lamp.position.set(0, kind === 'uvn' ? 0.032 : 0.045, kind === 'uvn' ? -0.68 : -2.75);
    g.add(lamp);
    g.traverse(o => { o.raycast = () => {}; o.userData.dyn = true; });
    g.visible = false;
    return { kind, g, lamp, tip: kind === 'uvn' ? 0.83 : 3.02 };
  }
  // Класс напряжения узла в нормальной схеме (все аппараты включены, тележки в рабочем): от него — какая модель
  nominal(n) {
    const app = this.v.app, tr = app.tr;
    if (this.nomTopo !== tr.topo) {
      const init = {}, pos = {};
      for (const el of app.scheme.els) { if (isSwitchable(el)) init[el.id] = true; if (TYPES[el.t].cart) pos[el.id] = 'work'; }
      try { this.nom = compute(app.scheme, tr.topo, makeSim(app.scheme, init, pos)).V; } catch (e) { this.nom = new Map(); }
      this.nomTopo = tr.topo;
    }
    const live = tr.state.V.get(n);
    return live != null ? live : this.nom.get(n);
  }
  kindFor(nodes) { return nodes.some(n => (this.nominal(n) || 0) >= ROD_KV) ? 'rod' : 'uvn'; }
  kindForTarget(id) { return id ? this.kindFor(this.v.app.tr.nodesOf(id)) : 'uvn'; }

  // В руке: anchor — камера (ноутбук) или рукоять контроллера (шлем); null — убрать. kind — 'uvn' | 'rod'
  hold(anchor, kind = 'uvn') {
    if (this.anim) return;
    const cur = this.held;
    if (!anchor) { if (cur) { cur.m.g.visible = false; cur.m.g.parent && cur.m.g.parent.remove(cur.m.g); this.held = null; } return; }
    if (cur && cur.anchor === anchor && cur.m.kind === kind) return;
    if (cur) { cur.m.g.visible = false; cur.m.g.parent && cur.m.g.parent.remove(cur.m.g); }
    const m = this.models[kind], h = HOLD[anchor.isCamera ? 'desk' : 'xr'][kind];
    anchor.add(m.g);
    m.g.position.set(...h[0]); m.g.rotation.set(...h[1]); m.g.scale.setScalar(h[2]);
    m.g.visible = true; m.lamp.material.color.setHex(this.C.lampOff);
    this.held = { anchor, m };
  }
  // Касание по месту: pts — [{ p: точка мира, live }], anchor — откуда (рука) или null («Обзор»), label — табличка у рукоятки (шлем)
  touch(pts, kind, anchor, label) {
    if (!pts.length) return;
    this.finish();
    const T = this.T, m = this.models[kind];
    if (this.held && this.held.m !== m) { this.held.m.g.visible = false; this.held.m.g.parent && this.held.m.g.parent.remove(this.held.m.g); this.held = null; }
    // модель — в мире на время касания; рука — откуда начать и куда вернуть
    const start = new T.Matrix4();
    if (anchor) {
      const h = HOLD[anchor.isCamera ? 'desk' : 'xr'][kind];
      anchor.updateWorldMatrix(true, false);
      start.compose(new T.Vector3(...h[0]), new T.Quaternion().setFromEuler(new T.Euler(...h[1])), new T.Vector3().setScalar(h[2])).premultiply(anchor.matrixWorld);
    }
    this.v.scene.add(m.g); m.g.visible = true;
    const poses = pts.map(q => ({ pose: this.touchPose(m, q.p), live: q.live }));
    if (!anchor) start.copy(poses[0].pose).multiply(new T.Matrix4().makeScale(0.001, 0.001, 0.001));
    this.anim = { m, anchor, start, poses, i: 0, phase: 'go', t: 0, from: start.clone(), label };
    this.apply(start);
  }
  // Поза касания: наконечник в точке p, рукоятка — ниже и ближе к тому, кто смотрит (как держат указатель или штангу снизу):
  // контакты на площадке выше головы — указатель видно сбоку, а не вдоль взгляда
  touchPose(m, p) {
    const T = this.T, c = this.v.camera.getWorldPosition(new T.Vector3()), hx = c.x - p.x, hz = c.z - p.z, l = Math.hypot(hx, hz) || 1;
    const b = new T.Vector3(p.x + hx / l * m.tip * 0.5, Math.max(0.9, p.y - m.tip * 0.85), p.z + hz / l * m.tip * 0.5);
    const dir = p.clone().sub(b);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
    return new T.Matrix4().compose(p.clone().addScaledVector(dir, -m.tip), q, new T.Vector3(1, 1, 1));
  }
  apply(mat) { const g = this.anim ? this.anim.m.g : null; if (g) mat.decompose(g.position, g.quaternion, g.scale); }
  // Кадр: туда — на месте (огонёк) — к следующей стороне — обратно в руку
  step(dt, time) {
    const a = this.anim;
    if (!a) return;
    const T = this.T, cur = new T.Matrix4(), p0 = new T.Vector3(), q0 = new T.Quaternion(), s0 = new T.Vector3(), p1 = new T.Vector3(), q1 = new T.Quaternion(), s1 = new T.Vector3();
    const lerp = (A, B, k) => { A.decompose(p0, q0, s0); B.decompose(p1, q1, s1); k = k * k * (3 - 2 * k); return cur.compose(p0.lerp(p1, k), q0.slerp(q1, k), s0.lerp(s1, k)); };
    a.t += dt;
    const target = a.poses[a.i];
    if (a.phase === 'go') {
      this.apply(lerp(a.from, target.pose, Math.min(1, a.t / GO)));
      if (a.t >= GO) {
        a.phase = 'hold'; a.t = 0;
        if (a.label && a.i === 0) a.label(a.m.g);
      }
    } else if (a.phase === 'hold') {
      a.m.lamp.material.color.setHex(target.live && Math.floor(time / 120) % 2 === 0 ? this.C.lampOn : this.C.lampOff);
      if (a.t >= HOLD_T) {
        a.m.lamp.material.color.setHex(this.C.lampOff);
        a.t = 0;
        if (a.i + 1 < a.poses.length) { a.from = target.pose; a.i++; a.phase = 'go'; }
        else { a.phase = 'back'; a.from = target.pose; }
      }
    } else {
      const end = a.anchor ? this.handPose(a) : target.pose.clone().multiply(new T.Matrix4().makeScale(0.001, 0.001, 0.001));
      this.apply(lerp(a.from, end, Math.min(1, a.t / BACK)));
      if (a.t >= BACK) this.finish();
    }
  }
  handPose(a) {
    const T = this.T, h = HOLD[a.anchor.isCamera ? 'desk' : 'xr'][a.m.kind];
    a.anchor.updateWorldMatrix(true, false);
    return new T.Matrix4().compose(new T.Vector3(...h[0]), new T.Quaternion().setFromEuler(new T.Euler(...h[1])), new T.Vector3().setScalar(h[2])).premultiply(a.anchor.matrixWorld);
  }
  // Касание кончилось (или прервано): табличка убрана, модель — в руку, если указатель ещё включён (это решит следующий hold)
  finish() {
    const a = this.anim;
    if (!a) return;
    this.anim = null;
    a.m.lamp.material.color.setHex(this.C.lampOff);
    if (a.m.g.parent) a.m.g.parent.remove(a.m.g);
    a.m.g.visible = false;
    if (this.held && this.held.m === a.m) { this.held.anchor.add(a.m.g); const h = HOLD[this.held.anchor.isCamera ? 'desk' : 'xr'][a.m.kind]; a.m.g.position.set(...h[0]); a.m.g.rotation.set(...h[1]); a.m.g.scale.setScalar(h[2]); a.m.g.visible = true; }
  }
  busy() { return !!this.anim; }
  dispose() { this.finish(); this.hold(null); }
}

export { Probe, ROD_KV };
