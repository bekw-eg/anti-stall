import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPath, collectNewShots, createTdRenderer, fitViewBox, pointOnPath, stepInterpolation, syncEnemies,
  type EnemyLike, type InterpEnemy, type RoundLike, type ShotLike,
} from "./tdCanvas";
import type { TdRound } from "@/api/tomato";

// Контракт: серверный раунд присваивается локальному структурному типу рендерера без приведения
const roundContract = (r: TdRound): RoundLike | null => r;

const PATH: [number, number][] = [[0.5, 1.5], [4.5, 1.5], [4.5, 4.5], [8.5, 4.5], [8.5, 2.5], [11.5, 2.5]];
const geom = buildPath(PATH);

const enemy = (over: Partial<EnemyLike> = {}): EnemyLike => ({
  id: 1, type: "grunt", x: 0.5, y: 1.5, s: 0, hp: 90, maxHp: 90, speed: 1, slowed: false, hasted: false, armor: 0, isMerc: false, ...over,
});

const shot = (over: Partial<ShotLike> = {}): ShotLike => ({
  id: 1, t: 10, slot: "s1", towerType: "arrow", fromX: 2.5, fromY: 2.5, toX: 3, toY: 1.5, targetId: 1, damage: 12, splash: null, slow: false, ...over,
});

describe("геометрия маршрута", () => {
  it("считает длину полилинии и точки на углах", () => {
    expect(roundContract(null)).toBeNull();
    expect(geom.total).toBeCloseTo(4 + 3 + 4 + 2 + 3);
    expect(pointOnPath(geom, 0)).toMatchObject({ x: 0.5, y: 1.5, dx: 1, dy: 0 });
    const corner = pointOnPath(geom, 4);
    expect(corner.x).toBeCloseTo(4.5);
    expect(corner.y).toBeCloseTo(1.5);
    const down = pointOnPath(geom, 5.5);
    expect(down).toMatchObject({ x: 4.5, y: 3, dx: 0, dy: 1 });
    const up = pointOnPath(geom, 4 + 3 + 4 + 1);
    expect(up.x).toBeCloseTo(8.5);
    expect(up.y).toBeCloseTo(3.5);
    expect(up.dy).toBe(-1);
  });

  it("зажимает s в пределах маршрута", () => {
    expect(pointOnPath(geom, -3)).toMatchObject({ x: 0.5, y: 1.5 });
    expect(pointOnPath(geom, 999)).toMatchObject({ x: 11.5, y: 2.5 });
  });

  it("fitViewBox повторяет xMidYMid meet", () => {
    // Широкий контейнер — поля слева и справа
    expect(fitViewBox(1200, 350, 12, 7)).toEqual({ scale: 50, offsetX: 300, offsetY: 0 });
    // Высокий контейнер — поля сверху и снизу
    expect(fitViewBox(240, 400, 12, 7)).toEqual({ scale: 20, offsetX: 0, offsetY: 130 });
    expect(fitViewBox(0, 100, 12, 7).scale).toBe(0);
  });
});

describe("интерполяция врагов", () => {
  it("продвигает позицию на speed * round.speed * dt", () => {
    const e = { s: 2, targetS: 2, speed: 1.5 };
    stepInterpolation(e, 0.1, 2, true, geom.total);
    expect(e.s).toBeCloseTo(2.3, 6);
    expect(e.targetS).toBeCloseTo(2.3, 6);
  });

  it("стоит на месте, если раунд не идёт", () => {
    const e = { s: 2, targetS: 2, speed: 1.5 };
    stepInterpolation(e, 0.1, 2, false, geom.total);
    expect(e.s).toBe(2);
  });

  it("плавно сходится к серверной s", () => {
    const e = { s: 3, targetS: 3.8, speed: 0 };
    stepInterpolation(e, 1 / 60, 1, true, geom.total);
    expect(e.s).toBeGreaterThan(3);
    expect(e.s).toBeLessThan(3.8);
    for (let i = 0; i < 120; i++) stepInterpolation(e, 1 / 60, 1, true, geom.total);
    expect(e.s).toBeCloseTo(3.8, 3);
  });

  it("не выходит за конец маршрута", () => {
    const e = { s: geom.total - 0.01, targetS: geom.total - 0.01, speed: 5 };
    stepInterpolation(e, 0.1, 1, true, geom.total);
    expect(e.s).toBeLessThanOrEqual(geom.total);
  });

  it("новый враг ставится сразу на серверную позицию, большая ошибка — snap, малая — догоняем", () => {
    const map = new Map<number, InterpEnemy>();
    const ctx = { total: geom.total, roundSpeed: 1, roundT: 5 };
    const r1 = syncEnemies(map, [enemy({ id: 1, s: 3 })], ctx);
    expect(r1.added.map((e) => e.id)).toEqual([1]);
    expect(map.get(1)!.s).toBe(3);

    syncEnemies(map, [enemy({ id: 1, s: 3.4 })], { ...ctx, roundT: 5.4 });
    expect(map.get(1)!.s).toBe(3);
    expect(map.get(1)!.targetS).toBeCloseTo(3.4);

    syncEnemies(map, [enemy({ id: 1, s: 6 })], { ...ctx, roundT: 6 });
    expect(map.get(1)!.s).toBe(6);
  });

  it("удаляет врагов, которых нет в снимке сервера", () => {
    const map = new Map<number, InterpEnemy>();
    const ctx = { total: geom.total, roundSpeed: 1, roundT: 1 };
    syncEnemies(map, [enemy({ id: 1 }), enemy({ id: 2, s: 1 })], ctx);
    const { removed, added } = syncEnemies(map, [enemy({ id: 2, s: 1.2 })], { ...ctx, roundT: 1.2 });
    expect(added).toEqual([]);
    expect(removed.map((e) => e.id)).toEqual([1]);
    expect([...map.keys()]).toEqual([2]);
  });

  it("оценивает скорость по снимкам, если сервер её не прислал", () => {
    const map = new Map<number, InterpEnemy>();
    syncEnemies(map, [enemy({ id: 1, s: 1, speed: undefined })], { total: geom.total, roundSpeed: 1, roundT: 2 });
    syncEnemies(map, [enemy({ id: 1, s: 1.5, speed: undefined })], { total: geom.total, roundSpeed: 1, roundT: 3 });
    expect(map.get(1)!.speed).toBeCloseTo(0.5);
  });
});

