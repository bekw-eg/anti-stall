import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

describe('демо-режим для жюри', () => {
  test('без флага TOMATO_DEMO ускоренные комнаты недоступны, а обычные ограничены минимумом', async () => {
    const w = await boot();
    try {
      const u = await w.user('Юзер');
      assert.equal((await u.post('/api/rooms', { demo: true, focusSeconds: 25 })).body.error.code, 'DEMO_DISABLED');
      // Вне демо длительность тоже вводится в секундах, но действуют обычные границы (фокус от 1 минуты)
      assert.equal((await u.post('/api/rooms', { focusSeconds: 25 })).body.error.code, 'INVALID_FIELD');
      assert.equal((await u.post('/api/rooms', { focusSeconds: 90 })).body.room.settings.focusSec, 90);
      assert.equal((await w.call('GET', '/api/health')).body.demoMode, false);
    } finally { await w.close(); }
  });

  test('с флагом: 25-секундная сессия идёт тем же кодом проверки, награды те же, обход правил невозможен', async () => {
    const w = await boot({ env: { TOMATO_DEMO: '1' } });
    try {
      const L = await lobby(w, ['Лотти', 'Аня'], { demo: true, focusSeconds: 25, breakSeconds: 10, focusMinutes: undefined, breakMinutes: undefined });
      assert.equal(L.room.settings.focusSec, 25);
      await L.host.post(L.path('/start'));
      await w.advance(10_000, L.users);
      await L.rest[0].post(L.path('/session/abort')); // досрочно — награды нет и в демо
      await w.advance(16_000, L.users);
      assert.equal((await L.host.get(L.path())).body.room.phase, 'break');
      assert.equal((await L.host.progress()).xp, 100); // 100 за фокус; узлы карты дают только победы в Tower Defense
      assert.equal((await L.rest[0].progress()).xp, 0);
      // та же защита от прерванных/покинутых сессий и те же границы
      assert.equal((await L.host.post('/api/rooms', { demo: true, focusSeconds: 1 })).body.error.code, 'INVALID_FIELD');
      // обычная комната в демо-режиме остаётся обычной: фокус от 30 секунд до 24 часов (и только для обычных аккаунтов)
      const regular = await w.user('Обычный');
      assert.equal((await regular.post('/api/rooms', { focusSeconds: 29 })).body.error.code, 'INVALID_FIELD');
      assert.equal((await regular.post('/api/rooms', { focusSeconds: 24 * 3600 + 1 })).body.error.code, 'INVALID_FIELD');
      assert.equal((await L.host.post('/api/rooms', { focusMinutes: 25 })).body.error.code, 'SANDBOX_DEMO_ONLY');
      assert.equal((await regular.post('/api/rooms', { demo: true, focusSeconds: 25 })).body.error.code, 'DEMO_SANDBOX_ONLY');
      // тот же лимит наград в демо ограничен отдельным потолком, а завершение — только сервером
      assert.equal((await L.host.post(L.path('/complete'), {})).status, 404);
    } finally { await w.close(); }
  });
});
