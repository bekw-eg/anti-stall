/**
 * Harvest — детерминированный движок мини-игры «Урожай» (чистые функции, без БД и без часов).
 *
 * Правила перенесены из прототипа prototypes/harvest: на поле команды падают помидоры, корзины ловят их
 * на линии RIM. Обычный +1, золотой +3 (и заряд шутки), гнилой −2 и сброс комбо; пропущенный хороший
 * помидор тоже сбрасывает комбо. 5 подряд — ×2, 10 подряд — ×3.
 *
 * Ключевая идея: «дождь» целиком задаётся зерном (seed). Для каждого помидора заранее известно, когда
 * он пересечёт край корзины (crossT) и когда упадёт на землю (groundT). Поэтому сервер проверяет заявку
 * клиента «поймал помидор N в точке x» без собственной физики корзин, а счёт пересчитывается по журналу
 * поимок (scoreTeam) — одинаково на сервере и у всех клиентов.
 *
 * Координаты поля — условные единицы 1000 × 600 (как в прототипе), время — секунды от старта раунда.
 * Клиент (frontend/src/tomato/harvestEngine.ts) содержит точную копию makeRain/itemAt; совпадение
 * проверяет тест на общем фикстурном зерне.
 */

export const HV = {
  W: 1000, H: 600, RIM: 492, GROUND: 556,
  BASKET_W: 112, BASKET_H: 46,
  GRAVITY: 70, // ед/с² (как в прототипе: vy += 70·dt)
  MAX_CHARGES: 3, START_CHARGES: 1,
  PLAYER_SPEED: 760, // макс. скорость корзины игрока (мышь), ед/с
  FREEZE_SEC: { human: 2, bot: 3 },
  SPLAT_SEC: { human: 5, bot: 4 },
  BOT_COUNT: 5,
  BOT_STEP: 0.05,
};

export const KINDS = {
  good: { pts: 1, r: 19 },
  golden: { pts: 3, r: 17 },
  rotten: { pts: -2, r: 19 },
};

