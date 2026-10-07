/* Набор для построителей 3D-моделей: фигуры, материалы, точки подключения — и все цвета 3D в одном месте (PAL).
   Модели собраны из кубов и цилиндров; одинаковые размеры берутся из кэша геометрий.
   Материалы — MeshStandardMaterial с процедурными текстурами (TEX, рисуются на холсте ≤ 1024², без скачанных файлов);
   после слияния по материалам каждый материал — один вызов отрисовки, поэтому новых материалов — по минимуму.
   Цвета рисунков на табличках, плакатах и щите (это надписи, а не поверхность) — рядом с их рисованием. */
import { TYPES } from '../../core/elements.js';

const S3 = 1.25, H3 = 3.4;   // 1 клетка = 1,25 м; провода на высоте 3,4 м

// ===== Цвета 3D =====
const PAL = {
  // материалы моделей: [цвет, свойства поверхности]; tex — процедурная текстура (белёсая: цвет даёт материал), rep — повтор
  mats: {
    galv: [0xb7bfc2, { metalness: 0.4, roughness: 0.5, tex: 'galv' }],        // оцинкованная сталь: опоры, рамы, порталы
    lattice: [0xaeb6b9, { metalness: 0.4, roughness: 0.55, tex: 'lattice', alphaTest: 0.5, side: 2 }], // решётчатые стойки и балки
    porcelain: [0x7a3d1e, { roughness: 0.22, metalness: 0.05 }],               // глазурованный фарфор
    polymer: [0x7c8388, { roughness: 0.6 }],                                    // полимерная изоляция (ОПН)
    tank: [0x55665c, { metalness: 0.25, roughness: 0.55, tex: 'paint' }],     // бак трансформатора, баки выключателей
    radiator: [0x60706a, { metalness: 0.25, roughness: 0.6, tex: 'paint' }],
    cabinet: [0xc6cbc5, { roughness: 0.6, tex: 'paint' }],                    // шкафы приводов
    concrete: [0xb2afa5, { roughness: 0.95, tex: 'concrete' }],               // фундаменты
    blade: [0xdfe5e8, { metalness: 0.8, roughness: 0.3 }],                     // ножи разъединителей
    earthBlade: [0xe0b81a, { metalness: 0.4, roughness: 0.5 }],
    plate: [0x6f8f3a, {}], dark: [0x2b302e, {}], handle: [0x1f2226, {}],
    wall: [0xd9cfbd, { tex: 'paint' }], roof: [0x5b4a3c, {}], motor: [0x3f6f9e, { metalness: 0.35 }], pump: [0x6f7d84, { metalness: 0.4 }],
    stripe: [0xffd200, { emissive: 0x332a00 }], fan: [0x2f3437, {}], qf: [0xe8e9e4, {}],
    // слои земли: трава ниже гравия, гравий ниже дороги; смещение глубины — чтобы вдоль земли не мерцали (z-fighting)
    ground: [0xffffff, { roughness: 1, tex: 'grass', rep: 90 }],              // трава за ограждением
    yard: [0xffffff, { roughness: 1, tex: 'gravel', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }],  // гравий площадки
    road: [0xffffff, { roughness: 0.92, tex: 'road', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }],  // дорога
    fence: [0x9aa1a5, { metalness: 0.4, roughness: 0.5, tex: 'mesh', alphaTest: 0.5, side: 2 }], // сетка ограждения
    post: [0x7d8285, {}], ctrl: [0x202428, {}],
    kru: [0xd2d6d0, { metalness: 0.15, roughness: 0.55, tex: 'paint' }],     // окрашенный металл ячеек КРУ
    kruDoor: [0xbfc5bf, { metalness: 0.1, roughness: 0.6, tex: 'paint' }],   // двери ячеек
    mimic: [0x2d3b9a, { roughness: 0.5 }],                                     // мнемосхема на двери КРУ
    cap: [0xb9bfc4, { metalness: 0.4, roughness: 0.45 }], coil: [0x6b5a4a, { roughness: 0.8 }], pzCable: [0xd8c25a, { roughness: 0.6 }],
  },
  // цвета по классам напряжения, положения аппаратов и сигнальных ламп (как в 2D, но для света сцены)
  volt: { dead: 0x7d8884, gnd: 0xF2C318, v220: 0xC9D52E, v110: 0x22B8F5, v35: 0xD8893E, v10: 0xB660E6, v6: 0x5A86FF, v04: 0xFF8B3D, vlow: 0xA0ADA8,
    on: 0xFF2D40, off: 0x1FD36C, blown: 0xFFA21F, lampDark: 0x2a2f2d, live: 0xff6a00, btnOn: 0xb81c2a, btnOff: 0x168a45 },
  ui: { rayIdle: 0x1f45ff, rayHot: 0xffd23f, ring: 0xffd23f, proxy: 0xffffff, lamp: 0xffffff, wireLine: 0x5f666a,
    arc: 0xe6f6ff, sparks: 0xffd27a, arcLight: 0x9fd8ff, beacon: 0xff4d4d, beaconGlow: 0xff2020, window: 0xffcf70 },
  // свет и окружение: площадка под небом и закрытое помещение полигона
  env: {
    fog: 0xc6d6e1, sky: [0x5f97d6, 0x9cc1e6, 0xd2e1ea], hills: [0x9fb0b4, 0x8b9c94], below: 0x8e9a82,
    hemiSky: 0xe8f2ff, hemiGround: 0x5d5a50, sun: 0xfff3e0, shadow: 0x101412,
    roomBg: 0x1d2427, roomSky: 0xf6f7f4, roomGround: 0x7d776a,
  },
  // цвета процедурных рисунков (TEX): трава, гравий, дорога, пол ЗРУ, контур заземления
  tex: { grass: [0x6f8457, 0x5d7347, 0x86965e, 0xa1a36b], gravel: [0xb3b2aa, 0x8f8e86, 0xcfcdc4, 0x9c968a], road: [0xb9b6ad, 0x8f8c84, 0xa7a49b],
    floor: [0x9a9c97, 0x8a8d88, 0xa9aba5, 0x464844], gstrip: [0x1f9a3c, 0xf2d21a] },
  // помещение ЗРУ полигона: [цвет, свойства поверхности], tex — рисунок
  room: {
    rFloor: [0xffffff, { roughness: 0.9, tex: 'floor' }], rMat: [0x2a2d2c, { roughness: 1 }], rLine: [0xf2c318, { roughness: 0.7 }],
    rWall: [0xe6e2d6, { roughness: 0.95, tex: 'paint' }], rWallLow: [0x8fa5a0, { roughness: 0.85, tex: 'paint' }], rWallF: [0xe6e2d6, { roughness: 0.95, tex: 'paint' }],
    rCeil: [0xd9d7cf, { roughness: 1 }], rLampBox: [0xc9ccc8, { metalness: 0.3 }], rDoor: [0x58707a, { metalness: 0.35, roughness: 0.55, tex: 'paint' }],
    rGstrip: [0xffffff, { roughness: 0.6, tex: 'gstrip' }], rKruDoor: [0xbcc3bd, { metalness: 0.05, roughness: 0.7, tex: 'paint' }],
    rCavity: [0x262b2a, { roughness: 0.9 }], rShutter: [0xb8432e, { roughness: 0.6 }], rTrolley: [0xa9b2ad, { metalness: 0.05, roughness: 0.75, tex: 'paint' }],
    rPole: [0x5b3328, { roughness: 0.5 }], rCopper: [0xc8823e, { metalness: 0.6, roughness: 0.35 }],
    rStand: [0x50646f, { roughness: 0.7, tex: 'paint' }], rShelf: [0x8b6b4a, { roughness: 0.8 }], rRed: [0xc8202c, { roughness: 0.45 }],
  },
  roomTube: 0xfafcff,   // светящиеся трубки светильников
  // предметы полигона
  items: { glove: 0xe7c65a, ctrl: 0x202428, ghost: 0xffd23f, back: 0xd9d6cc, helmet: 0xf3f3ee, rod: 0xb3342a, handle: 0x1d2124, head: 0xe6e8e4,
    metal: 0xc9ced2, pzRod: 0xe0a020, pzCable: 0x9b6a3a, brass: 0xc9a43c, post: 0x2b2f31, lampOff: 0x3a1010, lampOn: 0xff2d2d },
};

