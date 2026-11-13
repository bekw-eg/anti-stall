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
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_FIELD`, `INVALID_SLOT`, `UNKNOWN_TOWER`, `SELF_TARGET`, `UNKNOWN_HELP_TYPE`, `UNKNOWN_PRANK_TYPE`, `INVALID_AMOUNT` |
| 401 | `UNAUTHORIZED` |
| 403 | `NOT_A_MEMBER`, `NOT_HOST`, `DEMO_DISABLED`, `UPGRADE_LOCKED`, `STAGE_LOCKED` |
| 404 | `NOT_FOUND`, `ROOM_NOT_FOUND`, `NO_ACTIVE_SESSION`, `SESSION_NOT_FOUND`, `TARGET_NOT_IN_ROOM`, `UPGRADE_NOT_FOUND`, `STAGE_NOT_FOUND`, `NO_TOWER` |
| 405/413 | `METHOD_NOT_ALLOWED`, `BODY_TOO_LARGE` |
| 409 | `WRONG_PHASE`, `ALREADY_FOCUSING`, `FOCUS_ACTIVE`, `SESSION_ACTIVE`, `ROOM_CLOSED`, `ROOM_FULL`, `TOO_MANY_ROOMS`, `INSUFFICIENT_FUNDS`, `STALE_LEVEL`, `MAX_LEVEL`, `DUPLICATE_OPERATION`, `ALREADY_SENT`, `EFFECT_ACTIVE`, `PRANKS_DISABLED`, `PRANKS_DISABLED_SELF`, `TARGET_FOCUSING`, `NOT_TEAM_MODE`, `NOT_TEAMMATE`, `SLOT_TAKEN`, `ROUND_EXISTS`, `TOO_LATE` |
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
| POST | `/api/rooms` | любой | `{name?, focusMinutes?, breakMinutes?, teamMode?}` (`teamMode:true` — Team A против Team B) (демо: `demo:true, focusSeconds, breakSeconds`) → 201 снимок |
| POST | `/api/rooms/join` | любой | `{code}` |
| GET | `/api/rooms/:id` | участник | Снимок состояния (:id — id или код) |
| POST | `/api/rooms/:id/join` | любой | Идемпотентно |
| POST | `/api/rooms/:id/leave` | участник | Досрочно завершает вашу сессию; хост передаётся |
| PATCH | `/api/rooms/:id/settings` | host, `waiting` | `{focusMinutes?, breakMinutes?, name?}` |
| POST | `/api/rooms/:id/team` | участник, `waiting`, режим Team A/B | `{team:"A"|"B"}` — сменить команду до старта цикла |
| POST | `/api/rooms/:id/task` | участник, не в сессии | `{title}` — личная учебная задача |
| POST | `/api/rooms/:id/start` | host, `waiting` | Запуск Focus. Ответ содержит `start.participants` и `start.skipped[]` (`offline`, `busy_elsewhere`) |
| POST | `/api/rooms/:id/session/abort` | участник, `focus` | Досрочно завершить **свою** сессию (без награды) |
| POST | `/api/rooms/:id/session/result` | участник | `{result:"done"|"partial"|"not_done", note?, sessionId?}` — только история |
| POST | `/api/rooms/:id/skip-break` | host, `break` | Досрочно к `waiting` |
| POST | `/api/rooms/:id/close` | host, `waiting|break` | Закрыть комнату |
| POST | `/api/rooms/:id/heartbeat` | участник | Присутствие |
| GET | `/api/rooms/:id/roadmap` | участник | Road Map и прогресс |
| GET | `/api/rooms/:id/game` | участник | Производные параметры базы/башен (устарело; полное состояние — `/td`) |
| GET | `/api/rooms/:id/td` | участник | Состояние мини-игры Tower Defense (`enabled` только на `break`) |
| POST | `/api/rooms/:id/td/join` | участник, `break` | Зафиксировать участие в игре этого перерыва |
| POST | `/api/rooms/:id/td/start` | участник, `break` | `{stageId?}` — начать раунд команды (один за перерыв) |
| POST | `/api/rooms/:id/td/build` | участник, `break` | `{slotId, type, requestId}` — построить башню за свои Tomato Coins |
| POST | `/api/rooms/:id/td/upgrade` | участник, `break` | `{slotId, requestId, expectedLevel?}` — улучшить башню (до 3 уровня) |
| GET | `/api/rooms/:id/social` | участник | Последние 30 соц-действий |
| POST | `/api/rooms/:id/social/help` | участник, `break` | `{targetUserId, type:"boost"|"shield"}` |
| POST | `/api/rooms/:id/social/prank` | участник, `break` | `{targetUserId, type:"fog"|"sticker"}` |

### Road Map (`GET /api/rooms/:id/roadmap`, `snapshot.challenge`, событие `roadmap_updated`)
Всё считает сервер; клиент только рисует.
```jsonc
{ "roadmapId","title","mode":"shared|teams","teamKey":"shared|A|B","points","goal",
  "completed": /* эта команда победила */, "finished": /* дошла до цели */, "winner": null|"A"|"B"|"draw", "completedAt","reward":{"xp","coins"},
  "positionNodeId": "forest",                       // где команда сейчас
  "next":    { "nodeId","title","pointsNeeded" } | null,   // следующий этап
  "segment": { "from","to","progress": 0..1 } | null,      // доля пути до следующего узла
  "teams":   [{ "key","name","points","positionNodeId","finished","completed" }],  // shared: одна; teams: A и B на одной карте
  "nodes":   [{ "id","title","x","y","type","requiredPoints","status":"completed|current|next|locked",
                "reachedAt": ms|null, "reward": {"xp","coins"}|null, "progress": 0..1 }],
  "edges":   [["camp","forest"], …],
  "contributions": [{ "userId","name","points", "team" /* только в режиме teams */ }] }
