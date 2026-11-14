import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

let rid = 0;
const R = () => `war-${String(++rid).padStart(8, '0')}`;
const td = async (L, u = L.host) => (await u.get(L.path('/td'))).body;
const post = (L, u, p, b) => u.post(L.path(`/td/${p}`), b);
const build = (L, u, slotId, type = 'arrow', requestId = R()) => post(L, u, 'build', { slotId, type, requestId });
const send = (L, u, type, requestId = R()) => post(L, u, 'send-unit', { type, requestId });
const cast = (L, u, spell, requestId = R()) => post(L, u, 'spell', { spell, requestId });
const setTreasury = (w, L, team, coins) => w.app.db.run('UPDATE team_progress SET treasury_coins = ? WHERE room_id = ? AND team_key = ?', coins, L.room.id, team);
const treasuryRaw = (w, L, team) => w.app.db.get('SELECT treasury_coins c FROM team_progress WHERE room_id = ? AND team_key = ?', L.room.id, team).c;
const solid = (w, L) => w.advance(70_000, L.users);
async function onBreak(w, names, settings = {}) {
  const L = await lobby(w, names, settings);
  await runFocus(w, L);
  return L;
}
/**
 * Командная комната на перерыве после цикла 1: A (защита) — Лотти, B (атака) — Аня и Боря.
 * У каждой команды 100 монет в казне.
 */
async function teams(w) {
  const L = await onBreak(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true });
  const [lotti, anya, boris] = L.users;
  w.app.db.run("UPDATE room_members SET team_key = 'B' WHERE room_id = ? AND user_id = ?", L.room.id, boris.id);
  setTreasury(w, L, 'A', 100);
  setTreasury(w, L, 'B', 100);
  return { L, lotti, anya, boris };
}

describe('Tower Wars: каталог в TdView', () => {
  test('view: казна, наёмники, заклинания, кулдаун, роли, соперник', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      const v = await td(L, lotti);
      assert.equal(v.treasuryCoins, 100);
      assert.deepEqual(v.mercenaries.map((m) => m.id), ['cherry', 'ripe', 'armored', 'king']);
      assert.deepEqual(Object.keys(v.mercenaries[0]).sort(), ['armor', 'cost', 'damage', 'description', 'hp', 'id', 'speed', 'title']);
      assert.deepEqual(v.spells.map((s) => [s.id, s.target]), [['haste', 'self'], ['repair', 'self'], ['slow_towers', 'rival'], ['disable_tower', 'rival'], ['enrage_horde', 'rival']]);
      assert.deepEqual(Object.keys(v.spells[0]).sort(), ['cost', 'description', 'duration', 'id', 'target', 'title']);
      assert.equal(v.mercCooldownSec, 0.8);
      assert.equal(v.rematch, undefined, 'реванша нет');
      assert.deepEqual([v.role, v.defender], ['defense', 'A']);
      assert.deepEqual([(await td(L, anya)).role, (await td(L, anya)).defender], ['attack', 'A']);
      assert.deepEqual([v.rival.team, v.rival.towers, v.rival.towerList, v.rival.treasuryCoins, v.rival.round], ['B', 0, [], 100, null]);
      assert.equal(v.duel, null);
    } finally { await w.close(); }
  });
});

