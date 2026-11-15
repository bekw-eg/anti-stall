import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

describe('друзья', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());
  const list = async (u) => (await u.get('/api/friends')).body;

  test('заявка из общей комнаты → принять; повтор и самодобавление запрещены; видно, где друг', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const [lotti, anya] = L.users;
    const ws = w.ws(anya.token);
    await ws.connect();

    const r = await lotti.post('/api/friends/requests', { userId: anya.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'pending');
    await ws.wait((m) => m.type === 'friend_request' && m.data.userId === lotti.id);
    assert.equal((await lotti.post('/api/friends/requests', { userId: anya.id })).body.error.code, 'ALREADY_SENT');
    assert.deepEqual((await list(anya)).incoming.map((x) => x.id), [lotti.id]);
    assert.deepEqual((await list(lotti)).outgoing.map((x) => x.id), [anya.id]);
    assert.equal((await lotti.get('/api/friends/relations')).body.relations[anya.id], 'outgoing');

    // принять может только получатель
    assert.equal((await lotti.post(`/api/friends/${anya.id}/accept`)).status, 404);
    const acc = await anya.post(`/api/friends/${lotti.id}/accept`);
    assert.equal(acc.status, 200);
    const f = (await list(lotti)).friends;
    assert.equal(f.length, 1);
    assert.equal(f[0].id, anya.id);
    assert.equal(f[0].room.code, L.room.code, 'видно, в какой комнате друг');
    assert.ok(['online', 'reconnecting'].includes(f[0].connection));
    assert.ok(f[0].avatar?.skin, 'у друга виден его аксолотль');
    assert.equal((await anya.post('/api/friends/requests', { userId: lotti.id })).body.error.code, 'ALREADY_FRIENDS');
    assert.equal((await lotti.post('/api/friends/requests', { userId: lotti.id })).body.error.code, 'SELF_FRIEND');
    ws.close();
  });

  test('незнакомца по id не добавить — только по коду друга; встречная заявка сразу делает друзьями', async () => {
    const vera = await w.user('Вера');
    const boris = await w.user('Боря');
    assert.equal((await vera.post('/api/friends/requests', { userId: boris.id })).body.error.code, 'USER_NOT_FOUND');
    const code = (await list(boris)).code;
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.equal((await list(boris)).code, code, 'код постоянный');
    assert.equal((await vera.post('/api/friends/requests', { code: 'ZZZZZZ' })).body.error.code, 'FRIEND_CODE_NOT_FOUND');
    assert.equal((await boris.post('/api/friends/requests', { code })).body.error.code, 'SELF_FRIEND');
    // код можно вводить строчными и с дефисом
    const r = await vera.post('/api/friends/requests', { code: `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}` });
    assert.equal(r.body.status, 'pending');
    // Боря тоже добавляет Веру по её коду — встречная заявка: сразу друзья
    const back = await boris.post('/api/friends/requests', { code: (await list(vera)).code });
    assert.equal(back.body.status, 'accepted');
    assert.equal((await list(vera)).friends[0].id, boris.id);
    assert.equal((await list(vera)).friends[0].room, null, 'не в комнате');

    // удалить из друзей — пропадает у обоих
    assert.equal((await vera.post(`/api/friends/${boris.id}/remove`)).status, 200);
    assert.equal((await list(boris)).friends.length, 0);
    // отклонить входящую — та же операция
    await vera.post('/api/friends/requests', { code });
    assert.equal((await boris.post(`/api/friends/${vera.id}/remove`)).status, 200);
    assert.equal((await list(vera)).outgoing.length, 0);
  });

  test('друга можно позвать в свою комнату — не чаще раза в минуту; не друга — нельзя', async () => {
    const L = await lobby(w, ['Мира', 'Кай']);
    const [mira, kai] = L.users;
    const stranger = await w.user('Гость');
    await mira.post('/api/friends/requests', { userId: kai.id });
    await kai.post(`/api/friends/${mira.id}/accept`);
    // Кай вышел из комнаты — Мира зовёт его обратно
    await kai.post(L.path('/leave'));
    const ws = w.ws(kai.token);
    await ws.connect();
    const inv = await mira.post(`/api/friends/${kai.id}/invite`, { roomId: L.room.id });
    assert.equal(inv.status, 201);
    const ev = await ws.wait((m) => m.type === 'room_invite');
    assert.equal(ev.data.roomCode, L.room.code);
    assert.equal(ev.data.fromName, 'Мира');
    assert.equal((await mira.post(`/api/friends/${kai.id}/invite`, { roomId: L.room.id })).body.error.code, 'INVITE_COOLDOWN');
    assert.equal((await mira.post(`/api/friends/${stranger.id}/invite`, { roomId: L.room.id })).body.error.code, 'NOT_FRIENDS');
    w.clock.advance(61_000);
    assert.equal((await mira.post(`/api/friends/${kai.id}/invite`, { roomId: L.room.id })).status, 201);
    ws.close();
  });
});

describe('перенос аккаунта на другое устройство', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('одноразовый код даёт новому устройству вход в тот же аккаунт; старое устройство не выходит', async () => {
    const lotti = await w.user('Лотти');
    const c = await lotti.post('/api/users/me/transfer-code');
    assert.equal(c.status, 201);
    assert.match(c.body.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const r = await w.call('POST', '/api/users/transfer', { code: c.body.code.toLowerCase() });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.id, lotti.id);
    const newDevice = await w.call('GET', '/api/users/me', undefined, r.body.token);
    assert.equal(newDevice.body.id, lotti.id, 'новый токен — тот же аккаунт');
    assert.equal((await lotti.me()).id, lotti.id, 'старое устройство не разлогинилось');
    // повторно тот же код не работает
    assert.equal((await w.call('POST', '/api/users/transfer', { code: c.body.code })).body.error.code, 'TRANSFER_CODE_INVALID');
    // новый код отменяет прежний неиспользованный; просроченный не работает
    const c1 = (await lotti.post('/api/users/me/transfer-code')).body.code;
    const c2 = (await lotti.post('/api/users/me/transfer-code')).body.code;
    assert.equal((await w.call('POST', '/api/users/transfer', { code: c1 })).status, 404);
    w.clock.advance(11 * 60_000);
    assert.equal((await w.call('POST', '/api/users/transfer', { code: c2 })).body.error.code, 'TRANSFER_CODE_INVALID');
  });
});
