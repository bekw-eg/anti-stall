import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutCard } from "./ProfilePanel";
import type { Tomato } from "./useTomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Выход из аккаунта на странице профиля: два шага, без window.confirm; гость предупреждён о потере прогресса. */
describe("выход из аккаунта", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const q = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const render = (user: { login: string | null }, logout = vi.fn()) => {
    act(() => root.render(<LogoutCard t={{ user, logout } as unknown as Tomato} />));
    return logout;
  };

  it("аккаунт: первый клик только спрашивает, второй выходит", () => {
    const logout = render({ login: "bekw" });
    expect(host.textContent).toContain("Прогресс сохранится");
    act(() => q("logout-open")!.click());
    expect(logout).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Точно выйти из аккаунта");
    act(() => q("logout-confirm")!.click());
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("«Остаться» возвращает к первому шагу, выход не вызывается", () => {
    const logout = render({ login: "bekw" });
    act(() => q("logout-open")!.click());
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Остаться")!.click());
    expect(logout).not.toHaveBeenCalled();
    expect(q("logout-open")).not.toBeNull();
  });

  it("гость без логина: в предупреждении сказано, что прогресс пропадёт", () => {
    render({ login: null });
    expect(host.textContent).toContain("прогресс после выхода не вернуть");
    act(() => q("logout-open")!.click());
    expect(host.textContent).toContain("потерять гостя вместе с прогрессом");
  });
});
