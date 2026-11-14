import { randomUUID } from 'node:crypto';
import { BASE_HP, TD, UPGRADES, buildRoadmap, stageNodeIndex } from '../catalog.js';
import { E } from '../errors.js';
import { reqObject, reqString } from '../validate.js';
import { PATH_LENGTH, advanceTo, buildSchedule, currentWave, newState, nominalSeconds, publicEnemies, slotById } from '../td/engine.js';

const DAY = 86_400_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Tower Defense на перерывах. Сервер — единственный источник истины:
 *  - игра доступна только в фазе Break своей комнаты;
 *  - симуляцию ведёт детерминированный движок по метке времени (клиент ничего не считает);
 *  - башни стоят за Tomato Coins строителя, цена и уровень берутся из каталога;
 *  - результат раунда, награды и победитель дуэли A/B определяются здесь и выдаются один раз;
 *  - раунд принадлежит перерыву: когда перерыв заканчивается, раунд корректно закрывается («expired»),
 *    учёба важнее игры. Башни команды сохраняются для следующих перерывов.
 */
export function createTd(ctx, game) {
  const { db, clock, config } = ctx;
  const cfg = config.economy.td;
  let rooms = null;

  const stageDef = (id) => TD.stages.find((s) => s.id === id);
  /** Узел карты (по плану циклов комнаты), после которого открывается этап. */
  function stageNode(room, stage) {
    const map = buildRoadmap(room.cycles);
    const idx = stageNodeIndex(TD.stages.indexOf(stage), TD.stages.length, map.nodes.length - 1);
    return { ...map.nodes[idx], index: idx };
  }

  // ------------------------------------------------------------------ вспомогательное
  const memberRow = (roomId, userId) => db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL', roomId, userId);
  const teamOf = (room, userId) => (room.mode === 'teams' ? (memberRow(room.id, userId)?.team_key === 'B' ? 'B' : 'A') : 'shared');
  const teamKeys = (room) => (room.mode === 'teams' ? ['A', 'B'] : ['shared']);

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

  const teamSteps = (room, team) => db.get('SELECT points FROM team_progress WHERE room_id = ? AND team_key = ?', room.id, team)?.points ?? 0;
  const stageUnlocked = (room, team, stage) => teamSteps(room, team) >= stageNode(room, stage).index;
  const towersOf = (room, team) => db.all(
    'SELECT t.slot_id AS slot, t.type, t.level, t.owner_id AS ownerId, u.name AS ownerName FROM td_towers t JOIN users u ON u.id = t.owner_id WHERE t.room_id = ? AND t.team_key = ? ORDER BY t.slot_id',
    room.id, team,
  );
  const roundOf = (room, team) => db.get('SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? ORDER BY started_at DESC, rowid DESC LIMIT 1', room.id, team);

  function recordAction(room, team, userId, kind, extra = {}) {
    db.run(
      'INSERT INTO td_actions(room_id, team_key, cycle_id, user_id, kind, request_id, slot_id, cost, result, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      room.id, team, room.cycle_id ?? '-', userId, kind, extra.requestId ?? null, extra.slot ?? null, extra.cost ?? 0, extra.result ? JSON.stringify(extra.result) : null, clock.now(),
    );
  }

  // ------------------------------------------------------------------ представление для клиента
  function roundView(row, room) {
    if (!row) return null;
    const stage = stageDef(row.stage_id);
    const state = JSON.parse(row.state);
    const schedule = buildSchedule(stage);
    return {
      id: row.id, team: row.team_key, stageId: row.stage_id, status: row.status, current: row.cycle_id === room.cycle_id,
      startedAt: row.started_at, endsAt: row.ends_at, finishedAt: row.finished_at, speed: row.speed,
      t: state.t, wave: currentWave(state, schedule), waves: stage.waves.length, spawned: state.spawned, total: schedule.length,
      hp: Math.round(state.hp), hpMax: state.hpMax, kills: state.kills, leaked: state.leaked,
      enemies: row.status === 'running' ? publicEnemies(state) : [],
      // Активные дебаффы команды (шутки соперника) — клиент только показывает
      debuffs: teamDebuffs(room, row.team_key, row.cycle_id).filter((d) => d.untilMs > clock.now()).map((d) => ({ type: d.type, endsAt: d.untilMs, rangeMult: d.rangeMult ?? 1, cooldownMult: d.cooldownMult ?? 1 })),
      result: row.result ? JSON.parse(row.result) : null,
    };
  }

  function bestOf(room, team, stageId) {
    const r = db.get("SELECT COUNT(*) wins, MAX(json_extract(result, '$.hpLeft')) bestHp FROM td_rounds WHERE room_id = ? AND team_key = ? AND stage_id = ? AND status = 'won'", room.id, team, stageId);
    return { wins: r.wins, bestHpLeft: r.bestHp ?? null };
  }

  function stateData(room, team) {
    return { team, towers: towersOf(room, team), round: roundView(roundOf(room, team), room) };
  }
  const emitState = (room, team) => db.emit({ scope: 'room', roomId: room.id, type: 'td_state', data: stateData(room, team) });

  /** Полное состояние мини-игры для игрока (то же отдаёт REST и подписка по WS). */
  function view(room, userId) {
    const team = teamOf(room, userId);
    const stats = teamStats(room, team);
    const stages = TD.stages.map((s) => ({
      id: s.id, title: s.title, node: stageNode(room, s).id, nodeTitle: stageNode(room, s).title, unlocked: stageUnlocked(room, team, s),
      reward: s.reward, waves: s.waves.length, enemies: buildSchedule(s).length, hpScale: s.hpScale, ...bestOf(room, team, s.id),
    }));
    const unlockedIdx = stages.map((s, i) => (s.unlocked ? i : -1)).filter((i) => i >= 0);
    const rival = room.mode === 'teams' ? teamKeys(room).find((k) => k !== team) : null;
    const duel = room.cycle_id ? db.get('SELECT * FROM td_duels WHERE room_id = ? AND cycle_id = ?', room.id, room.cycle_id) : null;
    const u = db.get('SELECT coins FROM users WHERE id = ?', userId);
    return {
      enabled: room.phase === 'break', // вне перерыва игра закрыта
      phase: room.phase, mode: room.mode, team, breakEndsAt: room.phase === 'break' ? room.phase_ends_at : null, serverTime: clock.now(),
      map: { ...TD.map, pathLength: PATH_LENGTH },
      towerTypes: Object.values(TD.towers).map((d) => ({ ...d, upgradeCosts: [TD.upgradeCost(d, 2), TD.upgradeCost(d, 3)] })),
      enemyTypes: Object.values(TD.enemies),
      maxLevel: TD.maxLevel,
      stages,
      defaultStageId: stages[unlockedIdx[unlockedIdx.length - 1]].id,
      base: stats,
      towers: towersOf(room, team),
      round: roundView(roundOf(room, team), room),
      rival: rival ? { team: rival, towers: towersOf(room, rival).length, round: roundView(roundOf(room, rival), room) } : null,
      duel: duel ? { stageId: duel.stage_id, winner: duel.winner, scores: JSON.parse(duel.scores) } : null,
      me: { userId, coins: u.coins, participated: participantsOf(room.id, team, room.cycle_id ?? '-').includes(userId) },
    };
  }

  // ------------------------------------------------------------------ симуляция раунда
  /** Шутки соперника, попавшие в команду в этот перерыв (реальное время, мс). */
  function teamDebuffs(room, team, cycleId) {
    if (room.mode !== 'teams') return [];
    return db.all(
      `SELECT a.type, a.created_at AS fromMs, a.effect_ends_at AS untilMs FROM social_actions a
       JOIN room_members m ON m.room_id = a.room_id AND m.user_id = a.target_id
       WHERE a.room_id = ? AND a.cycle_id IS ? AND a.kind = 'prank' AND a.status = 'applied' AND m.team_key = ? ORDER BY a.id`,
      room.id, cycleId, team,
    ).map((d) => ({ ...d, ...(config.social.prank.types[d.type]?.debuff ?? {}) }));
  }

  function simContext(row, room) {
    const stage = stageDef(row.stage_id);
    const toGame = (ms) => Math.max(0, ((ms - row.started_at) / 1000) * row.speed); // реальное время → игровое
    return {
      stage, schedule: buildSchedule(stage),
      towers: towersOf(room, row.team_key).map((t) => ({ slot: t.slot, type: t.type, level: t.level })),
      damageMult: teamStats(room, row.team_key).damageMult,
      debuffs: teamDebuffs(room, row.team_key, row.cycle_id).map((d) => ({ ...d, from: toGame(d.fromMs), until: toGame(d.untilMs) })),
    };
  }

  /** Догоняет раунд до момента nowMs; закрывает его, если игра окончена или перерыв закончился. */
  function advanceRound(row, room, nowMs, force = false) {
    if (row.status !== 'running') return row;
    const state = JSON.parse(row.state);
    const until = Math.min(nowMs, row.ends_at);
    const target = Math.max(0, ((until - row.started_at) / 1000) * row.speed);
    const before = state.t;
    advanceTo(state, simContext(row, room), target);
    if (state.status !== 'running') return finalize(row, room, state, state.status, until);
    if (nowMs >= row.ends_at || force) return finalize(row, room, state, 'expired', Math.min(nowMs, row.ends_at));
    if (state.t !== before) {
      db.run('UPDATE td_rounds SET state = ? WHERE id = ?', JSON.stringify(state), row.id);
      row.state = JSON.stringify(state);
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
    db.emit({ scope: 'room', roomId: room.id, type: 'td_round_finished', data: { team: row.team_key, stageId: row.stage_id, status, result, reward } });
    emitState(room, row.team_key);
    resolveDuel(row, room);
    return row;
  }

  /** Игрок реально участвует в раунде команды, если запустил его, построил или улучшил башню (одного «захода» в игру мало). */
  const PARTICIPATION = "kind IN ('start','build','upgrade')";
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

  /** Награда за победу: только тем, кто участвовал в раунде (старт / постройка / улучшение), один раз на игрока. */
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

  const duelScore = (r) => { const x = JSON.parse(r.result); return r.status === 'won' ? 1000 + x.hpLeft : r.status === 'expired' ? x.hpLeft : 0; };

  /** Дуэль A/B: обе команды сыграли один и тот же этап в этот перерыв — сравниваем исходы. */
  function resolveDuel(row, room) {
    if (room.mode !== 'teams') return;
    const other = db.get("SELECT * FROM td_rounds WHERE room_id = ? AND cycle_id = ? AND team_key != ? AND stage_id = ? AND status != 'running'", room.id, row.cycle_id, row.team_key, row.stage_id);
    if (!other) return;
    const scores = { [row.team_key]: duelScore(row), [other.team_key]: duelScore(other) };
    const [a, b] = [scores.A, scores.B];
    const winner = a === b ? 'draw' : a > b ? 'A' : 'B';
    const ins = db.run('INSERT OR IGNORE INTO td_duels(room_id, cycle_id, stage_id, winner, scores, decided_at) VALUES (?,?,?,?,?,?)', room.id, row.cycle_id, row.stage_id, winner, JSON.stringify(scores), clock.now());
    if (ins.changes === 0) return;
    const winners = winner === 'draw' ? (a > 0 ? ['A', 'B'] : []) : [winner];
    for (const team of winners) {
      for (const uid of participantsOf(room.id, team, row.cycle_id)) {
        // тот же суточный потолок, что и у раундов: иначе дуэли (достаточно нажать «старт») фармятся без лимита
        if (!underDailyCap(room, uid, 'td_duel')) continue;
        game.grant(uid, `td:duel:${room.id}:${row.cycle_id}:${uid}`, 'td_duel', cfg.duelReward, { roomId: room.id, team });
      }
    }
    db.emit({ scope: 'room', roomId: room.id, type: 'td_duel_result', data: { stageId: row.stage_id, winner, scores } });
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

  function get(user, roomKey) {
    const { room } = context(user, roomKey);
    return view(room, user.id);
  }

  /** Зайти в игру на этом перерыве (только для статистики; награду даёт участие делом: старт, постройка, улучшение). */
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

  function start(user, roomKey, body) {
    const b = reqObject(body);
    return db.tx(() => {
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      if (db.get('SELECT 1 x FROM td_rounds WHERE room_id = ? AND team_key = ? AND cycle_id = ?', room.id, team, room.cycle_id)) {
        throw E.conflict('ROUND_EXISTS', 'Раунд вашей команды в этот перерыв уже был');
      }
      const unlocked = TD.stages.filter((s) => stageUnlocked(room, team, s));
      const stage = b.stageId === undefined ? unlocked[unlocked.length - 1] : stageDef(reqString(b.stageId, 'stageId', { max: 20 }));
      if (!stage) throw E.notFound('STAGE_NOT_FOUND', 'Такого этапа нет');
      if (!stageUnlocked(room, team, stage)) throw E.forbidden('STAGE_LOCKED', `Этап откроется, когда команда дойдёт до «${stageNode(room, stage).title}» на карте`, { node: stageNode(room, stage).id });
      const t = clock.now();
      const remaining = (room.phase_ends_at - t) / 1000;
      if (remaining < cfg.minRemainingSec) throw E.conflict('TOO_LATE', 'До конца перерыва слишком мало времени для раунда');
      // Раунд обязан уложиться в перерыв: при коротком перерыве игра идёт быстрее (но не медленнее реального времени)
      const speed = Math.min(30, Math.max(1, Math.round((nominalSeconds(stage) / (remaining * 0.85)) * 100) / 100));
      const hpMax = teamStats(room, team).hpMax;
      const id = randomUUID();
      db.run(
        'INSERT INTO td_rounds(id, room_id, team_key, cycle_id, stage_id, status, started_at, ends_at, speed, state) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, room.id, team, room.cycle_id, stage.id, 'running', t, room.phase_ends_at, speed, JSON.stringify(newState(stage, hpMax)),
      );
      recordAction(room, team, user.id, 'start');
      db.emit({ scope: 'room', roomId: room.id, type: 'td_round_started', data: { team, stageId: stage.id, startedBy: user.id, endsAt: room.phase_ends_at, speed } });
      emitState(room, team);
      return view(room, user.id);
    });
  }

  /** Построить башню: сервер проверяет фазу, слот, баланс и цену; повтор requestId безопасен. */
  function build(user, roomKey, body) {
    const b = reqObject(body);
    const requestId = requestIdOf(b.requestId);
    const slotId = reqString(b.slotId, 'slotId', { max: 10 });
    const type = reqString(b.type, 'type', { max: 20 });
    return db.tx(() => {
      const replay = db.get('SELECT result FROM td_actions WHERE user_id = ? AND request_id = ?', user.id, requestId);
      if (replay) return { ...JSON.parse(replay.result), replayed: true };
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      const slot = slotById(slotId);
      if (!slot) throw E.badRequest('INVALID_SLOT', 'Такого места под башню нет', { slotId });
      const def = TD.towers[type];
      if (!def) throw E.badRequest('UNKNOWN_TOWER', 'Неизвестный тип башни', { allowed: Object.keys(TD.towers) });
      if (db.get('SELECT 1 x FROM td_towers WHERE room_id = ? AND team_key = ? AND slot_id = ?', room.id, team, slotId)) throw E.conflict('SLOT_TAKEN', 'Это место уже занято');
      // раунд сначала догоняем до «сейчас» — башня начнёт стрелять с этого момента
      const running = db.get("SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? AND status = 'running'", room.id, team);
      if (running) advanceRound(running, room, clock.now());
      game.spend(user.id, `td:build:${requestId}`, 'td_build', def.cost, { roomId: room.id, slotId, type });
      db.run('INSERT INTO td_towers(room_id, team_key, slot_id, type, level, owner_id, built_at) VALUES (?,?,?,?,1,?,?)', room.id, team, slotId, type, user.id, clock.now());
      const result = { action: 'build', slotId, type, level: 1, cost: def.cost, balance: { coins: db.get('SELECT coins FROM users WHERE id = ?', user.id).coins } };
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
      const replay = db.get('SELECT result FROM td_actions WHERE user_id = ? AND request_id = ?', user.id, requestId);
      if (replay) return { ...JSON.parse(replay.result), replayed: true };
      const { room, team } = context(user, roomKey);
      requireBreak(room, user);
      const tower = db.get('SELECT * FROM td_towers WHERE room_id = ? AND team_key = ? AND slot_id = ?', room.id, team, slotId);
      if (!tower) throw E.notFound('NO_TOWER', 'На этом месте нет башни');
      if (b.expectedLevel !== undefined && b.expectedLevel !== tower.level) throw E.conflict('STALE_LEVEL', 'Уровень башни уже изменился', { currentLevel: tower.level });
      if (tower.level >= TD.maxLevel) throw E.conflict('MAX_LEVEL', 'Башня уже улучшена до максимума');
      const cost = TD.upgradeCost(TD.towers[tower.type], tower.level + 1);
      const running = db.get("SELECT * FROM td_rounds WHERE room_id = ? AND team_key = ? AND status = 'running'", room.id, team);
      if (running) advanceRound(running, room, clock.now());
      game.spend(user.id, `td:upgrade:${requestId}`, 'td_upgrade', cost, { roomId: room.id, slotId, level: tower.level + 1 });
      db.run('UPDATE td_towers SET level = level + 1 WHERE room_id = ? AND team_key = ? AND slot_id = ? AND level = ?', room.id, team, slotId, tower.level);
      const result = { action: 'upgrade', slotId, type: tower.type, level: tower.level + 1, cost, balance: { coins: db.get('SELECT coins FROM users WHERE id = ?', user.id).coins } };
      recordAction(room, team, user.id, 'upgrade', { requestId, slot: slotId, cost, result });
      db.emit({ scope: 'room', roomId: room.id, type: 'td_tower_upgraded', data: { team, slotId, level: tower.level + 1, by: user.id } });
      emitState(room, team);
      return result;
    });
  }

  return { setRooms: (r) => { rooms = r; }, view, get, join, start, build, upgrade, tick, closeRounds, towersOf, teamStats };
}
