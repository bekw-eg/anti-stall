/** Общие помощники тестов useTomato: подменённый fetch, управляемый WebSocket, рендер хука. Не тест сам по себе. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import type { RoomSnapshot } from "@/api/tomato";
import { makeRoad } from "./testFixtures";
import { useTomato, type Tomato } from "./useTomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Reply = { status: number; body: unknown };
export type Call = { method: string; path: string; body: unknown };
export type Routes = Record<string, Reply | ((c: Call) => Reply)>;

/** Подменённый fetch: «METHOD путь» → ответ; маршруты можно менять по ходу теста; все вызовы записываются. */
export function mockServer(routes: Routes) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const c: Call = { method: init.method ?? "GET", path: url.split("?")[0], body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(c);
    const r = routes[`${c.method} ${c.path}`];
    const reply = typeof r === "function" ? r(c) : r ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "нет" } } };
    return { ok: reply.status < 400, status: reply.status, statusText: "x", json: async () => reply.body } as Response;
  }));
  const key = (c: Call) => `${c.method} ${c.path}`;
  return { routes, calls, count: (k: string) => calls.filter((c) => key(c) === k).length, body: (k: string) => calls.find((c) => key(c) === k)?.body };
}

/** WebSocket, которым управляет тест: open() → hello → message(...) → close(code). */
export class FakeWebSocket {
  static OPEN = 1;
  static all: FakeWebSocket[] = [];
  static get last() { return FakeWebSocket.all[FakeWebSocket.all.length - 1]; }
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.all.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(type: string, data: unknown = {}, extra: Record<string, unknown> = {}) { this.onmessage?.({ data: JSON.stringify({ type, ts: Date.now(), data, ...extra }) }); }
  hello(data: Record<string, unknown> = {}) { this.open(); this.message("hello", data); }
  drop(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
}

export const health = (demoMode = false): Reply => ({ status: 200, body: { status: "ok", serverTime: Date.now(), demoMode } });
export const meBody = (over: Record<string, unknown> = {}) => ({ id: "u1", name: "Лотти", level: 1, xp: 0, levelStartXp: 0, nextLevelXp: 100, coins: 0, prankEnabled: true, createdAt: 0, activeSession: null, rooms: [], ...over });
export const me = (over: Record<string, unknown> = {}): Reply => ({ status: 200, body: meBody(over) });
export const registered = (sandbox: boolean): Reply => ({ status: 201, body: { user: meBody({ sandbox }), token: "n".repeat(40) } });
export const apiError = (status: number, code: string): Reply => ({ status, body: { error: { code, message: `server ${code}` } } });

export const snapshot = (over: { me?: Partial<NonNullable<RoomSnapshot["me"]>> | null; demo?: boolean } = {}): RoomSnapshot => ({
  room: { id: "r1", code: "K7QM2X", name: "Комната Лотти", hostId: "u1", phase: "waiting", cycleId: null, cycleNo: 0, demo: over.demo ?? true, mode: "shared", settings: { focusSec: 25, breakSec: 15 }, phaseStartedAt: 0, phaseEndsAt: null, serverTime: Date.now(), remainingMs: null },
  members: [],
  challenge: makeRoad(0),
  ...(over.me === null ? {} : {
    me: {
      userId: "u1", isMember: true, isHost: true, team: null, status: "waiting", task: null, session: null, coins: 0, prankEnabled: true, effects: [], allowedActions: [],
      level: 1, xp: 0, levelStartXp: 0, nextLevelXp: 100, ...over.me,
    },
  }),
});

/** Маршруты комнаты r1, которые хук запрашивает сразу после входа. */
export const roomRoutes = (s: RoomSnapshot = snapshot()): Routes => ({
  "GET /api/rooms/r1": { status: 200, body: s },
  "GET /api/rooms/r1/social": { status: 200, body: { actions: [] } },
  "POST /api/heartbeat": { status: 200, body: { ok: true } },
});

export function renderHook(initialCode?: string) {
  const ref: { current: Tomato | null } = { current: null };
  function Probe() { ref.current = useTomato(initialCode); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { ref, unmount: () => act(() => root.unmount()) };
}

/** Даём хуку поработать короткими шагами act (обновления внутри одного async act применяются только в его конце). */
export async function settle(ref: { current: Tomato | null }, until: (t: Tomato) => boolean, steps = 100) {
  for (let i = 0; i < steps && !(ref.current && until(ref.current)); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
}

export async function booted(ref: { current: Tomato | null }) {
  await settle(ref, (t) => t.boot === "ready");
  expect(ref.current?.boot).toBe("ready");
}

export const toastTexts = (t: Tomato | null) => (t?.toasts ?? []).map((x) => x.text);
