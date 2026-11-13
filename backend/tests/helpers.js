import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { FakeClock } from '../src/clock.js';
import { loadConfig } from '../src/config.js';

/** Поднимает приложение на случайном порту с управляемыми часами и тестовой БД. */
export async function boot({ env = {}, config = {}, clock = new FakeClock(), dbPath = ':memory:' } = {}) {
  const cfg = loadConfig(env, { dbPath, ...config });
  const app = createApp({ config: cfg, clock });
  const addr = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}`;

  async function call(method, path, body, token) {
    const res = await fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  const world = {
    app, clock, url, call, cfg,
    /** Регистрирует игрока и возвращает хелпер с его токеном. sandbox:true — песочный аккаунт для демо-комнат. */
    async user(name, { sandbox = false } = {}) {
      const { status, body } = await call('POST', '/api/users', sandbox ? { name, sandbox: true } : { name });
      if (status !== 201) throw new Error('register failed ' + JSON.stringify(body));
      const token = body.token;
      const u = {
        id: body.user.id, name, token,
        get: (p) => call('GET', p, undefined, token),
        post: (p, b = {}) => call('POST', p, b, token),
        patch: (p, b = {}) => call('PATCH', p, b, token),
        me: async () => (await call('GET', '/api/users/me', undefined, token)).body,
        progress: async () => (await call('GET', '/api/users/me/progress', undefined, token)).body,
      };
      return u;
    },
    /** Двигает часы шагами по 5 с; перечисленные игроки «живы» (heartbeat), сервер тикает. */
    async advance(ms, alive = []) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(5000, left);
        clock.advance(step);
        for (const u of alive) await u.post('/api/heartbeat');
        app.tick();
        left -= step;
      }
    },
    ws(token) {
      return new WsClient(url.replace('http', 'ws') + '/ws', token);
    },
    async close() { await app.close(); },
  };
  return world;
}

export class WsClient {
  constructor(url, token) {
    this.events = [];
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      this.events.push(msg);
      this.waiters = this.waiters.filter((w) => !(w.pred(msg) && (w.resolve(msg), true)));
    });
    this.token = token;
  }
  async connect() {
    await this.opened;
    this.send({ type: 'auth', token: this.token });
    return this.wait((m) => m.type === 'hello');
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 3000) {
    const found = this.events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws wait timeout; got: ' + this.events.map((e) => e.type).join(','))), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  of(type) { return this.events.filter((e) => e.type === type); }
  close() { this.ws.terminate(); }
}

export function tmpDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'tomato-')), 'test.db');
}

/** Комната с хостом и участниками, все присоединились. Демо-комнату (settings.demo) играют песочные аккаунты. */
export async function lobby(world, names = ['Лотти', 'Аня', 'Боря'], settings = {}) {
  const users = [];
  const sandbox = settings.demo === true;
  for (const n of names) users.push(await world.user(n, { sandbox }));
  const [host, ...rest] = users;
  const created = await host.post('/api/rooms', { name: 'Боталка', focusMinutes: 25, breakMinutes: 5, ...settings });
  if (created.status !== 201) throw new Error('create room: ' + JSON.stringify(created.body));
  const room = created.body.room;
  for (const u of rest) {
    const j = await u.post('/api/rooms/join', { code: room.code });
    if (j.status !== 200) throw new Error('join: ' + JSON.stringify(j.body));
  }
  return { users, host, rest, room, path: (p = '') => `/api/rooms/${room.id}${p}` };
}

/** Прогоняет полную фокус-фазу: старт → +25 минут (все listed «живы») → перерыв. */
export async function runFocus(world, L, alive = L.users, minutes = 25) {
  const start = await L.host.post(L.path('/start'));
  if (start.status !== 200) throw new Error('start: ' + JSON.stringify(start.body));
  await world.advance(minutes * 60_000 + 1000, alive);
  return start.body;
}
