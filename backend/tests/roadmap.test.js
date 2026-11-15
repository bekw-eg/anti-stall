import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runBreak, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const roadOf = async (L, u = L.host) => (await u.get(L.path('/roadmap'))).body;

/** Победа команды в этапе TD — так её фиксирует сервис Tower Defense (сервер, не клиент). */
function win(w, L, team, stageId, users = L.users) {
  const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
  return w.app.db.tx(() => w.app.services.game.recordStageVictory(room, team, stageId, users.map((u) => u.id)));
}

describe('Road Map: узлы открывают победы в Tower Defense', () => {

  test('лагерь → лес → мост → крепость → победа: события, награды, статусы', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      const events = [];
      w.app.db.sink = (evs) => events.push(...evs);
      const before = await L.host.progress();

      assert.deepEqual(win(w, L, 'shared', 'camp'), { reachedNodeId: 'forest', completed: false, finished: false });
      let road = await roadOf(L);
      assert.equal(road.positionNodeId, 'forest');
      assert.equal(road.points, 1);
      assert.ok(road.nodes[1].reachedAt > 0, 'время прохождения узла сохранено сервером');
      assert.deepEqual(road.next, { nodeId: 'bridge', title: 'Мост дедлайнов', pointsNeeded: 1, stageId: 'forest' });
      assert.deepEqual(road.nodes.map((n) => n.status), ['completed', 'current', 'next', 'locked']);
      const nodeTx = (await ledger(L.host)).filter((t) => t.kind === 'team_node');
      assert.equal(nodeTx.length, 1);
      assert.deepEqual([nodeTx[0].xp, nodeTx[0].coins], [25, 10]);
      assert.equal((await L.host.progress()).xp - before.xp, 25);
      const reached = events.filter((e) => e.type === 'node_reached');
      assert.equal(reached.length, 1);
      assert.deepEqual([reached[0].data.nodeId, reached[0].data.stageId, reached[0].data.team], ['forest', 'camp', 'shared']);
      assert.equal(events.filter((e) => e.type === 'roadmap_updated').length, 1);

      assert.equal(win(w, L, 'shared', 'forest').reachedNodeId, 'bridge');
      assert.equal(win(w, L, 'shared', 'bridge').reachedNodeId, 'fortress');
      road = await roadOf(L);
      assert.equal(road.positionNodeId, 'fortress');
      assert.equal(road.points, 3);
      assert.deepEqual(road.nodes.map((n) => n.status), ['completed', 'completed', 'completed', 'current']);
      assert.deepEqual(road.next, { nodeId: 'fortress', title: 'Крепость экзамена', pointsNeeded: 1, stageId: 'fortress' });
      assert.equal(road.segment, null);
      assert.equal(road.completed, false);

      assert.deepEqual(win(w, L, 'shared', 'fortress'), { reachedNodeId: null, completed: true, finished: true });
      road = await roadOf(L);
      assert.equal(road.completed, true);
      assert.equal(road.finished, true);
      assert.equal(road.points, 4);
      assert.equal(road.winner, 'shared');
      assert.equal(road.next, null);
      assert.equal(road.segment, null);
      assert.deepEqual(road.nodes.map((n) => n.status), ['completed', 'completed', 'completed', 'completed']);
      const tx = await ledger(L.host);
      assert.equal(tx.filter((t) => t.kind === 'team_node').length, 3, 'лес, мост, крепость');
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
      assert.ok((await L.host.progress()).achievements.find((a) => a.id === 'team_victory').unlocked);
      const done = events.filter((e) => e.type === 'challenge_completed');
      assert.equal(done.length, 1);
      assert.equal(done[0].data.draw, false);
      assert.equal(events.filter((e) => e.type === 'roadmap_updated').length, 4, 'roadmap_updated — на каждую победу');
    } finally { await w.close(); }
  });

  test('идемпотентность: повторные победы на пройденных этапах и закрытые этапы ничего не дают', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      const events = [];
      w.app.db.sink = (evs) => events.push(...evs);
      assert.equal(win(w, L, 'shared', 'bridge').reachedNodeId, null, 'этап закрытого узла не засчитывается');
      assert.equal(win(w, L, 'shared', 'nope').reachedNodeId, null, 'неизвестный этап игнорируется');
      assert.equal((await roadOf(L)).positionNodeId, 'camp');

      win(w, L, 'shared', 'camp');
      for (let i = 0; i < 3; i++) assert.deepEqual(win(w, L, 'shared', 'camp'), { reachedNodeId: null, completed: false, finished: false });
      win(w, L, 'shared', 'forest');
      assert.equal(win(w, L, 'shared', 'camp').reachedNodeId, null, 'реплей старого этапа узлов не даёт');
      win(w, L, 'shared', 'bridge');
      win(w, L, 'shared', 'fortress');
      assert.deepEqual(win(w, L, 'shared', 'fortress'), { reachedNodeId: null, completed: false, finished: false });
      for (let i = 0; i < 3; i++) w.app.tick();

      const tx = await ledger(L.host);
      assert.equal(tx.filter((t) => t.kind === 'team_node').length, 3);
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
      assert.equal(events.filter((e) => e.type === 'node_reached').length, 3);
      assert.equal(events.filter((e) => e.type === 'challenge_completed').length, 1);
      assert.equal((await roadOf(L)).points, 4, 'прогресс не идёт дальше цели');
    } finally { await w.close(); }
  });

  test('клиент не может продвинуть карту: нет маршрутов и поддельные поля игнорируются', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      for (const [m, p] of [['POST', '/roadmap'], ['PATCH', '/roadmap'], ['POST', '/roadmap/advance'], ['POST', '/progress']]) {
        const r = await w.call(m, L.path(p), { points: 99, nodeId: 'fortress' }, L.host.token);
        assert.ok([404, 405].includes(r.status), `${m} ${p} → ${r.status}`);
      }
      await L.host.post(L.path('/start'), { points: 99, positionNodeId: 'fortress', treasuryCoins: 9999 });
      assert.equal((await roadOf(L)).points, 0);
      assert.equal((await roadOf(L)).positionNodeId, 'camp');
      assert.equal((await roadOf(L)).treasuryCoins, 30);
    } finally { await w.close(); }
  });

  test('сохранение: пройденные узлы, вклад, казна и позиция переживают перезапуск и не награждаются повторно', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await runFocus(w, L);
    win(w, L, 'shared', 'camp');
    const tokens = L.users.map((u) => u.token);
    const before = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    const xp = (await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body.xp;
    await w.close();

    w = await boot({ dbPath, clock });
    const after = (await w.call('GET', L.path('/roadmap'), undefined, tokens[1])).body;
    assert.deepEqual(after, before);
    assert.equal(after.positionNodeId, 'forest');
    assert.equal(after.treasuryCoins, 30 + 2 * 20);
    assert.ok(after.nodes[1].reachedAt > 0);
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body.xp, xp);
    await w.close();
  });
});

