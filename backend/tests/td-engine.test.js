import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TD } from '../src/catalog.js';
import {
  PATH_LENGTH, SHOTS_MAX, SHOTS_WINDOW, activeEffects, advanceTo, applySpell, buildSchedule, enqueueMerc, ensureState, newState, nominalSeconds,
  pickDisableTarget, pointAt, publicEnemies, stepState, towerModifiers, towerStats,
} from '../src/td/engine.js';

const stage = (id) => TD.stages.find((s) => s.id === id);
const tw = (slot, type, level = 1) => ({ slot, type, level });
function play(stageId, towers, { hp = 100, mult = 1, until = 400 } = {}) {
  const st = stage(stageId);
  const state = newState(st, hp);
  advanceTo(state, { stage: st, schedule: buildSchedule(st), towers, damageMult: mult }, until);
  return state;
}

describe('движок Tower Defense (чистая симуляция)', () => {
  test('маршрут: точки на входе и выходе, длина маршрута', () => {
    assert.deepEqual(pointAt(0), { x: 0.5, y: 1.5 });
    assert.deepEqual(pointAt(PATH_LENGTH), { x: 11.5, y: 2.5 });
    assert.equal(PATH_LENGTH, 16);
    assert.deepEqual(pointAt(4), { x: 4.5, y: 1.5 });
    assert.deepEqual(pointAt(5.5), { x: 4.5, y: 3 });
  });

  test('расписание отсортировано, содержит все волны', () => {
    for (const s of TD.stages) {
      const sched = buildSchedule(s);
      assert.equal(sched.length, s.waves.flatMap((w) => w.groups).reduce((n, g) => n + g.count, 0));
      assert.ok(sched.every((e, i) => i === 0 || sched[i - 1].t <= e.t));
      assert.ok(nominalSeconds(s) > sched[sched.length - 1].t);
    }
  });

  test('детерминизм: один и тот же вход — тот же результат', () => {
    const towers = [tw('s1', 'arrow'), tw('s3', 'arrow'), tw('s5', 'cannon')];
    const a = play('forest', towers);
    const b = play('forest', towers);
    assert.deepEqual(a, b);
    // и пошаговая прокрутка эквивалентна прокрутке «одним махом»
    const st = stage('forest');
    const c = newState(st, 100);
    const ctx = { stage: st, schedule: buildSchedule(st), towers, damageMult: 1 };
    for (let i = 0; i < 2000 && c.status === 'running'; i++) stepState(c, ctx);
    assert.deepEqual(c, a);
  });

  test('без башен раунд проигран: «выиграть, ничего не построив» нельзя', () => {
    for (const s of TD.stages) {
      const state = play(s.id, []);
      assert.equal(state.status, 'lost', s.id);
      assert.equal(state.kills, 0);
    }
    // даже если база пережила, победа требует уничтожить хотя бы половину врагов
    const camp = play('camp', [], { hp: 1000 });
    assert.equal(camp.hp > 0, true);
    assert.equal(camp.status, 'lost');
  });

  test('башни побеждают, и каждая следующая башня не ухудшает результат', () => {
    const slots = ['s1', 's3', 's5', 's4'];
    const types = ['arrow', 'arrow', 'cannon', 'frost'];
    let prevHp = -1;
    for (let n = 0; n <= slots.length; n++) {
      const state = play('forest', slots.slice(0, n).map((s, i) => tw(s, types[i])));
      assert.ok(state.hp >= prevHp, `башен: ${n}, hp ${state.hp} < ${prevHp}`);
      prevHp = state.hp;
    }
    assert.equal(play('forest', slots.map((s, i) => tw(s, types[i]))).status, 'won');
    assert.equal(play('camp', [tw('s1', 'arrow'), tw('s3', 'arrow')]).status, 'won');
  });

  test('сложность растёт по этапам: тот же набор башен слабее на старших этапах', () => {
    const towers = [tw('s1', 'arrow'), tw('s3', 'arrow'), tw('s5', 'cannon'), tw('s4', 'frost')];
    const hp = TD.stages.map((s) => play(s.id, towers).hp);
    assert.ok(hp[0] >= hp[1] && hp[1] >= hp[2] && hp[2] >= hp[3], hp.join(','));
    assert.equal(play('fortress', towers).status, 'lost');
  });

  test('улучшение башни и множитель урона усиливают оборону', () => {
    const base = [tw('s1', 'arrow'), tw('s3', 'arrow'), tw('s5', 'cannon'), tw('s4', 'frost'), tw('s8', 'cannon'), tw('s6', 'arrow')];
    const weak = play('bridge', base.map((t) => ({ ...t })), { hp: 100 });
    const strong = play('bridge', base.map((t) => ({ ...t, level: 3 })), { hp: 100 });
    assert.ok(strong.hp >= weak.hp);
    assert.ok(towerStats('arrow', 3).damage > towerStats('arrow', 1).damage);
    assert.ok(towerStats('arrow', 1, 1.5).damage > towerStats('arrow', 1, 1).damage);
    assert.ok(towerStats('cannon', 2).range > towerStats('cannon', 1).range);
  });

  test('пушка бьёт по площади, мороз замедляет', () => {
    const st = stage('camp');
    const state = newState(st, 100);
    state.enemies = [
      { id: 1, type: 'grunt', s: 3, hp: 90, maxHp: 90, slowUntil: 0 },
      { id: 2, type: 'grunt', s: 3.4, hp: 90, maxHp: 90, slowUntil: 0 },
    ];
    state.spawned = 99;
    stepState(state, { stage: st, schedule: [], towers: [tw('s1', 'cannon')], damageMult: 1 });
    assert.equal(state.enemies.length, 2);
    assert.ok(state.enemies.every((e) => e.hp === 60), 'оба врага получили урон пушки');
    const frozen = newState(st, 100);
    frozen.enemies = [{ id: 1, type: 'grunt', s: 3, hp: 90, maxHp: 90, slowUntil: 0 }];
    frozen.spawned = 99;
    stepState(frozen, { stage: st, schedule: [], towers: [tw('s1', 'frost')], damageMult: 1 });
    assert.ok(frozen.enemies[0].slowUntil > frozen.t);
  });

  test('враг, дошедший до базы, наносит урон и исчезает; при нуле базы — поражение', () => {
    const st = stage('camp');
    const state = newState(st, 10);
    state.spawned = 99;
    state.enemies = [{ id: 1, type: 'tank', s: PATH_LENGTH - 0.01, hp: 260, maxHp: 260, slowUntil: 0 }];
    stepState(state, { stage: st, schedule: [], towers: [], damageMult: 1 });
    assert.equal(state.hp, 0);
    assert.equal(state.leaked, 1);
    assert.equal(state.status, 'lost');
    assert.equal(state.enemies.length, 0);
  });
});

