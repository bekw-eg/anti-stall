import { randomInt } from 'node:crypto';
import { avatarOf } from '../avatar.js';
import { levelForXp } from '../catalog.js';
import { E } from '../errors.js';
import { reqObject, reqString } from '../validate.js';

const DAY = 86_400_000;
// без похожих символов (0/O, 1/I/L): код диктуют голосом и переписывают с экрана
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normalizeCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Друзья. Аккаунты гостевые (имя без почты), поэтому найти человека по имени нельзя — только:
 *  - из комнаты: «В друзья» у участника, с которым вы были в одной комнате;
 *  - по коду друга (users.friend_code, 6 символов), который человек сам показывает.
 * Заявка → принять / отклонить; встречная заявка сразу делает друзьями. Друга можно позвать в свою комнату.
 * Всё проверяет сервер: себе нельзя, дважды нельзя, лимиты против спама.
 * Друзья — только у зарегистрированных (логин и пароль): гость одноразовый и ничего не сохраняет.
 */
export function createFriends(ctx, rooms) {
  const { db, clock, config } = ctx;
  const cfg = config.friends;

  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const rowOf = (a, b) => { const [x, y] = pair(a, b); return db.get('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?', x, y); };
  const other = (row, me) => (row.user_a === me ? row.user_b : row.user_a);
  const userRow = (id) => db.get('SELECT * FROM users WHERE id = ?', id);
  const requireRegistered = (user) => {
    if (!userRow(user.id)?.login) throw E.forbidden('ACCOUNT_REQUIRED', 'Друзья — только для зарегистрированных: задайте логин и пароль в профиле');
  };

  /** Код друга: выдаётся при первом обращении (6 символов, уникален). */
  function codeOf(userId) {
    const u = userRow(userId);
    if (u.friend_code) return u.friend_code;
    for (let i = 0; i < 20; i++) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (db.get('SELECT 1 x FROM users WHERE friend_code = ?', code)) continue;
      db.run('UPDATE users SET friend_code = ? WHERE id = ? AND friend_code IS NULL', code, userId);
      return userRow(userId).friend_code;
    }
    throw E.conflict('CODE_BUSY', 'Не удалось выдать код, попробуйте ещё раз');
  }

  /** Где сейчас человек: онлайн-статус и активная комната (если он в сети и в ней состоит). */
  function presenceOf(u, now) {
    const connection = rooms.connectionState(u.last_seen_at, now);
    const room = db.get(
      `SELECT r.id, r.code, r.name, r.phase, r.cycle_no AS cycleNo FROM room_members m JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = ? AND m.left_at IS NULL AND r.phase != 'completed' ORDER BY m.joined_at DESC LIMIT 1`, u.id,
    );
    const focusing = Boolean(db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", u.id));
    return { connection, focusing, room: connection === 'offline' ? null : room ?? null };
  }
  const levelOfXp = levelForXp;
  const card = (u, now) => ({ id: u.id, name: u.name, level: levelOfXp(u.xp), avatar: avatarOf(u), ...presenceOf(u, now) });

  function list(userId) {
    const now = clock.now();
    const rows = db.all('SELECT * FROM friendships WHERE user_a = ? OR user_b = ?', userId, userId);
    const friends = [], incoming = [], outgoing = [];
    for (const r of rows) {
      const u = userRow(other(r, userId));
      if (!u) continue;
      if (r.status === 'accepted') friends.push({ ...card(u, now), since: r.accepted_at });
      else if (r.requested_by === userId) outgoing.push({ id: u.id, name: u.name, avatar: avatarOf(u), at: r.created_at });
      else incoming.push({ id: u.id, name: u.name, level: levelOfXp(u.xp), avatar: avatarOf(u), at: r.created_at });
    }
    // в сети и в комнате — выше; дальше по имени
    const rank = (f) => (f.connection === 'offline' ? 2 : f.room ? 0 : 1);
    friends.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'));
    return { code: codeOf(userId), friends, incoming, outgoing, limits: { maxFriends: cfg.maxFriends } };
  }

  const notify = (userId, type, data) => db.emit({ scope: 'user', userId, type, data });

  /** Заявка: по id человека из общей комнаты или по коду друга. Встречная заявка — сразу дружба. */
  function request(user, body) {
    return db.tx(() => {
      requireRegistered(user);
      const b = reqObject(body);
      let target = null;
      if (b.code !== undefined) {
        const code = normalizeCode(reqString(b.code, 'code', { min: 4, max: 20 }));
        target = db.get('SELECT * FROM users WHERE friend_code = ?', code);
        if (!target) throw E.notFound('FRIEND_CODE_NOT_FOUND', 'Код не найден — проверьте, нет ли опечатки');
      } else if (b.userId !== undefined) {
        target = userRow(reqString(b.userId, 'userId', { min: 1, max: 64 }));
        // по id — только тех, с кем вы были в одной комнате (id чужих людей нигде не показываются)
        const met = target && db.get('SELECT 1 x FROM room_members a JOIN room_members b ON a.room_id = b.room_id WHERE a.user_id = ? AND b.user_id = ?', user.id, target.id);
        if (!met) throw E.notFound('USER_NOT_FOUND', 'Добавить можно того, с кем вы были в одной комнате, или по коду друга');
      } else {
        throw E.badRequest('INVALID_FIELD', 'Нужен userId или code', { field: 'userId' });
      }
      if (target.id === user.id) throw E.conflict('SELF_FRIEND', 'Это ваш собственный код');
      if (!target.login) throw E.forbidden('TARGET_IS_GUEST', 'Это гость — добавить в друзья можно после его регистрации');
      if (Boolean(target.sandbox) !== Boolean(userRow(user.id).sandbox)) throw E.forbidden('SANDBOX_MISMATCH', 'Демо-аккаунты дружат только с демо-аккаунтами');
      const existing = rowOf(user.id, target.id);
      if (existing?.status === 'accepted') throw E.conflict('ALREADY_FRIENDS', 'Вы уже друзья');
      if (existing && existing.requested_by === user.id) throw E.conflict('ALREADY_SENT', 'Заявка уже отправлена');
      const now = clock.now();
      if (existing) {
        // встречная заявка: он уже звал вас — сразу друзья
        db.run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?", now, existing.user_a, existing.user_b);
        notify(target.id, 'friend_accepted', { userId: user.id, name: user.name });
        notify(user.id, 'friend_accepted', { userId: target.id, name: target.name });
        return { status: 'accepted', friend: card(target, now) };
      }
      const count = (id) => db.get("SELECT COUNT(*) c FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'", id, id).c;
      if (count(user.id) >= cfg.maxFriends) throw E.conflict('FRIENDS_LIMIT', `Друзей не больше ${cfg.maxFriends}`);
      const sentToday = db.get('SELECT COUNT(*) c FROM friendships WHERE requested_by = ? AND created_at > ?', user.id, now - DAY).c;
      if (sentToday >= cfg.requestsPerDay) throw E.tooMany('TOO_MANY_REQUESTS', 'Слишком много заявок за сутки — попробуйте завтра');
      const [a, c] = pair(user.id, target.id);
      db.run("INSERT INTO friendships(user_a, user_b, status, requested_by, created_at) VALUES (?,?,'pending',?,?)", a, c, user.id, now);
      notify(target.id, 'friend_request', { userId: user.id, name: user.name, avatar: avatarOf(userRow(user.id)) });
      return { status: 'pending', to: { id: target.id, name: target.name } };
    });
  }

  function accept(user, fromId) {
    return db.tx(() => {
      requireRegistered(user);
      const row = rowOf(user.id, fromId);
      if (!row || row.status !== 'pending' || row.requested_by === user.id) throw E.notFound('REQUEST_NOT_FOUND', 'Заявки нет');
      db.run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?", clock.now(), row.user_a, row.user_b);
      notify(fromId, 'friend_accepted', { userId: user.id, name: user.name });
      return list(user.id);
    });
  }

  /** Отклонить входящую, отменить исходящую или удалить из друзей — запись пары исчезает. */
  function remove(user, otherId) {
    return db.tx(() => {
      const row = rowOf(user.id, otherId);
      if (!row) throw E.notFound('FRIEND_NOT_FOUND', 'Такой связи нет');
      db.run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', row.user_a, row.user_b);
      notify(otherId, 'friend_removed', { userId: user.id });
      return list(user.id);
    });
  }

  /** Позвать друга в свою комнату: он получает приглашение с кодом комнаты (не чаще раза в минуту). */
  function invite(user, friendId, body) {
    return db.tx(() => {
      requireRegistered(user);
      const b = reqObject(body);
      const row = rowOf(user.id, friendId);
      if (!row || row.status !== 'accepted') throw E.forbidden('NOT_FRIENDS', 'Звать в комнату можно только друзей');
      const room = rooms.findRoom(reqString(b.roomId, 'roomId', { min: 1, max: 64 }));
      rooms.requireMember(room, user);
      if (room.phase === 'completed') throw E.conflict('ROOM_CLOSED', 'Комната закрыта');
      const now = clock.now();
      if (db.get('SELECT 1 x FROM friend_invites WHERE from_id = ? AND to_id = ? AND created_at > ?', user.id, friendId, now - cfg.inviteCooldownMs)) {
        throw E.tooMany('INVITE_COOLDOWN', 'Уже позвали — подождите минуту');
      }
      db.run('INSERT INTO friend_invites(from_id, to_id, room_id, created_at) VALUES (?,?,?,?)', user.id, friendId, room.id, now);
      notify(friendId, 'room_invite', { from: user.id, fromName: user.name, roomId: room.id, roomCode: room.code, roomName: room.name, at: now });
      return { ok: true };
    });
  }

  /** Отношение к каждому участнику комнаты — для кнопки «В друзья» в списке людей комнаты. */
  function relations(userId) {
    const out = {};
    for (const r of db.all('SELECT * FROM friendships WHERE user_a = ? OR user_b = ?', userId, userId)) {
      out[other(r, userId)] = r.status === 'accepted' ? 'friend' : r.requested_by === userId ? 'outgoing' : 'incoming';
    }
    return out;
  }

  return { list, request, accept, remove, invite, relations, codeOf };
}
