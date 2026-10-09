/* ===== Щит с заданием, запястье и панели перед глазами в шлеме (методы View3D, подключаются в view3d.js) =====
   Щит: задание, следующий шаг или строка обучения, журнал, кнопки (курок, щелчок, E); на площадке он переезжает к первому аппарату
   задания (guide.js), в полигоне — на стене, в ЗРУ — второй щит в тамбуре с той же текстурой. Запястье — левая рука в шлеме.
   Баннер, обучение, отладка и справка — панели перед глазами или у луча. Вынесено из view3d.js без изменения поведения. */
import { THREE } from './three.js';
import { clamp } from '../core/elements.js';
import { fmtTime } from '../core/engine.js';
import { Sound } from '../ui/sound.js';
import { Diag } from '../ui/diag.js';

// Скруглённый прямоугольник на холсте (щит, меню, подписи, панели)
function rr(x, X, Y, W, H, R) {
  x.beginPath();
  x.moveTo(X + R, Y); x.lineTo(X + W - R, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + R);
  x.lineTo(X + W, Y + H - R); x.quadraticCurveTo(X + W, Y + H, X + W - R, Y + H);
  x.lineTo(X + R, Y + H); x.quadraticCurveTo(X, Y + H, X, Y + H - R);
  x.lineTo(X, Y + R); x.quadraticCurveTo(X, Y, X + R, Y); x.closePath();
}

