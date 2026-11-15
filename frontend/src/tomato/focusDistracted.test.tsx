import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@/api/tomato";
import type { Tomato } from "./useTomato";
import { FocusRoom } from "./screens/FocusRoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * «Отвлёкся?» под таймером фокуса: окно с выбором «Я отвлёкся» (честная отметка отлучки → «Вернулся»)
 * или «Выйти из фокуса» (подтверждение → abortSession). Тяжёлые панели — заглушки.
 */
vi.mock("./ChatPanel", () => ({ ChatPanel: () => null, CHAT_CARD_SIZE: "" }));
vi.mock("./screens/GoalProgress", () => ({ GoalProgress: () => null }));

let host: HTMLDivElement;
let root: Root;
let reportAttention: ReturnType<typeof vi.fn>;
let abortSession: ReturnType<typeof vi.fn>;
let manualAway = false;

function snapshot(): RoomSnapshot {
  return {
    room: { id: "r1", code: "K7QM2X", name: "Комната", hostId: "u1", phase: "focus", cycleId: "c1", cycleNo: 1, demo: false, mode: "shared", settings: { focusSec: 1500, breakSec: 300, cycles: 4 }, phaseStartedAt: 0, phaseEndsAt: null, serverTime: 0, remainingMs: null },
    members: [{ userId: "u1", name: "Лотти", role: "member", level: 2, team: "shared", isReady: true, task: null, status: "focusing", connection: "online", prankEnabled: true, contribution: 0, session: null }],
    me: { userId: "u1", isMember: true, isHost: false, team: null, status: "focusing", task: "Отчёт", session: null, coins: 0, prankEnabled: true, effects: [], allowedActions: ["abort_session"], level: 2, xp: 0, levelStartXp: 0, nextLevelXp: 100 },
  } as unknown as RoomSnapshot;
}

const render = () => {
  const t = { snapshot: snapshot(), remainingMs: 600_000, manualAway, reportAttention, abortSession, skipFocus: vi.fn() } as unknown as Tomato;
  act(() => root.render(<FocusRoom t={t} />));
};
const $ = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const click = async (id: string) => { await act(async () => { $(id)!.click(); }); };

beforeEach(() => {
  manualAway = false;
  // как в хуке: успешная отметка меняет manualAway и экран перерисовывается
  reportAttention = vi.fn(async (state: "away" | "back") => { manualAway = state === "away"; render(); return true; });
  abortSession = vi.fn(async () => ({ status: "aborted" }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("фокус: «Отвлёкся?»", () => {
  it("тихая ссылка вместо «Завершить досрочно», окно закрыто", () => {
    expect($("distracted-open")?.textContent).toBe("Отвлёкся?");
    expect($("distracted-dialog")).toBeNull();
    expect(host.textContent).not.toContain("Завершить досрочно");
  });

  it("«Я отвлёкся» шлёт away, затем «Вернулся» — back", async () => {
    await click("distracted-open");
    expect($("distracted-dialog")).not.toBeNull();
    await click("distracted-away");
    expect(reportAttention).toHaveBeenCalledWith("away");
    expect($("distracted-dialog")).toBeNull();
    expect($("distracted-open")).toBeNull();
    expect($("distracted-back")?.textContent).toBe("Вернулся");
    await click("distracted-back");
    expect(reportAttention).toHaveBeenLastCalledWith("back");
    expect(reportAttention).toHaveBeenCalledTimes(2);
    expect($("distracted-open")).not.toBeNull();
    expect(abortSession).not.toHaveBeenCalled();
  });

  it("«Выйти из фокуса» → предупреждение → «Выйти» вызывает abortSession", async () => {
    await click("distracted-open");
    await click("distracted-exit");
    expect(host.textContent).toContain("Цикл не засчитается, награды не будет");
    expect(abortSession).not.toHaveBeenCalled();
    await click("distracted-exit-confirm");
    expect(abortSession).toHaveBeenCalledTimes(1);
    expect(reportAttention).not.toHaveBeenCalled();
  });

  it("«Остаться» закрывает окно и ничего не вызывает", async () => {
    await click("distracted-open");
    await click("distracted-exit");
    await click("distracted-stay");
    expect($("distracted-dialog")).toBeNull();
    expect(abortSession).not.toHaveBeenCalled();
    expect(reportAttention).not.toHaveBeenCalled();
  });

  it("без права abort_session (наблюдатель) ссылки нет", () => {
    const t = { snapshot: { ...snapshot(), me: { ...snapshot().me!, status: "waiting", allowedActions: [] } }, remainingMs: null, manualAway: false, reportAttention, abortSession } as unknown as Tomato;
    act(() => root.render(<FocusRoom t={t} />));
    expect($("distracted-open")).toBeNull();
  });
});
