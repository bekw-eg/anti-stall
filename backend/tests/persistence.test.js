import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

describe('перезапуск backend', () => {
  test('Тест 11: занятия, XP, ресурсы, достижения, улучшения и комнаты переживают рестарт', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await runFocus(w, L);
    await L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
    const before = {
      host: await L.host.progress(),
      guest: await L.rest[0].progress(),
      sessions: (await L.host.get('/api/users/me/sessions')).body.sessions,
      room: (await L.host.get(L.path())).body,
    };
    const tokens = L.users.map((u) => u.token);
    await w.close();

    // «перезапуск»: новое приложение, тот же файл БД, те же токены
    w = await boot({ dbPath, clock });
    const get = (t, p) => w.call('GET', p, undefined, t);
    const hostAfter = (await get(tokens[0], '/api/users/me/progress')).body;
    assert.equal(hostAfter.xp, before.host.xp);
    assert.equal(hostAfter.coins, before.host.coins);
    assert.deepEqual(hostAfter.achievements.filter((a) => a.unlocked).map((a) => a.id), before.host.achievements.filter((a) => a.unlocked).map((a) => a.id));
    assert.equal(hostAfter.upgrades.find((u) => u.id === 'base_walls').level, 1);
    assert.equal((await get(tokens[1], '/api/users/me/progress')).body.xp, before.guest.xp);
    assert.deepEqual((await get(tokens[0], '/api/users/me/sessions')).body.sessions, before.sessions);
    const room = (await get(tokens[0], `/api/rooms/${L.room.id}`)).body;
    assert.equal(room.room.phase, 'break');
    assert.equal(room.room.phaseEndsAt, before.room.room.phaseEndsAt);
    assert.equal(room.challenge.points, before.room.challenge.points);

    // повторное начисление после рестарта невозможно
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await get(tokens[0], '/api/users/me/progress')).body.xp, before.host.xp);
    await w.close();
  });

  test('рестарт посреди Focus: таймер продолжается по меткам времени, сессия засчитывается', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await lobby(w, ['Лотти', 'Аня']);
    await L.host.post(L.path('/start'));
    await w.advance(10 * 60_000, L.users);
    const tokens = L.users.map((u) => u.token);
    await w.close();

    clock.advance(20_000); // сервер был недоступен 20 с (< grace 30 с)
    w = await boot({ dbPath, clock });
    const alive = tokens.map((token) => ({ post: (p, b = {}) => w.call('POST', p, b, token) }));
    const room0 = (await w.call('GET', `/api/rooms/${L.room.id}`, undefined, tokens[0])).body.room;
    assert.equal(room0.phase, 'focus');
    assert.equal(room0.remainingMs, 15 * 60_000 - 20_000);
    await w.advance(15 * 60_000, alive);
    const p = (await w.call('GET', '/api/users/me/progress', undefined, tokens[0])).body;
    assert.equal(p.xp, 125); // 100 за сессию + 25 за этап карты «Лес знаний» (2 очка команды)
    assert.equal((await w.call('GET', '/api/users/me/progress', undefined, tokens[1])).body.xp, 125);
    await w.close();
  });
});
