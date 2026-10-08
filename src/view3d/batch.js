/* ===== Меньше вызовов отрисовки: шлем рисует каждый глаз отдельно (three.js 0.160 без мультивью), бюджет — ≤ 200 за оба глаза =====
   Таблица узлов (DataTexture, на узел — цвет и сила свечения) заменяет «свой материал на каждый узел»: провода, шины и выводы
   всех узлов после слияния — одна сетка с одним материалом (nodeIdx — номер узла в вершине), было по сетке на узел
   (ПС 110/35/10 — 57 вызовов на глаз). Окна зданий потребителей — тоже одна сетка: светятся, если на узле есть напряжение.
   Одинаковые подвижные части разных аппаратов (лицевые панели тележек, рукоятки ЗН и приводов, ножи, крыльчатки, патроны)
   — одна InstancedMesh на геометрию и материал; на месте части — пустой объект, его мировая матрица — матрица экземпляра
   (sync после каждого движения). Подвижные части с материалом узла — тоже инстансами, номер узла — у экземпляра.
   Цвета — в models/kit.js (PAL), здесь только способ рисовать. */

// Таблица узлов: цвет (линейный) и сила свечения; номер узла — порядок v.nodeMats на момент сборки
class NodeTable {
  constructor(T, nodes) {
    this.T = T; this.idx = new Map(); nodes.forEach((n, i) => this.idx.set(n, i));
    this.n = Math.max(1, nodes.length);
    this.data = new Float32Array(this.n * 4);
    this.tex = new T.DataTexture(this.data, this.n, 1, T.RGBAFormat, T.FloatType);
    this.tex.magFilter = this.tex.minFilter = T.NearestFilter;
    this.tex.needsUpdate = true;
    this.c = new T.Color();
  }
  // узел, которого не было при сборке (ПЗ на новой точке), рисуется своим материалом — в таблицу не попадает
  set(node, hex, ei) {
    const i = this.idx.get(node);
    if (i == null) return;
    this.c.setHex(hex);
    this.data[i * 4] = this.c.r; this.data[i * 4 + 1] = this.c.g; this.data[i * 4 + 2] = this.c.b; this.data[i * 4 + 3] = ei;
  }
  commit() { this.tex.needsUpdate = true; }
}

