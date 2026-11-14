/**
 * Canvas-слой Tower Wars «Аксолотли против Томатиков»: процедурные томаты, снаряды, частицы и всплывающий урон.
 *
 * Сервер — единственный источник истины. Здесь ничего не считается «по-настоящему»: клиент только плавно
 * интерполирует позиции врагов между тиками (60 FPS) и проигрывает визуальные эффекты присланных выстрелов.
 * Канвас лежит поверх SVG с `viewBox="0 0 cols rows"` и `preserveAspectRatio="xMidYMid meet"` — поэтому рисуем
 * в тех же координатах клеток, повторяя letterbox SVG один в один.
 *
 * Без 2D-контекста (jsdom) рендерер молча ничего не делает: не бросает и не крутит requestAnimationFrame.
 */

// ---------------------------------------------------------------------------- Входные данные (структурно)
// Локальные интерфейсы совместимы с TdRound/TdEnemy/TdShot/TdEffect из `@/api/tomato` (план, §5):
// серверный тип присваивается им без приведения, а модуль не зависит от порядка правок в types.ts.

export interface EnemyLike {
  id: number;
  type: string;
  x: number;
  y: number;
  s: number;
  hp: number;
  maxHp: number;
  /** Текущая скорость, клеток в игровую секунду (с учётом замедления/ярости). */
  speed?: number;
  slowed?: boolean;
  hasted?: boolean;
  armor?: number;
  isMerc?: boolean;
}

export interface ShotLike {
  id: number;
  t: number;
  slot?: string;
  towerType: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetId?: number;
  damage?: number;
  splash?: number | null;
  slow?: boolean;
}

export interface EffectLike {
  id: number;
  kind: string;
  targetSlot?: string | null;
  expiresAtGameTime?: number;
  factor?: number;
}

export interface RoundLike {
  id?: string;
  status: string;
  /** Множитель игрового времени (игровых секунд в реальную). */
  speed: number;
  /** Игровое время раунда на момент снимка. */
  t: number;
  enemies: EnemyLike[];
  shots?: ShotLike[];
  effects?: EffectLike[];
}

export interface TdRendererOptions {
  cols: number;
  rows: number;
  path: [number, number][];
  slots: { id: string; x: number; y: number }[];
  reducedMotion?: boolean;
}

export interface TdRenderer {
  /** Новый снимок сервера. `receivedAt` — `performance.now()` в момент получения (компенсация задержки). */
  setRound(round: RoundLike | null, receivedAt: number): void;
  /** Перечитать размеры канваса (clientWidth/clientHeight) и devicePixelRatio. */
  resize(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------- Геометрия маршрута

export interface PathSeg { x1: number; y1: number; x2: number; y2: number; len: number; from: number; ux: number; uy: number }
export interface PathGeom { segs: PathSeg[]; total: number }

/** Предрасчёт отрезков полилинии: длины, накопленное расстояние и единичное направление. */
export function buildPath(path: [number, number][]): PathGeom {
  const segs: PathSeg[] = [];
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i], [x2, y2] = path[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, from: acc, ux: len ? (x2 - x1) / len : 1, uy: len ? (y2 - y1) / len : 0 });
    acc += len;
  }
  if (!segs.length) {
    const [x, y] = path[0] ?? [0, 0];
    segs.push({ x1: x, y1: y, x2: x, y2: y, len: 0, from: 0, ux: 1, uy: 0 });
  }
  return { segs, total: acc };
}

/** Точка на расстоянии `s` от входа (с зажимом в [0, total]) и направление движения в ней. */
export function pointOnPath(g: PathGeom, s: number): { x: number; y: number; dx: number; dy: number } {
  const d = Math.min(Math.max(s, 0), g.total);
  let seg = g.segs[g.segs.length - 1];
  for (const sg of g.segs) if (d <= sg.from + sg.len) { seg = sg; break; }
  const k = seg.len === 0 ? 0 : (d - seg.from) / seg.len;
  return { x: seg.x1 + (seg.x2 - seg.x1) * k, y: seg.y1 + (seg.y2 - seg.y1) * k, dx: seg.ux, dy: seg.uy };
}

/** Letterbox как у SVG `xMidYMid meet`: масштаб (пикселей на клетку) и отступы в CSS-пикселях. */
export function fitViewBox(w: number, h: number, cols: number, rows: number): { scale: number; offsetX: number; offsetY: number } {
  if (!(w > 0) || !(h > 0) || !(cols > 0) || !(rows > 0)) return { scale: 0, offsetX: 0, offsetY: 0 };
  const scale = Math.min(w / cols, h / rows);
  return { scale, offsetX: (w - cols * scale) / 2, offsetY: (h - rows * scale) / 2 };
}

// ---------------------------------------------------------------------------- Интерполяция врагов

/** Запасные скорости (клеток/игровую секунду), если сервер не прислал `speed` и оценки ещё нет. */
const BASE_SPEED: Record<string, number> = {
  runner: 1.4, grunt: 1, tank: 0.6, boss: 0.45, cherry: 1.6, ripe: 1.05, armored: 0.65, king: 0.5,
};

