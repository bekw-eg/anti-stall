import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TomatoApiError, TomatoClient } from "./client";

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Promise<never>) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const r = await handler(url, init);
    return { ok: r.status < 400, status: r.status, statusText: "x", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("TomatoClient (REST)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => vi.unstubAllGlobals());

  it("гость — токен только на сессию браузера; после логина и пароля — сохраняется", async () => {
    mockFetch((url) =>
      url.endsWith("/api/users") ? { status: 201, body: { user: { id: "u1", name: "Лотти" }, token: "g".repeat(40) } } : { status: 200, body: { id: "u1", login: "lotti" } },
    );
    const c = new TomatoClient();
    await c.register("Лотти");
    expect(sessionStorage.getItem("tomato.token")).toBe("g".repeat(40));
    expect(localStorage.getItem("tomato.token")).toBeNull();
    await c.setCredentials({ login: "lotti", password: "password123" });
    expect(localStorage.getItem("tomato.token")).toBe("g".repeat(40));
    expect(sessionStorage.getItem("tomato.token")).toBeNull();
  });

  it("регистрация сохраняет токен и дальше он уходит в Authorization", async () => {
    const fetchFn = mockFetch((url) =>
      url.endsWith("/api/users") ? { status: 201, body: { user: { id: "u1", name: "Лотти" }, token: "t".repeat(40) } } : { status: 200, body: { ok: true } },
    );
    const c = new TomatoClient();
    await c.register("Лотти");
    expect(sessionStorage.getItem("tomato.token")).toBe("t".repeat(40));
    await c.me();
    const headers = (fetchFn.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${"t".repeat(40)}`);
  });

  it("sandbox уходит в теле регистрации только когда запрошен", async () => {
    const fetchFn = mockFetch(() => ({ status: 201, body: { user: { id: "u1", name: "Лотти", sandbox: true }, token: "s".repeat(40) } }));
    const c = new TomatoClient();
    const u = await c.register("Лотти", { sandbox: true });
    expect(u.sandbox).toBe(true);
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ name: "Лотти", sandbox: true });
    await c.register("Аня");
    expect(JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)).toEqual({ name: "Аня" });
  });

  it("ошибки сервера превращаются в TomatoApiError с кодом", async () => {
    mockFetch(() => ({ status: 409, body: { error: { code: "WRONG_PHASE", message: "Нельзя сейчас", details: { phase: "focus" } } } }));
    const c = new TomatoClient();
    const err = await c.startFocus("r1").catch((e) => e);
    expect(err).toBeInstanceOf(TomatoApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("WRONG_PHASE");
    expect(err.details).toEqual({ phase: "focus" });
  });

  it("сетевая ошибка не маскируется под ошибку API", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await new TomatoClient().me().catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(TomatoApiError);
  });

  it("baseUrl подставляется, лишний слэш убирается", async () => {
    const fetchFn = mockFetch(() => ({ status: 200, body: {} }));
    await new TomatoClient({ baseUrl: "https://api.example.com/" }).config();
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.example.com/api/config");
  });

  it("connect() без токена — понятная ошибка", () => {
    expect(() => new TomatoClient().connect()).toThrow(/токен/i);
  });
});

describe("TomatoSocket (переподключение)", () => {
  /** Минимальный управляемый WebSocket */
  class WS {
    static OPEN = 1;
    static all: WS[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((m: { data: string }) => void) | null = null;
    onclose: ((e: { code?: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { WS.all.push(this); }
    send() {}
    close() {}
    open() { this.readyState = 1; this.onopen?.(); }
    hello() { this.open(); this.onmessage?.({ data: JSON.stringify({ type: "hello", ts: Date.now(), data: {} }) }); }
    drop(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
  }
  beforeEach(() => { WS.all = []; vi.useFakeTimers(); vi.stubGlobal("WebSocket", WS); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const connect = () => { const c = new TomatoClient({ baseUrl: "http://h" }); c.setToken("t".repeat(40)); return c.connect(); };

  it("4401 — без переподключения, в событии disconnected есть код", () => {
    const s = connect();
    const codes: unknown[] = [];
    s.on("disconnected", (e) => codes.push((e.data as { code?: number }).code));
    WS.all[0].hello();
    WS.all[0].drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(WS.all).toHaveLength(1);
    expect(codes).toEqual([4401]);
  });

  it("4429 — пауза перед переподключением", () => {
    connect();
    WS.all[0].hello();
    WS.all[0].drop(4429);
    vi.advanceTimersByTime(10_000);
    expect(WS.all).toHaveLength(1);
    vi.advanceTimersByTime(5_100);
    expect(WS.all).toHaveLength(2);
  });

  it("backoff сбрасывается только после hello, а не на open", () => {
    connect();
    WS.all[0].drop(1006); // повтор через 500 мс
    vi.advanceTimersByTime(500);
    expect(WS.all).toHaveLength(2);
    WS.all[1].open(); // открылся, но авторизации не было
    WS.all[1].drop(1006); // повтор через 1000 мс
    vi.advanceTimersByTime(500);
    expect(WS.all).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(WS.all).toHaveLength(3);
    WS.all[2].hello();
    WS.all[2].drop(1006); // после hello — снова 500 мс
    vi.advanceTimersByTime(500);
    expect(WS.all).toHaveLength(4);
  });

  it("битое сообщение не роняет обработку", () => {
    const s = connect();
    const seen: string[] = [];
    s.on("*", (e) => seen.push(e.type));
    WS.all[0].open();
    expect(() => WS.all[0].onmessage?.({ data: "{не json" })).not.toThrow();
    WS.all[0].onmessage?.({ data: JSON.stringify({ type: "hello", ts: Date.now(), data: {} }) });
    expect(seen).toEqual(["hello"]);
  });

  it("исключение в одном обработчике не лишает событие остальных", () => {
    const s = connect();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    s.on("room_state", () => { throw new Error("сломанный обработчик"); });
    s.on("room_state", () => seen.push("второй обработчик"));
    s.on("*", (e) => seen.push(`* ${e.type}`));
    WS.all[0].hello();
    expect(() => WS.all[0].onmessage?.({ data: JSON.stringify({ type: "room_state", ts: Date.now(), data: {} }) })).not.toThrow();
    expect(seen).toEqual(["* hello", "второй обработчик", "* room_state"]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
