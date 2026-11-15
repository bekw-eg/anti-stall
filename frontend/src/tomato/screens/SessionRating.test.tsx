import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, StudySession } from "@/api/tomato";
import { groupSessions } from "../historyGroups";
import { describeEvent } from "../useTomato";
import { SessionRating } from "./SessionRating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Окно «Как вы поработали?» ★1–5 после фокуса (этап 6.2): клиент только отправляет звёзды, бонус считает сервер. */
describe("оценка своей работы", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const stars = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

  it("пять звёзд; клик отправляет оценку один раз и показывает ответ", async () => {
    const onRate = vi.fn();
    act(() => root.render(<SessionRating rating={null} onRate={onRate} />));
    expect(host.textContent).toContain("Как вы поработали?");
    expect(stars()).toHaveLength(5);
    await act(async () => { stars()[3].click(); });
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith(4);
    expect(stars()).toHaveLength(0); // повторно не нажать
    const done = host.querySelector('[data-testid="session-rating-done"]')!;
    expect(done.querySelector('[aria-label="4 из 5"]')).not.toBeNull();
    expect(done.textContent).toContain("командный бонус — в конце перерыва");
  });

  it("сервер отказал — звёзды снова доступны", async () => {
    act(() => root.render(<SessionRating rating={null} onRate={async () => null} />));
    await act(async () => { stars()[4].click(); });
    expect(stars()).toHaveLength(5);
  });

  it("уже оценённая сессия (с сервера) — сразу ответ без кнопок", () => {
    act(() => root.render(<SessionRating rating={2} onRate={vi.fn()} />));
    expect(stars()).toHaveLength(0);
    expect(host.querySelector('[aria-label="2 из 5"]')).not.toBeNull();
  });

  it("итоговая плашка: командный бонус и средняя оценка", () => {
    const ev = { type: "reward_granted", data: { kind: "rating_bonus", xp: 42, coins: 8, avgRating: 4.2 } } as unknown as ServerEvent;
    expect(describeEvent(ev)).toEqual({ text: "Командный бонус +42 XP · +8 монет (средняя 4,2★)", tone: "reward" });
  });

  it("в истории бонус входит в итог захода", () => {
    const s = {
      id: "s1", roomId: "r", roomName: "К", cycleNo: 1, task: "T", status: "completed", endReason: "finished", startedAt: 0, endedAt: 1, scheduledEndAt: 1,
      durationSec: 1, result: null, resultNote: null, rewarded: true, xp: 100, coins: 20, rating: 5, bonusXp: 40, bonusCoins: 8,
    } as StudySession;
    expect(groupSessions([s])[0]).toMatchObject({ xp: 140, coins: 28 });
  });
});
