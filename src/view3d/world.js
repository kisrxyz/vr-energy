/* ===== Мир для ходьбы пешком (walk.js и стик в шлеме) =====
   Полигон (room.js) и площадка (view3d.buildYard) дают ходьбе одно и то же:
     resolve(x, z, r) → [x, z] — сдвинуть человека (круг радиуса r) из стен и препятствий;
     walkable(x, z, r) — можно ли здесь стоять; start { x, z, yaw } — откуда начинать; kind — 'room' или 'yard'.
   Препятствие — прямоугольник на плане { x0, x1, z0, z1 } (м). Граница — прямоугольник lim того же вида. Без DOM. */

// Сдвинуть круг (x, z, r) внутрь границы и из препятствий
function resolveIn(x, z, r, lim, blocks) {
  for (let it = 0; it < 3; it++) {
    x = Math.min(lim.x1 - r, Math.max(lim.x0 + r, x));
    z = Math.min(lim.z1 - r, Math.max(lim.z0 + r, z));
    for (const b of blocks) {
      const px = Math.min(b.x1, Math.max(b.x0, x)), pz = Math.min(b.z1, Math.max(b.z0, z));
      const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; z += dz * k; }
      else {
        // центр внутри препятствия — выталкиваем к ближайшей грани
        const opts = [[b.x0 - r - x, 0], [b.x1 + r - x, 0], [0, b.z0 - r - z], [0, b.z1 + r - z]];
        opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
        x += opts[0][0]; z += opts[0][1];
      }
    }
  }
  return [x, z];
}
function walkableIn(x, z, r, lim, blocks) {
  if (x < lim.x0 + r || x > lim.x1 - r || z < lim.z0 + r || z > lim.z1 - r) return false;
  return !blocks.some(b => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
}

// Что мешает пройти: детали выше LOW, которые начинаются ниже головы HEAD (провода, шины, ножи на высоте — не мешают).
// Детали ближе GAP друг к другу сливаются в один прямоугольник: между ними человеку не пройти (ноги опоры, бак и радиаторы)
const LOW = 0.5, HEAD = 1.9, GAP = 0.7;
function footprints(T, group, skip) {
  const out = [], b = new T.Box3();
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh || o.userData.proxy || (skip && skip(o))) return;
    b.setFromObject(o);
    if (b.isEmpty() || b.max.y < LOW || b.min.y > HEAD) return;
    out.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
  });
  return mergeBoxes(out, GAP);
}
// Слить прямоугольники, между которыми меньше gap
function mergeBoxes(list, gap) {
  const a = list.map(q => Object.assign({}, q));
  const near = (p, q) => p.x0 - gap < q.x1 && q.x0 - gap < p.x1 && p.z0 - gap < q.z1 && q.z0 - gap < p.z1;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      if (!near(a[i], a[j])) continue;
      const p = a[i], q = a[j];
      a[i] = { x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1), z0: Math.min(p.z0, q.z0), z1: Math.max(p.z1, q.z1) };
      a.splice(j, 1); changed = true; j = i;
    }
  }
  return a;
}

// Площадка: внутри ограждения (hx, hz — полуразмеры), ворота шириной 2·gate в ближней стороне (z = +hz),
// перед воротами снаружи — площадка apron м, там старт лицом к подстанции
// dyn() — препятствия, которые двигаются (тележки ЗРУ, выкаченные в коридор)
function makeYardWorld({ hx, hz, gate, apron = 3, blocks = [], dyn = null }) {
  const lim = { x0: -hx, x1: hx, z0: -hz, z1: hz + apron };
  // ближняя сторона ограждения по обе стороны ворот; снаружи за ней — только площадка перед воротами
  const fence = [{ x0: -hx - 1, x1: -gate, z0: hz - 0.05, z1: hz + apron + 1 }, { x0: gate, x1: hx + 1, z0: hz - 0.05, z1: hz + apron + 1 }];
  const all = blocks.concat(fence);
  return {
    kind: 'yard', lim, blocks: all,
    start: { x: 0, z: hz + apron / 2, yaw: 0 },
    resolve(x, z, r = 0.25) { return resolveIn(x, z, r, lim, dyn ? all.concat(dyn()) : all); },
    walkable(x, z, r = 0.25) { return walkableIn(x, z, r, lim, dyn ? all.concat(dyn()) : all); },
  };
}

export { resolveIn, walkableIn, footprints, mergeBoxes, makeYardWorld };
