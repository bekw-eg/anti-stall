import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

describe('помощь и пакости', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('Тест 10: помощь работает, пакость ограничена, отключается и не мешает Focus', async () => {
    const L = await lobby(w);
    const [lotti, anya, boris] = L.users;
    await runFocus(w, L, L.users); // перерыв; у каждого ≥ 45 монет
    const social = (u, kind, body) => u.post(L.path(`/social/${kind}`), body);

    // --- помощь: «Бонус» → +25% XP в следующей сессии
    const h = await social(lotti, 'help', { targetUserId: anya.id, type: 'boost' });
    assert.equal(h.status, 201);
    assert.equal(h.body.xpBonusPct, 25);
    assert.equal((await social(lotti, 'help', { targetUserId: anya.id, type: 'boost' })).body.error.code, 'ALREADY_SENT');
    assert.equal((await social(lotti, 'help', { targetUserId: lotti.id, type: 'boost' })).body.error.code, 'SELF_TARGET');
    assert.equal((await social(lotti, 'help', { targetUserId: anya.id, type: 'heal' })).body.error.code, 'UNKNOWN_HELP_TYPE');
    // «Щит» стоит монет
    const coins0 = (await lotti.progress()).coins;
    assert.equal((await social(lotti, 'help', { targetUserId: boris.id, type: 'shield' })).status, 201);
    assert.equal((await lotti.progress()).coins, coins0 - 10);

    // --- пакость
    const p1 = await social(lotti, 'prank', { targetUserId: anya.id, type: 'fog' });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.applied, true);
    const room = (await lotti.get(L.path())).body.room;
    assert.ok(p1.body.effectEndsAt <= room.phaseEndsAt, 'эффект не выходит за пределы перерыва');
    assert.equal((await social(lotti, 'prank', { targetUserId: boris.id, type: 'fog' })).body.error.code, 'PRANK_COOLDOWN');
    await w.advance(25_000, L.users);
    // Щит у Бори блокирует пакость
    const blocked = await social(lotti, 'prank', { targetUserId: boris.id, type: 'sticker' });
    assert.equal(blocked.body.blocked, true);
    assert.equal(blocked.body.applied, false);
    // тот же эффект тому же игроку — нельзя; лимит за перерыв — 3
    await w.advance(25_000, L.users);
    assert.equal((await social(lotti, 'prank', { targetUserId: anya.id, type: 'fog' })).body.error.code, 'ALREADY_SENT');
    assert.equal((await social(lotti, 'prank', { targetUserId: anya.id, type: 'sticker' })).status, 201);
    await w.advance(25_000, L.users);
    assert.equal((await social(lotti, 'prank', { targetUserId: boris.id, type: 'fog' })).body.error.code, 'PRANK_BREAK_LIMIT');

    // --- отключение пакостей
    await anya.patch('/api/users/me', { prankEnabled: false });
    await w.advance(25_000, L.users);
    assert.equal((await social(boris, 'prank', { targetUserId: anya.id, type: 'fog' })).body.error.code, 'PRANKS_DISABLED');
    assert.equal((await social(anya, 'prank', { targetUserId: boris.id, type: 'fog' })).body.error.code, 'PRANKS_DISABLED_SELF');

    // --- бонус реально применяется на следующей сессии, пакости не отнимают прогресс
    const xpBefore = (await anya.progress()).xp;
    await w.advance(5 * 60_000, L.users);
    await runFocus(w, L, L.users);
    const gained = (await anya.progress()).xp - xpBefore;
    assert.ok(gained >= 125, `бонус +25% применён (получено ${gained})`);
    const tx = (await anya.get('/api/users/me/transactions?limit=200')).body.transactions;
    assert.equal(tx.filter((t) => t.xp < 0 || (t.kind === 'focus_session' && t.coins < 0)).length, 0);
    assert.ok((await lotti.progress()).achievements.find((a) => a.id === 'helper').unlocked);
    assert.ok((await lotti.progress()).achievements.find((a) => a.id === 'prankster').unlocked);
    // Бонус одноразовый
    assert.equal((await anya.progress()).effects.filter((e) => e.kind === 'boost').length, 0);
  });

  test('пакость не отправляется игроку, который занимается; не-участники не участвуют', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    const outsider = await w.user('Посторонний');
    await runFocus(w, L);
    assert.equal((await L.host.post(L.path('/social/prank'), { targetUserId: outsider.id, type: 'fog' })).body.error.code, 'TARGET_NOT_IN_ROOM');
    assert.equal((await outsider.post(L.path('/social/prank'), { targetUserId: L.host.id, type: 'fog' })).body.error.code, 'NOT_A_MEMBER');
    // гость уходит в фокус в другой комнате → ему нельзя слать пакости
    const other = (await L.rest[0].post('/api/rooms', { name: 'Другая' })).body.room;
    await L.rest[0].post(`/api/rooms/${other.id}/start`);
    assert.equal((await L.host.post(L.path('/social/prank'), { targetUserId: L.rest[0].id, type: 'fog' })).body.error.code, 'TARGET_FOCUSING');
  });

  test('дневной лимит помощи и недостаток монет для щита', async () => {
    const L = await lobby(w, ['Хост', 'Гость']);
    const rich = await w.user('Нищий');
    await rich.post('/api/rooms/join', { code: L.room.code });
    await runFocus(w, L, [...L.users, rich]);
    // у «Нищего» не было сессии (не участвовал? он вошёл до старта, значит участвовал) — спишем монеты вручную
    w.app.db.run('UPDATE users SET coins = 0 WHERE id = ?', rich.id);
    assert.equal((await rich.post(L.path('/social/help'), { targetUserId: L.host.id, type: 'shield' })).body.error.code, 'INSUFFICIENT_FUNDS');
    assert.equal((await rich.progress()).coins, 0);
  });
});
