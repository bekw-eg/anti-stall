import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TowerDefense, type TdActions } from "./TowerDefense";
import { makeTd, makeTdRound } from "./testFixtures";
import type { TdView } from "@/api/tomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let actions: { [K in keyof TdActions]: ReturnType<typeof vi.fn> };
const render = (td: TdView) => act(() => { root.render(<TowerDefense td={td} actions={actions as unknown as TdActions} />); });
const slot = (id: string) => host.querySelector(`[data-testid="slot-${id}"]`) as SVGGElement;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const btn = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  actions = { join: vi.fn().mockResolvedValue(null), start: vi.fn().mockResolvedValue(null), build: vi.fn().mockResolvedValue(null), upgrade: vi.fn().mockResolvedValue(null) };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("TowerDefense: показывает серверное состояние и отправляет намерения", () => {
  it("вне перерыва игра закрыта: ни построек, ни старта", () => {
    render(makeTd({ enabled: false, phase: "focus" }));
    expect(host.textContent).toContain("только на перерыве");
    expect(btn("Начать раунд")).toBeUndefined();
    expect(actions.join).not.toHaveBeenCalled();
  });

  it("на перерыве входит в игру один раз, показывает монеты, этапы и закрытые этапы", () => {
    render(makeTd());
    render(makeTd({ me: { userId: "me", coins: 25, participated: true } })); // обновление состояния не повторяет вход
    expect(actions.join).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="Монеты"]')!.textContent).toBe("25 монет");
    const bridge = [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Мост дедлайнов")) as HTMLButtonElement;
    expect(bridge.disabled).toBe(true);
    expect(bridge.textContent).toContain("🔒");
  });

  it("клик по свободному месту — меню башен; цены с сервера; дорогие недоступны; постройка уходит на сервер", () => {
    render(makeTd({ me: { userId: "me", coins: 20, participated: false } }));
    click(slot("s1"));
    const arrow = btn("Лучник")!, cannon = btn("Пушка")!;
    expect(arrow.textContent).toContain("15");
    expect(cannon.disabled).toBe(true); // 30 > 20 монет: решает UI-подсказка, окончательно — сервер
    expect(arrow.disabled).toBe(false);
    click(arrow);
    expect(actions.build).toHaveBeenCalledWith("s1", "arrow");
  });

  it("клик по башне — улучшение с серверной ценой; максимальный уровень блокирует кнопку", () => {
    render(makeTd());
    click(slot("s3"));
    const up = btn("Улучшить")!;
    expect(up.textContent).toContain("12 монет"); // 15 × 0.8
    click(up);
    expect(actions.upgrade).toHaveBeenCalledWith("s3", 1);
    render(makeTd({ towers: [{ slot: "s3", type: "arrow", level: 3, ownerId: "u2", ownerName: "Аня" }] }));
    expect(btn("Максимальный уровень")!.disabled).toBe(true);
  });

  it("старт раунда: выбранный разблокированный этап; во время раунда кнопки старта нет", () => {
    render(makeTd());
    click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Тренировочный"))!);
    click(btn("Начать раунд")!);
    expect(actions.start).toHaveBeenCalledWith("camp");
    render(makeTd({ round: makeTdRound() }));
    expect(btn("Начать раунд")).toBeUndefined();
    expect(host.textContent).toContain("волна 1/2");
  });

  it("враги и здоровье базы рисуются ровно из присланного состояния", () => {
    const enemies = [
      { id: 1, type: "runner" as const, x: 3, y: 1.5, hp: 36, maxHp: 36, slowed: false },
      { id: 2, type: "grunt" as const, x: 4.5, y: 3, hp: 20, maxHp: 90, slowed: true },
    ];
    render(makeTd({ round: makeTdRound({ enemies, hp: 40, hpMax: 125 }) }));
    expect(host.querySelectorAll('[data-testid="enemy"]')).toHaveLength(2);
    const bar = host.querySelector('[aria-label="Здоровье базы"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemax")).toBe("125");
    expect(host.textContent).toContain("база 40/125");
  });

  it("исход раунда объявляет сервер: победа, поражение, перерыв закончился", () => {
    const result = { hpLeft: 80, hpMax: 100, kills: 15, leaked: 1, total: 19, gameTime: 60 };
    render(makeTd({ round: makeTdRound({ status: "won", result, hp: 80 }) }));
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Победа");
    render(makeTd({ round: makeTdRound({ status: "lost", hp: 0 }) }));
    expect(host.querySelector('[role="status"]')!.textContent).toContain("База пала");
    render(makeTd({ round: makeTdRound({ status: "expired" }) }));
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Перерыв закончился");
  });

  it("раунд прошлого перерыва не показывается как текущий", () => {
    render(makeTd({ round: makeTdRound({ current: false, status: "won" }) }));
    expect(btn("Начать раунд")).toBeDefined();
  });

  it("командный режим: соперник и результат дуэли", () => {
    render(makeTd({
      mode: "teams", team: "A",
      rival: { team: "B", towers: 3, round: makeTdRound({ team: "B", hp: 62, hpMax: 100 }) },
      duel: { stageId: "camp", winner: "A", scores: { A: 1090, B: 0 } },
    }));
    expect(host.textContent).toContain("Соперник · команда B");
    expect(host.textContent).toContain("башен: 3");
    expect(host.textContent).toContain("база 62/100");
    expect(host.textContent).toContain("Дуэль выиграла ваша команда");
    render(makeTd({ mode: "teams", team: "B", rival: { team: "A", towers: 1, round: null }, duel: { stageId: "camp", winner: "A", scores: {} } }));
    expect(host.textContent).toContain("Дуэль выиграла команда A");
  });
});
