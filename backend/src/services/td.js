import { randomUUID } from 'node:crypto';
import { BASE_HP, ROADMAP, TD, UPGRADES } from '../catalog.js';
import { E } from '../errors.js';
import { reqObject, reqString } from '../validate.js';
import {
  PATH_LENGTH, activeEffects, advanceTo, applySpell, buildSchedule, currentWave, enqueueMerc, ensureState, newState, nominalSeconds,
  publicEnemies, publicShots, slotById,
} from '../td/engine.js';

const DAY = 86_400_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Tower Defense / Tower Wars на перерывах. Сервер — единственный источник истины:
 *  - игра доступна только в фазе Break своей комнаты;
 *  - симуляцию ведёт детерминированный движок по метке времени (клиент ничего не считает);
 *  - башни, наёмники и заклинания оплачиваются из казны команды (team_progress.treasury_coins), цены — из каталога;
 *    списание атомарно (game.spendTreasury) и только внутри транзакции — казна не уходит в минус;
 *  - результат раунда, награды, победитель дуэли A/B и узлы Road Map определяются здесь и выдаются один раз;
 *  - раунд принадлежит перерыву: когда перерыв заканчивается, раунд корректно закрывается («expired»),
 *    учёба важнее игры. Башни команды сохраняются для следующих перерывов.
 *  - командный режим: на перерыве один раунд; одна команда только обороняется (башни, свои заклинания),
 *    другая только атакует её поле (томаты-наёмники, заклинания против защиты). Роли меняются каждый цикл.
 */
