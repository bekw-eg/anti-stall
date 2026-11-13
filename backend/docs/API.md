# Tomato API

Базовый URL: `http://localhost:8787`. Формат — JSON. Время — миллисекунды Unix (серверные часы).

## Авторизация

`POST /api/users {"name":"Лотти"}` → `{ user, token }`. Токен показывается **один раз**, на сервере хранится
только SHA-256. Дальше: `Authorization: Bearer <token>`. Идентичность игрока берётся из токена;
любые `userId`/`senderId` в теле запроса — только цель действия и никогда не «кто действует».
Для WebSocket: первым сообщением `{"type":"auth","token":"…"}` (токен не попадает в URL/логи).

## Ошибки

```json
{ "error": { "code": "WRONG_PHASE", "message": "…", "details": { "phase": "focus" } } }
```

| HTTP | Коды |
|---|---|
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_FIELD`, `SELF_TARGET`, `UNKNOWN_HELP_TYPE`, `UNKNOWN_PRANK_TYPE`, `INVALID_AMOUNT` |
| 401 | `UNAUTHORIZED` |
| 403 | `NOT_A_MEMBER`, `NOT_HOST`, `DEMO_DISABLED`, `UPGRADE_LOCKED` |
| 404 | `NOT_FOUND`, `ROOM_NOT_FOUND`, `NO_ACTIVE_SESSION`, `SESSION_NOT_FOUND`, `TARGET_NOT_IN_ROOM`, `UPGRADE_NOT_FOUND` |
| 405/413 | `METHOD_NOT_ALLOWED`, `BODY_TOO_LARGE` |
| 409 | `WRONG_PHASE`, `ALREADY_FOCUSING`, `FOCUS_ACTIVE`, `SESSION_ACTIVE`, `ROOM_CLOSED`, `ROOM_FULL`, `TOO_MANY_ROOMS`, `INSUFFICIENT_FUNDS`, `STALE_LEVEL`, `MAX_LEVEL`, `DUPLICATE_OPERATION`, `ALREADY_SENT`, `EFFECT_ACTIVE`, `PRANKS_DISABLED`, `PRANKS_DISABLED_SELF`, `TARGET_FOCUSING` |
| 429 | `PRANK_COOLDOWN` (`details.retryAfterMs`), `PRANK_BREAK_LIMIT`, `HELP_DAILY_LIMIT` |
| 500 | `INTERNAL` |

## REST

Все маршруты, кроме отмеченных 🔓, требуют токен.

### Служебные
| Метод | Путь | Описание |
|---|---|---|
| GET 🔓 | `/api/health` | `{status, serverTime, demoMode}` |
| GET 🔓 | `/api/config` | Экономика, лимиты, каталог улучшений/достижений, Road Map, правила присутствия |
| POST | `/api/heartbeat` | Подтверждает присутствие, возвращает `serverTime` |

### Пользователь
| Метод | Путь | Описание |
|---|---|---|
| POST 🔓 | `/api/users` | Регистрация: `{name}` → 201 `{user, token}` |
| GET | `/api/users/me` | Профиль: `id,name,level,xp,coins,prankEnabled,activeSession,rooms[]` |
| PATCH | `/api/users/me` | `{name?, prankEnabled?}` (остальные поля игнорируются) |
| GET | `/api/users/me/progress` | XP, уровень, монеты, улучшения, достижения, эффекты, статистика |
| GET | `/api/users/me/sessions?limit&offset` | История занятий: задача, статус, результат, награды |
| GET | `/api/users/me/achievements` | Список достижений |
| GET | `/api/users/me/upgrades` | Каталог улучшений игрока (`canBuy`, `nextCost`) |
| POST | `/api/users/me/upgrades/:id/purchase` | `{expectedLevel?}` → `{upgradeId, level, cost, balance}` |
| GET | `/api/users/me/transactions?limit` | Журнал начислений/трат |

### Комнаты
| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | `/api/rooms` | любой | `{name?, focusMinutes?, breakMinutes?}` (демо: `demo:true, focusSeconds, breakSeconds`) → 201 снимок |
| POST | `/api/rooms/join` | любой | `{code}` |
| GET | `/api/rooms/:id` | участник | Снимок состояния (:id — id или код) |
| POST | `/api/rooms/:id/join` | любой | Идемпотентно |
| POST | `/api/rooms/:id/leave` | участник | Досрочно завершает вашу сессию; хост передаётся |
| PATCH | `/api/rooms/:id/settings` | host, `waiting` | `{focusMinutes?, breakMinutes?, name?}` |
| POST | `/api/rooms/:id/task` | участник, не в сессии | `{title}` — личная учебная задача |
| POST | `/api/rooms/:id/start` | host, `waiting` | Запуск Focus. Ответ содержит `start.participants` и `start.skipped[]` (`offline`, `busy_elsewhere`) |
| POST | `/api/rooms/:id/session/abort` | участник, `focus` | Досрочно завершить **свою** сессию (без награды) |
| POST | `/api/rooms/:id/session/result` | участник | `{result:"done"|"partial"|"not_done", note?, sessionId?}` — только история |
| POST | `/api/rooms/:id/skip-break` | host, `break` | Досрочно к `waiting` |
| POST | `/api/rooms/:id/close` | host, `waiting|break` | Закрыть комнату |
| POST | `/api/rooms/:id/heartbeat` | участник | Присутствие |
| GET | `/api/rooms/:id/roadmap` | участник | Road Map и прогресс |
| GET | `/api/rooms/:id/game` | участник | Производные игровые параметры (база, башни) — **preview** под будущую Tower Defense |
| GET | `/api/rooms/:id/social` | участник | Последние 30 соц-действий |
| POST | `/api/rooms/:id/social/help` | участник, `break` | `{targetUserId, type:"boost"|"shield"}` |
| POST | `/api/rooms/:id/social/prank` | участник, `break` | `{targetUserId, type:"fog"|"sticker"}` |

### Снимок комнаты (`room_state`, ответ `GET /api/rooms/:id`)

```jsonc
{
  "room": { "id","code","name","hostId","phase":"waiting|focus|break|completed","cycleId","cycleNo","demo",
            "settings":{"focusSec","breakSec"},"phaseStartedAt","phaseEndsAt","serverTime","remainingMs" },
  "members": [{ "userId","name","role","level","team","task",
                "status":"waiting|focusing|finished|aborted|abandoned|spectating|resting",
                "connection":"online|reconnecting|offline","prankEnabled","contribution",
                "session":{"id","status","rewarded"}|null }],
  "challenge": { /* Road Map: points, goal, completed, positionNodeId, nodes[], edges[], contributions[] */ },
  "me": { "userId","isHost","status","task","session","level","xp","coins","effects[]",
          "allowedActions": ["set_task","start_focus","abort_session","help","prank","buy_upgrade",…] }
}
```

## WebSocket `ws://host/ws`

