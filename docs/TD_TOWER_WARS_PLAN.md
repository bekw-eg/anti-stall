# Tower Wars: «Аксолотли против Томатиков» — план и контракт

Ветка: `claude/tower-defense-rebuild-2eea3d` (от свежего `origin/master`). Другие ветки не мержатся.

Инвариант: **сервер — единственный источник истины.** Клиент не считает урон, HP, казну, исход боя и движение по карте;
он только интерполирует позиции врагов между тиками и рисует эффекты.

## Волны работ и владельцы файлов

| Агент | Файлы (только свои!) | Волна |
|---|---|---|
| A1 Economy & DB | `backend/src/db.js`, `backend/src/services/game.js`, `backend/src/services/rooms.js`, `ROADMAP` в `backend/src/catalog.js`, `config.economy.treasuryStart` в `backend/src/config.js`, тесты `roadmap/team/teams/economy/persistence` | 1 |
| A2 TD Engine & Tower Wars | `backend/src/td/engine.js`, секция `TD` в `catalog.js`, `config.economy.td.*` в `config.js`, затем `backend/src/services/td.js`, `backend/src/http/routes.js`, тесты `td-engine.test.js`, `td.test.js` | 1 (движок) → 2 (сервис) |
| A3 Frontend State & HUD | `frontend/src/api/tomato/types.ts`, `client.ts`, `frontend/src/tomato/useTomato.ts`, `TomatoApp.tsx`, `TowerDefense.tsx`, `RoadMap.tsx`/`RoadmapBackdrop.tsx`/`RoomExtras.tsx` (тексты карты), тесты `TowerDefense.test.tsx` | 1 |
| A4 Visuals | `frontend/src/tomato/tdCanvas.ts`, `frontend/src/tomato/tdSprites.tsx`, `frontend/src/tomato/tdCanvas.test.ts` | 1 |
| A5 QA | все тесты, `integration.test.ts`, `backend/scripts/cheat-check.mjs`, документация | 3 |

## 1. БД (A1) — `SCHEMA_VERSION = 5`, только аддитивно, данные сохраняются

- `team_progress.treasury_coins INTEGER NOT NULL DEFAULT 0 CHECK (treasury_coins >= 0)` (ALTER TABLE ADD COLUMN).
- `td_rounds.round_no INTEGER NOT NULL DEFAULT 1`, уникальность `UNIQUE (room_id, team_key, cycle_id, round_no)` —
  пересборка таблицы (CREATE new → INSERT SELECT → DROP → RENAME) в транзакции, только если у старой таблицы нет `round_no`.
- `td_actions.kind CHECK (kind IN ('join','start','build','upgrade','send_unit','buff','debuff','rematch'))` — пересборка таблицы
  (детект: в `sqlite_master.sql` нет `'send_unit'`), индексы пересоздать.
- `td_duels.round_no INTEGER NOT NULL DEFAULT 1`, `PRIMARY KEY (room_id, cycle_id, round_no)` — пересборка.
- В `SCHEMA` (для новых БД) сразу описать финальные версии таблиц.

## 2. Экономика и Road Map (A1) — API `game.*`, которым пользуется `td.js`

```js
game.ensureTeamProgress(roomId, teamKey)          // INSERT OR IGNORE с treasury_coins = config.economy.treasuryStart (30)
game.ensureTeams(room)                            // ensureTeamProgress для 'shared' или 'A'+'B'
game.treasuryOf(roomId, teamKey) -> number        // 0, если строки нет
game.spendTreasury(roomId, teamKey, amount)       // атомарно в текущей транзакции:
   // UPDATE team_progress SET treasury_coins = treasury_coins - ? WHERE room_id = ? AND team_key = ? AND treasury_coins >= ?
   // changes === 0 → E.conflict('INSUFFICIENT_TEAM_FUNDS', 'В казне команды недостаточно монет', { required, treasuryCoins })
   // возвращает новый баланс
game.creditTreasury(roomId, teamKey, amount) -> number   // amount > 0, ensureTeamProgress внутри
game.recordStageVictory(room, teamKey, stageId, participantIds) -> { reachedNodeId: string|null, completed: boolean }
```

