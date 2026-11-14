import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

describe('пользователи и комнаты', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 1: несколько пользователей видят друг друга и одинаковое состояние', async () => {
    const L = await lobby(w);
    const views = await Promise.all(L.users.map((u) => u.get(L.path())));
    for (const v of views) {
      assert.equal(v.status, 200);
      assert.deepEqual(v.body.members.map((m) => m.name).sort(), ['Аня', 'Боря', 'Лотти']);
      assert.equal(v.body.room.phase, 'waiting');
      assert.equal(v.body.room.id, L.room.id);
    }
    assert.equal(views[0].body.room.hostId, L.host.id);
    assert.equal(views[0].body.me.isHost, true);
    assert.equal(views[1].body.me.isHost, false);
  });

  test('вход по коду и по id, повторный вход идемпотентен', async () => {
    const L = await lobby(w, ['Хост']);
    const guest = await w.user('Гость');
    const a = await guest.post('/api/rooms/join', { code: L.room.code.toLowerCase() });
    assert.equal(a.status, 200);
    const b = await guest.post(L.path('/join'));
    assert.equal(b.status, 200);
    assert.equal(b.body.members.length, 2);
  });

  test('Тест 13: комнаты независимы', async () => {
    const A = await lobby(w, ['A1', 'A2']);
    const B = await lobby(w, ['B1', 'B2']);
    await A.host.post(A.path('/start'));
    await w.advance(60_000, [...A.users, ...B.users]);
    const a = (await A.host.get(A.path())).body;
    const b = (await B.host.get(B.path())).body;
    assert.equal(a.room.phase, 'focus');
    assert.equal(b.room.phase, 'waiting');
    assert.equal(b.members.length, 2);
    assert.ok(!b.members.some((m) => m.name.startsWith('A')));
    // чужая комната недоступна
    assert.equal((await B.host.get(A.path())).status, 403);
  });

  test('не-участник не получает состояние; неизвестная комната — 404', async () => {
    const L = await lobby(w, ['Хост']);
    const stranger = await w.user('Чужой');
    assert.equal((await stranger.get(L.path())).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await stranger.get('/api/rooms/nope')).body.error.code, 'ROOM_NOT_FOUND');
  });

  test('валидация и авторизация', async () => {
    assert.equal((await w.call('GET', '/api/users/me')).status, 401);
    assert.equal((await w.call('GET', '/api/users/me', undefined, 'x'.repeat(40))).status, 401);
    assert.equal((await w.call('POST', '/api/users', { name: '' })).body.error.code, 'INVALID_FIELD');
    const u = await w.user('Тест');
    assert.equal((await u.post('/api/rooms', { focusSeconds: 30 })).body.error.code, 'INVALID_FIELD'); // фокус от 1 минуты
    assert.equal((await u.post('/api/rooms', { focusMinutes: '25' })).status, 400);
    assert.equal((await u.post('/api/rooms', { demo: true })).body.error.code, 'DEMO_DISABLED');
  });

  test('личные задачи: видны участникам, фиксируются в сессии и истории', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await L.host.post(L.path('/task'), { title: 'Математика' });
    await L.rest[0].post(L.path('/task'), { title: 'Английский' });
    const view = (await L.rest[0].get(L.path())).body;
    assert.deepEqual(view.members.map((m) => m.task), ['Математика', 'Английский']);
    await L.host.post(L.path('/start'));
    assert.equal((await L.host.post(L.path('/task'), { title: 'Другое' })).body.error.code, 'SESSION_ACTIVE');
    await w.advance(25 * 60_000 + 1000, L.users);
    await L.host.post(L.path('/session/result'), { result: 'done', note: 'решил 10 задач' });
    const hist = (await L.host.get('/api/users/me/sessions')).body.sessions;
    assert.equal(hist[0].task, 'Математика');
    assert.equal(hist[0].result, 'done');
    assert.equal(hist[0].status, 'completed');
    assert.equal(hist[0].xp, 100);
  });

  test('выход: хост передаётся, пустая комната закрывается', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await L.host.post(L.path('/leave'));
    const v = (await L.rest[0].get(L.path())).body;
    assert.equal(v.room.hostId, L.rest[0].id);
    await L.rest[0].post(L.path('/leave'));
    const late = await w.user('Поздний');
    assert.equal((await late.post('/api/rooms/join', { code: L.room.code })).body.error.code, 'ROOM_CLOSED');
  });

  test('статус готовности (isReady): переключение, валидация и сброс при старте фокуса', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    assert.equal((await L.host.post(L.path('/ready'), { ready: 'yes' })).status, 400);

    const r1 = (await L.rest[0].post(L.path('/ready'), { ready: true })).body;
    assert.equal(r1.me.isReady, true);
    assert.deepEqual(r1.members.map((m) => m.isReady), [false, true]);

    await L.host.post(L.path('/start'));
    assert.equal((await L.rest[0].post(L.path('/ready'), { ready: false })).body.error.code, 'WRONG_PHASE');
    const duringFocus = (await L.rest[0].get(L.path())).body;
    assert.deepEqual(duringFocus.members.map((m) => m.isReady), [false, false]);
  });
});
