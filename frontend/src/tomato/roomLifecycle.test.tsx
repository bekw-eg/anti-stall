import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeWebSocket, apiError, booted, health, me, mockServer, renderHook, roomRoutes, settle, snapshot, toastTexts, type Routes,
} from "./hookTestUtils";
import { StatsPanel } from "./StatsPanel";
import { client, type Tomato } from "./useTomato";

const ROOM_KEY = "tomato2.roomId";
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

/** Пользователь с сохранённой комнатой r1: после загрузки он в комнате, сокет создан. */
async function inRoom(extra: Routes = {}) {
  client.setToken("t".repeat(40));
  localStorage.setItem(ROOM_KEY, "r1");
  const srv = mockServer({ "GET /api/health": health(), "GET /api/users/me": me(), "GET /api/config": { status: 200, body: {} }, ...roomRoutes(), ...extra });
  const h = renderHook();
  await booted(h.ref);
  await settle(h.ref, (t) => Boolean(t.snapshot) && Boolean(t.socket));
  expect(h.ref.current!.snapshot?.room.id).toBe("r1");
  return { srv, ...h, ws: FakeWebSocket.last };
}

beforeEach(() => {
  localStorage.clear();
  client.setToken(null);
  FakeWebSocket.all = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("восстановление комнаты при загрузке", () => {
  it("5xx не стирает сохранённую комнату и показывает ошибку; 404 — стирает", async () => {
    client.setToken("t".repeat(40));
    localStorage.setItem(ROOM_KEY, "r1");
    const srv = mockServer({ "GET /api/health": health(), "GET /api/users/me": me(), "GET /api/rooms/r1": apiError(503, "UNAVAILABLE") });
    const a = renderHook();
    await booted(a.ref);
    expect(a.ref.current!.snapshot).toBeNull();
    expect(localStorage.getItem(ROOM_KEY)).toBe("r1");
    expect(toastTexts(a.ref.current)).toEqual(["server UNAVAILABLE"]);
    a.unmount();

    srv.routes["GET /api/rooms/r1"] = apiError(404, "ROOM_NOT_FOUND");
    const b = renderHook();
    await booted(b.ref);
    expect(localStorage.getItem(ROOM_KEY)).toBeNull();
    b.unmount();
  });

  it("неудачный вход по ссылке /room/CODE — понятное сообщение", async () => {
    client.setToken("t".repeat(40));
    mockServer({ "GET /api/health": health(), "GET /api/users/me": me(), "POST /api/rooms/join": apiError(404, "ROOM_NOT_FOUND") });
    const h = renderHook("K7QM2X");
    await booted(h.ref);
    expect(toastTexts(h.ref.current)).toEqual(["Не удалось войти в комнату K7QM2X: server ROOM_NOT_FOUND"]);
    h.unmount();
  });
});

describe("жизненный цикл комнаты", () => {
  it("«Выйти»: отказ сервера — остаёмся в комнате и видим ошибку; 404 — комнаты уже нет, выходим", async () => {
    const { srv, ref, unmount } = await inRoom({ "POST /api/rooms/r1/leave": apiError(500, "INTERNAL") });
    let left: boolean | undefined;
    await act(async () => { left = await ref.current!.leaveRoom(); });
    expect(left).toBe(false);
    expect(ref.current!.snapshot?.room.id).toBe("r1");
    expect(localStorage.getItem(ROOM_KEY)).toBe("r1");
    expect(toastTexts(ref.current)).toContain("server INTERNAL");

    srv.routes["POST /api/rooms/r1/leave"] = apiError(404, "ROOM_NOT_FOUND");
    await act(async () => { left = await ref.current!.leaveRoom(); });
    expect(left).toBe(true);
    expect(ref.current!.snapshot).toBeNull();
    unmount();
  });

  it("room_state с isMember:false (вышли в другой вкладке) сбрасывает комнату", async () => {
    const { ref, ws, unmount } = await inRoom();
    act(() => ws.hello());
    act(() => ws.message("room_state", snapshot({ me: { isMember: false } }), { roomId: "r1" }));
    expect(ref.current!.snapshot).toBeNull();
    expect(localStorage.getItem(ROOM_KEY)).toBeNull();
    expect(toastTexts(ref.current)).toEqual(["Вы больше не участник этой комнаты"]);
    unmount();
  });

  it("ошибка подписки NOT_A_MEMBER тоже сбрасывает «призрачную» комнату", async () => {
    const { ref, ws, unmount } = await inRoom();
    act(() => ws.hello());
    act(() => ws.message("error", { code: "NOT_A_MEMBER", message: "Вы не участник этой комнаты" }));
    expect(ref.current!.snapshot).toBeNull();
    expect(toastTexts(ref.current)).toHaveLength(1);
    unmount();
  });

  it("закрытие сокета с 4401 разлогинивает явно и без переподключений", async () => {
    const { ref, ws, unmount } = await inRoom();
    act(() => ws.hello());
    act(() => ws.drop(4401));
    expect(client.token).toBeNull();
    expect(ref.current!.user).toBeNull();
    expect(ref.current!.snapshot).toBeNull();
    expect(toastTexts(ref.current)).toEqual(["Сессия устарела — войдите заново"]);
    await wait(700); // первый повтор был бы через 500 мс
    expect(FakeWebSocket.all).toHaveLength(1);
    unmount();
  });

  it("сеть вернулась, а сокет жив — баннер «Нет сети» снимается; grace-период берётся из hello", async () => {
    const { ref, ws, unmount } = await inRoom();
    act(() => ws.hello({ graceMs: 45_000 }));
    expect(ref.current!.conn).toBe("online");
    expect(ref.current!.graceSec).toBe(45);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(ref.current!.conn).toBe("offline");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(ref.current!.conn).toBe("online");
    unmount();
  });
});

describe("StatsPanel", () => {
  const stats = {
    userId: "u1", name: "Лотти", level: 2, xp: 120, levelStartXp: 100, nextLevelXp: 250, coins: 5,
    sessions: { completed: 3, rewarded: 3, interrupted: 0, focusSeconds: 4500, averageSeconds: 1500, todayFocusSeconds: 1500, todaySessions: 1 },
    bestStreakDays: 1, social: { helpsSent: 0, pranksSent: 0, helpsReceived: 0, pranksReceived: 0 }, achievements: { unlocked: 0, total: 5 }, daily: [],
  };

  it("ошибка загрузки видна, «Повторить» запрашивает заново", async () => {
    const srv = mockServer({
      "GET /api/users/me/stats": apiError(500, "INTERNAL"),
      "GET /api/rooms/r1/stats": apiError(500, "INTERNAL"),
      "GET /api/users/me/achievements": { status: 200, body: { achievements: [] } },
    });
    const t = { snapshot: snapshot() } as unknown as Tomato;
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<StatsPanel t={t} />));
    for (let i = 0; i < 50 && !host.querySelector('[data-testid="stats-error"]'); i++) await wait(10);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Не удалось загрузить статистику: server INTERNAL/);
    expect(host.textContent).not.toMatch(/Загружаем статистику/);

    srv.routes["GET /api/users/me/stats"] = { status: 200, body: stats };
    srv.routes["GET /api/rooms/r1/stats"] = { status: 200, body: { roomId: "r1", mode: "shared", cycles: 1, goal: 6, winner: null, teams: [], totals: { completedSessions: 3, focusSeconds: 4500 } } };
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Повторить"))!;
    act(() => retry.click());
    for (let i = 0; i < 50 && !host.querySelector('[data-testid="stats-panel"]'); i++) await wait(10);
    expect(host.querySelector('[data-testid="stats-level"]')?.textContent).toBe("Уровень 2");
    expect(host.querySelector('[data-testid="stats-error"]')).toBeNull();
    expect(srv.count("GET /api/users/me/stats")).toBe(2);
    act(() => root.unmount());
  });
});
