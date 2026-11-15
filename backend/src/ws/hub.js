import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { VoiceError } from './voice.js';

const MAX_MSGS_PER_SEC = 30;

/**
 * WebSocket-хаб. Клиент → сервер допускается ТОЛЬКО: auth, subscribe, unsubscribe, heartbeat, ping
 * и голосовой сигналинг (voice_join / voice_leave / voice_signal / voice_state).
 * Любое другое событие (в т.ч. give_me_coins / complete_session) отклоняется: все изменения
 * игрового состояния идут через REST и проверяются сервером, а хаб лишь рассылает результат.
 * Голосовые сообщения не меняют ни экономику, ни прогресс — это пересылка SDP/ICE между участниками комнаты.
 * Исключение для Harvest — harvest_move: позиция корзины (только показ и проверка скорости; очки — через REST).
 */
export class Hub {
  constructor({ server, users, rooms, voice, harvest = null, config, clock, log = () => {} }) {
    this.log = log;
    this.users = users;
    this.harvest = harvest;
    this.rooms = rooms;
    this.voice = voice;
    this.config = config;
    this.clock = clock;
    this.conns = new Set();
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.pingTimer = setInterval(() => this.pingAll(), config.wsPingMs);
    this.pingTimer.unref?.();
    voice?.attach({
      send: (conn, type, data, extra) => this.send(conn, type, data, extra),
      broadcast: (roomId, type, data, except) => this.broadcast(roomId, type, { roomId, ...data }, except),
    });
  }

