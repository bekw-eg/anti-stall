import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

/** Победа команды в этапе TD (так её фиксирует сервис Tower Defense). */
function win(w, L, team, stageId, users) {
  const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
  return w.app.db.tx(() => w.app.services.game.recordStageVictory(room, team, stageId, users.map((u) => u.id)));
}

describe('командное испытание и Road Map', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 9: сессии дают очки вклада и казну; карту двигают победы в TD; цель → командная награда один раз', async () => {
    const L = await lobby(w);
    const [lotti, anya, boris] = L.users;
    let road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.points, 0);
    assert.equal(road.goal, 4);
    assert.equal(road.completed, false);
    assert.equal(road.nodes[0].status, 'current');

    // цикл 1: Аня сдаётся → её вклада нет, но двое из трёх отфокусировались → команда делает шаг
    await lotti.post(L.path('/start'));
    await w.advance(60_000, L.users);
    await anya.post(L.path('/session/abort'));
    await w.advance(25 * 60_000, L.users);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.focusPoints, 2);
    assert.equal(road.treasuryCoins, 30 + 2 * 20, 'монеты за сессии — и в казну команды');
    assert.equal(road.points, 0, 'фокус-сессии карту не двигают');
    assert.equal(road.positionNodeId, 'camp');
    assert.equal(road.contributions.find((c) => c.name === 'Аня'), undefined);
    assert.equal(road.contributions.find((c) => c.name === 'Лотти').points, 1);

    // перерыв: команда выигрывает этап лагеря → «Лес знаний»
    win(w, L, 'shared', 'camp', [lotti, boris]);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.positionNodeId, 'forest');
    assert.equal(road.nodes.find((n) => n.id === 'forest').status, 'current');
    assert.equal(road.nodes.find((n) => n.id === 'bridge').status, 'next');
    assert.equal(road.nodes.find((n) => n.id === 'fortress').status, 'locked');

    // цикл 2: все трое; дальше — мост, крепость и штурм
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.focusPoints, 5);
    assert.equal(road.completed, false);
    win(w, L, 'shared', 'forest', L.users);
    win(w, L, 'shared', 'bridge', L.users);
    const res = win(w, L, 'shared', 'fortress', L.users);
    assert.equal(res.completed, true);
    road = (await lotti.get(L.path('/roadmap'))).body;
    assert.equal(road.completed, true);
    assert.equal(road.positionNodeId, 'fortress');

    // награда: каждый участник победного штурма получил её ровно один раз
    for (const u of L.users) {
      const tx = (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1, u.name);
      assert.ok((await u.progress()).achievements.find((a) => a.id === 'team_victory').unlocked);
    }
    // дальнейшие сессии и повторные победы не выдают награду повторно
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L);
    win(w, L, 'shared', 'fortress', L.users);
    for (const u of L.users) {
      const tx = (await u.get('/api/users/me/transactions?limit=200')).body.transactions;
      assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
    }
  });

  test('командный прогресс независим между комнатами', async () => {
    const A = await lobby(w, ['A1']);
    const B = await lobby(w, ['B1']);
    await runFocus(w, A);
    win(w, A, 'shared', 'camp', A.users);
    const ra = (await A.host.get(A.path('/roadmap'))).body;
    const rb = (await B.host.get(B.path('/roadmap'))).body;
    assert.deepEqual([ra.points, ra.focusPoints, ra.treasuryCoins], [1, 1, 50]);
    assert.deepEqual([rb.points, rb.focusPoints, rb.treasuryCoins], [0, 0, 30]);
  });
});
