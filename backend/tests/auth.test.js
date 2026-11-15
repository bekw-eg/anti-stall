import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { boot } from './helpers.js';

describe('аккаунт с логином и паролем', () => {
  let w;
  before(async () => { w = await boot(); });
  after(() => w.close());
  const login = (body) => w.call('POST', '/api/auth/login', body);

  test('гость закрепляет аккаунт; вход с другого устройства; старое не выходит', async () => {
    const lotti = await w.user('Лотти');
    assert.equal((await lotti.me()).login, null, 'гость — без логина');
    assert.equal((await lotti.post('/api/users/me/credentials', { login: 'Лотти!', password: 'secret-pass-1' })).body.error.code, 'INVALID_FIELD');
    assert.equal((await lotti.post('/api/users/me/credentials', { login: 'lotti', password: 'short' })).body.error.code, 'INVALID_FIELD');
    const r = await lotti.post('/api/users/me/credentials', { login: 'Lotti_01', password: 'secret-pass-1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.login, 'lotti_01', 'логин без учёта регистра');

    const anya = await w.user('Аня');
    assert.equal((await anya.post('/api/users/me/credentials', { login: 'lotti_01', password: 'another-pass' })).body.error.code, 'LOGIN_TAKEN');

    const ok = await login({ login: 'LOTTI_01', password: 'secret-pass-1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.id, lotti.id);
    assert.equal((await w.call('GET', '/api/users/me', undefined, ok.body.token)).body.id, lotti.id, 'новый токен — тот же аккаунт');
    assert.equal((await lotti.me()).id, lotti.id, 'старое устройство не разлогинилось');
    assert.equal((await login({ login: 'lotti_01', password: 'wrong-pass' })).body.error.code, 'WRONG_CREDENTIALS');
    assert.equal((await login({ login: 'nobody', password: 'whatever-1' })).body.error.code, 'WRONG_CREDENTIALS', 'не выдаём, есть ли такой логин');
  });

  test('смена пароля — только с текущим паролем; перебор пароля блокируется', async () => {
    const vera = await w.user('Вера');
    await vera.post('/api/users/me/credentials', { login: 'vera', password: 'first-pass-1' });
    assert.equal((await vera.post('/api/users/me/credentials', { password: 'second-pass-2' })).body.error.code, 'WRONG_PASSWORD');
    assert.equal((await vera.post('/api/users/me/credentials', { currentPassword: 'first-pass-1', password: 'second-pass-2' })).status, 200);
    assert.equal((await login({ login: 'vera', password: 'first-pass-1' })).status, 403);
    assert.equal((await login({ login: 'vera', password: 'second-pass-2' })).status, 200);

    for (let i = 0; i < 10; i++) await login({ login: 'vera', password: `guess-${i}-xx` });
    const locked = await login({ login: 'vera', password: 'second-pass-2' });
    assert.equal(locked.body.error.code, 'LOGIN_LOCKED', 'после 10 ошибок даже верный пароль ждёт');
    w.clock.advance(16 * 60_000);
    assert.equal((await login({ login: 'vera', password: 'second-pass-2' })).status, 200, 'блокировка снимается через 15 минут');
  });
});
