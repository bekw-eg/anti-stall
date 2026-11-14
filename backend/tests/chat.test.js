import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

const send = (u, L, text) => u.post(L.path('/chat'), { text });
const history = async (u, L) => (await u.get(L.path('/chat'))).body;

describe('текстовый чат комнаты', () => {
  test('участники пишут и читают; посторонним — 403; сообщения сохраняются по порядку', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      const outsider = await w.user('Чужой');
      const a = await send(L.host, L, '  привет, начнём?  ');
      assert.equal(a.status, 201);
      assert.equal(a.body.text, 'привет, начнём?', 'пробелы по краям обрезаны');
      assert.equal(a.body.name, 'Лотти');
      await w.advance(1500, L.users);
      await send(L.rest[0], L, 'давай');
      const h = await history(L.rest[0], L);
      assert.deepEqual(h.messages.map((m) => [m.name, m.text]), [['Лотти', 'привет, начнём?'], ['Аня', 'давай']]);
      assert.equal(h.readOnly, false);
      assert.equal((await outsider.get(L.path('/chat'))).status, 403);
      assert.equal((await send(outsider, L, 'спам')).status, 403);
    } finally { await w.close(); }
  });

  test('в фокусе только чтение, на перерыве снова можно писать', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await L.host.post(L.path('/start'));
      const r = await send(L.host, L, 'отвлеку');
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'CHAT_FOCUS_LOCKED');
      assert.equal((await history(L.host, L)).readOnly, true);
      await w.advance(25 * 60_000 + 1000, L.users);
      assert.equal((await send(L.host, L, 'перерыв!')).status, 201);
    } finally { await w.close(); }
  });

  test('валидация и антиспам: пустое, слишком длинное, слишком часто, лимит в минуту', async () => {
    const w = await boot({ config: { chat: { perMinute: 3 } } });
    try {
      const L = await lobby(w, ['Лотти']);
      assert.equal((await send(L.host, L, '   ')).body.error.code, 'INVALID_FIELD');
      assert.equal((await send(L.host, L, 'x'.repeat(301))).body.error.code, 'INVALID_FIELD');
      assert.equal((await L.host.post(L.path('/chat'), { text: 42 })).body.error.code, 'INVALID_FIELD');
      assert.equal((await send(L.host, L, 'раз')).status, 201);
      assert.equal((await send(L.host, L, 'два')).body.error.code, 'CHAT_TOO_FAST');
      for (const t of ['два', 'три']) { await w.advance(1100, L.users); assert.equal((await send(L.host, L, t)).status, 201); }
      await w.advance(1100, L.users);
      assert.equal((await send(L.host, L, 'четыре')).body.error.code, 'CHAT_RATE_LIMIT');
      await w.advance(60_000, L.users);
      assert.equal((await send(L.host, L, 'снова')).status, 201);
    } finally { await w.close(); }
  });

  test('сообщение приходит всей комнате по WebSocket', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await runFocus(w, L); // перерыв
      const c = w.ws(L.rest[0].token);
      await c.connect();
      c.send({ type: 'subscribe', roomId: L.room.id });
      await c.wait((m) => m.type === 'room_state');
      await send(L.host, L, 'кто строит башни?');
      const ev = await c.wait((m) => m.type === 'chat_message');
      assert.equal(ev.data.text, 'кто строит башни?');
      assert.equal(ev.data.userId, L.host.id);
      c.close();
    } finally { await w.close(); }
  });
});
