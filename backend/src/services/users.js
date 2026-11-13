import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { E } from '../errors.js';
import { reqBool, reqObject, reqString } from '../validate.js';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createUsersService(ctx, game) {
  const { db, clock, config } = ctx;

  const publicUser = (row) => ({ id: row.id, name: row.name, level: game.levelInfo(row.xp).level });

  /**
   * Регистрация. Токен выдаётся один раз и хранится только в виде хеша.
   * sandbox:true — песочный аккаунт для демо-комнат; создаётся только на сервере в демо-режиме.
   */
  function create(body) {
    const b = reqObject(body);
    const name = reqString(b.name, 'name', { min: 1, max: config.limits.userNameMax });
    const sandbox = b.sandbox === undefined ? false : reqBool(b.sandbox, 'sandbox');
    if (sandbox && !config.demoMode) throw E.forbidden('DEMO_DISABLED', 'Демо-режим выключен на сервере');
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const t = clock.now();
    db.run('INSERT INTO users(id, name, token_hash, created_at, last_seen_at, sandbox) VALUES (?,?,?,?,?,?)', id, name, hashToken(token), t, t, sandbox ? 1 : 0);
    return { user: me(id), token };
  }

  /**
   * Токен → пользователь. Каждый авторизованный запрос обновляет присутствие (heartbeat).
   * Песочный аккаунт без демо-режима сервера не существует: его токен не авторизуется (REST 401, WS 4401).
   */
  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = db.get('SELECT * FROM users WHERE token_hash = ?', hashToken(token));
    if (!row) return null;
    if (row.sandbox && !config.demoMode) return null;
    touch(row.id);
    return db.get('SELECT * FROM users WHERE id = ?', row.id);
  }

  function touch(userId) {
    db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', clock.now(), userId);
  }

  function me(userId) {
    const row = db.get('SELECT * FROM users WHERE id = ?', userId);
    const activeSession = db.get("SELECT id, room_id AS roomId, scheduled_end_at AS scheduledEndAt FROM focus_sessions WHERE user_id = ? AND status = 'active'", userId);
    const rooms = db.all(
      `SELECT r.id, r.code, r.name, r.phase FROM room_members m JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = ? AND m.left_at IS NULL AND r.phase != 'completed' ORDER BY m.joined_at`, userId,
    );
    return {
      id: row.id, name: row.name, ...game.levelInfo(row.xp), coins: row.coins,
      prankEnabled: Boolean(row.prank_enabled), sandbox: Boolean(row.sandbox), createdAt: row.created_at,
      activeSession: activeSession ?? null, rooms,
    };
  }

  function update(userId, body) {
    const b = reqObject(body);
    if (b.name !== undefined) db.run('UPDATE users SET name = ? WHERE id = ?', reqString(b.name, 'name', { min: 1, max: config.limits.userNameMax }), userId);
    if (b.prankEnabled !== undefined) db.run('UPDATE users SET prank_enabled = ? WHERE id = ?', reqBool(b.prankEnabled, 'prankEnabled') ? 1 : 0, userId);
    // имя и «получать шутки» видны всей комнате: остальные сразу получают свежий снимок
    if (b.name !== undefined || b.prankEnabled !== undefined) {
      for (const r of db.all('SELECT room_id FROM room_members WHERE user_id = ? AND left_at IS NULL', userId)) {
        db.emit({ scope: 'room_state', roomId: r.room_id });
      }
    }
    return me(userId);
  }

  function sessions(userId, query) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return db.all(
      `SELECT s.id, s.room_id AS roomId, r.name AS roomName, s.cycle_no AS cycleNo, s.task_title AS task, s.status, s.end_reason AS endReason,
              s.started_at AS startedAt, s.ended_at AS endedAt, s.scheduled_end_at AS scheduledEndAt, s.duration_sec AS durationSec,
              s.result, s.result_note AS resultNote, s.rewarded, s.xp_awarded AS xp, s.coins_awarded AS coins
       FROM focus_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.user_id = ? ORDER BY s.started_at DESC, s.rowid DESC LIMIT ? OFFSET ?`,
      userId, limit, offset,
    ).map((s) => ({ ...s, rewarded: Boolean(s.rewarded) }));
  }

  function transactions(userId, query) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    return db.all('SELECT id, key, kind, xp, coins, created_at AS createdAt FROM reward_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
  }

  return { create, authenticate, touch, me, update, sessions, transactions, publicUser };
}