export interface InterpEnemy {
  id: number;
  type: string;
  /** Отображаемая позиция на маршруте. */
  s: number;
  /** Куда сходимся: серверная `s`, продвигаемая предсказанием между тиками. */
  targetS: number;
  speed: number;
  hp: number;
  maxHp: number;
  slowed: boolean;
  hasted: boolean;
  isMerc: boolean;
  armor: number;
  /** Последний серверный снимок — для оценки скорости, если `speed` не прислан. */
  lastServerS: number;
  lastServerT: number;
  /** Фаза подпрыгивания, чтобы толпа не прыгала в унисон. */
  phase: number;
  /** Остаток белой вспышки попадания, секунды. */
  flash: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface SyncContext {
  total: number;
  /** Множитель времени раунда. */
  roundSpeed: number;
  /** Игровое время снимка. */
  roundT: number;
  /** Сколько реальных секунд прошло с получения снимка (только для идущего раунда). */
  lagSec?: number;
  /** Ошибка (в клетках), начиная с которой не догоняем, а телепортируем. */
  snapDist?: number;
}

/**
 * Применяет серверный список врагов к локальному состоянию: новые появляются сразу на месте,
 * существующие получают новую цель (snap при большой ошибке), отсутствующие удаляются и возвращаются.
 */
export function syncEnemies(map: Map<number, InterpEnemy>, enemies: EnemyLike[], ctx: SyncContext): { added: InterpEnemy[]; removed: InterpEnemy[] } {
  const added: InterpEnemy[] = [];
  const removed: InterpEnemy[] = [];
  const snap = ctx.snapDist ?? 1.5;
  const lagGame = Math.max(0, ctx.lagSec ?? 0) * ctx.roundSpeed;
  const present = new Set<number>();
  for (const se of enemies) {
    present.add(se.id);
    let e = map.get(se.id);
    const fallback = (BASE_SPEED[se.type] ?? 1) * (se.slowed ? 0.5 : 1) * (se.hasted ? 1.4 : 1);
    if (!e) {
      const speed = typeof se.speed === "number" ? se.speed : fallback;
      const s0 = Math.min(ctx.total, se.s + speed * lagGame);
      e = {
        id: se.id, type: se.type, s: s0, targetS: s0, speed, hp: se.hp, maxHp: se.maxHp,
        slowed: !!se.slowed, hasted: !!se.hasted, isMerc: !!se.isMerc, armor: se.armor ?? 0,
        lastServerS: se.s, lastServerT: ctx.roundT, phase: (se.id * 2.399) % (Math.PI * 2), flash: 0,
        x: se.x, y: se.y, dx: 1, dy: 0,
      };
      map.set(se.id, e);
      added.push(e);
      continue;
    }
    let speed: number;
    if (typeof se.speed === "number") speed = se.speed;
    else {
      const dtGame = ctx.roundT - e.lastServerT;
      const est = dtGame > 0.05 ? (se.s - e.lastServerS) / dtGame : NaN;
      speed = Number.isFinite(est) && est >= 0 ? est : fallback;
    }
    if (se.hp < e.hp) e.flash = 0.16;
    e.type = se.type;
    e.speed = speed;
    e.hp = se.hp;
    e.maxHp = se.maxHp;
    e.slowed = !!se.slowed;
    e.hasted = !!se.hasted;
    e.isMerc = !!se.isMerc;
    e.armor = se.armor ?? 0;
    e.lastServerS = se.s;
    e.lastServerT = ctx.roundT;
    e.targetS = Math.min(ctx.total, se.s + speed * lagGame);
    if (Math.abs(e.targetS - e.s) > snap) e.s = e.targetS;
  }
  for (const [id, e] of map) if (!present.has(id)) { map.delete(id); removed.push(e); }
  return { added, removed };
}

/**
 * Шаг интерполяции: пока раунд идёт, и отображаемая, и целевая позиции едут со скоростью
 * `speed * roundSpeed * dt`; затем отображаемая экспоненциально догоняет цель (коэффициент `k` в 1/с).
 */
export function stepInterpolation(e: { s: number; targetS: number; speed: number }, dt: number, roundSpeed: number, running: boolean, total: number, k = 8): void {
  if (running && dt > 0) {
    const adv = e.speed * roundSpeed * dt;
    e.s += adv;
    e.targetS += adv;
  }
  if (e.targetS > total) e.targetS = total;
  e.s += (e.targetS - e.s) * (1 - Math.exp(-k * Math.max(0, dt)));
  e.s = Math.min(Math.max(e.s, 0), total);
}

/**
 * Новые выстрелы снимка. Каждый id проигрывается один раз; выстрел, впервые увиденный старше `maxAge`
 * игровых секунд, отмечается, но не проигрывается (без «залпа» при открытии). Забытые сервером id чистятся.
 */
export function collectNewShots(seen: Set<number>, shots: ShotLike[], roundT: number, maxAge = 1.2): ShotLike[] {
  const fresh: ShotLike[] = [];
  const present = new Set<number>();
  for (const sh of shots) {
    present.add(sh.id);
    if (seen.has(sh.id)) continue;
    seen.add(sh.id);
    if (roundT - sh.t > maxAge) continue;
    fresh.push(sh);
  }
  for (const id of seen) if (!present.has(id)) seen.delete(id);
  return fresh;
}

/** Цвет полоски HP по доле здоровья (0..1). */
export function hpColor(frac: number): string {
  return frac > 0.6 ? "#4ade80" : frac > 0.3 ? "#facc15" : "#ef4444";
}

type TomatoKind = "small" | "mid" | "armored" | "king";
interface TomatoStyle { r: number; kind: TomatoKind; body: 0 | 1 | 2 }
/** Размер (радиус в клетках) и облик врага; body: 0 — обычный, 1 — черри, 2 — спелый. */
const TOMATO: Record<string, TomatoStyle> = {
  runner: { r: 0.17, kind: "small", body: 0 },
  cherry: { r: 0.15, kind: "small", body: 1 },
  grunt: { r: 0.24, kind: "mid", body: 0 },
  ripe: { r: 0.26, kind: "mid", body: 2 },
  tank: { r: 0.34, kind: "armored", body: 0 },
  armored: { r: 0.34, kind: "armored", body: 2 },
  boss: { r: 0.5, kind: "king", body: 0 },
  king: { r: 0.5, kind: "king", body: 2 },
};
export const enemyRadius = (type: string) => (TOMATO[type] ?? TOMATO.grunt).r;

// ---------------------------------------------------------------------------- Состояние эффектов

type ShotKind = "arrow" | "cannon" | "frost";
interface Projectile {
  kind: ShotKind;
  x0: number; y0: number;
  tx: number; ty: number;
  targetId: number | null;
  t: number; dur: number; delay: number;
  damage: number; splash: number;
  trail: number[];
}

/** Виды частиц. */
const PK = { Drop: 0, Snow: 1, Ring: 2, Spark: 3, Smoke: 4 } as const;
type PK = (typeof PK)[keyof typeof PK];
interface Particle { k: PK; x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; size: number; color: string }
interface FloatText { x: number; y: number; text: string; color: string; life: number; max: number }
interface Dying { e: InterpEnemy; life: number; max: number; leak: boolean }

const MAX_PARTICLES = 300;
const MAX_TEXTS = 60;
const MAX_PROJECTILES = 120;
const TAU = Math.PI * 2;

/** Контур томата с пятью мягкими дольками в единичных координатах (радиус ≈ 1). */
const LOBE: [number, number][] = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * TAU;
  const r = 1 + 0.045 * Math.cos(5 * a + Math.PI / 2);
  return [Math.cos(a) * r * 1.06, Math.sin(a) * r * 0.94];
});

