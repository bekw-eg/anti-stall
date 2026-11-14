import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { boot, lobby, runFocus } from './helpers.js';

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
/** Командная комната на перерыве: A — Лотти и Боря, B — Аня; у каждой команды 100 монет в казне. */
async function teams(w) {
  const L = await onBreak(w, ['Лотти', 'Аня', 'Боря'], { teamMode: true });
  setTreasury(w, L, 'A', 100);
  setTreasury(w, L, 'B', 100);
  const [lotti, anya, boris] = L.users;
  return { L, lotti, anya, boris };
}

describe('Tower Wars: каталог в TdView', () => {
  test('view: казна, наёмники, заклинания, кулдаун, реванш, соперник', async () => {
    const w = await boot();
    try {
      const { L, lotti } = await teams(w);
      const v = await td(L, lotti);
      assert.equal(v.treasuryCoins, 100);
      assert.deepEqual(v.mercenaries.map((m) => m.id), ['cherry', 'ripe', 'armored', 'king']);
      assert.deepEqual(Object.keys(v.mercenaries[0]).sort(), ['armor', 'cost', 'damage', 'description', 'hp', 'id', 'speed', 'title']);
      assert.deepEqual(v.spells.map((s) => [s.id, s.target]), [['haste', 'self'], ['repair', 'self'], ['slow_towers', 'rival'], ['disable_tower', 'rival'], ['enrage_horde', 'rival']]);
      assert.deepEqual(Object.keys(v.spells[0]).sort(), ['cost', 'description', 'duration', 'id', 'target', 'title']);
      assert.equal(v.mercCooldownSec, 0.8);
      assert.deepEqual(v.rematch, { available: false, reason: 'Сначала сыграйте раунд 1', roundNo: 0, counterattackCoins: 40, bonusTeam: null });
      assert.deepEqual([v.rival.team, v.rival.towers, v.rival.treasuryCoins, v.rival.round], ['B', 0, 100, null]);
      assert.equal(v.duel, null);
    } finally { await w.close(); }
  });
});

