import { TD } from '../catalog.js';

/**
 * Детерминированный движок Tower Defense: чистые функции без БД и без времени.
 * Один и тот же набор башен, расписание, наёмники и заклинания (в те же игровые секунды) всегда дают
 * один и тот же результат — поэтому результат раунда определяет только сервер, а клиент лишь отображает
 * присланное состояние.
 *
 * Форма state (JSON в td_rounds.state; у раундов, начатых до Tower Wars, новых полей может не быть —
 * их добавляет ensureState):
 *   t, hp, hpMax, spawned, nextId, enemies[], cd{slot: сек}, kills, leaked, status: running|won|lost
 *   effects[]      — { id, kind, targetSlot: string|null, expiresAtGameTime, factor }, истекают по state.t
 *   queuedSpawns[] — наёмники, ждущие выхода: { type, from, bounty }
 *   shots[]        — последние выстрелы для анимации снарядов (≤ SHOTS_MAX, не старше SHOTS_WINDOW)
 *   nextShotId, nextEffectId
 *   waveKills      — убийства врагов расписания (только они идут в условие победы)
 *   bounty         — монеты, накопленные за убийство «подкрепления» в shared (сервис зачисляет в казну)
 *   bountyPaid     — сколько из bounty сервис уже зачислил в казну (движок это поле только хранит)
 * Враг: { id, type, s, hp, maxHp, slowUntil, slowFactor?, isMerc?, armor?, from?, bounty? }
 */

export const SHOTS_MAX = 25;
export const SHOTS_WINDOW = 1.5; // игровых секунд

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

/** Порядок слотов — тот же, в котором стреляют башни (строковое сравнение id). */
const compareSlots = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Описание врага: враг расписания или наёмник. */
export function enemyDef(type) {
  return TD.enemies[type] ?? TD.mercenaries[type] ?? null;
}

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
  return {
    t: 0, hp: hpMax, hpMax, spawned: 0, nextId: 1, enemies: [], cd: {}, kills: 0, leaked: 0, status: 'running',
    effects: [], queuedSpawns: [], shots: [], nextShotId: 1, nextEffectId: 1, waveKills: 0, bounty: 0, bountyPaid: 0,
  };
}

/**
 * Дополняет состояние, сохранённое до Tower Wars, новыми полями (мутирует и возвращает state).
 * waveKills по умолчанию = kills: наёмников тогда не было, все убийства — враги расписания.
 */
export function ensureState(state) {
  if (!Array.isArray(state.effects)) state.effects = [];
  if (!Array.isArray(state.queuedSpawns)) state.queuedSpawns = [];
  if (!Array.isArray(state.shots)) state.shots = [];
  if (!Number.isFinite(state.nextShotId)) state.nextShotId = 1;
  if (!Number.isFinite(state.nextEffectId)) state.nextEffectId = 1;
  if (!Number.isFinite(state.waveKills)) state.waveKills = state.kills ?? 0;
  if (!Number.isFinite(state.bounty)) state.bounty = 0;
  if (!Number.isFinite(state.bountyPaid)) state.bountyPaid = 0;
  return state;
}

// ---- Эффекты заклинаний ----------------------------------------------------------------------

const isActive = (state, ef) => ef.expiresAtGameTime > state.t + 1e-9;
const activeOf = (state, kind) => state.effects?.find((ef) => ef.kind === kind && isActive(state, ef)) ?? null;

/** Действующие эффекты (копии) — для отображения клиенту. */
export function activeEffects(state) {
  return (state.effects ?? []).filter((ef) => isActive(state, ef)).map((ef) => ({ ...ef }));
}

/** Модификаторы башни в слоте: { haste, slowed, disabled, rate } — rate = во сколько раз быстрее идёт перезарядка. */
export function towerModifiers(state, slot) {
  const haste = activeOf(state, 'haste');
  const slow = activeOf(state, 'slow_towers');
  const dis = activeOf(state, 'disable_tower');
  return {
    haste: !!haste,
    slowed: !!slow,
    disabled: !!dis && dis.targetSlot === slot,
    rate: (haste ? haste.factor : 1) / (slow ? slow.factor : 1),
  };
}

/** Цель «Кетчуп-заморозки»: башня максимального уровня, при равенстве — меньший id слота (порядок стрельбы). */
export function pickDisableTarget(towers) {
  let best = null;
  for (const tw of [...(towers ?? [])].sort((a, b) => compareSlots(a.slot, b.slot))) {
    if (!best || tw.level > best.level) best = tw;
  }
  return best ? best.slot : null;
}

