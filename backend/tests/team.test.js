import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

describe('командное испытание и Road Map', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 9: завершённые сессии двигают общий прогресс; цель → командная награда один раз', async () => {
    const L = await lobby(w);
    const [lotti, anya, boris] = L.users;
    let road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.points, 0);
    assert.equal(road.goal, 6);
    assert.equal(road.completed, false);
    assert.equal(road.nodes[0].status, 'current');

    // цикл 1: Аня уходит досрочно → очко не засчитывается, вклад только у двоих
    await lotti.post(L.path('/start'));
    await w.advance(60_000, L.users);
    await anya.post(L.path('/session/abort'));
    await w.advance(25 * 60_000, L.users);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.points, 2);
    assert.equal(road.positionNodeId, 'forest');
    assert.equal(road.contributions.find((c) => c.name === 'Аня'), undefined);
    assert.equal(road.contributions.find((c) => c.name === 'Лотти').points, 1);
    assert.equal(road.nodes.find((n) => n.id === 'forest').status, 'current');
    assert.equal(road.nodes.find((n) => n.id === 'bridge').status, 'next');
    assert.equal(road.nodes.find((n) => n.id === 'fortress').status, 'locked');

    // цикл 2: все трое
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.points, 5);
    assert.equal(road.completed, false);

    // цикл 3: достигаем цели
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.completed, true);
    assert.equal(road.positionNodeId, 'fortress');

    // награда: все, у кого вклад > 0, получили её ровно один раз; Аня вкладывалась в циклах 2–3
    for (const u of L.users) {
      const tx = (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1, u.name);
      assert.ok((await u.progress()).achievements.find((a) => a.id === 'team_victory').unlocked);
    }
    // дальнейшие сессии не выдают награду повторно
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L);
    for (const u of L.users) {
      const tx = (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
    }
  });

  test('командный прогресс независим между комнатами', async () => {
    const A = await lobby(w, ['A1']);
    const B = await lobby(w, ['B1']);
    await runFocus(w, A);
    assert.equal((await A.host.get(A.path('/roadmap'))).body.points, 1);
    assert.equal((await B.host.get(B.path('/roadmap'))).body.points, 0);
  });
});
