import http from 'node:http';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { Db } from './db.js';
import { AppError } from './errors.js';
import { buildRoutes } from './http/routes.js';
import { readJson } from './http/router.js';
import { createStaticHandler } from './http/static.js';
import { createGame } from './services/game.js';
import { createRoomsService } from './services/rooms.js';
import { createSocialService } from './services/social.js';
import { createTd } from './services/td.js';
import { createUsersService } from './services/users.js';
import { Hub } from './ws/hub.js';
import { VoiceRooms } from './ws/voice.js';

/** Пути API и WebSocket никогда не перехватываются статикой. */
const isApiPath = (p) => p === '/api' || p.startsWith('/api/') || p === '/ws' || p.startsWith('/ws/');

/**
 * Фабрика приложения. clock и config подменяются в тестах (управляемые часы вместо системного времени).
 */
export function createApp({ config = loadConfig(), clock = systemClock } = {}) {
  const db = new Db(config.dbPath);
  const ctx = { db, clock, config };
  const game = createGame(ctx);
  const users = createUsersService(ctx, game);
  const td = createTd(ctx, game);
  const rooms = createRoomsService(ctx, game, users, td);
  td.setRooms(rooms);
  const social = createSocialService(ctx, game, rooms);
  const voice = new VoiceRooms({ config, clock, nameOf: (id) => db.get('SELECT name FROM users WHERE id = ?', id)?.name });
  const router = buildRoutes({ config, users, rooms, game, social, td, voice, db, clock });

  const cors = {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
    res.end(JSON.stringify(body));
  };

  // Единый образ: собранный фронтенд отдаётся тем же процессом (только если задан TOMATO_STATIC_DIR)
  const serveStatic = config.staticDir ? createStaticHandler(config.staticDir) : null;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (serveStatic && (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(url.pathname)) {
        return await serveStatic(req, res, url.pathname);
      }
      const { route, params } = router.match(req.method, url.pathname);
      let user = null;
      if (route.auth) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        user = m ? users.authenticate(m[1]) : null;
        if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Нужен заголовок Authorization: Bearer <token>');
      }
      const body = req.method === 'GET' ? {} : await readJson(req, config.maxBodyBytes);
      const query = Object.fromEntries(url.searchParams);
      // Пользователь перечитывается внутри сервисов; здесь он нужен только как идентичность из токена.
      const out = route.handler({ user, params, body, query });
      return sendJson(res, out.status, out.body);
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
      }
      console.error('[tomato] internal error:', err);
      return sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
    }
  });

  const hub = new Hub({ server, users, rooms, voice, config, clock });
  db.sink = (events) => hub.dispatch(events);

  rooms.recoverAfterRestart();

  // ---- планировщик. Корректность не зависит от него: фазы считаются по меткам времени,
  // а любой запрос/подписка дополнительно «догоняет» комнату (advance).
  const presence = new Map();
  let lastBroadcast = 0;
  function tick() {
    const t = clock.now();
    for (const id of rooms.runningRoomIds()) {
      try { rooms.advance(id); } catch (e) { console.error('[tomato] tick error', e); }
    }
    // смена статуса соединения участников → player_status_changed
    for (const roomId of hub.roomsWithSubscribers()) {
      const room = rooms.loadRoom(roomId);
      if (!room) continue;
      for (const m of db.all('SELECT m.user_id id, u.last_seen_at s FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? AND m.left_at IS NULL', roomId)) {
        const state = rooms.connectionState(m.s, t);
        const key = `${roomId}:${m.id}`;
        if (presence.get(key) !== state) {
          if (presence.has(key)) hub.broadcast(roomId, 'player_status_changed', { userId: m.id, connection: state });
          presence.set(key, state);
        }
      }
      if (t - lastBroadcast >= config.broadcastTickMs && (room.phase === 'focus' || room.phase === 'break')) {
        hub.broadcast(roomId, 'timer_tick', { phase: room.phase, cycleId: room.cycle_id, phaseEndsAt: room.phase_ends_at, remainingMs: Math.max(0, room.phase_ends_at - t), serverTime: t });
      }
    }
    if (t - lastBroadcast >= config.broadcastTickMs) lastBroadcast = t;
  }

  let timer = null;
  return {
    config, clock, db, server, hub, services: { game, users, rooms, social, td, voice }, tick,
    startScheduler() {
      timer = setInterval(tick, config.tickMs);
      timer.unref?.();
    },
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      clearInterval(timer);
      hub.close();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      db.close();
    },
  };
}
