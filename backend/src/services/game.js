import { ACHIEVEMENTS, BASE_HP, ROADMAP_ID, UPGRADES, buildRoadmap, levelForXp, upgradeCost, xpForLevel } from '../catalog.js';
import { E } from '../errors.js';

const DAY = 86_400_000;

/**
 * Игровая экономика. ЕДИНСТВЕННОЕ место, где меняются xp/coins/достижения/командные очки.
 * Все функции вызываются только из серверной логики (завершение фазы, покупка, соцдействия).
 */
export function createGame(ctx) {
  const { db, clock, config } = ctx;
  const eco = config.economy;

  // ------------------------------------------------------------------ уровни и профиль
  function levelInfo(xp) {
    const level = levelForXp(xp);
    return { level, xp, levelStartXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1) };
  }

  function userRow(userId) {
    return db.get('SELECT * FROM users WHERE id = ?', userId);
  }

  // ------------------------------------------------------------------ журнал наград (идемпотентный)
  /** Начислить награду ровно один раз на ключ. Повтор с тем же ключом ничего не меняет. */
  function grant(userId, key, kind, { xp = 0, coins = 0 }, meta = {}) {
    if (xp < 0 || coins < 0) throw new Error('grant: отрицательные значения запрещены');
    const ins = db.run(
      'INSERT OR IGNORE INTO reward_transactions(user_id, key, kind, xp, coins, meta, created_at) VALUES (?,?,?,?,?,?,?)',
      userId, key, kind, xp, coins, JSON.stringify(meta), clock.now(),
    );
    if (ins.changes === 0) return { granted: false };
    const before = userRow(userId);
    db.run('UPDATE users SET xp = xp + ?, coins = coins + ? WHERE id = ?', xp, coins, userId);
    const after = userRow(userId);
    const levelBefore = levelForXp(before.xp);
    const levelAfter = levelForXp(after.xp);
    db.emit({
      scope: 'user', userId, type: 'reward_granted',
      data: { kind, key, xp, coins, balance: { xp: after.xp, coins: after.coins }, level: levelAfter, levelUp: levelAfter > levelBefore, ...meta },
    });
    return { granted: true, levelUp: levelAfter > levelBefore, level: levelAfter };
  }

  /** Потратить монеты. Баланс не может уйти в минус (условие в UPDATE + CHECK в схеме). */
  function spend(userId, key, kind, coins, meta = {}) {
    if (!Number.isInteger(coins) || coins <= 0) throw E.badRequest('INVALID_AMOUNT', 'Сумма должна быть положительной');
    const upd = db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', coins, userId, coins);
    if (upd.changes === 0) {
      throw E.conflict('INSUFFICIENT_FUNDS', 'Недостаточно монет', { required: coins, balance: userRow(userId).coins });
    }
    const ins = db.run(
      'INSERT OR IGNORE INTO reward_transactions(user_id, key, kind, xp, coins, meta, created_at) VALUES (?,?,?,0,?,?,?)',
      userId, key, kind, -coins, JSON.stringify(meta), clock.now(),
    );
    if (ins.changes === 0) throw E.conflict('DUPLICATE_OPERATION', 'Операция уже выполнена'); // откатит и UPDATE
    db.emit({ scope: 'user', userId, type: 'balance_changed', data: { kind, coins: -coins, balance: { coins: userRow(userId).coins } } });
  }

  // ------------------------------------------------------------------ завершение фокус-сессии
  function activeBoost(userId, at) {
    return db.get(
      'SELECT * FROM user_effects WHERE user_id = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY id LIMIT 1',
      userId, 'boost', at,
    );
  }

  /**
   * Качество фокуса: доля сессии, когда участник был на месте (вкладка открыта и в сети).
   * Отлучки сервер копит сам: обрыв связи видит по присутствию, уход со вкладки сообщает клиент.
   * Клиент может только СНИЗИТЬ своё качество — повысить его подменой данных нельзя.
   */
  function sessionQuality(session, endAt) {
    const durMs = Math.max(1, Math.min(endAt, session.scheduled_end_at) - session.started_at);
    const openAway = session.away_since !== null && session.away_since !== undefined ? Math.max(0, endAt - Math.max(session.away_since, session.started_at)) : 0;
    const awayMs = Math.min(durMs, (session.away_ms ?? 0) + openAway);
    return { quality: Math.round(Math.max(0, Math.min(1, 1 - awayMs / durMs)) * 100) / 100, awayMs };
  }

  /** Сервер завершает сессию сам по часовым отметкам. Возвращает итог для события session_completed. */
  function completeSession(room, session, endAt) {
    const factor = room.demo
      ? 1
      : Math.min(eco.maxRewardFactor, Math.max(eco.minRewardFactor, room.focus_sec / (eco.standardFocusMinutes * 60)));
    const { quality, awayMs } = sessionQuality(session, endAt);
    let xp = Math.round(eco.xpPerSession * factor * quality);
    const coins = Math.round(eco.coinsPerSession * factor * quality);

    const rewardedToday = db.get(
      'SELECT COUNT(*) c FROM focus_sessions WHERE user_id = ? AND rewarded = 1 AND ended_at > ?',
      session.user_id, endAt - DAY,
    ).c;
    // Повышенный потолок — только для демо-комнат; обычные комнаты (и на демо-сервере) живут по правилам production
    const capped = rewardedToday >= (room.demo ? eco.demoDailyRewardedSessions : eco.dailyRewardedSessions);

    let boostPct = 0;
    let granted = false;
    if (!capped && xp + coins > 0) {
      const boost = activeBoost(session.user_id, endAt);
      if (boost) {
        const aura = upgradeLevel(boost.source_user_id, 'team_aura');
        boostPct = config.social.boost.xpBonusPct + aura * UPGRADES.team_aura.effect.perLevel;
        xp += Math.round((xp * boostPct) / 100);
        db.run('UPDATE user_effects SET consumed_at = ? WHERE id = ?', endAt, boost.id);
      }
      granted = grant(session.user_id, `focus:${session.id}`, 'focus_session', { xp, coins }, {
        roomId: room.id, sessionId: session.id, boostPct, quality,
      }).granted;
    }
    db.run(
      `UPDATE focus_sessions SET status = 'completed', ended_at = ?, end_reason = ?, rewarded = ?, xp_awarded = ?, coins_awarded = ?,
         quality = ?, away_ms = ?, away_since = NULL, away_kind = NULL WHERE id = ? AND status = 'active'`,
      endAt, capped ? 'daily_cap' : 'finished', granted ? 1 : 0, granted ? xp : 0, granted ? coins : 0, quality, awayMs, session.id,
    );
    const summary = {
      sessionId: session.id, roomId: room.id, status: 'completed', rewarded: granted, capped, xp: granted ? xp : 0, coins: granted ? coins : 0, boostPct,
      quality, awaySec: Math.round(awayMs / 1000), countsForTeam: quality >= eco.quality.teamMin,
    };
    db.emit({ scope: 'user', userId: session.user_id, type: 'session_completed', data: summary });
    return summary;
  }

  // ------------------------------------------------------------------ командное испытание / Road Map
  const roomRow = (roomId) => db.get('SELECT id, mode, cycles, cycle_no FROM rooms WHERE id = ?', roomId) ?? { id: roomId, mode: 'shared', cycles: 4, cycle_no: 0 };
  const mapOf = (room) => buildRoadmap(room.cycles ?? 4);
  const goalPoints = (room) => mapOf(room).nodes.at(-1).requiredPoints;

  const teamName = (key) => (key === 'shared' ? 'Команда' : `Команда ${key}`);
  const teamKeysOf = (room) => (room.mode === 'teams' ? ['A', 'B'] : ['shared']);

  /**
   * Итог цикла для карты: каждая команда делает ОДИН шаг (к следующей остановке-перерыву), если хотя бы половина
   * её участников цикла отфокусировалась качественно (качество ≥ economy.quality.teamMin). Сдавшиеся и пропавшие
   * участники остаются в знаменателе — команда за них «платит». Вклад получают только качественные участники.
   */
  function scoreCycle(room) {
    const sessions = db.all(
      `SELECT s.user_id, s.status, s.quality, m.team_key FROM focus_sessions s
       LEFT JOIN room_members m ON m.room_id = s.room_id AND m.user_id = s.user_id
       WHERE s.room_id = ? AND s.cycle_id = ?`, room.id, room.cycle_id,
    );
    const byTeam = new Map();
    for (const s of sessions) {
      const key = room.mode === 'teams' ? (s.team_key === 'B' ? 'B' : 'A') : 'shared';
      if (!byTeam.has(key)) byTeam.set(key, { total: 0, good: [] });
      const x = byTeam.get(key);
      x.total++;
      if (s.status === 'completed' && (s.quality ?? 1) >= eco.quality.teamMin) x.good.push(s.user_id);
    }
    const advancing = new Map();
    const teams = [];
    for (const [team, x] of byTeam) {
      const ok = x.good.length > 0 && x.good.length * 2 >= x.total;
      teams.push({ team, participants: x.total, focused: x.good.length, advanced: ok });
      if (ok) advancing.set(team, x.good);
    }
    db.emit({ scope: 'room', roomId: room.id, type: 'cycle_scored', data: { cycleNo: room.cycle_no, teams } });
    return addTeamSteps(room, advancing);
  }

  /** Продвигает команды на шаг; сервер сам фиксирует пройденные узлы и выдаёт награды один раз. */
  function addTeamSteps(roomArg, advancing) {
    const room = { ...roomRow(roomArg.id), ...roomArg };
    if (!advancing.size) {
      db.emit({ scope: 'room', roomId: room.id, type: 'roadmap_updated', data: { ...roadmapView(room.id), pointsBefore: null } });
      return null;
    }
    const t = clock.now();
    const map = mapOf(room);
    const lastIdx = map.nodes.length - 1;
    const goal = goalPoints(room);
    const touched = [];
    const everyContributor = new Set();

    for (const [team, ids] of advancing) {
      db.run('INSERT OR IGNORE INTO team_progress(room_id, team_key) VALUES (?,?)', room.id, team);
      const before = db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', room.id, team);
      for (const uid of ids) {
        db.run(
          `INSERT INTO team_contributions(room_id, team_key, user_id, points) VALUES (?,?,?,?)
           ON CONFLICT(room_id, team_key, user_id) DO UPDATE SET points = points + excluded.points`,
          room.id, team, uid, eco.teamPointsPerSession,
        );
      }
      if (before.points < goal) db.run('UPDATE team_progress SET points = points + 1 WHERE room_id = ? AND team_key = ?', room.id, team);
      const after = db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', room.id, team);
      const contributorIds = () => db.all('SELECT user_id FROM team_contributions WHERE room_id = ? AND team_key = ? AND points > 0', room.id, team).map((c) => c.user_id);

      for (const node of map.nodes.filter((n, i) => i > 0 && before.points < n.requiredPoints && after.points >= n.requiredPoints)) {
        const ins = db.run('INSERT OR IGNORE INTO team_nodes(room_id, team_key, node_id, reached_at) VALUES (?,?,?,?)', room.id, team, node.id, t);
        if (ins.changes === 0) continue;
        const isFinal = map.nodes.indexOf(node) === lastIdx;
        if (!isFinal) {
          for (const uid of contributorIds()) grant(uid, `node:${room.id}:${team}:${node.id}`, 'team_node', eco.nodeReward, { roomId: room.id, nodeId: node.id, team });
        }
        db.emit({ scope: 'room', roomId: room.id, type: 'node_reached', data: { team, nodeId: node.id, title: node.title, points: after.points, reward: isFinal ? null : eco.nodeReward } });
      }
      touched.push({ team, before, after, contributorIds });
      contributorIds().forEach((u) => everyContributor.add(u));
    }

    // Победа: первая дошедшая до крепости команда (одновременно — ничья, награду получают обе).
    const decided = db.get('SELECT 1 x FROM team_progress WHERE room_id = ? AND completed_at IS NOT NULL', room.id);
    let winners = [];
    if (!decided) {
      winners = touched.filter((x) => x.after.points >= goal);
      for (const w of winners) {
        db.run('UPDATE team_progress SET completed_at = ? WHERE room_id = ? AND team_key = ? AND completed_at IS NULL', t, room.id, w.team);
        const contributors = w.contributorIds();
        for (const uid of contributors) grant(uid, `challenge:${room.id}:${w.team}`, 'team_challenge', eco.challengeReward, { roomId: room.id, challenge: ROADMAP_ID, team: w.team });
        db.emit({ scope: 'room', roomId: room.id, type: 'challenge_completed', data: { team: w.team, draw: winners.length > 1, roadmapId: ROADMAP_ID, reward: eco.challengeReward, contributors } });
      }
    }
    for (const uid of everyContributor) checkAchievements(uid);
    db.emit({ scope: 'room', roomId: room.id, type: 'roadmap_updated', data: { ...roadmapView(room.id), pointsBefore: touched[0]?.before.points ?? 0 } });
    return { justCompleted: winners.length > 0 };
  }

  /**
   * Состояние карты. Узлы — остановки-перерывы по плану циклов комнаты. В режиме 'teams' верхний уровень описывает
   * команду зрителя, а `teams` содержит обе команды — на одной карте у каждой своя фишка.
   */
  function roadmapView(roomId, viewerId = null) {
    const room = roomRow(roomId);
    const map = mapOf(room);
    const keys = teamKeysOf(room);
    const viewerTeam = viewerId ? db.get('SELECT team_key FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL', roomId, viewerId)?.team_key : null;
    const teamKey = room.mode === 'teams' ? (keys.includes(viewerTeam) ? viewerTeam : 'A') : 'shared';
    const goal = goalPoints(room);
    const lastIdx = map.nodes.length - 1;

    const rows = new Map(keys.map((k) => [k, db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', roomId, k) || { points: 0, completed_at: null }]));
    const posIdx = (points) => Math.max(0, Math.min(lastIdx, points));
    const winnersList = keys.filter((k) => rows.get(k).completed_at);
    const winner = winnersList.length === 0 ? null : winnersList.length === 1 ? winnersList[0] : 'draw';

    const prog = rows.get(teamKey);
    const reachedAt = new Map(db.all('SELECT node_id, reached_at FROM team_nodes WHERE room_id = ? AND team_key = ?', roomId, teamKey).map((r) => [r.node_id, r.reached_at]));
    const reachedIdx = posIdx(prog.points);
    const nextIdx = Math.min(reachedIdx + 1, lastIdx);
    const done = Boolean(prog.completed_at);
    const nodes = map.nodes.map((n, i) => ({
      ...n,
      status: i <= reachedIdx ? (i === reachedIdx && !done && prog.points < goal ? 'current' : 'completed') : i === nextIdx ? 'next' : 'locked',
      challenge: n.type === 'start' ? null : { kind: 'team_focus_cycles', required: n.requiredPoints },
      reachedAt: i === 0 ? null : reachedAt.get(n.id) ?? null,
      reward: n.type === 'start' ? null : i === lastIdx ? eco.challengeReward : eco.nodeReward,
      progress: i <= reachedIdx ? 1 : 0,
    }));
    const from = map.nodes[reachedIdx];
    const to = map.nodes[nextIdx];
    const finished = prog.points >= goal;
    const contributions = db.all(
      `SELECT c.user_id AS userId, u.name, c.points, c.team_key AS team FROM team_contributions c JOIN users u ON u.id = c.user_id
       WHERE c.room_id = ? ORDER BY c.points DESC, u.name`, roomId,
    );
    return {
      roadmapId: map.id,
      title: map.title,
      mode: room.mode,
      teamKey,
      points: prog.points,
      goal,
      // План: сколько циклов (= перерывов = шагов карты) задумано и сколько уже начато
      cycles: { planned: goal, started: room.cycle_no ?? 0 },
      completed: done,
      finished,
      completedAt: prog.completed_at,
      winner,
      reward: eco.challengeReward,
      positionNodeId: from.id,
      // Следующая остановка: один качественный цикл команды = один шаг. Клиент рисует, но не вычисляет
      next: finished || from.id === to.id ? null : { nodeId: to.id, title: to.title, pointsNeeded: to.requiredPoints - prog.points },
      segment: finished || from.id === to.id ? null : { from: from.id, to: to.id, progress: 0 },
      teams: keys.map((k) => ({
        key: k, name: teamName(k), points: rows.get(k).points, positionNodeId: map.nodes[posIdx(rows.get(k).points)].id,
        finished: rows.get(k).points >= goal, completed: Boolean(rows.get(k).completed_at),
      })),
      nodes,
      edges: map.edges,
      contributions: room.mode === 'teams' ? contributions : contributions.map(({ team, ...c }) => c), // eslint-disable-line no-unused-vars
    };
  }

  // ------------------------------------------------------------------ улучшения
  function upgradeLevel(userId, upgradeId) {
    return db.get('SELECT level FROM user_upgrades WHERE user_id = ? AND upgrade_id = ?', userId, upgradeId)?.level ?? 0;
  }

  function listUpgrades(userId) {
    const u = userRow(userId);
    const level = levelForXp(u.xp);
    return Object.values(UPGRADES).map((def) => {
      const lv = upgradeLevel(userId, def.id);
      const maxed = lv >= def.maxLevel;
      return {
        id: def.id, title: def.title, description: def.description, effect: def.effect,
        level: lv, maxLevel: def.maxLevel, minPlayerLevel: def.minLevel,
        nextCost: maxed ? null : upgradeCost(def, lv),
        locked: level < def.minLevel, maxed,
        canBuy: !maxed && level >= def.minLevel && u.coins >= upgradeCost(def, lv),
      };
    });
  }

  function purchaseUpgrade(userId, upgradeId, expectedLevel) {
    const def = UPGRADES[upgradeId];
    if (!def) throw E.notFound('UPGRADE_NOT_FOUND', 'Такого улучшения нет');
    return db.tx(() => {
      if (db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", userId)) {
        throw E.conflict('FOCUS_ACTIVE', 'Во время фокус-сессии игровые покупки недоступны — дождитесь перерыва');
      }
      const u = userRow(userId);
      const current = upgradeLevel(userId, upgradeId);
      if (expectedLevel !== undefined && expectedLevel !== current) {
        throw E.conflict('STALE_LEVEL', 'Уровень улучшения уже изменился', { currentLevel: current });
      }
      if (current >= def.maxLevel) throw E.conflict('MAX_LEVEL', 'Достигнут максимальный уровень улучшения');
      if (levelForXp(u.xp) < def.minLevel) throw E.forbidden('UPGRADE_LOCKED', `Улучшение откроется на ${def.minLevel} уровне`, { requiredLevel: def.minLevel });
      const cost = upgradeCost(def, current);
      spend(userId, `upgrade:${upgradeId}:${current + 1}`, 'upgrade_purchase', cost, { upgradeId, level: current + 1 });
      db.run(
        `INSERT INTO user_upgrades(user_id, upgrade_id, level) VALUES (?,?,?)
         ON CONFLICT(user_id, upgrade_id) DO UPDATE SET level = excluded.level`, userId, upgradeId, current + 1,
      );
      checkAchievements(userId);
      return { upgradeId, level: current + 1, cost, balance: { coins: userRow(userId).coins } };
    });
  }

  /** Производные игровые параметры (задел под Tower Defense): считаются только на сервере. */
  function gameView(roomId) {
    const members = db.all('SELECT user_id FROM room_members WHERE room_id = ? AND left_at IS NULL', roomId).map((m) => m.user_id);
    let wallLevels = 0;
    let towerLevels = 0;
    for (const uid of members) {
      wallLevels += upgradeLevel(uid, 'base_walls');
      towerLevels += upgradeLevel(uid, 'tower_power');
    }
    const road = roadmapView(roomId);
    const maxHp = BASE_HP + wallLevels * UPGRADES.base_walls.effect.perLevel;
    return {
      status: 'see /td', // полное состояние мини-игры — GET /api/rooms/:id/td
      base: { hp: maxHp, maxHp, wallLevels },
      towers: { slots: 1 + Math.floor(road.points / 2), damageMultiplier: 1 + (towerLevels * UPGRADES.tower_power.effect.perLevel) / 100, powerLevels: towerLevels },
      teamPoints: road.points,
      positionNodeId: road.positionNodeId,
    };
  }

  // ------------------------------------------------------------------ достижения
  function stats(userId) {
    const u = userRow(userId);
    const days = db.all('SELECT DISTINCT CAST(ended_at / ? AS INTEGER) d FROM focus_sessions WHERE user_id = ? AND rewarded = 1 ORDER BY d', DAY, userId).map((r) => r.d);
    let best = 0;
    let run = 0;
    days.forEach((d, i) => { run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); });
    return {
      level: levelForXp(u.xp),
      completedSessions: db.get('SELECT COUNT(*) c FROM focus_sessions WHERE user_id = ? AND rewarded = 1', userId).c,
      bestStreakDays: best,
      teamContributions: db.get('SELECT COUNT(*) c FROM team_contributions WHERE user_id = ? AND points > 0', userId).c,
      challengesWon: db.get(
        `SELECT COUNT(*) c FROM team_contributions c JOIN team_progress p ON p.room_id = c.room_id AND p.team_key = c.team_key
         WHERE c.user_id = ? AND c.points > 0 AND p.completed_at IS NOT NULL`, userId).c,
      helpsSent: db.get("SELECT COUNT(*) c FROM social_actions WHERE sender_id = ? AND kind = 'help' AND status = 'applied'", userId).c,
      pranksSent: db.get("SELECT COUNT(*) c FROM social_actions WHERE sender_id = ? AND kind = 'prank' AND status IN ('applied','blocked')", userId).c,
      towersBuilt: db.get("SELECT COUNT(*) c FROM td_actions WHERE user_id = ? AND kind = 'build'", userId).c,
      tdWins: db.get("SELECT COUNT(*) c FROM reward_transactions WHERE user_id = ? AND kind = 'td_round'", userId).c,
      upgradesBought: db.get('SELECT COUNT(*) c FROM user_upgrades WHERE user_id = ? AND level > 0', userId).c,
    };
  }

  /** Выдаёт все новые достижения (награда за достижение — тоже через идемпотентный журнал). */
  function checkAchievements(userId) {
    const unlocked = [];
    for (let guard = 0; guard < 5; guard++) {
      const s = stats(userId);
      let any = false;
      for (const a of Object.values(ACHIEVEMENTS)) {
        if (!a.condition(s)) continue;
        const ins = db.run('INSERT OR IGNORE INTO user_achievements(user_id, achievement_id, unlocked_at) VALUES (?,?,?)', userId, a.id, clock.now());
        if (ins.changes === 0) continue; // уже выдано — повторно не награждаем
        any = true;
        unlocked.push(a.id);
        grant(userId, `ach:${a.id}`, 'achievement', a.reward, { achievementId: a.id });
        db.emit({ scope: 'user', userId, type: 'achievement_unlocked', data: { id: a.id, title: a.title, description: a.description, reward: a.reward } });
      }
      if (!any) break;
    }
    return unlocked;
  }

  function listAchievements(userId) {
    const have = new Map(db.all('SELECT achievement_id id, unlocked_at t FROM user_achievements WHERE user_id = ?', userId).map((r) => [r.id, r.t]));
    return Object.values(ACHIEVEMENTS).map((a) => ({
      id: a.id, title: a.title, description: a.description, reward: a.reward,
      unlocked: have.has(a.id), unlockedAt: have.get(a.id) ?? null,
    }));
  }

  function effects(userId) {
    const t = clock.now();
    return db.all(
      'SELECT id, kind, source_user_id AS sourceUserId, created_at AS createdAt, expires_at AS expiresAt FROM user_effects WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY id',
      userId, t,
    );
  }

  // ------------------------------------------------------------------ статистика занятий
  // Время концентрации считается только по завершённым сессиям и только по серверным меткам времени.
  const FOCUS_SEC = 'MIN(duration_sec, (ended_at - started_at) / 1000)';

  function focusTotals(userId) {
    const r = db.get(
      `SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed,
              SUM(CASE WHEN status IN ('aborted','abandoned') THEN 1 ELSE 0 END) interrupted,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN ${FOCUS_SEC} ELSE 0 END), 0) focus
       FROM focus_sessions WHERE user_id = ?`, userId,
    );
    return { completed: r.completed ?? 0, interrupted: r.interrupted ?? 0, focusSeconds: r.focus ?? 0 };
  }

  /**
   * Личная статистика: сессии, время концентрации (всего / сегодня / по дням), уровень, достижения, соцдействия.
   * tzOffsetMin — смещение часового пояса клиента (минуты к UTC), только чтобы правильно резать сутки.
   */
  function studyStats(userId, { tzOffsetMin = 0, days = 7 } = {}) {
    const u = userRow(userId);
    const t = clock.now();
    const s = stats(userId);
    const totals = focusTotals(userId);
    const tz = tzOffsetMin * 60_000;
    const today = Math.floor((t + tz) / DAY);
    const from = (today - (days - 1)) * DAY - tz;
    const daily = Array.from({ length: days }, (_, i) => ({ dayStart: (today - (days - 1) + i) * DAY - tz, focusSeconds: 0, sessions: 0 }));
    for (const r of db.all(`SELECT ended_at e, ${FOCUS_SEC} s FROM focus_sessions WHERE user_id = ? AND status = 'completed' AND ended_at >= ?`, userId, from)) {
      const i = Math.floor((r.e + tz) / DAY) - (today - (days - 1));
      if (i >= 0 && i < days) { daily[i].focusSeconds += r.s; daily[i].sessions += 1; }
    }
    const achievements = listAchievements(userId);
    return {
      userId, name: u.name, ...levelInfo(u.xp), coins: u.coins,
      sessions: {
        completed: totals.completed,
        rewarded: s.completedSessions,
        interrupted: totals.interrupted,
        focusSeconds: totals.focusSeconds,
        averageSeconds: totals.completed ? Math.round(totals.focusSeconds / totals.completed) : 0,
        todayFocusSeconds: daily[days - 1].focusSeconds,
        todaySessions: daily[days - 1].sessions,
      },
      bestStreakDays: s.bestStreakDays,
      social: {
        helpsSent: s.helpsSent,
        pranksSent: s.pranksSent,
        helpsReceived: db.get("SELECT COUNT(*) c FROM social_actions WHERE target_id = ? AND kind = 'help'", userId).c,
        pranksReceived: db.get("SELECT COUNT(*) c FROM social_actions WHERE target_id = ? AND kind = 'prank'", userId).c,
      },
      achievements: { unlocked: achievements.filter((a) => a.unlocked).length, total: achievements.length },
      daily,
    };
  }

  /** Командный прогресс комнаты: очки команд по карте и вклад каждого участника (сессии, время, очки). */
  function roomStats(roomId) {
    const room = db.get('SELECT * FROM rooms WHERE id = ?', roomId);
    const road = roadmapView(roomId);
    const per = new Map(db.all(
      `SELECT user_id,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed,
              SUM(CASE WHEN status IN ('aborted','abandoned') THEN 1 ELSE 0 END) interrupted,
              COALESCE(SUM(CASE WHEN status = 'completed' THEN ${FOCUS_SEC} ELSE 0 END), 0) focus
       FROM focus_sessions WHERE room_id = ? GROUP BY user_id`, roomId,
    ).map((r) => [r.user_id, r]));
    const points = new Map(db.all('SELECT user_id, SUM(points) p FROM team_contributions WHERE room_id = ? GROUP BY user_id', roomId).map((r) => [r.user_id, r.p]));
    const members = db.all(
      `SELECT m.user_id AS userId, u.name, m.team_key AS team FROM room_members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.rowid`, roomId,
    ).map((m) => {
      const r = per.get(m.userId);
      return { ...m, completedSessions: r?.completed ?? 0, interruptedSessions: r?.interrupted ?? 0, focusSeconds: r?.focus ?? 0, points: points.get(m.userId) ?? 0 };
    });
    const teams = road.teams.map((tm) => {
      const list = members.filter((m) => room.mode !== 'teams' || m.team === tm.key);
      return {
        key: tm.key, name: tm.name, points: tm.points, goal: road.goal, finished: tm.finished, completed: tm.completed,
        positionNodeId: tm.positionNodeId,
        completedSessions: list.reduce((a, m) => a + m.completedSessions, 0),
        focusSeconds: list.reduce((a, m) => a + m.focusSeconds, 0),
        members: list,
      };
    });
    return {
      roomId, mode: room.mode, cycles: room.cycle_no, goal: road.goal, winner: road.winner, teams,
      totals: { completedSessions: members.reduce((a, m) => a + m.completedSessions, 0), focusSeconds: members.reduce((a, m) => a + m.focusSeconds, 0) },
    };
  }

  function progress(userId) {
    const u = userRow(userId);
    const s = stats(userId);
    const totals = focusTotals(userId);
    return {
      userId, name: u.name, ...levelInfo(u.xp), coins: u.coins, prankEnabled: Boolean(u.prank_enabled),
      stats: {
        completedSessions: s.completedSessions, bestStreakDays: s.bestStreakDays, helpsSent: s.helpsSent, pranksSent: s.pranksSent,
        focusSeconds: totals.focusSeconds, interruptedSessions: totals.interrupted,
      },
      upgrades: listUpgrades(userId),
      achievements: listAchievements(userId),
      effects: effects(userId),
    };
  }

  return {
    levelInfo, grant, spend, completeSession, scoreCycle, addTeamSteps, roadmapView, gameView,
    listUpgrades, purchaseUpgrade, upgradeLevel, checkAchievements, listAchievements, progress, effects, stats,
    studyStats, roomStats,
  };
}
