import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBadge } from "./Chrome";
import { FakeWebSocket, booted, health, me, mockServer, registered, renderHook, roomRoutes, snapshot } from "./hookTestUtils";
import { SettingsContent, type FormState } from "./SettingsContent";
import { client, type Tomato } from "./useTomato";
import { Welcome } from "./Welcome";

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

  it("Welcome показывает плашку только на демо-сервере", () => {
    const on = mount(<Welcome ready serverOk demo onStart={() => undefined} />);
    expect(on.host.querySelector('[data-testid="demo-badge"]')?.textContent).toBe("Демо-песочница: ускоренное время, прогресс не переносится в реальный аккаунт");
    on.unmount();
    const off = mount(<Welcome ready serverOk demo={false} onStart={() => undefined} />);
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

  it("на демо-сервере чекбокс «Демо-режим» включён, заблокирован и объясняет почему; комната создаётся демо", () => {
    const createRoom = vi.fn(async () => true);
    const t = { snapshot: null, user: null, name: "Лотти", setName: () => undefined, demoMode: true, busy: false, createRoom, joinRoom: vi.fn() } as unknown as Tomato;
    const form: FormState = { work: 25, rest: 5, demo: false, teamMode: false, setWork: vi.fn(), setRest: vi.fn(), setDemo: vi.fn(), setTeamMode: vi.fn() };
    const m = mount(<SettingsContent t={t} form={form} onCollapse={() => undefined} />);
    const box = m.host.querySelector<HTMLInputElement>('input[aria-describedby="demo-mode-note"]')!;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(m.host.querySelector("#demo-mode-note")?.textContent).toMatch(/демо-песочница/);
    const create = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "Создать комнату")!;
    act(() => create.click());
    expect(createRoom).toHaveBeenCalledWith("Лотти", { demo: true, focusSeconds: 25, breakSeconds: 15, teamMode: false });
    m.unmount();
  });
});
