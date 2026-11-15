import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

// Самооценка ★1–5 после фокуса и командный бонус в конце перерыва (этап 6.2).
// Фокус 25 мин = 100 XP / 20 монет; бонус = база × (средняя / 5) × 0.5.
const bonusTx = async (u) => (await u.get('/api/users/me/transactions')).body.transactions.filter((t) => t.kind === 'rating_bonus');
const lastSession = async (u) => (await u.get('/api/users/me/sessions')).body.sessions.find((s) => s.status === 'completed');

describe('оценка своей работы и командный бонус', () => {
  let w;
  // без узлов карты за фокусы: проверяем только бонус
  before(async () => { w = await boot({ config: { economy: { focusesPerStagePerMember: 100 } } }); });
  after(() => w.close());

  test('оценить можно один раз, только завершённый фокус и только целым 1–5', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await L.host.post(L.path('/start'));
    const during = await L.host.post(L.path('/session/rating'), { stars: 5 });
    assert.equal(during.body.error.code, 'SESSION_ACTIVE', 'пока фокус идёт — нельзя');
    await w.advance(25 * 60_000 + 1000, L.users);

    const snap = (await L.host.get(L.path())).body;
    assert.equal(snap.room.phase, 'break');
    assert.equal(snap.me.session.rating, null);
    assert.ok(snap.me.allowedActions.includes('rate_session'));

    for (const stars of [0, 6, 2.5, '5', null]) {
      assert.equal((await L.host.post(L.path('/session/rating'), { stars })).body.error.code, 'INVALID_FIELD', `stars=${stars}`);
    }
    const ok = await L.host.post(L.path('/session/rating'), { stars: 4 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.rating, 4);
    const again = await L.host.post(L.path('/session/rating'), { stars: 5 });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_RATED');

    const after = (await L.host.get(L.path())).body;
    assert.equal(after.me.session.rating, 4, 'оценка не перезаписана');
    assert.ok(!after.me.allowedActions.includes('rate_session'));
  });

  test('чужую сессию оценить нельзя, не участник — тоже', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await runFocus(w, L);
    const hostSession = (await L.host.get(L.path())).body.me.session.id;
    const r = await L.rest[0].post(L.path('/session/rating'), { stars: 1, sessionId: hostSession });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'NOT_YOUR_SESSION');
    const stranger = await w.user('Чужой');
    assert.equal((await stranger.post(L.path('/session/rating'), { stars: 5 })).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await L.host.get(L.path())).body.me.session.rating, null, 'оценка хоста не тронута');
  });

  test('бонус по средней оценке команды; не ответившие считаются как 3★', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await runFocus(w, L);
    assert.equal((await L.host.post(L.path('/session/rating'), { stars: 5 })).status, 200);
    // гость молчит → средняя (5 + 3) / 2 = 4 → бонус 100 × 0.8 × 0.5 = 40 XP, 20 × 0.4 = 8 монет
    assert.equal((await bonusTx(L.host)).length, 0, 'до конца перерыва бонуса нет');
    await runBreak(w, L);
    for (const u of L.users) {
      const tx = await bonusTx(u);
      assert.equal(tx.length, 1);
      assert.equal(tx[0].xp, 40);
      assert.equal(tx[0].coins, 8);
    }
    const h = (await L.host.get('/api/users/me/sessions')).body.sessions.find((s) => s.status === 'completed');
    assert.equal(h.rating, 5);
    assert.equal(h.bonusXp, 40);
    assert.equal(h.bonusCoins, 8);
    assert.equal((await lastSession(L.rest[0])).rating, null);

    // после старта следующего фокуса прошлый цикл не оценить; повторный подсчёт бонуса ничего не начисляет
    assert.equal((await L.host.get(L.path())).body.room.phase, 'focus');
    const late = await L.rest[0].post(L.path('/session/rating'), { stars: 5, sessionId: (await lastSession(L.rest[0])).id });
    assert.equal(late.body.error.code, 'RATING_CLOSED');
    const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
    const prevCycle = w.app.db.get("SELECT cycle_id FROM focus_sessions WHERE room_id = ? AND status = 'completed'", L.room.id).cycle_id;
    assert.deepEqual(w.app.db.tx(() => w.app.services.game.ratingBonus({ ...room, cycle_id: prevCycle })), []);
    assert.equal((await bonusTx(L.host)).length, 1, 'ключ rating:<cycle>:<user> не даёт начислить дважды');
  });

  test('все молчат — средняя 3★; пропуск перерыва хостом тоже даёт бонус', async () => {
    const L = await lobby(w, ['Хост']);
    await runFocus(w, L);
    assert.equal((await L.host.post(L.path('/skip-break'))).status, 200);
    const tx = await bonusTx(L.host);
    assert.equal(tx.length, 1);
    assert.equal(tx[0].xp, 30); // 100 × 3/5 × 0.5
    assert.equal(tx[0].coins, 6);
  });

  test('в командном режиме средняя считается по своей команде', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря', 'Вера'], { teamMode: true }); // A, B, A, B
    await runFocus(w, L);
    const [lotti, anya, borya, vera] = L.users;
    await lotti.post(L.path('/session/rating'), { stars: 5 });
    await borya.post(L.path('/session/rating'), { stars: 5 });
    await anya.post(L.path('/session/rating'), { stars: 1 });
    await vera.post(L.path('/session/rating'), { stars: 2 });
    await runBreak(w, L);
    assert.equal((await bonusTx(lotti))[0].xp, 50); // A: 5★ → 100 × 1 × 0.5
    assert.equal((await bonusTx(borya))[0].xp, 50);
    assert.equal((await bonusTx(anya))[0].xp, 15); // B: 1,5★ → 100 × 0.3 × 0.5
    assert.equal((await bonusTx(vera))[0].xp, 15);
  });

  test('суточный потолок прежний: сессия за потолком бонуса не получает, бонус не тратит потолок', async () => {
    const w2 = await boot({ config: { economy: { dailyRewardedSessions: 1, focusesPerStagePerMember: 100 } } });
    try {
      const L = await lobby(w2, ['Хост']);
      await runFocus(w2, L);
      await L.host.post(L.path('/session/rating'), { stars: 5 });
      await runBreak(w2, L);
      await runFocus(w2, L); // второй фокус плана — уже за потолком
      assert.equal((await L.host.post(L.path('/session/rating'), { stars: 5 })).status, 200);
      await runBreak(w2, L);
      const tx = await bonusTx(L.host);
      assert.equal(tx.length, 1, 'бонус только за награждённый фокус');
      assert.equal(tx[0].xp, 50);
      const sessions = (await L.host.get('/api/users/me/sessions')).body.sessions.filter((s) => s.status === 'completed');
      assert.deepEqual(sessions.map((s) => [s.rewarded, s.bonusXp]), [[false, 0], [true, 50]]);
      assert.equal((await L.host.progress()).xp, 150, '100 за фокус + 50 бонуса');
    } finally { await w2.close(); }
  });
});