// ---- Tower Wars: наёмники, заклинания, выстрелы ------------------------------------------------

const camp = () => stage('camp');
/** Пустое поле: расписание «выпущено», раунд идёт, пока на поле есть враги. */
function arena(hp = 100) {
  const state = newState(camp(), hp);
  state.spawned = 0;
  return state;
}
const ctxOf = (towers, schedule = []) => ({ stage: camp(), schedule, towers, damageMult: 1 });
const merc = (id, type, s, extra = {}) => {
  const d = TD.mercenaries[type];
  return { id, type, s, hp: d.hp, maxHp: d.hp, slowUntil: 0, isMerc: true, armor: d.armor, from: null, bounty: 0, ...extra };
};
/** Сколько выстрелов сделали башни за n шагов, если враг-«манекен» всё время стоит в зоне поражения. */
function shotsOver(state, towers, n) {
  const start = state.nextShotId;
  for (let i = 0; i < n; i++) {
    state.enemies = [{ id: 1, type: 'grunt', s: 3, hp: 1e9, maxHp: 1e9, slowUntil: 0 }];
    stepState(state, ctxOf(towers));
  }
  return state.nextShotId - start;
}

describe('Tower Wars: каталог и состояние', () => {
  test('каталог наёмников и заклинаний: поля для клиента', () => {
    assert.deepEqual(Object.keys(TD.mercenaries), ['cherry', 'ripe', 'armored', 'king']);
    assert.deepEqual(Object.keys(TD.spells), ['haste', 'repair', 'slow_towers', 'disable_tower', 'enrage_horde']);
    for (const [id, m] of Object.entries(TD.mercenaries)) {
      assert.equal(m.id, id);
      for (const k of ['cost', 'hp', 'speed', 'damage', 'armor']) assert.equal(typeof m[k], 'number', `${id}.${k}`);
      assert.ok(m.title && m.description);
    }
    for (const [id, s] of Object.entries(TD.spells)) {
      assert.equal(s.id, id);
      assert.ok(['self', 'rival'].includes(s.target));
      assert.ok(s.title && s.description && s.cost > 0 && s.duration > 0);
    }
    assert.equal(TD.mercenaries.king.title, 'Томат-Дредноут');
    assert.equal(TD.spells.haste.title, 'Гипер-жабры Аксолотлей');
    assert.equal(TD.mercCooldownSec, 0.8);
    assert.equal(TD.mercBountyShared, 1.5);
  });

  test('newState содержит новые поля', () => {
    const s = newState(camp(), 100);
    assert.deepEqual(
      { effects: s.effects, queuedSpawns: s.queuedSpawns, shots: s.shots, nextShotId: s.nextShotId, nextEffectId: s.nextEffectId, waveKills: s.waveKills, bounty: s.bounty },
      { effects: [], queuedSpawns: [], shots: [], nextShotId: 1, nextEffectId: 1, waveKills: 0, bounty: 0 },
    );
  });

  test('старый JSON без новых полей продолжает считаться и даёт тот же исход', () => {
    const st = stage('forest');
    const towers = [tw('s1', 'arrow'), tw('s3', 'arrow'), tw('s5', 'cannon'), tw('s4', 'frost')];
    const ctx = { stage: st, schedule: buildSchedule(st), towers, damageMult: 1 };
    const fresh = advanceTo(newState(st, 100), ctx, 20);
    // как будто раунд был сохранён старой версией сервера посреди боя
    const legacy = JSON.parse(JSON.stringify(fresh));
    for (const k of ['effects', 'queuedSpawns', 'shots', 'nextShotId', 'nextEffectId', 'waveKills', 'bounty']) delete legacy[k];
    for (const e of legacy.enemies) { delete e.isMerc; delete e.armor; }
    assert.equal(fresh.kills > 0, true);
    advanceTo(legacy, ctx, 400);
    advanceTo(fresh, ctx, 400);
    assert.equal(legacy.status, fresh.status);
    assert.equal(legacy.hp, fresh.hp);
    assert.equal(legacy.waveKills, fresh.waveKills, 'waveKills восстановлен из kills');
    assert.ok(Array.isArray(legacy.shots) && Array.isArray(legacy.effects));
    // и вспомогательные функции не падают на старом состоянии
    const old = JSON.parse(JSON.stringify(newState(st, 100)));
    delete old.effects; delete old.shots;
    assert.deepEqual(activeEffects(old), []);
    assert.deepEqual(towerModifiers(old, 's1'), { haste: false, slowed: false, disabled: false, rate: 1 });
    assert.deepEqual(ensureState(old).effects, []);
  });
});

