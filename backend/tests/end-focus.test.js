import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

describe('создатель заканчивает фокус досрочно', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('сразу начинается перерыв у всех, награда — по доле отработанного времени', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await L.host.post(L.path('/start'));
    await w.advance(5 * 60_000, L.users); // 5 из 25 минут

    const r = await L.host.post(L.path('/end-focus'));
    assert.equal(r.status, 200);
    assert.equal(r.body.room.phase, 'break');
    const guest = (await L.rest[0].get(L.path())).body;
    assert.equal(guest.room.phase, 'break');
    assert.equal(guest.me.allowedActions.includes('end_focus'), false);
    assert.equal(guest.me.allowedActions.includes('prank'), true, 'на перерыве открыта игра');

    // полный цикл даёт 100 XP; 5 минут из 25 — пятая часть
    const tx = (await L.rest[0].get('/api/users/me/transactions')).body.transactions.find((x) => x.kind === 'focus_session');
    assert.equal(tx.xp, 20);
    assert.equal(tx.coins, 4);
  });

  test('только создатель и только во время фокуса', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    assert.equal((await L.host.post(L.path('/end-focus'))).body.error.code, 'WRONG_PHASE');
    await L.host.post(L.path('/start'));
    assert.equal((await L.rest[0].post(L.path('/end-focus'))).body.error.code, 'NOT_HOST');
    const host = (await L.host.get(L.path())).body;
    assert.ok(host.me.allowedActions.includes('end_focus'));
  });
});
