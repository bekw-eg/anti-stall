import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Пользователь включил «уменьшить движение»: маркер карты перескакивает мгновенно, без промежуточных кадров. */
describe("prefers-reduced-motion", () => {
  it("маркер Road Map не «плывёт», а встаёт на серверную позицию сразу", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false,
    }));
    const { RoadMap } = await import("./RoadMap");
    const { makeRoad } = await import("./testFixtures");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<RoadMap road={makeRoad(2)} />));
    const marker = host.querySelector('[data-testid="marker-shared"]') as HTMLElement;
    expect(marker.style.left).toBe("30%");
    const seen: number[] = [];
    const timer = setInterval(() => seen.push(parseFloat(marker.style.left)), 10);
    act(() => root.render(<RoadMap road={makeRoad(4)} />));
    await vi.waitFor(() => expect(parseFloat(marker.style.left)).toBeCloseTo(54, 0), { timeout: 2000 });
    clearInterval(timer);
    expect(seen.filter((v) => v > 31 && v < 53)).toHaveLength(0);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});