// В режиме teams верхний уровень (points, nodes[].status, next, segment…) — для команды зрителя, `teams[]` — для обеих.
```
Правила: очко команде даёт каждая **награждённая** фокус-сессия; когда очки пересекают порог узла, сервер фиксирует
`reachedAt` (таблица `team_nodes`), выдаёт участникам с вкладом этапную награду (+25 XP, +10 монет, ключ
`node:<room>:<team>:<node>` — один раз) и шлёт `node_reached`. Финальный узел вместо этапной даёт командную награду.
Клиент не может ни добавить очки, ни сменить позицию: таких маршрутов нет.

**Командный режим (`teamMode:true`).** Игроки автоматически делятся на A и B (новичок — в команду с меньшим числом игроков),
до старта цикла команду можно сменить. Очко получает команда игрока, чья сессия завершилась с наградой; этапы и их награды
считаются по каждой команде отдельно. Побеждает команда, первой набравшая цель (при одновременном финише — у кого больше очков,
при равенстве — ничья): командную награду получают только победители и только один раз. Помощь — только своей команде,
пакости можно слать и сопернику.

### Tower Defense на перерывах (`GET /api/rooms/:id/td`)
Мини-игра встроена в учебный цикл: **доступна только в фазе Break**, раунд принадлежит перерыву. Всё решает сервер.
```jsonc
{ "enabled": true,                 // false вне перерыва
  "phase","mode","team":"shared|A|B","breakEndsAt","serverTime",
  "map": { "cols","rows","path":[[x,y],…],"slots":[{"id","x","y"}],"pathLength" },   // координаты в клетках
  "towerTypes": [{ "id":"arrow|cannon|frost","title","cost","range","damage","cooldown","upgradeCosts":[l2,l3] }],
  "enemyTypes": [...], "maxLevel": 3,
  "stages": [{ "id","title","node","nodeTitle","unlocked","reward","waves","enemies","wins","bestHpLeft" }],
  "defaultStageId", "base": { "hpMax","damageMult","wallLevels","powerLevels" },   // из улучшений игроков команды
  "towers": [{ "slot","type","level","ownerId","ownerName" }],
  "round": { "id","stageId","status":"running|won|lost|expired","endsAt","speed","t","wave","waves","spawned","total",
             "hp","hpMax","kills","leaked","enemies":[{"id","type","x","y","hp","maxHp","slowed"}],"result" } | null,
  "rival": { "team","towers","round" } | null,      // только в командном режиме
  "duel": { "stageId","winner","scores" } | null, "me": { "coins","participated" } }