- `completeSession`: если награда выдана (`granted`), те же `coins` дополнительно зачисляются в казну команды игрока
  (`shared` или `A`/`B` по `room_members.team_key`). Личные монеты сохраняются (магазин улучшений).
- `rooms.finishFocus` (до перехода в break) и `rooms.startFocus` вызывают `game.ensureTeams(room)` — у каждой команды есть стартовый капитал 30.
- **Road Map двигают только победы в TD.** Фокус-сессии дают очки вклада (`team_contributions`, `team_progress.points`) и монеты в казну,
  но **не** узлы. `recordStageVictory(room, team, stageId)`: этап узла `N` выигран → фиксируется следующий узел `N+1` в `team_nodes`
  (событие `node_reached`, награда `nodeReward` участникам), выигран этап последнего узла (`fortress`) → `team_progress.completed_at`,
  `challenge_completed`, `challengeReward` (в `teams` побеждает первая; одновременная — ничья). Всегда `roadmap_updated`.
  Повторная победа на уже пройденном этапе узлов не даёт.
- Совместимость `roadmapView`: форма объекта прежняя. `ROADMAP.nodes[i].requiredPoints = i` (0,1,2,3) = число побед в TD,
  нужных до узла; `points` в `roadmapView`/`teams[].points` = прогресс по карте (число узлов, пройденных победами, 0…4),
  `goal = ROADMAP.nodes.length` (4: три перехода + победа над крепостью). Позиция = последний узел из `team_nodes` (или `camp`).
  Новые поля: `focusPoints` (очки вклада команды), `treasuryCoins`, `nodes[].challenge = { kind: 'td_stage_win', stageId }`,
  `next = { nodeId, title, pointsNeeded, stageId }`.
- Поражение/истечение раунда ничего не забирает: башни (`td_towers`), уровни, `hpMax` (из улучшений) и узел остаются.

## 3. Движок (A2) — `backend/src/td/engine.js`, детерминированно, без БД

Каталог `TD`:
```js
mercenaries: {
  cherry:  { id, title: 'Черри-бегун',      cost: 2,  hp: 30,  speed: 1.6,  damage: 3,  armor: 0 },
  ripe:    { id, title: 'Спелый томат',     cost: 5,  hp: 95,  speed: 1.05, damage: 7,  armor: 0 },
  armored: { id, title: 'Броне-томат в каске', cost: 12, hp: 280, speed: 0.65, damage: 15, armor: 0.25 },
  king:    { id, title: 'Томат-Дредноут',   cost: 25, hp: 900, speed: 0.5,  damage: 30, armor: 0.35 },
},
spells: {
  haste:         { target: 'self',  cost: 10, duration: 6, factor: 1.35 }, // кулдаун башен / 1.35
  repair:        { target: 'self',  cost: 12, duration: 5, heal: 20, factor: 0.3 }, // +20 HP (≤ hpMax), щит −30% урона
  slow_towers:   { target: 'rival', cost: 10, duration: 6, factor: 1.65 }, // кулдаун башен × 1.65
  disable_tower: { target: 'rival', cost: 14, duration: 5 },               // самая прокачанная башня (ничья → меньший slot id) не стреляет
  enrage_horde:  { target: 'rival', cost: 12, duration: 5, factor: 1.4 },  // скорость врагов × 1.4
},
mercCooldownSec: 0.8, mercBountyShared: 1.5,
```
- `state` (новые поля, со значениями по умолчанию для старых JSON): `effects: []`, `queuedSpawns: []`, `shots: []`, `nextShotId`, `nextEffectId`,
  `waveKills` (убийства врагов расписания), `bounty` (накопленные монеты за убийство наёмников в shared).
