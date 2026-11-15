# Tomato API

Базовый URL: `http://localhost:8787`. Формат — JSON. Время — миллисекунды Unix (серверные часы).

## Авторизация

`POST /api/users {"name":"Лотти"}` → `{ user, token }`. Токен показывается **один раз**, на сервере хранится
только SHA-256. Дальше: `Authorization: Bearer <token>`. Идентичность игрока берётся из токена;
любые `userId`/`senderId` в теле запроса — только цель действия и никогда не «кто действует».
Для WebSocket: первым сообщением `{"type":"auth","token":"…"}` (токен не попадает в URL/логи).

**Песочные аккаунты** (`{"name","sandbox":true}`) создаются только на сервере в демо-режиме (иначе `403 DEMO_DISABLED`),
играют только в демо-комнатах, а без демо-режима их токен не авторизуется (`401`, по WS — закрытие 4401).
Подробности — [DEMO_MODE.md](DEMO_MODE.md).

## Ошибки

```json
{ "error": { "code": "WRONG_PHASE", "message": "…", "details": { "phase": "focus" } } }
```

| HTTP | Коды |
|---|---|
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_FIELD`, `INVALID_SLOT`, `UNKNOWN_TOWER`, `SELF_TARGET`, `UNKNOWN_HELP_TYPE`, `UNKNOWN_PRANK_TYPE`, `INVALID_AMOUNT` |
| 401 | `UNAUTHORIZED` |
| 403 | `NOT_A_MEMBER`, `NOT_HOST`, `DEMO_DISABLED`, `SANDBOX_DEMO_ONLY` (песочный аккаунт → обычная комната), `DEMO_SANDBOX_ONLY` (обычный аккаунт → демо-комната), `UPGRADE_LOCKED`, `STAGE_LOCKED` |
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
| GET 🔓 | `/api/health` | `{status, serverTime, demoMode, schemaVersion, uptimeSec}` |
| GET 🔓 | `/api/metrics` | метрики Prometheus (text); с `TOMATO_METRICS_TOKEN` — нужен Bearer. См. `docs/OBSERVABILITY.md` |
| POST 🔓 | `/api/client-errors` | `{kind, message, stack?, url?}` → 204; ошибки браузера в лог и метрику, 20/мин с адреса |
| GET 🔓 | `/api/config` | Экономика (вкл. `demoDailyRewardedSessions`, `td.demoDailyRewardedRounds` — только для демо-комнат), лимиты, `social.prankRules{cooldownMs, demoCooldownMs, maxPerBreak}`, каталог улучшений/достижений, Road Map, правила присутствия |
| POST | `/api/heartbeat` | Подтверждает присутствие, возвращает `serverTime` |

### Пользователь
| Метод | Путь | Описание |
|---|---|---|
| POST 🔓 | `/api/users` | Регистрация: `{name, sandbox?}` → 201 `{user, token}`. `sandbox` — boolean (`400 INVALID_FIELD`); `true` только в демо-режиме (`403 DEMO_DISABLED`) |
| GET | `/api/users/me` | Профиль: `id,name,level,xp,coins,prankEnabled,sandbox,activeSession,rooms[]` |
| PATCH | `/api/users/me` | `{name?, prankEnabled?}` (остальные поля игнорируются); комнатам игрока уходит свежий `room_state` |
| GET | `/api/users/me/progress` | XP, уровень, монеты, улучшения, достижения, эффекты, статистика (`stats.focusSeconds`, `stats.interruptedSessions`) |
| GET | `/api/users/me/stats?tz` | Статистика занятий: `sessions{completed, rewarded, interrupted, focusSeconds, averageSeconds, todayFocusSeconds, todaySessions}`, уровень/XP, `bestStreakDays`, `social{helpsSent, pranksSent, helpsReceived, pranksReceived}`, `achievements{unlocked,total}`, `daily[7]{dayStart, focusSeconds, sessions}`. `tz` — смещение пояса клиента в минутах (−840…840), только чтобы резать сутки. Время концентрации — только завершённые сессии, по серверным меткам |
| GET | `/api/users/me/sessions?limit&offset` | История занятий: задача, статус, результат, награды |
| GET | `/api/users/me/achievements` | Список достижений |
| GET | `/api/users/me/upgrades` | Каталог улучшений игрока (`canBuy`, `nextCost`) |
| POST | `/api/users/me/upgrades/:id/purchase` | `{expectedLevel?}` → `{upgradeId, level, cost, balance}` |
| GET | `/api/users/me/transactions?limit` | Журнал начислений/трат |

### Комнаты
| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | `/api/rooms` | любой | `{name?, focusMinutes?, breakMinutes?, teamMode?}` (`teamMode:true` — Team A против Team B) (демо: `demo:true, focusSeconds, breakSeconds` — только песочный аккаунт) → 201 снимок. Песочный аккаунт без `demo:true` → `403 SANDBOX_DEMO_ONLY`, обычный с `demo:true` → `403 DEMO_SANDBOX_ONLY` |
| POST | `/api/rooms/join` | любой | `{code}`; тип аккаунта должен совпадать с типом комнаты (`SANDBOX_DEMO_ONLY` / `DEMO_SANDBOX_ONLY`) |
| GET | `/api/rooms/:id` | участник | Снимок состояния (:id — id или код) |
| POST | `/api/rooms/:id/join` | любой | Идемпотентно; та же проверка песочницы |
| POST | `/api/rooms/:id/leave` | участник | Досрочно завершает вашу сессию; хост передаётся |
| PATCH | `/api/rooms/:id/settings` | host, `waiting` | `{focusMinutes?, breakMinutes?, name?}` (демо-комната: `focusSeconds?, breakSeconds?`). Тип комнаты не меняется: `demo` ≠ типу аккаунта → `403 DEMO_SANDBOX_ONLY`/`SANDBOX_DEMO_ONLY` |
| POST | `/api/rooms/:id/team` | участник, `waiting`, режим Team A/B | `{team:"A"|"B"}` — сменить команду до старта цикла |
| POST | `/api/rooms/:id/ready` | участник, `waiting|break` | `{ready: boolean}` (иначе `400 INVALID_FIELD`) — статус готовности; в снимке `members[].isReady` и `me.isReady`, комнате — `player_ready_changed {userId, isReady}`. Сбрасывается при старте фокуса, входе и выходе из комнаты |
| POST | `/api/rooms/:id/task` | участник, не в сессии | `{title}` — личная учебная задача |
| POST | `/api/rooms/:id/start` | host, `waiting` | Запуск Focus. Ответ содержит `start.participants` и `start.skipped[]` (`offline`, `busy_elsewhere`, `sandbox_mismatch` — только старые данные). Демо-комната без демо-режима → `403 DEMO_DISABLED` |
| POST | `/api/rooms/:id/session/abort` | участник, `focus` | Досрочно завершить **свою** сессию (без награды) |
| POST | `/api/rooms/:id/session/result` | участник | `{result:"done"|"partial"|"not_done", note?, sessionId?}` — только история |
| POST | `/api/rooms/:id/skip-focus` | host, `focus` | Пропустить фокус для всех → сразу `break`. Награда × доля отработанного времени, шаг по карте не засчитывается |
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
| GET | `/api/rooms/:id/stats` | участник | Командный прогресс: `teams[]{key, name, points, goal, completedSessions, focusSeconds, members[]{userId, name, team, completedSessions, interruptedSessions, focusSeconds, points}}`, `totals`, `winner`, `cycles` |
| GET | `/api/rooms/:id/voice` | участник | Кто сейчас в голосовом канале: `{peers[]{userId, name, muted, deafened, speaking, joinedAt}, maxPeers}` |
| GET | `/api/voice/ice-servers` | любой авторизованный | `{iceServers[], ttlSec, relay}` — STUN и (если настроен) TURN с временными логинами, см. [VOICE.md](VOICE.md) |
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
  "focusToNext": { "done", "need" } | null,         // фокусы команды к следующему узлу (null — карта пройдена)
  "teams":   [{ "key","name","points","positionNodeId","finished","completed","focusPoints","focusToNext","treasuryCoins" }],  // shared: одна; teams: A и B на одной карте
  "nodes":   [{ "id","title","x","y","type","requiredPoints","status":"completed|current|next|locked",
                "reachedAt": ms|null, "reward": {"xp","coins"}|null, "progress": 0..1 }],
  "edges":   [["camp","forest"], …],
  "contributions": [{ "userId","name","points", "team" /* только в режиме teams */ }] }
// В режиме teams верхний уровень (points, nodes[].status, next, segment…) — для команды зрителя, `teams[]` — для обеих.
```
Правила: следующий узел открывает **победа в игре на перерыве** (TD / Harvest) **или N завершённых фокусов команды**
с последнего узла: N = `economy.focusesPerStagePerMember` (2) × участники команды. В счёт идут только награждённые
сессии (досрочный выход и пропуск фокуса хостом — нет); любой переход обнуляет счёт. Сервер фиксирует
`reachedAt` (таблица `team_nodes`), выдаёт участникам этапную награду (+25 XP, +10 монет, ключ
`node:<room>:<team>:<node>` — один раз) и шлёт `node_reached` с `via: "game" | "focus"`. Финальный узел вместо этапной даёт командную награду.
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
(старт / постройка / улучшение; одного «захода» в игру мало), суточный потолок 8 наград (в демо-комнатах — 500). В режиме A/B команды играют параллельно; если обе сыграли один этап,
сервер объявляет победителя дуэли (по исходу и остатку HP) и выдаёт ему бонус — с тем же суточным потолком (8, в демо-комнатах 500; считается отдельно от раундов). Клиент не может назначить победителя, изменить HP или баланс.

