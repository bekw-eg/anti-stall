import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FakeClock } from '../src/clock.js';
import { boot, lobby, runFocus, tmpDbPath } from './helpers.js';

let rid = 0;
const R = () => `req-${String(++rid).padStart(8, '0')}`;
const td = async (L, u = L.host) => (await u.get(L.path('/td'))).body;
const post = (L, u, p, b) => u.post(L.path(`/td/${p}`), b);
const build = (L, u, slotId, type = 'arrow', requestId = R()) => post(L, u, 'build', { slotId, type, requestId });
const fund = (w, u, coins) => w.app.db.run('UPDATE users SET coins = coins + ? WHERE id = ?', coins, u.id);
/** Казна команды: башни, наёмники и заклинания оплачиваются из неё. */
const setTreasury = (w, L, team, coins) => w.app.db.run('UPDATE team_progress SET treasury_coins = ? WHERE room_id = ? AND team_key = ?', coins, L.room.id, team);
const treasury = async (L, u = L.host) => (await td(L, u)).treasuryCoins;
const coinsOf = async (u) => (await u.progress()).coins;
const kinds = async (u, kind) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === kind);
/** Комната, прошедшая Focus и находящаяся на перерыве. */
async function onBreak(w, names = ['Лотти', 'Аня'], settings = {}) {
  const L = await lobby(w, names, settings);
  await runFocus(w, L);
  return L;
}
const solid = (w, L) => w.advance(70_000, L.users); // лагерь проходится за ~45 игровых секунд при скорости 1×

describe('Tower Defense: доступность и права', () => {
  test('игра доступна только на перерыве: Waiting и Focus закрыты на сервере', async () => {
    const w = await boot();
    try {
      const L = await lobby(w, ['Лотти', 'Аня']);
      fund(w, L.host, 100);
      let v = await td(L);
      assert.equal(v.enabled, false);
      assert.equal(v.phase, 'waiting');
      assert.equal((await build(L, L.host, 's1')).body.error.code, 'WRONG_PHASE');
      assert.equal((await post(L, L.host, 'start', {})).body.error.code, 'WRONG_PHASE');
      assert.equal((await post(L, L.host, 'join', {})).body.error.code, 'WRONG_PHASE');

      await L.host.post(L.path('/start')); // Focus
      v = await td(L);
      assert.equal(v.enabled, false);
      for (const [p, b] of [['build', { slotId: 's1', type: 'arrow', requestId: R() }], ['start', {}], ['upgrade', { slotId: 's1', requestId: R() }]]) {
        assert.equal((await post(L, L.host, p, b)).body.error.code, 'WRONG_PHASE', p);
      }
      assert.equal(await coinsOf(L.host), 100, 'во время фокуса монеты не тратятся');

      await w.advance(25 * 60_000 + 1000, L.users); // Break
      v = await td(L);
      assert.equal(v.enabled, true);
      assert.equal(v.phase, 'break');
      assert.ok(v.breakEndsAt > v.serverTime);
      assert.equal(v.map.slots.length, 10);
      // фокус-сессии больше не двигают карту: открыт только лагерь, «Лес» откроет победа в лагере
      assert.deepEqual(v.stages.map((s) => [s.id, s.unlocked]), [['camp', true], ['forest', true], ['bridge', false], ['fortress', false]]);
      assert.deepEqual(v.towerTypes.map((t) => t.id), ['arrow', 'cannon', 'frost']);
    } finally { await w.close(); }
  });

  test('не участник комнаты и игрок в фокусе в другой комнате не могут играть', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      fund(w, L.host, 100);
      const stranger = await w.user('Чужой');
      fund(w, stranger, 100);
      assert.equal((await td(L, stranger).then(() => stranger.get(L.path('/td')))).body.error.code, 'NOT_A_MEMBER');
      assert.equal((await build(L, stranger, 's1')).body.error.code, 'NOT_A_MEMBER');
      assert.equal(await coinsOf(stranger), 100);
      // Аня уходит в фокус в другой комнате → здесь строить не может
      const guest = L.rest[0];
      fund(w, guest, 100);
      const other = (await guest.post('/api/rooms', { name: 'Другая' })).body.room;
      await guest.post(`/api/rooms/${other.id}/start`);
      assert.equal((await build(L, guest, 's1')).body.error.code, 'FOCUS_ACTIVE');
    } finally { await w.close(); }
  });
});

