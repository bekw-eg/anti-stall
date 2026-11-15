import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';
import { createLogger, createMetrics } from '../src/observability.js';

/** Наблюдаемость: /api/metrics (Prometheus), X-Request-Id, приём ошибок из браузера, health со схемой. */
describe('наблюдаемость', () => {
  test('метрики в формате Prometheus: запросы по шаблону маршрута, комнаты, пользователи, WS', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти']);
      await L.host.get(L.path());
      const res = await fetch(`${w.url}/api/metrics`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/plain; version=0\.0\.4/);
      const text = await res.text();
      // метка — шаблон, а не сырой путь с id (иначе кардинальность метрик растёт с каждой комнатой)
      assert.match(text, /antistall_http_requests_total\{method="GET",route="\/api\/rooms\/:id",status="200"\} 1/);
      assert.ok(!text.includes(L.room.id), 'id комнат в метках не появляются');
      assert.match(text, /antistall_http_request_duration_seconds_bucket\{route="\/api\/rooms\/:id",le="\+Inf"\} 1/);
      assert.match(text, /antistall_rooms\{phase="waiting"\} 1/);
      assert.match(text, /antistall_users\{type="guest"\} 1/);
      assert.match(text, /antistall_ws_connections 0/);
      assert.match(text, /antistall_schema_version 10/);
    } finally { await w.close(); }
  });

  test('X-Request-Id в каждом ответе; свой id от прокси сохраняется', async () => {
    const w = await boot();
    try {
      const a = await fetch(`${w.url}/api/health`);
      assert.match(a.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
      const b = await fetch(`${w.url}/api/health`, { headers: { 'X-Request-Id': 'proxy-req-12345' } });
      assert.equal(b.headers.get('x-request-id'), 'proxy-req-12345');
      const h = await b.json();
      assert.equal(h.status, 'ok');
      assert.equal(h.schemaVersion, 10);
      assert.equal(typeof h.uptimeSec, 'number');
    } finally { await w.close(); }
  });

  test('ошибки из браузера: 204, счётчик source="client", лимит в минуту → 429', async () => {
    const w = await boot({ config: { clientErrorsPerMinute: 2 } });
    try {
      const send = () => fetch(`${w.url}/api/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'error', message: 'x is not a function', url: '/room/ABC' }) });
      assert.equal((await send()).status, 204);
      assert.equal((await send()).status, 204);
      assert.equal((await send()).status, 429);
      const text = await (await fetch(`${w.url}/api/metrics`)).text();
      assert.match(text, /antistall_errors_total\{source="client"\} 2/);
    } finally { await w.close(); }
  });

  test('токен метрик: без него 401, с ним 200', async () => {
    const w = await boot({ config: { metricsToken: 'secret-token' } });
    try {
      assert.equal((await fetch(`${w.url}/api/metrics`)).status, 401);
      assert.equal((await fetch(`${w.url}/api/metrics`, { headers: { Authorization: 'Bearer secret-token' } })).status, 200);
    } finally { await w.close(); }
  });

  test('логгер пишет одну JSON-строку на событие; ошибки — в stderr', () => {
    const out = []; const err = [];
    const log = createLogger({ out: { write: (s) => out.push(s) }, err: { write: (s) => err.push(s) } });
    log('info', 'http', { status: 200 });
    log('error', 'tick_error', { error: 'boom' });
    log('debug', 'skip');
    assert.equal(out.length, 1);
    assert.deepEqual({ ...JSON.parse(out[0]), t: 0 }, { t: 0, level: 'info', msg: 'http', status: 200 });
    assert.equal(JSON.parse(err[0]).msg, 'tick_error');
  });

  test('гистограмма: накопительные бакеты, sum и count', () => {
    const m = createMetrics();
    const h = m.histogram('x_seconds', 'тест', [0.1, 1]);
    h.observe({ route: '/a' }, 0.05);
    h.observe({ route: '/a' }, 0.5);
    const text = m.render();
    assert.match(text, /x_seconds_bucket\{route="\/a",le="0\.1"\} 1/);
    assert.match(text, /x_seconds_bucket\{route="\/a",le="1"\} 2/);
    assert.match(text, /x_seconds_count\{route="\/a"\} 2/);
  });
});
