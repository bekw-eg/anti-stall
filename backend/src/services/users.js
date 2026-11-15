import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { E } from '../errors.js';
import { reqBool, reqObject, reqString } from '../validate.js';
import { avatarOf, parseAvatar, unlockedOf } from '../avatar.js';

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
    const h = hashToken(token);
    // основной токен (выдан при регистрации) или дополнительный — с другого устройства (перенос аккаунта)
    const row = db.get('SELECT * FROM users WHERE token_hash = ?', h)
      ?? db.get('SELECT u.* FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', h);
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
      prankEnabled: Boolean(row.prank_enabled), sandbox: Boolean(row.sandbox), createdAt: row.created_at, avatar: avatarOf(row), login: row.login ?? null,
      avatarUnlocked: unlockedOf(game.levelInfo(row.xp).level, game.stats(row.id)),
      activeSession: activeSession ?? null, rooms,
    };
  }

  function update(userId, body) {
    const b = reqObject(body);
    if (b.name !== undefined) db.run('UPDATE users SET name = ? WHERE id = ?', reqString(b.name, 'name', { min: 1, max: config.limits.userNameMax }), userId);
    if (b.prankEnabled !== undefined) db.run('UPDATE users SET prank_enabled = ? WHERE id = ?', reqBool(b.prankEnabled, 'prankEnabled') ? 1 : 0, userId);
    if (b.avatar !== undefined) {
      const row = db.get('SELECT xp FROM users WHERE id = ?', userId);
      db.run('UPDATE users SET avatar = ? WHERE id = ?', JSON.stringify(parseAvatar(b.avatar, game.levelInfo(row.xp).level, game.stats(userId))), userId);
    }
    // имя, «получать шутки» и образ видны всей комнате: остальные сразу получают свежий снимок
    if (b.name !== undefined || b.prankEnabled !== undefined || b.avatar !== undefined) {
      for (const r of db.all('SELECT room_id FROM room_members WHERE user_id = ? AND left_at IS NULL', userId)) {
        db.emit({ scope: 'room_state', roomId: r.room_id });
      }
    }
    return me(userId);
  }

  // ------------------------------------------------------------------ перенос аккаунта на другое устройство
  // Аккаунт гостевой: вход — это токен в браузере. Чтобы открыть тот же аккаунт на телефоне, на старом устройстве
  // берут одноразовый код (живёт 10 минут), на новом вводят его — новое устройство получает свой токен.
  // Код хранится только в виде хеша; у пользователя не больше одного активного кода.
  const TRANSFER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const normCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function transferCode(userId) {
    // гость одноразовый: переносить на другое устройство можно только аккаунт с логином
    if (!db.get('SELECT login FROM users WHERE id = ?', userId)?.login) throw E.forbidden('ACCOUNT_REQUIRED', 'Перенос — только для зарегистрированных: задайте логин и пароль');
    const t = clock.now();
    const raw = Array.from({ length: 9 }, () => TRANSFER_ALPHABET[randomInt(TRANSFER_ALPHABET.length)]).join('');
    db.run('DELETE FROM transfer_codes WHERE user_id = ? AND used_at IS NULL', userId);
    db.run('INSERT INTO transfer_codes(code_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', hashToken(raw), userId, t, t + config.transfer.codeTtlMs);
    return { code: `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`, expiresAt: t + config.transfer.codeTtlMs };
  }
  function redeemTransfer(body) {
    const b = reqObject(body);
    const code = normCode(reqString(b.code, 'code', { min: 9, max: 20 }));
    return db.tx(() => {
      const t = clock.now();
      const row = db.get('SELECT * FROM transfer_codes WHERE code_hash = ?', hashToken(code));
      if (!row || row.used_at || row.expires_at <= t) throw E.notFound('TRANSFER_CODE_INVALID', 'Код не подошёл или устарел — возьмите новый на старом устройстве');
      const user = db.get('SELECT * FROM users WHERE id = ?', row.user_id);
      if (user.sandbox && !config.demoMode) throw E.forbidden('DEMO_DISABLED', 'Демо-режим выключен на сервере');
      db.run('UPDATE transfer_codes SET used_at = ? WHERE code_hash = ?', t, row.code_hash);
      const token = randomBytes(32).toString('base64url');
      db.run('INSERT INTO user_tokens(token_hash, user_id, created_at) VALUES (?,?,?)', hashToken(token), user.id, t);
      return { user: me(user.id), token };
    });
  }

  // ------------------------------------------------------------------ полноценный аккаунт: логин и пароль
  // Гость может в любой момент закрепить аккаунт логином и паролем — и входить с любого устройства.
  // Пароль хранится только как scrypt с солью — без почты и персональных данных.
  const LOGIN_RE = /^[a-z0-9._-]{3,24}$/;
  const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ['scrypt', salt, scryptSync(password, salt, 32).toString('hex')].join(':');
  const checkPassword = (password, stored) => {
    const [kind, salt, hash] = String(stored ?? '').split(':');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const a = Buffer.from(hash, 'hex');
    const b = scryptSync(password, salt, 32);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const reqLogin = (v) => {
    const value = reqString(v, 'login', { min: 3, max: 24 }).toLowerCase();
    if (!LOGIN_RE.test(value)) throw E.badRequest('INVALID_FIELD', 'Логин: 3–24 символа — латиница, цифры, точка, дефис, подчёркивание', { field: 'login' });
    return value;
  };
  const reqPassword = (v) => {
    if (typeof v !== 'string' || v.length < 8 || v.length > 72) throw E.badRequest('INVALID_FIELD', 'Пароль: от 8 до 72 символов', { field: 'password' });
    return v;
  };

  /** Закрепить аккаунт: задать логин и пароль (один раз); потом — только смена пароля с текущим паролем. */
  function setCredentials(userId, body) {
    const b = reqObject(body);
    return db.tx(() => {
      const row = db.get('SELECT * FROM users WHERE id = ?', userId);
      if (row.login) {
        if (typeof b.currentPassword !== 'string' || !checkPassword(b.currentPassword, row.password_hash)) throw E.forbidden('WRONG_PASSWORD', 'Текущий пароль не подходит');
        db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(reqPassword(b.password)), userId);
        return me(userId);
      }
      const value = reqLogin(b.login);
      const password = reqPassword(b.password);
      if (db.get('SELECT 1 x FROM users WHERE login = ?', value)) throw E.conflict('LOGIN_TAKEN', 'Такой логин уже занят');
      db.run('UPDATE users SET login = ?, password_hash = ? WHERE id = ?', value, hashPassword(password), userId);
      return me(userId);
    });
  }

  /** Вход по логину и паролю: новое устройство получает свой токен; после 10 ошибок логин блокируется на 15 минут. */
  const failures = new Map(); // логин → { count, until }
  function login(body) {
    const b = reqObject(body);
    const name = reqString(b.login, 'login', { min: 1, max: 64 }).toLowerCase();
    const t = clock.now();
    const f = failures.get(name);
    if (f && f.until > t) throw E.tooMany('LOGIN_LOCKED', 'Слишком много попыток — попробуйте через 15 минут');
    const row = db.get('SELECT * FROM users WHERE login = ?', name);
    const ok = Boolean(row) && typeof b.password === 'string' && checkPassword(b.password, row.password_hash);
    if (!ok) {
      const count = (f?.count ?? 0) + 1;
      failures.set(name, { count, until: count >= config.auth.maxFailures ? t + config.auth.lockMs : 0 });
      throw E.forbidden('WRONG_CREDENTIALS', 'Неверный логин или пароль');
    }
    failures.delete(name);
    if (row.sandbox && !config.demoMode) throw E.forbidden('DEMO_DISABLED', 'Демо-режим выключен на сервере');
    const token = randomBytes(32).toString('base64url');
    db.run('INSERT INTO user_tokens(token_hash, user_id, created_at) VALUES (?,?,?)', hashToken(token), row.id, t);
    return { user: me(row.id), token };
  }

  function sessions(userId, query) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return db.all(
      `SELECT s.id, s.room_id AS roomId, r.name AS roomName, s.cycle_no AS cycleNo, s.task_title AS task, s.status, s.end_reason AS endReason,
              s.started_at AS startedAt, s.ended_at AS endedAt, s.scheduled_end_at AS scheduledEndAt, s.duration_sec AS durationSec,
              s.result, s.result_note AS resultNote, s.rewarded, s.xp_awarded AS xp, s.coins_awarded AS coins,
              s.rating, s.bonus_xp AS bonusXp, s.bonus_coins AS bonusCoins
       FROM focus_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.user_id = ? ORDER BY s.started_at DESC, s.rowid DESC LIMIT ? OFFSET ?`,
      userId, limit, offset,
    ).map((s) => ({ ...s, rewarded: Boolean(s.rewarded) }));
  }

  function transactions(userId, query) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    return db.all('SELECT id, key, kind, xp, coins, created_at AS createdAt FROM reward_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
  }

  return { create, authenticate, touch, me, update, sessions, transactions, publicUser, transferCode, redeemTransfer, setCredentials, login };
}
