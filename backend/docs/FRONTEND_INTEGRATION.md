# Подключение нового Frontend

Backend не знает про React и дизайн. Готовый транспорт лежит в `frontend/src/api/tomato/`
(`TomatoClient` + `TomatoSocket`, без UI) и тонкий хук `frontend/src/hooks/useTomatoRoom.ts`.
Их можно использовать как есть или заменить своими — контракт описан в [API.md](./API.md).

## 0. Адрес сервера
Dev: Vite проксирует `/api` и `/ws` на `http://localhost:8787` (`VITE_BACKEND_URL` меняет цель).
Production: `new TomatoClient({ baseUrl: "https://api.example.com" })` и CORS (`TOMATO_CORS_ORIGIN`).

## 1. Профиль (Welcome → Settings)
```ts
const client = new TomatoClient();
if (!client.token) await client.register(name);   // токен сохраняется в localStorage
const me = await client.me();                      // me.rooms — комнаты, куда можно вернуться
```
Потерянный токен = потерянный аккаунт (паролей в MVP нет).

## 2. Создать / войти (Settings → Focus Room)
```ts
const snap = await client.createRoom({ name, focusMinutes: 25, breakMinutes: 5 });
// или
const snap = await client.joinByCode("K7QM2X");    // ссылка-приглашение = /room/<code>
await client.setTask(snap.room.id, "Математика");
```
`snap.room.code` — то, что показывать как код/ссылку приглашения. Значения 25/5 — пресеты UI;
сервер принимает 10–120 / 3–30 минут и сам хранит длительность.

## 3. Состояние комнаты и таймер
* Источник истины — `snapshot.room.phase / phaseStartedAt / phaseEndsAt / serverTime`.
* Таймер рисуйте от `phaseEndsAt − serverNow()`; `socket.serverNow()` учитывает смещение часов.
  `timer_tick` раз в секунду нужен только для коррекции дрейфа. **Клиент не решает, что сессия закончилась** —
  ждите `phase_changed` / `room_state`.
* Фазы: `waiting` (настройка, запуск хостом) → `focus` → `break` → снова `waiting`; `completed` — комната закрыта.
* Анимации не влияют на данные: переключайте экраны сколько угодно, состояние комнаты на сервере не меняется
  и всегда доступно заново через `GET /api/rooms/:id` или повторный `subscribe`.

```ts
const socket = client.connect();           // авто-переподключение, авторизация и ре-подписка внутри
socket.subscribe(roomId);
socket.on("room_state", (e) => setSnapshot(e.data));
socket.on("reward_granted", (e) => toast(`+${e.data.xp} XP, +${e.data.coins} 🍅`));
```
Или хук: `const { snapshot, remainingMs, connected, events } = useTomatoRoom(client, roomId);`

## 4. Участники
`snapshot.members[]`: `status` (`focusing`, `finished`, `aborted`, `abandoned`, `resting`, `spectating`),
`connection` (`online/reconnecting/offline`), `task`, `level`, `contribution`. Для индикаторов слушайте
`player_status_changed`, `player_joined`, `player_left`.

## 5. Личные задачи и история
`POST /rooms/:id/task` до старта или на перерыве; во время своей сессии менять нельзя (`SESSION_ACTIVE`).
После Focus: `client.recordResult(roomId, "done", "заметка")` — влияет только на историю.
`client.sessions()` — история занятий (статус, награды, задача, результат).

## 6. Road Map
`snapshot.challenge` (и `GET /rooms/:id/roadmap`, событие `roadmap_updated`): `nodes[]` с относительными
координатами `x,y ∈ [0,1]`, `status` (`completed|current|next|locked`), `edges[]`, `points/goal`,
`contributions[]` (вклад каждого), `completed`. Для отрисовки карты этого достаточно; расчёт продвижения серверный.
`GET /rooms/:id/game` — `base.hp`, `towers.slots/damageMultiplier` — готовые данные под будущую Tower Defense
(статус `preview`: игры пока нет).

## 7. Прогресс игрока
`client.progress()` → XP, `levelStartXp/nextLevelXp` (для полоски), монеты, `upgrades[]` (`canBuy`, `nextCost`, `locked`),
`achievements[]`, `effects[]` (активный «Бонус»/«Щит»). Покупка: `buyUpgrade(id, upgrade.level)` —
передавайте текущий `level` как `expectedLevel`, это защищает от двойного клика.

## 8. Что разрешено в какой фазе
| Фаза | Разрешено | Запрещено (сервер вернёт `WRONG_PHASE`/`FOCUS_ACTIVE`) |
|---|---|---|
| `waiting` | задача, настройки и запуск (host), выход, покупка улучшений | помощь, пакости |
| `focus` | **только** `abort` своей сессии, выход, просмотр Road Map/участников | помощь, пакости, покупки, смена задачи |
| `break` | помощь, пакости, покупки, отметка результата, `skip-break` и `close` (host) | запуск Focus |

Готовый список для текущего игрока — `snapshot.me.allowedActions`. Во время Focus интерфейс должен быть
минимальным: таймер, участники, статусы; игровые панели показывайте на `break`.

## 9. Переподключение
`TomatoSocket` сам переподключается (0.5 → 10 с), заново авторизуется и подписывается; сервер присылает
свежий `room_state`. Награды повторно не выдаются (идемпотентный журнал). Присутствие поддерживается
heartbeat-ом (клиент шлёт раз в 5 с) — если пропасть дольше **30 с** во время Focus, сессия прерывается без награды;
короче — безопасно. Вкладка в фоне должна продолжать heartbeat (или переподключиться сразу при возвращении).

## 10. Voice Chat Bar
В MVP голосовой связи нет (не требуется кейсом). Mute/Deafen — чисто локальные кнопки интерфейса, на бэкенд
они не отправляются. Подключение WebRTC позже не потребует менять игровую логику: сигнальный канал можно
добавить как новый тип сообщений в `ws/hub.js`.

## 11. Ошибки
Каждый запрос бросает `TomatoApiError { status, code, message, details }`. Ориентируйтесь на `code`
(список в API.md), тексты `message` — для логов.