// Детерминированный шум: одинаковые текстуры при каждом запуске (снимки «до/после» сравнимы)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const css = (c, k = 1, a = 1) => `rgba(${Math.min(255, ((c >> 16) & 255) * k) | 0},${Math.min(255, ((c >> 8) & 255) * k) | 0},${Math.min(255, (c & 255) * k) | 0},${a})`;
const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

// Процедурные текстуры: size — сторона холста, draw(x, w, h, r) — рисунок (r — шум), alpha — прозрачный фон
const TEX = {
  // оцинковка: «блёстки» цинка — пятна чуть светлее и темнее основы
  galv: { size: 256, draw(x, w, h, r) {
    x.fillStyle = grey(236); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const s = 6 + r() * 20; x.fillStyle = grey(208 + r() * 47, 0.55); x.beginPath(); x.moveTo(r() * w, r() * h); for (let k = 0; k < 5; k++) x.lineTo(r() * w + (r() - 0.5) * s, r() * h + (r() - 0.5) * s); x.fill(); }
    for (let i = 0; i < 40; i++) { x.fillStyle = grey(200 + r() * 40, 0.25); x.fillRect(0, r() * h, w, 1); }
  } },
  // окраска: мелкая «апельсиновая корка»
  paint: { size: 256, draw(x, w, h, r) {
    x.fillStyle = grey(240); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { x.fillStyle = grey(222 + r() * 33, 0.6); x.fillRect(r() * w, r() * h, 2, 2); }
    for (let i = 0; i < 18; i++) { x.fillStyle = grey(205 + r() * 30, 0.08); x.fillRect(0, r() * h, w, 3 + r() * 10); }
  } },
  // бетон: крапинки, поры
  concrete: { size: 256, draw(x, w, h, r) {
    x.fillStyle = grey(232); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) { x.fillStyle = grey(185 + r() * 70, 0.7); x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 70; i++) { x.fillStyle = grey(120 + r() * 50, 0.5); x.beginPath(); x.arc(r() * w, r() * h, 0.6 + r() * 1.4, 0, 6.3); x.fill(); }
  } },
  // трава: зелёные и сухие пятна, штрихи травинок
  grass: { size: 512, draw(x, w, h, r) {
    const G = PAL.tex.grass;
    x.fillStyle = css(G[0]); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { x.fillStyle = css(G[1 + (i % 3)], 0.9 + r() * 0.2, 0.25); x.beginPath(); x.ellipse(r() * w, r() * h, 20 + r() * 60, 12 + r() * 40, r() * 3, 0, 6.3); x.fill(); }
    for (let i = 0; i < 9000; i++) { x.strokeStyle = css(G[(r() * 4) | 0], 0.75 + r() * 0.5, 0.55); x.lineWidth = 1; const px = r() * w, py = r() * h; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 2 - r() * 4); x.stroke(); }
  } },
  // гравий: камешки разного тона с бликом
  gravel: { size: 512, draw(x, w, h, r) {
    const C = PAL.tex.gravel;
    x.fillStyle = css(C[0]); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) {
      const px = r() * w, py = r() * h, s = 1.2 + r() * 3.2, c = C[(r() * 4) | 0], k = 0.8 + r() * 0.35;
      x.fillStyle = css(c, k * 0.72); x.beginPath(); x.ellipse(px + 0.6, py + 0.8, s, s * 0.75, r() * 3, 0, 6.3); x.fill();
      x.fillStyle = css(c, k); x.beginPath(); x.ellipse(px, py, s, s * 0.75, r() * 3, 0, 6.3); x.fill();
    }
  } },
  // дорожные плиты 2×2 со швами и пятнами (на 6 м — одна текстура)
  road: { size: 512, draw(x, w, h, r) {
    const C = PAL.tex.road;
    x.fillStyle = css(C[0]); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { x.fillStyle = css(C[(r() * 3) | 0], 0.85 + r() * 0.3, 0.5); x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 14; i++) { x.fillStyle = css(C[1], 0.9, 0.12); x.beginPath(); x.ellipse(r() * w, r() * h, 10 + r() * 50, 6 + r() * 30, r() * 3, 0, 6.3); x.fill(); }
    x.strokeStyle = css(C[1], 0.7, 0.9); x.lineWidth = 4;
    for (const v of [2, w / 2]) { x.beginPath(); x.moveTo(v, 0); x.lineTo(v, h); x.stroke(); x.beginPath(); x.moveTo(0, v); x.lineTo(w, v); x.stroke(); }
  } },
  // решётка стоек и балок порталов: пояса и раскосы (прозрачные просветы)
  lattice: { size: 128, alpha: true, draw(x, w, h) {
    x.strokeStyle = grey(235); x.lineCap = 'square';
    x.lineWidth = 14; x.beginPath(); x.moveTo(7, 0); x.lineTo(7, h); x.moveTo(w - 7, 0); x.lineTo(w - 7, h); x.stroke();
    x.lineWidth = 7; x.beginPath(); x.moveTo(0, 4); x.lineTo(w, 4); x.moveTo(8, 4); x.lineTo(w - 8, h - 4); x.moveTo(w - 8, 4); x.lineTo(8, h - 4); x.stroke();
  } },
  // сетка ограждения: ромбы из проволоки
  mesh: { size: 128, alpha: true, draw(x, w, h) {
    x.strokeStyle = grey(235); x.lineWidth = 2.2;
    for (let i = -4; i <= 4; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + h, h); x.stroke(); x.beginPath(); x.moveTo(i * 32 + h, 0); x.lineTo(i * 32, h); x.stroke(); }
  } },
  // пол ЗРУ: бетон с крапинами, шов по краю плитки (1,2 м)
  floor: { size: 256, draw(x, w, h, r) {
    const C = PAL.tex.floor;
    x.fillStyle = css(C[0]); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { x.fillStyle = css(C[1 + ((r() * 2) | 0)], 0.95 + r() * 0.1, 0.8); x.fillRect(r() * w, r() * h, 2, 2); }
    x.strokeStyle = css(C[3], 1, 0.45); x.lineWidth = 3; x.strokeRect(0, 0, w, h);
  } },
  // контур заземления: жёлто-зелёные полосы
  gstrip: { size: 128, height: 16, draw(x, w, h) {
    const [g, y] = PAL.tex.gstrip;
    x.fillStyle = css(g); x.fillRect(0, 0, w, h); x.fillStyle = css(y);
    for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, h); x.lineTo(i * 16 + 8, h); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 8, 0); x.closePath(); x.fill(); }
  } },
  // мягкая тень-пятно под оборудованием: тёмная середина, прозрачный край
  blob: { size: 128, alpha: true, draw(x, w, h) {
    const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.5, 'rgba(0,0,0,0.26)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  } },
  // небо: градиент к горизонту, у горизонта — дальние холмы; ниже горизонта — цвет дымки над землёй
  sky: { size: 1024, height: 512, draw(x, w, h, r) {
    const [top, mid, hor] = PAL.env.sky, H = h / 2;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(top)); g.addColorStop(0.55, css(mid)); g.addColorStop(1, css(hor));
    x.fillStyle = g; x.fillRect(0, 0, w, H);
    x.fillStyle = css(PAL.env.fog); x.fillRect(0, H, w, h - H);
    // два ряда холмов: дальние светлее; по краям холста рисунок сходится (сфера замыкается)
    PAL.env.hills.forEach((c, row) => {
      const amp = row ? 7 : 12, base = H - (row ? 2 : 5), ph = r() * 6.28, ph2 = r() * 6.28;
      x.fillStyle = css(c, 1, row ? 0.9 : 0.75); x.beginPath(); x.moveTo(0, H + 2);
      for (let i = 0; i <= w; i += 4) { const t = i / w * 6.283; x.lineTo(i, base - amp * (0.5 + 0.3 * Math.sin(t * 3 + ph) + 0.2 * Math.sin(t * 7 + ph2) + 0.12 * Math.sin(t * 17 + ph))); }
      x.lineTo(w, H + 2); x.closePath(); x.fill();
    });
    // облака: размытые пятна в верхней части
    for (let i = 0; i < 26; i++) { const cx = r() * w, cy = 30 + r() * (H * 0.55), rw = 40 + r() * 90; const gg = x.createRadialGradient(cx, cy, 2, cx, cy, rw); gg.addColorStop(0, 'rgba(255,255,255,0.32)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gg; x.fillRect(cx - rw, cy - rw, rw * 2, rw * 2); }
  } },
};

// Текстура по имени (только в браузере: нужен холст). Одна на всё приложение
const texCache = new Map();
function texture(T, kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const d = TEX[kind], c = document.createElement('canvas');
  c.width = d.size; c.height = d.height || d.size;
  d.draw(c.getContext('2d'), c.width, c.height, rng(kind.length * 7919 + kind.charCodeAt(0)));
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
  texCache.set(kind, t);
  return t;
}
// Материалы по палитре (в браузере — с текстурами; в Node тесты строят модели без них). spec — PAL.mats или PAL.room
function makeMaterials(T, spec = PAL.mats) {
  const M = {};
  for (const [name, [color, o]] of Object.entries(spec)) {
    const { tex, rep, ...props } = o;
    const m = M[name] = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.1 }, props));
    if (tex) { const t = texture(T, tex); m.map = rep ? Object.assign(t.clone(), { repeat: new T.Vector2(rep, rep), needsUpdate: true }) : t; }
  }
  return M;
}