describe('Tower Wars: наёмники', () => {
  test('атака шлёт томатов на поле защиты; броня видна; кулдаун 429 на команду; после раунда — RIVAL_NOT_IN_BATTLE', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya, boris } = await teams(w);
      assert.equal((await post(L, lotti, 'start', { stageId: 'camp' })).status, 200);
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      const sent = await send(L, anya, 'armored');
      assert.equal(sent.status, 201);
      assert.deepEqual(
        [sent.body.action, sent.body.type, sent.body.cost, sent.body.target, sent.body.queued, sent.body.treasuryCoins],
        ['send_unit', 'armored', 12, 'A', false, 88],
      );
      // кулдаун — на команду, а не на игрока
      const cd = await send(L, boris, 'cherry');
      assert.equal(cd.status, 429);
      assert.equal(cd.body.error.code, 'MERC_COOLDOWN');
      assert.ok(cd.body.error.details.retryAfterMs > 0 && cd.body.error.details.retryAfterMs <= 800);
      assert.equal((await td(L, anya)).treasuryCoins, 88, 'отказ ничего не списал');
      const role = await send(L, lotti, 'cherry');
      assert.deepEqual([role.status, role.body.error.code], [403, 'WRONG_ROLE'], 'защита не шлёт томатов');

      w.clock.advance(1000);
      const a = await td(L, lotti);
      const merc = a.round.enemies.find((e) => e.type === 'armored');
      assert.ok(merc, 'бронированный томат на поле A');
      assert.deepEqual([merc.isMerc, merc.armor, merc.maxHp, merc.slowed, merc.hasted], [true, 0.25, 280, false, false]);
      assert.equal(merc.speed, 0.65);
      assert.ok(typeof merc.s === 'number' && merc.s > 0);
      const b = await td(L, anya);
      assert.equal(b.round, null, 'у атаки своего раунда нет');
      assert.ok(b.rival.round.enemies.some((e) => e.isMerc), 'B видит своих наёмников на поле A');
      assert.equal(b.me.participated, true, 'отправка наёмника — участие');
      assert.equal((await send(L, boris, 'cherry')).status, 201);
      assert.ok(events.some((e) => e.type === 'td_state' && e.data.team === 'A'), 'td_state для цели');
      assert.ok(events.some((e) => e.type === 'td_state' && e.data.team === 'B' && e.data.treasuryCoins === 88), 'td_state отправителя с казной');
      assert.ok(events.some((e) => e.type === 'td_unit_sent'));

      await solid(w, L); // у A нет башен — база пала, победила атака
      assert.equal((await td(L, lotti)).round.status, 'lost');
      assert.equal((await td(L, anya)).duel.winner, 'B');
      const late = await send(L, anya, 'ripe');
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, 'RIVAL_NOT_IN_BATTLE');
      assert.equal((await td(L, anya)).treasuryCoins, 86);
      assert.equal((await send(L, anya, 'dragon')).body.error.code, 'UNKNOWN_UNIT');
    } finally { await w.close(); }
  });

  test('раунд защиты ещё не начат: наёмники ждут и выходят на старте; повтор requestId не списывает дважды', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      const id = R();
      const first = await send(L, anya, 'ripe', id);
      assert.equal(first.status, 201);
      assert.deepEqual([first.body.target, first.body.queued, first.body.treasuryCoins], ['A', true, 95]);
      const again = await send(L, anya, 'ripe', id);
      assert.equal(again.body.replayed, true);
      assert.equal((await td(L, anya)).treasuryCoins, 95, 'повтор не списал второй раз');
      w.clock.advance(1000);
      assert.equal((await send(L, anya, 'cherry')).body.queued, true);
      assert.equal((await td(L, lotti)).round, null);

      await post(L, lotti, 'start', { stageId: 'camp' });
      w.clock.advance(1000);
      const a = await td(L, lotti);
      assert.deepEqual(a.round.enemies.filter((e) => e.isMerc).map((e) => e.type).sort(), ['cherry', 'ripe']);
      w.clock.advance(1000);
      assert.equal((await td(L, lotti)).round.enemies.filter((e) => e.isMerc).length, 2, 'доставка один раз');
    } finally { await w.close(); }
  });

  test('общий режим: подкрепление волны в свой раунд, убийство приносит cost × 1.5 в казну', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня']);
      const u = L.host;
      setTreasury(w, L, 'shared', 200);
      const none = await send(L, u, 'cherry');
      assert.equal(none.status, 409);
      assert.equal(none.body.error.code, 'NO_ACTIVE_ROUND');
      await build(L, u, 's1'); await build(L, u, 's3');
      for (const s of ['s1', 's3']) for (let i = 0; i < 2; i++) await post(L, u, 'upgrade', { slotId: s, requestId: R() });
      assert.equal((await td(L)).treasuryCoins, 200 - 30 - 60);
      await post(L, u, 'start', { stageId: 'camp' });
      const r = await send(L, L.users[1], 'cherry');
      assert.deepEqual([r.status, r.body.target, r.body.queued, r.body.treasuryCoins], [201, 'shared', false, 108]);
      await w.advance(10_000, L.users);
      assert.equal((await td(L)).treasuryCoins, 108 + 3, 'награда за убитое подкрепление (2 × 1.5 = 3)');
      await solid(w, L);
      const v = await td(L);
      assert.equal(v.round.status, 'won');
      assert.equal(v.treasuryCoins, 111, 'награда выплачена ровно один раз');
    } finally { await w.close(); }
  });
});

