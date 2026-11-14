import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

describe('образ аксолотля', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());

  test('по умолчанию — бесплатный цвет без вещей; образ виден комнате; закрытое уровнем не надеть', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const [lotti, anya] = L.users;
    const me0 = (await lotti.get('/api/users/me')).body;
    assert.ok(['pink', 'blue', 'mint'].includes(me0.avatar.skin));
    assert.deepEqual([me0.avatar.head, me0.avatar.face, me0.avatar.neck], [null, null, null]);

    // открытое с 1 уровня — можно, и Аня видит образ Лотти в снимке комнаты
    const ok = await lotti.patch('/api/users/me', { avatar: { skin: 'blue', head: 'bow', face: 'glasses' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.avatar, { skin: 'blue', head: 'bow', face: 'glasses', neck: null });
    const snap = (await anya.get(L.path())).body;
    assert.deepEqual(snap.members.find((m) => m.userId === lotti.id).avatar, ok.body.avatar);

    // корона — с 5 уровня, лимонный цвет — со 2-го
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'pink', head: 'crown' } })).body.error.code, 'AVATAR_LOCKED');
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'yellow' } })).body.error.code, 'AVATAR_LOCKED');
    // вещь не своего слота и неизвестный цвет
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'pink', head: 'glasses' } })).status, 400);
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'gold' } })).status, 400);
    // неудачные попытки не испортили сохранённый образ
    assert.deepEqual((await lotti.get('/api/users/me')).body.avatar, ok.body.avatar);

    // уровень растёт за фокус — открывается лимонный (ур. 2)
    await runFocus(w, L, L.users);
    await runBreak(w, L, L.users);
    await runFocus(w, L, L.users);
    const lvl = (await lotti.progress()).level;
    assert.ok(lvl >= 2, `уровень ${lvl}`);
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'yellow', neck: 'scarf' } })).status, 200);
  });

  test('каталог образов отдаётся в /api/config', async () => {
    const cfg = (await w.call('GET', '/api/config')).body;
    assert.equal(cfg.avatar.skins.length, 6);
    assert.ok(cfg.avatar.items.every((i) => cfg.avatar.slots.includes(i.slot)));
  });
});
