import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

describe('перезапуск backend', () => {
  test('Тест 11: занятия, XP, ресурсы, достижения, улучшения и комнаты переживают рестарт', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await runFocus(w, L);
    await L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
    const before = {
      host: await L.host.progress(),
      guest: await L.rest[0].progress(),
      sessions: (await L.host.get('/api/users/me/sessions')).body.sessions,
      room: (await L.host.get(L.path())).body,
    };
    const tokens = L.users.map((u) => u.token);
    await w.close();

    // «перезапуск»: новое приложение, тот же файл БД, те же токены
    w = await boot({ dbPath, clock });
    const get = (t, p) => w.call('GET', p, undefined, t);
    const hostAfter = (await get(tokens[0], '/api/users/me/progress')).body;
    assert.equal(hostAfter.xp, before.host.xp);
    assert.equal(hostAfter.coins, before.host.coins);
    assert.deepEqual(hostAfter.achievements.filter((a) => a.unlocked).map((a) => a.id), before.host.achievements.filter((a) => a.unlocked).map((a) => a.id));
    assert.equal(hostAfter.upgrades.find((u) => u.id === 'base_walls').level, 1);
    assert.equal((await get(tokens[1], '/api/users/me/progress')).body.xp, before.guest.xp);
    assert.deepEqual((await get(tokens[0], '/api/users/me/sessions')).body.sessions, before.sessions);
    const room = (await get(tokens[0], `/api/rooms/${L.room.id}`)).body;
    assert.equal(room.room.phase, 'break');
    assert.equal(room.room.phaseEndsAt, before.room.room.phaseEndsAt);
    assert.equal(room.challenge.points, before.room.challenge.points);
    assert.equal(room.challenge.focusPoints, before.room.challenge.focusPoints);
    assert.equal(room.challenge.treasuryCoins, before.room.challenge.treasuryCoins);

    // повторное начисление после рестарта невозможно
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await get(tokens[0], '/api/users/me/progress')).body.xp, before.host.xp);
    await w.close();
  });

  test('рестарт посреди Focus: таймер продолжается по меткам времени, сессия засчитывается', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await L.host.post(L.path('/start'));
    await w.advance(10 * 60_000, L.users);
    const tokens = L.users.map((u) => u.token);
    await w.close();

    clock.advance(20_000); // сервер был недоступен 20 с (< grace 30 с)
    w = await boot({ dbPath, clock });
    const alive = tokens.map((token) => ({ post: (p, b = {}) => w.call('POST', p, b, token) }));
    const room0 = (await w.call('GET', `/api/rooms/${L.room.id}`, undefined, tokens[0])).body.room;
    assert.equal(room0.phase, 'focus');
    assert.equal(room0.remainingMs, 15 * 60_000 - 20_000);
    await w.advance(15 * 60_000, alive);
    const p = (await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body;
    assert.equal(p.xp, 125); // 100 за сессию + 25 за первую остановку карты (шаг команды)
    assert.equal((await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp, 125);
    assert.equal(w.app.services.game.treasuryOf(L.room.id, 'shared'), 30 + 2 * 20, 'казна команды пережила рестарт и пополнилась');
    await w.close();
  });
});

// Таблицы в том виде, в каком их создавала схема v4 (до Tower Wars)
const V4_TABLES = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0), coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0), prank_enabled INTEGER NOT NULL DEFAULT 1,
  sandbox INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rooms (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, host_id TEXT NOT NULL REFERENCES users(id),
  phase TEXT NOT NULL CHECK (phase IN ('waiting','focus','break','completed')), cycle_id TEXT, cycle_no INTEGER NOT NULL DEFAULT 0,
  focus_sec INTEGER NOT NULL, break_sec INTEGER NOT NULL, demo INTEGER NOT NULL DEFAULT 0, phase_started_at INTEGER NOT NULL,
  phase_ends_at INTEGER, created_at INTEGER NOT NULL, closed_at INTEGER, mode TEXT NOT NULL DEFAULT 'shared');
CREATE TABLE team_progress (room_id TEXT NOT NULL REFERENCES rooms(id), team_key TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER, PRIMARY KEY (room_id, team_key));
CREATE TABLE team_nodes (room_id TEXT NOT NULL REFERENCES rooms(id), team_key TEXT NOT NULL, node_id TEXT NOT NULL, reached_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, team_key, node_id));
CREATE TABLE td_rounds (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), team_key TEXT NOT NULL, cycle_id TEXT NOT NULL,
  stage_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running','won','lost','expired')), started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL, speed REAL NOT NULL, state TEXT NOT NULL, result TEXT, finished_at INTEGER, UNIQUE (room_id, team_key, cycle_id));
CREATE TABLE td_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id), team_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('join','start','build','upgrade')),
  request_id TEXT, slot_id TEXT, cost INTEGER NOT NULL DEFAULT 0, result TEXT, created_at INTEGER NOT NULL, UNIQUE (user_id, request_id));
