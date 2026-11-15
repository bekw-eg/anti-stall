# AntiStall — коллективная боталка с геймификацией

Многопользовательское веб-приложение для совместных занятий по технике Pomodoro (кейс олимпиады PROD).
Игроки собираются в комнате, запускают общий таймер, занимаются своими задачами и за завершённые сессии
получают опыт, Tomato Coins, улучшения и достижения. Завершённые сессии дают команде очки вклада и пополняют её
казну, а на перерывах команда тратит казну в Tower Wars «Аксолотли против Томатиков»: в режиме A/B одна команда
обороняется (башни, усиления), другая атакует её поле (томаты-наёмники, дебаффы); роли меняются каждый цикл. Узлы карты общего испытания (Road Map) открывают только победы в этой игре. На перерывах также доступны
помощь и дружеские пакости.

После фокуса игрок оценивает свою работу ★1–5: в конце перерыва команда получает бонус опыта и монет по средней оценке
(кто не ответил — считается как 3★). Чат комнаты открыт всегда. Первая страница (лендинг) открывается по логотипу, из неё
по аватарке — профиль: образ аксолотля, улучшения, достижения, история занятий и статистика. На стенде есть Swagger (`/api/docs`).

Все игровые правила проверяет сервер. Клиент отправляет только намерения («начать», «выйти из фокуса»,
«купить»), а время, награды и цены определяет backend.

## Документация для защиты

| Документ | Содержание |
|---|---|
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Сценарий показа жюри из 10 шагов, подготовка стенда, тайминги, запасные варианты |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Деплой на ВМ через Spirit CI: переменные, откат, диагностика |
| [backend/docs/API.md](backend/docs/API.md) | REST и WebSocket API; на стенде — Swagger: `/api/docs` (спецификация `/api/openapi.json`) |
| [backend/docs/DEMO_MODE.md](backend/docs/DEMO_MODE.md) | Демо-режим и песочница |
| [backend/docs/VOICE.md](backend/docs/VOICE.md) | Голосовой канал (WebRTC, STUN/TURN) |
| [backend/README.md](backend/README.md) | Архитектура backend и игровые правила |

`backend/README.md` написан на прошлых этапах, и часть цифр там устарела (например, число тестов и достижений).
Старые отчёты этапов (матрица требований, QA безопасности, итоговые отчёты) убраны из репозитория, чтобы не устаревали
и не тратили контекст ИИ-ассистентов; их копия хранится у команды локально.

## Структура репозитория

```
backend/              Node.js-сервер: REST, WebSocket, SQLite (node:sqlite), вся игровая логика
  src/                server.js, app.js, config.js (экономика и лимиты), catalog.js, db.js,
                      services/ (users, rooms, game, social, td), http/, ws/ (hub, voice), td/engine.js
  tests/              125 автотестов (node:test, управляемые часы)
  scripts/            demo.mjs, demo-seed.mjs, demo-bots.mjs, cheat-check.mjs, lib/client.mjs
  docs/               API.md, DEMO_MODE.md, VOICE.md
frontend/             Vite + React + TypeScript + Tailwind + Framer Motion
  src/tomato/         интерфейс (Welcome → Настройки → комната), useTomato.ts — всё серверное состояние
  src/api/tomato/     типизированный клиент REST и WebSocket
  Dockerfile          образ только frontend (vite preview); его сейчас собирает CI
e2e/                  сквозные сценарии в настоящем Chrome (playwright-core), запускаются вручную
deploy/               docker-compose.yml для единого образа (сервис app и демо-стенд с профилем demo)
Dockerfile            единый образ: собранный frontend раздаёт сам backend
.gitlab-ci.yml        CI/CD Spirit: сборка образа и деплой на ВМ
.claude/launch.json   конфигурации запуска для превью (frontend, backend-demo, fullstack-demo)
docs/                 документация для защиты
```

## Требования

- Node.js **>= 22.13** (`engines` в `backend/package.json`, нужен встроенный `node:sqlite`). Запуск демо-стенда и тесты ниже проверены на Node 22.22.2 под Windows 11; `npm ci` в этой сессии не перезапускался.
- npm. У backend одна runtime-зависимость, пакет `ws`.

## Установка

```bash
cd backend && npm ci
cd ../frontend && npm ci
```

## Запуск для разработки (два процесса)

```bash
# терминал 1: backend на http://localhost:8787, WebSocket /ws, БД backend/data/tomato.db
cd backend && npm start

# терминал 2: Vite dev-сервер на порту 4499 (frontend/package.json, скрипт dev)
cd frontend && npm run dev
```

Vite проксирует `/api` и `/ws` на `http://localhost:8787` (`frontend/vite.config.ts`). Другой адрес backend
задаётся переменной `VITE_BACKEND_URL`. Сам dev-режим в этой сессии не запускался: порт и прокси взяты из конфигурации.

Ускоренные демо-комнаты в dev-режиме: в терминале 1 вместо `npm start` выполнить `npm run start:demo`.

## Демо-стенд одной командой без Docker

Backend сам раздаёт собранный frontend, если задан `TOMATO_STATIC_DIR` (`backend/src/config.js:18`,
`backend/src/http/static.js`). API, WebSocket и интерфейс работают на одном порту.

```bash
cd frontend && npm run build        # собирает frontend/dist
```