describe('Tower Wars: броня и наёмники', () => {
  test('броня снижает урон башни: damage × (1 − armor), в том числе по площади', () => {
    const state = arena();
    state.enemies = [merc(1, 'armored', 3)];
    stepState(state, ctxOf([tw('s1', 'arrow')]));
    assert.equal(state.enemies[0].hp, 280 - 12 * 0.75);
    assert.equal(state.shots[0].damage, 9);

    const splash = arena();
    splash.enemies = [merc(1, 'armored', 3), { id: 2, type: 'grunt', s: 3.3, hp: 90, maxHp: 90, slowUntil: 0 }];
    stepState(splash, ctxOf([tw('s1', 'cannon')]));
    const [a, g] = splash.enemies;
    assert.equal(a.hp, 280 - 30 * 0.75);
    assert.equal(g.hp, 60, 'враг без брони получает полный урон');
    assert.equal(splash.shots[0].splash, 1);
  });

  test('наёмник выходит на s = 0 следующим шагом, со своим hp без hpScale; по одному за шаг', () => {
    const st = stage('fortress'); // hpScale 3.6 не должен влиять на наёмников
    const state = newState(st, 100);
    const ctx = { stage: st, schedule: [], towers: [], damageMult: 1 };
    const q = enqueueMerc(state, 'king', { from: 'B' });
    enqueueMerc(state, 'cherry', { from: 'B' });
    assert.deepEqual(q, { type: 'king', from: 'B', bounty: 0 });
    assert.equal(state.enemies.length, 0, 'до шага на поле никого');
    stepState(state, ctx);
    assert.equal(state.enemies.length, 1);
    const [k] = state.enemies;
    assert.equal(k.type, 'king');
    assert.equal(k.hp, 900);
    assert.equal(k.maxHp, 900);
    assert.equal(k.isMerc, true);
    assert.equal(k.from, 'B');
    assert.equal(k.s, 0.5 * TD.step);
    stepState(state, ctx);
    assert.equal(state.enemies.length, 2);
    assert.equal(state.queuedSpawns.length, 0);
    const pub = publicEnemies(state);
    assert.deepEqual(Object.keys(pub[0]).sort(), ['armor', 'hasted', 'hp', 'id', 'isMerc', 'maxHp', 's', 'slowed', 'speed', 'type', 'x', 'y']);
    assert.deepEqual([pub[0].isMerc, pub[0].armor, pub[0].speed], [true, 0.35, 0.5]);
    assert.throws(() => enqueueMerc(state, 'dragon'));
  });

  test('дошедший наёмник бьёт базу своим уроном', () => {
    const state = arena(100);
    state.enemies = [merc(1, 'king', PATH_LENGTH - 0.01)];
    stepState(state, ctxOf([]));
    assert.equal(state.hp, 70);
    assert.equal(state.leaked, 1);
  });

  test('убийства наёмников не идут в условие победы; пока наёмник на поле — победы нет', () => {
    const schedule = [{ t: 0, type: 'runner', wave: 0 }, { t: 0, type: 'runner', wave: 0 }];
    // все враги расписания уже выпущены и ушли, оборона убила только наёмника
    const lost = arena();
    lost.spawned = 2;
    lost.enemies = [merc(1, 'cherry', 3, { hp: 1 })];
    stepState(lost, ctxOf([tw('s1', 'arrow')], schedule));
    assert.equal(lost.kills, 1);
    assert.equal(lost.waveKills, 0);
    assert.equal(lost.status, 'lost');

    // половина расписания убита, но наёмник ещё идёт далеко от башен — раунд продолжается
    const pending = arena();
    pending.spawned = 2;
    pending.waveKills = 1;
    pending.kills = 1;
    pending.enemies = [merc(1, 'cherry', 13)];
    stepState(pending, ctxOf([tw('s1', 'arrow')], schedule));
    assert.equal(pending.status, 'running');
    // наёмник в очереди тоже держит раунд
    const queued = arena();
    queued.spawned = 2;
    queued.waveKills = 1;
    enqueueMerc(queued, 'cherry');
    stepState(queued, ctxOf([], schedule));
    assert.equal(queued.status, 'running');
    // наёмник убит — победа
    pending.enemies = [merc(1, 'cherry', 3, { hp: 1 })];
    stepState(pending, ctxOf([tw('s1', 'arrow')], schedule));
    assert.equal(pending.status, 'won');
    assert.equal(pending.waveKills, 1);
  });

  test('shared: убийство «подкрепления» копит bounty = round(cost × 1.5)', () => {
    const state = arena();
    assert.equal(enqueueMerc(state, 'ripe', { shared: true }).bounty, 8); // 5 × 1.5 = 7.5 → 8
    enqueueMerc(state, 'cherry'); // без shared — без награды
    stepState(state, ctxOf([]));
    stepState(state, ctxOf([]));
    for (const e of state.enemies) { e.s = 3; e.hp = 1; }
    stepState(state, ctxOf([tw('s1', 'cannon')]));
    assert.equal(state.kills, 2);
    assert.equal(state.bounty, 8);
    const cherry = arena();
    enqueueMerc(cherry, 'cherry', { shared: true });
    stepState(cherry, ctxOf([]));
    cherry.enemies[0].s = 3; cherry.enemies[0].hp = 1;
    stepState(cherry, ctxOf([tw('s1', 'arrow')]));
    assert.equal(cherry.bounty, 3); // 2 × 1.5
  });
});

