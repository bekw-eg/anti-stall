import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSageShipper } from '../src/sageLogs.js';

/** Логи в Sage: пачки «одна JSON-строка = событие», заголовок JWT, метки; ошибки сети и квота не роняют сервер. */
test('Sage Logs Collector: пачки NDJSON с JWT и метками, без адреса/токена — выключено, 429 — пауза', async () => {
  assert.equal(createSageShipper({ url: null, token: 'x' }), null);
  assert.equal(createSageShipper({ url: 'http://x', token: null }), null);

  const calls = [];
  let status = 200;
  const s = createSageShipper({
    url: 'https://sage.example/api/hack-nqz-03/multiline/', token: 'T', labels: { system: 'antistall', env: 'prod' }, flushMs: 20, maxBatch: 2,
    fetchImpl: async (url, o) => { calls.push({ url, o }); return { status, ok: status < 300, headers: new Map([['wait-ms', '60000']]) }; },
  });
  s.push({ msg: 'http', status: 200 });
  s.push({ msg: 'http', status: 500 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls[0].url, 'https://sage.example/api/hack-nqz-03/multiline/');
  assert.equal(calls[0].o.headers.Authorization, 'JWT T');
  assert.deepEqual(calls[0].o.body.split('\n').map((l) => JSON.parse(l)), [
    { system: 'antistall', env: 'prod', msg: 'http', status: 200 },
    { system: 'antistall', env: 'prod', msg: 'http', status: 500 },
  ]);

  status = 429; // квота группы — пачка пропускается, отправка ставится на паузу
  s.push({ msg: 'a' }); s.push({ msg: 'b' });
  await new Promise((r) => setTimeout(r, 60));
  const n = calls.length;
  s.push({ msg: 'c' });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, n, 'во время паузы запросов нет');
  assert.equal(s.stats().dropped, 2);
  await s.close();
});
