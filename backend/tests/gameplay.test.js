import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TD } from '../src/catalog.js';
import { advanceTo, buildSchedule, newState } from '../src/td/engine.js';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

/**
 * Правила после просмотра прототипа (ветка fixes/gameplay-feedback):
 * свободные длительности, качество фокуса, автостарт цикла, «Сдаться» вместо пропуска фокуса,
 * шутки — командные дебаффы без выключателя.
 */
const roomOf = async (L) => (await L.host.get(L.path())).body;
const focusTx = async (u) => (await u.get('/api/users/me/transactions')).body.transactions.filter((t) => t.kind === 'focus_session');

describe('длительности и план циклов — ввод пользователя', () => {
  test('любые значения в границах (фокус 1 мин – 24 ч, перерыв 10 с – 2 ч), вне границ — 400', async () => {
    const w = await boot();
    try {
      const u = await w.user('Ввод');
      const ok = await u.post('/api/rooms', { focusSeconds: 37 * 60 + 15, breakSeconds: 10, cycles: 3 });
      assert.equal(ok.status, 201);
      assert.deepEqual(ok.body.room.settings, { focusSec: 2235, breakSec: 10, cycles: 3 });
      const max = await u.post('/api/rooms', { focusSeconds: 24 * 3600, breakSeconds: 24 * 3600 });
      assert.equal(max.body.room.settings.focusSec, 86_400);
      for (const bad of [{ focusSeconds: 0 }, { focusSeconds: 86_401 }, { breakSeconds: 0 }, { breakSeconds: 86_401 }, { cycles: 0 }, { focusSeconds: 'много' }]) {
        assert.equal((await u.post('/api/rooms', bad)).body.error.code, 'INVALID_FIELD', JSON.stringify(bad));
      }
      // старые клиенты в минутах тоже работают
      assert.equal((await u.post('/api/rooms', { focusMinutes: 50, breakMinutes: 10 })).body.room.settings.focusSec, 3000);
    } finally { await w.close(); }
  });

  test('план циклов меняется только до первого фокуса', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост'], { cycles: 2 });
      assert.equal((await L.host.patch(L.path('/settings'), { cycles: 5 })).body.room.settings.cycles, 5);
      await runFocus(w, L);
      await runBreak(w, L); // следующий фокус стартовал сам
      await runFocus(w, L);
      await runBreak(w, L);
      await runFocus(w, L);
      await runBreak(w, L);
      await runFocus(w, L);
      await runBreak(w, L);
      await runFocus(w, L);
      await runBreak(w, L);
      assert.equal((await roomOf(L)).room.phase, 'waiting');
      assert.equal((await L.host.patch(L.path('/settings'), { cycles: 6 })).body.error.code, 'CYCLES_LOCKED');
      assert.equal((await L.host.patch(L.path('/settings'), { focusSeconds: 600 })).status, 200, 'длительность — можно');
    } finally { await w.close(); }
  });
});