const NOOP_RENDERER: TdRenderer = { setRound() {}, resize() {}, destroy() {} };

// ---------------------------------------------------------------------------- Рендерер

export function createTdRenderer(canvas: HTMLCanvasElement, opts: TdRendererOptions): TdRenderer {
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas?.getContext?.("2d") ?? null; } catch { ctx = null; }
  if (!ctx) return NOOP_RENDERER;
  const c: CanvasRenderingContext2D = ctx;

  const reduced = !!opts.reducedMotion;
  const geom = buildPath(opts.path);
  const end = pointOnPath(geom, geom.total);

  // Размеры
  let dpr = 1, fit = { scale: 0, offsetX: 0, offsetY: 0 };
  // Состояние раунда
  let round: RoundLike | null = null;
  const enemies = new Map<number, InterpEnemy>();
  const seenShots = new Set<number>();
  const projectiles: Projectile[] = [];
  const particles: Particle[] = [];
  const texts: FloatText[] = [];
  const dying: Dying[] = [];
  let enraged = false, repairing = false;
  // Цикл
  let raf: number | null = null, last = 0, time = 0, destroyed = false;
  let ro: ResizeObserver | null = null;

  // Кэш градиентов в единичных координатах (CTM применяется в момент заливки)
  const grads = (() => {
    const body = (hi: string, mid: string, lo: string) => {
      const g = c.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.15);
      g.addColorStop(0, hi); g.addColorStop(0.45, mid); g.addColorStop(1, lo);
      return g;
    };
    const lin = (stops: [number, string][]) => {
      const g = c.createLinearGradient(0, -1.1, 0, 1);
      for (const [o, col] of stops) g.addColorStop(o, col);
      return g;
    };
    return {
      body: [body("#ff9a87", "#e8352b", "#8f1712"), body("#ffb08a", "#ff4b2e", "#a8200f"), body("#ff7a7a", "#c4141f", "#5e070c")],
      steel: lin([[0, "#f6f8fb"], [0.45, "#b3bcc7"], [1, "#59626d"]]),
      gold: lin([[0, "#fff4b8"], [0.5, "#f2b81f"], [1, "#9a640a"]]),
      merc: (() => { const g = c.createLinearGradient(-1, -1, 1, 1); g.addColorStop(0, "#c04dff"); g.addColorStop(1, "#ff7a1a"); return g; })(),
    };
  })();

  // ------------------------------------------------------------------ размеры
  function resize() {
    if (destroyed) return;
    const w = canvas.clientWidth || canvas.width || 0;
    const h = canvas.clientHeight || canvas.height || 0;
    dpr = Math.min(2.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    fit = fitViewBox(w, h, opts.cols, opts.rows);
    kick();
  }

  // ------------------------------------------------------------------ данные сервера
  function reset() {
    enemies.clear(); seenShots.clear();
    projectiles.length = 0; particles.length = 0; texts.length = 0; dying.length = 0;
  }

  function setRound(next: RoundLike | null, receivedAt: number) {
    if (destroyed) return;
    if (!next) { round = null; reset(); enraged = repairing = false; kick(); return; }
    const changed = !round || (next.id !== undefined && next.id !== round.id) || next.t < round.t - 0.001;
    if (changed) reset();
    round = next;
    const running = next.status === "running";
    const rs = Number.isFinite(next.speed) && next.speed > 0 ? next.speed : 1;
    const now = nowMs();
    const ago = now - receivedAt;
    const lagSec = running && Number.isFinite(ago) && ago >= 0 && ago < 3000 ? ago / 1000 : 0;

    const { added, removed } = syncEnemies(enemies, next.enemies ?? [], { total: geom.total, roundSpeed: rs, roundT: next.t, lagSec });
    for (const e of added) place(e);
    for (const e of removed) {
      const leak = e.s >= geom.total - 0.6;
      dying.push({ e, life: 0, max: leak ? 0.35 : 0.24, leak });
      if (!leak) burstJuice(e.x, e.y, enemyRadius(e.type));
    }

    const fresh = collectNewShots(seenShots, next.shots ?? [], next.t);
    if (fresh.length) {
      let minT = Infinity;
      for (const sh of fresh) minT = Math.min(minT, sh.t);
      // Выстрелы за тик проигрываются с теми же интервалами, что были в игре
      for (const sh of fresh) spawnProjectile(sh, Math.min(1, Math.max(0, (sh.t - minT) / rs)));
    }

    enraged = repairing = false;
    for (const ef of next.effects ?? []) {
      if (ef.expiresAtGameTime !== undefined && ef.expiresAtGameTime <= next.t) continue;
      if (ef.kind === "enrage_horde") enraged = true;
      if (ef.kind === "repair") repairing = true;
    }
    kick();
  }

  function place(e: InterpEnemy) {
    const p = pointOnPath(geom, e.s);
    e.x = p.x; e.y = p.y; e.dx = p.dx; e.dy = p.dy;
  }

  // ------------------------------------------------------------------ порождение эффектов
  function particle(k: PK, x: number, y: number, vx: number, vy: number, g: number, life: number, size: number, color: string) {
    if (reduced || particles.length >= MAX_PARTICLES) return;
    particles.push({ k, x, y, vx, vy, g, life, max: life, size, color });
  }

  const JUICE = ["#e8322b", "#c21d17", "#ff6b5a", "#b3120d"];
  function burstJuice(x: number, y: number, r: number, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 1.2 + Math.random() * 2.2;
      particle(PK.Drop, x, y, Math.cos(a) * v, Math.sin(a) * v - 1.2, 7, 0.45 + Math.random() * 0.35, r * (0.12 + Math.random() * 0.14), JUICE[i % JUICE.length]);
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * TAU;
      particle(PK.Drop, x, y, Math.cos(a) * 1.4, Math.sin(a) * 1.4 - 1, 6, 0.5, 0.025, "#f4e1a1");
    }
    particle(PK.Ring, x, y, 0, 0, 0, 0.3, r * 1.6, "rgba(232,50,43,0.8)");
  }

  function floatText(x: number, y: number, text: string, color: string) {
    if (texts.length >= MAX_TEXTS) texts.shift();
    const max = reduced ? 0.6 : 0.9;
    texts.push({ x: x + (reduced ? 0 : (Math.random() - 0.5) * 0.2), y, text, color, life: max, max });
  }

  function spawnProjectile(sh: ShotLike, delay: number) {
    if (projectiles.length >= MAX_PROJECTILES) return;
    const kind: ShotKind = sh.towerType === "cannon" ? "cannon" : sh.towerType === "frost" ? "frost" : "arrow";
    const dist = Math.hypot(sh.toX - sh.fromX, sh.toY - sh.fromY);
    const dur = kind === "cannon" ? 0.42 + dist * 0.05 : kind === "frost" ? 0.26 : 0.14 + dist * 0.03;
    projectiles.push({
      kind, x0: sh.fromX, y0: sh.fromY, tx: sh.toX, ty: sh.toY,
      targetId: typeof sh.targetId === "number" ? sh.targetId : null,
      t: 0, dur, delay, damage: sh.damage ?? 0, splash: sh.splash ?? 0, trail: [],
    });
  }

  function impact(p: Projectile) {
    const { tx: x, ty: y } = p;
    if (p.damage > 0) floatText(x, y - 0.15, `-${Math.round(p.damage)}`, p.kind === "cannon" ? "#ffd166" : p.kind === "frost" ? "#c9f6ff" : "#ffe4ef");
    if (p.kind === "cannon") {
      const rad = p.splash > 0 ? p.splash : 0.6;
      particle(PK.Ring, x, y, 0, 0, 0, 0.4, rad, "rgba(255,170,60,0.95)");
      particle(PK.Ring, x, y, 0, 0, 0, 0.3, rad * 0.6, "rgba(255,240,200,0.9)");
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, v = 1 + Math.random() * 2.6;
        particle(PK.Drop, x, y, Math.cos(a) * v, Math.sin(a) * v - 1.4, 7, 0.4 + Math.random() * 0.3, 0.03 + Math.random() * 0.04, JUICE[i % JUICE.length]);
      }
      for (let i = 0; i < 4; i++) particle(PK.Smoke, x, y, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.4, 0, 0.6, 0.12, "rgba(90,90,100,0.5)");
    } else if (p.kind === "frost") {
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * TAU, v = 0.3 + Math.random() * 0.9;
        particle(PK.Snow, x, y, Math.cos(a) * v, Math.sin(a) * v, -0.3, 0.6 + Math.random() * 0.3, 0.05 + Math.random() * 0.03, "#e6fbff");
      }
      particle(PK.Ring, x, y, 0, 0, 0, 0.3, 0.32, "rgba(140,220,255,0.9)");
    } else {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU, v = 1.5 + Math.random() * 1.5;
        particle(PK.Spark, x, y, Math.cos(a) * v, Math.sin(a) * v, 0, 0.18, 0.06, i % 2 ? "#ffffff" : "#ff8fb5");
      }
    }
  }

  // ------------------------------------------------------------------ обновление
  function update(dt: number) {
    time += dt;
    const running = round?.status === "running";
    const rs = round && Number.isFinite(round.speed) && round.speed > 0 ? round.speed : 1;

    for (const e of enemies.values()) {
      stepInterpolation(e, dt, rs, running, geom.total);
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
      place(e);
    }

    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i];
      d.life += dt;
      if (d.leak) {
        d.e.x += (end.x - d.e.x) * Math.min(1, dt * 8);
        d.e.y += (end.y - d.e.y) * Math.min(1, dt * 8);
      }
      if (d.life >= d.max) dying.splice(i, 1);
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      // Цель жива — снаряд доводится до её интерполированной позиции
      const tgt = p.targetId !== null ? enemies.get(p.targetId) : undefined;
      if (tgt) {
        const f = Math.min(1, dt * 14);
        p.tx += (tgt.x - p.tx) * f;
        p.ty += (tgt.y - p.ty) * f;
      }
      p.t += dt;
      if (!reduced && p.kind !== "frost") {
        const pos = projectilePos(p);
        p.trail.push(pos.x, pos.y);
        if (p.trail.length > 12) p.trail.splice(0, 2);
        if (p.kind === "cannon" && Math.random() < 0.5) particle(PK.Smoke, pos.x, pos.y, 0, -0.2, 0, 0.35, 0.05, "rgba(120,120,130,0.45)");
      }
      if (p.kind === "frost" && !reduced && Math.random() < 0.6) {
        const k = Math.random();
        particle(PK.Snow, p.x0 + (p.tx - p.x0) * k, p.y0 + (p.ty - p.y0) * k, (Math.random() - 0.5) * 0.4, 0.2, 0, 0.45, 0.04, "#e6fbff");
      }
      if (p.t >= p.dur) { impact(p); projectiles.splice(i, 1); }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.k === PK.Drop || q.k === PK.Spark) { q.vx *= 1 - Math.min(1, dt * 1.5); }
    }

    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      if (!reduced) t.y -= dt * 0.55;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }

  function projectilePos(p: Projectile): { x: number; y: number; k: number } {
    const k = Math.min(1, p.t / p.dur);
    const x = p.x0 + (p.tx - p.x0) * k;
    let y = p.y0 + (p.ty - p.y0) * k;
    if (p.kind === "cannon") {
      const h = 0.35 + Math.hypot(p.tx - p.x0, p.ty - p.y0) * 0.18;
      y -= 4 * h * k * (1 - k);
    }
    return { x, y, k };
  }

  // ------------------------------------------------------------------ отрисовка
  const cellTransform = () => c.setTransform(dpr * fit.scale, 0, 0, dpr * fit.scale, dpr * fit.offsetX, dpr * fit.offsetY);

  function draw() {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!(fit.scale > 0)) return;
    cellTransform();

    if (repairing) drawRepair();

    const list = [...enemies.values()].sort((a, b) => a.y - b.y);
    const running = round?.status === "running";
    for (const e of list) drawEnemy(e, 1, 1, running);
    for (const d of dying) {
      const k = d.life / d.max;
      if (d.leak) drawEnemy(d.e, 1 - k, 1 - k * 0.8, false);
      else drawEnemy(d.e, 1 - k, reduced ? 1 : 1 + k * 0.5, false);
    }

    for (const p of projectiles) if (p.delay <= 0) drawProjectile(p);
    for (const q of particles) drawParticle(q);
    drawTexts();
  }

  function lobePath() {
    c.beginPath();
    c.moveTo(LOBE[0][0], LOBE[0][1]);
    for (let i = 1; i < LOBE.length; i++) c.lineTo(LOBE[i][0], LOBE[i][1]);
    c.closePath();
  }

  /** Томат во «внутренних» координатах: центр (0,0), радиус 1. */
  function drawEnemy(e: InterpEnemy, alpha: number, scaleMul: number, running: boolean) {
    const st = TOMATO[e.type] ?? TOMATO.grunt;
    const r = st.r * scaleMul;
    const bounce = running && !reduced ? Math.sin(time * 12 + e.phase) : 0;
    const hop = Math.abs(bounce) * st.r * 0.16;
    const sx = 1 + 0.07 * bounce, sy = 1 - 0.07 * bounce;

    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, alpha));
    c.translate(e.x, e.y - hop);
    c.scale(r * sx, r * sy);

    // Ярость: красные линии скорости за спиной
    if (e.hasted && !reduced) {
      c.strokeStyle = "rgba(255,60,40,0.75)";
      c.lineWidth = 0.12;
      c.lineCap = "round";
      c.beginPath();
      for (const k of [-0.45, 0, 0.45]) {
        const px = -e.dy * k, py = e.dx * k, len = 1.75 + 0.25 * Math.sin(time * 20 + k * 5);
        c.moveTo(px - e.dx * 1.15, py - e.dy * 1.15);
        c.lineTo(px - e.dx * len, py - e.dy * len);
      }
      c.stroke();
    }

    if (st.kind === "king") drawSpikes();

    // Тело (у наёмника — свечение)
    lobePath();
    if (e.isMerc) {
      c.save();
      c.shadowColor = Math.sin(time * 8) > 0 ? "#b14dff" : "#ff7a1a";
      c.shadowBlur = 12 * dpr;
      c.fillStyle = grads.body[st.body];
      c.fill();
      c.restore();
    } else {
      c.fillStyle = grads.body[st.body];
      c.fill();
    }
    c.lineWidth = 0.06;
    c.strokeStyle = "rgba(90,10,8,0.6)";
    c.stroke();
    if (e.isMerc) {
      c.lineWidth = 0.14;
      c.strokeStyle = grads.merc;
      c.stroke();
    }
    // Складки долек и блик
    if (st.kind !== "small") {
      c.strokeStyle = "rgba(110,10,8,0.25)";
      c.lineWidth = 0.05;
      c.beginPath();
      c.moveTo(-0.3, -0.8); c.quadraticCurveTo(-0.55, 0, -0.3, 0.8);
      c.moveTo(0.3, -0.8); c.quadraticCurveTo(0.55, 0, 0.3, 0.8);
      c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.beginPath();
    c.ellipse(-0.4, -0.45, 0.22, 0.12, -0.6, 0, TAU);
    c.fill();

    if (st.kind === "armored" || st.kind === "king") drawArmor(st.kind === "king");
    else drawSepal(st.body === 1 ? 1.25 : 1);

    drawFace(e, st.kind);

    // Состояния: заморозка, ярость орды, вспышка попадания
    if (e.slowed || e.flash > 0 || enraged) {
      lobePath();
      if (e.slowed) { c.fillStyle = "rgba(140,215,255,0.38)"; c.fill(); }
      if (enraged) { c.fillStyle = `rgba(255,40,20,${reduced ? 0.15 : 0.12 + 0.12 * Math.sin(time * 6)})`; c.fill(); }
      if (e.flash > 0) { c.fillStyle = `rgba(255,255,255,${(e.flash / 0.16) * 0.55})`; c.fill(); }
    }
    if (e.slowed) {
      c.fillStyle = "#f2fdff";
      diamond(0.55, -0.55, 0.14);
      diamond(-0.6, 0.45, 0.1);
    }
    c.restore();

    if (alpha >= 0.99) drawHpBar(e, st);
  }

  function diamond(x: number, y: number, s: number) {
    c.beginPath();
    c.moveTo(x, y - s); c.lineTo(x + s * 0.6, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.6, y);
    c.closePath();
    c.fill();
  }

  /** Чашелистик и хвостик на макушке. */
  function drawSepal(scale: number) {
    c.save();
    c.translate(0, -0.86);
    c.scale(scale, scale);
    c.fillStyle = "#3f9e3a";
    c.strokeStyle = "#1f5c1c";
    c.lineWidth = 0.04;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rr = i % 2 === 0 ? 0.5 : 0.16;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.55;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = "#2f7a2b";
    c.fillRect(-0.05, -0.32, 0.1, 0.26);
    c.restore();
  }

  /** Шипы на латах Дредноута (рисуются за телом). */
  function drawSpikes() {
    c.fillStyle = grads.steel;
    c.strokeStyle = "#3f4650";
    c.lineWidth = 0.04;
    c.beginPath();
    for (const deg of [-170, -10, 160, 20, 130, 50, 180, 0]) {
      const a = (deg * Math.PI) / 180;
      c.moveTo(Math.cos(a - 0.17) * 0.92, Math.sin(a - 0.17) * 0.86);
      c.lineTo(Math.cos(a) * 1.4, Math.sin(a) * 1.3);
      c.lineTo(Math.cos(a + 0.17) * 0.92, Math.sin(a + 0.17) * 0.86);
    }
    c.fill();
    c.stroke();
  }

  /** Стальная каска и нагрудник с заклёпками; у Дредноута — полные латы, наплечники и золотая корона. */
  function drawArmor(king: boolean) {
    // Каска
    c.fillStyle = grads.steel;
    c.strokeStyle = "#3f4650";
    c.lineWidth = 0.05;
    c.beginPath();
    c.arc(0, -0.12, 1.02, Math.PI + 0.12, TAU - 0.12);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = king ? grads.gold : "#7d8792";
    c.beginPath();
    c.rect(-1.04, -0.22, 2.08, 0.14);
    c.fill();
    if (!king) {
      // Хвостик пробивается через каску
      c.fillStyle = "#3f9e3a";
      c.beginPath();
      c.ellipse(0, -1.14, 0.2, 0.08, 0, 0, TAU);
      c.fill();
    }
    // Нагрудник
    c.fillStyle = grads.steel;
    c.beginPath();
    c.moveTo(-0.66, 0.3);
    c.quadraticCurveTo(0, 0.18, 0.66, 0.3);
    c.lineTo(0.52, 0.78);
    c.quadraticCurveTo(0, 1.02, -0.52, 0.78);
    c.closePath();
    c.fill();
    c.strokeStyle = king ? "#c8901a" : "#3f4650";
    c.lineWidth = king ? 0.07 : 0.05;
    c.stroke();
    c.fillStyle = "#454c56";
    for (const [x, y] of [[-0.5, 0.38], [0.5, 0.38], [-0.4, 0.72], [0.4, 0.72]]) {
      c.beginPath();
      c.arc(x, y, 0.05, 0, TAU);
      c.fill();
    }
    if (!king) return;
    // Наплечники
    c.fillStyle = grads.steel;
    c.strokeStyle = "#c8901a";
    c.lineWidth = 0.05;
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.ellipse(sx * 0.92, 0.05, 0.3, 0.22, sx * 0.3, 0, TAU);
      c.fill();
      c.stroke();
    }
    // Эмблема-томат на груди
    c.fillStyle = "#d62f3a";
    c.beginPath();
    c.arc(0, 0.56, 0.11, 0, TAU);
    c.fill();
    // Корона
    c.fillStyle = grads.gold;
    c.strokeStyle = "#8a5a08";
    c.lineWidth = 0.05;
    c.beginPath();
    c.moveTo(-0.52, -1.0);
    c.lineTo(-0.6, -1.55);
    c.lineTo(-0.28, -1.27);
    c.lineTo(0, -1.66);
    c.lineTo(0.28, -1.27);
    c.lineTo(0.6, -1.55);
    c.lineTo(0.52, -1.0);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = "#e8394a";
    c.beginPath(); c.arc(0, -1.2, 0.08, 0, TAU); c.fill();
    c.fillStyle = "#3ab4ff";
    c.beginPath(); c.arc(-0.32, -1.13, 0.06, 0, TAU); c.arc(0.32, -1.13, 0.06, 0, TAU); c.fill();
  }

  /** Злые глаза, сдвинутые брови и рот. */
  function drawFace(e: InterpEnemy, kind: TomatoKind) {
    const big = kind === "small" ? 1.25 : 1;
    const ey = kind === "armored" || kind === "king" ? 0.04 : -0.02;
    const look = 0.06;
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(-0.3, ey, 0.17 * big, 0.19 * big, 0, 0, TAU);
    c.ellipse(0.3, ey, 0.17 * big, 0.19 * big, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#2a0706";
    c.beginPath();
    c.arc(-0.3 + e.dx * look, ey + 0.03 + e.dy * look, 0.085 * big, 0, TAU);
    c.arc(0.3 + e.dx * look, ey + 0.03 + e.dy * look, 0.085 * big, 0, TAU);
    c.fill();
    // Брови «домиком наоборот» — сердитые
    c.strokeStyle = "#3a0a08";
    c.lineWidth = 0.1;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-0.56, ey - 0.3); c.lineTo(-0.1, ey - 0.15);
    c.moveTo(0.56, ey - 0.3); c.lineTo(0.1, ey - 0.15);
    c.stroke();
    if (kind === "armored") return; // рот прикрыт нагрудником
    if (kind === "king") {
      c.fillStyle = "#fff";
      c.fillRect(-0.18, 0.2, 0.36, 0.1);
      c.strokeStyle = "#3a0a08";
      c.lineWidth = 0.03;
      c.strokeRect(-0.18, 0.2, 0.36, 0.1);
      c.beginPath();
      c.moveTo(-0.06, 0.2); c.lineTo(-0.06, 0.3);
      c.moveTo(0.06, 0.2); c.lineTo(0.06, 0.3);
      c.stroke();
      return;
    }
    c.lineWidth = 0.07;
    c.beginPath();
    c.arc(0, 0.5, 0.2, Math.PI * 1.2, Math.PI * 1.8);
    c.stroke();
  }

  function drawHpBar(e: InterpEnemy, st: TomatoStyle) {
    const frac = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
    const w = Math.max(0.34, st.r * 1.7), h = 0.065;
    const top = e.y - st.r * (st.kind === "king" ? 1.75 : st.kind === "armored" ? 1.2 : 1.12);
    const x = e.x - w / 2, y = top - 0.12;
    c.fillStyle = "rgba(15,10,20,0.6)";
    c.fillRect(x - 0.015, y - 0.015, w + 0.03, h + 0.03);
    c.fillStyle = hpColor(frac);
    c.fillRect(x, y, w * frac, h);
    if (e.isMerc) drawSwords(e.x, y - 0.1);
  }

  /** Значок наёмника: скрещённые мечи. */
  function drawSwords(x: number, y: number) {
    const s = 0.075;
    c.save();
    c.lineCap = "round";
    c.strokeStyle = "#2a1038";
    c.lineWidth = 0.05;
    swordsPath(x, y, s);
    c.stroke();
    c.strokeStyle = "#ffd166";
    c.lineWidth = 0.025;
    swordsPath(x, y, s);
    c.stroke();
    c.restore();
  }
  function swordsPath(x: number, y: number, s: number) {
    c.beginPath();
    c.moveTo(x - s, y - s); c.lineTo(x + s, y + s);
    c.moveTo(x + s, y - s); c.lineTo(x - s, y + s);
    // гарды
    c.moveTo(x + s * 0.35, y + s * 0.95); c.lineTo(x + s * 0.95, y + s * 0.35);
    c.moveTo(x - s * 0.35, y + s * 0.95); c.lineTo(x - s * 0.95, y + s * 0.35);
  }

  function drawProjectile(p: Projectile) {
    const pos = projectilePos(p);
    if (p.kind === "frost") {
      const fade = 1 - pos.k * 0.6;
      c.save();
      c.lineCap = "round";
      c.globalAlpha = fade;
      if (!reduced) { c.shadowColor = "#7fe3ff"; c.shadowBlur = 10 * dpr; }
      c.strokeStyle = "rgba(127,227,255,0.85)";
      c.lineWidth = 0.1;
      c.beginPath(); c.moveTo(p.x0, p.y0); c.lineTo(p.tx, p.ty); c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = "#ffffff";
      c.lineWidth = 0.035;
      c.beginPath(); c.moveTo(p.x0, p.y0); c.lineTo(p.tx, p.ty); c.stroke();
      c.restore();
      return;
    }
    // След
    if (p.trail.length >= 4) {
      c.save();
      c.lineCap = "round";
      c.strokeStyle = p.kind === "cannon" ? "rgba(80,80,90,0.35)" : "rgba(255,143,181,0.55)";
      c.lineWidth = p.kind === "cannon" ? 0.08 : 0.04;
      c.beginPath();
      c.moveTo(p.trail[0], p.trail[1]);
      for (let i = 2; i < p.trail.length; i += 2) c.lineTo(p.trail[i], p.trail[i + 1]);
      c.lineTo(pos.x, pos.y);
      c.stroke();
      c.restore();
    }
    if (p.kind === "cannon") {
      // Тень на земле и ядро
      const gx = p.x0 + (p.tx - p.x0) * pos.k, gy = p.y0 + (p.ty - p.y0) * pos.k;
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.beginPath(); c.ellipse(gx, gy + 0.05, 0.08, 0.035, 0, 0, TAU); c.fill();
      c.fillStyle = "#2b2f36";
      c.beginPath(); c.arc(pos.x, pos.y, 0.09, 0, TAU); c.fill();
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.beginPath(); c.arc(pos.x - 0.03, pos.y - 0.03, 0.025, 0, TAU); c.fill();
      return;
    }
    // Стрела
    const ang = Math.atan2(p.ty - p.y0, p.tx - p.x0);
    c.save();
    c.translate(pos.x, pos.y);
    c.rotate(ang);
    c.strokeStyle = "#7a4a24";
    c.lineWidth = 0.035;
    c.beginPath(); c.moveTo(-0.26, 0); c.lineTo(0, 0); c.stroke();
    c.fillStyle = "#3fbf6a";
    c.beginPath(); c.moveTo(0.08, 0); c.lineTo(-0.02, -0.05); c.lineTo(-0.02, 0.05); c.closePath(); c.fill();
    c.strokeStyle = "#ff7aa8";
    c.lineWidth = 0.03;
    c.beginPath();
    c.moveTo(-0.26, 0); c.lineTo(-0.32, -0.05);
    c.moveTo(-0.26, 0); c.lineTo(-0.32, 0.05);
    c.stroke();
    c.restore();
  }

  function drawParticle(q: Particle) {
    const a = Math.max(0, q.life / q.max);
    c.globalAlpha = a;
    switch (q.k) {
      case PK.Drop:
        c.fillStyle = q.color;
        c.beginPath(); c.arc(q.x, q.y, q.size, 0, TAU); c.fill();
        break;
      case PK.Smoke:
        c.fillStyle = q.color;
        c.beginPath(); c.arc(q.x, q.y, q.size * (1 + (1 - a) * 1.5), 0, TAU); c.fill();
        break;
      case PK.Ring:
        c.strokeStyle = q.color;
        c.lineWidth = 0.05 * a + 0.01;
        c.beginPath(); c.arc(q.x, q.y, Math.max(0.01, q.size * (reduced ? 1 : 0.25 + 0.75 * (1 - a))), 0, TAU); c.stroke();
        break;
      case PK.Spark:
        c.strokeStyle = q.color;
        c.lineWidth = 0.025;
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04); c.stroke();
        break;
      case PK.Snow: {
        const s = q.size;
        c.strokeStyle = q.color;
        c.lineWidth = 0.015;
        c.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = (i * Math.PI) / 3 + time;
          c.moveTo(q.x - Math.cos(ang) * s, q.y - Math.sin(ang) * s);
          c.lineTo(q.x + Math.cos(ang) * s, q.y + Math.sin(ang) * s);
        }
        c.stroke();
        break;
      }
    }
    c.globalAlpha = 1;
  }

  /** «Ремонт»: бирюзовое мерцание у базы (конец маршрута). */
  function drawRepair() {
    const pulse = reduced ? 0 : Math.sin(time * 4);
    c.save();
    c.strokeStyle = `rgba(94,231,255,${0.45 + 0.2 * pulse})`;
    c.lineWidth = 0.05;
    c.beginPath(); c.arc(end.x, end.y, 0.58 + 0.05 * pulse, 0, TAU); c.stroke();
    if (!reduced) {
      c.fillStyle = "rgba(200,250,255,0.85)";
      for (let i = 0; i < 5; i++) {
        const a = time * 1.5 + (i * TAU) / 5;
        const rr = 0.45 + 0.12 * Math.sin(time * 3 + i);
        c.beginPath(); c.arc(end.x + Math.cos(a) * rr, end.y + Math.sin(a) * rr, 0.03, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  /** Всплывающий урон — в пиксельных координатах, чтобы шрифт не зависел от масштаба клетки. */
  function drawTexts() {
    if (!texts.length) return;
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = Math.round(Math.max(10, Math.min(20, fit.scale * 0.3)));
    c.font = `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = 3;
    for (const t of texts) {
      const x = fit.offsetX + t.x * fit.scale, y = fit.offsetY + t.y * fit.scale;
      c.globalAlpha = Math.min(1, (t.life / t.max) * 1.6);
      c.strokeStyle = "rgba(40,6,10,0.85)";
      c.strokeText(t.text, x, y);
      c.fillStyle = t.color;
      c.fillText(t.text, x, y);
    }
    c.restore();
  }

  // ------------------------------------------------------------------ цикл
  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function busy() {
    return round?.status === "running" || enemies.size > 0 || projectiles.length > 0 || particles.length > 0
      || texts.length > 0 || dying.length > 0 || (repairing && !reduced);
  }

  function frame(ts: number) {
    raf = null;
    if (destroyed) return;
    const t = Number.isFinite(ts) ? ts : nowMs();
    const dt = last ? Math.min(0.1, Math.max(0, (t - last) / 1000)) : 1 / 60;
    last = t;
    update(dt);
    draw();
    // Нечего анимировать — кадр нарисован, цикл засыпает до следующего setRound/resize
    if (busy()) schedule();
    else last = 0;
  }

  function schedule() {
    if (raf !== null || destroyed) return;
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
  }

  function kick() { schedule(); }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    raf = null;
    ro?.disconnect();
    ro = null;
    reset();
    round = null;
  }

  if (typeof ResizeObserver === "function") {
    try { ro = new ResizeObserver(() => resize()); ro.observe(canvas); } catch { ro = null; }
  }
  resize();

  return { setRound, resize, destroy };
}
