import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, RoomSnapshot } from "@/api/tomato";
import { makeRoad, makeTd } from "./testFixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Перерыв = время игры: TomatoApp сам раскрывает Tower Defense, когда фаза стала break, и закрывает
 * игру, когда перерыв кончился. Состояние хука подменено, тяжёлые панели — заглушки.
 */
const state = vi.hoisted(() => ({ t: null as unknown as Record<string, unknown> }));
vi.mock("./useTomato", () => ({ client: {}, useTomato: () => state.t }));
vi.mock("./voice/useVoice", () => ({ useVoice: () => ({}) }));
vi.mock("./TowerDefense", () => ({ TowerDefense: () => <div data-testid="td-game" /> }));
vi.mock("./TimerBlock", () => ({ TimerBlock: () => <div data-testid="timer" /> }));
vi.mock("./VoiceBar", () => ({ VoiceBar: () => null }));
vi.mock("./PrankOverlay", () => ({ PrankOverlay: () => null }));
vi.mock("./SocialPanel", () => ({ SocialPanel: () => null }));
vi.mock("./StatsPanel", () => ({ StatsPanel: () => null }));
vi.mock("./SettingsContent", () => ({ SettingsContent: () => <div data-testid="settings" /> }));
vi.mock("./RoomExtras", () => ({ ParticipantsRow: () => null, RoadmapSlot: () => null }));
vi.mock("./Welcome", () => ({ Welcome: () => null }));

const PANEL_KEY = "tomato2.panel";
let host: HTMLDivElement;
let root: Root;
let loadTd: ReturnType<typeof vi.fn>;

function tomato(phase: Phase) {
  const snapshot = {
    room: { id: "r1", code: "K7QM2X", name: "Комната", hostId: "u1", phase, cycleId: "c1", cycleNo: 1, demo: true, mode: "shared", settings: { focusSec: 25, breakSec: 15 }, phaseStartedAt: 0, phaseEndsAt: null, serverTime: 0, remainingMs: null },
    members: [], challenge: makeRoad(0),
    me: { userId: "u1", isMember: true, isHost: true, team: null, status: "waiting", task: null, session: null, coins: 0, prankEnabled: true, effects: [], allowedActions: [], level: 1, xp: 0, levelStartXp: 0, nextLevelXp: 100 },
  } as unknown as RoomSnapshot;
  return {
    boot: "ready", serverOk: true, demoMode: false, graceSec: 30, conn: "online", disconnectedFor: 0, toasts: [], socket: null, snapshot,
    td: phase === "break" ? makeTd() : null, loadTd, tdJoin: vi.fn(), tdStart: vi.fn(), tdBuild: vi.fn(), tdUpgrade: vi.fn(), tdSendUnit: vi.fn(), tdCastSpell: vi.fn(), tdRematch: vi.fn(),
  };
}
const show = (phase: Phase) => {
  state.t = tomato(phase);
  act(() => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></MemoryRouter>));
};
const game = () => host.querySelector('[data-testid="td-game"]');
/** Ждём короткими шагами act: выход панели (AnimatePresence) заканчивается асинхронно — без act React ругается в консоль */
async function settle(done: () => boolean, steps = 100) {
  for (let i = 0; i < steps && !done(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
}
let App: React.ComponentType;

beforeEach(async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false,
  }));
  sessionStorage.clear();
  loadTd = vi.fn().mockResolvedValue(null);
  App = (await import("./TomatoApp")).default;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("игра на перерыве открывается сама", () => {
  it("фокус: карта размыта и подписана, игры нет; перерыв — игра раскрывается и грузит состояние; конец перерыва — закрывается", async () => {
    show("focus");
    expect(game()).toBeNull();
    expect(host.querySelector('[data-testid="game-later"]')?.textContent).toBe("Игра откроется на перерыве");
    expect(loadTd).not.toHaveBeenCalled();

    show("break");
    expect(game()).not.toBeNull();
    expect(sessionStorage.getItem(PANEL_KEY)).toBe("game");
    expect(loadTd).toHaveBeenCalledTimes(1); // начало перерыва и раскрытие панели — один запрос
    expect(host.querySelector('[data-testid="game-later"]')).toBeNull();

    show("focus");
    expect(sessionStorage.getItem(PANEL_KEY)).toBe("");
    await settle(() => game() === null);
    expect(game()).toBeNull();
  });

  it("закрыть игру на перерыве можно — сама она снова не открывается до следующего перерыва", async () => {
    show("break");
    const toggle = host.querySelector('[aria-label="Закрыть игру"]') as HTMLButtonElement;
    act(() => toggle.click());
    expect(sessionStorage.getItem(PANEL_KEY)).toBe("");
    await settle(() => game() === null);
    expect(game()).toBeNull();
    show("break"); // тот же перерыв, новое состояние
    expect(sessionStorage.getItem(PANEL_KEY)).toBe("");
  });

  it("открытые настройки важнее: игра ждёт, пока их закроют", () => {
    show("focus");
    act(() => (host.querySelector('[aria-label="Открыть настройки"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-testid="settings"]')).not.toBeNull();
    show("break");
    expect(game()).toBeNull();
    expect(sessionStorage.getItem(PANEL_KEY)).toBe("game"); // покажется после закрытия настроек
    expect(loadTd).toHaveBeenCalledTimes(1); // состояние всё равно подгружено
  });
});
