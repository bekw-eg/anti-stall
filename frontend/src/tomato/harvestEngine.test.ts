import { describe, expect, it } from "vitest";
import { makeRain } from "./harvestEngine";
// Серверный движок — эталон: клиент обязан рисовать тот же дождь, что проверяет сервер
import { makeRain as serverRain } from "../../../backend/src/harvest/engine.js";

describe("Harvest: клиентский дождь совпадает с серверным", () => {
  it.each([[1, 60], [42, 60], [987654321, 45], [2 ** 31 - 2, 12]])("зерно %i, %i с", (seed, duration) => {
    const a = makeRain(seed, duration).items;
    const b = (serverRain(seed, duration) as { items: unknown[] }).items;
    expect(a).toEqual(b);
  });
});
