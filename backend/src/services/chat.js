import { E } from '../errors.js';
import { reqObject, reqString } from '../validate.js';

/**
 * Текстовый чат комнаты. Правила (все проверяет сервер):
 *  - писать могут только участники комнаты; читать — тоже только участники;
 *  - чат открыт во всех фазах комнаты, в том числе на фокусе (можно спросить команду);
 *  - длина сообщения 1…maxLength символов, пробелы по краям обрезаются;
 *  - антиспам: не чаще одного сообщения в minIntervalMs и не больше perMinute в минуту;
 *  - сообщения хранятся в БД и приходят всей комнате событием chat_message по WebSocket.
 */
export function createChatService(ctx, rooms) {
  const { db, clock, config } = ctx;
  const cfg = config.chat;

  const view = (row) => ({ id: Number(row.id), userId: row.user_id, name: row.name, text: row.text, at: row.created_at });

  function list(user, roomKey, { limit } = {}) {
    const room = rooms.findRoom(roomKey);
    rooms.requireMember(room, user);
    const n = Math.max(1, Math.min(cfg.historyLimit, Number(limit) || cfg.historyLimit));
    const rows = db.all(
      `SELECT c.id, c.user_id, u.name, c.text, c.created_at FROM chat_messages c JOIN users u ON u.id = c.user_id
       WHERE c.room_id = ? ORDER BY c.id DESC LIMIT ?`, room.id, n,
    );
    // чат комнаты открыт всегда, в том числе на фокусе; readOnly оставлен для старых клиентов
    return { roomId: room.id, readOnly: false, messages: rows.reverse().map(view) };
  }

  function send(user, roomKey, body) {
    const b = reqObject(body);
    const text = reqString(typeof b.text === 'string' ? b.text.trim() : b.text, 'text', { min: 1, max: cfg.maxLength });
    return db.tx(() => {
      const room = rooms.findRoom(roomKey);
      rooms.requireMember(room, user);
      if (room.phase === 'completed') throw E.conflict('ROOM_CLOSED', 'Комната закрыта');
      const t = clock.now();
      const last = db.get('SELECT created_at t FROM chat_messages WHERE room_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', room.id, user.id);
      if (last && t - last.t < cfg.minIntervalMs) throw E.tooMany('CHAT_TOO_FAST', 'Слишком часто', { retryAfterMs: cfg.minIntervalMs - (t - last.t) });
      const perMin = db.get('SELECT COUNT(*) c FROM chat_messages WHERE room_id = ? AND user_id = ? AND created_at > ?', room.id, user.id, t - 60_000).c;
      if (perMin >= cfg.perMinute) throw E.tooMany('CHAT_RATE_LIMIT', 'Лимит сообщений в минуту исчерпан');
      const id = db.run('INSERT INTO chat_messages(room_id, user_id, cycle_id, text, created_at) VALUES (?,?,?,?,?)', room.id, user.id, room.cycle_id, text, t).lastInsertRowid;
      const message = view({ id, user_id: user.id, name: user.name, text, created_at: t });
      db.emit({ scope: 'room', roomId: room.id, type: 'chat_message', data: message });
      return message;
    });
  }

  return { list, send };
}
