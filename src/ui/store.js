/* Хранилище браузера: может быть недоступно или переполнено — тогда молча работаем без него.
   set возвращает false, если записать не удалось (например, кончилось место) — «Мои схемы» об этом предупреждают. */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } },
};

export { store };
