// @vitest-environment node
/**
 * Интеграционные тесты клиентского слоя против НАСТОЯЩЕГО backend (в памяти, управляемые часы):
 * проверяют, что контракт REST/WebSocket, на который опирается новый интерфейс, действительно работает.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../../backend/src/app.js";
import { FakeClock } from "../../../../backend/src/clock.js";
import { loadConfig } from "../../../../backend/src/config.js";
import { TomatoApiError, TomatoClient } from "./client";
import type { RoomSnapshot, ServerEvent } from "./types";

interface BackendApp {
  listen(port: number, host: string): Promise<{ port: number }>;
  close(): Promise<void>;
  tick(): void;
  hub: { conns: Set<{ ws: { terminate(): void } }> };
}
interface Clock { advance(ms: number): number; now(): number }
let app: BackendApp;
let clock: Clock;
let base: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await sleep(15);
  }
}
/** Ожидает ошибку запроса и возвращает её. */
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("ожидалась ошибка"); }, (e: unknown) => e as TomatoApiError);
async function player(name: string) {
  const c = new TomatoClient({ baseUrl: base });
  await c.register(name);
  return c;
}
/** Двигает управляемые часы и тикает сервер; перечисленные клиенты «живы». */
async function advance(ms: number, alive: TomatoClient[]) {
  for (let left = ms; left > 0; left -= 5000) {
    clock.advance(Math.min(5000, left));
    for (const c of alive) await c.request("POST", "/api/heartbeat", {});
    app.tick();
  }
}

