import { TD } from '../catalog.js';

/**
 * Детерминированный движок Tower Defense: чистые функции без БД и без времени.
 * Один и тот же набор башен и расписание всегда дают один и тот же результат — поэтому
 * результат раунда определяет только сервер, а клиент лишь отображает присланное состояние.
 */

const pathSegments = (path) => {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i], [x2, y2] = path[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, from: acc });
    acc += len;
  }
  return { segs, total: acc };
};

const PATH = pathSegments(TD.map.path);
export const PATH_LENGTH = PATH.total;
const SLOT = new Map(TD.map.slots.map((s) => [s.id, s]));
export const slotById = (id) => SLOT.get(id);

/** Точка на маршруте на расстоянии s от входа. */
export function pointAt(s) {
  const d = Math.min(Math.max(s, 0), PATH.total);
  const seg = PATH.segs.find((g) => d <= g.from + g.len) ?? PATH.segs[PATH.segs.length - 1];
  const k = seg.len === 0 ? 0 : (d - seg.from) / seg.len;
  return { x: seg.x1 + (seg.x2 - seg.x1) * k, y: seg.y1 + (seg.y2 - seg.y1) * k };
}

/** Плоское расписание появления врагов: [{t, type}], отсортировано по времени (устойчиво). */
export function buildSchedule(stage) {
  const out = [];
  for (const wave of stage.waves) {
    wave.groups.forEach((g, gi) => {
      for (let i = 0; i < g.count; i++) out.push({ t: wave.at + (g.delay ?? 0) + i * g.gap, type: g.type, wave: stage.waves.indexOf(wave), order: gi * 1000 + i });
    });
  }
  return out.sort((a, b) => a.t - b.t || a.order - b.order).map(({ t, type, wave }) => ({ t, type, wave }));
}

/** Ориентировочная длительность этапа в игровых секундах — по ней выбирается ускорение под длину перерыва. */
export function nominalSeconds(stage) {
  const sched = buildSchedule(stage);
  return sched[sched.length - 1].t + 22;
}

export function towerStats(type, level, damageMult = 1) {
  const def = TD.towers[type];
  return {
    ...def,
    level,
    damage: def.damage * TD.levelDamage(level) * damageMult,
    range: def.range + TD.levelRange(level),
  };
}

export function newState(stage, hpMax) {
  return { t: 0, hp: hpMax, hpMax, spawned: 0, nextId: 1, enemies: [], cd: {}, kills: 0, leaked: 0, status: 'running' };
}

/**
 * Один шаг симуляции (мутирует state).
 * ctx: { stage, schedule, towers: [{slot, type, level}], damageMult }
 */
export function stepState(state, ctx) {
  if (state.status !== 'running') return state;
  const dt = TD.step;
  state.t = Math.round((state.t + dt) * 1000) / 1000;

  // 1. появление врагов
  while (state.spawned < ctx.schedule.length && ctx.schedule[state.spawned].t <= state.t + 1e-9) {
    const def = TD.enemies[ctx.schedule[state.spawned].type];
    const hp = Math.round(def.hp * ctx.stage.hpScale);
    state.enemies.push({ id: state.nextId++, type: def.id, s: 0, hp, maxHp: hp, slowUntil: 0 });
    state.spawned++;
  }

  // 2. движение; дошедшие до базы наносят урон
  const alive = [];
  for (const e of state.enemies) {
    const def = TD.enemies[e.type];
    const slowed = e.slowUntil > state.t;
    e.s += def.speed * (slowed ? e.slowFactor ?? 0.5 : 1) * dt;
    if (e.s >= PATH_LENGTH) {
      state.hp = Math.max(0, state.hp - def.damage);
      state.leaked++;
    } else alive.push(e);
  }
  state.enemies = alive;

  // 3. стрельба башен (в порядке id слота — детерминированно)
  const towers = [...ctx.towers].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  for (const tw of towers) {
    const cd = (state.cd[tw.slot] ?? 0) - dt;
    if (cd > 1e-9) { state.cd[tw.slot] = cd; continue; }
    const st = towerStats(tw.type, tw.level, ctx.damageMult);
    const pos = slotById(tw.slot);
    let target = null;
    let targetPos = null;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const p = pointAt(e.s);
      if (Math.hypot(p.x - pos.x, p.y - pos.y) <= st.range && (!target || e.s > target.s)) { target = e; targetPos = p; }
    }
    if (!target) { state.cd[tw.slot] = 0; continue; }
    state.cd[tw.slot] = st.cooldown;
    if (st.splash) {
      for (const e of state.enemies) {
        const p = pointAt(e.s);
        if (e.hp > 0 && Math.hypot(p.x - targetPos.x, p.y - targetPos.y) <= st.splash) e.hp -= st.damage;
      }
    } else {
      target.hp -= st.damage;
      if (st.slow) { target.slowUntil = state.t + st.slow.duration; target.slowFactor = st.slow.factor; }
    }
  }
  const survivors = [];
  for (const e of state.enemies) {
    if (e.hp > 0) survivors.push(e);
    else state.kills++;
  }
  state.enemies = survivors;

  // 4. исход
  if (state.hp <= 0) state.status = 'lost';
  else if (state.spawned >= ctx.schedule.length && state.enemies.length === 0) {
    // Победа: база уцелела И оборона реально уничтожила не меньше половины врагов (нельзя «выиграть», ничего не построив)
    state.status = state.kills * 2 >= ctx.schedule.length ? 'won' : 'lost';
  }
  return state;
}

/** Прокручивает симуляцию до игровой секунды target. */
export function advanceTo(state, ctx, target, maxSteps = 6000) {
  let n = 0;
  while (state.status === 'running' && state.t + TD.step <= target + 1e-9 && n++ < maxSteps) stepState(state, ctx);
  return state;
}

/** Публичное представление врагов (позиции считает сервер). */
export function publicEnemies(state) {
  return state.enemies.map((e) => ({ id: e.id, type: e.type, ...pointAt(e.s), hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, slowed: e.slowUntil > state.t }));
}

/** Какая по счёту волна сейчас идёт (по числу появившихся врагов). */
export function currentWave(state, schedule) {
  if (!schedule.length) return 0;
  const idx = Math.min(state.spawned, schedule.length) - 1;
  return idx < 0 ? 0 : schedule[idx].wave + 1;
}
