import { describe, expect, it } from "vitest";
import { formatSpan, parseDuration } from "./format";

describe("свободный ввод длительности", () => {
  it("минуты, дроби, мм:сс, ч:мм:сс и слова", () => {
    expect(parseDuration("25")).toBe(1500);
    expect(parseDuration("0,5")).toBe(30);
    expect(parseDuration("2.5")).toBe(150);
    expect(parseDuration("25:30")).toBe(1530);
    expect(parseDuration("0:30")).toBe(30);
    expect(parseDuration("1:30:00")).toBe(5400);
    expect(parseDuration("30 с")).toBe(30);
    expect(parseDuration("45 сек")).toBe(45);
    expect(parseDuration("15 мин")).toBe(900);
    expect(parseDuration("1 ч 30 мин")).toBe(5400);
    expect(parseDuration("24ч")).toBe(86_400);
    expect(parseDuration("90s")).toBe(90);
  });
  it("мусор не принимается", () => {
    for (const bad of ["", "абв", "1:75", "5 минут и", "-5", "1:2:3:4"]) expect(parseDuration(bad)).toBeNull();
  });
  it("показ", () => {
    expect([30, 900, 150, 5400, 86_400].map(formatSpan)).toEqual(["30 с", "15 мин", "2 мин 30 с", "1 ч 30 мин", "24 ч"]);
  });
});
