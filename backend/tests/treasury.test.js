import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AppError } from '../src/errors.js';
import { boot, lobby, runFocus } from './helpers.js';

const treasury = (w, L, team) => w.app.services.game.treasuryOf(L.room.id, team);

describe('казна команды (Tower Defense)', () => {
  test('стартовый капитал 30 у каждой команды: shared и A/B; строки создаются при старте фокуса', async () => {
    const w = await boot();
    try {
      const S = await lobby(w, ['Хост']);
      assert.equal(treasury(w, S, 'shared'), 30);
      const T = await lobby(w, ['Лотти', 'Аня'], { teamMode: true });
      assert.deepEqual([treasury(w, T, 'A'), treasury(w, T, 'B')], [30, 30]);
      assert.equal(treasury(w, T, 'shared'), 0, 'нет строки — 0');

      // строка команды пропала (старые данные) — старт фокуса её восстанавливает со стартовым капиталом
      w.app.db.run('DELETE FROM team_progress WHERE room_id = ?', T.room.id);
      assert.equal(treasury(w, T, 'A'), 0);
      assert.equal((await T.host.post(T.path('/start'))).status, 200);
      assert.deepEqual([treasury(w, T, 'A'), treasury(w, T, 'B')], [30, 30]);

      // ensureTeamProgress не трогает существующую казну
      w.app.db.tx(() => w.app.services.game.spendTreasury(S.room.id, 'shared', 7));
      w.app.db.tx(() => w.app.services.game.ensureTeams({ id: S.room.id, mode: 'shared' }));
      assert.equal(treasury(w, S, 'shared'), 23);
    } finally { await w.close(); }
  });

  test('монеты за фокус-сессию идут и игроку, и в казну его команды (shared)', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
      await L.host.post(L.path('/start'));
      await w.advance(60_000, L.users);
      await L.users[2].post(L.path('/session/abort')); // без награды — без монет в казну
      await w.advance(25 * 60_000, L.users);
      assert.equal(treasury(w, L, 'shared'), 30 + 2 * 20);
      assert.equal((await L.host.progress()).coins >= 20, true, 'личные монеты сохраняются');
      const road = (await L.host.get(L.path('/roadmap'))).body;
      assert.equal(road.treasuryCoins, 70);
    } finally { await w.close(); }
  });

  test('командный режим: казна A и B пополняется раздельно, по команде игрока', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true }); // A: Лотти, Боря; B: Аня
      await runFocus(w, L);
      assert.equal(treasury(w, L, 'A'), 30 + 2 * 20);
      assert.equal(treasury(w, L, 'B'), 30 + 20);
      const st = (await L.host.get(L.path('/stats'))).body;
      assert.deepEqual(st.teams.map((t) => [t.key, t.treasuryCoins]), [['A', 70], ['B', 50]]);
    } finally { await w.close(); }
  });

  test('дневной лимит: сессия без награды не пополняет казну', async () => {
    const w = await boot({ config: { economy: { dailyRewardedSessions: 1 } } });
    try {
      const L = await lobby(w, ['Хост']);
      await runFocus(w, L);
      await w.advance(5 * 60_000, L.users);
      await runFocus(w, L);
      assert.equal(treasury(w, L, 'shared'), 30 + 20);
    } finally { await w.close(); }
  });

  test('spendTreasury: атомарно, казна никогда не уходит в минус; INSUFFICIENT_TEAM_FUNDS с деталями', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      const game = w.app.services.game;
      // «одновременные» запросы: каждый — своя транзакция, как HTTP-обработчики
      let ok = 0;
      let rejected = 0;
      for (let i = 0; i < 50; i++) {
        try {
          const left = w.app.db.tx(() => game.spendTreasury(L.room.id, 'shared', 4));
          assert.equal(left, 30 - 4 * (ok + 1));
          ok++;
        } catch (err) {
          assert.ok(err instanceof AppError);
          assert.equal(err.status, 409);
          assert.equal(err.code, 'INSUFFICIENT_TEAM_FUNDS');
          assert.deepEqual(err.details, { required: 4, treasuryCoins: 2 });
          rejected++;
        }
      }
      assert.equal(ok, 7);
      assert.equal(rejected, 43);
      assert.equal(treasury(w, L, 'shared'), 2);
      // точная сумма проходит, дальше — 0 и отказ
      assert.equal(w.app.db.tx(() => game.spendTreasury(L.room.id, 'shared', 2)), 0);
      assert.throws(() => w.app.db.tx(() => game.spendTreasury(L.room.id, 'shared', 1)), (e) => e.code === 'INSUFFICIENT_TEAM_FUNDS');
      // некорректные суммы и неизвестная команда
      for (const bad of [0, -5, 1.5, '3']) assert.throws(() => game.spendTreasury(L.room.id, 'shared', bad), (e) => e.code === 'INVALID_AMOUNT');
      assert.throws(() => w.app.db.tx(() => game.spendTreasury(L.room.id, 'Z', 1)), (e) => e.code === 'INSUFFICIENT_TEAM_FUNDS');
      // CHECK в схеме — последняя линия обороны
      assert.throws(() => w.app.db.run("UPDATE team_progress SET treasury_coins = -1 WHERE room_id = ? AND team_key = 'shared'", L.room.id));
      assert.equal(treasury(w, L, 'shared'), 0);
    } finally { await w.close(); }
  });

  test('откат транзакции возвращает списанные монеты; creditTreasury создаёт строку и пополняет', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      const game = w.app.services.game;
      assert.throws(() => w.app.db.tx(() => { game.spendTreasury(L.room.id, 'shared', 10); throw new Error('сбой после списания'); }));
      assert.equal(treasury(w, L, 'shared'), 30);
      assert.equal(w.app.db.tx(() => game.creditTreasury(L.room.id, 'shared', 12)), 42);
      assert.equal(w.app.db.tx(() => game.creditTreasury(L.room.id, 'X', 5)), 35, 'новая строка: стартовый капитал + зачисление');
      assert.throws(() => game.creditTreasury(L.room.id, 'shared', 0));
    } finally { await w.close(); }
  });
});