### Harvest на перерывах (`GET /api/rooms/:id/harvest`)
Игры перерывов чередуются (`config.breakGames`, переменная `TOMATO_BREAK_GAMES`: `alternate` по умолчанию, `td`, `harvest`):
после нечётного цикла — Tower Defense, после чётного — Harvest. Какая игра сейчас — `snapshot.room.breakGame`.
На Harvest-перерыве действия TD отвечают `409 WRONG_GAME`, и наоборот. Перерыв с Harvest не короче
`economy.harvest.minBreakSec` (30 с): помещаются отсчёт, раунд и экран итогов.

Раунд создаёт сервер в начале перерыва: отсчёт 3 с, длительность до 60 с. «Дождь» помидоров задаёт `round.seed` —
клиент строит тот же дождь (`frontend/src/tomato/harvestEngine.ts`, совпадение проверяет тест). Команды — `A`/`B`
(Красные/Синие); в комнате без команд и для пустой команды играют боты (`round.botTeam`).

| Метод | Путь | Тело | Ответ / проверки |
|---|---|---|---|
| GET | `/api/rooms/:id/harvest` | — | `{enabled, game, nextGame, myTeam, round:{id, seed, startedAt, endsAt, duration, status, result, botTeam, teams[]}, charges, live}`; `live` — тот же кадр, что `harvest_frame` |
| POST | `/api/rooms/:id/harvest/catch` | `{itemId, x}` | `{ok, kind, score, combo, mult, charges}`. Принимается, только если заявка в окне `[crossT − 0,35 с; crossT + 2 с]` (`TOO_EARLY`/`TOO_LATE`), корзина в точке `x` накрывает помидор (`MISSED`), корзина не «телепортировалась» с последней известной позиции (`TOO_FAST`), игрок не заморожен (`FROZEN`), помидор ещё не засчитан команде (`ALREADY_CAUGHT`) |
| POST | `/api/rooms/:id/harvest/prank` | `{targetId, kind:"freeze"\|"splat"}` | `201 {ok, charges, until}`. Только по команде соперника (`INVALID_TARGET`), нужен заряд (`NO_CHARGES`; старт 1, +1 за золотой, максимум 3), повторно на того же нельзя (`ALREADY_APPLIED`). Заморозка — корзина стоит 2 с (бот 3 с), клякса — помидоры на экране 5 с |