describe('Tower Wars: заклинания', () => {
  test('защита — свои, атака — против защиты; disable_tower бьёт самую прокачанную башню; ошибки и повтор', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      assert.deepEqual([(await cast(L, anya, 'haste')).body.error.code, (await cast(L, lotti, 'slow_towers')).body.error.code], ['WRONG_ROLE', 'WRONG_ROLE']);
      assert.equal((await cast(L, lotti, 'haste')).body.error.code, 'NO_ACTIVE_ROUND');
      assert.equal((await cast(L, anya, 'slow_towers')).body.error.code, 'RIVAL_NOT_IN_BATTLE');
      assert.equal((await cast(L, lotti, 'meteor')).body.error.code, 'UNKNOWN_SPELL');

      await post(L, lotti, 'start', { stageId: 'camp' });
      // у защиты ещё нет башен — замораживать нечего, деньги не списаны
      const nt = await cast(L, anya, 'disable_tower');
      assert.deepEqual([nt.status, nt.body.error.code], [409, 'NO_TARGET']);
      assert.equal((await td(L, anya)).treasuryCoins, 100);

      // башни можно ставить и во время раунда; s3 прокачана
      await build(L, lotti, 's1'); await build(L, lotti, 's3');
      await post(L, lotti, 'upgrade', { slotId: 's3', requestId: R() });
      setTreasury(w, L, 'A', 100);

      const hasteId = R();
      const h = await cast(L, lotti, 'haste', hasteId);
      assert.equal(h.status, 201);
      assert.deepEqual([h.body.action, h.body.spell, h.body.cost, h.body.target, h.body.treasuryCoins], ['spell', 'haste', 10, 'A', 90]);
      assert.equal((await cast(L, lotti, 'haste', hasteId)).body.replayed, true);
      let a = await td(L, lotti);
      assert.equal(a.treasuryCoins, 90, 'повтор requestId не списал второй раз');
      assert.deepEqual(a.round.effects.map((e) => [e.kind, e.factor, e.targetSlot]), [['haste', 1.35, null]]);
      const exp1 = a.round.effects[0].expiresAtGameTime;

      const s = await cast(L, anya, 'slow_towers');
      assert.equal(s.body.target, 'A');
      const d = await cast(L, anya, 'disable_tower');
      assert.equal(d.status, 201);
      assert.equal(d.body.targetSlot, 's3');
      a = await td(L, lotti);
      assert.deepEqual(a.round.effects.map((e) => [e.kind, e.targetSlot]).sort(), [['disable_tower', 's3'], ['haste', null], ['slow_towers', null]]);
      assert.deepEqual((await td(L, anya)).rival.round.effects.map((e) => e.kind).sort(), ['disable_tower', 'haste', 'slow_towers'], 'атака видит эффекты на поле защиты');

      // повтор продлевает срок, а не складывается
      w.clock.advance(2000);
      await cast(L, lotti, 'haste');
      a = await td(L, lotti);
      assert.equal(a.round.effects.filter((e) => e.kind === 'haste').length, 1);
      assert.ok(a.round.effects.find((e) => e.kind === 'haste').expiresAtGameTime > exp1);

      // нет денег — эффекта нет
      setTreasury(w, L, 'B', 5);
      assert.equal((await cast(L, anya, 'enrage_horde')).body.error.code, 'INSUFFICIENT_TEAM_FUNDS');
      assert.ok(!(await td(L, lotti)).round.effects.some((e) => e.kind === 'enrage_horde'));
      setTreasury(w, L, 'B', 50);
      assert.equal((await cast(L, anya, 'enrage_horde')).status, 201);
      w.clock.advance(500);
      const enraged = (await td(L, lotti)).round.enemies;
      assert.ok(enraged.length > 0 && enraged.every((e) => e.hasted));
    } finally { await w.close(); }
  });

  test('общий режим: заклинание на соперника — 400 NO_RIVAL; repair лечит свою базу', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти']);
      await post(L, L.host, 'start', { stageId: 'camp' });
      const r = await cast(L, L.host, 'slow_towers');
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'NO_RIVAL');
      const rep = await cast(L, L.host, 'repair');
      assert.equal(rep.status, 201);
      assert.equal(rep.body.target, 'shared');
      assert.deepEqual((await td(L)).round.effects.map((e) => [e.kind, e.factor]), [['repair', 0.3]]);
    } finally { await w.close(); }
  });
});

