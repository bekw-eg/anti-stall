import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Axolotl, ITEM_ART, ItemIcon, SKINS, defaultSkin, lookOf } from "./Axolotl";
import { DEFAULT_AVATAR_CATALOG } from "./useTomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("пиксельный аксолотль", () => {
  it("у каждой вещи ровная сетка и все буквы есть в палитре", () => {
    for (const [id, art] of Object.entries(ITEM_ART)) {
      const w = art.rows[0].length;
      for (const row of art.rows) {
        expect(row.length, `${id}: строки разной длины`).toBe(w);
        for (const c of row) if (c !== ".") expect(art.colors[c], `${id}: нет цвета «${c}»`).toBeTruthy();
      }
    }
  });

  it("каталог образов совпадает с нарисованным: у каждой вещи есть рисунок, у каждого цвета — спрайт", () => {
    for (const it of DEFAULT_AVATAR_CATALOG.items) expect(ITEM_ART[it.id], it.id).toBeTruthy();
    expect(new Set(DEFAULT_AVATAR_CATALOG.skins.map((s) => s.id))).toEqual(new Set(SKINS));
  });

  it("цвет по умолчанию стабилен и бесплатный; неизвестный цвет заменяется", () => {
    expect(defaultSkin("abc")).toBe(defaultSkin("abc"));
    expect(["pink", "blue", "mint"]).toContain(defaultSkin("user-1"));
    expect(lookOf("u", { skin: "gold" as never }).skin).toBe(defaultSkin("u"));
    expect(lookOf("u", { skin: "purple", head: "crown" })).toEqual({ skin: "purple", head: "crown", face: null, neck: null });
  });

  it("рисует спрайт и надетые вещи по слоям", () => {
    act(() => root.render(<Axolotl look={{ skin: "yellow", head: "party", face: "shades", neck: "scarf" }} title="Мой" />));
    expect(host.querySelector("image")?.getAttribute("href")).toContain("yellow");
    expect([...host.querySelectorAll("[data-item]")].map((n) => n.getAttribute("data-item"))).toEqual(["scarf", "shades", "party"]);
    act(() => root.render(<ItemIcon id="crown" size={40} />));
    expect(host.querySelector("svg")?.getAttribute("width")).toBe("40");
  });
});
