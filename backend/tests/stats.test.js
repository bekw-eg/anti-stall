import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

describe('статистика занятий', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('личная статистика: завершённые сессии, время концентрации, прерванные, по дням, уровень, достижения', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const [lotti, anya] = L.users;
    const empty = (await lotti.get('/api/users/me/stats')).body;
    assert.equal(empty.sessions.completed, 0);
    assert.equal(empty.sessions.focusSeconds, 0);
    assert.equal(empty.daily.length, 7);

    await runFocus(w, L, L.users); // обе сессии по 25 минут
    await w.advance(5 * 60_000 + 1000, L.users); // перерыв → ожидание
    // вторая сессия: Аня прерывает досрочно — время концентрации ей не засчитывается
    await lotti.post(L.path('/start'));
    await w.advance(60_000, L.users);
    assert.equal((await anya.post(L.path('/session/abort'))).status, 200);
    await w.advance(24 * 60_000 + 1000, [lotti]);

    const s = (await lotti.get('/api/users/me/stats')).body;
    assert.equal(s.sessions.completed, 2);
    assert.equal(s.sessions.rewarded, 2);
    assert.equal(s.sessions.focusSeconds, 2 * 25 * 60);
    assert.equal(s.sessions.averageSeconds, 25 * 60);
    assert.equal(s.sessions.todayFocusSeconds, 2 * 25 * 60);
    assert.equal(s.daily[6].sessions, 2);
    assert.ok(s.level >= 2 && s.xp > 0, 'уровень и XP из реальных наград');
    assert.ok(s.achievements.unlocked >= 1 && s.achievements.total >= s.achievements.unlocked);

    const a = (await anya.get('/api/users/me/stats')).body;
    assert.equal(a.sessions.completed, 1);
    assert.equal(a.sessions.interrupted, 1);
    assert.equal(a.sessions.focusSeconds, 25 * 60, 'прерванная сессия не добавляет времени');
    const p = await anya.progress();
    assert.equal(p.stats.focusSeconds, 25 * 60);
    assert.equal(p.stats.interruptedSessions, 1);
  });

  test('сутки режутся по часовому поясу клиента; неверный tz отклоняется', async () => {
    const L = await lobby(w, ['Ира']);
    await runFocus(w, L, L.users); // часы теста: 10:00 UTC + смещения прошлых тестов
    const utc = (await L.host.get('/api/users/me/stats')).body;
    const far = (await L.host.get('/api/users/me/stats?tz=-720')).body; // UTC−12: «вчера» относительно UTC
    assert.equal(utc.daily[6].focusSeconds, 25 * 60);
    assert.equal(utc.daily.reduce((x, d) => x + d.focusSeconds, 0), far.daily.reduce((x, d) => x + d.focusSeconds, 0));
    assert.notEqual(utc.daily[6].dayStart, far.daily[6].dayStart);
    assert.equal((await L.host.get('/api/users/me/stats?tz=abc')).status, 400);
    assert.equal((await L.host.get('/api/users/me/stats?tz=9999')).status, 400);
  });

  test('командный прогресс комнаты: очки команд и вклад каждого участника; только для участников', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true });
    const outsider = await w.user('Чужой');
    const room = (await L.host.get(L.path())).body;
    const teamOf = new Map(room.members.map((m) => [m.userId, m.team]));
    await runFocus(w, L, L.users);

    const st = await L.host.get(L.path('/stats'));
    assert.equal(st.status, 200);
    assert.equal(st.body.mode, 'teams');
    assert.deepEqual(st.body.teams.map((t) => t.key), ['A', 'B']);
    assert.equal(st.body.totals.completedSessions, 3);
    assert.equal(st.body.totals.focusSeconds, 3 * 25 * 60);
    for (const t of st.body.teams) {
      assert.ok(t.members.every((m) => teamOf.get(m.userId) === t.key), 'участник посчитан в своей команде');
      assert.equal(t.points, t.members.reduce((a, m) => a + m.points, 0));
      assert.equal(t.completedSessions, t.members.length);
    }
    assert.equal((await outsider.get(L.path('/stats'))).status, 403);
  });
});