describe('Tower Wars: заклинания', () => {
  test('haste ускоряет, slow_towers замедляет стрельбу башен', () => {
    const towers = [tw('s1', 'arrow')];
    const base = shotsOver(arena(), towers, 20);
    const hasted = arena();
    applySpell(hasted, 'haste', { towers });
    const fast = shotsOver(hasted, towers, 20);
    const slowedState = arena();
    applySpell(slowedState, 'slow_towers', { towers });
    const slow = shotsOver(slowedState, towers, 20);
    assert.deepEqual([slow, base, fast], [5, 7, 10]);
    assert.ok(towerModifiers(hasted, 's1').haste && towerModifiers(slowedState, 's1').slowed);
  });

  test('эффект истекает по игровому времени, повтор продлевает срок, не складываясь', () => {
    const state = arena();
    const first = applySpell(state, 'haste', {});
    assert.equal(first.applied, true);
    assert.deepEqual(first.effect, { id: 1, kind: 'haste', targetSlot: null, expiresAtGameTime: 6, factor: 1.35 });
    // враг-«манекен» вдали от базы держит раунд «running»
    for (let i = 0; i < 12; i++) { state.enemies = [merc(9, 'king', 1)]; stepState(state, ctxOf([])); }
    assert.equal(state.t, 3);
    const again = applySpell(state, 'haste', {});
    assert.equal(again.refreshed, true);
    assert.equal(state.effects.length, 1);
    assert.equal(state.effects[0].id, 1);
    assert.equal(state.effects[0].expiresAtGameTime, 9);
    assert.equal(towerModifiers(state, 's1').rate, 1.35, 'сила не складывается');
    for (let i = 0; i < 24; i++) { state.enemies[0].s = 1; stepState(state, ctxOf([])); }
    assert.equal(state.t, 9);
    assert.deepEqual(activeEffects(state), []);
    assert.equal(state.effects.length, 0);
  });

  test('disable_tower глушит ровно самую прокачанную башню (ничья — меньший id слота)', () => {
    const towers = [tw('s4', 'arrow', 1), tw('s3', 'arrow', 2), tw('s1', 'arrow', 2)];
    assert.equal(pickDisableTarget(towers), 's1');
    assert.equal(pickDisableTarget([tw('s2', 'arrow', 1), tw('s5', 'frost', 3)]), 's5');
    assert.equal(pickDisableTarget([]), null);
    const state = arena();
    const res = applySpell(state, 'disable_tower', { towers });
    assert.equal(res.targetSlot, 's1');
    assert.equal(res.effect.kind, 'disable_tower');
    for (let i = 0; i < 12; i++) {
      state.enemies = [{ id: 1, type: 'grunt', s: 3, hp: 1e9, maxHp: 1e9, slowUntil: 0 }];
      stepState(state, ctxOf(towers));
      assert.ok(state.shots.every((sh) => sh.slot !== 's1'), 'замороженная башня молчит');
    }
    const slots = new Set(state.shots.map((sh) => sh.slot));
    assert.ok(slots.has('s3') && slots.has('s4'), 'остальные стреляют');
    // после истечения (5 игровых секунд) башня снова стреляет
    shotsOver(state, towers, 12);
    assert.ok(state.shots.some((sh) => sh.slot === 's1'));
    // без башен заклинание не применяется и состояние не меняется
    const empty = arena();
    assert.deepEqual(applySpell(empty, 'disable_tower', { towers: [] }), { applied: false, reason: 'NO_TARGET' });
    assert.equal(empty.effects.length, 0);
  });

  test('enrage_horde ускоряет врагов в 1.4 раза', () => {
    const a = arena();
    const b = arena();
    a.enemies = [merc(1, 'ripe', 1)];
    b.enemies = [merc(1, 'ripe', 1)];
    applySpell(b, 'enrage_horde', {});
    assert.equal(publicEnemies(b)[0].hasted, true);
    assert.equal(publicEnemies(b)[0].speed, 1.47);
    assert.equal(publicEnemies(a)[0].speed, 1.05);
    for (let i = 0; i < 8; i++) { stepState(a, ctxOf([])); stepState(b, ctxOf([])); }
    assert.ok(Math.abs((b.enemies[0].s - 1) - (a.enemies[0].s - 1) * 1.4) < 1e-9);
    // замедление морозом и ярость перемножаются
    b.enemies[0].slowUntil = b.t + 1; b.enemies[0].slowFactor = 0.5;
    assert.equal(publicEnemies(b)[0].speed, 0.735);
    assert.equal(publicEnemies(b)[0].slowed, true);
  });

  test('repair: +20 HP не выше hpMax и щит −30% урона по базе на 5 секунд', () => {
    const state = arena(100);
    state.hp = 90;
    const res = applySpell(state, 'repair', {});
    assert.equal(res.healed, 10);
    assert.equal(state.hp, 100, 'не выше hpMax');
    state.hp = 50;
    applySpell(state, 'repair', {});
    assert.equal(state.hp, 70);
    state.enemies = [{ id: 1, type: 'tank', s: PATH_LENGTH - 0.01, hp: 260, maxHp: 260, slowUntil: 0 }];
    stepState(state, ctxOf([]));
    assert.equal(state.hp, 70 - 15 * 0.7);
    // после истечения щита урон снова полный
    const after = arena(100);
    after.t = 6;
    after.effects = state.effects;
    after.enemies = [{ id: 2, type: 'tank', s: PATH_LENGTH - 0.01, hp: 260, maxHp: 260, slowUntil: 0 }];
    stepState(after, ctxOf([]));
    assert.equal(after.hp, 85);
    // в завершённый раунд заклинания не применяются
    const done = arena(); done.status = 'won';
    assert.deepEqual(applySpell(done, 'repair', {}), { applied: false, reason: 'NOT_RUNNING' });
  });
});