- `effects[i] = { id, kind, targetSlot: string|null, expiresAtGameTime, factor }`; эффекты истекают по `state.t`.
- Чистые функции: `applySpell(state, spellId, ctx)`, `enqueueMerc(state, type, { from })`. Наёмник спавнится на `s = 0` следующим шагом,
  `isMerc: true`, свои `hp`/`armor` (без `hpScale`). Урон по врагу: `damage * (1 - armor)`.
- Победа: расписание выпущено, на поле нет врагов (наёмники тоже), `waveKills * 2 >= schedule.length`.
- `state.shots`: при каждом выстреле `{ id, t, slot, towerType, fromX, fromY, toX, toY, targetId, damage, splash, slow }`,
  хранить последние 25 с `t >= state.t - 1.5`.
- `publicEnemies(state)`: `{ id, type, x, y, s, hp, maxHp, speed, slowed, hasted, armor, isMerc }`, `speed` — текущая скорость в клетках/игровую секунду.
- `type` врага: `runner|grunt|tank|boss|cherry|ripe|armored|king`.

## 4. Сервис и REST (A2, после A1)

- `build`/`upgrade`: цена списывается `game.spendTreasury` (кто первый нажал). Ответ: `{ action, slotId, type, level, cost, treasuryCoins }`.
  Идемпотентность `(user_id, request_id)` в `td_actions` сохраняется.
- `POST /api/rooms/:id/td/send-unit` `{ requestId, type }` → `td.sendUnit`. `teams`: юнит уходит в раунд соперника; если у соперника
  в этом перерыве раунда ещё не было — копится как недоставленный (`td_actions` kind `send_unit`, `result.delivered=false`) и
  добавляется в `queuedSpawns`, когда соперник стартует; если раунд соперника уже закончен — `409 RIVAL_NOT_IN_BATTLE`.
  `shared`: «Подкрепление волны» в свой работающий раунд, убийство даёт `cost × 1.5` в казну. Кулдаун 0.8 с на команду →
  `429 MERC_COOLDOWN { retryAfterMs }`. Ответ `{ action: 'send_unit', type, cost, target, queued, treasuryCoins }`.
- `POST /api/rooms/:id/td/spell` `{ requestId, spell }` → `td.castSpell`. Цель — свой раунд (`self`) или раунд соперника (`rival`),
  должен идти (`409 NO_ACTIVE_ROUND` / `RIVAL_NOT_IN_BATTLE`); `rival`-заклинание в `shared` → `400 NO_RIVAL`.
  Повтор того же эффекта продлевает срок (не складывается). td_actions kind `buff`/`debuff`. Ответ `{ action: 'spell', spell, cost, target, treasuryCoins }`.
- `POST /api/rooms/:id/td/rematch` `{ stageId? }` → `td.rematch` → `TdView`. Условия: break, свой раунд 1 этого перерыва завершён,
  ни один раунд 1 комнаты не идёт, раунда 2 у команды нет (`409 REMATCH_USED`), осталось ≥ `minRemainingSec` (`409 TOO_LATE`).
  Создаёт `round_no = 2` для каждой команды с завершённым раундом 1. Проигравшая дуэль раунда 1 команда (`teams`) получает
  «Контратаку» `config.economy.td.counterattackCoins = 40` в казну (один раз). Дуэль считается отдельно для каждого `round_no`.
- `start` создаёт только `round_no = 1` (`ROUND_EXISTS` как раньше).
- Победа в раунде → `game.recordStageVictory(...)`. Участие (`PARTICIPATION`) включает `send_unit`, `buff`, `debuff`, `rematch`.
- Каждое изменение казны/раунда → `td_state` для всех затронутых команд.

## 5. Контракт данных (TypeScript, A3 — `types.ts`)

