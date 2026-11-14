import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoadMap } from "./RoadMap";
import { makeRoad, makeTdRoad, makeTeam } from "./testFixtures";
import type { Roadmap } from "@/api/tomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const render = (road: Roadmap, meId = "me") => act(() => { root.render(<RoadMap road={road} meId={meId} />); });
const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
const nodeBtn = (title: string) => [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith(title)) as HTMLButtonElement;

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("RoadMap: рендер серверного состояния", () => {
  it("показывает все узлы с их статусами и следующий этап", () => {
    render(makeRoad(3));
    expect(nodeBtn("Лагерь").getAttribute("aria-label")).toContain("пройден");
    expect(nodeBtn("Лес знаний").getAttribute("aria-label")).toContain("вы здесь");
    expect(nodeBtn("Мост дедлайнов").getAttribute("aria-label")).toContain("следующий этап");
    expect(nodeBtn("Крепость экзамена").getAttribute("aria-label")).toContain("закрыт");
    expect(host.textContent).toContain("До «Мост дедлайнов»: ещё 1");
    expect(host.textContent).toContain("3/6");
    expect(q('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("3");
  });

  it("клик по узлу показывает его подробности (награда, условие)", () => {
    render(makeRoad(1));
    expect(host.textContent).toContain("Лес знаний"); // по умолчанию — следующий этап
    act(() => nodeBtn("Крепость экзамена").click());
    expect(host.querySelector("aside")!.textContent).toContain("Нужно командных очков: 6");
    expect(host.querySelector("aside")!.textContent).toContain("награда 25 XP, 10 монет");
    expect(nodeBtn("Крепость экзамена").getAttribute("aria-pressed")).toBe("true");
  });

  it("маркер стоит на серверной позиции, вклад участников выводится", () => {
    render(makeRoad(2, { contributions: [{ userId: "me", name: "Лотти", points: 1 }, { userId: "u2", name: "Аня", points: 1 }] }));
    expect(q('[data-testid="marker-shared"]')!.style.left).toBe("30%"); // «Лес знаний», x = 0.3
    expect(host.textContent).toContain("Лотти (вы)");
    expect(host.textContent).toContain("Аня");
  });

  it("цель достигнута: следующего этапа нет, показан финальный узел", () => {
    render(makeRoad(6, { completed: true, winner: "A", mode: "shared" }));
    expect(host.textContent).toContain("Крепость экзамена");
    expect(host.textContent).not.toContain("До «");
    expect(q('[role="status"]')!.textContent).toContain("Цель достигнута");
  });

  it("маркер плавно переезжает при смене серверной позиции (есть промежуточные значения)", async () => {
    render(makeRoad(2));
    const marker = q('[data-testid="marker-shared"]')!;
    expect(marker.style.left).toBe("30%");
    const seen: number[] = [];
    const timer = setInterval(() => seen.push(parseFloat(marker.style.left)), 20);
    render(makeRoad(4)); // сервер сообщил: команда на «Мосту дедлайнов» (x = 0.54)
    await vi.waitFor(() => expect(parseFloat(marker.style.left)).toBeCloseTo(54, 0), { timeout: 5000 });
    clearInterval(timer);
    expect(seen.some((v) => v > 31 && v < 53)).toBe(true);
  });
});

describe("RoadMap: командный режим A/B", () => {
  const teamsRoad = (mine: "A" | "B", over: Partial<Roadmap> = {}) =>
    makeRoad(mine === "A" ? 3 : 1, {
      mode: "teams", teamKey: mine,
      teams: [makeTeam("A", 3), makeTeam("B", 1)],
      contributions: [{ userId: "me", name: "Лотти", points: 2, team: "A" }, { userId: "u2", name: "Аня", points: 1, team: "B" }],
      ...over,
    });

  it("у каждой команды свой маркер на своей позиции; своя команда отмечена", () => {
    render(teamsRoad("A"));
    expect(q('[data-testid="marker-A"]')!.style.left).toBe("30%"); // «Лес знаний»
    expect(q('[data-testid="marker-B"]')!.style.left).toBe("8%"); // «Лагерь»
    expect(host.textContent).toContain("Команда A (вы)");
    expect(host.textContent).toContain("Лотти · A (вы)");
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  });

  it("маркеры двух команд на одном узле расходятся", () => {
    render(teamsRoad("A", { teams: [makeTeam("A", 3), makeTeam("B", 2)] }));
    const offsets = ["A", "B"].map((k) => (q(`[data-testid="marker-${k}"] span`) as HTMLElement).style.marginLeft);
    expect(offsets[0]).not.toBe(offsets[1]);
  });

  it("победитель объявляется с точки зрения зрителя; ничья — отдельно", () => {
    render(teamsRoad("A", { winner: "A", completed: true }));
    expect(host.textContent).toContain("Победила команда A — это вы");
    render(teamsRoad("B", { winner: "A" }));
    expect(host.textContent).toContain("Победила команда A");
    expect(host.textContent).not.toContain("это вы");
    render(teamsRoad("B", { winner: "draw" }));
    expect(host.textContent).toContain("Ничья");
  });
});

describe("RoadMap: новые правила — узлы открывают победы в Tower Defense", () => {
  it("условие узла — победа на этапе предыдущего узла; фокус-сессии дают вклад и казну", () => {
    render(makeTdRoad(1));
    expect(nodeBtn("Мост дедлайнов").getAttribute("aria-label")).toContain("победа в обороне «Лес знаний»");
    expect(host.textContent).toContain("До «Мост дедлайнов»: победа на этапе «Лес знаний»");
    expect(host.querySelector("aside")!.textContent).toContain("Откроет победа в Tower Defense на этапе «Лес знаний»");
    expect(host.textContent).toContain("1/4");
    expect(host.textContent).toContain("Узлы карты открывают победы в Tower Defense");
    expect(host.textContent).not.toContain("Очко команде даёт каждая завершённая фокус-сессия");
    expect(q('[data-testid="road-team-stats"]')!.textContent).toContain("Очки вклада: 7");
    expect(q('[data-testid="road-team-stats"]')!.textContent).toContain("Казна: 42🪙");
  });
});