describe('цикл: перерыв ведёт к следующему фокусу, фокус не пропускается', () => {
  test('после перерыва фокус стартует сам до конца плана, затем комната ждёт хоста', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня'], { cycles: 2 });
      await runFocus(w, L);
      assert.equal((await roomOf(L)).room.phase, 'break');
      await runBreak(w, L);
      let r = await roomOf(L);
      assert.equal(r.room.phase, 'focus');
      assert.equal(r.room.cycleNo, 2);
      assert.equal(r.members.filter((m) => m.status === 'focusing').length, 2, 'оба участника в новом цикле');
      await runFocus(w, L);
      await runBreak(w, L);
      r = await roomOf(L);
      assert.equal(r.room.phase, 'waiting', 'план из 2 циклов выполнен');
      assert.ok(r.me.allowedActions.includes('start_focus'), 'сверх плана — вручную');
    } finally { await w.close(); }
  });

  test('хост пропускает перерыв → сразу следующий фокус; пропустить фокус нельзя никому', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await L.host.post(L.path('/start'));
      assert.equal((await L.host.post(L.path('/skip-break'))).body.error.code, 'WRONG_PHASE');
      assert.equal((await L.host.post(L.path('/skip'))).status, 404);
      await w.advance(25 * 60_000 + 1000, L.users);
      assert.equal((await L.rest[0].post(L.path('/skip-break'))).body.error.code, 'NOT_HOST');
      const skipped = await L.host.post(L.path('/skip-break'));
      assert.equal(skipped.body.room.phase, 'focus');
      assert.equal(skipped.body.room.cycleNo, 2);
    } finally { await w.close(); }
  });

  test('после простоя сервера пропущенные циклы не «догоняются» автостартом и не награждаются', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      await L.host.post(L.path('/start'));
      w.clock.advance(5 * 3600_000); // сервер «спал» 5 часов: тиков не было
      await L.host.post('/api/heartbeat');
      w.app.tick();
      const r = await roomOf(L);
      assert.equal(r.room.phase, 'waiting', 'перерыв кончился давно — нового фокуса задним числом нет');
      assert.equal(r.room.cycleNo, 1);
      assert.equal((await focusTx(L.host)).length <= 1, true);
    } finally { await w.close(); }
  });

  test('«Я готов» на перерыве: все в сети готовы → перерыв заканчивается, сразу следующий фокус', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await runFocus(w, L);
      assert.equal((await roomOf(L)).room.phase, 'break');
      const one = await L.host.post(L.path('/ready'), { ready: true });
      assert.equal(one.body.room.phase, 'break', 'готов один из двух — перерыв идёт');
      const both = await L.rest[0].post(L.path('/ready'), { ready: true });
      assert.equal(both.body.room.phase, 'focus');
      assert.equal(both.body.room.cycleNo, 2);
      assert.equal(both.body.members.filter((m) => m.status === 'focusing').length, 2);
    } finally { await w.close(); }
  });

  test('«Сдаться»: без награды, сдавшийся остаётся в знаменателе команды', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      await L.host.post(L.path('/start'));
      await w.advance(60_000, L.users);
      const gave = await L.rest[0].post(L.path('/session/abort'));
      assert.equal(gave.body.status, 'aborted');
      await w.advance(24 * 60_000 + 1000, L.users);
      assert.equal((await L.rest[0].progress()).xp, 0);
      const r = await roomOf(L);
      assert.equal(r.members.find((m) => m.userId === L.rest[0].id).status, 'aborted');
      assert.equal(r.challenge.points, 1, '1 из 2 качественно — ровно половина, шаг засчитан');
    } finally { await w.close(); }
  });
});

describe('качество фокуса определяет награду', () => {
  test('уход со вкладки на половину сессии → половина награды и не засчитывается команде', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      const [lotti, anya] = L.users;
      await lotti.post(L.path('/start'));
      await w.advance(5 * 60_000, L.users);
      assert.equal((await anya.post(L.path('/session/attention'), { state: 'away' })).body.tracked, true);
      await anya.post(L.path('/session/attention'), { state: 'away' }); // повтор не сдвигает начало отлучки
      await w.advance(12.5 * 60_000, L.users);
      await anya.post(L.path('/session/attention'), { state: 'back' });
      await w.advance(7.5 * 60_000 + 1000, L.users);
      const [txL] = await focusTx(lotti);
      const [txA] = await focusTx(anya);
      assert.equal(txL.xp, 100);
      assert.equal(txA.xp, 50, 'качество 0.5 → 50 XP');
      assert.equal(txA.coins, 10);
      const sess = (await anya.get('/api/users/me/sessions')).body.sessions[0];
      assert.equal(sess.status, 'completed');
      assert.equal((await roomOf(L)).challenge.points, 1, 'Аня не засчитана, но Лотти — половина команды');
    } finally { await w.close(); }
  });

  test('обрыв связи сервер видит сам: участник без heartbeat 20 с теряет качество', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      const [lotti, anya] = L.users;
      await lotti.post(L.path('/start'));
      await w.advance(5 * 60_000, L.users);
      await w.advance(25_000, [lotti]); // Аня пропала на 25 с (< grace 30 с — сессия не прервана)
      await w.advance(20 * 60_000 + 1000, L.users);
      const [txA] = await focusTx(anya);
      assert.ok(txA.xp < 100 && txA.xp >= 97, `xp ${txA.xp}`);
      assert.equal((await focusTx(lotti))[0].xp, 100);
    } finally { await w.close(); }
  });

  test('клиент не может повысить качество: «back» без «away» и вне сессии ничего не меняют', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Хост']);
      assert.equal((await L.host.post(L.path('/session/attention'), { state: 'back' })).body.tracked, false, 'вне сессии');
      assert.equal((await L.host.post(L.path('/session/attention'), { state: 'focus' })).body.error.code, 'INVALID_FIELD');
      await L.host.post(L.path('/start'));
      await L.host.post(L.path('/session/attention'), { state: 'back' });
      await w.advance(25 * 60_000 + 1000, L.users);
      assert.equal((await focusTx(L.host))[0].xp, 100);
    } finally { await w.close(); }
  });
});

