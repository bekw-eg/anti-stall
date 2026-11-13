import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { boot } from './helpers.js';

/** Сырой HTTP-запрос: fetch нормализует «..» в URL, а нам нужно проверить сервер на «грязных» путях. */
function raw(url, path, method = 'GET') {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('раздача фронтенда (TOMATO_STATIC_DIR)', () => {
  let w;
  let base;
  before(async () => {
    base = mkdtempSync(join(tmpdir(), 'tomato-static-'));
    const dist = join(base, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Tomato</title>');
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'assets', 'app-abc123.css'), 'body{}');
    writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
    writeFileSync(join(base, 'secret.txt'), 'SECRET'); // рядом с корнем — не должно отдаваться
    w = await boot({ env: { TOMATO_STATIC_DIR: dist } });
  });
  after(() => w.close());

  test('index.html, ассеты и типы содержимого; кеш: immutable для /assets, no-cache для index.html', async () => {
    let r = await raw(w.url, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.body, /Tomato/);
    r = await raw(w.url, '/index.html');
    assert.equal(r.headers['cache-control'], 'no-cache');
    r = await raw(w.url, '/assets/app-abc123.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
    assert.match(r.headers['cache-control'], /immutable/);
    assert.equal(r.body, 'console.log(1)');
    assert.match((await raw(w.url, '/assets/app-abc123.css')).headers['content-type'], /^text\/css/);
    assert.equal((await raw(w.url, '/favicon.svg')).headers['content-type'], 'image/svg+xml');
  });

  test('SPA-fallback: путь без расширения → index.html; отсутствующий файл с расширением → 404', async () => {
    const r = await raw(w.url, '/room/ABC123');
    assert.equal(r.status, 200);
    assert.match(r.body, /Tomato/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal((await raw(w.url, '/assets/missing.js')).status, 404);
  });

  test('HEAD отдаёт заголовки без тела', async () => {
    const r = await raw(w.url, '/assets/app-abc123.js', 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-length'], String('console.log(1)'.length));
    assert.equal(r.body, '');
  });

  test('path traversal: выйти за пределы папки нельзя', async () => {
    for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/..%5csecret.txt', '/%2e%2e%5csecret.txt']) {
      const r = await raw(w.url, p);
      assert.ok(!r.body.includes('SECRET'), `${p} → ${r.status}`);
      assert.ok([400, 404].includes(r.status) || /Tomato/.test(r.body), `${p} → ${r.status}`);
    }
    assert.equal((await raw(w.url, '/%00index.html')).status, 400);
  });

  test('API и /ws не перехватываются статикой, POST вне /api — как раньше', async () => {
    const h = await w.call('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.status, 'ok');
    const nf = await raw(w.url, '/api/nope');
    assert.equal(nf.status, 404);
    assert.match(nf.headers['content-type'], /application\/json/);
    assert.match((await raw(w.url, '/ws')).headers['content-type'], /application\/json/);
    assert.equal((await raw(w.url, '/room/x', 'POST')).status, 404);
    const c = w.ws((await w.user('Статик')).token);
    await c.connect();
    c.close();
  });

  test('без TOMATO_STATIC_DIR поведение не меняется: не-API пути → JSON 404', async () => {
    const w2 = await boot();
    try {
      const r = await raw(w2.url, '/');
      assert.equal(r.status, 404);
      assert.match(r.headers['content-type'], /application\/json/);
      assert.equal(JSON.parse(r.body).error.code, 'NOT_FOUND');
    } finally { await w2.close(); }
  });
});