describe('Tower Wars: роли', () => {
  test('защита строит, атака — нет; раунд один на перерыв; база выстояла — победа защиты; реванша нет; роли меняются в следующем цикле', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya, boris } = await teams(w);
      await build(L, lotti, 's1'); await build(L, lotti, 's3');
      const nb = await build(L, anya, 's2');
      assert.deepEqual([nb.status, nb.body.error.code], [403, 'WRONG_ROLE']);
      const nu = await post(L, boris, 'upgrade', { slotId: 's1', requestId: R() });
      assert.deepEqual([nu.status, nu.body.error.code], [403, 'WRONG_ROLE']);
      assert.equal(treasuryRaw(w, L, 'B'), 100, 'отказы ничего не списали');

      // начать может и атака: раунд идёт на поле защиты
      const st = await post(L, anya, 'start', {});
      assert.equal(st.status, 200);
      assert.equal(st.body.rival.round.team, 'A');
      assert.equal((await post(L, lotti, 'start', {})).body.error.code, 'ROUND_EXISTS');
      assert.equal((await td(L, anya)).rival.towerList.length, 2, 'атака видит башни защиты');
      assert.equal((await post(L, anya, 'rematch', {})).status, 404, 'реванша нет');

      await solid(w, L);
      const a = await td(L, lotti);
      assert.equal(a.round.status, 'won');
      assert.deepEqual([a.duel.winner, a.duel.roundNo], ['A', 1]);

      // следующий цикл: защищается B
      await runBreak(w, L);
      await runFocus(w, L);
      const b2 = await td(L, anya);
      assert.deepEqual([b2.role, b2.defender, (await td(L, lotti)).role], ['defense', 'B', 'attack']);
      assert.equal((await build(L, anya, 's2')).status, 201);
      assert.equal((await build(L, lotti, 's4')).body.error.code, 'WRONG_ROLE');
    } finally { await w.close(); }
  });

  test('если команда защиты пуста, обороняется другая', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня'], { teamMode: true });
      w.app.db.run("UPDATE room_members SET team_key = 'B' WHERE room_id = ?", L.room.id);
      const v = await td(L, L.host);
      assert.deepEqual([v.team, v.role, v.defender], ['B', 'defense', 'B']);
    } finally { await w.close(); }
  });
});

describe('Tower Wars: гонки за казну', () => {
  test('~20 одновременных покупок: казна не уходит в минус, проходит ровно floor(казна / цена)', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти', 'Аня']);
      const [u, v] = L.users;
      // башни: 20 запросов на 10 мест, казна 50 → ровно 3 по 15
      setTreasury(w, L, 'shared', 50);
      const slots = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);
      const builds = await Promise.all(Array.from({ length: 20 }, (_, i) => build(L, i % 2 ? u : v, slots[i % 10])));
      assert.equal(builds.filter((r) => r.status === 201).length, Math.floor(50 / 15));
      assert.ok(builds.filter((r) => r.status !== 201).every((r) => ['INSUFFICIENT_TEAM_FUNDS', 'SLOT_TAKEN'].includes(r.body.error.code)));
      assert.equal(treasuryRaw(w, L, 'shared'), 50 - 45);
      assert.equal((await td(L)).towers.length, 3);

      // заклинания (без кулдауна): казна 35 → ровно 3 по 10
      await post(L, u, 'start', { stageId: 'camp' });
      setTreasury(w, L, 'shared', 35);
      const spells = await Promise.all(Array.from({ length: 20 }, (_, i) => cast(L, i % 2 ? u : v, 'haste')));
      assert.equal(spells.filter((r) => r.status === 201).length, 3);
      assert.ok(spells.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'INSUFFICIENT_TEAM_FUNDS'));
      assert.equal(treasuryRaw(w, L, 'shared'), 5);

      // наёмники: казна большая, но кулдаун команды пропускает ровно одного
      setTreasury(w, L, 'shared', 100);
      const units = await Promise.all(Array.from({ length: 20 }, (_, i) => send(L, i % 2 ? u : v, 'ripe')));
      assert.equal(units.filter((r) => r.status === 201).length, 1);
      assert.ok(units.filter((r) => r.status !== 201).every((r) => r.status === 429 && r.body.error.code === 'MERC_COOLDOWN'));
      assert.equal(treasuryRaw(w, L, 'shared'), 95);
      // нехватка казны на наёмника — отказ без списания
      w.clock.advance(1000);
      setTreasury(w, L, 'shared', 4);
      assert.equal((await send(L, u, 'ripe')).body.error.code, 'INSUFFICIENT_TEAM_FUNDS');
      assert.equal(treasuryRaw(w, L, 'shared'), 4);
    } finally { await w.close(); }
  });
});