Конверт сервера: `{ "type", "ts" (серверное время), "roomId"?, "reqId"?, "data" }`.

### Клиент → сервер (разрешено только это)
| type | Поля | Ответ |
|---|---|---|
| `auth` | `token` | `hello {user, serverTime, graceMs}`; при ошибке `error UNAUTHORIZED` + закрытие (4401) |
| `subscribe` | `roomId` | `room_joined`, затем `room_state`; только участникам (`NOT_A_MEMBER`) |
| `unsubscribe` | `roomId` | `unsubscribed` |
| `heartbeat` / `ping` | — | `heartbeat_ack {serverTime}`; обновляет присутствие |

Любое другое событие (`give_me_coins`, `complete_session`, `start_timer`…) → `error UNKNOWN_EVENT`.
Эхо `reqId` возвращается в ответе/ошибке. Лимит 30 сообщений/с, 16 КБ. Без `auth` за 5 с соединение закрывается.
Сервер сам пингует соединения каждые 5 с (pong тоже считается присутствием).

### Сервер → клиент
Рассылка комнате (подписчикам):

| type | data |
|---|---|
| `room_state` | полный снимок (персонализированный) — после каждого значимого изменения |
| `player_joined` / `player_left` | `{user}` / `{userId}` |
| `host_changed` | `{hostId}` |
| `player_status_changed` | `{userId, status, reason}` или `{userId, connection}` |
| `task_updated`, `settings_changed` | `{userId, task}`, `{focusSec, breakSec}` |
| `timer_started` | `{cycleId, cycleNo, phase, phaseStartedAt, phaseEndsAt, serverTime, participants[], skipped[]}` |
| `timer_tick` | раз в секунду: `{phase, cycleId, phaseEndsAt, remainingMs, serverTime}` — только для сверки часов |
| `phase_changed` | `{from, to, cycleId, phaseStartedAt, phaseEndsAt, completed?, rewarded?}` |
| `roadmap_updated` | Road Map целиком (+ `pointsBefore`) |
| `challenge_completed` | `{roadmapId, reward, contributors[]}` |
| `help_applied` | `{actionId, type, from, to, cost, xpBonusPct?, expiresAt, at}` |
| `prank_applied` | `{actionId, type, from, to, blocked, effectEndsAt, at}` |

Личные (всем соединениям игрока):

| type | data |
|---|---|
| `session_completed` | `{sessionId, roomId, status:"completed|aborted|abandoned", rewarded, xp, coins, capped?, boostPct?, reason?}` |
| `reward_granted` | `{kind:"focus_session|achievement|team_challenge", key, xp, coins, balance, level, levelUp}` |
| `balance_changed` | `{kind, coins, balance}` — траты (покупка, «Щит») |
| `achievement_unlocked` | `{id, title, description, reward}` |

Серверные проверки: авторизация по токену, членство в комнате, фаза, лимиты, идемпотентность — для каждого действия
(см. таблицу ошибок выше). События доставляются только после успешного COMMIT.
