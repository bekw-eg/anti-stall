import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TowerDefense, type TdActions } from "./TowerDefense";
import { makeEnemy, makeTd, makeTdRound } from "./testFixtures";
import type { TdView } from "@/api/tomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Canvas-рендерер (A4) в jsdom не рисует: проверяем только, что компонент кормит его серверным состоянием.
const canvas = vi.hoisted(() => {
  const renderer = { setRound: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
  return { renderer, create: vi.fn((_canvas: HTMLCanvasElement, _opts: { cols: number; rows: number }) => renderer) };
});
vi.mock("./tdCanvas", () => ({ createTdRenderer: canvas.create }));
// Спрайты подменяем заглушками, чтобы видеть флаги эффектов, которые им передаются
vi.mock("./tdSprites", () => ({
  AxolotlTower: (p: { type: string; level: number; haste?: boolean; slowed?: boolean; disabled?: boolean }) => (
    <g data-testid="tower" data-type={p.type} data-level={p.level} data-haste={String(Boolean(p.haste))} data-slowed={String(Boolean(p.slowed))} data-disabled={String(Boolean(p.disabled))} />
  ),
  AcademyBase: (p: { hpPct: number; shielded?: boolean }) => <g data-testid="academy" data-hp={p.hpPct} data-shielded={String(Boolean(p.shielded))} />,
  TomatoPortal: () => <g data-testid="tomato-portal" />,
  TowerPreview: () => <svg />,
}));

let host: HTMLDivElement;
let root: Root;
let actions: { [K in keyof TdActions]: ReturnType<typeof vi.fn> };
const render = (td: TdView) => act(() => { root.render(<TowerDefense td={td} actions={actions as unknown as TdActions} />); });
const slot = (id: string) => host.querySelector(`[data-testid="slot-${id}"]`) as SVGGElement;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const btn = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  canvas.create.mockClear();
  Object.values(canvas.renderer).forEach((f) => f.mockClear());
  const ok = () => vi.fn().mockResolvedValue(null);
  actions = { join: ok(), start: ok(), build: ok(), upgrade: ok(), sendUnit: ok(), castSpell: ok(), rematch: ok() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("TowerDefense: показывает серверное состояние и отправляет намерения", () => {
  it("вне перерыва игра закрыта: ни построек, ни старта, ни штурма", () => {
    render(makeTd({ enabled: false, phase: "focus" }));
    expect(host.textContent).toContain("только на перерыве");
    expect(btn("Начать раунд")).toBeUndefined();
    expect(btn("Черри")).toBeUndefined();
    expect(actions.join).not.toHaveBeenCalled();
  });

  it("на перерыве входит в игру один раз, показывает казну команды, этапы и закрытые этапы", () => {
    render(makeTd());
    render(makeTd({ treasuryCoins: 25 })); // обновление состояния не повторяет вход
    expect(actions.join).toHaveBeenCalledTimes(1);
    const treasury = host.querySelector('[data-testid="treasury"]')!;
    expect(treasury.getAttribute("aria-label")).toBe("Казна команды: 25 монет");
    expect(treasury.textContent).toContain("Казна команды:");
    const bridge = [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Мост дедлайнов")) as HTMLButtonElement;
    expect(bridge.disabled).toBe(true);
    expect(bridge.textContent).toContain("🔒");
  });

  it("постройка: меню башен-аксолотлей, цены с сервера, доступность — по казне команды, а не по личным монетам", async () => {
    render(makeTd({ treasuryCoins: 20, me: { userId: "me", coins: 999, participated: false } }));
    click(slot("s1"));
    const arrow = btn("Аксолотль-Стрелок")!, cannon = btn("Аксолотль-Бомбардир")!, frost = btn("Крио-Аксолотль")!;
    expect(arrow.textContent).toContain("15🪙");
    expect(cannon.disabled).toBe(true); // 30 > 20 в казне: UI-подсказка, окончательно решает сервер
    expect(arrow.disabled).toBe(false);
    expect(frost.disabled).toBe(false);
    click(arrow);
    await flush();
    expect(actions.build).toHaveBeenCalledWith("s1", "arrow");

    render(makeTd({ treasuryCoins: 10, me: { userId: "me", coins: 999, participated: false } }));
    expect(btn("Аксолотль-Стрелок")!.disabled).toBe(true);
  });

  it("слот выбирается и с клавиатуры (Enter)", () => {
    render(makeTd());
    act(() => { slot("s1").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(slot("s1").getAttribute("aria-pressed")).toBe("true");
    expect(slot("s1").getAttribute("role")).toBe("button");
    expect(btn("Аксолотль-Стрелок")).toBeDefined();
  });

  it("клик по башне — улучшение с серверной ценой из казны; максимальный уровень блокирует кнопку", async () => {
    render(makeTd());
    click(slot("s3"));
    const up = btn("Улучшить")!;
    expect(up.textContent).toContain("Улучшить · 12🪙");
    click(up);
    await flush();
    expect(actions.upgrade).toHaveBeenCalledWith("s3", 1);
    render(makeTd({ treasuryCoins: 5 }));
    expect(btn("Улучшить")!.disabled).toBe(true);
    render(makeTd({ towers: [{ slot: "s3", type: "arrow", level: 3, ownerId: "u2", ownerName: "Аня" }] }));
    expect(btn("Максимальный уровень")!.disabled).toBe(true);
  });

  it("старт раунда: выбранный разблокированный этап; во время раунда кнопки старта нет", async () => {
    render(makeTd());
    click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Тренировочный"))!);
    click(btn("Начать раунд")!);
    await flush();
    expect(actions.start).toHaveBeenCalledWith("camp");
    render(makeTd({ round: makeTdRound() }));
    expect(btn("Начать раунд")).toBeUndefined();
    expect(host.textContent).toContain("волна 1/2");
  });

  it("враги и здоровье базы — ровно из присланного состояния; canvas получает каждый новый раунд", () => {
    const enemies = [
      makeEnemy({ id: 1, type: "runner", x: 3, y: 1.5 }),
      makeEnemy({ id: 2, type: "grunt", x: 4.5, y: 3, hp: 20, maxHp: 90, slowed: true }),
      makeEnemy({ id: 3, type: "king", x: 6, y: 4.5, hp: 900, maxHp: 900, isMerc: true, armor: 0.35 }),
    ];
    const round = makeTdRound({ enemies, hp: 40, hpMax: 125 });
    render(makeTd({ round }));
    const nodes = host.querySelectorAll('[data-testid="enemy"]');
    expect(nodes).toHaveLength(3);
    expect(nodes[2].getAttribute("data-merc")).toBe("true");
    expect(nodes[2].textContent).toContain("Томат-Дредноут (наёмник)");
    const bar = host.querySelector('[aria-label="Здоровье базы"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemax")).toBe("125");
    expect(host.textContent).toContain("база 40/125");
    expect(host.querySelector('[data-testid="academy"]')!.getAttribute("data-hp")).toBe("32");

    const cv = host.querySelector('canvas[data-testid="td-canvas"]')!;
    expect(cv.className).toContain("pointer-events-none");
    expect(cv.className).toContain("absolute");
    expect(canvas.create).toHaveBeenCalledTimes(1);
    expect(canvas.create.mock.calls[0][0]).toBe(cv);
    expect(canvas.create.mock.calls[0][1]).toMatchObject({ cols: 12, rows: 7 });
    expect(canvas.renderer.setRound).toHaveBeenLastCalledWith(round, expect.any(Number));

    const next = makeTdRound({ enemies: enemies.slice(0, 1), hp: 35, hpMax: 125 });
    render(makeTd({ round: next }));
    expect(canvas.renderer.setRound).toHaveBeenLastCalledWith(next, expect.any(Number));
    expect(host.querySelectorAll('[data-testid="enemy"]')).toHaveLength(1);
    expect(canvas.create).toHaveBeenCalledTimes(1); // геометрия та же — рендерер не пересоздаётся

    act(() => root.unmount());
    expect(canvas.renderer.destroy).toHaveBeenCalled();
    root = createRoot(host);
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
    render(makeTd({ round: makeTdRound({ current: false, status: "won", enemies: [makeEnemy({ id: 1 })] }) }));
    expect(btn("Начать раунд")).toBeDefined();
    expect(host.querySelectorAll('[data-testid="enemy"]')).toHaveLength(0);
    expect(canvas.renderer.setRound).toHaveBeenLastCalledWith(null, expect.any(Number));
  });

  it("эффекты раунда: ускорение и замедление — всем своим башням, заморозка — только целевой; щит — у базы", () => {
    const effects = [
      { id: 1, kind: "haste" as const, targetSlot: null, expiresAtGameTime: 15, factor: 1.35 },
      { id: 2, kind: "disable_tower" as const, targetSlot: "s3", expiresAtGameTime: 14, factor: 1 },
      { id: 3, kind: "repair" as const, targetSlot: null, expiresAtGameTime: 13, factor: 0.3 },
      { id: 4, kind: "slow_towers" as const, targetSlot: null, expiresAtGameTime: 5, factor: 1.65 }, // уже истёк (t = 10)
    ];
    const towers = [
      { slot: "s3", type: "arrow" as const, level: 2, ownerId: "u2", ownerName: "Аня" },
      { slot: "s1", type: "frost" as const, level: 1, ownerId: "me", ownerName: "Лотти" },
    ];
    render(makeTd({ towers, round: makeTdRound({ effects }) }));
    const tw = (s: string) => slot(s).querySelector('[data-testid="tower"]')!;
    expect(tw("s3").getAttribute("data-haste")).toBe("true");
    expect(tw("s1").getAttribute("data-haste")).toBe("true");
    expect(tw("s3").getAttribute("data-disabled")).toBe("true");
    expect(tw("s1").getAttribute("data-disabled")).toBe("false");
    expect(tw("s1").getAttribute("data-slowed")).toBe("false");
    expect(tw("s3").getAttribute("data-level")).toBe("2");
    expect(host.querySelector('[data-testid="academy"]')!.getAttribute("data-shielded")).toBe("true");
    expect(host.textContent).toContain("Башни ускорены");

    render(makeTd({ towers, round: makeTdRound({ effects: [{ id: 5, kind: "slow_towers", targetSlot: null, expiresAtGameTime: 16, factor: 1.65 }] }) }));
    expect(tw("s1").getAttribute("data-slowed")).toBe("true");
    expect(tw("s3").getAttribute("data-slowed")).toBe("true");
    expect(tw("s3").getAttribute("data-haste")).toBe("false");
  });

  it("командный режим: соперник, его казна, база и результат дуэли", () => {
    render(makeTd({
      mode: "teams", team: "A",
      rival: { team: "B", towers: 3, treasuryCoins: 17, round: makeTdRound({ team: "B", hp: 62, hpMax: 100 }) },
      duel: { stageId: "camp", winner: "A", scores: { A: 1090, B: 0 }, roundNo: 1 },
    }));
    expect(host.textContent).toContain("Соперник · команда B");
    expect(host.textContent).toContain("башен: 3");
    expect(host.textContent).toContain("казна 17🪙");
    expect(host.textContent).toContain("база 62/100");
    expect(host.querySelector('[aria-label="Здоровье базы команды B"]')!.getAttribute("aria-valuenow")).toBe("62");
    expect(host.textContent).toContain("Дуэль выиграла ваша команда");
    expect(host.textContent).toContain("A 1090 : B 0");
    render(makeTd({ mode: "teams", team: "B", rival: { team: "A", towers: 1, treasuryCoins: 0, round: null }, duel: { stageId: "camp", winner: "A", scores: {}, roundNo: 1 } }));
    expect(host.textContent).toContain("Дуэль выиграла команда A");
  });
});

describe("TowerDefense: штурм и поддержка", () => {
  it("общий режим: подкрепление волны только в идущий раунд; цена из казны; клик — намерение на сервер", async () => {
    render(makeTd());
    expect(btn("Черри · 2🪙")!.disabled).toBe(true); // раунда нет
    expect(host.textContent).toContain("только в идущий раунд");

    render(makeTd({ treasuryCoins: 20, round: makeTdRound() }));
    const cherry = btn("Черри · 2🪙")!;
    expect(cherry.disabled).toBe(false);
    expect(btn("Дредноут · 25🪙")!.disabled).toBe(true); // 25 > 20
    click(cherry);
    await flush();
    expect(actions.sendUnit).toHaveBeenCalledWith("cherry");
  });

  it("общий режим: свои заклинания работают в раунде, атакующие — заблокированы с подсказкой", async () => {
    render(makeTd({ round: makeTdRound() }));
    const haste = btn("Ускорить своих · 10🪙")!;
    expect(haste.disabled).toBe(false);
    expect(btn("Щит базы · 12🪙")!.disabled).toBe(false);
    for (const label of ["Замедлить башни врага · 10🪙", "Заморозить башню · 14🪙", "Ярость томатов · 12🪙"]) expect(btn(label)!.disabled).toBe(true);
    expect(host.querySelector('[data-testid="spell-hint"]')!.textContent).toContain("соперника нет");
    click(haste);
    await flush();
    expect(actions.castSpell).toHaveBeenCalledWith("haste");

    render(makeTd()); // без раунда — и свои недоступны
    expect(btn("Ускорить своих · 10🪙")!.disabled).toBe(true);
  });

  it("команды: наёмники ждут старта соперника; в его бою — атакующие заклинания; после его раунда — нельзя", async () => {
    const teams = (rivalRound: ReturnType<typeof makeTdRound> | null, over: Partial<TdView> = {}) =>
      makeTd({ mode: "teams", team: "A", rival: { team: "B", towers: 2, treasuryCoins: 5, round: rivalRound }, ...over });

    render(teams(null));
    expect(btn("Спелый · 5🪙")!.disabled).toBe(false);
    expect(host.querySelector('[data-testid="merc-hint"]')!.textContent).toContain("ещё не начала раунд");
    expect(btn("Замедлить башни врага · 10🪙")!.disabled).toBe(true);

    render(teams(makeTdRound({ team: "B" })));
    const slow = btn("Замедлить башни врага · 10🪙")!;
    expect(slow.disabled).toBe(false);
    click(slow);
    await flush();
    expect(actions.castSpell).toHaveBeenCalledWith("slow_towers");
    click(btn("Броне-томат · 12🪙")!);
    await flush();
    expect(actions.sendUnit).toHaveBeenCalledWith("armored");

    render(teams(makeTdRound({ team: "B", status: "lost", hp: 0 })));
    expect(btn("Черри · 2🪙")!.disabled).toBe(true);
    expect(btn("Заморозить башню · 14🪙")!.disabled).toBe(true);
    expect(host.querySelector('[data-testid="merc-hint"]')!.textContent).toContain("закончил раунд");

    render(teams(makeTdRound({ team: "B" }), { treasuryCoins: 9 }));
    expect(btn("Замедлить башни врага · 10🪙")!.disabled).toBe(true); // казна 9 < 10
  });

  it("реванш: кнопка при available, бонус контратаки; иначе — причина от сервера", async () => {
    const finished = makeTdRound({ team: "A", status: "won", stageId: "forest" });
    render(makeTd({
      mode: "teams", team: "A", round: finished,
      rival: { team: "B", towers: 1, treasuryCoins: 0, round: makeTdRound({ team: "B", status: "lost", hp: 0 }) },
      rematch: { available: true, reason: null, roundNo: 2, counterattackCoins: 40, bonusTeam: "B" },
    }));
    const rematch = btn("Смена ролей / Реванш (Раунд 2)")!;
    expect(rematch.disabled).toBe(false);
    expect(host.textContent).toContain("команда B получит +40🪙");
    click(rematch);
    await flush();
    expect(actions.rematch).toHaveBeenCalledWith("forest");

    render(makeTd({ round: makeTdRound({ status: "won" }), rematch: { available: false, reason: "соперник ещё в бою", roundNo: 1, counterattackCoins: 40, bonusTeam: "shared" } }));
    expect(btn("Смена ролей")).toBeUndefined();
    expect(host.querySelector('[data-testid="rematch-reason"]')!.textContent).toContain("соперник ещё в бою");
    expect(host.textContent).toContain("это вам");

    render(makeTd({ round: makeTdRound({ roundNo: 2 }) }));
    expect(host.textContent).toContain("Раунд 2 · реванш");
  });
});