CREATE INDEX td_actions_by_cycle ON td_actions(room_id, team_key, cycle_id);
CREATE TABLE td_duels (room_id TEXT NOT NULL REFERENCES rooms(id), cycle_id TEXT NOT NULL, stage_id TEXT NOT NULL, winner TEXT NOT NULL,
  scores TEXT NOT NULL, decided_at INTEGER NOT NULL, PRIMARY KEY (room_id, cycle_id));
INSERT INTO meta VALUES ('schema_version', '4');
INSERT INTO users(id, name, token_hash, created_at, last_seen_at, xp, coins) VALUES ('u1', 'Лотти', 'h1', 1, 1, 300, 40), ('u2', 'Аня', 'h2', 1, 1, 0, 5);
INSERT INTO rooms(id, code, name, host_id, phase, cycle_id, cycle_no, focus_sec, break_sec, phase_started_at, created_at, mode)
  VALUES ('r1', 'OLD111', 'Старая', 'u1', 'waiting', 'c1', 1, 1500, 300, 0, 0, 'teams'), ('r2', 'OLD222', 'Победители', 'u2', 'waiting', NULL, 0, 1500, 300, 0, 0, 'shared');
INSERT INTO team_progress VALUES ('r1', 'A', 3, NULL), ('r1', 'B', 1, NULL), ('r2', 'shared', 6, 777);
INSERT INTO team_nodes VALUES ('r1', 'A', 'forest', 100), ('r2', 'shared', 'forest', 50), ('r2', 'shared', 'bridge', 60), ('r2', 'shared', 'fortress', 777);
INSERT INTO td_rounds VALUES ('t1', 'r1', 'A', 'c1', 'camp', 'won', 10, 20, 1.0, '{}', '{"hpLeft":80}', 20),
  ('t2', 'r1', 'B', 'c1', 'camp', 'lost', 10, 20, 1.0, '{}', NULL, 20);
INSERT INTO td_actions(id, room_id, team_key, cycle_id, user_id, kind, request_id, slot_id, cost, result, created_at)
  VALUES (5, 'r1', 'A', 'c1', 'u1', 'build', 'req-1', 's1', 15, '{"ok":1}', 11), (9, 'r1', 'B', 'c1', 'u2', 'start', NULL, NULL, 0, NULL, 12);