// Цвет узла в вершинном шейдере: nodeIdx — атрибут вершины (слитая сетка) или экземпляра (InstancedMesh)
const VS_HEAD = 'attribute float nodeIdx;\nuniform sampler2D nodeTex;\nuniform float nodeN;\nvarying vec4 vNode;\n';
const VS_NODE = '#include <begin_vertex>\n  vNode = texture2D(nodeTex, vec2((nodeIdx + 0.5) / nodeN, 0.5));';
function inject(m, u, key, frag) {
  m.onBeforeCompile = sh => {
    sh.uniforms.nodeTex = u.nodeTex; sh.uniforms.nodeN = u.nodeN;
    sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VS_NODE);
    sh.fragmentShader = 'varying vec4 vNode;\n' + frag(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => key;
  return m;
}
// Провода, шины, выводы: цвет и свечение узла (как прежний материал узла: блестящий металл)
function nodeMaterial(T, u) {
  return inject(new T.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 }), u, 'ts-node', f => f
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vNode.rgb, opacity );')
    .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vNode.rgb * vNode.a;'));
}
// Окна потребителя: рисунок окон, свечение — там, где маска окна, и только при напряжении на узле (сила свечения узла живого — 0,55)
function winMaterial(T, u, src, glow) {
  const m = new T.MeshStandardMaterial({ map: src.map, emissiveMap: src.emissiveMap, emissive: glow, emissiveIntensity: 1, roughness: src.roughness });
  return inject(m, u, 'ts-win', f => f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= step(0.5, vNode.a);'));
}

// Подпись геометрии по содержимому: одинаковые части разных аппаратов (после слияния — разные объекты) узнаются по ней
const sigs = new WeakMap();
function geoSig(g) {
  let s = sigs.get(g);
  if (s) return s;
  const p = g.attributes.position.array;
  let a = 0, b = 0;
  for (let i = 0; i < p.length; i++) { a += p[i]; b += p[i] * ((i % 7) + 1); }
  s = `${p.length}|${g.index ? g.index.count : 0}|${a.toFixed(3)}|${b.toFixed(3)}`;
  sigs.set(g, s);
  return s;
}

class Batch {
  constructor(v) {
    const T = this.T = v.kit.T;
    this.v = v;
    this.table = new NodeTable(T, [...v.nodeMats.keys()]);
    this.nodeOf = new Map([...v.nodeMats].map(([n, m]) => [m, n]));
    this.u = { nodeTex: { value: this.table.tex }, nodeN: { value: this.table.n } };
    this.nodeMat = nodeMaterial(T, this.u);
    this.win = null; this.groups = [];
  }
  // номер узла материала (или −1 — не материал узла)
  nodeIdx(mat) { const n = this.nodeOf.get(mat); return n == null ? -1 : this.table.idx.get(n); }
  // Одинаковые подвижные части аппаратов → InstancedMesh (вызывать после compactParts, до mergeStatic)
  instance() {
    const T = this.T, v = this.v, buckets = new Map(), seen = new Set();
    for (const d of v.dev.values()) {
      const roots = [...(d.merge || []), d.pivot, d.lever, d.slide, d.show, d.mark, ...(d.spin || [])].filter(Boolean);
      for (const r of roots) r.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || o.userData.proxy || seen.has(o)) return;
        seen.add(o);
        const ni = this.nodeIdx(o.material), key = (ni >= 0 ? 'node' : o.material.uuid) + '#' + geoSig(o.geometry);
        let l = buckets.get(key);
        if (!l) buckets.set(key, l = []);
        l.push({ o, ni });
      });
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const node = list[0].ni >= 0;
      let geo = list[0].o.geometry, attr = null;
      if (node) {
        geo = geo.clone();
        geo.setAttribute('nodeIdx', attr = new T.InstancedBufferAttribute(new Float32Array(list.length), 1));
      }
      const im = new T.InstancedMesh(geo, node ? this.nodeMat : list[0].o.material, list.length);
      im.frustumCulled = false; im.raycast = () => {};
      const slots = list.map(({ o, ni }) => {
        // на месте части — пустой объект с тем же положением: его мировая матрица — матрица экземпляра
        const slot = new T.Object3D(), parent = o.parent;
        slot.position.copy(o.position); slot.quaternion.copy(o.quaternion); slot.scale.copy(o.scale);
        parent.add(slot); parent.remove(o);
        return { o: slot, ni };
      });
      v.root.add(im);
      this.groups.push({ im, slots, attr });
    }
    this.sync();
  }
  // Матрицы экземпляров — по местам частей. Видимые — подряд с начала, im.count — сколько их: спрятанная часть
  // (начинка тележки в шкафу, снятый патрон) не рисуется вовсе, а без видимых экземпляров нет и вызова
  sync() {
    for (const { im, slots, attr } of this.groups) {
      let k = 0;
      for (const s of slots) {
        let vis = true;
        for (let p = s.o; p; p = p.parent) if (!p.visible) { vis = false; break; }
        if (!vis) continue;
        s.o.updateWorldMatrix(true, false);
        im.setMatrixAt(k, s.o.matrixWorld);
        if (attr) attr.array[k] = s.ni;
        k++;
      }
      im.count = k; im.visible = k > 0;
      im.instanceMatrix.needsUpdate = true;
      if (attr) attr.needsUpdate = true;
    }
  }
  // Слитая неподвижная сетка узлов и окон: номер узла — в каждой вершине
  tag(geo, i) {
    geo.setAttribute('nodeIdx', new this.T.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(i), 1));
    return geo;
  }
  // Окна потребителей: материал один на всех, номер узла — по узлу потребителя
  winFor(src) {
    if (!this.win) this.win = winMaterial(this.T, this.u, src, this.v.kit.PAL.ui.window);
    return this.win;
  }
  setNode(node, hex, ei) { this.table.set(node, hex, ei); }
  commit() { this.table.commit(); }
  dispose() {
    this.table.tex.dispose(); this.nodeMat.dispose(); if (this.win) this.win.dispose();
    for (const { im, attr } of this.groups) { im.dispose(); if (attr) im.geometry.dispose(); }
  }
}

export { Batch, geoSig };