/**
 * Применяет заклинание к раунду (мутирует state). ctx: { towers } — башни этого раунда (нужны disable_tower).
 * Повтор того же заклинания продлевает срок действующего эффекта (тот же id), силы не складываются.
 * Возвращает { applied: true, effect, targetSlot, refreshed, healed }
 *   или { applied: false, reason: 'NOT_RUNNING' | 'NO_TARGET' } — состояние при этом не меняется.
 */
export function applySpell(state, spellId, ctx = {}) {
  const def = TD.spells[spellId];
  if (!def) throw new Error(`Неизвестное заклинание: ${spellId}`);
  ensureState(state);
  if (state.status !== 'running') return { applied: false, reason: 'NOT_RUNNING' };

  let targetSlot = null;
  if (spellId === 'disable_tower') {
    targetSlot = pickDisableTarget(ctx.towers);
    if (!targetSlot) return { applied: false, reason: 'NO_TARGET' };
  }
  let healed = 0;
  if (spellId === 'repair') {
    const before = state.hp;
    state.hp = Math.min(state.hpMax, state.hp + def.heal);
    healed = state.hp - before;
  }

  // истёкшие эффекты больше не нужны
  state.effects = state.effects.filter((ef) => isActive(state, ef));
  const expiresAtGameTime = Math.round((state.t + def.duration) * 1000) / 1000;
  let effect = state.effects.find((ef) => ef.kind === spellId);
  const refreshed = !!effect;
  if (effect) {
    effect.expiresAtGameTime = Math.max(effect.expiresAtGameTime, expiresAtGameTime);
    effect.targetSlot = targetSlot; // «заморозка» переезжает на текущую самую прокачанную башню
  } else {
    effect = { id: state.nextEffectId++, kind: spellId, targetSlot, expiresAtGameTime, factor: def.factor ?? 1 };
    state.effects.push(effect);
  }
  return { applied: true, effect: { ...effect }, targetSlot, refreshed, healed };
}

// ---- Наёмники ---------------------------------------------------------------------------------

/**
 * Ставит наёмника в очередь выхода (мутирует state). Выходит на s = 0 на следующем шаге симуляции
 * (не больше одного за шаг — пачка недоставленных выходит цепочкой, а не одной кучей).
 * Опции:
 *   from   — ключ команды-отправителя (для подписи на клиенте), по умолчанию null;
 *   shared — «Подкрепление волны» в shared-комнате: убийство даёт state.bounty += round(cost × mercBountyShared).
 * Возвращает поставленную запись { type, from, bounty }.
 */
export function enqueueMerc(state, type, { from = null, shared = false } = {}) {
  const def = TD.mercenaries[type];
  if (!def) throw new Error(`Неизвестный наёмник: ${type}`);
  ensureState(state);
  const entry = { type: def.id, from, bounty: shared ? Math.round(def.cost * TD.mercBountyShared) : 0 };
  state.queuedSpawns.push(entry);
  return { ...entry };
}

// ---- Симуляция --------------------------------------------------------------------------------

/** Текущая скорость врага (клеток в игровую секунду) с учётом замедления морозом и «Ярости Томатов». */
function enemySpeed(state, e, enrage) {
  const def = enemyDef(e.type);
  const slowed = e.slowUntil > state.t;
  return def.speed * (slowed ? e.slowFactor ?? 0.5 : 1) * (enrage ? enrage.factor : 1);
}

const enemyArmor = (e) => e.armor ?? enemyDef(e.type).armor ?? 0;

/**
 * Один шаг симуляции (мутирует state).
 * ctx: { stage, schedule, towers: [{slot, type, level}], damageMult }
 */