describe('Tower Defense: строительство и улучшение', () => {
  test('казна команды платит по каталогу; личные монеты не тратятся; нехватка, занятое и несуществующее место отклоняются', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      const [u, anya] = L.users;
      const personal = await coinsOf(u);
      // стартовый капитал 30 + монеты обеих фокус-сессий ушли в казну
      const before = await treasury(L);
      assert.equal(before, 30 + 2 * 20);
      const ok = await build(L, u, 's1', 'arrow');
      assert.equal(ok.status, 201);
      assert.deepEqual([ok.body.action, ok.body.slotId, ok.body.type, ok.body.level, ok.body.cost, ok.body.treasuryCoins], ['build', 's1', 'arrow', 1, 15, before - 15]);
      assert.equal(await treasury(L, anya), before - 15, 'казна общая для команды');
      assert.equal(await coinsOf(u), personal, 'личные монеты — только для магазина улучшений');
      assert.equal((await kinds(u, 'td_build')).length, 0);
      const v = await td(L);
      assert.deepEqual(v.towers.map((t) => [t.slot, t.type, t.level]), [['s1', 'arrow', 1]]);

      assert.equal((await build(L, u, 's1', 'cannon')).body.error.code, 'SLOT_TAKEN');
      assert.equal((await build(L, u, 's99')).body.error.code, 'INVALID_SLOT');
      assert.equal((await build(L, u, 's2', 'laser')).body.error.code, 'UNKNOWN_TOWER');
      assert.equal((await post(L, u, 'build', { slotId: 's2', type: 'arrow', requestId: 'short' })).body.error.code, 'INVALID_FIELD');
      assert.equal((await post(L, anya, 'build', { slotId: 's2', type: 'arrow', requestId: R(), cost: 0, price: -5, treasuryCoins: 9999 })).status, 201);
      assert.equal(await treasury(L), before - 30, 'цена берётся только из каталога');

      // «нет денег в казне»
      setTreasury(w, L, 'shared', 10);
      const poor = await build(L, u, 's3', 'cannon');
      assert.equal(poor.status, 409);
      assert.equal(poor.body.error.code, 'INSUFFICIENT_TEAM_FUNDS');
      assert.deepEqual(poor.body.error.details, { required: 30, treasuryCoins: 10 });
      assert.equal(await treasury(L), 10);
      assert.equal((await td(L)).towers.length, 2, 'башня не появилась');
    } finally { await w.close(); }
  });

  test('повторные и одновременные запросы: казна списывается один раз, место занимает одна башня', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      const u = L.host;
      setTreasury(w, L, 'shared', 200);
      const id = R();
      const first = await build(L, u, 's1', 'arrow', id);
      const again = await build(L, u, 's1', 'arrow', id); // тот же requestId — повтор (двойной клик, ретрай)
      assert.equal(first.status, 201);
      assert.equal(again.body.replayed, true);
      assert.equal(again.body.treasuryCoins, 185);
      assert.equal(await treasury(L), 185);

      // 8 параллельных запросов на одно место с разными requestId
      const par = await Promise.all(Array.from({ length: 8 }, () => build(L, u, 's2', 'cannon')));
      assert.equal(par.filter((r) => r.status === 201).length, 1);
      assert.ok(par.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'SLOT_TAKEN'));
      assert.equal(await treasury(L), 155);
      // 8 параллельных повторов одного requestId
      const same = R();
      const par2 = await Promise.all(Array.from({ length: 8 }, () => build(L, u, 's3', 'frost', same)));
      assert.ok(par2.every((r) => r.status === 201 || r.body.replayed));
      assert.equal(await treasury(L), 135);
      assert.equal((await td(L)).towers.length, 3);
    } finally { await w.close(); }
  });

  test('улучшение: цена по уровню из казны, максимум, устаревший уровень, нехватка монет', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      const u = L.host;
      setTreasury(w, L, 'shared', 300);
      await build(L, u, 's1', 'arrow');
      const c0 = await treasury(L);
      const up2 = await post(L, u, 'upgrade', { slotId: 's1', requestId: R(), expectedLevel: 1 });
      assert.equal(up2.status, 200);
      assert.deepEqual([up2.body.level, up2.body.cost, up2.body.treasuryCoins], [2, 12, c0 - 12]); // 15 × 0.8
      assert.equal((await post(L, u, 'upgrade', { slotId: 's1', requestId: R(), expectedLevel: 1 })).body.error.code, 'STALE_LEVEL');
      const up3 = await post(L, u, 'upgrade', { slotId: 's1', requestId: R() });
      assert.deepEqual([up3.body.level, up3.body.cost], [3, 18]); // 15 × 1.2
      assert.equal((await post(L, u, 'upgrade', { slotId: 's1', requestId: R() })).body.error.code, 'MAX_LEVEL');
      assert.equal((await post(L, u, 'upgrade', { slotId: 's2', requestId: R() })).body.error.code, 'NO_TOWER');
      assert.equal(await treasury(L), c0 - 12 - 18);
      // параллельное улучшение одним и тем же ожидаемым уровнем — проходит одно
      await build(L, u, 's2', 'cannon');
      const par = await Promise.all(Array.from({ length: 6 }, () => post(L, u, 'upgrade', { slotId: 's2', requestId: R(), expectedLevel: 1 })));
      assert.equal(par.filter((r) => r.status === 200).length, 1);
      setTreasury(w, L, 'shared', 1);
      assert.equal((await post(L, u, 'upgrade', { slotId: 's2', requestId: R() })).body.error.code, 'INSUFFICIENT_TEAM_FUNDS');
      assert.equal(await treasury(L), 1);
    } finally { await w.close(); }
  });
});

