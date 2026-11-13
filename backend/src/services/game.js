import { ACHIEVEMENTS, BASE_HP, ROADMAP, UPGRADES, levelForXp, upgradeCost, xpForLevel } from '../catalog.js';
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
      throw E.conflict('INSUFFICIENT_FUNDS', 'Недостаточно Tomato Coins', { required: coins, balance: userRow(userId).coins });
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

  /** Сервер завершает сессию сам по часовым отметкам. Возвращает итог для события session_completed. */
  function completeSession(room, session, endAt) {
    const factor = room.demo
      ? 1
      : Math.min(eco.maxRewardFactor, Math.max(eco.minRewardFactor, room.focus_sec / (eco.standardFocusMinutes * 60)));
    let xp = Math.round(eco.xpPerSession * factor);
    const coins = Math.round(eco.coinsPerSession * factor);

    const rewardedToday = db.get(
      'SELECT COUNT(*) c FROM focus_sessions WHERE user_id = ? AND rewarded = 1 AND ended_at > ?',
      session.user_id, endAt - DAY,
    ).c;
    const capped = rewardedToday >= eco.dailyRewardedSessions;

    let boostPct = 0;
    let granted = false;
    if (!capped) {
      const boost = activeBoost(session.user_id, endAt);
      if (boost) {
        const aura = upgradeLevel(boost.source_user_id, 'team_aura');
        boostPct = config.social.boost.xpBonusPct + aura * UPGRADES.team_aura.effect.perLevel;
        xp += Math.round((xp * boostPct) / 100);
        db.run('UPDATE user_effects SET consumed_at = ? WHERE id = ?', endAt, boost.id);
      }
      granted = grant(session.user_id, `focus:${session.id}`, 'focus_session', { xp, coins }, {
        roomId: room.id, sessionId: session.id, boostPct,
      }).granted;
    }
    db.run(
      `UPDATE focus_sessions SET status = 'completed', ended_at = ?, end_reason = ?, rewarded = ?, xp_awarded = ?, coins_awarded = ? WHERE id = ? AND status = 'active'`,
      endAt, capped ? 'daily_cap' : 'finished', granted ? 1 : 0, granted ? xp : 0, granted ? coins : 0, session.id,
    );
    const summary = { sessionId: session.id, roomId: room.id, status: 'completed', rewarded: granted, capped, xp: granted ? xp : 0, coins: granted ? coins : 0, boostPct };
    db.emit({ scope: 'user', userId: session.user_id, type: 'session_completed', data: summary });
    return summary;
  }

  // ------------------------------------------------------------------ командное испытание / Road Map
  function goalPoints() {
    return ROADMAP.nodes[ROADMAP.nodes.length - 1].requiredPoints;
  }

  /** Добавляет очки команде за награждённые сессии. Если цель достигнута — выдаёт командную награду один раз. */
  function addTeamPoints(room, userIds) {
    if (!userIds.length) return null;
    const team = 'shared';
    const t = clock.now();
    db.run('INSERT OR IGNORE INTO team_progress(room_id, team_key) VALUES (?,?)', room.id, team);
    const before = db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', room.id, team);
    for (const uid of userIds) {
      db.run(
        `INSERT INTO team_contributions(room_id, team_key, user_id, points) VALUES (?,?,?,?)
         ON CONFLICT(room_id, team_key, user_id) DO UPDATE SET points = points + excluded.points`,
        room.id, team, uid, eco.teamPointsPerSession,
      );
    }
    const added = userIds.length * eco.teamPointsPerSession;
    db.run('UPDATE team_progress SET points = points + ? WHERE room_id = ? AND team_key = ?', added, room.id, team);
    const after = db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', room.id, team);

    let justCompleted = false;
    if (after.points >= goalPoints() && !after.completed_at) {
      db.run('UPDATE team_progress SET completed_at = ? WHERE room_id = ? AND team_key = ? AND completed_at IS NULL', t, room.id, team);
      justCompleted = true;
      const contributors = db.all('SELECT user_id FROM team_contributions WHERE room_id = ? AND team_key = ? AND points > 0', room.id, team);
      for (const c of contributors) {
        grant(c.user_id, `challenge:${room.id}:${team}`, 'team_challenge', eco.challengeReward, { roomId: room.id, challenge: ROADMAP.id });
      }
      db.emit({ scope: 'room', roomId: room.id, type: 'challenge_completed', data: { roadmapId: ROADMAP.id, reward: eco.challengeReward, contributors: contributors.map((c) => c.user_id) } });
    }
    for (const uid of userIds) checkAchievements(uid);
    if (justCompleted) {
      for (const c of db.all('SELECT user_id FROM team_contributions WHERE room_id = ? AND points > 0', room.id)) checkAchievements(c.user_id);
    }
    db.emit({ scope: 'room', roomId: room.id, type: 'roadmap_updated', data: { pointsBefore: before.points, ...roadmapView(room.id) } });
    return { justCompleted };
  }

  function roadmapView(roomId, teamKey = 'shared') {
    const prog = db.get('SELECT * FROM team_progress WHERE room_id = ? AND team_key = ?', roomId, teamKey) || { points: 0, completed_at: null };
    const goal = goalPoints();
    let reachedIdx = 0;
    ROADMAP.nodes.forEach((n, i) => { if (prog.points >= n.requiredPoints) reachedIdx = i; });
    const nextIdx = Math.min(reachedIdx + 1, ROADMAP.nodes.length - 1);
    const nodes = ROADMAP.nodes.map((n, i) => ({
      ...n,
      status: i <= reachedIdx ? (i === reachedIdx && !prog.completed_at ? 'current' : 'completed') : i === nextIdx ? 'next' : 'locked',
      challenge: n.type === 'start' ? null : { kind: 'team_focus_points', required: n.requiredPoints },
    }));
    const contributions = db.all(
      `SELECT c.user_id AS userId, u.name, c.points FROM team_contributions c JOIN users u ON u.id = c.user_id
       WHERE c.room_id = ? AND c.team_key = ? ORDER BY c.points DESC, u.name`, roomId, teamKey,
    );
    return {
      roadmapId: ROADMAP.id,
      title: ROADMAP.title,
      teamKey,
      points: prog.points,
      goal,
      completed: Boolean(prog.completed_at),
      completedAt: prog.completed_at,
      reward: eco.challengeReward,
      positionNodeId: ROADMAP.nodes[reachedIdx].id,
      nodes,
      edges: ROADMAP.edges,
      contributions,
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
      status: 'preview', // полноценной Tower Defense пока нет: см. docs/FRONTEND_INTEGRATION.md
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

  function progress(userId) {
    const u = userRow(userId);
    const s = stats(userId);
    return {
      userId, name: u.name, ...levelInfo(u.xp), coins: u.coins, prankEnabled: Boolean(u.prank_enabled),
      stats: { completedSessions: s.completedSessions, bestStreakDays: s.bestStreakDays, helpsSent: s.helpsSent, pranksSent: s.pranksSent },
      upgrades: listUpgrades(userId),
      achievements: listAchievements(userId),
      effects: effects(userId),
    };
  }

  return {
    levelInfo, grant, spend, completeSession, addTeamPoints, roadmapView, gameView,
    listUpgrades, purchaseUpgrade, upgradeLevel, checkAchievements, listAchievements, progress, effects, stats,
  };
}
