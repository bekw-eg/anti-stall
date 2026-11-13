/**
 * Общий клиент для демо-скриптов (demo-seed, demo-bots, cheat-check, demo): только встроенный fetch и пакет ws.
 * Адрес API: --api URL, переменная API или http://localhost:8787.
 */
import WebSocket from 'ws';

export function argValue(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

export const API = String(argValue('--api') || process.env.API || 'http://localhost:8787').replace(/\/+$/, '');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** REST-запрос → {status, body}. Тело ответа всегда JSON (или null, если сервер ответил иначе). */
export async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* не JSON */ }
  return { status: res.status, body: json };
}

/** Проверяет, что сервер жив и запущен в демо-режиме; иначе завершает процесс с понятной ошибкой. */
export async function requireDemoServer() {
  let health;
  try {
    health = await call('GET', '/api/health');
  } catch (e) {
    fail(`Сервер ${API} недоступен (${e.cause?.code || e.message}). Запустите: npm run start:demo`);
  }
  if (health.status !== 200 || !health.body) fail(`Сервер ${API} ответил ${health.status} на /api/health`);
  if (!health.body.demoMode) {
    fail(`Сервер ${API} работает НЕ в демо-режиме: песочные аккаунты и демо-комнаты там недоступны.\n` +
      '  Запустите backend так: npm run start:demo   (или node src/server.js --demo, или TOMATO_DEMO=1)');
  }
  return health.body;
}

export function fail(message) {
  console.error(`\x1b[31m✘ ${message}\x1b[0m`);
  process.exit(1);
}

/** Регистрирует игрока (по умолчанию песочного) и возвращает хелпер с его токеном. */
export async function createPlayer(name, { sandbox = true } = {}) {
  const r = await call('POST', '/api/users', sandbox ? { name, sandbox: true } : { name });
  if (r.status !== 201) throw new Error(`регистрация «${name}»: ${r.status} ${JSON.stringify(r.body)}`);
  return playerFromToken(name, r.body.user.id, r.body.token);
}

export function playerFromToken(name, id, token) {
  const p = { name, id, token };
  p.get = (path) => call('GET', path, undefined, token);
  p.post = (path, b = {}) => call('POST', path, b, token);
  p.patch = (path, b = {}) => call('PATCH', path, b, token);
  p.progress = async () => (await p.get('/api/users/me/progress')).body;
  return p;
}

/**
 * WebSocket так же, как клиент: auth первым сообщением, подписка на комнату и heartbeat каждые 5 с
 * (присутствие; без него через graceMs сессия считается прерванной).
 */
export async function connectWs(player, { onEvent = () => {}, heartbeatMs = 5000 } = {}) {
  const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
  const events = [];
  const waiters = [];
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    events.push(msg);
    if (events.length > 500) events.shift();
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    onEvent(msg);
  });
  ws.on('error', () => {});
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const wait = (pred, ms = 5000) => {
    const found = events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws: не дождались события')), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  };
  send({ type: 'auth', token: player.token });
  const hello = await wait((m) => m.type === 'hello' || (m.type === 'error' && m.data?.code === 'UNAUTHORIZED'));
  if (hello.type !== 'hello') throw new Error(`ws auth «${player.name}»: ${hello.data?.message}`);
  const beat = setInterval(() => send({ type: 'heartbeat' }), heartbeatMs);
  beat.unref?.();
  return {
    ws, events, send, wait,
    subscribe: (roomId) => { send({ type: 'subscribe', roomId }); return wait((m) => m.type === 'room_joined' && m.data?.roomId === roomId); },
    close: () => { clearInterval(beat); ws.close(); },
  };
}

/** Ждёт нужную фазу комнаты (опрос REST раз в 300 мс). */
export async function waitPhase(player, roomId, phase, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await player.get(`/api/rooms/${roomId}`);
    if (r.body?.room?.phase === phase) return r.body;
    await sleep(300);
  }
  throw new Error(`комната не перешла в фазу ${phase} за ${timeoutMs / 1000} с`);
}

/** Простая таблица для консоли (console.table плохо выравнивает кириллицу в некоторых терминалах). */
export function printTable(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c ?? '')));
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r) => '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  console.log(line(cells[0]));
  console.log(sep);
  for (const r of cells.slice(1)) console.log(line(r));
}
