import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { loadConfig } from '../src/config.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

const DEMO = { env: { TOMATO_DEMO: '1' } };
const demoRoom = (extra = {}) => ({ demo: true, focusSeconds: 25, breakSeconds: 15, focusMinutes: undefined, breakMinutes: undefined, ...extra });
const kinds = async (u, kind) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === kind);

describe('песочница демо-режима: регистрация и авторизация', () => {
  test('без демо-режима песочный аккаунт не создаётся, поле sandbox валидируется', async () => {
    const w = await boot();
    try {
      const r = await w.call('POST', '/api/users', { name: 'Демо', sandbox: true });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DEMO_DISABLED');
      const bad = await w.call('POST', '/api/users', { name: 'Демо', sandbox: 'yes' });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'INVALID_FIELD');
      assert.equal(bad.body.error.details.field, 'sandbox');
      const regular = await w.call('POST', '/api/users', { name: 'Обычный', sandbox: false });
      assert.equal(regular.status, 201);
      assert.equal(regular.body.user.sandbox, false);
    } finally { await w.close(); }
  });

  test('в демо-режиме: sandbox:true → users.me().sandbox = true, обычный — false', async () => {
    const w = await boot(DEMO);
    try {
      const s = await w.user('Песочный', { sandbox: true });
      const u = await w.user('Обычный');
      assert.equal((await s.me()).sandbox, true);
      assert.equal((await u.me()).sandbox, false);
      assert.equal((await w.call('POST', '/api/users', { name: 'X', sandbox: 1 })).body.error.code, 'INVALID_FIELD');
    } finally { await w.close(); }
  });

  test('токен песочного аккаунта не работает на сервере без демо-режима (REST 401, WS 4401); обычный — работает', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ ...DEMO, dbPath, clock });
    const s = await w.user('Песочный', { sandbox: true });
    const u = await w.user('Обычный');
    assert.equal((await s.post('/api/rooms', demoRoom())).status, 201);
    await w.close();

    w = await boot({ dbPath, clock }); // тот же файл БД, но production-режим
    try {
      assert.equal((await w.call('GET', '/api/users/me', undefined, s.token)).status, 401);
      assert.equal((await w.call('POST', '/api/heartbeat', {}, s.token)).status, 401);
      assert.equal((await w.call('GET', '/api/users/me', undefined, u.token)).status, 200);
      const c = w.ws(s.token);
      await c.opened;
      c.send({ type: 'auth', token: s.token });
      const err = await c.wait((m) => m.type === 'error');
      assert.equal(err.data.code, 'UNAUTHORIZED');
      c.close();
    } finally { await w.close(); }
  });

  test('миграция: старая таблица users без sandbox открывается, все пользователи — обычные', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = tmpDbPath();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0), coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      prank_enabled INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users(id, name, token_hash, created_at, last_seen_at, xp, coins) VALUES ('u1','Старый','h1',0,0,300,40);`);
    raw.close();
    const w = await boot({ dbPath });
    try {
      const row = w.app.db.get("SELECT sandbox, xp, coins FROM users WHERE id = 'u1'");
      assert.deepEqual({ ...row }, { sandbox: 0, xp: 300, coins: 40 }, 'данные сохранены, колонка добавлена');
      assert.equal(w.app.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '5');
    } finally { await w.close(); }
  });

  test('флаг --demo в argv = TOMATO_DEMO=1; в демо-режиме без TOMATO_DB — отдельный файл tomato-demo.db', () => {
    assert.equal(loadConfig({}, {}, ['--demo']).demoMode, true);
    assert.equal(loadConfig({}, {}, []).demoMode, false);
    assert.match(loadConfig({}, {}, ['--demo']).dbPath, /tomato-demo\.db$/);
    assert.match(loadConfig({ TOMATO_DEMO: '1' }).dbPath, /tomato-demo\.db$/);
    assert.match(loadConfig({}).dbPath, /tomato\.db$/);
    assert.equal(loadConfig({ TOMATO_DEMO: '1', TOMATO_DB: 'x.db' }).dbPath, 'x.db');
    // потолки production не зависят от флага: повышенные значения лежат в отдельных ключах
    const prod = loadConfig({});
    const demo = loadConfig({ TOMATO_DEMO: '1' });
    assert.equal(demo.economy.dailyRewardedSessions, prod.economy.dailyRewardedSessions);
    assert.equal(demo.economy.td.dailyRewardedRounds, prod.economy.td.dailyRewardedRounds);
    assert.equal(demo.social.prank.cooldownMs, prod.social.prank.cooldownMs);
    assert.ok(demo.economy.demoDailyRewardedSessions > demo.economy.dailyRewardedSessions);
  });
});

describe('песочница демо-режима: доступ к комнатам', () => {
  test('песочный аккаунт — только демо-комнаты: создание, вход по коду и по id', async () => {
    const w = await boot(DEMO);
    try {
      const s = await w.user('Песочный', { sandbox: true });
      const u = await w.user('Обычный');
      const normal = (await u.post('/api/rooms', { name: 'Обычная' })).body.room;
      let r = await s.post('/api/rooms', { name: 'Хочу обычную', focusMinutes: 25 });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'SANDBOX_DEMO_ONLY');
      assert.equal((await s.post('/api/rooms/join', { code: normal.code })).body.error.code, 'SANDBOX_DEMO_ONLY');
      assert.equal((await s.post(`/api/rooms/${normal.id}/join`)).body.error.code, 'SANDBOX_DEMO_ONLY');
      r = await s.post('/api/rooms', demoRoom());
      assert.equal(r.status, 201);
      assert.equal(r.body.room.demo, true);
    } finally { await w.close(); }
  });

  test('обычный аккаунт не создаёт демо-комнату и не входит в неё (по коду, по id, повторно)', async () => {
    const w = await boot(DEMO);
    try {
      const s = await w.user('Песочный', { sandbox: true });
      const u = await w.user('Обычный');
      const demo = (await s.post('/api/rooms', demoRoom())).body.room;
      let r = await u.post('/api/rooms', demoRoom());
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DEMO_SANDBOX_ONLY');
      r = await u.post('/api/rooms/join', { code: demo.code });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DEMO_SANDBOX_ONLY');
      assert.equal((await u.post(`/api/rooms/${demo.id}/join`)).body.error.code, 'DEMO_SANDBOX_ONLY');
      assert.equal((await u.get(`/api/rooms/${demo.id}`)).body.error.code, 'NOT_A_MEMBER');
      // песочный игрок, вышедший из демо-комнаты, возвращается без проблем
      const s2 = await w.user('Песочный-2', { sandbox: true });
      assert.equal((await s2.post('/api/rooms/join', { code: demo.code })).status, 200);
      assert.equal((await s2.post(`/api/rooms/${demo.id}/leave`)).status, 200);
      assert.equal((await s2.post(`/api/rooms/${demo.id}/join`)).status, 200);
    } finally { await w.close(); }
  });

  test('сменить тип комнаты настройками нельзя', async () => {
    const w = await boot(DEMO);
    try {
      const s = await w.user('Песочный', { sandbox: true });
      const u = await w.user('Обычный');
      const normal = (await u.post('/api/rooms', { name: 'Обычная' })).body.room;
      const demo = (await s.post('/api/rooms', demoRoom())).body.room;
      let r = await u.patch(`/api/rooms/${normal.id}/settings`, { demo: true, focusSeconds: 5 });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DEMO_SANDBOX_ONLY');
      r = await s.patch(`/api/rooms/${demo.id}/settings`, { demo: false, focusMinutes: 25 });
      assert.equal(r.body.error.code, 'SANDBOX_DEMO_ONLY');
      assert.equal((await u.patch(`/api/rooms/${normal.id}/settings`, { demo: 'yes' })).body.error.code, 'INVALID_FIELD');
      // без смены типа настройки меняются как раньше
      assert.equal((await u.patch(`/api/rooms/${normal.id}/settings`, { demo: false, focusMinutes: 30 })).body.room.settings.focusSec, 1800);
      assert.equal((await s.patch(`/api/rooms/${demo.id}/settings`, { focusSeconds: 40 })).body.room.settings.focusSec, 40);
      assert.equal((await u.get(`/api/rooms/${normal.id}`)).body.room.demo, false);
    } finally { await w.close(); }
  });

  test('старые данные: демо-комната не запускается без демо-режима, обычный участник демо-комнаты пропускается', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ ...DEMO, dbPath, clock });
    const L = await lobby(w, ['Лотти'], demoRoom({ cycles: 1 })); // план из 1 цикла: после перерыва комната ждёт хоста
    const legacy = await w.user('Старый');
    // как будто обычный игрок попал в демо-комнату до появления песочницы
    w.app.db.run('INSERT INTO room_members(room_id, user_id, team_key, joined_at) VALUES (?,?,?,?)', L.room.id, legacy.id, 'shared', clock.now());
    const s = await L.host.post(L.path('/start'));
    assert.equal(s.status, 200);
    assert.deepEqual(s.body.start.skipped, [{ userId: legacy.id, reason: 'sandbox_mismatch' }]);
    assert.deepEqual(s.body.start.participants, [L.host.id]);
    await w.advance(26_000, L.users);
    assert.equal((await legacy.progress()).xp, 0);
    await w.advance(16_000, L.users);
    await w.close();

    // тот же файл без демо-режима: обычный хост демо-комнаты (старые данные) не может её запустить
    w = await boot({ dbPath, clock });
    try {
      w.app.db.run('UPDATE rooms SET host_id = ? WHERE id = ?', legacy.id, L.room.id);
      const r = await w.call('POST', L.path('/start'), {}, legacy.token);
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DEMO_DISABLED');
    } finally { await w.close(); }
  });
});

describe('песочница демо-режима: потолки и кулдауны только по room.demo', () => {
  test('суточный потолок сессий: демо-комната — demoDailyRewardedSessions, обычная комната на демо-сервере — обычный', async () => {
    const w = await boot({ ...DEMO, config: { economy: { dailyRewardedSessions: 1, demoDailyRewardedSessions: 3 } } });
    try {
      const D = await lobby(w, ['Демо'], demoRoom({ breakSeconds: 10 })); // перерыв — минимум 10 с
      for (let i = 0; i < 4; i++) { await runFocus(w, D, D.users, 0.5); await w.advance(11_000, D.users); }
      const ds = (await D.host.get('/api/users/me/sessions')).body.sessions;
      assert.deepEqual(ds.map((x) => x.rewarded), [false, true, true, true], 'демо-потолок 3, а не 1');
      assert.equal(ds[0].endReason, 'daily_cap');

      const N = await lobby(w, ['Обычный'], { focusMinutes: 10, breakMinutes: 3 });
      for (let i = 0; i < 2; i++) { await runFocus(w, N, N.users, 10); await w.advance(3 * 60_000, N.users); }
      const ns = (await N.host.get('/api/users/me/sessions')).body.sessions.filter((x) => x.status !== 'active'); // 3-й фокус плана уже идёт
      assert.deepEqual(ns.map((x) => x.rewarded), [false, true], 'обычная комната: потолок production (1)');
    } finally { await w.close(); }
  });

  test('потолок наград Tower Defense: демо-комната — demoDailyRewardedRounds, обычная — dailyRewardedRounds', async () => {
    const w = await boot({ ...DEMO, config: { economy: { td: { dailyRewardedRounds: 0, demoDailyRewardedRounds: 5 } } } });
    const fund = (u) => w.app.db.run('UPDATE users SET coins = coins + 100 WHERE id = ?', u.id);
    let rid = 0;
    const build = (L, slotId) => L.host.post(L.path('/td/build'), { slotId, type: 'arrow', requestId: `sbx-req-${++rid}` });
    try {
      const D = await lobby(w, ['Демо'], demoRoom({ breakSeconds: 20 }));
      await D.host.post(D.path('/start'));
      await w.advance(26_000, D.users);
      fund(D.host);
      await build(D, 's1'); await build(D, 's3');
      assert.equal((await D.host.post(D.path('/td/start'), { stageId: 'camp' })).status, 200);
      await w.advance(15_000, D.users);
      assert.equal((await D.host.get(D.path('/td'))).body.round.status, 'won');
      assert.equal((await kinds(D.host, 'td_round')).length, 1, 'в демо-комнате награда есть');

      const N = await lobby(w, ['Обычный']);
      await runFocus(w, N);
      fund(N.host);
      await build(N, 's1'); await build(N, 's3');
      assert.equal((await N.host.post(N.path('/td/start'), { stageId: 'camp' })).status, 200);
      await w.advance(70_000, N.users);
      assert.equal((await N.host.get(N.path('/td'))).body.round.status, 'won');
      assert.equal((await kinds(N.host, 'td_round')).length, 0, 'обычная комната: потолок production (0) не поднят демо-флагом');
    } finally { await w.close(); }
  });

  test('кулдаун пакостей: короткий только в демо-комнате, в обычной на демо-сервере — как на production', async () => {
    const w = await boot(DEMO);
    try {
      const cfg = (await w.call('GET', '/api/config')).body.social.prankRules;
      assert.equal(cfg.cooldownMs, 20_000);
      assert.equal(cfg.demoCooldownMs, 1_000);

      const D = await lobby(w, ['Лотти', 'Аня'], demoRoom({ breakSeconds: 60 }));
      await runFocus(w, D, D.users, 0.5);
      const [dh, dg] = D.users;
      assert.equal((await dh.post(D.path('/social/prank'), { targetUserId: dg.id, type: 'fog' })).status, 201);
      await w.advance(1_500, D.users);
      assert.equal((await dh.post(D.path('/social/prank'), { targetUserId: dg.id, type: 'sticker' })).status, 201, 'демо: 1 с');

      const N = await lobby(w, ['Хост', 'Гость'], { focusMinutes: 10, breakMinutes: 5 });
      await runFocus(w, N, N.users, 10);
      const [nh, ng] = N.users;
      assert.equal((await nh.post(N.path('/social/prank'), { targetUserId: ng.id, type: 'fog' })).status, 201);
      await w.advance(1_500, N.users);
      const r = await nh.post(N.path('/social/prank'), { targetUserId: ng.id, type: 'sticker' });
      assert.equal(r.status, 429);
      assert.equal(r.body.error.code, 'PRANK_COOLDOWN');
      assert.ok(r.body.error.details.retryAfterMs > 15_000, 'обычный кулдаун 20 с');
    } finally { await w.close(); }
  });
});