function makeKit(T, M, geoCache, nodeMatFor) {
  const boxGeo = (w, h, d) => { const k = `b${w}|${h}|${d}`; if (!geoCache.has(k)) geoCache.set(k, new T.BoxGeometry(w, h, d)); return geoCache.get(k); };
  const cylGeo = (r, h, r2 = r, n = 14) => { const k = `c${r}|${h}|${r2}|${n}`; if (!geoCache.has(k)) geoCache.set(k, new T.CylinderGeometry(r2, r, h, n)); return geoCache.get(k); };
  // коробка с UV по размеру граней (одна клетка рисунка — cell м): решётка и рисунки не растягиваются вдоль длинной стойки
  const wboxGeo = (w, h, d, cell) => {
    const k = `w${w}|${h}|${d}|${cell}`;
    if (geoCache.has(k)) return geoCache.get(k);
    const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv;
    // грани: +x, −x (u — глубина, v — высота), +y, −y (u — ширина, v — глубина), +z, −z (u — ширина, v — высота)
    const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * Math.max(1, Math.round(size[f][0] / cell)), uv.getY(j) * Math.max(1, Math.round(size[f][1] / cell))); }
    geoCache.set(k, g);
    return g;
  };
  const orient = (m, axis) => { if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2; return m; };
  const k = {
    T, M, S3, H3, PAL,
    box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(boxGeo(w, h, d), mat); m.position.set(x, y, z); return m; },
    cyl(r, h, mat, x = 0, y = 0, z = 0, axis) { const m = new T.Mesh(cylGeo(r, h), mat); m.position.set(x, y, z); return orient(m, axis); },
    // усечённый конус: r — низ, r2 — верх
    cone(r, r2, h, mat, x = 0, y = 0, z = 0, axis) { const m = new T.Mesh(cylGeo(r, h, r2), mat); m.position.set(x, y, z); return orient(m, axis); },
    // решётчатая стойка или балка (опоры порталов, ячеек ОРУ): рисунок решётки с клеткой cell м
    lattice(w, h, d, x = 0, y = 0, z = 0, cell = 0.6) { const m = new T.Mesh(wboxGeo(w, h, d, cell), M.lattice); m.position.set(x, y, z); return m; },
    tube(a, b, r, mat) {
      const va = new T.Vector3(a[0], a[1], a[2]), vb = new T.Vector3(b[0], b[1], b[2]);
      const dir = vb.clone().sub(va), len = dir.length();
      const m = new T.Mesh(new T.CylinderGeometry(r, r, Math.max(len, 0.001), 10), mat);
      m.position.copy(va).addScaledVector(dir, 0.5);
      if (len > 0) m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      return m;
    },
    group(x = 0, y = 0, z = 0) { const g = new T.Group(); g.position.set(x, y, z); return g; },
    // изолятор: стержень с юбками (рёбрами), от y0 до y1; mat — фарфор (по умолчанию) или полимер; фланцы — оцинковка
    insulator(x, y0, y1, z, r = 0.09, mat = M.porcelain) {
      const g = new T.Group(), h = y1 - y0;
      g.add(k.cyl(r, h, mat, x, (y0 + y1) / 2, z));
      const n = Math.max(2, Math.round(h / 0.16));
      for (let i = 1; i < n; i++) g.add(k.cone(r * (i % 2 ? 1.8 : 1.5), r * 1.1, 0.05, mat, x, y0 + h * i / n, z));
      g.add(k.cyl(r * 1.3, 0.05, M.galv, x, y0 + 0.025, z), k.cyl(r * 1.3, 0.05, M.galv, x, y1 - 0.025, z));
      return g;
    },
    // пластинчатый радиатор: n пластин вдоль оси z на длине l, каждая — толщиной t, глубиной dep, высотой h; коллекторы сверху и снизу
    fins(x, y, z, n, l, dep, h, mat, t = 0.035) {
      const g = new T.Group();
      for (let i = 0; i < n; i++) g.add(k.box(dep, h, t, mat, x, y, z - l / 2 + (i + 0.5) * l / n));
      g.add(k.cyl(0.05, l, mat, x, y + h / 2 - 0.04, z, 'z'), k.cyl(0.05, l, mat, x, y - h / 2 + 0.04, z, 'z'));
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

export { S3, H3, PAL, TEX, rng, texture, makeMaterials, makeKit };
