import { createHmac } from 'node:crypto';

/**
 * ICE-серверы для браузера. STUN — всегда; TURN — если задан в окружении.
 * С общим секретом (coturn `use-auth-secret`) выдаём временные логины: username = "<expiry>:<userId>",
 * credential = base64(HMAC-SHA1(secret, username)). Секрет на клиент не уходит.
 */
export function iceServersFor(config, userId, nowMs) {
  const v = config.voice;
  const iceServers = [];
  if (v.stunUrls.length) iceServers.push({ urls: v.stunUrls });
  let relay = false;
  if (v.turnUrls.length) {
    if (v.turnSecret) {
      const username = `${Math.floor(nowMs / 1000) + v.turnTtlSec}:${userId}`;
      const credential = createHmac('sha1', v.turnSecret).update(username).digest('base64');
      iceServers.push({ urls: v.turnUrls, username, credential });
      relay = true;
    } else if (v.turnUsername && v.turnCredential) {
      iceServers.push({ urls: v.turnUrls, username: v.turnUsername, credential: v.turnCredential });
      relay = true;
    }
  }
  return { iceServers, ttlSec: v.turnTtlSec, relay };
}

export class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const bool = (v) => v === true;

/** Пропускаем дальше только известные поля сигнала: SDP-описание или ICE-кандидат. */
export function cleanSignal(s, maxSdpBytes) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new VoiceError('INVALID_SIGNAL', 'Сигнал должен быть объектом');
  if (s.description !== undefined) {
    const d = s.description;
    if (!d || (d.type !== 'offer' && d.type !== 'answer') || typeof d.sdp !== 'string' || d.sdp.length > maxSdpBytes) {
      throw new VoiceError('INVALID_SIGNAL', 'Некорректное SDP-описание');
    }
    return { description: { type: d.type, sdp: d.sdp } };
  }
  if (s.candidate !== undefined) {
    const c = s.candidate;
    if (c === null) return { candidate: null }; // конец сбора кандидатов
    if (typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 2048) {
      throw new VoiceError('INVALID_SIGNAL', 'Некорректный ICE-кандидат');
    }
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
        usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment.slice(0, 256) : null,
      },
    };
  }
  throw new VoiceError('INVALID_SIGNAL', 'Нужно поле description или candidate');
}

/**
 * Голосовые каналы комнат (in-memory: это «живое» присутствие, а не данные).
 * Один пользователь — одно место в голосе комнаты: повторный вход (новая вкладка, перезагрузка)
 * вытесняет старое соединение, поэтому у остальных не остаются «мёртвые» участники.
 * Сервер не видит звук: он лишь пересылает SDP/ICE между участниками одного голосового канала.
 */
export class VoiceRooms {
  constructor({ config, clock, nameOf }) {
    this.config = config;
    this.clock = clock;
    this.nameOf = nameOf;
    this.rooms = new Map(); // roomId → Map<userId, entry>
    this.send = () => {};
    this.broadcast = () => {};
  }

  /** Хаб даёт функции доставки: send(conn, type, data, extra), broadcast(roomId, type, data, exceptConn) */
  attach({ send, broadcast }) {
    this.send = send;
    this.broadcast = broadcast;
  }

  iceServers(userId) {
    return iceServersFor(this.config, userId, this.clock.now());
  }

  publicPeer(e) {
    return { userId: e.userId, name: e.name, muted: e.muted, deafened: e.deafened, speaking: e.speaking, joinedAt: e.joinedAt };
  }

  peers(roomId) {
    return [...(this.rooms.get(roomId)?.values() ?? [])].map((e) => this.publicPeer(e));
  }