beforeAll(async () => {
  clock = new FakeClock();
  app = createApp({ config: loadConfig({}, { dbPath: ":memory:" }), clock });
  const addr = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => app.close());

describe("клиент ↔ backend: Road Map", () => {
  it("карта приходит с сервера, этап засчитывается сервером, все видят одно и то же, событие node_reached доходит по WS", async () => {
    const lotti = await player("Карта-1");
    const anya = await player("Карта-2");
    const snap = await lotti.createRoom({ name: "Карта", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const road0 = await lotti.roadmap(id);
    expect(road0.positionNodeId).toBe("camp");
    expect(road0.next).toEqual({ nodeId: "forest", title: "Лес знаний", pointsNeeded: 2 });
    expect(road0.edges).toHaveLength(3);
    expect(road0.teams).toHaveLength(1);

    const events: ServerEvent[] = [];
    const sock = anya.connect();
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => events.some((e) => e.type === "room_state"));

    await lotti.startFocus(id);
    await advance(25 * 60_000 + 1000, [lotti, anya]); // обе сессии завершены → 2 очка → этап «Лес знаний»
    const [a, b] = await Promise.all([lotti.roadmap(id), anya.roadmap(id)]);
    expect(a).toEqual(b); // синхронизация между участниками
    expect(a.positionNodeId).toBe("forest");
    expect(a.nodes.find((n) => n.id === "forest")?.reachedAt).toBeGreaterThan(0);
    expect(a.segment).toEqual({ from: "forest", to: "bridge", progress: 0 });

    const reached = await until(() => events.find((e) => e.type === "node_reached"));
    expect((reached.data as { nodeId: string }).nodeId).toBe("forest");
    expect((await lotti.progress()).xp).toBe(125); // 100 за сессию + 25 за этап (начислил сервер)
    expect((await lotti.room(id)).challenge.positionNodeId).toBe("forest"); // тот же снимок в room_state
    sock.close();
  });
});

describe("клиент ↔ backend: Team A/B", () => {
  it("режим команд: автобаланс, смена команды, раздельная карта, победитель — всем одинаково", async () => {
    const lotti = await player("Тим-1");
    const anya = await player("Тим-2");
    const snap = await lotti.createRoom({ name: "A vs B", focusMinutes: 25, breakMinutes: 5, teamMode: true });
    expect(snap.room.mode).toBe("teams");
    const joined = await anya.joinByCode(snap.room.code);
    expect(joined.members.map((m) => m.team)).toEqual(["A", "B"]);
    expect(joined.me?.team).toBe("B");
    expect(joined.me?.allowedActions).toContain("set_team");
    const switched = await anya.setTeam(snap.room.id, "A");
    expect(switched.me?.team).toBe("A");
    await anya.setTeam(snap.room.id, "B");

    const id = snap.room.id;
    const mine = await lotti.roadmap(id);
    const theirs = await anya.roadmap(id);
    expect(mine.mode).toBe("teams");
    expect([mine.teamKey, theirs.teamKey]).toEqual(["A", "B"]);
    expect(mine.teams.map((t) => t.key)).toEqual(["A", "B"]);

    // по одному игроку в команде идут вровень: через 6 циклов — ничья, обе команды награждены
    for (let i = 0; i < 6; i++) {
      await lotti.startFocus(id);
      await advance(25 * 60_000 + 1000, [lotti, anya]);
      await advance(5 * 60_000, [lotti, anya]);
    }
    const [a, b] = await Promise.all([lotti.roadmap(id), anya.roadmap(id)]);
    expect(a.winner).toBe("draw");
    expect(b.winner).toBe("draw");
    expect(a.completed && b.completed).toBe(true);
    expect(a.teams.map((t) => t.points)).toEqual([6, 6]);
    await lotti.setTeam(id, "B"); // между циклами (waiting) смена разрешена
    await lotti.setTeam(id, "A");
    await lotti.startFocus(id);
    expect((await fail(lotti.setTeam(id, "B"))).code).toBe("WRONG_PHASE"); // во время сессии — нет
  });
});

describe("клиент ↔ backend", () => {
  it("создание комнаты, вход по коду, одинаковое состояние у обоих", async () => {
    const lotti = await player("Лотти");
    const anya = await player("Аня");
    const created = await lotti.createRoom({ name: "Боталка", focusMinutes: 25, breakMinutes: 5 });
    expect(created.room.phase).toBe("waiting");
    expect(created.me?.isHost).toBe(true);
    const joined = await anya.joinByCode(created.room.code);
    expect(joined.members.map((m) => m.name).sort()).toEqual(["Аня", "Лотти"]);
    const a = await lotti.room(created.room.id);
    const b = await anya.room(created.room.id);
    expect(a.room.id).toBe(b.room.id);
    expect(a.me?.allowedActions).toContain("start_focus");
    expect(b.me?.allowedActions).not.toContain("start_focus");
  });

  it("общая сессия: время приходит с сервера, фазы и награды определяет сервер", async () => {
    const lotti = await player("Лотти2");
    const anya = await player("Аня2");
    const snap = await lotti.createRoom({ name: "Фокус", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const started = await lotti.startFocus(id);
    expect(started.room.phase).toBe("focus");
    expect(started.room.phaseEndsAt! - started.room.phaseStartedAt).toBe(25 * 60_000);
    await advance(10 * 60_000, [lotti, anya]);
    const mid = await anya.room(id);
    expect(mid.room.remainingMs).toBe(15 * 60_000); // то, что рисует таймер: phaseEndsAt − serverTime
    expect(mid.room.serverTime).toBe(clock.now());

    // досрочный выход одного, второй доходит до конца
    await anya.abortSession(id);
    await advance(15 * 60_000 + 1000, [lotti, anya]);
    const end = await lotti.room(id);
    expect(end.room.phase).toBe("break");
    const [pl, pa] = await Promise.all([lotti.progress(), anya.progress()]);
    expect(pl.xp).toBe(100);
    expect(pa.xp).toBe(0);
    expect(end.challenge.points).toBe(1);
    expect(end.members.find((m) => m.name === "Аня2")?.status).toBe("aborted");
  });

  it("ошибки сервера приходят как TomatoApiError с кодом", async () => {
    const u = await player("Ошибки");
    const guest = await player("Гость");
    const s = await u.createRoom({ name: "x" });
    await guest.joinByCode(s.room.code);
    const e1 = await fail(guest.startFocus(s.room.id));
    expect(e1).toBeInstanceOf(TomatoApiError);
    expect(e1.code).toBe("NOT_HOST");
    const e2 = await fail(u.help(s.room.id, "someone", "boost"));
    expect(e2.code).toBe("WRONG_PHASE");
    const e3 = await fail(new TomatoClient({ baseUrl: base }).me());
    expect(e3.status).toBe(401);
  });

  it("WebSocket: подписка, события комнаты, личные события и восстановление после обрыва", async () => {
    const lotti = await player("WS-1");
    const anya = await player("WS-2");
    const snap = await lotti.createRoom({ name: "WS", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const states: RoomSnapshot[] = [];
    const events: ServerEvent[] = [];
    const sock = lotti.connect();
    sock.on("room_state", (e) => states.push(e.data as RoomSnapshot));
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => states.length > 0);
    expect(sock.clockOffset).toBeTypeOf("number");

    await lotti.startFocus(id);
    await until(() => states.some((s) => s.room.phase === "focus"));
    expect(events.some((e) => e.type === "timer_started")).toBe(true);

    // обрыв: сервер рвёт соединения → клиент сам переподключается и подписывается заново
    const before = states.length;
    for (const c of [...app.hub.conns]) c.ws.terminate();
    await until(() => events.some((e) => e.type === "disconnected"));
    await until(() => states.length > before, 6000);
    expect(states.at(-1)!.room.phase).toBe("focus"); // состояние восстановлено без потери сессии

    // конец фокуса: reward_granted приходит ровно один раз и не повторяется после реконнекта
    await advance(25 * 60_000 + 1000, [lotti, anya]);
    await until(() => states.at(-1)?.room.phase === "break", 4000);
    await until(() => events.filter((e) => e.type === "reward_granted").length >= 1);
    for (const c of [...app.hub.conns]) c.ws.terminate();
    await sleep(1800);
    expect(events.filter((e) => e.type === "reward_granted" && (e.data as { kind: string }).kind === "focus_session")).toHaveLength(1);
    expect((await lotti.progress()).xp).toBe(125); // 100 + 25 за этап карты
    sock.close();
  }, 20000);

  it("WebSocket отклоняет клиентские «команды-награды»", async () => {
    const u = await player("Читер");
    const sock = u.connect();
    const errors: ServerEvent[] = [];
    sock.on("error", (e) => errors.push(e));
    await until(() => (sock as unknown as { ws?: { readyState: number } }).ws?.readyState === 1);
    (sock as unknown as { ws: { send(m: string): void } }).ws.send(JSON.stringify({ type: "give_me_coins", amount: 999999 }));
    await until(() => errors.length > 0);
    expect((errors[0].data as { code: string }).code).toBe("UNKNOWN_EVENT");
    expect((await u.progress()).coins).toBe(0);
    sock.close();
  });
});
