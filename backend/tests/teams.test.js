import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runBreak, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const kinds = async (u, kind) => (await ledger(u)).filter((t) => t.kind === kind);
const road = async (L, u) => (await u.get(L.path('/roadmap'))).body;
const teamsLobby = (w, names, extra = {}) => lobby(w, names, { teamMode: true, ...extra });
/**
 * Один цикл «фокус → перерыв». Следующий фокус плана стартует сам; сверх плана хост запускает вручную.
 * quitters сдаются сразу после старта — их команда может не сделать шаг.
 */
const cycle = async (w, L, quitters = []) => {
  if ((await L.host.get(L.path())).body.room.phase === 'waiting') await L.host.post(L.path('/start'));
  for (const q of quitters) await q.post(L.path('/session/abort'));
  await runFocus(w, L);
  await runBreak(w, L);
};

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
      assert.deepEqual(snap.challenge.teams.map((t) => [t.key, t.treasuryCoins]), [['A', 30], ['B', 30]], 'у каждой команды стартовая казна');

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

  test('очки вклада, казна и узлы считаются раздельно по командам; у каждого зрителя «своя» команда на верхнем уровне', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      await lotti.post(L.path('/start'));
      await w.advance(60_000, L.users);
      await boris.post(L.path('/session/abort')); // Боря сдаётся — в A качественно 1 из 2 (половина), в B 1 из 1: обе делают шаг
      await w.advance(25 * 60_000, L.users);

      const a = await road(L, lotti), b = await road(L, anya);
      assert.equal(a.teamKey, 'A'); assert.equal(b.teamKey, 'B');
      assert.deepEqual(a.teams.map((t) => [t.key, t.focusPoints, t.points, t.treasuryCoins]), [['A', 1, 1, 50], ['B', 1, 1, 50]]);
      assert.deepEqual(b.teams, a.teams);
      assert.equal(a.focusPoints, 1); assert.equal(b.focusPoints, 1);
      assert.equal(a.points, 1); assert.equal(b.points, 1); // обе команды сделали шаг первым качественным циклом
      assert.equal(a.treasuryCoins, 50); assert.equal(b.treasuryCoins, 50);

      assert.equal(a.nodes.find((n) => n.id === 'stop-1').reachedAt > 0, true);
      assert.equal(b.nodes.find((n) => n.id === 'stop-1').reachedAt > 0, true, 'этап B фиксируется отдельно');

      // цикл 2: вся команда A сдаётся — A стоит, B идёт дальше
      await runBreak(w, L);
      await cycle(w, L, [lotti, boris]);
      const a2 = await road(L, lotti);
      assert.deepEqual(a2.teams.map((t) => [t.key, t.points, t.positionNodeId]), [['A', 1, 'stop-1'], ['B', 2, 'stop-2']]);
      // награды за этап: каждая команда получает свою один раз, ключи разные
      assert.equal((await kinds(anya, 'team_node')).length, 2);
      assert.equal((await kinds(lotti, 'team_node')).length, 1);
      assert.notEqual((await kinds(anya, 'team_node'))[0].key, (await kinds(lotti, 'team_node'))[0].key);
      const a3 = await road(L, lotti);
      assert.ok(a3.contributions.every((c) => c.team === 'A' || c.team === 'B'));
    } finally { await w.close(); }
  });

  test('гонка: побеждает команда, первой взявшая крепость; награда победителям один раз; проигравшая её не получает', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря'], { cycles: 3 }); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      await cycle(w, L); // обе команды на 1-й остановке
      for (let i = 0; i < 2; i++) await cycle(w, L, [anya]); // Аня сдаётся — B стоит; A доходит до крепости (3)
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

      // B тоже доходит до цели позже (циклы сверх плана) — карта у неё пройдена, но награды победителя нет
      for (let i = 0; i < 2; i++) await cycle(w, L);
      const rb = await road(L, anya);
      assert.equal(rb.finished, true);
      assert.equal(rb.points, 3, 'шаги команды B ограничены целью (3)');
      assert.equal(rb.completed, false);
      assert.equal(rb.winner, 'A');
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1, 'повторно победители не награждаются');
      assert.equal((await kinds(anya, 'team_node')).length, 2, 'этапные награды команда B получила в пути (две остановки, крепость без награды)');
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1, 'победа объявляется один раз');
      assert.ok(!(await anya.progress()).achievements.find((a) => a.id === 'team_victory').unlocked);
    } finally { await w.close(); }
  });

  test('проигравшая команда, дошедшая до цели в одиночку, награду победителя не получает', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря'], { cycles: 3 }); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (let i = 0; i < 3; i++) await cycle(w, L, [anya]); // A выигрывает: 3 шага, B — 0
      assert.equal((await road(L, lotti)).winner, 'A');
      for (let i = 0; i < 3; i++) await cycle(w, L, [boris, lotti]); // дальше шаги делает только B: игроки A сдаются
      const rb = await road(L, anya);
      assert.equal(rb.points, 3);
      assert.equal(rb.finished, true);
      assert.equal(rb.completed, false);
      assert.equal(rb.winner, 'A');
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1);
    } finally { await w.close(); }
  });

  test('одновременный финиш — ничья (награда обеим)', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня']); // по одному в команде
      const [lotti, anya] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (let i = 0; i < 4; i++) await cycle(w, L); // план по умолчанию — 4 цикла
      const r = await road(L, lotti);
      assert.equal(r.winner, 'draw');
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1);
      assert.equal((await kinds(anya, 'team_challenge')).length, 1);
      assert.ok((await road(L, anya)).completed);
      assert.deepEqual(events.filter((e) => e.type === 'challenge_completed').map((e) => [e.data.team, e.data.draw]).sort(), [['A', true], ['B', true]]); // порядок команд в событиях не задан
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

  test('сохранение: команды, очки, казна и победитель переживают перезапуск; награды не дублируются', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await teamsLobby(w, ['Лотти', 'Аня']);
    for (let i = 0; i < 4; i++) await cycle(w, L);
    const tokens = L.users.map((u) => u.token);
    const before = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    const xp = (await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp;
    await w.close();

    w = await boot({ dbPath, clock });
    const after = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    assert.deepEqual(after, before);
    assert.equal(after.winner, 'draw');
    assert.deepEqual(after.teams.map((t) => t.treasuryCoins), [110, 110]); // 30 старт + 4 цикла по 20
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
      assert.equal(w.app.db.get("SELECT cycles FROM rooms WHERE id = 'r1'").cycles, 4, 'v5: план циклов по умолчанию');
      assert.equal(w.app.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '6');
    } finally { await w.close(); }
  });
});