Счёт, комбо (5 подряд — ×2, 10 — ×3; гнилой −2 и сброс; окончательный пропуск сбрасывает серию) и личные очки сервер
пересчитывает по журналу поимок. Итог (`harvest_finished`): каждому участнику — опыт `10 + 2·очки (до 30) + 15 за победу`
(суточный потолок, монет нет); победа живой команды — шаг по карте, как победа в этапе TD; статистика открывает
достижение «Урожайный год» и вещи образа «Шляпа» (победа) и «Бусы-черри» (5 золотых помидоров).

### Друзья и перенос аккаунта
Аккаунты гостевые (имя без почты), поэтому человека нельзя найти по имени — только из общей комнаты или по коду друга.

| Метод | Путь | Тело | Ответ / проверки |
|---|---|---|---|
| GET | `/api/friends` | — | `{code, friends[{id, name, level, avatar, connection, focusing, room:{id, code, name, phase, cycleNo}\|null, since}], incoming[], outgoing[], limits}`; `code` — свой код друга (6 символов, выдаётся при первом запросе) |
| GET | `/api/friends/relations` | — | `{relations: {userId: "friend"\|"outgoing"\|"incoming"}}` — для кнопки «В друзья» у людей комнаты |
| POST | `/api/friends/requests` | `{userId}` или `{code}` | `201 {status:"pending"\|"accepted"}`. По `userId` — только тот, с кем вы были в одной комнате (`USER_NOT_FOUND`), по коду — любой (`FRIEND_CODE_NOT_FOUND`); встречная заявка сразу делает друзьями. Ошибки: `SELF_FRIEND`, `ALREADY_SENT`, `ALREADY_FRIENDS`, `FRIENDS_LIMIT` (200), `TOO_MANY_REQUESTS` (30 заявок в сутки, 429), `SANDBOX_MISMATCH` |
| POST | `/api/friends/:id/accept` | — | список друзей; только получатель заявки (`REQUEST_NOT_FOUND`) |
| POST | `/api/friends/:id/remove` | — | отклонить входящую, отменить исходящую или удалить из друзей (`FRIEND_NOT_FOUND`) |
| POST | `/api/friends/:id/invite` | `{roomId}` | `201`; другу уходит `room_invite`. Только другу (`NOT_FRIENDS`), только в свою комнату, не чаще раза в минуту (`INVITE_COOLDOWN`, 429) |
| POST | `/api/users/me/transfer-code` | — | `201 {code:"ABC-DEF-GHJ", expiresAt}` — одноразовый код на 10 минут (хранится хеш; новый код отменяет прежний) |
| POST 🔓 | `/api/users/transfer` | `{code}` | `{user, token}` — новое устройство получает свой токен того же аккаунта; старое не выходит. `TRANSFER_CODE_INVALID` — неверный, использованный или просроченный |

