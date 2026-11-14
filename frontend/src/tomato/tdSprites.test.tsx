import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcademyBase, AxolotlTower, TomatoPortal, TowerPreview } from "./tdSprites";
import type { TowerType } from "@/api/tomato";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const render = (node: ReactNode) => act(() => { root.render(<svg>{node}</svg>); });
const q = (sel: string) => host.querySelector(sel);

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const TYPES: TowerType[] = ["arrow", "cannon", "frost"];

describe("AxolotlTower", () => {
  it("рисуется для всех типов, уровней и эффектов", () => {
    for (const type of TYPES) for (const level of [1, 2, 3]) for (const fx of [0, 1, 2, 3, 7]) {
      render(<AxolotlTower type={type} level={level} haste={!!(fx & 1)} slowed={!!(fx & 2)} disabled={!!(fx & 4)} />);
      const tower = q('[data-part="tower"]');
      expect(tower?.getAttribute("data-type")).toBe(type);
      expect(tower?.getAttribute("data-level")).toBe(String(level));
      expect(host.querySelectorAll('[data-part="pips"] circle')).toHaveLength(level);
      expect(!!q('[data-part="haste"]')).toBe(!!(fx & 1));
      expect(!!q('[data-part="haze"]')).toBe(!!(fx & 2));
      expect(!!q('[data-part="ice"]')).toBe(!!(fx & 4));
      // Узлов немного — карта с десятком башен не тяжелеет
      expect(host.querySelectorAll("path, circle, ellipse, rect").length).toBeLessThanOrEqual(50);
    }
  });

  it("уровень 2 — пиксельный шлем, уровень 3 — корона и аура", () => {
    render(<AxolotlTower type="arrow" level={1} />);
    expect(q('[data-item="helmet"]')).toBeNull();
    expect(q('[data-item="crown"]')).toBeNull();
    render(<AxolotlTower type="arrow" level={2} />);
    expect(q('[data-item="helmet"]')).not.toBeNull();
    expect(q('[data-item="crown"]')).toBeNull();
    render(<AxolotlTower type="frost" level={3} />);
    expect(q('[data-item="crown"]')).not.toBeNull();
    expect(q('[data-part="aura"]')).not.toBeNull();
  });

  it("башня в образе владельца: его цвет и вещи; без владельца — цвет по типу", () => {
    render(<AxolotlTower type="cannon" level={1} look={{ skin: "mint", head: "bow", face: "glasses", neck: null }} />);
    expect(q("[data-skin]")?.getAttribute("data-skin")).toBe("mint");
    expect(q('[data-item="bow"]')).not.toBeNull();
    expect(q('[data-item="glasses"]')).not.toBeNull();
    // уровень важнее шапки владельца: на 3-м уровне — корона
    render(<AxolotlTower type="cannon" level={3} look={{ skin: "mint", head: "bow", face: null, neck: null }} />);
    expect(q('[data-item="bow"]')).toBeNull();
    expect(q('[data-item="crown"]')).not.toBeNull();
    render(<AxolotlTower type="frost" level={1} />);
    expect(q("[data-skin]")?.getAttribute("data-skin")).toBe("blue");
  });

  it("id градиентов уникальны для нескольких экземпляров", () => {
    render(<><AxolotlTower type="arrow" level={3} /><AxolotlTower type="arrow" level={3} /></>);
    const ids = [...host.querySelectorAll("[id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("AcademyBase и TomatoPortal", () => {
  it("полоска HP и купол щита", () => {
    render(<AcademyBase hpPct={40} />);
    const bars = host.querySelectorAll('[data-part="hp"] rect');
    expect(Number(bars[1].getAttribute("width"))).toBeCloseTo(56);
    expect(q('[data-part="dome"]')).toBeNull();
    render(<AcademyBase hpPct={150} shielded />);
    expect(Number(host.querySelectorAll('[data-part="hp"] rect')[1].getAttribute("width"))).toBeCloseTo(140);
    expect(q('[data-part="dome"]')).not.toBeNull();
  });

  it("портал и превью башни рисуются", () => {
    render(<TomatoPortal />);
    expect(q('[data-part="portal"]')).not.toBeNull();
    act(() => { root.render(<TowerPreview type="cannon" level={2} size={32} />); });
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(q('[data-item="helmet"]')).not.toBeNull();
  });
});
