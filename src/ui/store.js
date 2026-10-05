/* Хранилище браузера: может быть недоступно — тогда молча работаем без него */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } },
};

export { store };
