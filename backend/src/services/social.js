import { HELP_TYPES, PRANK_TYPES } from '../catalog.js';
import { E } from '../errors.js';
import { reqObject, reqString } from '../validate.js';

const DAY = 86_400_000;

/**
 * Помощь (баффы своей команде) и шутки (дебаффы команде соперника). Правила (все проверяет сервер):
 *  - только во время перерыва комнаты (в Focus — 409 WRONG_PHASE): фокус шутки не трогают;
 *  - только между участниками одной комнаты, не себе;
 *  - шутки — игровая механика, выключить их нельзя. В режиме Team A/B шутка летит в игрока команды соперника
 *    и действует на всю его команду: ослабляет её башни в Tower Defense до конца эффекта (не дольше перерыва);
 *    в общем режиме (одна команда) это короткий визуальный эффект у получателя;
 *  - кулдаун, лимит за перерыв, один тип на одного получателя за перерыв; «Щит» любого игрока команды поглощает шутку;
 *  - помощь: «Бонус» (+XP к следующей сессии) и «Щит» (стоит монет) — только своей команде.
 */
export function createSocialService(ctx, game, rooms) {
  const { db, clock, config } = ctx;
  const cfg = config.social;

  function resolve(user, roomKey, body) {
    const b = reqObject(body);
    const type = reqString(b.type, 'type', { min: 1, max: 20 });
    const targetId = reqString(b.targetUserId, 'targetUserId', { min: 1, max: 64 });
    const room = rooms.findRoom(roomKey);
    rooms.requireMember(room, user);
    rooms.requirePhase(room, 'break');
    if (targetId === user.id) throw E.badRequest('SELF_TARGET', 'Нельзя выбрать себя целью');
    const target = db.get(
      'SELECT u.* FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? AND m.user_id = ? AND m.left_at IS NULL', room.id, targetId,
    );
    if (!target) throw E.notFound('TARGET_NOT_IN_ROOM', 'Получатель не найден в этой комнате');
    if (db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", user.id)) throw E.conflict('FOCUS_ACTIVE', 'Вы сейчас в фокус-сессии');
    return { room, type, target };
  }

  const teamOf = (room, userId) => db.get('SELECT team_key FROM room_members WHERE room_id = ? AND user_id = ?', room.id, userId)?.team_key;

  const sentThisCycle = (room, senderId, kind, type, targetId) =>
    db.get(
      `SELECT COUNT(*) c FROM social_actions WHERE room_id = ? AND cycle_id IS ? AND sender_id = ? AND kind = ?
       AND (? IS NULL OR type = ?) AND (? IS NULL OR target_id = ?)`,
      room.id, room.cycle_id, senderId, kind, type ?? null, type ?? null, targetId ?? null, targetId ?? null,
    ).c;

  function help(user, roomKey, body) {
    return db.tx(() => {
      const { room, type, target } = resolve(user, roomKey, body);
      if (!HELP_TYPES.includes(type)) throw E.badRequest('UNKNOWN_HELP_TYPE', 'Неизвестный тип помощи', { allowed: HELP_TYPES });
      if (room.mode === 'teams') {
        const mine = db.get('SELECT team_key FROM room_members WHERE room_id = ? AND user_id = ?', room.id, user.id)?.team_key;
        const theirs = db.get('SELECT team_key FROM room_members WHERE room_id = ? AND user_id = ?', room.id, target.id)?.team_key;
        if (mine !== theirs) throw E.conflict('NOT_TEAMMATE', 'Помогать можно только игрокам своей команды');
      }
      const t = clock.now();
      const today = db.get("SELECT COUNT(*) c FROM social_actions WHERE sender_id = ? AND kind = 'help' AND created_at > ?", user.id, t - DAY).c;
      if (today >= cfg.helpDailyLimit) throw E.tooMany('HELP_DAILY_LIMIT', 'Дневной лимит помощи исчерпан');
      if (sentThisCycle(room, user.id, 'help', type, target.id) > 0) throw E.conflict('ALREADY_SENT', 'Этому игроку вы уже отправляли такую помощь в этот перерыв');

      let cost = 0;
      if (type === 'boost') {
        if (db.get("SELECT 1 x FROM user_effects WHERE user_id = ? AND kind = 'boost' AND consumed_at IS NULL AND expires_at > ?", target.id, t)) {
          throw E.conflict('EFFECT_ACTIVE', 'У игрока уже есть активный бонус');
        }
        const aura = game.upgradeLevel(user.id, 'team_aura');
        db.run("INSERT INTO user_effects(user_id, kind, source_user_id, room_id, created_at, expires_at) VALUES (?,?,?,?,?,?)", target.id, 'boost', user.id, room.id, t, t + cfg.boost.ttlMs);
        var detail = { xpBonusPct: cfg.boost.xpBonusPct + aura * 5, expiresAt: t + cfg.boost.ttlMs };
      } else {
        if (db.get("SELECT 1 x FROM user_effects WHERE user_id = ? AND kind = 'shield' AND consumed_at IS NULL AND expires_at > ?", target.id, t)) {
          throw E.conflict('EFFECT_ACTIVE', 'У игрока уже есть активный щит');
        }
        cost = cfg.shield.cost;
        const id = db.run('INSERT INTO social_actions(room_id, cycle_id, kind, type, sender_id, target_id, status, cost_coins, created_at) VALUES (?,?,?,?,?,?,?,?,?)', room.id, room.cycle_id, 'help', type, user.id, target.id, 'applied', cost, t).lastInsertRowid;
        game.spend(user.id, `help:${id}`, 'help_cost', cost, { roomId: room.id, targetId: target.id, type });
        db.run("INSERT INTO user_effects(user_id, kind, source_user_id, room_id, created_at, expires_at) VALUES (?,?,?,?,?,?)", target.id, 'shield', user.id, room.id, t, t + cfg.shield.ttlMs);
        detail = { expiresAt: t + cfg.shield.ttlMs };
        return finishHelp(room, user, target, type, cost, detail, id, t);
      }
      const id = db.run('INSERT INTO social_actions(room_id, cycle_id, kind, type, sender_id, target_id, status, cost_coins, created_at) VALUES (?,?,?,?,?,?,?,?,?)', room.id, room.cycle_id, 'help', type, user.id, target.id, 'applied', cost, t).lastInsertRowid;
      return finishHelp(room, user, target, type, cost, detail, id, t);
    });
  }

  function finishHelp(room, user, target, type, cost, detail, id, t) {
    game.checkAchievements(user.id);
    const data = { actionId: Number(id), type, from: user.id, to: target.id, cost, ...detail, at: t };
    db.emit({ scope: 'room', roomId: room.id, type: 'help_applied', data });
    return { applied: true, ...data };
  }

  function prank(user, roomKey, body) {
    return db.tx(() => {
      const { room, type, target } = resolve(user, roomKey, body);
      if (!PRANK_TYPES.includes(type)) throw E.badRequest('UNKNOWN_PRANK_TYPE', 'Неизвестный тип пакости', { allowed: PRANK_TYPES });
      const teams = room.mode === 'teams';
      const targetTeam = teams ? teamOf(room, target.id) : null;
      if (teams && targetTeam === teamOf(room, user.id)) throw E.conflict('NOT_RIVAL', 'Шутки летят только в команду соперника');
      const t = clock.now();
      if (db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", target.id)) {
        throw E.conflict('TARGET_FOCUSING', 'Получатель сейчас занимается — пакости ему не отправляются');
      }
      const last = db.get("SELECT created_at t FROM social_actions WHERE sender_id = ? AND kind = 'prank' ORDER BY id DESC LIMIT 1", user.id);
      const cooldownMs = room.demo ? cfg.prank.demoCooldownMs : cfg.prank.cooldownMs; // короткий кулдаун — только в демо-комнатах
      if (last && t - last.t < cooldownMs) {
        throw E.tooMany('PRANK_COOLDOWN', 'Слишком часто', { retryAfterMs: cooldownMs - (t - last.t) });
      }
      if (sentThisCycle(room, user.id, 'prank') >= cfg.prank.maxPerBreak) throw E.tooMany('PRANK_BREAK_LIMIT', 'Лимит пакостей за перерыв исчерпан');
      if (sentThisCycle(room, user.id, 'prank', type, target.id) > 0) throw E.conflict('ALREADY_SENT', 'Этот эффект вы уже отправляли этому игроку в этот перерыв');

      // Щит: в командах — любой активный щит игрока команды-цели, в общем режиме — щит самого получателя
      const shield = teams
        ? db.get(
          `SELECT e.* FROM user_effects e JOIN room_members m ON m.user_id = e.user_id AND m.room_id = ? AND m.left_at IS NULL AND m.team_key = ?
           WHERE e.kind = 'shield' AND e.consumed_at IS NULL AND e.expires_at > ? ORDER BY e.id LIMIT 1`, room.id, targetTeam, t)
        : db.get("SELECT * FROM user_effects WHERE user_id = ? AND kind = 'shield' AND consumed_at IS NULL AND expires_at > ? ORDER BY id LIMIT 1", target.id, t);
      const blocked = Boolean(shield);
      if (shield) db.run('UPDATE user_effects SET consumed_at = ? WHERE id = ?', t, shield.id);
      // Эффект никогда не «протекает» в Focus: заканчивается не позже конца перерыва.
      const endsAt = blocked ? null : Math.min(t + cfg.prank.types[type].durationMs, room.phase_ends_at);
      const id = db.run(
        'INSERT INTO social_actions(room_id, cycle_id, kind, type, sender_id, target_id, status, created_at, effect_ends_at) VALUES (?,?,?,?,?,?,?,?,?)',
        room.id, room.cycle_id, 'prank', type, user.id, target.id, blocked ? 'blocked' : 'applied', t, endsAt,
      ).lastInsertRowid;
      game.checkAchievements(user.id);
      const debuff = teams ? cfg.prank.types[type].debuff ?? null : null;
      const data = { actionId: Number(id), type, from: user.id, to: target.id, team: targetTeam, debuff, blocked, effectEndsAt: endsAt, at: t };
      db.emit({ scope: 'room', roomId: room.id, type: 'prank_applied', data });
      return { applied: !blocked, ...data };
    });
  }

  function recent(user, roomKey) {
    const room = rooms.findRoom(roomKey);
    rooms.requireMember(room, user);
    return db.all(
      `SELECT id, kind, type, sender_id AS fromUserId, target_id AS toUserId, status, created_at AS at, effect_ends_at AS effectEndsAt
       FROM social_actions WHERE room_id = ? ORDER BY id DESC LIMIT 30`, room.id,
    );
  }

  return { help, prank, recent };
}