export function stepState(state, ctx) {
  if (state.status !== 'running') return state;
  ensureState(state);
  const dt = TD.step;
  state.t = Math.round((state.t + dt) * 1000) / 1000;
  state.effects = state.effects.filter((ef) => isActive(state, ef));

  // 1. появление врагов расписания и одного наёмника из очереди
  while (state.spawned < ctx.schedule.length && ctx.schedule[state.spawned].t <= state.t + 1e-9) {
    const def = TD.enemies[ctx.schedule[state.spawned].type];
    const hp = Math.round(def.hp * ctx.stage.hpScale);
    state.enemies.push({ id: state.nextId++, type: def.id, s: 0, hp, maxHp: hp, slowUntil: 0 });
    state.spawned++;
  }
  if (state.queuedSpawns.length) {
    const q = state.queuedSpawns.shift();
    const def = TD.mercenaries[q.type];
    state.enemies.push({
      id: state.nextId++, type: def.id, s: 0, hp: def.hp, maxHp: def.hp, slowUntil: 0,
      isMerc: true, armor: def.armor, from: q.from ?? null, bounty: q.bounty ?? 0,
    });
  }

  // 2. движение; дошедшие до базы наносят урон (щит «Регенерации» гасит его часть)
  const enrage = activeOf(state, 'enrage_horde');
  const shield = activeOf(state, 'repair');
  const alive = [];
  for (const e of state.enemies) {
    e.s += enemySpeed(state, e, enrage) * dt;
    if (e.s >= PATH_LENGTH) {
      const dmg = enemyDef(e.type).damage * (shield ? 1 - shield.factor : 1);
      state.hp = Math.max(0, state.hp - dmg);
      state.leaked++;
    } else alive.push(e);
  }
  state.enemies = alive;

  // 3. стрельба башен (в порядке id слота — детерминированно)
  const towers = [...ctx.towers].sort((a, b) => compareSlots(a.slot, b.slot));
  for (const tw of towers) {
    const mod = towerModifiers(state, tw.slot);
    // haste ускоряет, сонная пыльца замедляет ход перезарядки; без эффектов rate = 1
    const cd = (state.cd[tw.slot] ?? 0) - dt * mod.rate;
    if (cd > 1e-9) { state.cd[tw.slot] = cd; continue; }
    if (mod.disabled) { state.cd[tw.slot] = 0; continue; } // заморожена кетчупом: готова, но молчит
    const st = towerStats(tw.type, tw.level, ctx.damageMult);
    st.range *= rangeMult;
    st.cooldown *= cooldownMult;
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
    const dealt = st.damage * (1 - enemyArmor(target));
    if (st.splash) {
      for (const e of state.enemies) {
        const p = pointAt(e.s);
        if (e.hp > 0 && Math.hypot(p.x - targetPos.x, p.y - targetPos.y) <= st.splash) e.hp -= st.damage * (1 - enemyArmor(e));
      }
    } else {
      target.hp -= dealt;
      if (st.slow) { target.slowUntil = state.t + st.slow.duration; target.slowFactor = st.slow.factor; }
    }
    state.shots.push({
      id: state.nextShotId++, t: state.t, slot: tw.slot, towerType: tw.type,
      fromX: pos.x, fromY: pos.y, toX: targetPos.x, toY: targetPos.y, targetId: target.id,
      damage: Math.round(dealt * 10) / 10, splash: st.splash ?? null, slow: !!st.slow,
    });
  }
  const minShotT = state.t - SHOTS_WINDOW - 1e-9;
  state.shots = state.shots.filter((sh) => sh.t >= minShotT).slice(-SHOTS_MAX);

  const survivors = [];
  for (const e of state.enemies) {
    if (e.hp > 0) { survivors.push(e); continue; }
    state.kills++;
    if (!e.isMerc) state.waveKills++;
    if (e.bounty) state.bounty += e.bounty;
  }
  state.enemies = survivors;

  // 4. исход
  if (state.hp <= 0) state.status = 'lost';
  else if (state.spawned >= ctx.schedule.length && state.enemies.length === 0 && state.queuedSpawns.length === 0) {
    // Победа: база уцелела И оборона реально уничтожила не меньше половины врагов расписания
    // (нельзя «выиграть», ничего не построив; наёмники в этот счёт не входят)
    state.status = state.waveKills * 2 >= ctx.schedule.length ? 'won' : 'lost';
  }
  return state;
}

/** Прокручивает симуляцию до игровой секунды target. */
export function advanceTo(state, ctx, target, maxSteps = 6000) {
  let n = 0;
  while (state.status === 'running' && state.t + TD.step <= target + 1e-9 && n++ < maxSteps) stepState(state, ctx);
  return state;
}

/** Публичное представление врагов (позиции считает сервер). speed — текущая скорость, клеток/игровую секунду. */
export function publicEnemies(state) {
  const enrage = activeOf(state, 'enrage_horde');
  return state.enemies.map((e) => ({
    id: e.id, type: e.type, ...pointAt(e.s), s: Math.round(e.s * 1000) / 1000,
    hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp,
    speed: Math.round(enemySpeed(state, e, enrage) * 1000) / 1000,
    slowed: e.slowUntil > state.t, hasted: !!enrage, armor: enemyArmor(e), isMerc: !!e.isMerc,
  }));
}

/** Последние выстрелы (копии) — для анимации снарядов на клиенте. */
export function publicShots(state) {
  return (state.shots ?? []).map((sh) => ({ ...sh }));
}

/** Какая по счёту волна сейчас идёт (по числу появившихся врагов). */
export function currentWave(state, schedule) {
  if (!schedule.length) return 0;
  const idx = Math.min(state.spawned, schedule.length) - 1;
  return idx < 0 ? 0 : schedule[idx].wave + 1;
}
