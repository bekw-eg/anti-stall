import { WebSocketServer } from 'ws';

const MAX_MSGS_PER_SEC = 30;

/**
 * WebSocket-хаб. Клиент → сервер допускается ТОЛЬКО: auth, subscribe, unsubscribe, heartbeat, ping.
 * Любое другое событие (в т.ч. give_me_coins / complete_session) отклоняется: все изменения
 * состояния идут через REST и проверяются сервером, а хаб лишь рассылает результат.
 */
export class Hub {
  constructor({ server, users, rooms, config, clock }) {
    this.users = users;
    this.rooms = rooms;
    this.config = config;
    this.clock = clock;
    this.conns = new Set();
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.pingTimer = setInterval(() => this.pingAll(), config.wsPingMs);
    this.pingTimer.unref?.();
  }

  onConnection(ws) {
    const conn = { ws, userId: null, rooms: new Set(), alive: true, msgs: 0, windowStart: Date.now() };
    this.conns.add(conn);
    const authTimer = setTimeout(() => { if (!conn.userId) ws.close(4401, 'auth timeout'); }, 5000);
    ws.on('pong', () => { conn.alive = true; if (conn.userId) this.users.touch(conn.userId); });
    ws.on('close', () => { clearTimeout(authTimer); this.conns.delete(conn); });
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
    if (nowMs - conn.windowStart > 1000) { conn.windowStart = nowMs; conn.msgs = 0; }
    if (++conn.msgs > MAX_MSGS_PER_SEC) return conn.ws.close(4429, 'rate limit');

    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return this.error(conn, 'INVALID_JSON', 'Некорректный JSON'); }
    if (!msg || typeof msg.type !== 'string') return this.error(conn, 'INVALID_MESSAGE', 'Нужно поле type');
    const reqId = msg.reqId;
    const extra = reqId === undefined ? {} : { reqId };

    if (msg.type === 'auth') {
      const user = this.users.authenticate(msg.token);
      if (!user) { this.error(conn, 'UNAUTHORIZED', 'Неверный токен', extra); return conn.ws.close(4401, 'unauthorized'); }
      conn.userId = user.id;
      return this.send(conn, 'hello', { user: this.users.me(user.id), serverTime: this.clock.now(), graceMs: this.config.graceMs }, extra);
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
        } catch (e) {
          this.error(conn, e.code || 'INTERNAL', e.message, extra);
        }
        return undefined;
      }
      case 'unsubscribe':
        conn.rooms.delete(String(msg.roomId));
        return this.send(conn, 'unsubscribed', { roomId: msg.roomId }, extra);
      default:
        return this.error(conn, 'UNKNOWN_EVENT', `Событие «${msg.type}» не поддерживается: изменения выполняются через REST`, extra);
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
  broadcast(roomId, type, data) {
    for (const c of this.conns) if (c.rooms.has(roomId)) this.send(c, type, data, { roomId });
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