describe('Tower Defense: раунд, результат и награды', () => {
  test('победа в лагере: сервер сам ведёт раунд по времени; награда по каталогу ×1.5 — только участникам и один раз', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня', 'Боря']);
      const [lotti, anya, boris] = L.users;
      fund(w, lotti, 100); fund(w, anya, 100);
      await build(L, lotti, 's1', 'arrow');
      await build(L, anya, 's3', 'arrow');
      await post(L, boris, 'join', {}); // Боря зашёл в игру, но ничего не делает: «заход» награды не даёт
      assert.equal((await td(L, boris)).me.participated, false);
      const xp0 = [await lotti.progress(), await anya.progress(), await boris.progress()].map((p) => p.xp);
      const s = await post(L, lotti, 'start', { stageId: 'camp' });
      assert.equal(s.body.round.stageId, 'camp');
      assert.ok(s.body.round.endsAt === s.body.breakEndsAt, 'раунд ограничен перерывом');
      assert.equal(s.body.round.speed, 1);

      await w.advance(10_000, L.users);
      let v = await td(L);
      assert.equal(v.round.status, 'running');
      assert.ok(v.round.t > 5 && v.round.t < 15, `игровое время идёт по серверным часам: ${v.round.t}`);
      assert.ok(v.round.enemies.length > 0);
      assert.ok(v.round.enemies.every((e) => e.x >= 0 && e.x <= 12 && typeof e.hp === 'number'));

      await w.advance(60_000, L.users);
      v = await td(L);
      assert.equal(v.round.status, 'won');
      assert.equal(v.round.result.total, 7);
      assert.ok(v.round.result.kills >= 4);
      assert.equal(v.round.enemies.length, 0);

      const rew = await kinds(lotti, 'td_round');
      assert.equal(rew.length, 1);
      assert.deepEqual([rew[0].xp, rew[0].coins].map((x) => x > 0), [true, true]);
      assert.equal((await kinds(anya, 'td_round')).length, 1, 'строитель получает награду');
      assert.equal((await kinds(boris, 'td_round')).length, 0, 'тот, кто не участвовал, награды не получает');
      assert.equal((await boris.progress()).xp, xp0[2]);
      assert.equal((await kinds(lotti, 'td_round'))[0].xp, Math.round(8 * (0.5 + 0.5 * v.round.result.hpLeft / v.round.result.hpMax) * 1.5));
      assert.ok((await lotti.progress()).achievements.find((a) => a.id === 'td_first_win').unlocked);

      // повторные тики, запросы и новый старт ничего не начисляют
      for (let i = 0; i < 5; i++) { w.app.tick(); await td(L); }
      assert.equal((await kinds(lotti, 'td_round')).length, 1);
      assert.equal((await post(L, lotti, 'start', {})).body.error.code, 'ROUND_EXISTS');
    } finally { await w.close(); }
  });

  test('поражение без башен: награды нет, раунд закрыт; клиент не может назначить результат', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      const forged = await post(L, L.host, 'start', { stageId: 'camp', winner: 'A', status: 'won', hp: 99999, coins: 9999, result: { hpLeft: 100 } });
      assert.equal(forged.body.round.hpMax, 100);
      await w.advance(80_000, L.users);
      const v = await td(L);
      assert.equal(v.round.status, 'lost');
      assert.equal((await kinds(L.host, 'td_round')).length, 0);
      for (const p of ['finish', 'result', 'win', 'reward', 'claim']) assert.equal((await post(L, L.host, p, {})).status, 404);
    } finally { await w.close(); }
  });

  test('этапы открывает шаг команды по карте (качественный цикл), победа в бою карту не двигает', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня']); // один качественный цикл = один шаг: «Лес» открыт, «Мост» — нет
      let v = await td(L);
      assert.equal(v.stages.find((x) => x.id === 'forest').unlocked, true);
      assert.equal(v.stages.find((x) => x.id === 'bridge').unlocked, false);
      assert.equal(v.defaultStageId, 'forest');
      const before = (await L.host.get(L.path('/roadmap'))).body;
      assert.equal(before.points, 1);
      // победа в лагере не двигает карту: шаги по-прежнему 1, новых узлов нет
      await build(L, L.host, 's1', 'arrow'); await build(L, L.users[1], 's3', 'arrow');
      const s = await post(L, L.host, 'start', { stageId: 'camp' });
      assert.equal(s.body.round.stageId, 'camp');
      await solid(w, L);
      v = await td(L);
      assert.equal(v.round.status, 'won');
      const after = (await L.host.get(L.path('/roadmap'))).body;
      assert.equal(after.points, 1, 'победа в бою не добавляет шаг карты');
      assert.equal(after.positionNodeId, before.positionNodeId);
    } finally { await w.close(); }
  });

  test('поражение и истечение раунда ничего не забирают: башни, hpMax и узел остаются', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти']);
      fund(w, L.host, 100);
      await L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
      await build(L, L.host, 's1', 'frost');
      await post(L, L.host, 'start', { stageId: 'camp' });
      await w.advance(80_000, L.users);
      let v = await td(L);
      assert.equal(v.round.status, 'lost');
      assert.equal(v.round.hpMax, 125);
      assert.deepEqual(v.towers.map((t) => t.slot), ['s1']);
      assert.equal((await L.host.get(L.path('/roadmap'))).body.points, 1, 'поражение не меняет шаг карты (он дан циклом)');
      // следующий перерыв: всё на месте
      await w.advance(4 * 60_000, L.users);
      await runFocus(w, L);
      v = await td(L);
      assert.equal(v.base.hpMax, 125);
      assert.deepEqual(v.towers.map((t) => [t.slot, t.level]), [['s1', 1]]);
      assert.equal(v.stages.find((x) => x.id === 'forest').unlocked, true, 'Лес открыт шагом первого цикла и не закрывается поражением');
    } finally { await w.close(); }
  });

  test('перерыв закончился: раунд закрывается как expired, награды нет, учёба продолжается; башни остаются', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      fund(w, L.host, 100);
      await build(L, L.host, 's1', 'arrow');
      await post(L, L.host, 'start', { stageId: 'camp' });
      w.app.db.run("UPDATE td_rounds SET speed = 0.05 WHERE status = 'running'"); // раунд заведомо не успевает
      await w.advance(4 * 60_000, L.users);
      assert.equal((await td(L)).round.status, 'running');
      await w.advance(70_000, L.users); // перерыв закончился
      const room = (await L.host.get(L.path())).body.room;
      assert.equal(room.phase, 'focus', 'учёба продолжается: следующий фокус плана стартовал сам');
      assert.equal(room.cycleNo, 2);
      const v = await td(L);
      assert.equal(v.enabled, false);
      assert.equal(v.round.status, 'expired');
      assert.equal((await kinds(L.host, 'td_round')).length, 0);
      assert.equal(v.towers.length, 1, 'башни сохранились');
    } finally { await w.close(); }
  });

  test('host пропускает перерыв и закрывает комнату: раунд корректно завершается', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      await post(L, L.host, 'start', { stageId: 'camp' });
      await w.advance(5_000, L.users);
      await L.host.post(L.path('/skip-break'));
      assert.equal((await td(L)).round.status, 'expired');

      const L2 = await onBreak(w);
      await post(L2, L2.host, 'start', {});
      await L2.host.post(L2.path('/close'));
      assert.equal((await td(L2)).round.status, 'expired');
    } finally { await w.close(); }
  });

  test('суточный потолок наград за игру', async () => {
    const w = await boot({ config: { economy: { td: { dailyRewardedRounds: 1 } } } });
    try {
      const L = await onBreak(w, ['Лотти']);
      const u = L.host;
      fund(w, u, 300);
      await build(L, u, 's1', 'arrow'); await build(L, u, 's3', 'arrow');
      await post(L, u, 'start', { stageId: 'camp' });
      await solid(w, L);
      assert.equal((await td(L)).round.status, 'won');
      assert.equal((await kinds(u, 'td_round')).length, 1);
      // следующий перерыв: победа есть, а награды сверх потолка — нет
      await w.advance(5 * 60_000, L.users);
      await runFocus(w, L);
      await post(L, u, 'start', { stageId: 'camp' });
      await solid(w, L);
      assert.equal((await td(L)).round.status, 'won');
      assert.equal((await kinds(u, 'td_round')).length, 1);
    } finally { await w.close(); }
  });

  test('улучшения игроков усиливают игру: «Крепкие стены» увеличивают здоровье базы', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      assert.equal((await td(L)).base.hpMax, 100);
      fund(w, L.host, 100);
      await L.host.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
      const v = await td(L);
      assert.equal(v.base.hpMax, 125);
      assert.equal(v.base.wallLevels, 1);
      const s = await post(L, L.host, 'start', { stageId: 'camp' });
      assert.equal(s.body.round.hpMax, 125);
    } finally { await w.close(); }
  });

  test('короткий перерыв: игра ускоряется, чтобы раунд уложился, а совсем поздний старт отклоняется', async () => {
    const w = await boot({ env: { TOMATO_DEMO: '1' } });
    try {
      const L = await lobby(w, ['Лотти', 'Аня'], { demo: true, focusSeconds: 25, breakSeconds: 20, focusMinutes: undefined, breakMinutes: undefined });
      await L.host.post(L.path('/start'));
      await w.advance(26_000, L.users);
      assert.equal((await td(L)).enabled, true);
      fund(w, L.host, 100);
      await build(L, L.host, 's1', 'arrow'); await build(L, L.host, 's3', 'arrow');
      const s = await post(L, L.host, 'start', { stageId: 'camp' });
      assert.ok(s.body.round.speed > 1, `ускорение ${s.body.round.speed}`);
      await w.advance(15_000, L.users);
      assert.equal((await td(L)).round.status, 'won', 'раунд завершился внутри короткого перерыва');

      const L2 = await lobby(w, ['Ночь'], { demo: true, focusSeconds: 25, breakSeconds: 20, focusMinutes: undefined, breakMinutes: undefined });
      await L2.host.post(L2.path('/start'));
      await w.advance(26_000 + 16_000, L2.users); // до конца перерыва ~4 с
      assert.equal((await post(L2, L2.host, 'start', {})).body.error.code, 'TOO_LATE');
    } finally { await w.close(); }
  });
});