**Аккаунт с логином и паролем** (почта не нужна; пароль хранится только как scrypt с солью):

| Метод | Путь | Тело | Ответ / проверки |
|---|---|---|---|
| POST | `/api/users/me/credentials` | `{login, password}` или `{currentPassword, password}` | профиль с `login`. Гость закрепляет аккаунт (логин 3–24 `[a-z0-9._-]`, без учёта регистра; пароль 8–72): `LOGIN_TAKEN`, `INVALID_FIELD`. Если логин уже есть — смена пароля, нужен текущий (`WRONG_PASSWORD`) |
| POST 🔓 | `/api/auth/login` | `{login, password}` | `{user, token}` — устройство получает свой токен; `WRONG_CREDENTIALS` (403, не раскрывает, есть ли логин); после 10 ошибок логин блокируется на 15 минут (`LOGIN_LOCKED`, 429) |

Личные события (scope user): `friend_request {userId, name, avatar}`, `friend_accepted {userId, name}`, `friend_removed {userId}`,
`room_invite {from, fromName, roomId, roomCode, roomName, at}`.

### Снимок комнаты (`room_state`, ответ `GET /api/rooms/:id`)

```jsonc
{
  "room": { "id","code","name","hostId","phase":"waiting|focus|break|completed","cycleId","cycleNo","demo",
            "settings":{"focusSec","breakSec"},"phaseStartedAt","phaseEndsAt","serverTime","remainingMs" },
  "members": [{ "userId","name","role","level","team","isReady","task",
                "status":"waiting|focusing|finished|aborted|abandoned|spectating|resting",
                "connection":"online|reconnecting|offline","prankEnabled","contribution",
                "session":{"id","status","rewarded"}|null }],
  "challenge": { /* Road Map: points, goal, completed, positionNodeId, nodes[], edges[], contributions[] */ },
  "me": { "userId","isMember","isHost","team","isReady","status","task","session","level","xp","coins","prankEnabled","effects[]",
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
| `voice_join` | `roomId, muted?, deafened?` | `voice_joined {self, peers[], iceServers[], ttlSec, relay}`; остальным — `voice_peer_joined`. Только подписчику комнаты (`NOT_SUBSCRIBED`); канал до 8 человек (`VOICE_FULL`) |
| `voice_leave` | `roomId` | `voice_left`; остальным — `voice_peer_left {reason:"left"}` |
| `voice_signal` | `roomId, to, signal` | пересылается `to` как `voice_signal {from, signal}`. `signal` — `{description:{type:"offer"|"answer", sdp}}` или `{candidate:{candidate, sdpMid, sdpMLineIndex, usernameFragment}|null}`; лишние поля отбрасываются. Ошибки: `VOICE_NOT_JOINED`, `VOICE_PEER_NOT_FOUND`, `INVALID_SIGNAL` |
| `voice_state` | `roomId, muted?, deafened?, speaking?` | рассылается комнате как `voice_state` (только при изменении; с выключенным микрофоном `speaking` всегда `false`) |
| `harvest_move` | `roomId, x` | без ответа. Позиция корзины Harvest — только для показа другим (в `harvest_frame`) и проверки скорости; прыжок обрезается до допустимой скорости, замороженная корзина стоит. Очки так не получить |

Любое другое событие (`give_me_coins`, `complete_session`, `start_timer`…) → `error UNKNOWN_EVENT`. Голосовые сообщения
не меняют ни экономику, ни прогресс: сервер только пересылает SDP/ICE участникам того же голосового канала.
Эхо `reqId` возвращается в ответе/ошибке. Лимит 30 сообщений/с (плюс отдельно до 200 `voice_signal`/с — ICE-кандидаты
приходят пачками), 64 КБ на сообщение. Без `auth` за 5 с соединение закрывается.
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
| `player_ready_changed` | `{userId, isReady}` |
| `timer_started` | `{cycleId, cycleNo, phase, phaseStartedAt, phaseEndsAt, serverTime, participants[], skipped[]}` |
| `timer_tick` | раз в секунду: `{phase, cycleId, phaseEndsAt, remainingMs, serverTime}` — только для сверки часов |
| `phase_changed` | `{from, to, cycleId, phaseStartedAt, phaseEndsAt, completed?, rewarded?}` |
| `roadmap_updated` | Road Map целиком (+ `pointsBefore`) |
| `node_reached` | `{team, nodeId, title, points, reward}` — сервер засчитал этап карты (`reward` — этапная награда, `null` у финального узла) |
| `challenge_completed` | `{team, draw, roadmapId, reward, contributors[]}` — команда-победитель (при ничьей приходит по событию на каждую, `draw:true`) |
| `help_applied` | `{actionId, type, from, to, cost, xpBonusPct?, expiresAt, at}` |
| `harvest_started` | `{roundId, startedAt, endsAt, duration}` |
| `harvest_frame` | ~10 раз в секунду: `{roundId, t, serverTime, status, teams:[{key, name, bots, score, combo, mult, bestCombo, missed, caught[], players:[{id, name, bot, x, pts, caught, golden, rotten}]}], effects[], charges{}}` |
| `harvest_prank` | `{roundId, from, fromName, to, toName, kind, at, until}` |
| `harvest_finished` | `{roundId, winner, teams{key:{score, bestCombo, missed, players}}, rewards{userId:{xp}}}` |
| `prank_applied` | `{actionId, type, from, to, blocked, effectEndsAt, at}` |
| `td_state` | `{team, towers[], round}` — состояние игры команды (приходит ~2 раза в секунду, пока идёт раунд) |
| `td_round_started` | `{team, stageId, startedBy, endsAt, speed}` |
| `td_tower_built` / `td_tower_upgraded` | `{team, slotId, type?, level, by}` |
| `td_round_finished` | `{team, stageId, status:"won|lost|expired", result:{hpLeft,hpMax,kills,leaked,total,gameTime}, reward}` |
| `td_duel_result` | `{stageId, winner:"A|B|draw", scores}` — дуэль команд A/B (оба сыграли один этап) |
| `voice_roster` | `{peers[]}` — кто в голосе; приходит сразу после `subscribe` |
| `voice_peer_joined` / `voice_peer_left` | `{peer}` / `{userId, reason:"left|disconnected|replaced|left_room|rejoined"}` |
| `voice_state` | `{userId, muted, deafened, speaking}` |

Голосу лично: `voice_signal {from, signal}` (только адресату), `voice_kicked {reason:"replaced|left_room"}` — голос открыт
в другой вкладке (новое соединение вытесняет старое) или игрок вышел из комнаты.

Личные (всем соединениям игрока):

| type | data |
|---|---|
| `session_completed` | `{sessionId, roomId, status:"completed|aborted|abandoned", rewarded, xp, coins, capped?, boostPct?, reason?}` |
| `reward_granted` | `{kind:"focus_session|achievement|team_node|team_challenge", key, xp, coins, balance, level, levelUp}` |
| `balance_changed` | `{kind, coins, balance}` — траты (покупка, «Щит») |
| `achievement_unlocked` | `{id, title, description, reward}` |

Статика: если задан `TOMATO_STATIC_DIR`, тот же процесс отдаёт собранный фронтенд на `GET/HEAD` путей вне `/api` и `/ws`
(SPA-fallback на `index.html` для путей без расширения, `Cache-Control: immutable` для `/assets/*`, `no-cache` для `index.html`,
выход за пределы папки невозможен). Без переменной не-API пути отвечают JSON `404 NOT_FOUND`, как раньше.

Серверные проверки: авторизация по токену, членство в комнате, фаза, лимиты, идемпотентность — для каждого действия
(см. таблицу ошибок выше). События доставляются только после успешного COMMIT.
