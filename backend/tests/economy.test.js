import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

describe('игровая экономика и защита от накрутки', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 4: после завершённой сессии сервер начисляет XP, монеты и повышает уровень', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await runFocus(w, L);
    const p = await L.host.progress();
    assert.equal(p.xp, 100, '100 за сессию (узлы карты дают только победы в Tower Defense)');
    assert.equal(p.level, 2, '100 XP = 2 уровень');
    const ledger = (await L.host.get('/api/users/me/transactions')).body.transactions;
    const focusTx = ledger.find((t) => t.kind === 'focus_session');
    assert.equal(focusTx.xp, 100);
    assert.equal(focusTx.coins, 20);
    assert.ok(p.achievements.find((a) => a.id === 'first_focus').unlocked);
    assert.ok(p.coins >= 20);
  });

  test('награда пропорциональна длительности сессии (нельзя фармить короткие)', async () => {
    const L = await lobby(w, ['Хост'], { focusMinutes: 10 });
    await runFocus(w, L, L.users, 10);
    const t = (await L.host.get('/api/users/me/transactions')).body.transactions.find((x) => x.kind === 'focus_session');
    assert.equal(t.xp, 40); // 10/25 = 0.4
    assert.equal(t.coins, 8);
  });

  test('Тест 5: повторное начисление за одну сессию невозможно', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await runFocus(w, L);
    const before = await L.host.progress();
    // повторные тики, обновления, переподключения, запросы результата
    for (let i = 0; i < 5; i++) { w.app.tick(); await L.host.get(L.path()); }
    await L.host.post(L.path('/session/result'), { result: 'done' });
    await L.host.post(L.path('/session/result'), { result: 'done' });
    // попытки «завершить» сессию с клиента: таких маршрутов нет
    for (const p of ['/session/complete', '/complete', '/reward', '/claim']) {
      assert.equal((await L.host.post(L.path(p), {})).status, 404);
    }
    assert.equal((await L.host.post('/api/users/me/reward', { xp: 100 })).status, 404);
    // и прямой повтор операции с тем же ключом в журнале ничего не меняет
    const sessionId = (await L.host.get('/api/users/me/sessions')).body.sessions[0].id;
    const g = w.app.db.tx(() => w.app.services.game.grant(L.host.id, `focus:${sessionId}`, 'focus_session', { xp: 100, coins: 20 }));
    assert.equal(g.granted, false);
    const after = await L.host.progress();
    assert.equal(after.xp, before.xp);
    assert.equal(after.coins, before.coins);
    const n = (await L.host.get('/api/users/me/transactions')).body.transactions.filter((t) => t.kind === 'focus_session').length;
    assert.equal(n, 1);
  });

  test('Тест 6: одновременно две фокус-сессии одного пользователя запрещены', async () => {
    const A = await lobby(w, ['Хост-А', 'Гость']);
    const guest = A.users[1];
    const roomB = (await guest.post('/api/rooms', { name: 'Вторая' })).body.room;
    await A.host.post(A.path('/start'));
    // гость уже занимается в A → не может запустить сессию в B
    const r = await guest.post(`/api/rooms/${roomB.id}/start`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'ALREADY_FOCUSING');
    // и если хост B заранее приглашает гостя из A, тот пропускается
    const owner = await w.user('Хост-Б');
    const rb = (await owner.post('/api/rooms', { name: 'Б' })).body.room;
    await guest.post('/api/rooms/join', { code: rb.code });
    const s = await owner.post(`/api/rooms/${rb.id}/start`);
    assert.deepEqual(s.body.start.skipped, [{ userId: guest.id, reason: 'busy_elsewhere' }]);
    // инвариант на уровне БД: вторую active-запись вставить нельзя
    assert.throws(() => w.app.db.run(
      `INSERT INTO focus_sessions(id, room_id, cycle_id, cycle_no, user_id, started_at, scheduled_end_at, duration_sec, status)
       VALUES ('x', ?, 'c', 1, ?, 0, 1, 1, 'active')`, rb.id, guest.id), /UNIQUE/);
  });

  test('Тест 6б: параллельный запуск в разных комнатах — активна ровно одна сессия', async () => {
    const u = await w.user('Параллельный');
    const rooms = [];
    for (let i = 0; i < 4; i++) rooms.push((await u.post('/api/rooms', { name: 'R' + i })).body.room);
    const results = await Promise.all(rooms.map((r) => u.post(`/api/rooms/${r.id}/start`)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.body.error?.code === 'ALREADY_FOCUSING').length, 3);
  });

  test('Тест 7: покупка без денег и без уровня отклоняется', async () => {
    const u = await w.user('Бедняк');
    let r = await u.post('/api/users/me/upgrades/base_walls/purchase', {});
    assert.equal(r.body.error.code, 'INSUFFICIENT_FUNDS');
    r = await u.post('/api/users/me/upgrades/tower_power/purchase', {});
    assert.ok(['UPGRADE_LOCKED', 'INSUFFICIENT_FUNDS'].includes(r.body.error.code));
    assert.equal((await u.post('/api/users/me/upgrades/nope/purchase', {})).status, 404);
    assert.equal((await u.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: -1 })).status, 400);
    assert.equal((await u.progress()).coins, 0);
  });

  test('покупка улучшения тратит монеты и повышает уровень улучшения', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await runFocus(w, L);
    const before = await L.host.progress();
    const r = await L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.cost, 30);
    const after = await L.host.progress();
    const spent = (await L.host.get('/api/users/me/transactions')).body.transactions.find((t) => t.kind === 'upgrade_purchase');
    assert.equal(spent.coins, -30);
    assert.equal(after.coins, before.coins - 30 + 15); // +15 за достижение «Прокачка»
    assert.equal(after.upgrades.find((x) => x.id === 'base_walls').level, 1);
    assert.ok(after.achievements.find((a) => a.id === 'first_upgrade').unlocked);
    // улучшение реально влияет на игровую модель (+25 HP базы)
    const game = (await L.host.get(L.path('/game'))).body;
    assert.equal(game.base.maxHp, 125);
  });

  test('Тест 8: параллельные покупки не уводят баланс в минус и не дублируются', async () => {
    const L = await lobby(w, ['Хост']);
    await runFocus(w, L); // 20 + 10 + 15 = 45 монет
    const coins = (await L.host.progress()).coins;
    assert.ok(coins >= 30 && coins < 90);
    // 8 одинаковых запросов с expectedLevel
    const a = await Promise.all(Array.from({ length: 8 }, () => L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 })));
    assert.equal(a.filter((r) => r.status === 200).length, 1);
    assert.ok(a.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'STALE_LEVEL'));
    // 8 запросов без expectedLevel: денег хватит максимум на одну
    const b = await Promise.all(Array.from({ length: 8 }, () => L.host.post('/api/users/me/upgrades/base_walls/purchase', {})));
    assert.ok(b.filter((r) => r.status === 200).length <= 1);
    const p = await L.host.progress();
    assert.ok(p.coins >= 0);
    const spent = (await L.host.get('/api/users/me/transactions')).body.transactions.filter((t) => t.kind === 'upgrade_purchase');
    assert.equal(spent.length, p.upgrades.find((x) => x.id === 'base_walls').level);
    assert.equal(new Set(spent.map((t) => t.key)).size, spent.length);
  });

  test('Тест 8б: параллельные join/start/abort не ломают инварианты', async () => {
    const L = await lobby(w, ['Хост']);
    const guests = await Promise.all(Array.from({ length: 5 }, (_, i) => w.user('Г' + i)));
    await Promise.all(guests.map((g) => g.post('/api/rooms/join', { code: L.room.code })));
    await Promise.all([L.host.post(L.path('/start')), L.host.post(L.path('/start')), L.host.post(L.path('/start'))]);
    const view = (await L.host.get(L.path())).body;
    assert.equal(view.members.length, 6);
    assert.equal(view.members.filter((m) => m.status === 'focusing').length, 6);
    await Promise.all(guests.map((g) => g.post(L.path('/session/abort'))));
    await w.advance(25 * 60_000 + 1000, [L.host]);
    assert.equal((await L.host.progress()).xp, 100);
    for (const g of guests) assert.equal((await g.progress()).xp, 0);
  });

  test('Тест 14: подмена клиентских данных не работает', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    const [host, guest] = L.users;
    // 1) нельзя записать xp/coins/level через профиль
    const patched = await guest.patch('/api/users/me', { xp: 99999, coins: 99999, level: 50, name: 'Хакер' });
    assert.equal(patched.body.xp, 0);
    assert.equal(patched.body.coins, 0);
    assert.equal(patched.body.name, 'Хакер');
    // 2) время и длительность задаёт только сервер
    assert.equal((await host.post(L.path('/start'), { now: 0, endsAt: 1, focusSec: 1, userId: guest.id })).status, 200);
    const room = (await host.get(L.path())).body.room;
    assert.equal(room.phaseEndsAt - room.phaseStartedAt, 25 * 60_000);
    // 3) чужой токен/чужой id не дают прав: гость не может запускать/закрывать
    assert.equal((await guest.post(L.path('/start'), { userId: host.id })).body.error.code, 'NOT_HOST');
    assert.equal((await guest.post(L.path('/close'), { hostId: guest.id })).body.error.code, 'NOT_HOST');
    // 4) поддельный Room ID / чужая комната
    const other = await lobby(w, ['Чужой']);
    assert.equal((await guest.post(other.path('/session/abort'))).body.error.code, 'NOT_A_MEMBER');
    assert.equal((await guest.post(other.path('/task'), { title: 'x' })).body.error.code, 'NOT_A_MEMBER');
    // 5) отрицательные и поддельные суммы в покупках игнорируются/отклоняются
    await w.advance(25 * 60_000 + 1000, L.users);
    const c0 = (await host.progress()).coins;
    await host.post('/api/users/me/upgrades/base_walls/purchase', { cost: -1000, price: -1000, expectedLevel: 0 });
    assert.ok((await host.progress()).coins < c0, 'цена берётся только из серверного каталога');
    // 6) нельзя отправить помощь/пакость «от имени» другого игрока
    const r = await guest.post(L.path('/social/prank'), { targetUserId: host.id, type: 'fog', senderId: host.id, fromUserId: host.id });
    const feed = (await guest.get(L.path('/social'))).body.actions;
    if (r.status === 201) assert.equal(feed[0].fromUserId, guest.id);
    // 7) невалидный/просроченный токен
    assert.equal((await w.call('POST', L.path('/start'), {}, host.token + 'x')).status, 401);
  });

  test('дневной лимит наград: лишние сессии завершаются, но не награждаются', async () => {
    const w2 = await boot({ config: { economy: { dailyRewardedSessions: 2 } } });
    try {
      const L = await lobby(w2, ['Хост']);
      for (let i = 0; i < 3; i++) {
        await runFocus(w2, L);
        await w2.advance(5 * 60_000, L.users);
      }
      const sessions = (await L.host.get('/api/users/me/sessions')).body.sessions;
      assert.deepEqual(sessions.map((s) => s.rewarded), [false, true, true]);
      assert.equal(sessions[0].endReason, 'daily_cap');
      assert.equal((await L.host.progress()).xp, 200); // 2 награждённые сессии
    } finally { await w2.close(); }
  });

  test('уровни и достижения: 6 сессий → five_sessions, победа в испытании, повтор не награждает дважды', async () => {
    const L = await lobby(w, ['Хост']);
    for (let i = 0; i < 6; i++) {
      await runFocus(w, L);
      await w.advance(5 * 60_000, L.users);
    }
    // победы в Tower Defense проводят команду по карте до крепости (так их фиксирует сервис TD)
    const room = w.app.db.get('SELECT * FROM rooms WHERE id = ?', L.room.id);
    for (const stage of ['camp', 'forest', 'bridge', 'fortress', 'fortress']) {
      w.app.db.tx(() => w.app.services.game.recordStageVictory(room, 'shared', stage, [L.host.id]));
    }
    const p = await L.host.progress();
    assert.equal(p.xp, 600 + 3 * 25 + 150); // 6 сессий + 3 узла карты (по 25) + командная награда
    assert.ok(p.level >= 4);
    const ach = Object.fromEntries(p.achievements.map((a) => [a.id, a.unlocked]));
    assert.ok(ach.first_focus && ach.five_sessions && ach.team_player && ach.team_victory);
    const tx = (await L.host.get('/api/users/me/transactions?limit=200')).body.transactions;
    for (const id of ['first_focus', 'five_sessions', 'team_player', 'team_victory']) {
      assert.equal(tx.filter((t) => t.key === `ach:${id}`).length, 1, `ачивка ${id} выдана ровно один раз`);
    }
    assert.equal(tx.filter((t) => t.kind === 'team_challenge').length, 1);
  });

  test('история занятий содержит все статусы и награды', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    await L.host.post(L.path('/start'));
    await L.rest[0].post(L.path('/session/abort'));
    await w.advance(25 * 60_000 + 1000, L.users);
    const h = (await L.host.get('/api/users/me/sessions')).body.sessions[0];
    assert.equal(h.status, 'completed');
    assert.equal(h.durationSec, 1500);
    const g = (await L.rest[0].get('/api/users/me/sessions')).body.sessions[0];
    assert.equal(g.status, 'aborted');
    assert.equal(g.xp, 0);
  });
});