INSERT INTO td_duels VALUES ('r1', 'c1', 'camp', 'A', '{"A":80,"B":0}', 21);
`;

describe('миграция схемы v4 → v5 (Tower Wars)', () => {
  test('старая БД с данными открывается: данные целы, новые колонки и ограничения работают, повторный запуск ничего не ломает', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { Db } = await import('../src/db.js');
    const dbPath = tmpDbPath();
    const raw = new DatabaseSync(dbPath);
    raw.exec(V4_TABLES);
    raw.close();

    let db = new Db(dbPath);
    const check = () => {
      assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '6');
      assert.equal(db.get('PRAGMA foreign_keys').foreign_keys, 1, 'внешние ключи снова включены');
      assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
      // данные пользователей, комнат и командного прогресса на месте
      assert.deepEqual({ ...db.get("SELECT xp, coins, sandbox FROM users WHERE id = 'u1'") }, { xp: 300, coins: 40, sandbox: 0 });
      assert.equal(db.get("SELECT mode FROM rooms WHERE id = 'r1'").mode, 'teams');
      assert.deepEqual(db.all('SELECT room_id, team_key, points, completed_at, treasury_coins FROM team_progress ORDER BY room_id, team_key').map((r) => ({ ...r })), [
        { room_id: 'r1', team_key: 'A', points: 3, completed_at: null, treasury_coins: 30 },
        { room_id: 'r1', team_key: 'B', points: 1, completed_at: null, treasury_coins: 30 },
        { room_id: 'r2', team_key: 'shared', points: 6, completed_at: 777, treasury_coins: 30 },
      ]);
      assert.equal(db.get('SELECT COUNT(*) c FROM team_nodes').c, 4);
      // td_rounds: строки целы, round_no = 1
      assert.deepEqual(db.all('SELECT id, status, result, round_no FROM td_rounds ORDER BY id').map((r) => ({ ...r })), [
        { id: 't1', status: 'won', result: '{"hpLeft":80}', round_no: 1 },
        { id: 't2', status: 'lost', result: null, round_no: 1 },
      ]);
      // td_actions: id и данные сохранены, индекс пересоздан
      assert.deepEqual(db.all('SELECT id, kind, request_id, cost FROM td_actions ORDER BY id').map((r) => ({ ...r })), [
        { id: 5, kind: 'build', request_id: 'req-1', cost: 15 },
        { id: 9, kind: 'start', request_id: null, cost: 0 },
      ]);
      assert.ok(db.get("SELECT 1 x FROM sqlite_master WHERE type = 'index' AND name = 'td_actions_by_cycle' AND tbl_name = 'td_actions'"));
      assert.deepEqual({ ...db.get('SELECT stage_id, winner, round_no FROM td_duels') }, { stage_id: 'camp', winner: 'A', round_no: 1 });
      assert.equal(db.get("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%__v5'").c, 0, 'временных таблиц не осталось');
    };
    check();

    // казна: CHECK (treasury_coins >= 0)
    assert.throws(() => db.run("UPDATE team_progress SET treasury_coins = -1 WHERE room_id = 'r1' AND team_key = 'A'"));
    // td_rounds: реванш (round_no = 2) в том же перерыве разрешён, дубль номера — нет; без round_no — DEFAULT 1
    const round = (id, cycle, roundNo) => roundNo === undefined
      ? db.run("INSERT INTO td_rounds(id, room_id, team_key, cycle_id, stage_id, status, started_at, ends_at, speed, state) VALUES (?, 'r1', 'A', ?, 'camp', 'running', 0, 1, 1, '{}')", id, cycle)
      : db.run("INSERT INTO td_rounds(id, room_id, team_key, cycle_id, stage_id, status, started_at, ends_at, speed, state, round_no) VALUES (?, 'r1', 'A', ?, 'camp', 'running', 0, 1, 1, '{}', ?)", id, cycle, roundNo);
    round('t3', 'c1', 2);
    assert.throws(() => round('t4', 'c1', 2), /UNIQUE/);
    assert.throws(() => round('t5', 'c1'), /UNIQUE/, 'второй round_no = 1 в том же перерыве невозможен');
    round('t6', 'c2');
    assert.equal(db.get("SELECT round_no FROM td_rounds WHERE id = 't6'").round_no, 1);
    // td_actions: новые виды действий, мусорные — нет; AUTOINCREMENT продолжает старую нумерацию; идемпотентность цела
    const action = (kind, req) => db.run("INSERT INTO td_actions(room_id, team_key, cycle_id, user_id, kind, request_id, created_at) VALUES ('r1', 'A', 'c1', 'u1', ?, ?, 1)", kind, req);
    for (const kind of ['send_unit', 'buff', 'debuff', 'rematch']) action(kind, `r-${kind}`);
    assert.throws(() => action('cheat', 'r-cheat'), /CHECK/);
    assert.throws(() => action('build', 'req-1'), /UNIQUE/);
    assert.ok(db.get("SELECT MIN(id) m FROM td_actions WHERE kind = 'send_unit'").m > 9);
    // td_duels: дуэль считается отдельно для каждого раунда
    db.run("INSERT INTO td_duels(room_id, cycle_id, stage_id, winner, scores, decided_at, round_no) VALUES ('r1', 'c1', 'camp', 'B', '{}', 30, 2)");
    assert.throws(() => db.run("INSERT INTO td_duels(room_id, cycle_id, stage_id, winner, scores, decided_at) VALUES ('r1', 'c1', 'camp', 'B', '{}', 30)"), /UNIQUE|PRIMARY/);
    // внешние ключи снова действуют
    assert.throws(() => db.run("INSERT INTO td_actions(room_id, team_key, cycle_id, user_id, kind, created_at) VALUES ('nope', 'A', 'c1', 'u1', 'join', 1)"), /FOREIGN KEY/);
    db.close();

    // повторное открытие (идемпотентность миграции): данные и новые строки на месте, казна не сбрасывается
    db = new Db(dbPath);
    db.run("UPDATE team_progress SET treasury_coins = 12 WHERE room_id = 'r1' AND team_key = 'B'");
    db.close();
    db = new Db(dbPath);
    assert.equal(db.get("SELECT treasury_coins t FROM team_progress WHERE room_id = 'r1' AND team_key = 'B'").t, 12);
    assert.equal(db.get('SELECT COUNT(*) c FROM td_rounds').c, 4);
    assert.equal(db.get('SELECT COUNT(*) c FROM td_actions').c, 6);
    assert.equal(db.get('SELECT COUNT(*) c FROM td_duels').c, 2);
    db.close();

    // приложение поверх мигрированной БД: карта команды-победителя пройдена, казна видна
    const w = await boot({ dbPath });
    try {
      const road = w.app.services.game.roadmapView('r2');
      assert.deepEqual([road.positionNodeId, road.points, road.completed, road.finished, road.treasuryCoins, road.focusPoints], ['fortress', 6, true, true, 30, 0]);
      const r1 = w.app.services.game.roadmapView('r1');
      assert.deepEqual(r1.teams.map((t) => [t.key, t.points, t.positionNodeId, t.treasuryCoins]), [['A', 3, 'stop-3', 30], ['B', 1, 'stop-1', 12]]);
    } finally { await w.close(); }
  });

  test('новая БД сразу получает финальные формы таблиц', async () => {
    const { Db } = await import('../src/db.js');
    const db = new Db(':memory:');
    const cols = (t) => db.all(`PRAGMA table_info(${t})`).map((c) => c.name);
    assert.ok(cols('team_progress').includes('treasury_coins'));
    assert.ok(cols('td_rounds').includes('round_no'));
    assert.ok(cols('td_duels').includes('round_no'));
    assert.match(db.get("SELECT sql FROM sqlite_master WHERE name = 'td_actions'").sql, /'send_unit','buff','debuff','rematch'/);
    assert.equal(db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '6');
    db.close();
  });
});
