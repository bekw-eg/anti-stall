import { describe, expect, it } from "vitest";
import { defaultNode, edgeFill, nodeById } from "./roadmapGeometry";
import { makeRoad } from "./testFixtures";

describe("roadmapGeometry", () => {
  it("edgeFill: доля пути считается только по серверным очкам", () => {
    const r = makeRoad(3);
    expect(edgeFill(r, "camp", "forest")).toBe(1);
    expect(edgeFill(r, "forest", "bridge")).toBe(0.5);
    expect(edgeFill(r, "bridge", "fortress")).toBe(0);
  });
  it("edgeFill: нулевые и неизвестные узлы", () => {
    expect(edgeFill(makeRoad(0), "camp", "forest")).toBe(0);
    expect(edgeFill(makeRoad(6), "bridge", "fortress")).toBe(1);
    expect(edgeFill(makeRoad(1), "camp", "nope")).toBe(0);
  });
  it("defaultNode: следующий этап, а после цели — финальный", () => {
    expect(defaultNode(makeRoad(1)).id).toBe("forest");
    expect(defaultNode(makeRoad(6)).id).toBe("fortress");
  });
  it("nodeById", () => {
    expect(nodeById(makeRoad(0), "bridge")?.requiredPoints).toBe(4);
    expect(nodeById(makeRoad(0), "x")).toBeUndefined();
  });
});
