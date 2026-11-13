import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

const ledger = async (u) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
const roadOf = async (L, u = L.host) => (await u.get(L.path('/roadmap'))).body;

describe('Road Map: этапы, награды, синхронизация', () => {
  test('сервер отдаёт связанную карту: позиция, следующий этап, доля пути, команды', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      let road = await roadOf(L);
      assert.equal(road.positionNodeId, 'camp');
      assert.deepEqual(road.next, { nodeId: 'forest', title: 'Лес знаний', pointsNeeded: 2 });
      assert.deepEqual(road.segment, { from: 'camp', to: 'forest', progress: 0 });
      assert.equal(road.edges.length, 3);
      assert.deepEqual(road.teams.map((t) => t.key), ['shared']);
      assert.equal(road.nodes[1].reward.coins, 10);
      assert.equal(road.nodes[3].reward.xp, 150, 'за финальный узел — командная награда');

      await runFocus(w, L); // 1 очко из 2 до «Леса знаний»
      road = await roadOf(L);
      assert.equal(road.points, 1);
      assert.equal(road.segment.progress, 0.5);
      assert.equal(road.next.pointsNeeded, 1);
      assert.equal(road.nodes[1].reachedAt, null);
    } finally { await w.close(); }
  });

  test('этап засчитывается и награждается сервером ровно один раз; повторы и ещё сессии не дублируют', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      const events = [];
      w.app.db.sink = (evs) => events.push(...evs);
      await runFocus(w, L); await w.advance(5 * 60_000, L.users);
      assert.equal((await ledger(L.host)).filter((t) => t.kind === 'team_node').length, 0);
      const before = await L.host.progress();
      await runFocus(w, L); // 2-е очко → «Лес знаний»
      let road = await roadOf(L);
      assert.equal(road.positionNodeId, 'forest');
      assert.ok(road.nodes[1].reachedAt > 0, 'время прохождения этапа сохранено сервером');
      const nodeTx = (await ledger(L.host)).filter((t) => t.kind === 'team_node');
      assert.equal(nodeTx.length, 1);
      assert.deepEqual([nodeTx[0].xp, nodeTx[0].coins], [25, 10]);
      assert.equal((await L.host.progress()).xp - before.xp, 100 + 25);
      assert.equal(events.filter((e) => e.type === 'node_reached').length, 1);
      assert.equal(events.find((e) => e.type === 'node_reached').data.nodeId, 'forest');

      // повторные тики, запросы и перезаход ничего не меняют
      for (let i = 0; i < 5; i++) { w.app.tick(); await roadOf(L); }
      assert.equal((await ledger(L.host)).filter((t) => t.kind === 'team_node').length, 1);

      // следующий этап
      await w.advance(5 * 60_000, L.users); await runFocus(w, L); await w.advance(5 * 60_000, L.users); await runFocus(w, L);
      road = await roadOf(L);
      assert.equal(road.positionNodeId, 'bridge');
      assert.equal((await ledger(L.host)).filter((t) => t.kind === 'team_node').length, 2);
      assert.deepEqual(road.nodes.map((n) => n.status), ['completed', 'completed', 'current', 'next']);
    } finally { await w.close(); }
  });

  test('финальный узел выдаёт командную награду, а не «этапную»; прогресс не идёт дальше цели', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      for (let i = 0; i < 7; i++) { await runFocus(w, L); await w.advance(5 * 60_000, L.users); }
      const road = await roadOf(L);
      assert.equal(road.completed, true);
      assert.equal(road.next, null);
      assert.equal(road.segment, null);
      const tx = await ledger(L.host);
      assert.equal(tx.filter((t) => t.kind === 'team_node').length, 2, 'только промежуточные этапы');
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
    } finally { await w.close(); }
  });

  test('синхронизация: все участники видят один прогресс; награды получают только участники с вкладом', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
      const [lotti, anya, boris] = L.users;
      await lotti.post(L.path('/start'));
      await w.advance(60_000, L.users);
      await boris.post(L.path('/session/abort')); // Боря выходит — вклада нет
      await w.advance(25 * 60_000, L.users);
      const roads = await Promise.all(L.users.map((u) => roadOf(L, u)));
      assert.equal(new Set(roads.map((r) => JSON.stringify(r))).size, 1, 'у всех одинаковое состояние карты');
      assert.equal(roads[0].points, 2);
      assert.equal(roads[0].positionNodeId, 'forest');
      assert.equal((await ledger(lotti)).filter((t) => t.kind === 'team_node').length, 1);
      assert.equal((await ledger(anya)).filter((t) => t.kind === 'team_node').length, 1);
      assert.equal((await ledger(boris)).filter((t) => t.kind === 'team_node').length, 0);
      // Боря вносит вклад в следующем цикле: за уже пройденный «Лес» награды «задним числом» нет, за «Мост» — есть
      await w.advance(5 * 60_000, L.users); await runFocus(w, L);
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
      await runFocus(w, L);
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
        const r = await L.host.call?.(m, p) ?? await w.call(m, L.path(p), { points: 99, nodeId: 'fortress' }, L.host.token);
        assert.ok([404, 405].includes(r.status), `${m} ${p} → ${r.status}`);
      }
      await L.host.post(L.path('/start'), { points: 99, positionNodeId: 'fortress' });
      assert.equal((await roadOf(L)).points, 0);
      assert.equal((await roadOf(L)).positionNodeId, 'camp');
    } finally { await w.close(); }
  });

  test('сохранение: пройденные этапы, вклад и позиция переживают перезапуск и не награждаются повторно', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await runFocus(w, L); // 2 очка → «Лес знаний»
    const tokens = L.users.map((u) => u.token);
    const before = (await w.call('GET', L.path('/roadmap'), undefined, tokens[0])).body;
    const xp = (await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body.xp;
    await w.close();

    w = await boot({ dbPath, clock });
    const after = (await w.call('GET', L.path('/roadmap'), undefined, tokens[1])).body;
    assert.deepEqual(after, before);
    assert.equal(after.positionNodeId, 'forest');
    assert.ok(after.nodes[1].reachedAt > 0);
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body.xp, xp);
    await w.close();
  });
});