describe('шутки — командные дебаффы соперника, выключить нельзя', () => {
  async function teamsOnBreak(w) {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря', 'Вика'], { teamMode: true });
    const r = await roomOf(L);
    const team = (u) => r.members.find((m) => m.userId === u.id).team;
    const A = L.users.filter((u) => team(u) === 'A');
    const B = L.users.filter((u) => team(u) === 'B');
    await runFocus(w, L);
    return { L, A, B };
  }

  test('своей команде шутку не отправить; сопернику — да; отключивший шутки (§5.5) целью не бывает и сам не шлёт', async () => {
    const w = await boot();
    try {
      const { L, A, B } = await teamsOnBreak(w);
      assert.equal((await A[0].post(L.path('/social/prank'), { type: 'fog', targetUserId: A[1].id })).body.error.code, 'NOT_RIVAL');
      await B[1].patch('/api/users/me', { prankEnabled: false });
      assert.equal((await A[0].post(L.path('/social/prank'), { type: 'fog', targetUserId: B[1].id })).body.error.code, 'PRANKS_DISABLED');
      assert.equal((await B[1].post(L.path('/social/prank'), { type: 'fog', targetUserId: A[0].id })).body.error.code, 'PRANKS_DISABLED_SELF');
      const sent = await A[0].post(L.path('/social/prank'), { type: 'fog', targetUserId: B[0].id });
      assert.equal(sent.status, 201);
      assert.equal(sent.body.team, 'B');
      assert.deepEqual(sent.body.debuff, { rangeMult: 0.6 });
      assert.ok(sent.body.effectEndsAt <= (await roomOf(L)).room.phaseEndsAt, 'эффект не дольше перерыва');
    } finally { await w.close(); }
  });

  test('щит любого игрока команды поглощает шутку', async () => {
    const w = await boot();
    try {
      const { L, A, B } = await teamsOnBreak(w);
      // монеты на щит у B[0] есть после фокуса; щит получает напарник B[1]
      assert.equal((await B[0].post(L.path('/social/help'), { type: 'shield', targetUserId: B[1].id })).status, 201);
      const sent = await A[0].post(L.path('/social/prank'), { type: 'sticker', targetUserId: B[0].id });
      assert.equal(sent.body.blocked, true);
      assert.equal(sent.body.applied, false);
    } finally { await w.close(); }
  });

  test('дебафф виден в раунде Tower Defense команды-цели', async () => {
    const w = await boot();
    try {
      const { L, A, B } = await teamsOnBreak(w);
      await B[0].post(L.path('/td/build'), { slot: 's1', type: 'arrow', requestId: 'req-debuff-b-0001' });
      assert.equal((await B[0].post(L.path('/td/start'), { stageId: 'camp' })).status, 200);
      await A[0].post(L.path('/social/prank'), { type: 'fog', targetUserId: B[1].id });
      const view = (await B[0].get(L.path('/td'))).body;
      assert.equal(view.round.debuffs.length, 1);
      assert.equal(view.round.debuffs[0].type, 'fog');
      const rival = (await A[0].get(L.path('/td'))).body;
      assert.equal(rival.round, null, 'у команды A своего раунда нет — и дебаффа тоже');
    } finally { await w.close(); }
  });

  test('шутки только на перерыве', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня'], { teamMode: true });
      await L.host.post(L.path('/start'));
      assert.equal((await L.host.post(L.path('/social/prank'), { type: 'fog', targetUserId: L.rest[0].id })).body.error.code, 'WRONG_PHASE');
    } finally { await w.close(); }
  });
});

describe('движок: дебаффы башен', () => {
  const st = TD.stages.find((s) => s.id === 'camp');
  const towers = [{ slot: 's1', type: 'arrow', level: 1 }, { slot: 's3', type: 'arrow', level: 1 }];
  const play = (debuffs) => {
    const state = newState(st, 100);
    advanceTo(state, { stage: st, schedule: buildSchedule(st), towers, damageMult: 1, debuffs }, 400);
    return state;
  };

  test('туман и липучка ослабляют оборону только в своё окно игрового времени', () => {
    const clean = play([]);
    const fog = play([{ from: 0, until: 400, rangeMult: 0.6 }]);
    const sticky = play([{ from: 0, until: 400, cooldownMult: 2 }]);
    const outside = play([{ from: 390, until: 400, rangeMult: 0.1, cooldownMult: 10 }]);
    assert.ok(fog.hp < clean.hp || fog.kills < clean.kills, 'туман ослабил');
    assert.ok(sticky.hp < clean.hp || sticky.kills < clean.kills, 'липучка ослабила');
    assert.deepEqual([outside.hp, outside.kills, outside.status], [clean.hp, clean.kills, clean.status], 'вне окна — без эффекта');
  });
});
