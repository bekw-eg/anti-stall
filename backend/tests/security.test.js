import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

/**
 * Те же атаки, что выполняет scripts/cheat-check.mjs против живого демо-сервера,
 * но детерминированно: createApp + FakeClock. Параллельные запросы — настоящие HTTP-запросы к слушающему серверу.
 */
const demoRoom = (extra = {}) => ({ demo: true, focusSeconds: 25, breakSeconds: 120, focusMinutes: undefined, breakMinutes: undefined, ...extra });
const txOf = async (u, kind) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === kind);
let rid = 0;
const reqId = () => `sec-req-${String(++rid).padStart(6, '0')}`;

describe('защита от читов (как в cheat-check)', () => {
  let w;
  let A; // демо-комната A: хост + 3 гостя
  let B; // демо-комната B: один игрок (покупатель)
  let normal; // обычный аккаунт на демо-сервере
  let H, G1, G2, G3, P;
  let startA;
  let startB;

  before(async () => {
    w = await boot({ env: { TOMATO_DEMO: '1' } });
    A = await lobby(w, ['Хост', 'Гость-1', 'Гость-2', 'Гость-3'], demoRoom({ name: 'A' }));
    [H, G1, G2, G3] = A.users;
    B = await lobby(w, ['Покупатель'], demoRoom({ name: 'B' }));
    [P] = B.users;
    normal = await w.user('Обычный');
    await H.post(A.path('/task'), { title: 'Секретная задача A' });
    await G3.patch('/api/users/me', { prankEnabled: false });
    await G3.post('/api/rooms/join', { code: B.room.code }); // Гость-3 состоит и в B
  });
  after(() => w.close());

  test('изоляция песочницы: обычный аккаунт не входит в демо-комнату и не создаёт её; песочный — не в обычную', async () => {
    let r = await normal.post('/api/rooms/join', { code: A.room.code });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'DEMO_SANDBOX_ONLY');
    r = await normal.post('/api/rooms', demoRoom());
    assert.equal(r.body.error.code, 'DEMO_SANDBOX_ONLY');
    const nRoom = (await normal.post('/api/rooms', { name: 'Обычная' })).body.room;
    assert.equal((await H.post('/api/rooms/join', { code: nRoom.code })).body.error.code, 'SANDBOX_DEMO_ONLY');
    assert.equal((await H.post('/api/rooms', { name: 'Обычная' })).body.error.code, 'SANDBOX_DEMO_ONLY');
  });

  test('несанкционированные действия до старта: без токена, чужой токен, не-хост, не-участник, запрещённые WS-события', async () => {
    assert.equal((await w.call('POST', A.path('/start'))).status, 401);
    assert.equal((await w.call('GET', '/api/users/me', undefined, 'x'.repeat(43))).status, 401);
    assert.equal((await w.call('POST', A.path('/start'), {}, H.token + 'x')).status, 401);
    assert.equal((await G1.post(A.path('/start'), { userId: H.id, hostId: G1.id })).body.error.code, 'NOT_HOST');
    assert.equal((await G1.post(A.path('/close'))).body.error.code, 'NOT_HOST');
    assert.equal((await G1.patch(A.path('/settings'), { focusSeconds: 5 })).body.error.code, 'NOT_HOST');
    // P не участник A
    assert.equal((await P.get(A.path())).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await P.post(A.path('/task'), { title: 'x' })).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await P.post(A.path('/session/abort'))).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await P.post(A.path('/social/help'), { targetUserId: H.id, type: 'boost' })).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await P.post(A.path('/td/build'), { slotId: 's1', type: 'arrow', requestId: reqId() })).body.error.code, 'NOT_A_MEMBER');
    const c = w.ws(P.token);
    await c.connect();
    c.send({ type: 'give_me_coins', amount: 1000, reqId: 1 });
    assert.equal((await c.wait((m) => m.reqId === 1)).data.code, 'UNKNOWN_EVENT');
    c.send({ type: 'complete_session', reqId: 2 });
    assert.equal((await c.wait((m) => m.reqId === 2)).data.code, 'UNKNOWN_EVENT');
    c.send({ type: 'subscribe', roomId: A.room.id, reqId: 3 });
    assert.equal((await c.wait((m) => m.reqId === 3)).data.code, 'NOT_A_MEMBER');
    c.close();
    assert.equal((await P.progress()).coins, 0);
  });

  test('подмена клиентских данных при регистрации и в профиле игнорируется', async () => {
    const reg = await w.call('POST', '/api/users', { name: 'Хакер', sandbox: true, xp: 99999, coins: 99999, level: 50, id: H.id });
    assert.equal(reg.status, 201);
    assert.notEqual(reg.body.user.id, H.id);
    assert.equal(reg.body.user.xp, 0);
    assert.equal(reg.body.user.coins, 0);
    const p = await G1.patch('/api/users/me', { xp: 99999, coins: 99999, level: 50, sandbox: false });
    assert.equal(p.body.xp, 0);
    assert.equal(p.body.coins, 0);
    assert.equal(p.body.level, 1);
    assert.equal(p.body.sandbox, true, 'песочность профилем не снимается');
  });

  test('во время фокуса: подмена длительности, мульти-сессия, пакость и покупка в фокусе, досрочный выход', async () => {
    startA = await H.post(A.path('/start'), { focusSec: 1, endsAt: 0, durationSec: 9999, now: 0, userId: G1.id });
    assert.equal(startA.status, 200);
    assert.equal(startA.body.room.phaseEndsAt - startA.body.room.phaseStartedAt, 25_000, 'длительность — из комнаты');
    // Гость-3 занят в A → в B пропускается
    startB = await P.post(B.path('/start'));
    assert.deepEqual(startB.body.start.skipped, [{ userId: G3.id, reason: 'busy_elsewhere' }]);
    // хост A сам пытается начать вторую сессию
    const C = (await H.post('/api/rooms', demoRoom({ name: 'C' }))).body.room;
    const r = await H.post(`/api/rooms/${C.id}/start`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'ALREADY_FOCUSING');
    assert.equal((await H.post(`/api/rooms/${C.id}/leave`)).status, 200);
    // пакость и покупка во время фокуса
    assert.equal((await H.post(A.path('/social/prank'), { targetUserId: G1.id, type: 'fog' })).body.error.code, 'WRONG_PHASE');
    assert.equal((await H.post('/api/users/me/upgrades/base_walls/purchase', {})).body.error.code, 'FOCUS_ACTIVE');
    // досрочный выход: abort и уход из комнаты
    await w.advance(5_000, A.users.concat(B.users));
    assert.equal((await G1.post(A.path('/session/abort'))).body.status, 'aborted');
    assert.equal((await G2.post(A.path('/leave'))).status, 200);
    await w.advance(21_000, [H, G1, G2, G3, P]);
    assert.equal((await H.get(A.path())).body.room.phase, 'break');
  });

  test('награда без завершённой сессии не выдаётся; завершить сессию с клиента нельзя', async () => {
    assert.ok((await H.progress()).xp >= 100, 'завершивший получил награду');
    for (const g of [G1, G2]) {
      assert.equal((await g.progress()).xp, 0);
      assert.equal((await g.progress()).coins, 0);
      const s = (await g.get('/api/users/me/sessions')).body.sessions[0];
      assert.equal(s.status, 'aborted');
      assert.equal(s.rewarded, false);
    }
    assert.equal((await G2.get('/api/users/me/sessions')).body.sessions[0].endReason, 'left_room');
    for (const p of ['/complete', '/session/complete', '/reward', '/claim']) assert.equal((await G1.post(A.path(p), { xp: 100 })).status, 404);
    assert.equal((await G1.post('/api/users/me/reward', { xp: 100 })).status, 404);
    assert.equal((await G1.progress()).xp, 0);
  });

  test('повторный запрос результата сессии и подмена xp в нём ничего не начисляют', async () => {
    const before = await G3.progress();
    for (let i = 0; i < 3; i++) assert.equal((await G3.post(A.path('/session/result'), { result: 'done', xp: 1000, coins: 1000, rewarded: true })).status, 200);
    const after = await G3.progress();
    assert.equal(after.xp, before.xp);
    assert.equal(after.coins, before.coins);
    assert.equal((await txOf(G3, 'focus_session')).length, 1);
  });

  test('пакость игроку с отключёнными пакостями отклоняется (кейс §5.5)', async () => {
    const r = await H.post(A.path('/social/prank'), { targetUserId: G3.id, type: 'fog' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'PRANKS_DISABLED');
  });

  test('повтор requestId постройки (последовательно и параллельно) списывает монеты один раз; цена — из каталога', async () => {
    // башни оплачивает казна команды (Tower Wars), личные монеты не трогаются
    const treasury = async () => (await H.get(A.path('/td'))).body.treasuryCoins;
    const c0 = await treasury();
    const personal = (await H.progress()).coins;
    const id = reqId();
    const first = await H.post(A.path('/td/build'), { slotId: 's1', type: 'arrow', requestId: id, cost: 0, price: 0 });
    assert.equal(first.status, 201);
    assert.equal(first.body.cost, 15);
    const again = await H.post(A.path('/td/build'), { slotId: 's1', type: 'arrow', requestId: id });
    assert.equal(again.body.replayed, true);
    const par = await Promise.all(Array.from({ length: 5 }, () => H.post(A.path('/td/build'), { slotId: 's1', type: 'arrow', requestId: id })));
    assert.ok(par.every((x) => x.body.replayed === true));
    assert.equal(await treasury(), c0 - 15);
    assert.equal((await H.progress()).coins, personal);
    assert.equal(w.app.db.get("SELECT COUNT(*) c FROM td_actions WHERE user_id = ? AND kind = 'build'", H.id).c, 1);
  });

  test('повтор покупки улучшения с тем же expectedLevel не списывает дважды; подменённая цена игнорируется', async () => {
    const c0 = (await H.progress()).coins;
    const r = await H.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0, price: -1000, cost: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.cost, 30);
    const again = await H.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
    assert.equal(again.body.error.code, 'STALE_LEVEL');
    assert.equal((await H.progress()).coins, c0 - 30 + 15, '−30 за покупку, +15 за достижение «Прокачка»');
    assert.equal((await txOf(H, 'upgrade_purchase')).length, 1);
  });

  test('10 параллельных HTTP-покупок при деньгах на одну: успешна ровно одна, баланс не уходит в минус', async () => {
    const coins = (await P.progress()).coins;
    assert.equal(coins, 45, '20 за сессию + 10 «Первый фокус» + 15 «Командный игрок»');
    const results = await Promise.all(Array.from({ length: 10 }, () => P.post('/api/users/me/upgrades/base_walls/purchase', {})));
    assert.equal(results.filter((x) => x.status === 200).length, 1);
    assert.ok(results.filter((x) => x.status !== 200).every((x) => x.body.error.code === 'INSUFFICIENT_FUNDS'));
    const after = await P.progress();
    assert.ok(after.coins >= 0);
    assert.equal(after.coins, 45 - 30 + 15);
    assert.equal(after.upgrades.find((u) => u.id === 'base_walls').level, 1);
    assert.equal((await txOf(P, 'upgrade_purchase')).length, 1);
  });

  test('изоляция комнат: прогресс, башни, задачи и соц-действия A не видны и не влияют на B', async () => {
    const ra = (await H.get(A.path('/roadmap'))).body;
    const rb = (await P.get(B.path('/roadmap'))).body;
    assert.equal(ra.focusPoints, 2, 'в A наградили двоих');
    assert.equal(rb.focusPoints, 1, 'в B — только покупателя');
    assert.deepEqual(rb.contributions.map((c) => c.userId), [P.id]);
    assert.equal((await H.get(A.path('/td'))).body.towers.length, 1);
    assert.equal((await P.get(B.path('/td'))).body.towers.length, 0);
    const snapB = (await P.get(B.path())).body;
    assert.ok(!snapB.members.some((m) => m.task === 'Секретная задача A'));
    assert.equal((await P.get(B.path('/social'))).body.actions.length, 0);
    // действие в B не трогает A
    assert.equal((await P.post(B.path('/td/build'), { slotId: 's2', type: 'arrow', requestId: reqId() })).status, 201);
    assert.deepEqual((await H.get(A.path('/td'))).body.towers.map((t) => t.slot), ['s1']);
  });
});
