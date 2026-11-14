# AntiStall — заметки для ИИ-ассистентов

Коллективный Pomodoro с игрой на перерывах (Tower Defense, команды A/B, карта, голос, чат). Язык кода и комментариев — русский.

## Где что
- `backend/src` — Node 22+ (`node:sqlite`, `ws`), без фреймворков. Правила и экономика: `config.js`, `catalog.js`, `services/*.js` (rooms — фазы и таймер, game — награды и карта, td — Tower Defense, social — помощь/шутки, chat).
- `frontend/src/tomato` — React + Vite + Tailwind. Экраны: `screens/` (Landing, JoinScreen, Lobby, FocusRoom, BreakRoom, RoomChrome). Состояние и API: `useTomato.ts`, `api/tomato/`.
- `backend/docs/API.md` — REST/WS; `docs/DEPLOY.md` — деплой; `docs/FIXES_STAGES.md` — текущий план правок.

## Экономим контекст
- Не читать: `frontend/package-lock.json`, `backend/package-lock.json`, `node_modules/`, `dist/`, `backend/data/`, `e2e/artifacts/`, `*.png`.
- Большие файлы (`TowerDefense.tsx`, `tdCanvas.ts`, `services/td.js`, `rooms.js`, `game.js`, `useTomato.ts`) — читать нужный фрагмент (grep → offset/limit), а не целиком.
- Тесты backend идут минутами: запускать один нужный файл, а не весь набор, и выводить только итог:
  `cd backend && node --test --test-reporter=tap tests/<файл>.test.js | grep -E "^# (pass|fail)|not ok"`.
- Frontend: `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run` (быстро).

## Правила
- Таймер, награды и игровые действия решает сервер; клиент только показывает (защита от накрутки — требование кейса).
- `master` защищён: работа в ветках, слияние через MR.