describe('Tower Defense: перезапуск и WebSocket', () => {
  test('перезапуск backend посреди раунда: башни и раунд сохранены, результат и награда те же, без повторов', async () => {
    const dbPath = tmpDbPath();
    const clock = new FakeClock();
    let w = await boot({ dbPath, clock });
    const L = await onBreak(w, ['Лотти', 'Аня']);
    fund(w, L.host, 100);
    await build(L, L.host, 's1', 'arrow'); await build(L, L.host, 's3', 'arrow');
    await post(L, L.host, 'start', { stageId: 'camp' });
    await w.advance(15_000, L.users);
    const tokens = L.users.map((u) => u.token);
    const mid = (await w.call('GET', L.path('/td'), undefined, tokens[0])).body;
    await w.close();

    w = await boot({ dbPath, clock });
    const alive = tokens.map((token) => ({ post: (p, b = {}) => w.call('POST', p, b, token) }));
    const resumed = (await w.call('GET', L.path('/td'), undefined, tokens[1])).body;
    assert.equal(resumed.round.status, 'running');
    assert.deepEqual(resumed.towers.map((t) => t.slot), ['s1', 's3']);
    assert.equal(resumed.round.t, mid.round.t, 'симуляция продолжается с того же места');
    await w.advance(60_000, alive);
    const done = (await w.call('GET', L.path('/td'), undefined, tokens[0])).body;
    assert.equal(done.round.status, 'won');
    const tx = (await w.call('GET', '/api/users/me/transactions?limit=100', undefined, tokens[0])).body.transactions;
    assert.equal(tx.filter((t) => t.kind === 'td_round').length, 1);
    for (let i = 0; i < 3; i++) w.app.tick();
    assert.equal((await w.call('GET', '/api/users/me/transactions?limit=100', undefined, tokens[0])).body.transactions.filter((t) => t.kind === 'td_round').length, 1);
    await w.close();
  });

  test('WebSocket: td_state во время раунда, td_round_finished и reward_granted', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w);
      fund(w, L.host, 100);
      const c = w.ws(L.rest[0].token);
      await c.connect();
      c.send({ type: 'subscribe', roomId: L.room.id });
      await c.wait((m) => m.type === 'room_state');
      await build(L, L.host, 's1', 'arrow'); await build(L, L.host, 's3', 'arrow');
      await c.wait((m) => m.type === 'td_tower_built');
      await post(L, L.host, 'start', { stageId: 'camp' });
      await c.wait((m) => m.type === 'td_round_started');
      await w.advance(10_000, L.users);
      const st = await c.wait((m) => m.type === 'td_state' && m.data.round?.enemies.length > 0);
      assert.equal(st.data.round.status, 'running');
      await solid(w, L);
      const fin = await c.wait((m) => m.type === 'td_round_finished');
      assert.equal(fin.data.status, 'won');
      c.close();
    } finally { await w.close(); }
  });
});

