import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const kinds = async (u, kind) => (await ledger(u)).filter((t) => t.kind === kind);
const road = async (L, u) => (await u.get(L.path('/roadmap'))).body;
const teamsLobby = (w, names) => lobby(w, names, { teamMode: true });
const cycle = async (w, L) => { await runFocus(w, L); await w.advance(5 * 60_000, L.users); };

describe('командный режим Team A / Team B', () => {
  test('автобаланс команд, режим виден в снимке; смена команды только до старта и только в командном режиме', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря', 'Вера']);
      const snap = (await L.host.get(L.path())).body;
      assert.equal(snap.room.mode, 'teams');
      assert.deepEqual(snap.members.map((m) => m.team), ['A', 'B', 'A', 'B']);
      assert.equal(snap.me.team, 'A');
      assert.ok(snap.me.allowedActions.includes('set_team'));
      assert.deepEqual(snap.challenge.teams.map((t) => t.key), ['A', 'B']);

      const [lotti, anya] = L.users;
      assert.equal((await anya.post(L.path('/team'), { team: 'A' })).status, 200);
      assert.equal((await anya.get(L.path())).body.me.team, 'A');
      assert.equal((await anya.post(L.path('/team'), { team: 'C' })).body.error.code, 'INVALID_FIELD');
      await lotti.post(L.path('/start'));
      assert.equal((await anya.post(L.path('/team'), { team: 'B' })).body.error.code, 'WRONG_PHASE');

      const shared = await lobby(w, ['Хост']);
      assert.equal((await shared.host.post(shared.path('/team'), { team: 'A' })).body.error.code, 'NOT_TEAM_MODE');
      assert.equal((await shared.host.get(shared.path())).body.room.mode, 'shared');
      assert.equal((await w.call('POST', '/api/rooms', { teamMode: 'yes' }, shared.host.token)).body.error.code, 'INVALID_FIELD');
    } finally { await w.close(); }
  });

  test('очки и этапы считаются раздельно по командам; у каждого зрителя «своя» команда на верхнем уровне', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      await lotti.post(L.path('/start'));
      await w.advance(60_000, L.users);
      await boris.post(L.path('/session/abort')); // Боря выходит — команда A получает 1 очко, B — 1
      await w.advance(25 * 60_000, L.users);

      const a = await road(L, lotti), b = await road(L, anya);
      assert.equal(a.teamKey, 'A'); assert.equal(b.teamKey, 'B');
      assert.deepEqual(a.teams.map((t) => [t.key, t.points]), [['A', 1], ['B', 1]]);
      assert.deepEqual(b.teams.map((t) => [t.key, t.points]), [['A', 1], ['B', 1]]);
      assert.equal(a.points, 1); assert.equal(b.points, 1);

      // этапов пока нет (по 1 очку); перерыв заканчивается, следующий цикл — все трое в строю
      await w.advance(5 * 60_000, L.users);
      await cycle(w, L);
      const a2 = await road(L, lotti), b2 = await road(L, anya);
      assert.deepEqual(a2.teams.map((t) => [t.key, t.points, t.positionNodeId]), [['A', 3, 'forest'], ['B', 2, 'forest']]);
      assert.equal(a2.nodes.find((n) => n.id === 'forest').reachedAt > 0, true);
      assert.equal(b2.nodes.find((n) => n.id === 'forest').reachedAt > 0, true, 'этап B фиксируется отдельно');
      // награды за этап: каждая команда получает свою один раз, ключи разные
      assert.equal((await kinds(anya, 'team_node')).length, 1);
      assert.equal((await kinds(lotti, 'team_node')).length, 1);
      assert.notEqual((await kinds(anya, 'team_node'))[0].key, (await kinds(lotti, 'team_node'))[0].key);
      assert.ok(a2.contributions.every((c) => c.team === 'A' || c.team === 'B'));
    } finally { await w.close(); }
  });

  test('гонка: побеждает команда, первой набравшая цель; награда победителям один раз; проигравшая её не получает', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря (+2/цикл); B: Аня (+1/цикл)
      const [lotti, anya, boris] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (let i = 0; i < 3; i++) await cycle(w, L); // A: 6, B: 3
      let r = await road(L, lotti);
      assert.equal(r.winner, 'A');
      assert.equal(r.completed, true);
      assert.equal((await road(L, anya)).completed, false);
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1);
      assert.equal((await kinds(boris, 'team_challenge')).length, 1);
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      const done = events.filter((e) => e.type === 'challenge_completed');
      assert.equal(done.length, 1);
      assert.equal(done[0].data.team, 'A');
      assert.equal(done[0].data.draw, false);

      // B тоже доходит до цели позже — карта у неё пройдена, но награды победителя нет
      for (let i = 0; i < 3; i++) await cycle(w, L);
      const rb = await road(L, anya);
      assert.equal(rb.finished, true);
      assert.equal(rb.completed, false);
      assert.equal(rb.winner, 'A');
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1, 'повторно победители не награждаются');
      assert.equal((await kinds(anya, 'team_node')).length, 2, 'этапные награды команда B получила в пути');
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1, 'победа объявляется один раз');
    } finally { await w.close(); }
  });

  test('проигравшая команда, дошедшая до цели в одиночку, награду победителя не получает', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (let i = 0; i < 3; i++) await cycle(w, L); // A выигрывает: 6 очков, B — 3
      assert.equal((await road(L, lotti)).winner, 'A');
      for (let i = 0; i < 3; i++) { // дальше очки приносит только B: игроки A выходят досрочно
        await lotti.post(L.path('/start'));
        await boris.post(L.path('/session/abort'));
        await lotti.post(L.path('/session/abort'));
        await w.advance(25 * 60_000 + 1000, L.users);
        await w.advance(5 * 60_000, L.users);
      }
      const rb = await road(L, anya);
      assert.equal(rb.points, 6);
      assert.equal(rb.finished, true);
      assert.equal(rb.completed, false);
      assert.equal(rb.winner, 'A');
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1);
    } finally { await w.close(); }
  });

  test('одновременный финиш: больше очков — победитель, равенство — ничья (награда обеим)', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня']); // по одному в команде
      const [lotti, anya] = L.users;
      for (let i = 0; i < 6; i++) await cycle(w, L);
      const r = await road(L, lotti);
      assert.equal(r.winner, 'draw');
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1);
      assert.equal((await kinds(anya, 'team_challenge')).length, 1);
      assert.ok((await road(L, anya)).completed);
    } finally { await w.close(); }
  });

  test('помощь — только своей команде, пакости можно слать сопернику', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      await runFocus(w, L);
      const rival = await lotti.post(L.path('/social/help'), { targetUserId: anya.id, type: 'boost' });
      assert.equal(rival.body.error.code, 'NOT_TEAMMATE');
      assert.equal((await lotti.post(L.path('/social/help'), { targetUserId: boris.id, type: 'boost' })).status, 201);
      assert.equal((await lotti.post(L.path('/social/prank'), { targetUserId: anya.id, type: 'fog' })).status, 201);
    } finally { await w.close(); }
  });

  test('сохранение: команды, очки и победитель переживают перезапуск; награды не дублируются', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await teamsLobby(w, ['Лотти', 'Аня']);
    for (let i = 0; i < 6; i++) await cycle(w, L);
    const tokens = L.users.map((u) => u.token);
    const before = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    const xp = (await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp;
    await w.close();

    w = await boot({ dbPath, clock });
    const after = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    assert.deepEqual(after, before);
    assert.equal(after.winner, 'draw');
    const room = (await w.call('GET', `/api/rooms/${L.room.id}`, undefined, tokens[1])).body;
    assert.equal(room.me.team, 'B');
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp, xp);
    await w.close();
  });

  test('миграция: база без колонки mode (старая схема) открывается и получает режим «shared»', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = tmpDbPath();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TABLE rooms (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, host_id TEXT NOT NULL, phase TEXT NOT NULL,
      cycle_id TEXT, cycle_no INTEGER NOT NULL DEFAULT 0, focus_sec INTEGER NOT NULL, break_sec INTEGER NOT NULL, demo INTEGER NOT NULL DEFAULT 0,
      phase_started_at INTEGER NOT NULL, phase_ends_at INTEGER, created_at INTEGER NOT NULL, closed_at INTEGER);
      INSERT INTO rooms VALUES ('r1','ABC123','Старая','u','waiting',NULL,0,1500,300,0,0,NULL,0,NULL);`);
    raw.close();
    const w = await boot({ dbPath });
    try {
      assert.equal(w.app.db.get("SELECT mode FROM rooms WHERE id = 'r1'").mode, 'shared');
      assert.equal(w.app.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '4');
    } finally { await w.close(); }
  });
});
