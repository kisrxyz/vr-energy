/* Набор для построителей 3D-моделей: фигуры, материалы, точки подключения.
   Все модели собраны из кубов и цилиндров; одинаковые размеры берутся из кэша геометрий. */
import { TYPES } from '../../core/elements.js';

const S3 = 1.25, H3 = 3.4;   // 1 клетка = 1,25 м; провода на высоте 3,4 м

function makeKit(T, M, geoCache, nodeMatFor) {
  const boxGeo = (w, h, d) => { const k = `b${w}|${h}|${d}`; if (!geoCache.has(k)) geoCache.set(k, new T.BoxGeometry(w, h, d)); return geoCache.get(k); };
  const cylGeo = (r, h, r2 = r) => { const k = `c${r}|${h}|${r2}`; if (!geoCache.has(k)) geoCache.set(k, new T.CylinderGeometry(r2, r, h, 14)); return geoCache.get(k); };
  const orient = (m, axis) => { if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2; return m; };
  const k = {
    T, M, S3, H3,
    box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(boxGeo(w, h, d), mat); m.position.set(x, y, z); return m; },
    cyl(r, h, mat, x = 0, y = 0, z = 0, axis) { const m = new T.Mesh(cylGeo(r, h), mat); m.position.set(x, y, z); return orient(m, axis); },
    // усечённый конус: r — низ, r2 — верх
    cone(r, r2, h, mat, x = 0, y = 0, z = 0, axis) { const m = new T.Mesh(cylGeo(r, h, r2), mat); m.position.set(x, y, z); return orient(m, axis); },
    tube(a, b, r, mat) {
      const va = new T.Vector3(a[0], a[1], a[2]), vb = new T.Vector3(b[0], b[1], b[2]);
      const dir = vb.clone().sub(va), len = dir.length();
      const m = new T.Mesh(new T.CylinderGeometry(r, r, Math.max(len, 0.001), 10), mat);
      m.position.copy(va).addScaledVector(dir, 0.5);
      if (len > 0) m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      return m;
    },
    group(x = 0, y = 0, z = 0) { const g = new T.Group(); g.position.set(x, y, z); return g; },
    // фарфоровая колонна с юбками (изолятор): от y0 до y1
    insulator(x, y0, y1, z, r = 0.09) {
      const g = new T.Group();
      g.add(k.cyl(r, y1 - y0, M.porcelain, x, (y0 + y1) / 2, z));
      const n = Math.max(2, Math.round((y1 - y0) / 0.28));
      for (let i = 1; i < n; i++) g.add(k.cyl(r * 1.8, 0.04, M.porcelain, x, y0 + (y1 - y0) * i / n, z));
      return g;
    },
  };
  // Модель элемента: точки подключения (местные координаты) и материалы узлов
  k.forEl = (el, topo, d) => {
    const tm = topo.term.get(el.id) || [];
    d.ports = (TYPES[el.t].ports || []).map(p => [p[0] * S3, H3, p[1] * S3]);
    d.lamps = [];
    return Object.assign(Object.create(k), {
      node: i => nodeMatFor(tm[i] != null ? tm[i] : tm[0]),
      port: i => d.ports[i] || [0, H3, 0],
      // сигнальная лампа положения (все лампы схемы рисуются одним вызовом)
      lamp: (x, y, z, s = 0.12) => { d.lamps.push({ p: [x, y, z], s }); },
    });
  };
  return k;
}

export { S3, H3, makeKit };
