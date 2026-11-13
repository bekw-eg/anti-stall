import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TD } from '../src/catalog.js';
import { PATH_LENGTH, advanceTo, buildSchedule, newState, nominalSeconds, pointAt, stepState, towerStats } from '../src/td/engine.js';

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