```
Правила (проверяет сервер): башня стоит монет строителя из каталога (лучник 15, мороз 20, пушка 30; улучшение 80%/120% цены);
место должно быть свободным; `requestId` делает постройку идемпотентной (повтор не списывает монеты второй раз);
этапы открываются узлами Road Map команды (`camp` — всегда, `forest`, `bridge`, `fortress` — после прохождения узла); раунд один
на команду за перерыв и ограничен перерывом (при коротком перерыве игра идёт быстрее, но не медленнее реального времени);
когда перерыв заканчивается (или host пропускает его / закрывает комнату), незавершённый раунд закрывается как `expired` без награды —
**учёба важнее игры**; башни команды сохраняются между перерывами. База: 100 HP + 25 за уровень «Крепких стен», урон башен ×(1 + 0.1 за
уровень «Усиленных башен», максимум ×2). Победа — база уцелела и убита хотя бы половина врагов; награда
(`xp`/`coins` этапа × (0.5…1 по целости базы), ×1.5 за первое прохождение) выдаётся один раз только участникам раунда
(старт / постройка / улучшение / вход), суточный потолок 8 наград. В режиме A/B команды играют параллельно; если обе сыграли один этап,
сервер объявляет победителя дуэли (по исходу и остатку HP) и выдаёт ему бонус. Клиент не может назначить победителя, изменить HP или баланс.

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
| `team_changed` | `{userId, team}` |
| `player_status_changed` | `{userId, status, reason}` или `{userId, connection}` |
| `task_updated`, `settings_changed` | `{userId, task}`, `{focusSec, breakSec}` |
| `timer_started` | `{cycleId, cycleNo, phase, phaseStartedAt, phaseEndsAt, serverTime, participants[], skipped[]}` |
| `timer_tick` | раз в секунду: `{phase, cycleId, phaseEndsAt, remainingMs, serverTime}` — только для сверки часов |
| `phase_changed` | `{from, to, cycleId, phaseStartedAt, phaseEndsAt, completed?, rewarded?}` |
| `roadmap_updated` | Road Map целиком (+ `pointsBefore`) |
| `node_reached` | `{team, nodeId, title, points, reward}` — сервер засчитал этап карты (`reward` — этапная награда, `null` у финального узла) |
| `challenge_completed` | `{team, draw, roadmapId, reward, contributors[]}` — команда-победитель (при ничьей приходит по событию на каждую, `draw:true`) |
| `help_applied` | `{actionId, type, from, to, cost, xpBonusPct?, expiresAt, at}` |
| `prank_applied` | `{actionId, type, from, to, blocked, effectEndsAt, at}` |
| `td_state` | `{team, towers[], round}` — состояние игры команды (приходит ~2 раза в секунду, пока идёт раунд) |
| `td_round_started` | `{team, stageId, startedBy, endsAt, speed}` |
| `td_tower_built` / `td_tower_upgraded` | `{team, slotId, type?, level, by}` |
| `td_round_finished` | `{team, stageId, status:"won|lost|expired", result:{hpLeft,hpMax,kills,leaked,total,gameTime}, reward}` |
| `td_duel_result` | `{stageId, winner:"A|B|draw", scores}` — дуэль команд A/B (оба сыграли один этап) |

Личные (всем соединениям игрока):

| type | data |
|---|---|
| `session_completed` | `{sessionId, roomId, status:"completed|aborted|abandoned", rewarded, xp, coins, capped?, boostPct?, reason?}` |
| `reward_granted` | `{kind:"focus_session|achievement|team_node|team_challenge", key, xp, coins, balance, level, levelUp}` |
| `balance_changed` | `{kind, coins, balance}` — траты (покупка, «Щит») |
| `achievement_unlocked` | `{id, title, description, reward}` |

Серверные проверки: авторизация по токену, членство в комнате, фаза, лимиты, идемпотентность — для каждого действия
(см. таблицу ошибок выше). События доставляются только после успешного COMMIT.