describe('Tower Defense: командный режим Team A / Team B', () => {
  test('у команд свои башни, раунды и этапы; победитель дуэли награждается один раз', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true }); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      fund(w, lotti, 100); fund(w, anya, 100); fund(w, boris, 100);
      const events = [];
      w.app.db.sink = (e) => events.push(...e);

      assert.equal((await td(L, anya)).team, 'B');
      await build(L, lotti, 's1', 'arrow'); await build(L, boris, 's3', 'arrow'); // A обороняется
      // у B башен нет; башни A не видны как башни B
      assert.equal((await td(L, anya)).towers.length, 0);
      assert.equal((await td(L, lotti)).towers.length, 2);

      await post(L, lotti, 'start', { stageId: 'camp' });
      await post(L, anya, 'start', { stageId: 'camp' });
      assert.equal((await post(L, boris, 'start', {})).body.error.code, 'ROUND_EXISTS', 'у команды один раунд за перерыв');
      const rivalView = (await td(L, anya)).rival;
      assert.equal(rivalView.team, 'A');
      assert.equal(rivalView.towers, 2);

      await solid(w, L);
      const a = await td(L, lotti), b = await td(L, anya);
      assert.equal(a.round.status, 'won');
      assert.equal(b.round.status, 'lost');
      assert.equal(a.duel.winner, 'A');
      assert.deepEqual(a.duel, b.duel);
      assert.equal((await kinds(lotti, 'td_duel')).length, 1);
      assert.equal((await kinds(boris, 'td_duel')).length, 1);
      assert.equal((await kinds(anya, 'td_duel')).length, 0);
      assert.equal(events.filter((e) => e.type === 'td_duel_result').length, 1);
      for (let i = 0; i < 4; i++) w.app.tick();
      assert.equal((await kinds(lotti, 'td_duel')).length, 1);
    } finally { await w.close(); }
  });

  test('награда за дуэль подчиняется суточному потолку игровых наград (как раунды)', async () => {
    const w = await boot({ config: { economy: { td: { dailyRewardedRounds: 0 } } } });
    try {
      const L = await onBreak(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true }); // A: Лотти, Боря; B: Аня
      const [lotti, anya, boris] = L.users;
      fund(w, lotti, 100); fund(w, boris, 100);
      await build(L, lotti, 's1', 'arrow'); await build(L, boris, 's3', 'arrow');
      await post(L, lotti, 'start', { stageId: 'camp' });
      await post(L, anya, 'start', { stageId: 'camp' });
      await solid(w, L);
      assert.equal((await td(L, lotti)).duel.winner, 'A', 'дуэль решена');
      for (const u of [lotti, boris]) {
        assert.equal((await kinds(u, 'td_round')).length, 0);
        assert.equal((await kinds(u, 'td_duel')).length, 0, `${u.name}: потолок исчерпан — бонуса за дуэль нет`);
      }
    } finally { await w.close(); }
  });

  test('ничья без наград при двух поражениях; реванш идёт на том же шаге карты', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true }); // A: Лотти, Боря; B: Аня
      const [lotti, anya] = L.users;
      await post(L, lotti, 'start', { stageId: 'camp' });
      await post(L, anya, 'start', { stageId: 'camp' });
      await solid(w, L);
      const d1 = await td(L, lotti);
      assert.equal(d1.duel.winner, 'draw'); // обе без башен — обе проиграли
      assert.equal(d1.duel.roundNo, 1);
      assert.equal(d1.rematch.bonusTeam, null, 'при ничьей «Контратаки» нет');
      assert.equal((await kinds(lotti, 'td_duel')).length + (await kinds(anya, 'td_duel')).length, 0);
      // реванш: A строится и выигрывает лагерь, B снова без башен
      const tA = await treasury(L, lotti);
      assert.equal((await post(L, lotti, 'rematch', {})).status, 200);
      assert.equal(await treasury(L, lotti), tA, 'без бонуса');
      await build(L, lotti, 's1', 'arrow'); await build(L, lotti, 's3', 'arrow');
      await solid(w, L);
      const a = await td(L, lotti), b = await td(L, anya);
      assert.deepEqual([a.round.roundNo, a.round.status, b.round.roundNo, b.round.status], [2, 'won', 2, 'lost']);
      assert.equal(a.stages.find((s) => s.id === 'forest').unlocked, true);
      assert.equal(b.stages.find((s) => s.id === 'forest').unlocked, true, 'каждая команда сделала шаг качественным циклом');
      assert.deepEqual([a.duel.roundNo, a.duel.winner], [2, 'A']);
      assert.equal((await kinds(lotti, 'td_duel')).length, 1);
    } finally { await w.close(); }
  });
});
