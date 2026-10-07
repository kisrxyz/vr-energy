// Построить 3D-модель каждого типа в Node (без браузера): тот же набор фигур (kit.js), материалы — пустышки по именам.
// Возвращает паспорт модели: габарит, подвижные части (где и какого размера), точки подключения, подпись, лампы,
// число треугольников и материалов. Им пользуются тесты (tests/engine.test.js) и снимок «до» (tests/models3d-base.json).
import * as THREE from 'three';
import { TYPES, emptyScheme, makeEl } from '../src/core/elements.js';
import { buildTopo } from '../src/core/engine.js';
import { MODELS, makeKit } from '../src/view3d/models/index.js';

const r2 = v => Math.round(v * 100) / 100;
const vec = v => [r2(v.x), r2(v.y), r2(v.z)];
const boxOf = (o, skip) => {
  const b = new THREE.Box3();
  o.updateMatrixWorld(true);
  o.traverse(m => { if (m.isMesh && !(skip && skip.has(m))) b.expandByObject(m, true); });
  return b.isEmpty() ? null : [...vec(b.min), ...vec(b.max)];
};

function buildModel(t) {
  const s = emptyScheme('модель'), el = makeEl(s, t, 0, 0);
  const topo = buildTopo(s), mats = {}, nodes = new Map();
  const M = new Proxy(mats, { get: (o, k) => o[k] || (o[k] = new THREE.MeshStandardMaterial({ name: String(k) })) });
  const kit = makeKit(THREE, M, new Map(), n => { if (!nodes.has(n)) nodes.set(n, new THREE.MeshStandardMaterial({ name: 'node' })); return nodes.get(n); });
  kit.sphere = new THREE.SphereGeometry(1, 18, 12);
  kit.winTex = () => ({ map: null, mask: null });
  const d = { el, group: new THREE.Group(), kind: t };
  const k = kit.forEl(el, topo, d);
  const r = MODELS[t].build(k, el, d) || {};
  const far = new Set();
  for (const f of d.far || []) f.traverse(o => far.add(o));
  let tris = 0;
  const used = new Set();
  d.group.traverse(o => { if (!o.isMesh) return; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; used.add(o.material); });
  const parts = {};
  for (const key of ['pivot', 'lever', 'slide', 'show', 'mark', 'beacon']) if (d[key]) parts[key] = { at: vec(d[key].position), box: boxOf(d[key]) };
  if (d.spin && d.spin.length) parts.spin = d.spin.map(sp => vec(sp.position));
  const anim = {};
  for (const key of ['ang', 'angT', 'closedAng', 'openAng', 'slideX', 'slideT', 'speed', 'speedT']) if (typeof d[key] === 'number') anim[key] = r2(d[key]);
  return {
    box: boxOf(d.group, far), parts, anim, label: (r.label || []).map(r2), ports: (d.ports || []).map(p => p.map(r2)),
    lamps: (d.lamps || []).map(l => [...l.p.map(r2), r2(l.s)]),
    tris: Math.round(tris), mats: used.size,
  };
}
function allModels() { return Object.fromEntries(Object.keys(TYPES).map(t => [t, buildModel(t)])); }

export { buildModel, allModels };
