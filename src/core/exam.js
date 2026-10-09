/* ===== Экзамен с протоколом: логика без DOM (окна и панель — src/ui/exam.js) =====
   Экзаменатор выбирает схему, 1–3 задания, вид (меняет только заголовок протокола), блокировки, лимит времени и порог.
   Экзаменуемый — ФИО, должность, подразделение, предприятие: хранится только в этом браузере.
   Запись экзамена: { id, no, kind, t0, t1, status, person, scheme, interlocks, limitMin, minScore, tasks: [{ id, title }],
   results: [результат задания или null — не начато], timeUp? }; status: running | passed | failed | aborted.
   Итог «сдал»: все задания выполнены, без аварий и КЗ, балл каждого не ниже minScore (по умолчанию 80).
   TODO преподаватель: какой порог «сдано» принят на предприятиях и по какой форме протокол (docs/questions-for-teacher.md, 0.4).
   Журнал: ts.exams — оглавление [{ id, no, t, fio, kind, status, scheme }], ts.exam.<id> — запись; повреждённая запись
   в списке помечена, её можно только удалить (как в «Моих схемах»). */

const EXAM_KINDS = { skills: 'Проверка навыков переключений', drill: 'Противоаварийная тренировка' };
const STATUS = { running: 'идёт', passed: 'Сдал', failed: 'Не сдал', aborted: 'Прерван' };
const KIND_NAME = { accident: 'Авария', kz: 'КЗ', blocked: 'Блокировка', supply: 'Перерыв питания', proc: 'Порядок', safety: 'Охрана труда' };
const MIN_SCORE = 80;
const MAX_TASKS = 3;
const pad = n => String(n).padStart(2, '0');
const fmtSecs = s => { s = Math.max(0, Math.round(+s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); };
const fmtDate = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtClock = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
// «Авария: …» — вид ошибки не повторяем, если текст им уже начинается
const SAME = { proc: 'Нарушение порядка' };
const errLine = e => { const k = KIND_NAME[e.kind] || e.kind, t = String(e.text || ''); return t.startsWith(k + ':') || (SAME[e.kind] && t.startsWith(SAME[e.kind] + ':')) ? t : `${k}: ${t}`; };

// Номер протокола: ГГГГММДД-NN, NN — следующий за последним номером этого дня в журнале
function protoNo(t, list = []) {
  const day = dayKey(t);
  let n = 0;
  for (const x of list) { const m = /^(\d{8})-(\d+)$/.exec(String(x && x.no || '')); if (m && m[1] === day) n = Math.max(n, +m[2]); }
  return `${day}-${pad(n + 1)}`;
}

// Новый экзамен (ещё без номера: номер даёт журнал при записи)
function newExam(cfg, t = Date.now()) {
  const p = cfg.person || {};
  const lim = +cfg.limitMin, min = cfg.minScore == null || cfg.minScore === '' ? MIN_SCORE : +cfg.minScore;
  return {
    id: 'x' + t.toString(36) + Math.random().toString(36).slice(2, 6), no: '', kind: EXAM_KINDS[cfg.kind] ? cfg.kind : 'skills',
    t0: t, t1: null, status: 'running',
    person: { fio: String(p.fio || '').trim(), post: String(p.post || '').trim(), dept: String(p.dept || '').trim(), org: String(p.org || '').trim() },
    scheme: { title: String(cfg.schemeTitle || 'Схема'), source: String(cfg.source || '') },
    interlocks: cfg.interlocks !== false, limitMin: lim > 0 ? Math.round(lim) : null,
    minScore: Math.max(0, Math.min(100, isFinite(min) ? Math.round(min) : MIN_SCORE)),
    tasks: (cfg.tasks || []).slice(0, MAX_TASKS).map(x => ({ id: String(x.id), title: String(x.title || 'Задание') })),
    results: [],
  };
}

// Результат задания из прогона движка (run после finish)
function taskResult(run) {
  const g = run.grade || {};
  return {
    title: String(run.task.title || ''), score: +g.score || 0, secs: +g.secs || 0, completed: !!run.completed,
    verdict: String(g.verdict || ''), acc: +g.acc || 0,
    errors: (run.errors || []).map(e => ({ kind: e.kind, text: String(e.text || ''), t: +e.t || 0 })),
    // замечания (полигон: проверка без самопроверки указателя) — в протоколе, на итог не влияют
    remarks: (run.remarks || []).map(r => String(r.text || '')),
  };
}

// Почему не сдал (пусто — сдал)
function failReasons(x) {
  const out = [];
  x.tasks.forEach((t, i) => {
    const r = x.results[i], n = `задание ${i + 1}`;
    if (!r) { out.push(`${n} не начато`); return; }
    if (r.acc) out.push(`${n}: авария или КЗ`);
    if (!r.completed) out.push(`${n} не выполнено`);
    else if (r.score < x.minScore) out.push(`${n}: ${r.score} баллов — ниже ${x.minScore}`);
  });
  if (x.timeUp) out.unshift('время вышло');
  return out;
}
// Итог: прерван, если прервали; иначе сдал / не сдал по порогу
function examStatus(x) { return x.status === 'aborted' ? 'aborted' : failReasons(x).length ? 'failed' : 'passed'; }
function finishExam(x, t = Date.now(), aborted = false) {
  x.t1 = t;
  x.status = aborted ? 'aborted' : examStatus(Object.assign({}, x, { status: 'running' }));
  return x;
}

// Протокол как данные: заголовок, поля, строки заданий, итог — для окна, печати и проверки (без «undefined» и пустых полей)
function protocol(x) {
  const dash = '—', p = x.person || {};
  const rows = x.tasks.map((t, i) => {
    const r = x.results[i];
    if (!r) return { n: i + 1, title: t.title, score: dash, time: dash, errors: 'не начато', result: 'не начато' };
    const errs = r.errors.map(e => errLine(e).replace(/\.$/, ''));
    return {
      n: i + 1, title: t.title, score: String(r.score), time: fmtSecs(r.secs),
      errors: (errs.length ? errs.slice(0, 4).join('; ') + (errs.length > 4 ? `; ещё ${errs.length - 4}` : '') : 'нет') + ((r.remarks || []).length ? `; замечаний: ${r.remarks.length} (без самопроверки указателя)` : ''),
      result: r.completed ? (r.acc ? 'авария' : r.score >= x.minScore ? 'выполнено' : 'ниже порога') : 'не завершено',
    };
  });
  const st = x.status === 'running' ? examStatus(x) : x.status;
  return {
    title: `Протокол № ${x.no || dash}`,
    kind: EXAM_KINDS[x.kind] || EXAM_KINDS.skills,
    fields: [
      ['Дата', fmtDate(x.t0)],
      ['Время', `${fmtClock(x.t0)}–${x.t1 ? fmtClock(x.t1) : dash}`],
      ['Экзаменуемый', p.fio || dash],
      ['Должность', p.post || dash],
      ['Подразделение', p.dept || dash],
      ['Предприятие', p.org || dash],
      ['Схема', x.scheme && x.scheme.title || dash],
      ['Условия', `блокировки ${x.interlocks ? 'включены' : 'выключены'}; ${x.limitMin ? `лимит времени ${x.limitMin} мин` : 'без лимита времени'}; подсказок и эталона нет`],
      ['Порог «сдано»', `все задания выполнены, без аварий и КЗ, балл каждого не ниже ${x.minScore}`],
    ],
    rows,
    status: st,
    verdict: STATUS[st] || dash,
    reasons: st === 'aborted' ? ['экзамен прерван'] : failReasons(x),
    signs: ['Экзаменуемый', 'Председатель комиссии', 'Член комиссии', 'Член комиссии'],
    note: 'Предварительная форма — не заменяет протокол по форме предприятия.',
  };
}
// Протокол текстом (копировать, проверить)
function protocolText(x) {
  const P = protocol(x);
  return [
    P.title, `${P.kind} на тренажёре оперативных переключений`, '',
    ...P.fields.map(([k, v]) => `${k}: ${v}`), '',
    ...P.rows.map(r => `${r.n}. ${r.title} — ${r.result}; баллы: ${r.score}; время: ${r.time}; ошибки: ${r.errors}`), '',
    `Итог: ${P.verdict}${P.reasons.length && P.status !== 'passed' ? ' (' + P.reasons.join('; ') + ')' : ''}`, '',
    ...P.signs.map(s => `${s}: ____________________ / ____________________ /`), '',
    P.note,
  ].join('\n');
}

// CSV для русского Excel: разделитель «;», UTF-8 с BOM, строки через CRLF, кавычки и переносы экранированы
const CSV_COLS = ['№ протокола', 'Дата', 'Начало', 'Окончание', 'Вид', 'ФИО', 'Должность', 'Подразделение', 'Предприятие', 'Схема',
  'Заданий', 'Выполнено', 'Баллы', 'Ошибок', 'Итог'];
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function examsCSV(list) {
  const rows = [CSV_COLS];
  for (const x of list) {
    if (!x) continue;
    const p = x.person || {}, res = x.results || [];
    rows.push([x.no, fmtDate(x.t0), fmtClock(x.t0), x.t1 ? fmtClock(x.t1) : '', EXAM_KINDS[x.kind] || '', p.fio, p.post, p.dept, p.org,
      x.scheme && x.scheme.title, (x.tasks || []).length, res.filter(r => r && r.completed).length,
      (x.tasks || []).map((t, i) => res[i] ? res[i].score : '—').join(' / '), res.reduce((n, r) => n + (r ? r.errors.length : 0), 0),
      STATUS[x.status] || '']);
  }
  return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// Журнал экзаменов в хранилище браузера. st — { get, set, del } (store.js или Map в тестах)
const K_LIST = 'ts.exams', key = id => 'ts.exam.' + id;
function makeExamLog(st) {
  const log = {
    list() {
      try {
        const l = JSON.parse(st.get(K_LIST) || '[]');
        return Array.isArray(l) ? l.filter(x => x && typeof x.id === 'string').map(x => ({
          id: x.id, no: String(x.no || ''), t: +x.t || 0, fio: String(x.fio || ''), kind: EXAM_KINDS[x.kind] ? x.kind : 'skills',
          status: STATUS[x.status] ? x.status : 'aborted', scheme: String(x.scheme || ''),
        })) : [];
      } catch (e) { return []; }
    },
    // Запись по id или null (нет или повреждена)
    load(id) {
      const j = st.get(key(id));
      if (!j) return null;
      try {
        const x = JSON.parse(j);
        return x && typeof x === 'object' && Array.isArray(x.tasks) && Array.isArray(x.results) && x.person ? x : null;
      } catch (e) { return null; }
    },
    // Сохранить (новая запись получает номер протокола); false — хранилище не приняло
    save(x) {
      const l = log.list();
      if (!x.no) x.no = protoNo(x.t0, l);
      if (!st.set(key(x.id), JSON.stringify(x))) return false;
      const row = { id: x.id, no: x.no, t: x.t0, fio: x.person.fio, kind: x.kind, status: x.status, scheme: x.scheme.title };
      const i = l.findIndex(r => r.id === x.id);
      if (i >= 0) l[i] = row; else l.push(row);
      return st.set(K_LIST, JSON.stringify(l));
    },
    remove(id) {
      st.del(key(id));
      return st.set(K_LIST, JSON.stringify(log.list().filter(r => r.id !== id)));
    },
    // Экзамен, который шёл, когда страницу закрыли или перезагрузили, — «прерван»
    abortRunning(t = Date.now()) {
      const out = [];
      for (const r of log.list()) {
        if (r.status !== 'running') continue;
        const x = log.load(r.id);
        if (!x) { const l = log.list().map(q => q.id === r.id ? Object.assign(q, { status: 'aborted' }) : q); st.set(K_LIST, JSON.stringify(l)); continue; }
        finishExam(x, t, true);
        x.interrupted = true;
        log.save(x);
        out.push(x);
      }
      return out;
    },
    csv() { return examsCSV(log.list().map(r => log.load(r.id)).filter(Boolean)); },
  };
  return log;
}

export { EXAM_KINDS, STATUS, MIN_SCORE, MAX_TASKS, protoNo, newExam, taskResult, failReasons, examStatus, finishExam, protocol, protocolText, csvCell, examsCSV, CSV_COLS, makeExamLog, errLine, fmtSecs };