describe('Road Map: узел открывают и N завершённых фокусов команды (2 × участники)', () => {
  test('двое, два цикла — узел открыт фокусами без игры; одного цикла мало; награда за узел обоим', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      const events = [];
      w.app.db.sink = (evs) => events.push(...evs);
      await runFocus(w, L);
      let road = await roadOf(L);
      assert.deepEqual(road.focusToNext, { done: 2, need: 4 }, 'после первого цикла: 2 из 4');
      assert.equal(road.points, 0, 'одного цикла мало');
      await runBreak(w, L);
      await runFocus(w, L);
      road = await roadOf(L);
      assert.equal(road.positionNodeId, 'forest', 'узел открыт фокусами');
      assert.equal(road.points, 1);
      assert.deepEqual(road.focusToNext, { done: 0, need: 4 }, 'к следующему узлу — заново');
      const reached = events.filter((e) => e.type === 'node_reached');
      assert.deepEqual(reached.map((e) => [e.data.nodeId, e.data.via]), [['forest', 'focus']]);
      for (const u of L.users) assert.equal((await ledger(u)).filter((t) => t.kind === 'team_node').length, 1, `${u.name}: награда за узел`);
    } finally { await w.close(); }
  });

  test('победа в игре открывает узел и обнуляет счёт фокусов', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await runFocus(w, L);
      assert.deepEqual((await roadOf(L)).focusToNext, { done: 2, need: 4 });
      assert.equal(win(w, L, 'shared', 'camp').reachedNodeId, 'forest');
      const road = await roadOf(L);
      assert.equal(road.positionNodeId, 'forest');
      assert.deepEqual(road.focusToNext, { done: 0, need: 4 });
    } finally { await w.close(); }
  });

  test('пропущенный хостом фокус и досрочный выход фокусами не считаются', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await L.host.post(L.path('/start'));
      await w.advance(60_000, L.users);
      await L.rest[0].post(L.path('/session/abort')); // Аня сдалась
      await w.advance(25 * 60_000, L.users);
      assert.deepEqual((await roadOf(L)).focusToNext, { done: 1, need: 4 }, 'засчитан только досидевший');
      await runBreak(w, L);
      await w.advance(10 * 60_000, L.users); // следующий фокус стартовал сам
      assert.equal((await L.host.post(L.path('/skip-focus'))).body.room.phase, 'break');
      assert.deepEqual((await roadOf(L)).focusToNext, { done: 1, need: 4 }, 'пропуск хостом не двигает цель');
    } finally { await w.close(); }
  });
});