const Board = {
  mkPanel(w, h, pw, ph) {
    const T = THREE, c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(pw, ph), new T.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = 12; m.visible = false;
    return { c, t, m };
  },
  // Панель отладки у левого края взгляда. В шлеме — кнопка «Отладка» на щите, на компьютере в 3D — клавиша F.
  toggleDebug(on) {
    if (!this.ready) return;
    if (!this.dbg) { this.dbg = this.mkPanel(640, 560, 0.4, 0.35); this.dbg.m.position.set(-0.36, 0.1, -0.9); this.camera.add(this.dbg.m); }
    this.dbg.m.visible = on == null ? !this.dbg.m.visible : on;
    if (this.dbg.m.visible) this.drawDebug();
    this.drawBoard();
  },
  drawDebug() {
    const { c, t } = this.dbg, x = c.getContext('2d'), p = this.perf || {}, xr = this.renderer.xr, s = xr.getSession && xr.getSession();
    const F = (w, sz) => `${w} ${sz}px "JetBrains Mono", ui-monospace, monospace`;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(8,12,10,0.88)'; rr(x, 0, 0, c.width, c.height, 20); x.fill();
    let y = 44;
    const line = (text, color = '#e8efe9', size = 24, w = 500) => { x.font = F(w, size); x.fillStyle = color; x.fillText(this.fit(x, text, c.width - 40), 20, y); y += size + 10; };
    const fps = Math.round(p.fps || 0), minFps = p.hist && p.hist.length ? Math.min(...p.hist) : 0;
    line(`FPS ${fps}  (мин. за 10 с: ${minFps})`, fps >= 68 ? '#5ee08f' : fps >= 50 ? '#f5b544' : '#ff6b7d', 34, 600);
    line(`Отрисовка: ${p.calls || 0} вызовов${xr.isPresenting ? ' (оба глаза)' : ''}, ${Math.round((p.tris || 0) / 1000)} тыс. треуг.`);
    if (xr.isPresenting) { x.font = F(500, 22); x.fillStyle = '#e8efe9'; this.wrap(x, `VR: ${this.refInfo || '?'}`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 30; }); }
    else line('VR: не запущен (3D на экране)');
    const ins = this.inputList();
    if (!ins.length) line('Ввод: нет', '#93a69e');
    for (const i of ins.slice(0, 3)) line('· ' + i, '#c6d3cd', 22);
    const cp = this.camera.getWorldPosition(this.tmp.v2);
    line(`Где стою: x ${cp.x.toFixed(1)} м, z ${cp.z.toFixed(1)} м, глаза ${cp.y.toFixed(2)} м`, '#c6d3cd', 22);
    const d = Diag.data();
    line(`Отметок: ${d.marks.length} · ошибок в журнале: ${Diag.errors().length}`, '#c6d3cd', 22);
    x.font = F(400, 18); x.fillStyle = '#93a69e';
    this.wrap(x, navigator.userAgent, c.width - 40, 3).forEach(l => { x.fillText(l, 20, y); y += 24; });
    const e = Diag.pageErrors ? Diag.lastError() : null;
    if (e) { y += 4; x.font = F(600, 20); x.fillStyle = '#ff6b7d'; this.wrap(x, `Ошибка: ${e.where}: ${e.msg}`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 26; }); }
    t.needsUpdate = true;
  },
  // Короткое обучение перед лицом: при первом входе в VR и по кнопке «Обучение» на щите; закрывается курком.
  // kind = 'uvn' — «как понять результат» при первом взятии указателя
  showTutor(on = true, kind) {
    if (!this.tutor) { this.tutor = this.mkPanel(1024, 600, 1.0, 0.586); this.tutor.m.position.set(0, -0.05, -1.25); this.camera.add(this.tutor.m); }
    this.tutor.m.visible = on;
    if (!on) return;
    this.tutorKind = kind || (this.room ? 'room' : 'yard');
    const { c, t } = this.tutor, x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(16,24,21,0.94)'; rr(x, 0, 0, c.width, c.height, 28); x.fill();
    x.fillStyle = '#3b4fd1'; rr(x, 0, 0, c.width, 10, 4); x.fill();
    // в полигоне — как брать предметы (то же на табличке над стендом)
    const uvn = this.tutorKind === 'uvn';
    x.fillStyle = '#ffffff'; x.font = F(600, 44); x.fillText(uvn ? 'Указатель: как понять результат' : this.room ? 'Как брать предметы' : 'Как управлять', 44, 82);
    const steps = uvn ? [
      ['1', 'Сначала самопроверка', 'Коснитесь наконечником электрода проверочного устройства на полке стенда: мигает и пищит — указатель исправен.'],
      ['2', 'Горит и пищит — напряжение есть', 'На контактах огонёк мигает красным и звучит сигнал: заземлять и работать нельзя.'],
      ['3', 'Молчит, огонёк серый — напряжения нет', 'Но только после самопроверки: неисправный указатель тоже молчит.'],
    ] : this.room ? [
      ['1', 'Подойдите к стенду справа от входа', 'Левый стик — ходьба, правый — поворот, курок по полу — переход к кольцу. На стенде — СИЗ, указатель, ПЗ, плакаты, замок, ограждение.'],
      // описание шага — не больше 2 строк, иначе обрезается «…»
      ['2', 'Боковая кнопка — взять и отпустить', 'Рука у предмета, боковая кнопка — взять. Ещё раз у нужного места — повесить, запереть, поставить; в стороне — уронить.'],
      ['3', 'СИЗ и указатель', 'Перчатки и каска надеваются сразу. Указатель: сначала проверочное устройство на полке, потом нижние контакты.'],
    ] : [
      ['1', 'Луч и курок', 'Наведите луч на аппарат и нажмите курок — он переключится. Курок по земле — переход туда, где кольцо (красное — не пройти).'],
      ['2', 'Боковая кнопка — указатель', 'Наведите луч и нажмите боковую кнопку (под средним пальцем) — проверка напряжения.'],
      ['3', 'Стики и кнопки', 'Левый стик — ходьба, правый — поворот. B или Y — к аппарату следующего шага, A или X — отметка для отчёта.'],
    ];
    let y = 150;
    for (const [n, h, d] of steps) {
      x.fillStyle = '#3b4fd1'; x.beginPath(); x.arc(72, y - 4, 26, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffffff'; x.font = F(700, 30); x.textAlign = 'center'; x.fillText(n, 72, y + 7); x.textAlign = 'left';
      x.font = F(600, 32); x.fillText(h, 120, y + 6);
      x.font = F(400, 26); x.fillStyle = '#c6d3cd';
      this.wrap(x, d, c.width - 160, 2).forEach((l, i) => x.fillText(l, 120, y + 46 + i * 32));
      y += 140;
    }
    x.fillStyle = '#ffd23f'; x.font = F(600, 30); x.textAlign = 'center';
    x.fillText('Нажмите курок, чтобы начать', c.width / 2, c.height - 30); x.textAlign = 'left';
    t.needsUpdate = true;
  },
  // ---------- щит с заданием ----------
  makeBoard(place) {
    const T = THREE;
    if (!this.boardCanvas) {
      // рисуем в координатах 1024×720, текстура в 1,5 раза плотнее — чтобы читалось в шлеме с 2–3 м
      this.boardCanvas = document.createElement('canvas');
      this.boardW = 1024; this.boardH = 720; this.boardK = 1.5;
      this.boardCanvas.width = this.boardW * this.boardK; this.boardCanvas.height = this.boardH * this.boardK;
      this.boardTex = new T.CanvasTexture(this.boardCanvas);
      this.boardTex.colorSpace = T.SRGBColorSpace;
      this.boardTex.anisotropy = 4;
    }
    const g = new T.Group();
    const panel = new T.Mesh(new T.PlaneGeometry(3.2, 2.25), new T.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
    panel.position.y = 2.25; panel.userData.board = true; g.add(panel);
    g.add(this.box(3.32, 2.37, 0.08, this.M.dark, 0, 2.25, -0.05));
    // place — щит на стене помещения (полигон): без стоек, уменьшенный
    if (place) {
      g.position.set(place.pos[0], place.pos[1], place.pos[2]); g.rotation.y = place.ry; g.scale.setScalar(place.scale);
    } else {
      for (const x of [-1.35, 1.35]) g.add(this.box(0.1, 1.2, 0.1, this.M.galv, x, 0.6, -0.05));
      g.position.set(-4.4, 0, this.bounds.hz - 1.4);
      g.rotation.y = 0.5;
    }
    this.root.add(g);
    this.pickables.push(panel);
    this.drawBoard();
    return g;
  },
  wrap(x, text, maxW, maxLines) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = this.fit(x, lines[maxLines - 1] + '…', maxW); }
    return lines;
  },
  fit(x, text, maxW) {
    if (x.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  },
  drawBoard() {
    if (!this.boardCanvas) return;
    const c = this.boardCanvas, x = c.getContext('2d'), app = this.app, tr = app.tr, W = this.boardW, H = this.boardH;
    const F = (w, s) => `${w} ${s}px "Golos Text", system-ui, sans-serif`;
    x.setTransform(this.boardK, 0, 0, this.boardK, 0, 0);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#14201b'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#3b4fd1'; x.fillRect(0, 0, W, 8);
    x.fillStyle = '#eef4f1'; x.font = F(600, 32); x.fillText(this.fit(x, app.scheme.title, W - 64), 32, 58);
    x.fillStyle = '#93a69e'; x.font = F(400, 22);
    const poly = !!this.room, pm = app.permit;
    const mode = poly ? 'предметы: боковая кнопка в шлеме, E на ноутбуке' : app.tool === 'check' ? 'режим указателя напряжения' : app.tool === 'pz' ? 'переносное заземление: курок по проводу или шине' : 'курок — операция, боковая кнопка — указатель';
    x.fillText(this.fit(x, `Блокировки ${tr.opt.interlocks ? 'включены' : 'выключены'} · ${mode}`, W - 64), 32, 92);
    let y = 142;
    const para = (text, size, weight, color, maxLines) => {
      x.font = F(weight, size); x.fillStyle = color;
      for (const l of this.wrap(x, text, W - 64, maxLines)) { x.fillText(l, 32, y); y += Math.round(size * 1.3); }
    };
    const run = tr.run, tasks = app.scheme.tasks;
    // экзамен: «задание 1 из 2» и время; подсказок и эталона нет
    const exam = !!(app.exam && app.exam.active());
    if (exam) { x.font = F(600, 24); x.fillStyle = '#ffd23f'; x.fillText(this.fit(x, app.exam.boardLine(), W - 64), 32, y); y += 38; }
    if (run) {
      para(run.task.title, 30, 600, '#ffffff', 2);
      if (!run.done) {
        para(run.task.desc, 22, 400, '#c6d3cd', poly ? 2 : 3);
        const g = tr.grade(run);
        y += 8; x.font = F(600, 26); x.fillStyle = run.errors.length ? '#ffb4bd' : '#eef4f1';
        x.fillText(`Время ${fmtTime(tr.elapsed())} · операций ${g.myOps} · ошибок ${run.errors.length}`, 32, y); y += 40;
        // площадка с подсказками шагов — следующий шаг (без штрафа, Trainer.peek)
        const nx = poly ? null : app.guideNext(), cl = poly ? null : this.coach.boardLine();
        if (cl) para(cl, 26, 600, '#ffd23f', 3);
        else if (nx) para('Следующий шаг: ' + nx.text, 26, 600, '#ffd23f', 2);
        // полигон: сколько мероприятий сделано, СИЗ и подсказка «следующее мероприятие»
        if (poly && run.task.measures) {
          const st = pm.status();
          x.font = F(500, 22); x.fillStyle = '#c6d3cd';
          x.fillText(`Мероприятия: ${st.n} из ${st.total} · СИЗ: перчатки ${st.ppe.gloves ? '✓' : '—'}, каска ${st.ppe.helmet ? '✓' : '—'}`, 32, y); y += 34;
          if (st.guide && st.next) para('Следующее: ' + st.next, 26, 600, '#ffd23f', 2);
        }
      } else {
        const g = run.grade;
        y += 6; x.font = F(600, 30); x.fillStyle = g.tone === 'good' ? '#4ade80' : g.tone === 'mid' ? '#f5a524' : '#ff5a6e';
        x.fillText(`${g.verdict} · ${g.score} из 100`, 32, y); y += 42;
        x.font = F(400, 22); x.fillStyle = '#c6d3cd';
        x.fillText(`Время ${fmtTime(g.secs)} · операций ${g.myOps} (эталон ${g.refOps}) · ошибок ${run.errors.length}`, 32, y); y += 36;
      }
    } else if (tasks.length) {
      const i = clamp(app.taskIdx, 0, tasks.length - 1);
      x.font = F(500, 22); x.fillStyle = '#93a69e';
      x.fillText(`Задание ${i + 1} из ${tasks.length}: выберите стрелками и нажмите «Начать»`, 32, y); y += 40;
      para(tasks[i].title, 30, 600, '#ffffff', 2);
      para(tasks[i].desc, 22, 400, '#c6d3cd', 3);
    } else para('Свободная тренировка: наведите луч на аппарат и нажмите курок.', 26, 500, '#ffffff', 2);
    y = Math.max(y + 12, 392);
    x.fillStyle = '#2b3a34'; x.fillRect(32, y - 30, W - 64, 2);
    // справка о неизменяемом аппарате, нажатом в шлеме (infoFx) — 20 с вместо первой записи журнала
    const info = this.boardInfo && performance.now() < this.boardInfo.until ? this.boardInfo.text : null;
    if (info) { x.font = F(500, 21); x.fillStyle = '#9fd0ff'; x.fillText(this.fit(x, 'Справка: ' + info, W - 64), 32, y); y += 30; }
    x.font = F(400, 21);
    for (const e of tr.log.slice(0, info ? 2 : 3)) {
      x.fillStyle = e.level === 'err' ? '#ff6b7d' : e.level === 'warn' ? '#f5b544' : e.level === 'ok' ? '#5ee08f' : '#c6d3cd';
      x.fillText(this.fit(x, e.text, W - 64), 32, y); y += 30;
    }
    // в полигоне ПЗ — предмет со стенда, а вместо платной подсказки — «следующее мероприятие» (вкл/выкл)
    const btns = [], pz = poly ? [] : [['pz', 'ПЗ']];
    if (exam) {
      if (run && !run.done) btns.push(['ack', 'Квитировать'], ...pz, ['stop', 'Завершить задание']);
      else if (app.exam.between) btns.push(['exnext', 'Следующее задание']);
    } else if (run && !run.done) {
      // полигон — «Подсказки» мероприятий; площадка — «Подсказки» шагов и «К следующему» (с ними платная «Подсказка» не нужна)
      const help = poly && run.task.measures ? [['guide', pm.guide ? 'Подсказки: вкл' : 'Подсказки: выкл']]
        : poly ? [['hint', 'Подсказка']] : app.stepGuide ? [['sguide', 'Подсказки: вкл'], ['goto', 'К следующему']] : [['hint', 'Подсказка'], ['sguide', 'Подсказки: выкл']];
      btns.push(...help, ['ack', 'Квитировать'], ...pz, ['stop', 'Завершить']);
    }
    else if (run && run.done) btns.push(['again', 'Ещё раз'], ['exit', 'Свободный режим'], ['lock', tr.opt.interlocks ? 'Блокировки: вкл' : 'Блокировки: выкл']);
    else {
      if (tasks.length) btns.push(['prev', '‹'], ['next', '›'], ['start', 'Начать']);
      btns.push(['ack', 'Квитировать'], ...pz, ['reset', 'Сброс'], ['lock', tr.opt.interlocks ? 'Блок.: вкл' : 'Блок.: выкл']);
    }
    // узкие кнопки: стрелки и ПЗ
    const fixed = { prev: 76, next: 76, pz: 92 };
    const bh = 64, by = H - bh - 22, gap = 12, fx = btns.reduce((a, b) => a + (fixed[b[0]] || 0), 0), nf = btns.filter(b => fixed[b[0]]).length;
    const bigW = (W - 64 - fx - gap * (btns.length - 1)) / (btns.length - nf);
    let bx = 32;
    this.boardBtns = [];
    for (const [act, label] of btns) {
      const w = fixed[act] || bigW;
      const lit = act === 'start' || act === 'again' || (act === 'pz' && app.tool === 'pz');
      x.fillStyle = lit ? '#3b4fd1' : '#24332d'; rr(x, bx, by, w, bh, 12); x.fill();
      x.strokeStyle = '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffffff'; x.font = F(600, act === 'prev' || act === 'next' ? 40 : 24); x.textAlign = 'center';
      x.fillText(label, bx + w / 2, by + (act === 'prev' || act === 'next' ? 46 : 41));
      x.textAlign = 'left';
      this.boardBtns.push({ act, x: bx, y: by, w, h: bh });
      bx += w + gap;
    }
    // служебный ряд для теста: слева последняя ошибка (красным), справа отметка, отладка, обучение
    const sy = by - 62, sh = 50, sw = 150;
    const util = [['mark', 'Отметка'], ['debug', 'Отладка'], ['tutor', 'Обучение']];
    util.forEach(([act, label], i) => {
      const ux = W - 32 - (util.length - i) * (sw + 10) + 10, lit = act === 'debug' && this.dbg && this.dbg.m.visible;
      x.fillStyle = lit ? '#3b4fd1' : '#1d2a25'; rr(x, ux, sy, sw, sh, 10); x.fill();
      x.strokeStyle = '#3d5048'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#dfe8e3'; x.font = F(600, 22); x.textAlign = 'center'; x.fillText(label, ux + sw / 2, sy + 33); x.textAlign = 'left';
      this.boardBtns.push({ act, x: ux, y: sy, w: sw, h: sh });
    });
    const err = Diag.pageErrors ? Diag.lastError() : null;
    if (err) {
      x.fillStyle = '#ff6b7d'; x.font = F(600, 20);
      this.wrap(x, `Ошибка: ${err.where}: ${err.msg}`, W - 64 - util.length * (sw + 10) - 10, 2).forEach((l, i) => x.fillText(l, 32, sy + 20 + i * 24));
    }
    if (this.handsOnly) {
      x.fillStyle = 'rgba(165,92,0,0.96)'; rr(x, 32, 300, W - 64, 120, 16); x.fill();
      x.fillStyle = '#ffffff'; x.font = F(600, 36); x.fillText('Возьмите контроллеры', 56, 350);
      x.font = F(400, 24); x.fillText('Управление руками в тренажёре не поддерживается: нужны курок и стики.', 56, 392);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    this.boardTex.needsUpdate = true;
    if (this.wrist && this.renderer && this.renderer.xr.isPresenting) this.drawWrist();
  },
  boardClick(uv) {
    if (!uv || !this.boardBtns) return;
    const px = uv.x * this.boardW, py = (1 - uv.y) * this.boardH;
    const b = this.boardBtns.find(q => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
    if (b) this.boardAction(b.act);
  },
  boardAction(act) {
    const app = this.app, tr = app.tr, n = app.scheme.tasks.length;
    Sound.play('check');
    if (act === 'prev' && n) app.taskIdx = (app.taskIdx - 1 + n) % n;
    else if (act === 'next' && n) app.taskIdx = (app.taskIdx + 1) % n;
    else if (act === 'start') app.startTask(app.scheme.tasks[app.taskIdx]);
    else if (act === 'again' && tr.run) app.startTask(tr.run.task);
    else if (act === 'stop') tr.stopTask();
    else if (act === 'hint') { if (app.exam && app.exam.active()) this.banner('В экзамене подсказок нет.', 'warn'); else if (!tr.hint()) this.banner('Все эталонные шаги выполнены.', 'info'); }
    else if (act === 'exnext' && app.exam) app.exam.next();
    else if (act === 'ack') { if (!tr.ack()) this.banner('Сигналов нет.', 'info'); }
    else if (act === 'reset') { if (!tr.resetToNormal()) this.banner('Сначала завершите задание.', 'warn'); }
    else if (act === 'lock') { tr.opt.interlocks = !tr.opt.interlocks; app.toast(`Блокировки: ${tr.opt.interlocks ? 'включены' : 'выключены'}.`); }
    else if (act === 'exit') tr.exitTask();
    else if (act === 'pz') app.toggleTool('pz');
    else if (act === 'guide') { const on = app.permit.toggleGuide(); this.banner(`Подсказки мероприятий ${on ? 'включены' : 'выключены'}.`, 'info'); }
    else if (act === 'sguide') { app.setStepGuide(!app.stepGuide); this.banner(`Подсказки шагов ${app.stepGuide ? 'включены' : 'выключены'}.`, 'info'); }
    else if (act === 'goto') this.goNext();
    else if (act === 'mark') this.addMark('щит');
    else if (act === 'debug') this.toggleDebug();
    // на ноутбуке — карточка поверх 3D (закрывается «Понятно» или клавишей), в шлеме — панель перед глазами (закрывается курком)
    // на площадке — обучение «за руку» на задании (в шлеме — и панель управления перед глазами); в полигоне — карточка или панель
    else if (act === 'tutor') {
      const xr = this.renderer.xr.isPresenting;
      if (!this.room && this.coach.can()) { if (xr) this.showTutor(true); this.coach.start(); }
      else if (!xr) this.walk.intro(true); else this.showTutor(true);
    }
    app.renderSide();
    this.drawBoard();
  },
  // Справка о неизменяемом аппарате (трансформатор, шина, ТТ…): пешком — у прицела; в шлеме — табличка у аппарата на 6 с
  // и строка на щите (20 с); тост показывает приложение
  infoFx(text, id) {
    if (!this.active) return;
    if (this.fpsOn()) this.walk.said(text, false, 6000);
    if (!this.renderer.xr.isPresenting) return;
    this.boardInfo = { text, until: performance.now() + 20000 };
    this.drawBoard();
    const p = this.hitAt && this.hitAt.id === id && performance.now() - this.hitAt.t < 1500 ? this.hitAt.p.clone() : this.posOf(id);
    if (!p) return;
    const T = THREE, c = document.createElement('canvas'), x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    c.width = 900;
    x.font = F(500, 34);
    const lines = this.wrap(x, text, c.width - 60, 4);
    c.height = 40 + lines.length * 46;
    x.fillStyle = 'rgba(16,24,21,0.94)'; rr(x, 0, 0, c.width, c.height, 22); x.fill();
    x.fillStyle = '#ffffff'; x.font = F(500, 34);
    lines.forEach((l, i) => x.fillText(l, 30, 54 + i * 46));
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const w = 0.9, m = new T.Mesh(new T.PlaneGeometry(w, w * c.height / c.width), new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = 11; m.raycast = () => {};
    // у луча: в 1,6 м перед человеком в сторону аппарата (ближе, если аппарат ближе), чуть ниже глаз, лицом к человеку
    const cam = this.camera.getWorldPosition(new T.Vector3()), dir = p.clone().sub(cam).setY(0), dist = dir.length();
    if (dist < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    m.position.copy(cam).addScaledVector(dir, Math.min(1.6, Math.max(0.8, dist - 0.4))); m.position.y = clamp(cam.y - 0.12, 0.9, 2.4);
    m.lookAt(cam.x, m.position.y, cam.z);
    for (const f of this.fxList) if (f.panel) f.t = f.life;
    this.scene.add(m);
    this.fxList.push({ t: 0, life: 6, panel: m });
  },
  attachWrist(info) { info.grip.add(this.wrist.m); this.wrist.m.visible = true; this.drawWrist(); },
  drawWrist() {
    const { c, t } = this.wrist, x = c.getContext('2d'), tr = this.app.tr;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(16,24,21,0.9)'; rr(x, 0, 0, c.width, c.height, 22); x.fill();
    x.fillStyle = '#93a69e'; x.font = '500 22px "Golos Text", system-ui, sans-serif';
    let top = this.app.tool === 'check' ? 'Указатель напряжения включён' : this.app.tool === 'pz' ? 'ПЗ: курок по проводу или шине' : 'Курок — операция · боковая — указатель';
    // полигон: СИЗ и что в руках
    if (this.room) {
      const pp = this.app.permit.status().ppe, held = this.items ? [0, 1].map(h => this.items.heldIn(h)).filter(Boolean).map(id => this.items.list.get(id).it.title) : [];
      top = `Перчатки ${pp.gloves ? '✓' : '—'} · каска ${pp.helmet ? '✓' : '—'}${held.length ? ' · в руках: ' + held.join(', ') : ''}`;
    }
    // площадка с заданием: задание, следующий шаг (с подсказками), последняя ошибка (или последнее событие)
    const run = tr.run, g = !this.room && run && !run.done ? this.app.guideNext() : null;
    if (!this.room && run && !run.done) top = run.task.title;
    x.fillText(this.fit(x, top, c.width - 40), 20, 38);
    let y = 80, lines = 3;
    const cl = this.room ? null : this.coach.boardLine();
    if (g || cl) {
      x.fillStyle = '#ffd23f'; x.font = '600 24px "Golos Text", system-ui, sans-serif';
      this.wrap(x, cl || `Следующий: ${g.text} · B/Y — перейти`, c.width - 40, 2).forEach(l => { x.fillText(l, 20, y); y += 30; lines--; });
      y += 6;
    }
    const last = run && !run.done && run.errors.length ? run.errors[run.errors.length - 1] : null;
    const e = last ? { level: 'err', text: last.text } : tr.log[0];
    x.fillStyle = !e ? '#c6d3cd' : e.level === 'err' ? '#ff6b7d' : e.level === 'warn' ? '#f5b544' : e.level === 'ok' ? '#5ee08f' : '#eef4f1';
    x.font = '600 26px "Golos Text", system-ui, sans-serif';
    this.wrap(x, e ? e.text : 'Событий пока нет', c.width - 40, Math.max(1, lines)).forEach((l, i) => x.fillText(l, 20, y + i * 34));
    const err = Diag.pageErrors ? Diag.lastError() : null;
    if (err) { x.fillStyle = '#ff6b7d'; x.font = '600 20px "Golos Text", system-ui, sans-serif'; this.wrap(x, `Ошибка: ${err.msg}`, c.width - 40, 2).forEach((l, i) => x.fillText(l, 20, 206 + i * 24)); }
    t.needsUpdate = true;
  },
  // Баннер перед глазами в шлеме; why — «почему опасно» мельче под текстом (ошибка), баннер тогда выше и висит дольше
  banner(text, level, why) {
    if (!this.ready || !this.renderer.xr.isPresenting || !this.bannerH) return;
    const { c, m } = this.bannerH, x = c.getContext('2d'), F = (w, sz) => `${w} ${sz}px "Golos Text", system-ui, sans-serif`;
    x.font = F(600, 32);
    const main = this.wrap(x, text, c.width - 60, 3);
    x.font = F(400, 27);
    const sub = why ? this.wrap(x, 'Почему опасно: ' + why, c.width - 60, 4) : [];
    const H = Math.max(180, 30 + main.length * 42 + (sub.length ? 14 + sub.length * 34 : 0) + 18);
    // высота холста меняется — текстуру пересоздаём (в WebGL2 её размер неизменяем)
    if (c.height !== H) { c.height = H; this.bannerH.t.dispose(); this.bannerH.t = new THREE.CanvasTexture(c); this.bannerH.t.colorSpace = THREE.SRGBColorSpace; m.material.map = this.bannerH.t; m.scale.y = H / 180; m.position.y = -0.24 - (H - 180) / 180 * 0.176 / 2; }
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = level === 'err' ? 'rgba(200,20,45,0.92)' : level === 'warn' ? 'rgba(165,92,0,0.92)' : 'rgba(18,30,26,0.9)';
    rr(x, 0, 0, c.width, c.height, 24); x.fill();
    x.fillStyle = '#ffffff'; x.font = F(600, 32);
    main.forEach((l, i) => x.fillText(l, 30, 54 + i * 42));
    x.font = F(400, 27); x.fillStyle = '#ffe9ec';
    sub.forEach((l, i) => x.fillText(l, 30, 54 + main.length * 42 + 10 + i * 34));
    this.bannerH.t.needsUpdate = true;
    m.visible = true;
    this.bannerUntil = performance.now() + (why ? 9000 : level === 'err' ? 5500 : 3500);
  }
};

export { Board, rr };
