import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBadge } from "./Chrome";
import { FakeWebSocket, booted, health, me, mockServer, registered, renderHook, roomRoutes, snapshot } from "./hookTestUtils";
import { JoinScreen } from "./screens/JoinScreen";
import { Landing } from "./screens/Landing";
import { client, type Tomato } from "./useTomato";

describe("демо-песочница: аккаунт и комнаты", () => {
  beforeEach(() => {
    localStorage.clear();
    client.setToken(null);
    FakeWebSocket.all = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("при demoMode регистрация отправляет sandbox:true, а новая комната всегда демо", async () => {
    const srv = mockServer({
      "GET /api/health": health(true),
      "POST /api/users": registered(true),
      "POST /api/rooms": { status: 201, body: snapshot() },
      ...roomRoutes(),
    });
    const { ref, unmount } = renderHook();
    await booted(ref);
    expect(ref.current!.demoMode).toBe(true);

    await act(async () => { await ref.current!.createRoom("Лотти", { focusMinutes: 25, breakMinutes: 5 }); });
    expect(srv.body("POST /api/users")).toEqual({ name: "Лотти", sandbox: true });
    expect(srv.body("POST /api/rooms")).toMatchObject({ demo: true });
    expect(ref.current!.user?.sandbox).toBe(true);
    unmount();
  });

  it("обычный аккаунт на демо-сервере забывается: одна новая песочная регистрация, ошибка — по-русски", async () => {
    client.setToken("o".repeat(40));
    localStorage.setItem("tomato2.roomId", "r-old");
    const srv = mockServer({
      "GET /api/health": health(true),
      "GET /api/users/me": me({ sandbox: false }),
      "POST /api/users": registered(true),
      "POST /api/rooms/join": { status: 403, body: { error: { code: "SANDBOX_DEMO_ONLY", message: "server text" } } },
    });
    const { ref, unmount } = renderHook();
    await booted(ref);
    expect(client.token).toBeNull(); // токен с обычного сервера сброшен
    expect(localStorage.getItem("tomato2.roomId")).toBeNull();
    expect(srv.count("GET /api/rooms/r-old")).toBe(0); // старую комнату не восстанавливаем
    expect(ref.current!.user).toBeNull();

    await act(async () => { await ref.current!.joinRoom("Лотти", "K7QM2X"); });
    expect(srv.count("POST /api/users")).toBe(1);
    expect(srv.body("POST /api/users")).toEqual({ name: "Лотти", sandbox: true });
    expect(client.token).toBe("n".repeat(40));
    expect(ref.current!.toasts.map((x) => x.text)).toContain("В демо-песочнице доступны только демо-комнаты");
    unmount();
  });

  it("401 на сохранённом токене — тихий сброс без повторов; на обычном сервере sandbox не отправляется", async () => {
    client.setToken("s".repeat(40));
    const srv = mockServer({
      "GET /api/health": health(false),
      "GET /api/users/me": { status: 401, body: { error: { code: "UNAUTHORIZED", message: "нет" } } },
      "POST /api/users": registered(false),
      "POST /api/rooms": { status: 403, body: { error: { code: "DEMO_DISABLED", message: "server text" } } },
    });
    const { ref, unmount } = renderHook();
    await booted(ref);
    expect(client.token).toBeNull();
    expect(srv.count("GET /api/users/me")).toBe(1);

    await act(async () => { await ref.current!.createRoom("Лотти", { demo: true, focusSeconds: 25, breakSeconds: 15 }); });
    expect(srv.count("GET /api/users/me")).toBe(1); // токена нет — не переспрашиваем
    expect(srv.count("POST /api/users")).toBe(1);
    expect(srv.body("POST /api/users")).toEqual({ name: "Лотти" });
    expect(ref.current!.toasts.map((x) => x.text)).toEqual(["Демо-режим на этом сервере выключен"]); // без «Сессия устарела»
    unmount();
  });

  it("песочный аккаунт на обычном сервере тоже сбрасывается", async () => {
    client.setToken("p".repeat(40));
    mockServer({ "GET /api/health": health(false), "GET /api/users/me": me({ sandbox: true }) });
    const { ref, unmount } = renderHook();
    await booted(ref);
    expect(client.token).toBeNull();
    expect(ref.current!.user).toBeNull();
    unmount();
  });
});

describe("демо-песочница: интерфейс", () => {
  const mount = (el: React.ReactElement) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(el));
    return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
  };

  it("лендинг показывает плашку только на демо-сервере", () => {
    const on = mount(<Landing ready serverOk demo onStart={() => undefined} onJoin={() => undefined} />);
    expect(on.host.querySelector('[data-testid="demo-badge"]')?.textContent).toBe("Демо-песочница: ускоренное время, прогресс не переносится в реальный аккаунт");
    on.unmount();
    const off = mount(<Landing ready serverOk demo={false} onStart={() => undefined} onJoin={() => undefined} />);
    expect(off.host.querySelector('[data-testid="demo-badge"]')).toBeNull();
    off.unmount();
  });

  it("компактная плашка комнаты сохраняет полный текст для подсказки и скринридера", () => {
    const m = mount(<DemoBadge compact />);
    const badge = m.host.querySelector('[data-testid="demo-badge"]')!;
    expect(badge.getAttribute("aria-label")).toBe("Демо-песочница: ускоренное время, прогресс не переносится в реальный аккаунт");
    expect(badge.getAttribute("role")).toBe("note");
    m.unmount();
  });

  it("на демо-сервере экран входа предупреждает о песочнице и создаёт демо-комнату с короткими таймингами", () => {
    const createRoom = vi.fn(async () => true);
    const t = { snapshot: null, user: null, name: "Лотти", setName: () => undefined, demoMode: true, busy: false, createRoom, joinRoom: vi.fn() } as unknown as Tomato;
    const m = mount(<JoinScreen t={t} initialMode="create" onBack={() => undefined} />);
    expect(m.host.querySelector('[data-testid="demo-badge"]')).not.toBeNull();
    const create = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "Создать комнату" && b.getAttribute("type") === "submit")!;
    act(() => create.click());
    expect(createRoom).toHaveBeenCalledWith("Лотти", { demo: true, focusSeconds: 25, breakSeconds: 15, cycles: 4, teamMode: true });
    m.unmount();
  });

  it("на обычном сервере комната создаётся с 25 / 5 минутами, а по коду — входит в комнату", () => {
    const createRoom = vi.fn(async () => true);
    const joinRoom = vi.fn(async () => true);
    const t = { snapshot: null, user: null, name: "Аня", setName: () => undefined, demoMode: false, busy: false, createRoom, joinRoom } as unknown as Tomato;
    const m = mount(<JoinScreen t={t} initialMode="create" onBack={() => undefined} />);
    act(() => m.host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(createRoom).toHaveBeenCalledWith("Аня", { focusSeconds: 1500, breakSeconds: 300, cycles: 4, teamMode: true });
    m.unmount();
    const j = mount(<JoinScreen t={t} initialMode="join" initialCode="https://x.kz/room/k7qm2x" onBack={() => undefined} />);
    act(() => j.host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(joinRoom).toHaveBeenCalledWith("Аня", "https://x.kz/room/k7qm2x");
    j.unmount();
  });
});