export function createTd(ctx, game) {
  const { db, clock, config } = ctx;
  const cfg = config.economy.td;
  let rooms = null;

  const stageDef = (id) => TD.stages.find((s) => s.id === id);
  /** Только собственные ключи каталога: «toString», «constructor», «__proto__» — не башни и не заклинания. */
  const catalogEntry = (table, id) => (Object.hasOwn(table, id) ? table[id] : undefined);
  const nodeTitle = (id) => ROADMAP.nodes.find((n) => n.id === id)?.title ?? id;

  // ------------------------------------------------------------------ вспомогательное
  const memberRow = (roomId, userId) => db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL', roomId, userId);
  const teamOf = (room, userId) => (room.mode === 'teams' ? (memberRow(room.id, userId)?.team_key === 'B' ? 'B' : 'A') : 'shared');
  const teamKeys = (room) => (room.mode === 'teams' ? ['A', 'B'] : ['shared']);
  const rivalOf = (room, team) => (room.mode === 'teams' ? (team === 'A' ? 'B' : 'A') : null);
  const cycleOf = (room) => room.cycle_id ?? '-';
  const teamSize = (room, team) => db.get('SELECT COUNT(*) c FROM room_members WHERE room_id = ? AND team_key = ? AND left_at IS NULL', room.id, team).c;

  /**
   * Команда защиты этого перерыва (только teams): в нечётных циклах — A, в чётных — B.
   * Если в ней никого нет, обороняется другая — иначе играть было бы некому.
   */
  function defenderOf(room) {
    if (room.mode !== 'teams') return null;
    const preferred = (room.cycle_no ?? 1) % 2 === 1 ? 'A' : 'B';
    const other = preferred === 'A' ? 'B' : 'A';
    return !teamSize(room, preferred) && teamSize(room, other) ? other : preferred;
  }
  /** Роль команды на этом перерыве: 'defense' | 'attack' (общий режим — null, доступно всё). */
  const roleOf = (room, team) => { const d = defenderOf(room); return d ? (team === d ? 'defense' : 'attack') : null; };
  const requireRole = (room, team, role, message) => {
    const r = roleOf(room, team);
    if (r && r !== role) throw E.forbidden('WRONG_ROLE', message, { role: r });
  };

  /** Параметры базы и башен команды из улучшений её игроков (те же «Крепкие стены» и «Усиленные башни»). */
  function teamStats(room, team) {
    const members = db.all(
      room.mode === 'teams'
        ? 'SELECT user_id FROM room_members WHERE room_id = ? AND team_key = ? AND left_at IS NULL'
        : 'SELECT user_id FROM room_members WHERE room_id = ? AND left_at IS NULL',
      ...(room.mode === 'teams' ? [room.id, team] : [room.id]),
    ).map((m) => m.user_id);
    let walls = 0;
    let power = 0;
    for (const uid of members) {
      walls += game.upgradeLevel(uid, 'base_walls');
      power += game.upgradeLevel(uid, 'tower_power');
    }
    return {
      hpMax: BASE_HP + walls * UPGRADES.base_walls.effect.perLevel,
      damageMult: Math.min(2, 1 + (power * UPGRADES.tower_power.effect.perLevel) / 100),
      wallLevels: walls, powerLevels: power,
    };
  }

  const stageUnlocked = (room, team, stage) => stage.node === 'camp' || Boolean(db.get('SELECT 1 x FROM team_nodes WHERE room_id = ? AND team_key = ? AND node_id = ?', room.id, team, stage.node));
  const furthestStage = (room, team) => {
    const unlocked = TD.stages.filter((s) => stageUnlocked(room, team, s));
    return unlocked[unlocked.length - 1];
  };
  const towersOf = (room, team) => db.all(
    'SELECT t.slot_id AS slot, t.type, t.level, t.owner_id AS ownerId, u.name AS ownerName FROM td_towers t JOIN users u ON u.id = t.owner_id WHERE t.room_id = ? AND t.team_key = ? ORDER BY t.slot_id',
    room.id, team,
  );
  /** Последний раунд команды (реванш стартует позже раунда 1; при равном времени решает номер раунда). */
  const roundOf = (room, team) => db.get('SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? ORDER BY started_at DESC, round_no DESC, rowid DESC LIMIT 1', room.id, team);
  const runningRound = (room, team) => db.get("SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? AND status = 'running'", room.id, team);
  const cycleRound = (room, team, roundNo) => db.get('SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? AND cycle_id = ? AND round_no = ?', room.id, team, cycleOf(room), roundNo);
  const treasuryOf = (room, team) => game.treasuryOf(room.id, team);

  function recordAction(room, team, userId, kind, extra = {}) {
    db.run(
      'INSERT INTO td_actions(room_id, team_key, cycle_id, user_id, kind, request_id, slot_id, cost, result, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      room.id, team, cycleOf(room), userId, kind, extra.requestId ?? null, extra.slot ?? null, extra.cost ?? 0, extra.result ? JSON.stringify(extra.result) : null, clock.now(),
    );
  }

  // ------------------------------------------------------------------ представление для клиента
  function roundView(row, room) {
    if (!row) return null;
    const stage = stageDef(row.stage_id);
    const state = ensureState(JSON.parse(row.state));
    const schedule = buildSchedule(stage);
    const running = row.status === 'running';
    return {
      id: row.id, team: row.team_key, roundNo: row.round_no ?? 1, stageId: row.stage_id, status: row.status, current: row.cycle_id === room.cycle_id,
      startedAt: row.started_at, endsAt: row.ends_at, finishedAt: row.finished_at, speed: row.speed,
      t: state.t, wave: currentWave(state, schedule), waves: stage.waves.length, spawned: state.spawned, total: schedule.length,
      hp: Math.round(state.hp), hpMax: state.hpMax, kills: state.kills, leaked: state.leaked,
      enemies: running ? publicEnemies(state) : [],
      shots: running ? publicShots(state) : [],
      effects: running ? activeEffects(state) : [],
      result: row.result ? JSON.parse(row.result) : null,
    };
  }

  function bestOf(room, team, stageId) {
    const r = db.get("SELECT COUNT(*) wins, MAX(json_extract(result, '$.hpLeft')) bestHp FROM td_rounds WHERE room_id = ? AND team_key = ? AND stage_id = ? AND status = 'won'", room.id, team, stageId);
    return { wins: r.wins, bestHpLeft: r.bestHp ?? null };
  }

  function stateData(room, team) {
    return { team, towers: towersOf(room, team), round: roundView(roundOf(room, team), room), treasuryCoins: treasuryOf(room, team) };
  }
  const emitState = (room, team) => db.emit({ scope: 'room', roomId: room.id, type: 'td_state', data: stateData(room, team) });

  const latestDuel = (room) => (room.cycle_id
    ? db.get('SELECT * FROM td_duels WHERE room_id = ? AND cycle_id = ? ORDER BY round_no DESC LIMIT 1', room.id, room.cycle_id)
    : null);

  /** Полное состояние мини-игры для игрока (то же отдаёт REST и подписка по WS). */
  function view(room, userId) {
    const team = teamOf(room, userId);
    const stats = teamStats(room, team);
    const role = roleOf(room, team);
    // этапы — той команды, чьё поле в бою (атакующие выбирают этап для поля защиты)
    const field = role === 'attack' ? rivalOf(room, team) : team;
    const stages = TD.stages.map((s) => ({
      id: s.id, title: s.title, node: s.node, nodeTitle: nodeTitle(s.node), unlocked: stageUnlocked(room, field, s),
      reward: s.reward, waves: s.waves.length, enemies: buildSchedule(s).length, hpScale: s.hpScale, ...bestOf(room, field, s.id),
    }));
    const unlockedIdx = stages.map((s, i) => (s.unlocked ? i : -1)).filter((i) => i >= 0);
    const rival = rivalOf(room, team);
    const duel = latestDuel(room);
    const u = db.get('SELECT coins FROM users WHERE id = ?', userId);
    return {
      enabled: room.phase === 'break', // вне перерыва игра закрыта
      phase: room.phase, mode: room.mode, team, role, defender: defenderOf(room), breakEndsAt: room.phase === 'break' ? room.phase_ends_at : null, serverTime: clock.now(),
      map: { ...TD.map, pathLength: PATH_LENGTH },
      towerTypes: Object.values(TD.towers).map((d) => ({ ...d, upgradeCosts: [TD.upgradeCost(d, 2), TD.upgradeCost(d, 3)] })),
      enemyTypes: Object.values(TD.enemies),
      maxLevel: TD.maxLevel,
      stages,
      defaultStageId: stages[unlockedIdx[unlockedIdx.length - 1]].id,
      base: stats,
      towers: towersOf(room, team),
      round: roundView(roundOf(room, team), room),
      rival: rival ? { team: rival, towers: towersOf(room, rival).length, towerList: towersOf(room, rival), treasuryCoins: treasuryOf(room, rival), round: roundView(roundOf(room, rival), room) } : null,
      duel: duel ? { stageId: duel.stage_id, winner: duel.winner, scores: JSON.parse(duel.scores), roundNo: duel.round_no } : null,
      me: { userId, coins: u.coins, participated: participantsOf(room.id, team, cycleOf(room)).includes(userId) },
      treasuryCoins: treasuryOf(room, team),
      mercenaries: Object.values(TD.mercenaries).map(({ id, title, description, cost, hp, speed, damage, armor }) => ({ id, title, description, cost, hp, speed, damage, armor })),
      spells: Object.values(TD.spells).map(({ id, title, description, cost, duration, target }) => ({ id, title, description, cost, duration, target })),
      mercCooldownSec: TD.mercCooldownSec,
    };
  }

  // ------------------------------------------------------------------ симуляция раунда
  function simContext(row, room) {
    const stage = stageDef(row.stage_id);
    return {
      stage, schedule: buildSchedule(stage),
      towers: towersOf(room, row.team_key).map((t) => ({ slot: t.slot, type: t.type, level: t.level })),
      damageMult: teamStats(room, row.team_key).damageMult,
    };
  }

  const saveState = (row, state) => {
    row.state = JSON.stringify(state);
    db.run("UPDATE td_rounds SET state = ? WHERE id = ? AND status = 'running'", row.state, row.id);
  };

  /**
   * shared: награда за убитое «подкрепление» копится в state.bounty; невыплаченный остаток
   * (bounty − bountyPaid) зачисляется в казну в той же транзакции. Возвращает true, если казна изменилась.
   */
  function payBounty(row, room, state) {
    const due = Math.floor((state.bounty ?? 0) - (state.bountyPaid ?? 0));
    if (due <= 0) return false;
    game.creditTreasury(room.id, row.team_key, due);
    state.bountyPaid = (state.bountyPaid ?? 0) + due;
    return true;
  }

  /** Догоняет раунд до момента nowMs; закрывает его, если игра окончена или перерыв закончился. */
  function advanceRound(row, room, nowMs, force = false) {
    if (row.status !== 'running') return row;
    const state = ensureState(JSON.parse(row.state));
    const until = Math.min(nowMs, row.ends_at);
    const target = Math.max(0, ((until - row.started_at) / 1000) * row.speed);
    const before = state.t;
    advanceTo(state, simContext(row, room), target);
    payBounty(row, room, state);
    if (state.status !== 'running') return finalize(row, room, state, state.status, until);
    if (nowMs >= row.ends_at || force) return finalize(row, room, state, 'expired', Math.min(nowMs, row.ends_at));
    if (state.t !== before) {
      saveState(row, state);
      emitState(room, row.team_key);
    }
    return row;
  }

  function finalize(row, room, state, status, atMs) {
    const schedule = buildSchedule(stageDef(row.stage_id));
    const result = { hpLeft: Math.round(state.hp), hpMax: state.hpMax, kills: state.kills, leaked: state.leaked, total: schedule.length, gameTime: state.t };
    db.run('UPDATE td_rounds SET status = ?, state = ?, result = ?, finished_at = ? WHERE id = ? AND status = ?', status, JSON.stringify(state), JSON.stringify(result), atMs, row.id, 'running');
    Object.assign(row, { status, state: JSON.stringify(state), result: JSON.stringify(result), finished_at: atMs });
    const reward = status === 'won' ? rewardRound(row, room, result) : null;
    db.emit({ scope: 'room', roomId: room.id, type: 'td_round_finished', data: { team: row.team_key, roundNo: row.round_no ?? 1, stageId: row.stage_id, status, result, reward } });
    // Road Map двигают только победы в TD (узел следующего этапа, крепость — победа в испытании)
    if (status === 'won') game.recordStageVictory(room, row.team_key, row.stage_id, participantsOf(room.id, row.team_key, row.cycle_id));
    emitState(room, row.team_key);
    resolveDuel(row, room);
    return row;
  }

  /** Игрок реально участвует в раунде команды, если запустил его, строил, отправлял наёмников, колдовал или начал реванш. */
  const PARTICIPATION = "kind IN ('start','build','upgrade','send_unit','buff','debuff','rematch')";
  const participantsOf = (roomId, team, cycleId) => db.all(`SELECT DISTINCT user_id FROM td_actions WHERE room_id = ? AND team_key = ? AND cycle_id = ? AND ${PARTICIPATION}`, roomId, team, cycleId).map((r) => r.user_id);

  /**
   * Суточный потолок игровых наград (анти-накрутка): отдельно для раундов (td_round) и для дуэлей (td_duel),
   * значение одно и то же. Повышенный потолок — только в демо-комнатах (room.demo).
   */
  function underDailyCap(room, userId, kind) {
    const cap = room.demo ? cfg.demoDailyRewardedRounds : cfg.dailyRewardedRounds;
    const today = db.get('SELECT COUNT(*) c FROM reward_transactions WHERE user_id = ? AND kind = ? AND created_at > ?', userId, kind, clock.now() - DAY).c;
    return today < cap;
  }

  /** Награда за победу: только участникам раунда, один раз на игрока и раунд. */
  function rewardRound(row, room, result) {
    const stage = stageDef(row.stage_id);
    const participants = participantsOf(room.id, row.team_key, row.cycle_id);
    const first = !db.get("SELECT 1 x FROM td_rounds WHERE room_id = ? AND team_key = ? AND stage_id = ? AND status = 'won' AND id != ?", room.id, row.team_key, row.stage_id, row.id);
    const quality = 0.5 + 0.5 * (result.hpLeft / result.hpMax); // чем целее база, тем больше награда
    const mult = quality * (first ? cfg.firstClearMultiplier : 1);
    const reward = { xp: Math.round(stage.reward.xp * mult), coins: Math.round(stage.reward.coins * mult), firstClear: first };
    for (const uid of participants) {
      if (!underDailyCap(room, uid, 'td_round')) continue; // суточный потолок наград за игру
      game.grant(uid, `td:round:${row.id}:${uid}`, 'td_round', reward, { roomId: room.id, stageId: row.stage_id, team: row.team_key, firstClear: first });
      game.checkAchievements(uid);
    }
    return reward;
  }

  /**
   * Итог раунда в командном режиме: поле принадлежит защите. База выстояла (победа или конец перерыва) — победила защита,
   * база пала — атака. Бонус за дуэль получают только участники победившей стороны, один раз.
   */
  function resolveDuel(row, room) {
    if (room.mode !== 'teams') return;
    const defender = row.team_key;
    const attacker = rivalOf(room, defender);
    const r = JSON.parse(row.result);
    const winner = row.status === 'lost' ? attacker : defender;
    const scores = { [defender]: r.hpLeft, [attacker]: r.leaked };
    const roundNo = row.round_no ?? 1;
    const ins = db.run('INSERT OR IGNORE INTO td_duels(room_id, cycle_id, round_no, stage_id, winner, scores, decided_at) VALUES (?,?,?,?,?,?,?)', room.id, row.cycle_id, roundNo, row.stage_id, winner, JSON.stringify(scores), clock.now());
    if (ins.changes === 0) return;
    for (const uid of participantsOf(room.id, winner, row.cycle_id)) {
      if (!underDailyCap(room, uid, 'td_duel')) continue;
      game.grant(uid, `td:duel:${room.id}:${row.cycle_id}:r${roundNo}:${uid}`, 'td_duel', cfg.duelReward, { roomId: room.id, team: winner, roundNo });
    }
    db.emit({ scope: 'room', roomId: room.id, type: 'td_duel_result', data: { stageId: row.stage_id, roundNo, winner, scores, defender, attacker } });
  }

  /** Вызывается из rooms.advance: продвигает активные раунды комнаты. */
  function tick(room, nowMs) {
    for (const row of db.all("SELECT * FROM td_rounds WHERE room_id = ? AND status = 'running'", room.id)) advanceRound(row, room, nowMs);
  }
  /** Перерыв закончился / закрыт: незавершённые раунды корректно закрываются («expired»), учёба продолжается. */
  function closeRounds(room, atMs) {
    for (const row of db.all("SELECT * FROM td_rounds WHERE room_id = ? AND status = 'running'", room.id)) advanceRound(row, room, atMs, true);
  }

  // ------------------------------------------------------------------ действия игроков
  function context(user, roomKey) {
    const found = rooms.findRoom(roomKey);
    rooms.advance(found.id); // догоняем фазы и симуляцию до текущего момента
    const room = rooms.findRoom(found.id);
    rooms.requireMember(room, user);
    return { room, team: teamOf(room, user.id) };
  }
  function requireBreak(room, user) {
    rooms.requirePhase(room, 'break');
    if (db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", user.id)) throw E.conflict('FOCUS_ACTIVE', 'Игра недоступна во время вашей фокус-сессии');
  }
  const requestIdOf = (v) => {
    if (typeof v !== 'string' || !REQUEST_ID.test(v)) throw E.badRequest('INVALID_FIELD', 'requestId: 8–64 символов [A-Za-z0-9_-]', { field: 'requestId' });
    return v;
  };
  /** Повтор запроса с тем же requestId возвращает сохранённый ответ и ничего не списывает. */
  const replayOf = (user, requestId) => {
    const r = db.get('SELECT result FROM td_actions WHERE user_id = ? AND request_id = ?', user.id, requestId);
    return r ? { ...JSON.parse(r.result), replayed: true } : null;
  };

  function get(user, roomKey) {
    const { room } = context(user, roomKey);
    return view(room, user.id);
  }

  /** Зайти в игру на этом перерыве (только для статистики; награду даёт участие делом). */
  function join(user, roomKey) {
    return db.tx(() => {
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      if (!db.get('SELECT 1 x FROM td_actions WHERE room_id = ? AND team_key = ? AND cycle_id = ? AND user_id = ? AND kind = ?', room.id, team, room.cycle_id, user.id, 'join')) {
        recordAction(room, team, user.id, 'join');
      }
      return view(room, user.id);
    });
  }

  /** Создаёт раунд команды (номер roundNo) и доставляет в него недоставленных наёмников соперника. */
  function createRound(room, team, stage, roundNo, startedBy) {
    const t = clock.now();
    const remaining = (room.phase_ends_at - t) / 1000;
    // Раунд обязан уложиться в перерыв: при коротком перерыве игра идёт быстрее (но не медленнее реального времени)
    const speed = Math.min(30, Math.max(1, Math.round((nominalSeconds(stage) / (remaining * 0.85)) * 100) / 100));
    const state = newState(stage, teamStats(room, team).hpMax);
    const id = randomUUID();
    const row = { id, room_id: room.id, team_key: team, cycle_id: room.cycle_id, stage_id: stage.id, status: 'running', started_at: t, ends_at: room.phase_ends_at, speed, round_no: roundNo };
    deliverPending(room, team, row, state);
    row.state = JSON.stringify(state);
    db.run(
      'INSERT INTO td_rounds(id, room_id, team_key, cycle_id, stage_id, status, started_at, ends_at, speed, state, round_no) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, room.id, team, room.cycle_id, stage.id, 'running', t, room.phase_ends_at, speed, row.state, roundNo,
    );
    db.emit({ scope: 'room', roomId: room.id, type: 'td_round_started', data: { team, roundNo, stageId: stage.id, startedBy, endsAt: room.phase_ends_at, speed } });
    return row;
  }

  /**
   * Наёмники, отправленные команде, у которой в этот перерыв ещё не было раунда, ждут в td_actions
   * (result.delivered = false) и выходят на поле, как только её раунд начинается.
   */
  function deliverPending(room, team, row, state) {
    const pending = db.all(
      "SELECT id, result FROM td_actions WHERE room_id = ? AND cycle_id = ? AND kind = 'send_unit' AND json_extract(result, '$.target') = ? AND json_extract(result, '$.delivered') = 0 ORDER BY id",
      room.id, cycleOf(room), team,
    );
    for (const p of pending) {
      const res = JSON.parse(p.result);
      enqueueMerc(state, res.type, { from: res.from ?? null });
      db.run('UPDATE td_actions SET result = ? WHERE id = ?', JSON.stringify({ ...res, delivered: true, roundId: row.id }), p.id);
    }
    return pending.length;
  }

  function start(user, roomKey, body) {
    const b = reqObject(body);
    return db.tx(() => {
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      // в командном режиме раунд идёт на поле защиты; начать его может любая сторона
      const field = defenderOf(room) ?? team;
      if (db.get('SELECT 1 x FROM td_rounds WHERE room_id = ? AND team_key = ? AND cycle_id = ?', room.id, field, room.cycle_id)) {
        throw E.conflict('ROUND_EXISTS', 'Раунд в этот перерыв уже был');
      }
      const stage = b.stageId === undefined ? furthestStage(room, field) : stageDef(reqString(b.stageId, 'stageId', { max: 20 }));
      if (!stage) throw E.notFound('STAGE_NOT_FOUND', 'Такого этапа нет');
      if (!stageUnlocked(room, field, stage)) throw E.forbidden('STAGE_LOCKED', `Этап откроется, когда команда пройдёт «${nodeTitle(stage.node)}» на карте`, { node: stage.node });
      if ((room.phase_ends_at - clock.now()) / 1000 < cfg.minRemainingSec) throw E.conflict('TOO_LATE', 'До конца перерыва слишком мало времени для раунда');
      game.ensureTeamProgress(room.id, field);
      createRound(room, field, stage, 1, user.id);
      recordAction(room, team, user.id, 'start');
      emitState(room, field);
      return view(room, user.id);
    });
  }

  /** Раунд команды догоняется до «сейчас» перед изменением башен — новая башня стреляет с этого момента. */
  const catchUp = (room, team) => {
    const running = runningRound(room, team);
    if (running) advanceRound(running, room, clock.now());
  };

  /** Построить башню: сервер проверяет фазу, слот и цену; платит казна команды; повтор requestId безопасен. */
  function build(user, roomKey, body) {
    const b = reqObject(body);
    const requestId = requestIdOf(b.requestId);
    const slotId = reqString(b.slotId, 'slotId', { max: 10 });
    const type = reqString(b.type, 'type', { max: 20 });
    return db.tx(() => {
      const replay = replayOf(user, requestId);
      if (replay) return replay;
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      requireRole(room, team, 'defense', 'Ваша команда сейчас в атаке: башни строит защита');
      const slot = slotById(slotId);
      if (!slot) throw E.badRequest('INVALID_SLOT', 'Такого места под башню нет', { slotId });
      const def = catalogEntry(TD.towers, type);
      if (!def) throw E.badRequest('UNKNOWN_TOWER', 'Неизвестный тип башни', { allowed: Object.keys(TD.towers) });
      if (db.get('SELECT 1 x FROM td_towers WHERE room_id = ? AND team_key = ? AND slot_id = ?', room.id, team, slotId)) throw E.conflict('SLOT_TAKEN', 'Это место уже занято');
      catchUp(room, team);
      game.ensureTeamProgress(room.id, team);
      const treasuryCoins = game.spendTreasury(room.id, team, def.cost);
      db.run('INSERT INTO td_towers(room_id, team_key, slot_id, type, level, owner_id, built_at) VALUES (?,?,?,?,1,?,?)', room.id, team, slotId, type, user.id, clock.now());
      const result = { action: 'build', slotId, type, level: 1, cost: def.cost, treasuryCoins };
      recordAction(room, team, user.id, 'build', { requestId, slot: slotId, cost: def.cost, result });
      game.checkAchievements(user.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'td_tower_built', data: { team, slotId, type, level: 1, by: user.id } });
      emitState(room, team);
      return result;
    });
  }

  function upgrade(user, roomKey, body) {
    const b = reqObject(body);
    const requestId = requestIdOf(b.requestId);
    const slotId = reqString(b.slotId, 'slotId', { max: 10 });
    return db.tx(() => {
      const replay = replayOf(user, requestId);
      if (replay) return replay;
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      requireRole(room, team, 'defense', 'Ваша команда сейчас в атаке: башни улучшает защита');
      const tower = db.get('SELECT * FROM td_towers WHERE room_id = ? AND team_key = ? AND slot_id = ?', room.id, team, slotId);
      if (!tower) throw E.notFound('NO_TOWER', 'На этом месте нет башни');
      if (b.expectedLevel !== undefined && b.expectedLevel !== tower.level) throw E.conflict('STALE_LEVEL', 'Уровень башни уже изменился', { currentLevel: tower.level });
      if (tower.level >= TD.maxLevel) throw E.conflict('MAX_LEVEL', 'Башня уже улучшена до максимума');
      const cost = TD.upgradeCost(TD.towers[tower.type], tower.level + 1);
      catchUp(room, team);
      game.ensureTeamProgress(room.id, team);
      const treasuryCoins = game.spendTreasury(room.id, team, cost);
      db.run('UPDATE td_towers SET level = level + 1 WHERE room_id = ? AND team_key = ? AND slot_id = ? AND level = ?', room.id, team, slotId, tower.level);
      const result = { action: 'upgrade', slotId, type: tower.type, level: tower.level + 1, cost, treasuryCoins };
      recordAction(room, team, user.id, 'upgrade', { requestId, slot: slotId, cost, result });
      db.emit({ scope: 'room', roomId: room.id, type: 'td_tower_upgraded', data: { team, slotId, level: tower.level + 1, by: user.id } });
      emitState(room, team);
      return result;
    });
  }

  /**
   * Целевой раунд для наёмника/заклинания: идущий раунд команды target, догнанный до «сейчас».
   * null — раунда нет или он только что закончился.
   */
  function liveRound(room, team) {
    const row = runningRound(room, team);
    if (!row) return null;
    advanceRound(row, room, clock.now());
    return row.status === 'running' ? row : null;
  }

  /**
   * Отправить наёмника. teams — на поле соперника (если у соперника в этот перерыв раунда ещё не было — ждёт его старта);
   * shared — «Подкрепление волны» в свой идущий раунд: убийство приносит в казну cost × mercBountyShared.
   */
  function sendUnit(user, roomKey, body) {
    const b = reqObject(body);
    const requestId = requestIdOf(b.requestId);
    const type = reqString(b.type, 'type', { max: 20 });
    const def = catalogEntry(TD.mercenaries, type);
    if (!def) throw E.badRequest('UNKNOWN_UNIT', 'Неизвестный наёмник', { allowed: Object.keys(TD.mercenaries) });
    return db.tx(() => {
      const replay = replayOf(user, requestId);
      if (replay) return replay;
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      requireRole(room, team, 'attack', 'Ваша команда сейчас в обороне: томатов отправляет атака');
      // кулдаун на команду: наёмников нельзя «заливать» десятками в секунду
      const last = db.get("SELECT MAX(created_at) at FROM td_actions WHERE room_id = ? AND team_key = ? AND kind = 'send_unit'", room.id, team).at;
      const cooldownMs = Math.round(TD.mercCooldownSec * 1000);
      if (last != null && clock.now() - last < cooldownMs) {
        const retryAfterMs = cooldownMs - (clock.now() - last);
        throw E.tooMany('MERC_COOLDOWN', 'Наёмники ещё собираются — подождите секунду', { retryAfterMs });
      }
      const shared = room.mode !== 'teams';
      const target = shared ? team : rivalOf(room, team);
      let row = null;
      if (shared) {
        row = liveRound(room, team);
        if (!row) throw E.conflict('NO_ACTIVE_ROUND', 'Подкрепление можно отправить только в идущий раунд');
      } else {
        row = liveRound(room, target);
        if (!row && cycleRound(room, target, 1)) throw E.conflict('RIVAL_NOT_IN_BATTLE', 'Соперник уже не в бою — его раунд закончился');
      }
      game.ensureTeamProgress(room.id, team);
      const treasuryCoins = game.spendTreasury(room.id, team, def.cost);
      const delivered = Boolean(row);
      if (row) {
        const state = ensureState(JSON.parse(row.state));
        enqueueMerc(state, def.id, { from: team, shared });
        saveState(row, state);
      }
      const result = { action: 'send_unit', type: def.id, cost: def.cost, target, queued: !delivered, treasuryCoins, from: team, delivered, ...(row ? { roundId: row.id } : {}) };
      recordAction(room, team, user.id, 'send_unit', { requestId, cost: def.cost, result });
      db.emit({ scope: 'room', roomId: room.id, type: 'td_unit_sent', data: { team, target, type: def.id, queued: !delivered, by: user.id } });
      emitState(room, team);
      if (target !== team) emitState(room, target);
      return result;
    });
  }

  /** Заклинание: self — на свой идущий раунд (buff), rival — на идущий раунд соперника (debuff). */
  function castSpell(user, roomKey, body) {
    const b = reqObject(body);
    const requestId = requestIdOf(b.requestId);
    const spell = reqString(b.spell, 'spell', { max: 20 });
    const def = catalogEntry(TD.spells, spell);
    if (!def) throw E.badRequest('UNKNOWN_SPELL', 'Неизвестное заклинание', { allowed: Object.keys(TD.spells) });
    return db.tx(() => {
      const replay = replayOf(user, requestId);
      if (replay) return replay;
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      const onRival = def.target === 'rival';
      if (onRival && room.mode !== 'teams') throw E.badRequest('NO_RIVAL', 'Соперника нет: в общем режиме доступны только свои заклинания');
      if (onRival) requireRole(room, team, 'attack', 'Ваша команда в обороне: заклинания против соперника — у атаки');
      else requireRole(room, team, 'defense', 'Ваша команда в атаке: усиливать оборону может только защита');
      const target = onRival ? rivalOf(room, team) : team;
      const row = liveRound(room, target);
      if (!row) {
        throw onRival
          ? E.conflict('RIVAL_NOT_IN_BATTLE', 'Соперник сейчас не в бою — заклинание не на кого наложить')
          : E.conflict('NO_ACTIVE_ROUND', 'Сейчас нет идущего раунда вашей команды');
      }
      const state = ensureState(JSON.parse(row.state));
      const towers = towersOf(room, target).map((t) => ({ slot: t.slot, type: t.type, level: t.level }));
      const applied = applySpell(state, def.id, { towers });
      if (!applied.applied) {
        throw applied.reason === 'NO_TARGET'
          ? E.conflict('NO_TARGET', 'У соперника нет башен — замораживать нечего')
          : E.conflict(onRival ? 'RIVAL_NOT_IN_BATTLE' : 'NO_ACTIVE_ROUND', 'Раунд уже закончился');
      }
      game.ensureTeamProgress(room.id, team);
      const treasuryCoins = game.spendTreasury(room.id, team, def.cost); // нехватка монет откатит и эффект
      saveState(row, state);
      const result = { action: 'spell', spell: def.id, cost: def.cost, target, treasuryCoins, targetSlot: applied.targetSlot, expiresAtGameTime: applied.effect.expiresAtGameTime };
      recordAction(room, team, user.id, onRival ? 'debuff' : 'buff', { requestId, slot: applied.targetSlot, cost: def.cost, result });
      db.emit({ scope: 'room', roomId: room.id, type: 'td_spell_cast', data: { team, target, spell: def.id, targetSlot: applied.targetSlot, by: user.id } });
      emitState(room, team);
      if (target !== team) emitState(room, target);
      return result;
    });
  }

  return { setRooms: (r) => { rooms = r; }, view, get, join, start, build, upgrade, sendUnit, castSpell, tick, closeRounds, towersOf, teamStats };
}
