import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, RoomSnapshot } from "@/api/tomato";
import { makeRoad, makeTd } from "./testFixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Экран комнаты выбирает фаза с сервера (макет: 06 Lobby · 07 Focus · 08 Break).
 * Перерыв = время игры: Tower Defense есть только на перерыве и подгружается один раз при его начале.
 * Состояние хука подменено, тяжёлые панели — заглушки.
 */
const state = vi.hoisted(() => ({ t: null as unknown as Record<string, unknown> }));
vi.mock("./useTomato", () => ({ client: {}, useTomato: () => state.t, DEFAULT_LIMITS: { focusSeconds: [60, 86_400], breakSeconds: [10, 7_200], cycles: [1, 12], demoFocusSeconds: [5, 600], demoBreakSeconds: [10, 300] } }));
vi.mock("./voice/useVoice", () => ({ useVoice: () => ({}) }));
vi.mock("./TowerDefense", () => ({ TowerDefense: () => <div data-testid="td-game" /> }));
vi.mock("./VoiceBar", () => ({ VoiceBar: () => null }));
vi.mock("./PrankOverlay", () => ({ PrankOverlay: () => null }));
vi.mock("./SocialPanel", () => ({ SocialPanel: () => null }));
vi.mock("./ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat" /> }));
vi.mock("./StatsPanel", () => ({ StatsPanel: () => <div data-testid="stats-panel" /> }));
vi.mock("./ProfilePanel", () => ({ ProfilePanel: () => null }));
vi.mock("./RoadMap", () => ({ RoadMap: () => <div data-testid="road-map" /> }));

let host: HTMLDivElement;
let root: Root;
let loadTd: ReturnType<typeof vi.fn>;
let App: React.ComponentType;

