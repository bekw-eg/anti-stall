import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Сам интерфейс здесь не нужен: проверяем только маршрутизацию
vi.mock("./tomato/TomatoApp", () => ({ default: () => <div data-testid="tomato-app" /> }));

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function open(path: string) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={[path]}><AppRoutes /><Where /></MemoryRouter>));
  const result = { path: host.querySelector('[data-testid="path"]')?.textContent, app: Boolean(host.querySelector('[data-testid="tomato-app"]')) };
  act(() => root.unmount());
  return result;
}

describe("маршруты", () => {
  it.each(["/game", "/achievements", "/about", "/legacy", "/what/ever"])("%s → редирект на главную", (path) => {
    expect(open(path)).toEqual({ path: "/", app: true });
  });

  it("главная и ссылка-приглашение открывают Tomato", () => {
    expect(open("/")).toEqual({ path: "/", app: true });
    expect(open("/room/K7QM2X")).toEqual({ path: "/room/K7QM2X", app: true });
  });
});
