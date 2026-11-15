import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { Db } from './db.js';
import { AppError } from './errors.js';
import { buildRoutes } from './http/routes.js';
import { readJson } from './http/router.js';
import { createStaticHandler } from './http/static.js';
import { createGame } from './services/game.js';
import { createRoomsService } from './services/rooms.js';
import { createChatService } from './services/chat.js';
import { createSocialService } from './services/social.js';
import { createTd } from './services/td.js';
import { createHarvest } from './services/harvest.js';
import { createFriends } from './services/friends.js';
import { createUsersService } from './services/users.js';
import { Hub } from './ws/hub.js';
import { createLogger, createMetrics, routeLabel } from './observability.js';
import { VoiceRooms } from './ws/voice.js';

/** Пути API и WebSocket никогда не перехватываются статикой. */
const isApiPath = (p) => p === '/api' || p.startsWith('/api/') || p === '/ws' || p.startsWith('/ws/');

/**
 * Фабрика приложения. clock и config подменяются в тестах (управляемые часы вместо системного времени).
 */
export function createApp({ config = loadConfig(), clock = systemClock } = {}) {
  const db = new Db(config.dbPath, { treasuryStart: config.economy.treasuryStart });
  // ---- наблюдаемость: JSON-логи, метрики Prometheus, счётчик ошибок (docs/OBSERVABILITY.md)
  const log = createLogger({ enabled: config.requestLog });
  const metrics = createMetrics();
  const httpRequests = metrics.counter('antistall_http_requests_total', 'HTTP-запросы по маршруту и коду ответа');
  const httpDuration = metrics.histogram('antistall_http_request_duration_seconds', 'Время ответа HTTP по маршруту', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]);
  const errorsTotal = metrics.counter('antistall_errors_total', 'Ошибки по источнику: http (5xx), tick, harvest, client');
  /** Ошибка сервера: всегда в stderr (даже без requestLog) + счётчик для алерта. */
  const reportError = (source, err, fields = {}) => {
    errorsTotal.inc({ source });
    if (!config.requestLog) console.error(`[tomato] ${source} error:`, err);
    log('error', `${source}_error`, { ...fields, error: err?.message ?? String(err), stack: err?.stack });
  };
  const clientErrorsByIp = new Map(); // ip -> { n, until }
  const ctx = { db, clock, config };
  const game = createGame(ctx);
  const users = createUsersService(ctx, game);
  const td = createTd(ctx, game);
  const harvest = createHarvest(ctx, game);
  const rooms = createRoomsService(ctx, game, users, td, harvest);
  td.setRooms(rooms);
  harvest.setRooms(rooms);
  const social = createSocialService(ctx, game, rooms);
  const chat = createChatService(ctx, rooms);
  const friends = createFriends(ctx, rooms);
  const voice = new VoiceRooms({ config, clock, nameOf: (id) => db.get('SELECT name FROM users WHERE id = ?', id)?.name });
  const router = buildRoutes({ config, users, rooms, game, social, td, harvest, friends, voice, chat, db, clock });

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
    // X-Request-Id: свой от прокси (если похож на id) или новый — есть в ответе, логе и тексте ошибки 5xx
    const inId = req.headers['x-request-id'];
    const reqId = typeof inId === 'string' && /^[\w-]{8,64}$/.test(inId) ? inId : randomUUID();
    res.setHeader('X-Request-Id', reqId);
    const started = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    let matched = null;
    let userId = null;
    res.on('finish', () => {
      const sec = Number(process.hrtime.bigint() - started) / 1e9;
      const route = routeLabel(matched, url.pathname);
      if (route === 'static') return;
      httpRequests.inc({ method: req.method, route, status: res.statusCode });
      httpDuration.observe({ route }, sec);
      // метрики и частый heartbeat (раз в несколько секунд на игрока) в лог не пишем — только в счётчики
      if (route === '/api/metrics' || (route.endsWith('/heartbeat') && res.statusCode < 400)) return;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log(level, 'http', { reqId, method: req.method, route, path: url.pathname, status: res.statusCode, ms: Math.round(sec * 1000), userId });
    });
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (url.pathname === '/api/metrics' && req.method === 'GET') { matched = { pattern: '/api/metrics' }; return sendMetrics(req, res); }
      if (url.pathname === '/api/client-errors' && req.method === 'POST') { matched = { pattern: '/api/client-errors' }; return await acceptClientError(req, res); }
      if (serveStatic && (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(url.pathname)) {
        return await serveStatic(req, res, url.pathname);
      }
      const { route, params } = router.match(req.method, url.pathname);
      matched = route;
      let user = null;
      if (route.auth) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        user = m ? users.authenticate(m[1]) : null;
        if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Нужен заголовок Authorization: Bearer <token>');
        userId = user.id;
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
      reportError('http', err, { reqId, method: req.method, path: url.pathname });
      return sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера', requestId: reqId } });
    }
  });

  const hub = new Hub({ server, users, rooms, voice, harvest, config, clock, log });

  /** GET /api/metrics — формат Prometheus. Метрики «из БД» считаются при запросе и переживают рестарт. */
  function sendMetrics(req, res) {
    if (config.metricsToken && req.headers.authorization !== `Bearer ${config.metricsToken}`) {
      return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Нужен токен метрик' } });
    }
    const by = (sql, label) => db.all(sql).map((r) => ({ labels: { [label]: r.k }, value: r.c }));
    const mem = process.memoryUsage();
    const gauges = [
      { name: 'antistall_ws_connections', help: 'Открытые WebSocket-подключения', values: [{ value: hub.conns.size }] },
      { name: 'antistall_rooms', help: 'Комнаты по фазам', values: by('SELECT phase k, COUNT(*) c FROM rooms GROUP BY phase', 'phase') },
      { name: 'antistall_focus_sessions', help: 'Фокус-сессии по статусу (всего в БД)', values: by('SELECT status k, COUNT(*) c FROM focus_sessions GROUP BY status', 'status') },
      { name: 'antistall_reward_transactions', help: 'Записи журнала наград по виду', values: by('SELECT kind k, COUNT(*) c FROM reward_transactions GROUP BY kind', 'kind') },
      { name: 'antistall_users', help: 'Пользователи: гости и аккаунты с логином', values: by("SELECT CASE WHEN login IS NULL THEN 'guest' ELSE 'registered' END k, COUNT(*) c FROM users GROUP BY 1", 'type') },
      { name: 'antistall_schema_version', help: 'Версия схемы БД', values: [{ value: db.schemaVersion ?? 0 }] },
      { name: 'process_resident_memory_bytes', help: 'Память процесса (RSS)', values: [{ value: mem.rss }] },
      { name: 'nodejs_heap_used_bytes', help: 'Использованная куча V8', values: [{ value: mem.heapUsed }] },
      { name: 'process_uptime_seconds', help: 'Время работы процесса', values: [{ value: Math.round(process.uptime()) }] },
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(metrics.render(gauges));
  }

  /** POST /api/client-errors — ошибка из браузера (window.onerror, React). Лимит на адрес, поля обрезаются. */
  async function acceptClientError(req, res) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
    const t = Date.now();
    const slot = clientErrorsByIp.get(ip);
    if (slot && slot.until > t && slot.n >= config.clientErrorsPerMinute) {
      return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: 'Слишком много отчётов об ошибках' } });
    }
    if (clientErrorsByIp.size > 5000) clientErrorsByIp.clear(); // защита памяти
    clientErrorsByIp.set(ip, slot && slot.until > t ? { n: slot.n + 1, until: slot.until } : { n: 1, until: t + 60_000 });
    const b = await readJson(req, 16 * 1024).catch(() => ({}));
    const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const kind = ['error', 'unhandledrejection', 'react'].includes(b?.kind) ? b.kind : 'error';
    errorsTotal.inc({ source: 'client' });
    log('warn', 'client_error', { kind, message: cut(b?.message, 500), stack: cut(b?.stack, 2000), page: cut(b?.url, 300), ua: cut(req.headers['user-agent'], 200) });
    res.writeHead(204, cors);
    return res.end();
  }
  db.sink = (events) => hub.dispatch(events);

  rooms.recoverAfterRestart();

  // ---- планировщик. Корректность не зависит от него: фазы считаются по меткам времени,
  // а любой запрос/подписка дополнительно «догоняет» комнату (advance).
  const presence = new Map();
  let lastBroadcast = 0;
  function tick() {
    const t = clock.now();
    for (const id of rooms.runningRoomIds()) {
      try { rooms.advance(id); } catch (e) { reportError('tick', e, { roomId: id }); }
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

  /** Кадры Harvest (корзины, счёт) — чаще, чем тик фаз: игра в реальном времени. */
  function harvestFrames() {
    try {
      for (const f of harvest.frames()) hub.broadcast(f.roomId, 'harvest_frame', f.data);
    } catch (e) { reportError('harvest', e); }
  }

  let timer = null;
  let frameTimer = null;
  return {
    config, clock, db, server, hub, log, metrics, services: { game, users, rooms, social, td, harvest, friends, voice }, tick, harvestFrames,
    startScheduler() {
      timer = setInterval(tick, config.tickMs);
      timer.unref?.();
      frameTimer = setInterval(harvestFrames, config.harvestFrameMs);
      frameTimer.unref?.();
    },
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      clearInterval(timer);
      clearInterval(frameTimer);
      hub.close();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      db.close();
    },
  };
}