```ts
export type EnemyType = "runner" | "grunt" | "tank" | "boss" | "cherry" | "ripe" | "armored" | "king";
export type MercType = "cherry" | "ripe" | "armored" | "king";
export type SpellId = "haste" | "repair" | "slow_towers" | "disable_tower" | "enrage_horde";

export interface TdEnemy { id: number; type: EnemyType; x: number; y: number; s: number; hp: number; maxHp: number;
  speed: number; slowed: boolean; hasted: boolean; armor: number; isMerc: boolean }
export interface TdShot { id: number; t: number; slot: string; towerType: TowerType; fromX: number; fromY: number;
  toX: number; toY: number; targetId: number; damage: number; splash: number | null; slow: boolean }
export interface TdEffect { id: number; kind: SpellId; targetSlot: string | null; expiresAtGameTime: number; factor: number }
export interface TdMercDef { id: MercType; title: string; description: string; cost: number; hp: number; speed: number; damage: number; armor: number }
export interface TdSpellDef { id: SpellId; title: string; description: string; cost: number; duration: number; target: "self" | "rival" }

// TdRound: + roundNo: number; shots: TdShot[]; effects: TdEffect[]
// TdView:  + treasuryCoins: number; mercenaries: TdMercDef[]; spells: TdSpellDef[]; mercCooldownSec: number;
//            rematch: { available: boolean; reason: string | null; roundNo: number; counterattackCoins: number; bonusTeam: string | null };
//            rival: { team; towers: number; treasuryCoins: number; round } | null; duel: {...; roundNo: number} | null
// TdStateEvent: + treasuryCoins: number
// Roadmap: + focusPoints?: number; treasuryCoins?: number; next.stageId?
```

Клиент: `tdSendUnit(id, type, requestId)`, `tdCastSpell(id, spell, requestId)`, `tdRematch(id, stageId?)`.

## 6. Клиент (A3 + A4)

- `TomatoApp`: фаза стала `break` → `setPanel("game")` и `loadTd()`; ушла из `break` → панель игры закрывается. Во время `focus`
  карта размыта (`RoadmapBackdrop`) с подписью «Игра откроется на перерыве».
- `TowerDefense.tsx`: SVG-слой (карта, тропа, Академия Аксолотлей, портал, слоты `role="button"` + `data-testid="slot-sN"`, `data-testid="base"`,
  башни из `tdSprites.tsx`), поверх — `<canvas class="pointer-events-none absolute inset-0">` из `tdCanvas.ts`. Для доступности/тестов
  враги дублируются невидимыми SVG-узлами `data-testid="enemy"`. HUD: казна, оборона, штурм/поддержка, соперник и реванш.
- `tdSprites.tsx` (A4): `export function AxolotlTower(props: { type: TowerType; level: number; haste?: boolean; slowed?: boolean; disabled?: boolean })` —
  SVG `<g>` вокруг (0,0), радиус ≈ 0.45 клетки. Уровни: 1 — базовый, 2 — серебряный шлем/очки, 3 — золотая броня/корона + аура.
  Эффекты: haste — золотые молнии, slowed — фиолетовая дымка, disabled — ледяная глыба/кетчуп. Плюс `AcademyBase`, `TomatoPortal`.
- `tdCanvas.ts` (A4): `export function createTdRenderer(canvas: HTMLCanvasElement, opts: { cols: number; rows: number; path: [number, number][]; slots: { id: string; x: number; y: number }[]; reducedMotion?: boolean }): TdRenderer`
  `interface TdRenderer { setRound(round: TdRound | null, receivedAt: number): void; resize(): void; destroy(): void }`.
  60 FPS (`requestAnimationFrame`), интерполяция по полилинии `path` (`s += speed * round.speed * dt`, Lerp к серверной `s`),
  процедурные томаты (cherry/runner мелкие, ripe/grunt, armored/tank в шлеме и нагруднике, king/boss в латах с короной),
  наёмники с фиолетово-огненной обводкой и значком мечей, снаряды по `shots` (стрела, ядро по параболе + взрыв, ледяной луч),
  всплывающий урон. Без контекста (`getContext` = null в jsdom) — тихо ничего не делает.

## 7. Definition of Done

`npm --prefix backend test`, `npm --prefix frontend test`, `npx tsc --noEmit` (frontend) — 0 ошибок; проверка в браузере на демо-сервере.