describe('Tower Wars: выстрелы и детерминизм', () => {
  test('буфер выстрелов: не больше 25 и не старше 1.5 игровой секунды, форма записи', () => {
    const st = stage('fortress');
    const towers = TD.map.slots.map((s, i) => tw(s.id, ['arrow', 'cannon', 'frost'][i % 3], 3));
    const ctx = { stage: st, schedule: buildSchedule(st), towers, damageMult: 2 };
    const state = newState(st, 1000);
    let maxSeen = 0;
    while (state.status === 'running' && state.t < 120) {
      stepState(state, ctx);
      assert.ok(state.shots.length <= SHOTS_MAX);
      assert.ok(state.shots.every((sh) => sh.t >= state.t - SHOTS_WINDOW - 1e-9));
      maxSeen = Math.max(maxSeen, state.shots.length);
    }
    assert.ok(maxSeen >= 8, `в бою буфер наполняется: ${maxSeen}`);
    assert.ok(state.nextShotId > 100);
    // переполнение: остаются 25 самых свежих; устаревшие (старше 1.5 с) отбрасываются
    const flood = arena();
    flood.t = 10;
    flood.shots = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, t: i < 5 ? 8 : 10, slot: 's1' }));
    flood.enemies = [merc(1, 'king', 13)];
    stepState(flood, ctxOf([]));
    assert.equal(flood.shots.length, SHOTS_MAX);
    assert.deepEqual([flood.shots[0].id, flood.shots.at(-1).id], [16, 40]);
    flood.enemies = [merc(1, 'king', 13)];
    flood.t = 11.5;
    stepState(flood, ctxOf([]));
    assert.equal(flood.shots.length, 0, 'всё старше 1.5 игровой секунды');
    const frost = arena();
    frost.enemies = [{ id: 7, type: 'grunt', s: 3, hp: 90, maxHp: 90, slowUntil: 0 }];
    stepState(frost, ctxOf([tw('s1', 'frost')]));
    const [shot] = frost.shots;
    assert.deepEqual(Object.keys(shot).sort(), ['damage', 'fromX', 'fromY', 'id', 'slot', 'slow', 'splash', 't', 'targetId', 'toX', 'toY', 'towerType']);
    assert.deepEqual([shot.slot, shot.towerType, shot.fromX, shot.fromY, shot.targetId, shot.damage, shot.splash, shot.slow], ['s1', 'frost', 2.5, 2.5, 7, 3, null, true]);
  });

  test('детерминизм с наёмниками и заклинаниями', () => {
    const run = () => {
      const st = stage('bridge');
      const towers = [tw('s1', 'arrow', 2), tw('s3', 'arrow'), tw('s5', 'cannon', 3), tw('s4', 'frost'), tw('s8', 'cannon')];
      const ctx = { stage: st, schedule: buildSchedule(st), towers, damageMult: 1.1 };
      const state = newState(st, 120);
      advanceTo(state, ctx, 5);
      enqueueMerc(state, 'armored', { from: 'A' });
      applySpell(state, 'enrage_horde', { towers });
      advanceTo(state, ctx, 12);
      applySpell(state, 'disable_tower', { towers });
      enqueueMerc(state, 'king', { shared: true });
      applySpell(state, 'repair', { towers });
      advanceTo(state, ctx, 30);
      applySpell(state, 'slow_towers', { towers });
      applySpell(state, 'haste', { towers });
      advanceTo(state, ctx, 400);
      return state;
    };
    const a = run();
    assert.deepEqual(a, run());
    assert.notEqual(a.status, 'running');
  });
});