/** Генератор mulberry32 с явным состоянием (чтобы симуляцию ботов можно было пересчитать с нуля). */
export function rngFrom(seed) {
  const s = { a: seed >>> 0 };
  const next = () => {
    s.a = (s.a + 0x6D2B79F5) | 0;
    let t = Math.imul(s.a ^ (s.a >>> 15), 1 | s.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return next;
}

/** Время (с от появления), когда помидор опустится до высоты y: −r + vy0·τ + g/2·τ² = y. */
const timeToY = (it, y) => {
  const a = HV.GRAVITY / 2, b = it.vy0, c = -(y + it.r);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};

/**
 * Весь дождь раунда. Темп и доля гнилых растут к концу (p = t / duration), как в прототипе.
 * В зачёт идут только помидоры, долетевшие до корзин до конца раунда (crossT ≤ duration).
 * Список отсортирован по crossT — в этом порядке считаются комбо.
 */
export function makeRain(seed, duration) {
  const rng = rngFrom(seed);
  const items = [];
  let t = 0.6;
  let id = 1;
  while (t < duration) {
    const p = t / duration;
    const r = rng();
    const kind = r < 0.07 ? 'golden' : r < 0.07 + 0.18 + 0.12 * p ? 'rotten' : 'good';
    const k = KINDS[kind];
    const it = { id: id++, kind, r: k.r, x: Math.round(40 + rng() * (HV.W - 80)), t0: Math.round(t * 1000) / 1000, vy0: Math.round(150 + rng() * 90 + p * 120), spin0: Math.round(rng() * 628) / 100 };
    it.crossT = Math.round((it.t0 + timeToY(it, HV.RIM)) * 1000) / 1000;
    it.groundT = Math.round((it.t0 + timeToY(it, HV.GROUND - it.r * 0.4)) * 1000) / 1000;
    if (it.crossT <= duration) items.push(it);
    t += 0.8 - 0.34 * p + rng() * 0.12;
  }
  items.sort((a, b) => a.crossT - b.crossT || a.id - b.id);
  return { seed, duration, items, byId: new Map(items.map((i) => [i.id, i])) };
}

/** Положение помидора в момент t (с от старта раунда) или null, если он ещё не появился / уже упал. */
export function itemAt(it, t) {
  const tau = t - it.t0;
  if (tau < 0 || t > it.groundT) return null;
  return { x: it.x, y: -it.r + it.vy0 * tau + (HV.GRAVITY / 2) * tau * tau, spin: it.spin0 + tau * 2 };
}

export const multOf = (combo) => 1 + Math.min(2, Math.floor(combo / 5));

/**
 * Счёт команды по журналу поимок. caught: Map(itemId → кто поймал). settledT — до какого момента
 * пропуски уже окончательны (позже ещё может прийти запоздалая заявка о поимке).
 * Возвращает итог команды и личные очки (personal points — без множителя, как в прототипе).
 */
export function scoreTeam(rain, caught, settledT) {
  let score = 0, combo = 0, bestCombo = 0, missed = 0;
  const players = {};
  const P = (id) => (players[id] ??= { pts: 0, caught: 0, golden: 0, rotten: 0 });
  for (const it of rain.items) {
    const by = caught.get(it.id);
    if (by !== undefined) {
      const p = P(by);
      if (it.kind === 'rotten') {
        score = Math.max(0, score + KINDS.rotten.pts);
        p.pts = Math.max(0, p.pts + KINDS.rotten.pts);
        p.rotten++;
        combo = 0;
      } else {
        score += KINDS[it.kind].pts * multOf(combo);
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        p.pts += KINDS[it.kind].pts;
        p.caught++;
        if (it.kind === 'golden') p.golden++;
      }
    } else if (it.kind !== 'rotten' && it.groundT <= settledT) {
      combo = 0;
      missed++;
    }
  }
  return { score, combo, bestCombo, missed, mult: multOf(combo), players };
}

/** Заявка «поймал»: корзина в точке x накрывает помидор (тот же допуск, что в прототипе). */
export const coversItem = (it, x) => Math.abs(it.x - x) <= HV.BASKET_W / 2 - 2;
export const clampX = (x) => Math.max(HV.BASKET_W / 2, Math.min(HV.W - HV.BASKET_W / 2, x));

// ------------------------------------------------------------------------------------------- боты
/**
 * Команда ботов — когда у команды нет живых игроков (комната без команд или пустая команда).
 * Логика из прототипа (botThink): у каждого своя скорость, реакция и «внимательность», они не берут
 * помидор, за которым уже идёт сосед, и уворачиваются от гнилых. Симуляция детерминирована:
 * зависит только от зерна, дождя и шуток, наложенных на ботов (effects), поэтому её можно
 * пересчитать с нуля после рестарта сервера.
 */
export const BOT_NAMES = ['Бек', 'Нурлан', 'Дана', 'Руслан', 'Аружан', 'Ерлан', 'Камила', 'Мади', 'Асель', 'Даулет'];

export function createBots(seed, n = HV.BOT_COUNT, skill = 0.8) {
  const rng = rngFrom((seed ^ 0x5bd1e995) >>> 0);
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const bots = Array.from({ length: n }, (_, i) => {
    const home = (HV.W * (i + 0.5)) / n;
    return {
      id: `bot${i + 1}`, name: names[i], x: home, home, target: null, think: 0, aimOffset: 0,
      speed: (300 + rng() * 90) * skill, react: (0.35 + rng() * 0.25) / skill, focus: (0.7 + rng() * 0.2) * skill,
    };
  });
  return { rng, t: 0, bots, caught: new Map(), nextPrank: 9 + rng() * 6, prankLog: [] };
}

const activeOn = (effects, id, kind, t) => effects.some((e) => e.target === id && e.kind === kind && e.at <= t && t < e.until);

function botThink(sim, b, rain, t, dt, effects) {
  if (activeOn(effects, b.id, 'freeze', t)) return;
  if (activeOn(effects, b.id, 'splat', t)) { b.target = null; return; }
  const reach = 210;
  b.think -= dt;
  if (b.think <= 0) {
    b.think = b.react + sim.rng() * 0.2;
    if (sim.rng() > b.focus) { b.target = null; b.think += 0.5; return; }
    const claimed = new Set(sim.bots.filter((o) => o !== b && o.target).map((o) => o.target));
    let best = null, bestV = 0;
    for (const it of rain.items) {
      if (it.t0 > t) continue; // ещё не появился — бот его не видит
      if (it.kind === 'rotten' || sim.caught.has(it.id) || it.crossT <= t || claimed.has(it.id) || Math.abs(it.x - b.home) > reach) continue;
      const tLeft = it.crossT - t;
      const need = Math.max(0, Math.abs(it.x - b.x) - HV.BASKET_W / 2 + 14) / b.speed;
      if (need > tLeft) continue;
      const crowded = sim.bots.some((o) => o !== b && Math.abs(o.x - it.x) < HV.BASKET_W * 0.9);
      const v = ((it.kind === 'golden' ? 2.2 : 1) / (tLeft + 0.4) / (1 + Math.abs(it.x - b.home) / 220)) * (crowded ? 0.15 : 1);
      if (v > bestV) { bestV = v; best = it; }
    }
    b.target = best ? best.id : null;
    b.aimOffset = (sim.rng() - 0.5) * 80;
  }
  const tgt = b.target ? rain.byId.get(b.target) : null;
  let goal = tgt ? tgt.x + b.aimOffset : b.home;
  for (const it of rain.items) {
    if (it.kind !== 'rotten' || it.t0 > t || it.crossT <= t) continue;
    const tl = it.crossT - t;
    if (tl < 0.55 && Math.abs(it.x - b.x) < HV.BASKET_W / 2 + it.r) goal = it.x < b.x ? it.x + HV.BASKET_W / 2 + it.r + 12 : it.x - HV.BASKET_W / 2 - it.r - 12;
  }
  const d = goal - b.x;
  b.x = clampX(b.x + Math.sign(d) * Math.min(Math.abs(d), b.speed * dt));
}

/**
 * Продвигает ботов до момента toT (шагами BOT_STEP). Бот ловит помидор, если в момент пересечения
 * края корзина его накрывает. Раз в 9–15 с боты шутят над живой командой — в onPrank отдаётся
 * { at, from, kind }, цель выбирает сервис (лидер или случайный игрок соперников).
 */
export function stepBots(sim, rain, toT, effects = [], onPrank = null) {
  const dt = HV.BOT_STEP;
  while (sim.t + dt <= toT + 1e-9) {
    const t0 = sim.t, t1 = Math.round((sim.t + dt) * 1000) / 1000;
    for (const b of sim.bots) botThink(sim, b, rain, t1, dt, effects);
    for (const it of rain.items) {
      if (it.crossT <= t0) continue;
      if (it.crossT > t1) break;
      if (sim.caught.has(it.id)) continue;
      let best = null, bd = Infinity;
      for (const b of sim.bots) { const d = Math.abs(it.x - b.x); if (d <= HV.BASKET_W / 2 - 2 && d < bd) { best = b; bd = d; } }
      if (best) sim.caught.set(it.id, best.id);
    }
    sim.t = t1;
    // расписание шуток считается всегда (даже без onPrank) — иначе пересчёт с нуля дал бы другой rng
    if (sim.t >= sim.nextPrank) {
      sim.nextPrank = sim.t + 9 + sim.rng() * 6;
      const from = sim.bots[Math.floor(sim.rng() * sim.bots.length)];
      const kind = sim.rng() < 0.5 ? 'freeze' : 'splat';
      const pickLeader = sim.rng() < 0.5;
      const roll = sim.rng();
      onPrank?.({ at: sim.t, from: from.id, kind, pickLeader, roll });
    }
  }
  return sim;
}
