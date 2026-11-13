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
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("регистрация сохраняет токен и дальше он уходит в Authorization", async () => {
    const fetchFn = mockFetch((url) =>
      url.endsWith("/api/users") ? { status: 201, body: { user: { id: "u1", name: "Лотти" }, token: "t".repeat(40) } } : { status: 200, body: { ok: true } },
    );
    const c = new TomatoClient();
    await c.register("Лотти");
    expect(localStorage.getItem("tomato.token")).toBe("t".repeat(40));
    await c.me();
    const headers = (fetchFn.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${"t".repeat(40)}`);
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