describe('Tower Wars: наёмники', () => {
  test('сразу в идущий раунд соперника; броня видна; кулдаун 429; после раунда соперника — RIVAL_NOT_IN_BATTLE', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya, boris } = await teams(w);
      assert.equal((await post(L, anya, 'start', { stageId: 'camp' })).status, 200);
      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      const sent = await send(L, lotti, 'armored');
      assert.equal(sent.status, 201);
      assert.deepEqual(
        [sent.body.action, sent.body.type, sent.body.cost, sent.body.target, sent.body.queued, sent.body.treasuryCoins],
        ['send_unit', 'armored', 12, 'B', false, 88],
      );
      // кулдаун — на команду, а не на игрока
      const cd = await send(L, boris, 'cherry');
      assert.equal(cd.status, 429);
      assert.equal(cd.body.error.code, 'MERC_COOLDOWN');
      assert.ok(cd.body.error.details.retryAfterMs > 0 && cd.body.error.details.retryAfterMs <= 800);
      assert.equal((await td(L, lotti)).treasuryCoins, 88, 'отказ ничего не списал');
      assert.equal((await send(L, anya, 'cherry')).status, 201, 'у другой команды свой кулдаун');

      w.clock.advance(1000);
      const b = await td(L, anya);
      const merc = b.round.enemies.find((e) => e.type === 'armored');
      assert.ok(merc, 'бронированный томат на поле B');
      assert.deepEqual([merc.isMerc, merc.armor, merc.maxHp, merc.slowed, merc.hasted], [true, 0.25, 280, false, false]);
      assert.equal(merc.speed, 0.65);
      assert.ok(typeof merc.s === 'number' && merc.s > 0);
      const a = await td(L, lotti);
      assert.ok(a.rival.round.enemies.some((e) => e.isMerc), 'A видит своих наёмников на поле B');
      assert.equal(a.me.participated, true, 'отправка наёмника — участие');
      assert.equal((await send(L, boris, 'cherry')).status, 201);
      assert.ok(events.some((e) => e.type === 'td_state' && e.data.team === 'B'), 'td_state для цели');
      assert.ok(events.some((e) => e.type === 'td_state' && e.data.team === 'A' && e.data.treasuryCoins === 88), 'td_state отправителя с казной');
      assert.ok(events.some((e) => e.type === 'td_unit_sent'));

      await solid(w, L); // у B нет башен — раунд проигран
      assert.equal((await td(L, anya)).round.status, 'lost');
      const late = await send(L, lotti, 'ripe');
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, 'RIVAL_NOT_IN_BATTLE');
      assert.equal((await td(L, lotti)).treasuryCoins, 86);
      assert.equal((await send(L, lotti, 'dragon')).body.error.code, 'UNKNOWN_UNIT');
    } finally { await w.close(); }
  });

  test('у соперника ещё нет раунда: наёмники ждут и выходят, когда он стартует; повтор requestId не списывает дважды', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      const id = R();
      const first = await send(L, lotti, 'ripe', id);
      assert.equal(first.status, 201);
      assert.deepEqual([first.body.target, first.body.queued, first.body.treasuryCoins], ['B', true, 95]);
      const again = await send(L, lotti, 'ripe', id);
      assert.equal(again.body.replayed, true);
      assert.equal((await td(L, lotti)).treasuryCoins, 95, 'повтор не списал второй раз');
      w.clock.advance(1000);
      assert.equal((await send(L, lotti, 'cherry')).body.queued, true);
      assert.equal((await td(L, anya)).round, null);

      await post(L, anya, 'start', { stageId: 'camp' });
      w.clock.advance(1000);
      const b = await td(L, anya);
      assert.deepEqual(b.round.enemies.filter((e) => e.isMerc).map((e) => e.type).sort(), ['cherry', 'ripe']);
      // доставка один раз: повторный старт невозможен, а новые запросы не возвращают уже доставленных
      w.clock.advance(1000);
      assert.equal((await td(L, anya)).round.enemies.filter((e) => e.isMerc).length, 2);
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
  test('haste/slow_towers видны в эффектах, disable_tower бьёт самую прокачанную башню, ошибки и повтор', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      assert.equal((await cast(L, lotti, 'haste')).body.error.code, 'NO_ACTIVE_ROUND');
      assert.equal((await cast(L, lotti, 'slow_towers')).body.error.code, 'RIVAL_NOT_IN_BATTLE');
      assert.equal((await cast(L, lotti, 'meteor')).body.error.code, 'UNKNOWN_SPELL');
      // у B две башни, s3 прокачана
      await build(L, anya, 's1'); await build(L, anya, 's3');
      await post(L, anya, 'upgrade', { slotId: 's3', requestId: R() });
      setTreasury(w, L, 'B', 100);
      await post(L, lotti, 'start', { stageId: 'camp' });
      await post(L, anya, 'start', { stageId: 'camp' });

      const hasteId = R();
      const h = await cast(L, lotti, 'haste', hasteId);
      assert.equal(h.status, 201);
      assert.deepEqual([h.body.action, h.body.spell, h.body.cost, h.body.target, h.body.treasuryCoins], ['spell', 'haste', 10, 'A', 90]);
      assert.equal((await cast(L, lotti, 'haste', hasteId)).body.replayed, true);
      let a = await td(L, lotti);
      assert.equal(a.treasuryCoins, 90, 'повтор requestId не списал второй раз');
      assert.deepEqual(a.round.effects.map((e) => [e.kind, e.factor, e.targetSlot]), [['haste', 1.35, null]]);
      const exp1 = a.round.effects[0].expiresAtGameTime;

      const s = await cast(L, lotti, 'slow_towers');
      assert.equal(s.body.target, 'B');
      const d = await cast(L, lotti, 'disable_tower');
      assert.equal(d.status, 201);
      assert.equal(d.body.targetSlot, 's3');
      const b = await td(L, anya);
      assert.deepEqual(b.round.effects.map((e) => [e.kind, e.targetSlot]).sort(), [['disable_tower', 's3'], ['slow_towers', null]]);
      a = await td(L, lotti);
      assert.deepEqual(a.rival.round.effects.map((e) => e.kind).sort(), ['disable_tower', 'slow_towers'], 'эффекты на поле соперника видны');

      // повтор продлевает срок, а не складывается
      w.clock.advance(2000);
      await cast(L, lotti, 'haste');
      a = await td(L, lotti);
      assert.equal(a.round.effects.filter((e) => e.kind === 'haste').length, 1);
      assert.ok(a.round.effects[0].expiresAtGameTime > exp1);

      // у A башен нет — замораживать нечего, деньги не списаны
      const before = (await td(L, anya)).treasuryCoins;
      const nt = await cast(L, anya, 'disable_tower');
      assert.equal(nt.status, 409);
      assert.equal(nt.body.error.code, 'NO_TARGET');
      assert.equal((await td(L, anya)).treasuryCoins, before);

      // нет денег — эффекта нет
      setTreasury(w, L, 'A', 5);
      assert.equal((await cast(L, lotti, 'enrage_horde')).body.error.code, 'INSUFFICIENT_TEAM_FUNDS');
      assert.ok(!(await td(L, anya)).round.effects.some((e) => e.kind === 'enrage_horde'));
      setTreasury(w, L, 'A', 50);
      assert.equal((await cast(L, lotti, 'enrage_horde')).status, 201);
      w.clock.advance(500);
      const enraged = (await td(L, anya)).round.enemies;
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

describe('Tower Wars: реванш', () => {
  test('раунд 2 в том же перерыве: «Контратака» проигравшей команде один раз, REMATCH_USED, отдельная дуэль раунда 2', async () => {
    const w = await boot();
    try {
      const { L, lotti, anya } = await teams(w);
      await build(L, lotti, 's1'); await build(L, lotti, 's3');
      await post(L, lotti, 'start', { stageId: 'camp' });
      await post(L, anya, 'start', { stageId: 'camp' });
      const early = await post(L, anya, 'rematch', {});
      assert.equal(early.status, 409);
      assert.equal(early.body.error.code, 'ROUND_IN_PROGRESS');
      assert.equal((await td(L, anya)).rematch.available, false);

      await solid(w, L);
      let b = await td(L, anya);
      assert.deepEqual([b.duel.roundNo, b.duel.winner], [1, 'A']);
      assert.deepEqual(b.rematch, { available: true, reason: null, roundNo: 1, counterattackCoins: 40, bonusTeam: 'B' });
      const tB = b.treasuryCoins;
      const tA = (await td(L, lotti)).treasuryCoins;

      const events = [];
      w.app.db.sink = (e) => events.push(...e);
      const re = await post(L, anya, 'rematch', {});
      assert.equal(re.status, 200);
      assert.equal(re.body.round.roundNo, 2);
      assert.equal(re.body.round.status, 'running');
      assert.equal(re.body.round.stageId, 'camp');
      assert.equal(re.body.treasuryCoins, tB + 40, 'проигравшие получили «Контратаку»');
      assert.equal((await td(L, lotti)).treasuryCoins, tA);
      const a = await td(L, lotti);
      assert.deepEqual([a.round.roundNo, a.round.stageId], [2, 'forest'], 'победители играют следующий открытый этап');
      const started = events.find((e) => e.type === 'td_rematch_started');
      assert.deepEqual(
        { roundNo: started.data.roundNo, bonusTeam: started.data.bonusTeam, counterattackCoins: started.data.counterattackCoins, startedBy: started.data.startedBy },
        { roundNo: 2, bonusTeam: 'B', counterattackCoins: 40, startedBy: anya.id },
      );
      assert.ok(events.some((e) => e.type === 'td_state' && e.data.team === 'A') && events.some((e) => e.type === 'td_state' && e.data.team === 'B'));

      const again = await post(L, lotti, 'rematch', {});
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'REMATCH_USED');
      assert.equal((await post(L, lotti, 'start', {})).body.error.code, 'ROUND_EXISTS', 'start создаёт только раунд 1');
      b = await td(L, anya);
      assert.equal(b.rematch.reason, 'Реванш в этом перерыве уже был');
      assert.equal(b.rematch.roundNo, 2);
      assert.equal(b.me.participated, true);

      await solid(w, L);
      b = await td(L, anya);
      assert.equal(b.round.status !== 'running', true);
      assert.equal(b.duel.roundNo, 2, 'показывается последняя дуэль перерыва');
      const duels = w.app.db.all('SELECT round_no FROM td_duels WHERE room_id = ? ORDER BY round_no', L.room.id).map((r) => r.round_no);
      assert.deepEqual(duels, [1, 2]);
      assert.equal(b.treasuryCoins, tB + 40, 'бонус выдан один раз');
    } finally { await w.close(); }
  });

  test('общий режим: реванш после раунда 1 без бонуса; поздний реванш — TOO_LATE', async () => {
    const w = await boot();
    try {
      const L = await onBreak(w, ['Лотти']);
      await post(L, L.host, 'start', { stageId: 'camp' });
      await solid(w, L);
      const re = await post(L, L.host, 'rematch', { stageId: 'camp' });
      assert.equal(re.status, 200);
      assert.equal(re.body.round.roundNo, 2);
      assert.equal(re.body.rematch.bonusTeam, null);

      const L2 = await onBreak(w, ['Ночь']);
      await post(L2, L2.host, 'start', { stageId: 'camp' });
      await w.advance(4 * 60_000 + 57_000, L2.users); // до конца перерыва ~3 с
      const late = await post(L2, L2.host, 'rematch', {});
      assert.equal(late.body.error.code, 'TOO_LATE');
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
      assert.equal((await post(L, anya, 'start', { stageId: 'camp' })).status, 200);
      assert.equal((await post(L, lotti, 'start', { stageId: 'camp' })).status, 200);

      // клиент присылает «свои» цену, HP, урон и цель — сервер берёт всё из каталога и из членства в команде
      const sent = await post(L, lotti, 'send-unit', { type: 'king', requestId: R(), cost: 0, hp: 99999, damage: 999, target: 'A', team: 'B' });
      assert.equal(sent.status, 201);
      assert.deepEqual([sent.body.cost, sent.body.target, sent.body.treasuryCoins], [25, 'B', 75]);
      w.clock.advance(1000);
      const king = (await td(L, anya)).round.enemies.find((e) => e.type === 'king');
      assert.equal(king.maxHp, 900, 'HP наёмника — из каталога');
      const built = await post(L, lotti, 'build', { slotId: 's1', type: 'arrow', requestId: R(), cost: 1, level: 3 });
      assert.deepEqual([built.status, built.body.cost, built.body.level, built.body.treasuryCoins], [201, 15, 1, 60]);
      assert.equal(treasuryRaw(w, L, 'B'), 100, 'казна B не тронута действиями игрока A');

      // заклинание соперника не наложить на свою команду: цель задаёт каталог, а не клиент
      w.clock.advance(1000);
      const slow = await post(L, lotti, 'spell', { spell: 'slow_towers', requestId: R(), target: 'self', team: 'A', cost: 0 });
      assert.equal(slow.status, 201);
      assert.deepEqual([slow.body.target, slow.body.cost, slow.body.treasuryCoins], ['B', 10, 50]);
      assert.ok((await td(L, anya)).round.effects.some((e) => e.kind === 'slow_towers'), 'эффект — на поле B');
      assert.ok(!(await td(L, lotti)).round.effects.some((e) => e.kind === 'slow_towers'), 'своё поле не задето');
      // «свой» бафф игрока B тратит казну B, а не A
      const haste = await post(L, anya, 'spell', { spell: 'haste', requestId: R() });
      assert.deepEqual([haste.status, haste.body.target, haste.body.treasuryCoins], [201, 'B', 90]);
      assert.equal(treasuryRaw(w, L, 'A'), 50);

      // ключи прототипа и мусор вместо типа — 400, казна не меняется
      for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.equal((await post(L, lotti, 'build', { slotId: 's2', type: bad, requestId: R() })).body.error.code, 'UNKNOWN_TOWER', bad);
        assert.equal((await post(L, lotti, 'send-unit', { type: bad, requestId: R() })).body.error.code, 'UNKNOWN_UNIT', bad);
        assert.equal((await post(L, lotti, 'spell', { spell: bad, requestId: R() })).body.error.code, 'UNKNOWN_SPELL', bad);
      }
      for (const type of [42, null, { id: 'king' }, ['king']]) {
        assert.equal((await post(L, lotti, 'send-unit', { type, requestId: R() })).status, 400, JSON.stringify(type));
      }
      for (const requestId of [undefined, 'short', 'x'.repeat(65), 'bad id with spaces', 12345678, '../../etc']) {
        const r = await post(L, lotti, 'spell', { spell: 'haste', requestId });
        assert.equal(r.status, 400, String(requestId));
        assert.equal(r.body.error.code, 'INVALID_FIELD');
      }
      assert.equal(treasuryRaw(w, L, 'A'), 50, 'отказы ничего не списали');
    } finally { await w.close(); }
  });
});
