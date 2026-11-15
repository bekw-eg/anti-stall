/**
 * Клиентская копия движка Harvest (backend/src/harvest/engine.js): дождь из зерна раунда и положение помидора.
 * Сервер и клиенты рисуют один и тот же дождь; что поймано и сколько очков — решает сервер.
 * Совпадение с серверной версией проверяет harvestEngine.test.ts.
 */
export const HV = {
  W: 1000, H: 600, RIM: 492, GROUND: 556,
  BASKET_W: 112, BASKET_H: 46,
  GRAVITY: 70,
  MAX_CHARGES: 3,
  PLAYER_SPEED: 760, KEY_SPEED: 640,
} as const;

export type HarvestKind = "good" | "golden" | "rotten";
export const KINDS: Record<HarvestKind, { pts: number; r: number; color: string }> = {
  good: { pts: 1, r: 19, color: "#E26D5A" },
  golden: { pts: 3, r: 17, color: "#F2B84B" },
  rotten: { pts: -2, r: 19, color: "#7D625E" },
};

export interface RainItem { id: number; kind: HarvestKind; r: number; x: number; t0: number; vy0: number; spin0: number; crossT: number; groundT: number }
export interface Rain { seed: number; duration: number; items: RainItem[]; byId: Map<number, RainItem> }

export function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const timeToY = (it: { vy0: number; r: number }, y: number) => {
  const a = HV.GRAVITY / 2, b = it.vy0, c = -(y + it.r);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};

export function makeRain(seed: number, duration: number): Rain {
  const rng = rngFrom(seed);
  const items: RainItem[] = [];
  let t = 0.6;
  let id = 1;
  while (t < duration) {
    const p = t / duration;
    const r = rng();
    const kind: HarvestKind = r < 0.07 ? "golden" : r < 0.07 + 0.18 + 0.12 * p ? "rotten" : "good";
    const k = KINDS[kind];
    const base = { id: id++, kind, r: k.r, x: Math.round(40 + rng() * (HV.W - 80)), t0: Math.round(t * 1000) / 1000, vy0: Math.round(150 + rng() * 90 + p * 120), spin0: Math.round(rng() * 628) / 100 };
    const it: RainItem = {
      ...base,
      crossT: Math.round((base.t0 + timeToY(base, HV.RIM)) * 1000) / 1000,
      groundT: Math.round((base.t0 + timeToY(base, HV.GROUND - base.r * 0.4)) * 1000) / 1000,
    };
    if (it.crossT <= duration) items.push(it);
    t += 0.8 - 0.34 * p + rng() * 0.12;
  }
  items.sort((a, b) => a.crossT - b.crossT || a.id - b.id);
  return { seed, duration, items, byId: new Map(items.map((i) => [i.id, i])) };
}

/** Положение помидора в момент t (с от старта раунда); null — ещё не появился или уже упал. */
export function itemAt(it: RainItem, t: number) {
  const tau = t - it.t0;
  if (tau < 0 || t > it.groundT) return null;
  return { x: it.x, y: -it.r + it.vy0 * tau + (HV.GRAVITY / 2) * tau * tau, spin: it.spin0 + tau * 2 };
}

export const multOf = (combo: number) => 1 + Math.min(2, Math.floor(combo / 5));
export const coversItem = (it: RainItem, x: number) => Math.abs(it.x - x) <= HV.BASKET_W / 2 - 2;
export const clampX = (x: number) => Math.max(HV.BASKET_W / 2, Math.min(HV.W - HV.BASKET_W / 2, x));
