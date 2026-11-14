import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runBreak, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const kinds = async (u, kind) => (await ledger(u)).filter((t) => t.kind === kind);
const road = async (L, u) => (await u.get(L.path('/roadmap'))).body;
const teamsLobby = (w, names) => lobby(w, names, { teamMode: true });
const cycle = async (w, L) => { await runFocus(w, L); await w.advance(5 * 60_000, L.users); };
/** Победа команды в этапе TD (так её фиксирует сервис Tower Defense). */
function win(w, L, team, stageId, users) {
  const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
  return w.app.db.tx(() => w.app.services.game.recordStageVictory(room, team, stageId, users.map((u) => u.id)));
}
/** Обе команды берут крепость в один и тот же момент серверного времени. */
function bothWinFortress(w, L, a, b) {
  const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
  return w.app.db.tx(() => [
    w.app.services.game.recordStageVictory(room, 'A', 'fortress', a.map((u) => u.id)),
    w.app.services.game.recordStageVictory(room, 'B', 'fortress', b.map((u) => u.id)),
  ]);
}

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
      assert.deepEqual(a.teams.map((t) => [t.key, t.focusPoints, t.points, t.treasuryCoins]), [['A', 1, 0, 50], ['B', 1, 0, 50]]);
      assert.deepEqual(b.teams, a.teams);
      assert.equal(a.focusPoints, 1); assert.equal(b.focusPoints, 1);
      assert.equal(a.points, 0); assert.equal(b.points, 0);
      assert.equal(a.treasuryCoins, 50); assert.equal(b.treasuryCoins, 50);

      // следующий цикл — все трое: казна A +40, B +20
      await w.advance(5 * 60_000, L.users);
      await runFocus(w, L);
      assert.deepEqual((await road(L, lotti)).teams.map((t) => [t.key, t.focusPoints, t.treasuryCoins]), [['A', 3, 90], ['B', 2, 70]]);

      // победы в TD двигают только свою команду
      assert.equal(win(w, L, 'A', 'camp', [lotti, boris]).reachedNodeId, 'forest');
      let a2 = await road(L, lotti), b2 = await road(L, anya);
      assert.deepEqual(a2.teams.map((t) => [t.key, t.points, t.positionNodeId]), [['A', 1, 'forest'], ['B', 0, 'camp']]);
      assert.equal(a2.nodes.find((n) => n.id === 'forest').reachedAt > 0, true);
      assert.equal(b2.nodes.find((n) => n.id === 'forest').reachedAt, null, 'у B свой путь');
      win(w, L, 'B', 'camp', [anya]);
      b2 = await road(L, anya);
      assert.equal(b2.nodes.find((n) => n.id === 'forest').reachedAt > 0, true, 'этап B фиксируется отдельно');
      // награды за этап: каждая команда получает свою один раз, ключи разные
      assert.equal((await kinds(anya, 'team_node')).length, 2);
      assert.equal((await kinds(lotti, 'team_node')).length, 1);
      assert.notEqual((await kinds(anya, 'team_node'))[0].key, (await kinds(lotti, 'team_node'))[0].key);
      a2 = await road(L, lotti);
      assert.ok(a2.contributions.every((c) => c.team === 'A' || c.team === 'B'));
    } finally { await w.close(); }
  });

  test('гонка: побеждает команда, первой взявшая крепость; награда победителям один раз; проигравшая её не получает', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня', 'Боря']); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (const st of ['camp', 'forest', 'bridge']) { win(w, L, 'A', st, [lotti, boris]); win(w, L, 'B', st, [anya]); }
      w.app.clock.advance(1000);
      win(w, L, 'A', 'fortress', [lotti, boris]);
      const r = await road(L, lotti);
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

      // B тоже берёт крепость позже — карта у неё пройдена, но награды победителя нет
      w.app.clock.advance(1000);
      assert.deepEqual(win(w, L, 'B', 'fortress', [anya]), { reachedNodeId: null, completed: false, finished: true });
      const rb = await road(L, anya);
      assert.equal(rb.finished, true);
      assert.equal(rb.points, 4);
      assert.equal(rb.completed, false);
      assert.equal(rb.winner, 'A');
      assert.equal((await kinds(anya, 'team_challenge')).length, 0);
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1, 'повторно победители не награждаются');
      assert.equal((await kinds(anya, 'team_node')).length, 3, 'этапные награды команда B получила в пути');
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1, 'победа объявляется один раз');
      assert.ok(!(await anya.progress()).achievements.find((a) => a.id === 'team_victory').unlocked);
    } finally { await w.close(); }
  });

  test('одновременное взятие крепости — ничья (награда обеим)', async () => {
    const w = await boot();
    try {
      const L = await teamsLobby(w, ['Лотти', 'Аня']); // по одному в команде
      const [lotti, anya] = L.users;
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      for (const st of ['camp', 'forest', 'bridge']) { win(w, L, 'A', st, [lotti]); win(w, L, 'B', st, [anya]); }
      const res = bothWinFortress(w, L, [lotti], [anya]);
      assert.deepEqual(res.map((x) => x.completed), [true, true]);
      const r = await road(L, lotti);
      assert.equal(r.winner, 'draw');
      assert.equal((await kinds(lotti, 'team_challenge')).length, 1);
      assert.equal((await kinds(anya, 'team_challenge')).length, 1);
      assert.ok((await road(L, anya)).completed);
      assert.deepEqual(events.filter((e) => e.type === 'challenge_completed').map((e) => [e.data.team, e.data.draw]), [['A', false], ['B', true]]);
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
    await cycle(w, L);
    for (const st of ['camp', 'forest', 'bridge']) { win(w, L, 'A', st, [L.users[0]]); win(w, L, 'B', st, [L.users[1]]); }
    bothWinFortress(w, L, [L.users[0]], [L.users[1]]);
    const tokens = L.users.map((u) => u.token);
    const before = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    const xp = (await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp;
    await w.close();

    w = await boot({ dbPath, clock });
    const after = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    assert.deepEqual(after, before);
    assert.equal(after.winner, 'draw');
    assert.deepEqual(after.teams.map((t) => t.treasuryCoins), [50, 50]);
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
      assert.equal(w.app.db.get("SELECT value FROM meta WHERE key = 'schema_version'").value, '5');
    } finally { await w.close(); }
  });
});
