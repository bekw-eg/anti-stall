import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const roadOf = async (L, u = L.host) => (await u.get(L.path('/roadmap'))).body;

/** Победа команды в этапе TD — так её фиксирует сервис Tower Defense (сервер, не клиент). */
function win(w, L, team, stageId, users = L.users) {
  const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
  return w.app.db.tx(() => w.app.services.game.recordStageVictory(room, team, stageId, users.map((u) => u.id)));
}

describe('Road Map: узлы открывают победы в Tower Defense', () => {
  test('сервер отдаёт связанную карту: позиция, следующий этап TD, доля пути, команды, казна', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      let road = await roadOf(L);
      assert.equal(road.positionNodeId, 'camp');
      assert.equal(road.goal, 4);
      assert.equal(road.points, 0);
      assert.equal(road.focusPoints, 0);
      assert.equal(road.treasuryCoins, 30, 'стартовый капитал казны');
      assert.deepEqual(road.next, { nodeId: 'forest', title: 'Лес знаний', pointsNeeded: 1, stageId: 'camp' });
      assert.deepEqual(road.segment, { from: 'camp', to: 'forest', progress: 0 });
      assert.equal(road.edges.length, 3);
      assert.deepEqual(road.teams.map((t) => [t.key, t.points, t.treasuryCoins]), [['shared', 0, 30]]);
      assert.deepEqual(road.nodes.map((n) => n.requiredPoints), [0, 1, 2, 3]);
      assert.equal(road.nodes[0].challenge, null);
      assert.deepEqual(road.nodes.slice(1).map((n) => [n.challenge.kind, n.challenge.stageId]),
        [['td_stage_win', 'camp'], ['td_stage_win', 'forest'], ['td_stage_win', 'bridge']]);
      assert.equal(road.nodes[1].reward.coins, 10);
      assert.equal(road.nodes[3].reward.xp, 150, 'за финальный узел — командная награда');

      // фокус-сессия: очки вклада и монеты в казну, но карта стоит на месте
      await runFocus(w, L);
      road = await roadOf(L);
      assert.equal(road.points, 0);
      assert.equal(road.focusPoints, 1);
      assert.equal(road.treasuryCoins, 30 + 20);
      assert.equal(road.positionNodeId, 'camp');
      assert.equal(road.nodes[1].reachedAt, null);
      assert.equal((await ledger(L.host)).filter((t) => t.kind === 'team_node').length, 0);
    } finally { await w.close(); }
  });

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

  test('награды за узел получают только участники победного раунда; все видят один прогресс', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
      const [lotti, anya, boris] = L.users;
      win(w, L, 'shared', 'camp', [lotti, anya]);
      const roads = await Promise.all(L.users.map((u) => roadOf(L, u)));
      assert.equal(new Set(roads.map((r) => JSON.stringify(r))).size, 1, 'у всех одинаковое состояние карты');
      assert.equal(roads[0].positionNodeId, 'forest');
      assert.equal((await ledger(lotti)).filter((t) => t.kind === 'team_node').length, 1);
      assert.equal((await ledger(anya)).filter((t) => t.kind === 'team_node').length, 1);
      assert.equal((await ledger(boris)).filter((t) => t.kind === 'team_node').length, 0);
      // Боря участвует в следующей победе: за уже пройденный «Лес» награды «задним числом» нет, за «Мост» — есть
      win(w, L, 'shared', 'forest', [boris]);
      const keys = (await ledger(boris)).filter((t) => t.kind === 'team_node').map((t) => t.key);
      assert.equal(keys.length, 1);
      assert.ok(keys[0].endsWith(':bridge'), keys[0]);
    } finally { await w.close(); }
  });

  test('WebSocket: node_reached и roadmap_updated приходят всей комнате', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      const c = w.ws(L.rest[0].token);
      await c.connect();
      c.send({ type: 'subscribe', roomId: L.room.id });
      await c.wait((m) => m.type === 'room_state');
      win(w, L, 'shared', 'camp');
      const reached = await c.wait((m) => m.type === 'node_reached');
      assert.equal(reached.data.nodeId, 'forest');
      assert.equal(reached.data.reward.coins, 10);
      const upd = await c.wait((m) => m.type === 'roadmap_updated');
      assert.equal(upd.data.positionNodeId, 'forest');
      c.close();
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