function tomato(phase: Phase | null, extra: Record<string, unknown> = {}) {
  const snapshot = phase && ({
    room: { id: "r1", code: "K7QM2X", name: "Комната Лотти", hostId: "u1", phase, cycleId: "c1", cycleNo: 1, demo: false, mode: "shared", settings: { focusSec: 1500, breakSec: 300, cycles: 4 }, phaseStartedAt: 0, phaseEndsAt: null, serverTime: 0, remainingMs: null },
    members: [{ userId: "u1", name: "Лотти", role: "host", level: 2, team: "shared", isReady: false, task: null, status: "waiting", connection: "online", prankEnabled: true, contribution: 0, session: null }],
    challenge: makeRoad(0),
    me: { userId: "u1", isMember: true, isHost: true, team: null, status: phase === "focus" ? "focusing" : "waiting", task: null, session: null, coins: 12, prankEnabled: true, effects: [], allowedActions: phase === "waiting" ? ["set_task", "set_ready", "start_focus", "update_settings"] : [], level: 2, xp: 0, levelStartXp: 0, nextLevelXp: 100 },
  } as unknown as RoomSnapshot);
  return {
    boot: "ready", serverOk: true, demoMode: false, graceSec: 30, conn: "online", disconnectedFor: 0, toasts: [], socket: null, snapshot, user: null, name: "Лотти", setName: vi.fn(), busy: false,
    remainingMs: null, limits: null, chat: [], serverNow: () => 0,
    td: phase === "break" ? makeTd() : null, loadTd, tdJoin: vi.fn(), tdStart: vi.fn(), tdBuild: vi.fn(), tdUpgrade: vi.fn(), tdSendUnit: vi.fn(), tdCastSpell: vi.fn(), tdRematch: vi.fn(),
    setReady: vi.fn(), startFocus: vi.fn(), updateSettings: vi.fn(), setTask: vi.fn(), setTeam: vi.fn(), skipBreak: vi.fn(), recordResult: vi.fn(), abortSession: vi.fn(), leaveRoom: vi.fn(), createRoom: vi.fn(), joinRoom: vi.fn(),
    ...extra,
  };
}
const show = (phase: Phase | null, extra?: Record<string, unknown>, path = "/") => {
  state.t = tomato(phase, extra);
  act(() => root.render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/room/:code" element={<App />} /><Route path="*" element={<App />} /></Routes></MemoryRouter>));
};
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`);

beforeEach(async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false,
  }));
  loadTd = vi.fn().mockResolvedValue(null);
  App = (await import("./TomatoApp")).default;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("экраны по фазе комнаты", () => {
  it("фокус: карта закрыта и подписана, игры нет; перерыв — игра есть и грузится один раз; снова фокус — игры нет", () => {
    show("focus");
    expect($("td-game")).toBeNull();
    expect($("game-later")?.textContent).toBe("Игра откроется на перерыве");
    expect(loadTd).not.toHaveBeenCalled();

    show("break");
    expect($("td-game")).not.toBeNull();
    expect(loadTd).toHaveBeenCalledTimes(1);
    expect($("game-later")).toBeNull();

    show("break"); // новое состояние того же перерыва — повторной загрузки нет
    expect(loadTd).toHaveBeenCalledTimes(1);

    show("focus");
    expect($("td-game")).toBeNull();
  });

  it("ожидание: лобби с таймером первого цикла, чатом и стартом для создателя", () => {
    show("waiting");
    expect($("lobby-timer")?.textContent).toBe("25:00");
    expect($("chat")).not.toBeNull();
    const start = [...host.querySelectorAll("button")].find((b) => b.textContent === "Начать фокус") as HTMLButtonElement;
    expect(start).toBeTruthy();
    expect(start.disabled).toBe(true); // сам ещё не готов
    expect(host.textContent).toContain("0/1 готовы"); // счётчик — в карточке состояния
    const status = $("my-ready")!;
    expect(status.getAttribute("data-ready")).toBe("false");
    expect(status.textContent).toContain("Вы ещё не готовы");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Я готов")).toBe(true);
  });

  it("готовность видна словами: «Вы готовы», лаймовая кнопка и отметка в списке", () => {
    show("waiting");
    const snap = state.t.snapshot as { me: { isReady: boolean }; members: { isReady: boolean }[] };
    snap.me.isReady = true; snap.members[0].isReady = true;
    show("waiting", { snapshot: snap });
    expect($("my-ready")!.getAttribute("data-ready")).toBe("true");
    expect($("my-ready")!.textContent).toContain("Вы готовы");
    const btn = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true")!;
    expect(btn.textContent).toBe("Вы готовы");
    expect(btn.className).toContain("as-btn-ready");
    expect(host.querySelector('[data-ready="true"] ')?.textContent).toBeTruthy();
    const start = [...host.querySelectorAll("button")].find((b) => b.textContent === "Начать фокус") as HTMLButtonElement;
    expect(start.disabled).toBe(false);
  });

  it("без комнаты — лендинг; ссылка-приглашение открывает экран входа с кодом", () => {
    show(null);
    expect($("landing")).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    show(null, {}, "/room/K7QM2X");
    expect($("join-screen")).not.toBeNull();
  });

  it("стикеры: добавляются из шапки поверх комнаты, текст сохраняется, все можно спрятать", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]; // в jsdom нет canvas
    localStorage.clear();
    show("waiting"); // в лобби стикеров нет — они только для фокуса
    expect($("add-sticker")).toBeNull();
    show("focus");
    expect(host.querySelectorAll("[data-sticker]").length).toBe(0);
    act(() => ($("add-sticker") as HTMLButtonElement).click());
    act(() => ($("add-sticker") as HTMLButtonElement).click());
    expect(host.querySelectorAll("[data-sticker]").length).toBe(2);
    const area = host.querySelector<HTMLTextAreaElement>('[data-sticker] textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Телефон в другой комнате");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(JSON.parse(localStorage.getItem("antistall.stickers.u1")!)[0].text).toBe("Телефон в другой комнате");
    act(() => ($("toggle-stickers") as HTMLButtonElement).click());
    expect(($("sticker-board") as HTMLElement).hidden).toBe(true);
    act(() => ($("toggle-stickers") as HTMLButtonElement).click());
    expect(host.querySelectorAll("[data-sticker]").length).toBe(2);
    act(() => (host.querySelector('[aria-label="Убрать стикер"]') as HTMLButtonElement).click());
    expect(host.querySelectorAll("[data-sticker]").length).toBe(1);
    show("break"); // на перерыве стикеров и кнопок нет, но они сохранены до следующего фокуса
    expect($("add-sticker")).toBeNull();
    expect(host.querySelectorAll("[data-sticker]").length).toBe(0);
    show("focus");
    expect(host.querySelectorAll("[data-sticker]").length).toBe(1);
  });

  it("панели комнаты: прогресс открывается из шапки и закрывается по Escape", () => {
    show("waiting");
    act(() => ($("open-stats") as HTMLButtonElement).click());
    expect($("stats-panel")).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect($("stats-panel")).toBeNull();
  });
});