describe('Tower Wars: инварианты сервера (анти-чит)', () => {
  test('цены/HP/урон от клиента игнорируются; ключи прототипа и плохие requestId отклоняются; чужую казну не потратить', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      assert.equal((await post(L, lotti, 'start', { stageId: 'camp' })).status, 200);

      // клиент присылает «свои» цену, HP, урон и цель — сервер берёт всё из каталога и из членства в команде
      const sent = await post(L, anya, 'send-unit', { type: 'king', requestId: R(), cost: 0, hp: 99999, damage: 999, target: 'B', team: 'A' });
      assert.equal(sent.status, 201);
      assert.deepEqual([sent.body.cost, sent.body.target, sent.body.treasuryCoins], [25, 'A', 75]);
      w.clock.advance(1000);
      const king = (await td(L, lotti)).round.enemies.find((e) => e.type === 'king');
      assert.equal(king.maxHp, 900, 'HP наёмника — из каталога');
      const built = await post(L, lotti, 'build', { slotId: 's1', type: 'arrow', requestId: R(), cost: 1, level: 3 });
      assert.deepEqual([built.status, built.body.cost, built.body.level, built.body.treasuryCoins], [201, 15, 1, 85]);
      assert.equal(treasuryRaw(w, L, 'B'), 75, 'казна B не тронута действиями игрока A');

      // заклинание против соперника не наложить на свою команду: цель задаёт каталог, а не клиент
      w.clock.advance(1000);
      const slow = await post(L, anya, 'spell', { spell: 'slow_towers', requestId: R(), target: 'self', team: 'B', cost: 0 });
      assert.equal(slow.status, 201);
      assert.deepEqual([slow.body.target, slow.body.cost, slow.body.treasuryCoins], ['A', 10, 65]);
      assert.ok((await td(L, lotti)).round.effects.some((e) => e.kind === 'slow_towers'), 'эффект — на поле A');
      // «свой» бафф защиты тратит казну A, а не B
      const haste = await post(L, lotti, 'spell', { spell: 'haste', requestId: R() });
      assert.deepEqual([haste.status, haste.body.target, haste.body.treasuryCoins], [201, 'A', 75]);
      assert.equal(treasuryRaw(w, L, 'B'), 65);

      // ключи прототипа и мусор вместо типа — 400, казна не меняется
      for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.equal((await post(L, lotti, 'build', { slotId: 's2', type: bad, requestId: R() })).body.error.code, 'UNKNOWN_TOWER', bad);
        assert.equal((await post(L, anya, 'send-unit', { type: bad, requestId: R() })).body.error.code, 'UNKNOWN_UNIT', bad);
        assert.equal((await post(L, lotti, 'spell', { spell: bad, requestId: R() })).body.error.code, 'UNKNOWN_SPELL', bad);
      }
      for (const type of [42, null, { id: 'king' }, ['king']]) {
        assert.equal((await post(L, anya, 'send-unit', { type, requestId: R() })).status, 400, JSON.stringify(type));
      }
      for (const requestId of [undefined, 'short', 'x'.repeat(65), 'bad id with spaces', 12345678, '../../etc']) {
        const r = await post(L, lotti, 'spell', { spell: 'haste', requestId });
        assert.equal(r.status, 400, String(requestId));
        assert.equal(r.body.error.code, 'INVALID_FIELD');
      }
      assert.equal(treasuryRaw(w, L, 'A'), 75, 'отказы ничего не списали');
    } finally { await w.close(); }
  });
});
