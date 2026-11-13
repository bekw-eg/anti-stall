import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

describe('синхронизированный Pomodoro', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 2: все видят одну фазу и согласованное оставшееся время; фазы идут по расписанию', async () => {
    const L = await lobby(w);
    const start = await L.host.post(L.path('/start'));
    assert.equal(start.status, 200);
    assert.equal(start.body.room.phase, 'focus');
    assert.deepEqual(start.body.start.participants.length, 3);

    await w.advance(10 * 60_000, L.users);
    const views = (await Promise.all(L.users.map((u) => u.get(L.path())))).map((r) => r.body.room);
    assert.equal(new Set(views.map((v) => v.phase)).size, 1);
    assert.equal(new Set(views.map((v) => v.phaseEndsAt)).size, 1);
    assert.equal(new Set(views.map((v) => v.remainingMs)).size, 1);
    assert.equal(views[0].remainingMs, 15 * 60_000);
    assert.equal(views[0].serverTime, w.clock.now());

    await w.advance(15 * 60_000 + 1000, L.users);
    let v = (await L.host.get(L.path())).body.room;
    assert.equal(v.phase, 'break');
    assert.equal(v.remainingMs, 5 * 60_000 - 1000);

    await w.advance(5 * 60_000, L.users);
    v = (await L.host.get(L.path())).body.room;
    assert.equal(v.phase, 'waiting');
    // «после Break можно начать следующий цикл»
    const next = await L.host.post(L.path('/start'));
    assert.equal(next.body.room.phase, 'focus');
    assert.equal(next.body.room.cycleNo, 2);
  });

  test('фаза определяется метками времени, даже если тик не вызывался (ленивое догоняние)', async () => {
    const L = await lobby(w, ['Хост']);
    await L.host.post(L.path('/start'));
    w.clock.advance(25 * 60_000 + 5000); // без app.tick()
    await L.host.post('/api/heartbeat');
    const v = (await L.host.get(L.path())).body;
    assert.equal(v.room.phase, 'break');
    assert.equal(v.members[0].status, 'finished');
  });

  test('только хост запускает; запуск не из waiting запрещён', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    assert.equal((await L.rest[0].post(L.path('/start'))).body.error.code, 'NOT_HOST');
    await L.host.post(L.path('/start'));
    assert.equal((await L.host.post(L.path('/start'))).body.error.code, 'WRONG_PHASE');
  });

  test('Тест 3: досрочный выход одного не останавливает комнату и не даёт награду', async () => {
    const L = await lobby(w);
    const [lotti, anya, boris] = L.users;
    await lotti.post(L.path('/start'));
    await w.advance(5 * 60_000, L.users);

    const abort = await anya.post(L.path('/session/abort'));
    assert.equal(abort.body.status, 'aborted');
    assert.equal(abort.body.rewarded, false);
    let view = (await lotti.get(L.path())).body;
    assert.equal(view.room.phase, 'focus'); // остальные продолжают
    assert.equal(view.members.find((m) => m.name === 'Аня').status, 'aborted');
    assert.equal(view.members.find((m) => m.name === 'Боря').status, 'focusing');

    await w.advance(20 * 60_000 + 1000, L.users);
    assert.equal((await anya.progress()).xp, 0);
    assert.equal((await anya.progress()).coins, 0);
    assert.equal((await boris.progress()).xp, 125); // 100 + 25 за этап карты (2 очка команды)
    assert.equal((await lotti.progress()).xp, 125);
    const sess = (await anya.get('/api/users/me/sessions')).body.sessions[0];
    assert.equal(sess.status, 'aborted');
    assert.equal(sess.rewarded, false);
    // повторная попытка прервать уже завершённую
    assert.equal((await anya.post(L.path('/session/abort'))).status, 409);
  });

  test('Тест 12 (REST): потеря связи дольше grace → сессия прервана; короткий обрыв допустим', async () => {
    const L = await lobby(w);
    const [lotti, anya, boris] = L.users;
    await lotti.post(L.path('/start'));
    // Аня пропадает на 20 с (< grace 30 с) и возвращается; Боря пропадает насовсем
    await w.advance(20_000, [lotti, boris]);
    await w.advance(5_000, [lotti, anya]);
    await w.advance(25 * 60_000, [lotti, anya]);
    assert.equal((await anya.progress()).xp, 125, 'короткий обрыв не лишает награды (100 + 25 за этап карты)');
    assert.equal((await boris.progress()).xp, 0, 'долгое отсутствие — награды нет');
    const s = (await boris.get('/api/users/me/sessions')).body.sessions[0];
    assert.equal(s.status, 'abandoned');
    assert.equal(s.endReason, 'disconnected');
  });

  test('Тест 15: на Focus игровые действия запрещены, на Break — доступны', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    const [host, guest] = L.users;
    await host.post(L.path('/start'));
    const target = { targetUserId: guest.id, type: 'boost' };
    assert.equal((await host.post(L.path('/social/help'), target)).body.error.code, 'WRONG_PHASE');
    assert.equal((await host.post(L.path('/social/prank'), { targetUserId: guest.id, type: 'fog' })).body.error.code, 'WRONG_PHASE');
    assert.equal((await host.post('/api/users/me/upgrades/base_walls/purchase', {})).body.error.code, 'FOCUS_ACTIVE');
    assert.equal((await host.post(L.path('/skip-break'))).body.error.code, 'WRONG_PHASE');
    const focusView = (await host.get(L.path())).body.me.allowedActions;
    assert.ok(focusView.includes('abort_session') && !focusView.includes('prank') && !focusView.includes('help'));

    await w.advance(25 * 60_000 + 1000, L.users);
    const breakView = (await host.get(L.path())).body.me.allowedActions;
    assert.ok(breakView.includes('prank') && breakView.includes('help') && !breakView.includes('abort_session'));
    assert.equal((await host.post(L.path('/social/help'), target)).status, 201);
  });

  test('участник, вошедший посреди Focus, наблюдает без награды', async () => {
    const L = await lobby(w, ['Хост']);
    await L.host.post(L.path('/start'));
    const late = await w.user('Опоздавший');
    await late.post('/api/rooms/join', { code: L.room.code });
    await w.advance(25 * 60_000 + 1000, [L.host, late]);
    assert.equal((await late.progress()).xp, 0);
    assert.equal((await L.host.progress()).xp, 100);
  });
});