describe("выстрелы", () => {
  it("каждый id проигрывается один раз, старые при первом показе пропускаются", () => {
    const seen = new Set<number>();
    const first = collectNewShots(seen, [shot({ id: 1, t: 8 }), shot({ id: 2, t: 9.5 }), shot({ id: 3, t: 10 })], 10);
    expect(first.map((s) => s.id)).toEqual([2, 3]);
    const second = collectNewShots(seen, [shot({ id: 2, t: 9.5 }), shot({ id: 3, t: 10 }), shot({ id: 4, t: 10.4 })], 10.5);
    expect(second.map((s) => s.id)).toEqual([4]);
    // id 1 исчез из списка сервера — забыт
    expect(seen.has(1)).toBe(false);
  });
});

describe("createTdRenderer", () => {
  const opts = { cols: 12, rows: 7, path: PATH, slots: [{ id: "s1", x: 2.5, y: 2.5 }] };
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("без 2D-контекста — тихий no-op без requestAnimationFrame", () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    const r = createTdRenderer(canvas, opts);
    expect(() => {
      r.resize();
      r.setRound({ status: "running", speed: 1, t: 0, enemies: [enemy()] }, 0);
      r.setRound(null, 0);
      r.destroy();
    }).not.toThrow();
    expect(raf).not.toHaveBeenCalled();
  });

  /** Заглушка 2D-контекста: любые методы — no-op, градиенты принимают стопы. */
  const fakeContext = () => {
    const store: Record<string | symbol, unknown> = {};
    const gradient = { addColorStop: () => {} };
    return new Proxy(store, {
      get: (t, k) => (k in t ? t[k] : (t[k] = vi.fn(() => gradient))),
      set: (t, k, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  };

  it("рисует все виды томатов, снаряды и эффекты без ошибок; destroy отменяет кадр", () => {
    let pending: FrameRequestCallback | null = null;
    let nextId = 0;
    const raf = vi.fn((cb: FrameRequestCallback) => { pending = cb; return ++nextId; });
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 600 });
    Object.defineProperty(canvas, "clientHeight", { value: 350 });
    vi.spyOn(canvas, "getContext").mockReturnValue(fakeContext() as never);

    const r = createTdRenderer(canvas, opts);
    expect(canvas.width).toBeGreaterThan(0);
    const types = ["runner", "grunt", "tank", "boss", "cherry", "ripe", "armored", "king"];
    const round: RoundLike = {
      id: "r1", status: "running", speed: 2, t: 10,
      enemies: types.map((type, i) => enemy({ id: i + 1, type, s: 1 + i * 1.5, slowed: i % 2 === 0, hasted: i % 3 === 0, isMerc: i >= 4 })),
      shots: [
        shot({ id: 1, towerType: "arrow", targetId: 1 }),
        shot({ id: 2, towerType: "cannon", splash: 0.9, targetId: 2, t: 10 }),
        shot({ id: 3, towerType: "frost", slow: true, targetId: 99, t: 9.9 }),
      ],
      effects: [{ id: 1, kind: "enrage_horde", targetSlot: null, expiresAtGameTime: 20, factor: 1.4 }, { id: 2, kind: "repair", targetSlot: null, expiresAtGameTime: 20, factor: 0.3 }],
    };
    r.setRound(round, performance.now());
    expect(raf).toHaveBeenCalled();
    // Прогоняем ~1.5 секунды кадров: попадания, частицы, всплывающий урон
    let ts = 1000;
    for (let i = 0; i < 90 && pending; i++) { const cb = pending; pending = null; ts += 16; cb(ts); }
    // Убираем двух врагов (смерть и утечка у базы) и ещё кадры
    r.setRound({ ...round, t: 10.5, shots: [], enemies: round.enemies.slice(2).map((e) => ({ ...e, s: e.s + 0.5, hp: e.hp - 10 })) }, performance.now());
    for (let i = 0; i < 30 && pending; i++) { const cb = pending; pending = null; ts += 16; cb(ts); }

    expect(pending).not.toBeNull();
    r.destroy();
    expect(caf).toHaveBeenCalledWith(nextId);
    // После destroy ничего не планируется
    const calls = raf.mock.calls.length;
    r.setRound(round, performance.now());
    r.resize();
    expect(raf.mock.calls.length).toBe(calls);
  });

  it("без идущего раунда цикл засыпает", () => {
    let pending: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => { pending = cb; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(fakeContext() as never);
    const r = createTdRenderer(canvas, { ...opts, reducedMotion: true });
    r.setRound({ status: "won", speed: 1, t: 30, enemies: [] }, 0);
    let frames = 0;
    while (pending && frames < 10) { const cb = pending; pending = null; frames++; cb(16 * frames); }
    expect(frames).toBe(1);
    r.destroy();
  });
});
