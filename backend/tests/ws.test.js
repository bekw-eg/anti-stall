import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

describe('WebSocket', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  async function connected(user, roomId) {
    const c = w.ws(user.token);
    await c.connect();
    c.send({ type: 'subscribe', roomId });
    await c.wait((m) => m.type === 'room_state');
    return c;
  }

  test('события комнаты доходят подписчикам; чужая комната — нет', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const other = await lobby(w, ['Чужой']);
    const [a, b] = await Promise.all(L.users.map((u) => connected(u, L.room.id)));
    const spy = await connected(other.host, other.room.id);

    await L.host.post(L.path('/start'));
    for (const c of [a, b]) {
      const started = await c.wait((m) => m.type === 'timer_started');
      assert.equal(started.data.phase, 'focus');
      assert.equal(started.roomId, L.room.id);
      assert.equal((await c.wait((m) => m.type === 'room_state' && m.data.room.phase === 'focus')).data.room.phase, 'focus');
    }
    assert.equal(spy.of('timer_started').length, 0, 'события не просачиваются между комнатами');

    // timer_tick — сверка часов
    await w.advance(2000, L.users);
    const tick = await a.wait((m) => m.type === 'timer_tick');
    assert.equal(tick.data.phase, 'focus');
    assert.ok(tick.data.remainingMs > 0 && tick.data.remainingMs <= 25 * 60_000);

    await L.rest[0].post(L.path('/session/abort'));
    const st = await a.wait((m) => m.type === 'player_status_changed' && m.data.status === 'aborted');
    assert.equal(st.data.userId, L.rest[0].id);
    [a, b, spy].forEach((c) => c.close());
  });

  test('Тест 12: переподключение восстанавливает состояние и не дублирует награды', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    let a = await connected(L.host, L.room.id);
    await L.host.post(L.path('/start'));
    await w.advance(5 * 60_000, L.users);
    a.close(); // обрыв

    await w.advance(20 * 60_000 + 1000, L.users); // фаза Focus завершается, пока клиент оффлайн
    const xp = (await L.host.progress()).xp;
    assert.equal(xp, 100); // 100 за сессию (узлы карты — только за победы в TD)

    a = w.ws(L.host.token);
    await a.connect();
    a.send({ type: 'subscribe', roomId: L.room.id });
    const state = await a.wait((m) => m.type === 'room_state');
    assert.equal(state.data.room.phase, 'break');
    assert.equal(state.data.members.find((m) => m.userId === L.host.id).status, 'finished');
    assert.equal(a.of('reward_granted').length, 0, 'переподключение не выдаёт награду повторно');
    // подключение, повторные подписки и heartbeat ничего не начисляют
    for (let i = 0; i < 3; i++) a.send({ type: 'subscribe', roomId: L.room.id });
    a.send({ type: 'heartbeat' });
    await a.wait((m) => m.type === 'heartbeat_ack');
    assert.equal((await L.host.progress()).xp, xp);
    a.close();
  });

  test('игроку приходят reward_granted / session_completed / achievement_unlocked, ровно по разу', async () => {
    const L = await lobby(w, ['Лотти']);
    const c = await connected(L.host, L.room.id);
    await L.host.post(L.path('/start'));
    await w.advance(25 * 60_000 + 1000, L.users);
    await c.wait((m) => m.type === 'session_completed');
    const rewards = c.of('reward_granted');
    assert.equal(rewards.filter((r) => r.data.kind === 'focus_session').length, 1);
    assert.equal(rewards.find((r) => r.data.kind === 'focus_session').data.xp, 100);
    assert.equal(c.of('session_completed').length, 1);
    assert.ok(c.of('achievement_unlocked').some((m) => m.data.id === 'first_focus'));
    assert.ok(c.of('roadmap_updated').length >= 1);
    c.close();
  });

  test('Тест 14 (WS): клиентские «команды-награды» и чужие действия отклоняются', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const c = await connected(L.users[1], L.room.id);
    for (const type of ['give_me_coins', 'add_xp', 'complete_session', 'start_timer', 'purchase']) {
      c.send({ type, amount: 1_000_000, userId: L.host.id, roomId: L.room.id });
    }
    await w.advance(100);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(c.of('error').filter((e) => e.data.code === 'UNKNOWN_EVENT').length, 5);
    const p = await L.users[1].progress();
    assert.equal(p.xp, 0);
    assert.equal(p.coins, 0);
    assert.equal((await L.host.get(L.path())).body.room.phase, 'waiting');
    c.close();
  });

  test('авторизация WS и доступ к комнате', async () => {
    const L = await lobby(w, ['Лотти']);
    const stranger = await w.user('Чужой');
    const anon = w.ws('bad-token-bad-token-bad-token');
    await anon.opened;
    anon.send({ type: 'subscribe', roomId: L.room.id });
    assert.equal((await anon.wait((m) => m.type === 'error')).data.code, 'UNAUTHORIZED');
    anon.close();

    const c = w.ws(stranger.token);
    await c.connect();
    c.send({ type: 'subscribe', roomId: L.room.id, reqId: 7 });
    const err = await c.wait((m) => m.type === 'error');
    assert.equal(err.data.code, 'NOT_A_MEMBER');
    assert.equal(err.reqId, 7);
    c.close();
  });

  test('помощь и пакость приходят всей комнате (help_applied / prank_applied)', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const c = await connected(L.rest[0], L.room.id);
    await L.host.post(L.path('/start'));
    await w.advance(25 * 60_000 + 1000, L.users);
    await L.host.post(L.path('/social/help'), { targetUserId: L.rest[0].id, type: 'boost' });
    await L.host.post(L.path('/social/prank'), { targetUserId: L.rest[0].id, type: 'sticker' });
    assert.equal((await c.wait((m) => m.type === 'help_applied')).data.to, L.rest[0].id);
    assert.equal((await c.wait((m) => m.type === 'prank_applied')).data.type, 'sticker');
    c.close();
  });
});