  join(conn, roomId, opts = {}) {
    let room = this.rooms.get(roomId);
    const prev = room?.get(conn.userId);
    if (!prev && room && room.size >= this.config.voice.maxPeers) {
      throw new VoiceError('VOICE_FULL', `В голосовом канале уже ${this.config.voice.maxPeers} участников`);
    }
    if (prev) {
      // переподключение того же пользователя: старое соединение больше не участвует в звонке
      this.remove(roomId, prev, prev.conn === conn ? 'rejoined' : 'replaced');
      if (prev.conn !== conn) this.send(prev.conn, 'voice_kicked', { roomId, reason: 'replaced' }, { roomId });
    }
    if (!room) this.rooms.set(roomId, (room = new Map()));
    const entry = {
      conn, userId: conn.userId, name: this.nameOf(conn.userId) ?? 'Игрок',
      muted: bool(opts.muted), deafened: bool(opts.deafened), speaking: false, joinedAt: this.clock.now(),
    };
    room.set(conn.userId, entry);
    conn.voice.add(roomId);
    this.broadcast(roomId, 'voice_peer_joined', { peer: this.publicPeer(entry) }, conn);
    return { self: this.publicPeer(entry), peers: this.peers(roomId).filter((p) => p.userId !== conn.userId) };
  }

  remove(roomId, entry, reason) {
    const room = this.rooms.get(roomId);
    if (!room || room.get(entry.userId) !== entry) return false;
    room.delete(entry.userId);
    entry.conn.voice.delete(roomId);
    if (room.size === 0) this.rooms.delete(roomId);
    this.broadcast(roomId, 'voice_peer_left', { userId: entry.userId, reason });
    return true;
  }

  /** Выход по инициативе соединения (кнопка, отписка, обрыв). Чужую запись не трогаем. */
  leave(conn, roomId, reason = 'left') {
    const entry = this.rooms.get(roomId)?.get(conn.userId);
    if (!entry || entry.conn !== conn) return false;
    return this.remove(roomId, entry, reason);
  }

  /** Игрок вышел из комнаты (REST) — убираем его из голоса, с какого бы соединения он ни был. */
  leaveUser(roomId, userId, reason = 'left_room') {
    const entry = this.rooms.get(roomId)?.get(userId);
    if (!entry) return false;
    this.send(entry.conn, 'voice_kicked', { roomId, reason }, { roomId });
    return this.remove(roomId, entry, reason);
  }

  dropConn(conn) {
    for (const roomId of [...conn.voice]) this.leave(conn, roomId, 'disconnected');
  }

  requireEntry(conn, roomId) {
    const entry = this.rooms.get(roomId)?.get(conn.userId);
    if (!entry || entry.conn !== conn) throw new VoiceError('VOICE_NOT_JOINED', 'Сначала подключитесь к голосу (voice_join)');
    return entry;
  }

  signal(conn, roomId, to, rawSignal) {
    this.requireEntry(conn, roomId);
    if (typeof to !== 'string' || to === conn.userId) throw new VoiceError('INVALID_SIGNAL', 'Неверный получатель сигнала');
    const target = this.rooms.get(roomId)?.get(to);
    if (!target) throw new VoiceError('VOICE_PEER_NOT_FOUND', 'Получатель не в голосовом канале');
    const signal = cleanSignal(rawSignal, this.config.voice.maxSdpBytes);
    this.send(target.conn, 'voice_signal', { roomId, from: conn.userId, signal }, { roomId });
  }

  state(conn, roomId, patch) {
    const entry = this.requireEntry(conn, roomId);
    let changed = false;
    for (const k of ['muted', 'deafened', 'speaking']) {
      if (typeof patch[k] === 'boolean' && entry[k] !== patch[k]) { entry[k] = patch[k]; changed = true; }
    }
    if (entry.muted || entry.deafened) {
      if (entry.speaking) changed = true;
      entry.speaking = false; // с выключенным микрофоном «говорящим» не показываем
    }
    if (changed) {
      this.broadcast(roomId, 'voice_state', { userId: entry.userId, muted: entry.muted, deafened: entry.deafened, speaking: entry.speaking });
    }
    return this.publicPeer(entry);
  }
}
