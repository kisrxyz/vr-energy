import { normalizeScheme } from '../core/elements.js';

/* ===== Мои схемы: список в хранилище браузера =====
   ts.mySchemes — оглавление [{ id, title, t }] (t — время изменения), ts.my.<id> — сама схема (JSON).
   Старый единственный слот ts.my («Моя схема» версии 0.2) переносится в список один раз (migrate).
   st — хранилище { get, set, del } (в браузере — store.js, в тестах — Map); set возвращает false, если не записалось. */
const K_LIST = 'ts.mySchemes', K_OLD = 'ts.my', key = id => 'ts.my.' + id;

function makeLibrary(st) {
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const lib = {
    list() {
      try {
        const l = JSON.parse(st.get(K_LIST) || '[]');
        return Array.isArray(l) ? l.filter(x => x && typeof x.id === 'string').map(x => ({ id: x.id, title: String(x.title || 'Схема'), t: +x.t || 0 })) : [];
      } catch (e) { return []; }
    },
    writeList(l) { return st.set(K_LIST, JSON.stringify(l)); },
    has(id) { return lib.list().some(x => x.id === id); },
    // Схема по id (проверенная и починенная) или null
    load(id) {
      const j = st.get(key(id));
      if (!j) return null;
      try { return normalizeScheme(JSON.parse(j)); } catch (e) { return null; }
    },
    save(id, s) {
      if (!st.set(key(id), JSON.stringify(s))) return false;
      const l = lib.list(), e = l.find(x => x.id === id), row = { id, title: String(s.title || 'Схема'), t: Date.now() };
      if (e) Object.assign(e, row); else l.push(row);
      return lib.writeList(l);
    },
    // Новая запись; id или null, если хранилище не приняло
    add(s) {
      const id = newId();
      if (!lib.save(id, s)) { st.del(key(id)); return null; }
      return id;
    },
    duplicate(id) {
      const s = lib.load(id);
      if (!s) return null;
      s.title = `${s.title} (копия)`;
      return lib.add(s);
    },
    rename(id, title) {
      const t = String(title || '').trim().slice(0, 80), s = lib.load(id);
      if (!t || !s) return false;
      s.title = t;
      return lib.save(id, s);
    },
    remove(id) {
      const l = lib.list();
      if (!l.some(x => x.id === id)) return false;
      st.del(key(id));
      return lib.writeList(l.filter(x => x.id !== id));
    },
    // Старый слот «Моя схема» → запись в списке; id новой записи или null, если переносить нечего
    migrate() {
      const j = st.get(K_OLD);
      if (j == null) return null;
      let s;
      try { s = normalizeScheme(JSON.parse(j)); } catch (e) { st.del(K_OLD); return null; }
      const id = lib.add(s);
      if (id) st.del(K_OLD);
      return id;
    },
  };
  return lib;
}

export { makeLibrary };
