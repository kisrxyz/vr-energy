# Тренажёр переключений — демо-бета 0.5

## Первый запуск (Windows)
1. Установи Node.js LTS: https://nodejs.org (кнопка LTS, всё по умолчанию).
2. Открой эту папку в VS Code: «Файл → Открыть папку».
3. Терминал (Ctrl+`) → `npm install` → `npm run dev`.
4. Открой ссылку из терминала (http://localhost:5173).

## Работа с Claude Code
В терминале VS Code в этой папке: `claude`. Он сам прочитает `CLAUDE.md` — там карта проекта и правила.
Пиши ему задачи по-русски, например: «добавь указатель напряжения в VR на левую руку».

## Проверка в шлеме Quest без выкладки
1. Компьютер и шлем в одной Wi-Fi сети.
2. `npm run dev:vr` — в терминале будет адрес вида `https://192.168.x.x:5173`.
3. Открой его в браузере шлема → предупреждение о сертификате → «Продолжить» → вкладка «3D и VR» → «Войти в VR».

## Выкладка на GitHub Pages (постоянная ссылка)
1. Создай пустой репозиторий на github.com, например `vr-energy`.
2. В терминале:
   ```
   git init
   git add .
   git commit -m "Тренажёр 0.1"
   git branch -M main
   git remote add origin https://github.com/ЛОГИН/vr-energy.git
   git push -u origin main
   ```
3. На GitHub: Settings → Pages → Source: **GitHub Actions**.
4. Через 1–2 минуты сайт будет на `https://ЛОГИН.github.io/vr-energy/`. Дальше каждый `git push` обновляет его сам.