  onConnection(ws) {
    const conn = {
      id: randomUUID(), ws, userId: null, rooms: new Set(), voice: new Set(), alive: true,
      msgs: 0, signals: 0, windowStart: Date.now(),
    };
    this.conns.add(conn);
    this.log('info', 'ws_open', { conn: conn.id, conns: this.conns.size });
    const authTimer = setTimeout(() => { if (!conn.userId) ws.close(4401, 'auth timeout'); }, 5000);
    ws.on('pong', () => { conn.alive = true; if (conn.userId) this.users.touch(conn.userId); });
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.conns.delete(conn);
      this.log('info', 'ws_close', { conn: conn.id, userId: conn.userId, conns: this.conns.size });
      this.voice?.dropConn(conn); // обрыв = выход из голоса, у остальных соединение закрывается
    });
    ws.on('error', () => {});
    ws.on('message', (raw) => this.onMessage(conn, raw));
  }

  send(conn, type, data = {}, extra = {}) {
    if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify({ type, ts: this.clock.now(), ...extra, data }));
  }
  error(conn, code, message, extra) {
    this.send(conn, 'error', { code, message }, extra);
  }

  onMessage(conn, raw) {
    const nowMs = Date.now();
    if (nowMs - conn.windowStart > 1000) { conn.windowStart = nowMs; conn.msgs = 0; conn.signals = 0; }
    // ICE-кандидаты приходят пачками (несколько на каждого участника) — у сигналов свой, более высокий лимит;
    // общий потолок проверяется до разбора JSON, чтобы мусор тоже не проходил без ограничений
    if (++conn.signals > this.config.voice.signalsPerSec + MAX_MSGS_PER_SEC) return conn.ws.close(4429, 'rate limit');

    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return this.error(conn, 'INVALID_JSON', 'Некорректный JSON'); }
    if (!msg || typeof msg.type !== 'string') return this.error(conn, 'INVALID_MESSAGE', 'Нужно поле type');
    if (msg.type !== 'voice_signal' && ++conn.msgs > MAX_MSGS_PER_SEC) return conn.ws.close(4429, 'rate limit');
    const reqId = msg.reqId;
    const extra = reqId === undefined ? {} : { reqId };

    if (msg.type === 'auth') {
      const user = this.users.authenticate(msg.token);
      if (!user) { this.error(conn, 'UNAUTHORIZED', 'Неверный токен', extra); return conn.ws.close(4401, 'unauthorized'); }
      conn.userId = user.id;
      return this.send(conn, 'hello', { user: this.users.me(user.id), serverTime: this.clock.now(), graceMs: this.config.graceMs, connId: conn.id }, extra);
    }
    if (!conn.userId) return this.error(conn, 'UNAUTHORIZED', 'Сначала отправьте auth', extra);
    this.users.touch(conn.userId);

    switch (msg.type) {
      case 'ping':
      case 'heartbeat':
        return this.send(conn, 'heartbeat_ack', { serverTime: this.clock.now() }, extra);
      case 'subscribe': {
        try {
          const room = this.rooms.findRoom(msg.roomId);
          this.rooms.advance(room.id);
          this.rooms.requireMember(room, { id: conn.userId });
          conn.rooms.add(room.id);
          this.send(conn, 'room_joined', { roomId: room.id }, extra);
          this.send(conn, 'room_state', this.rooms.snapshot(room.id, conn.userId), { roomId: room.id });
          // кто сейчас в голосе — видно всем участникам комнаты, даже не подключённым к звуку
          if (this.voice) this.send(conn, 'voice_roster', { roomId: room.id, peers: this.voice.peers(room.id) }, { roomId: room.id });
        } catch (e) {
          this.error(conn, e.code || 'INTERNAL', e.message, extra);
        }
        return undefined;
      }
      case 'unsubscribe':
        conn.rooms.delete(String(msg.roomId));
        this.voice?.leave(conn, String(msg.roomId), 'left');
        return this.send(conn, 'unsubscribed', { roomId: msg.roomId }, extra);
      case 'harvest_move': {
        // только подписанный участник комнаты; ответа нет — позиции уходят всем в кадрах harvest_frame
        const roomId = String(msg.roomId ?? '');
        if (this.harvest && conn.rooms.has(roomId)) this.harvest.move(conn.userId, roomId, msg.x);
        return undefined;
      }
      case 'voice_join':
      case 'voice_leave':
      case 'voice_signal':
      case 'voice_state':
        return this.onVoice(conn, msg, extra);
      default:
        return this.error(conn, 'UNKNOWN_EVENT', `Событие «${msg.type}» не поддерживается: изменения выполняются через REST`, extra);
    }
  }

  onVoice(conn, msg, extra) {
    if (!this.voice) return this.error(conn, 'UNKNOWN_EVENT', 'Голос отключён', extra);
    const roomId = String(msg.roomId ?? '');
    try {
      // Голос — только для подписанного участника комнаты (подписка уже проверила членство)
      if (!conn.rooms.has(roomId)) throw new VoiceError('NOT_SUBSCRIBED', 'Сначала подпишитесь на комнату');
      switch (msg.type) {
        case 'voice_join': {
          const room = this.rooms.loadRoom(roomId);
          if (!room || room.phase === 'completed') throw new VoiceError('ROOM_CLOSED', 'Комната закрыта');
          this.rooms.requireMember(room, { id: conn.userId });
          const joined = this.voice.join(conn, roomId, { muted: msg.muted, deafened: msg.deafened });
          const ice = this.voice.iceServers(conn.userId);
          return this.send(conn, 'voice_joined', { roomId, ...joined, ...ice }, { ...extra, roomId });
        }
        case 'voice_leave':
          this.voice.leave(conn, roomId, 'left');
          return this.send(conn, 'voice_left', { roomId }, { ...extra, roomId });
        case 'voice_signal':
          return this.voice.signal(conn, roomId, msg.to, msg.signal);
        case 'voice_state':
          this.voice.state(conn, roomId, msg);
          return undefined;
        default:
          return undefined;
      }
    } catch (e) {
      return this.error(conn, e.code || 'INTERNAL', e.message, { ...extra, roomId });
    }
  }

  /** Принимает события из Db после COMMIT. */
  dispatch(events) {
    for (const ev of events) {
      try {
        if (ev.scope === 'user') {
          for (const c of this.conns) if (c.userId === ev.userId) this.send(c, ev.type, ev.data, ev.data?.roomId ? { roomId: ev.data.roomId } : {});
        } else if (ev.scope === 'room') {
          for (const c of this.conns) if (c.rooms.has(ev.roomId)) this.send(c, ev.type, ev.data, { roomId: ev.roomId });
          // вышел из комнаты — выходит и из голоса (со всех своих соединений)
          if (ev.type === 'player_left' && this.voice) this.voice.leaveUser(ev.roomId, ev.data.userId, 'left_room');
        } else if (ev.scope === 'room_state') {
          for (const c of this.conns) {
            if (c.rooms.has(ev.roomId)) this.send(c, 'room_state', this.rooms.snapshot(ev.roomId, c.userId), { roomId: ev.roomId });
          }
        }
      } catch { /* рассылка не должна ломать бизнес-операцию */ }
    }
  }

  roomsWithSubscribers() {
    const s = new Set();
    for (const c of this.conns) for (const id of c.rooms) s.add(id);
    return s;
  }
  broadcast(roomId, type, data, except = null) {
    for (const c of this.conns) if (c !== except && c.rooms.has(roomId)) this.send(c, type, data, { roomId });
  }

  pingAll() {
    for (const c of this.conns) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }

  close() {
    clearInterval(this.pingTimer);
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }
}