Запуск из папки `backend/`:

**bash (Linux, macOS, Git Bash):**
```bash
TOMATO_STATIC_DIR=../frontend/dist PORT=8799 node --disable-warning=ExperimentalWarning src/server.js --demo
```

**Windows PowerShell** (переменные сохраняются до конца сессии PowerShell):
```powershell
$env:TOMATO_STATIC_DIR='..\frontend\dist'; $env:PORT='8799'; node --disable-warning=ExperimentalWarning src/server.js --demo
```

**Windows cmd:**
```bat
set TOMATO_STATIC_DIR=..\frontend\dist
set PORT=8799
node --disable-warning=ExperimentalWarning src\server.js --demo
```

После запуска интерфейс открывается на http://localhost:8799. Все три варианта проверены в этой сессии
(временная БД, ответы `/api/health` с `demoMode: true` и `GET /` с кодом 200). Флаг `--demo` равносилен `TOMATO_DEMO=1`
(`backend/src/config.js:9`). Если `TOMATO_DB` не задан, демо-сервер пишет в отдельный файл `backend/data/tomato-demo.db`
(`backend/src/config.js:15`), а не в рабочую БД `tomato.db`. Без флага `--demo` та же команда запускает обычный сервер.

В `.claude/launch.json` есть та же конфигурация под именем `fullstack-demo` (порт 8799).

Подготовка данных и боты для показа описаны в [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md):

```bash
cd backend
npm run demo:seed -- --api http://localhost:8799                  # 4 песочных аккаунта и демо-комната → data/demo-seed.json
npm run demo:bots -- --room КОД --bots 2 --api http://localhost:8799
npm run cheat-check -- --api http://localhost:8799                # 24 атаки на живой сервер, таблица PASS/FAIL
npm run demo -- --api http://localhost:8799                       # сквозной сценарий в консоли
```

## Docker (не проверено в этой сессии)

Docker Desktop на машине разработчика не был запущен, поэтому сборка образа и compose не проверялись.
Ниже описано, что задают файлы.

```bash
# единый образ: frontend собирается и раздаётся backend-ом, порт 3000, БД в томе /data (Dockerfile)
docker build -t tomato .
docker run -p 80:3000 -v tomato-data:/data tomato

# compose: сервис app (обычный режим, том tomato-data) — deploy/docker-compose.yml
docker compose -f deploy/docker-compose.yml up -d --build

# демо-стенд: сервис demo с профилем demo, TOMATO_DEMO=1, отдельный том tomato-demo-data, порт ${DEMO_PORT:-8081}
docker compose -f deploy/docker-compose.yml --profile demo up -d demo
```

Оба сервиса (`app` и `demo`) собираются из корневого `Dockerfile` (`--build`) или берут готовый образ `${IMAGE_NAME:-tomato:local}`.

CI (`.gitlab-ci.yml`) собирает этот же единый образ и из master деплоит на ВМ оба сервиса из `deploy/docker-compose.yml`
(основной стенд на 80, демо для жюри на 8081). CI-переменные, требования к ВМ, откат и диагностика — [docs/DEPLOY.md](docs/DEPLOY.md).

## Переменные окружения backend

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT`, `HOST` | `8787`, `0.0.0.0` | адрес сервера |
| `TOMATO_DB` | `backend/data/tomato.db`, в демо `tomato-demo.db` | файл SQLite |
| `TOMATO_DEMO=1` или флаг `--demo` | выкл. | демо-режим (песочница, ускоренные комнаты) |
| `TOMATO_STATIC_DIR` | нет | папка собранного frontend для раздачи с того же порта |
| `TOMATO_CORS_ORIGIN` | `*` | CORS |
| `TOMATO_STUN_URLS`, `TOMATO_TURN_URLS`, `TOMATO_TURN_SECRET`, `TOMATO_TURN_USERNAME`, `TOMATO_TURN_CREDENTIAL`, `TOMATO_VOICE_MAX_PEERS` | см. `backend/src/config.js:68-80` | голос |

## Тесты и проверки

| Команда | Результат последнего прогона |
|---|---|
| `cd backend && npm test` | 125 тестов, 125 прошли (около 61 с) |
| `cd frontend && npm test` | vitest: 11 файлов, 83 теста, все прошли |
| `cd frontend && npx tsc --noEmit -p tsconfig.app.json` | без ошибок |
| `cd frontend && npx eslint src` | 0 ошибок, 7 предупреждений `react-refresh` в `src/components/ui` (данные оркестратора, мной не перезапускалось) |
| `cd frontend && npm run build` | сборка проходит (данные оркестратора) |
| `cd backend && npm run cheat-check -- --api http://localhost:8799` | 24 из 24 атак отражены, около 7 с |
| `cd e2e && npm ci && npm run social` / `npm run voice` | сквозные сценарии в установленном Google Chrome, запускаются вручную: social 10 из 10, voice 11 из 11 (прогон оркестратора на этапе 6) |

Корневой `tsconfig.json` содержит только ссылки на проекты (`"files": []`), поэтому `tsc --noEmit` без `-p` ничего не проверяет.
Отдельные тестовые файлы backend можно запускать напрямую:
`node --disable-warning=ExperimentalWarning --test tests/security.test.js tests/sandbox.test.js` (23 теста).
