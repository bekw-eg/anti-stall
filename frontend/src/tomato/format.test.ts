import { describe, expect, it } from "vitest";
import { extractRoomCode, formatTime, initials, roomLink } from "./format";

describe("formatTime", () => {
  it("форматирует секунды как MM:SS", () => {
    expect(formatTime(1500)).toBe("25:00");
    expect(formatTime(61)).toBe("01:01");
    expect(formatTime(0)).toBe("00:00");
  });
  it("не показывает отрицательное время и округляет", () => {
    expect(formatTime(-5)).toBe("00:00");
    expect(formatTime(24.6)).toBe("00:25");
  });
});

describe("extractRoomCode", () => {
  it("принимает код в любом регистре", () => {
    expect(extractRoomCode("k7qm2x")).toBe("K7QM2X");
    expect(extractRoomCode("  K7QM2X \n")).toBe("K7QM2X");
  });
  it("достаёт код из ссылки", () => {
    expect(extractRoomCode("https://tomato.app/room/K7QM2X")).toBe("K7QM2X");
    expect(extractRoomCode("http://localhost:4499/room/k7qm2x?x=1")).toBe("K7QM2X");
    expect(extractRoomCode("https://tomato.app/?room=K7QM2X&utm=a")).toBe("K7QM2X");
  });
  it("отклоняет мусор", () => {
    for (const bad of ["", "   ", "K7QM2", "K7QM2XX", "K7Q M2X", "https://tomato.app/room/", "<script>"]) {
      expect(extractRoomCode(bad)).toBeNull();
    }
  });
});

describe("прочее", () => {
  it("инициалы и ссылка", () => {
    expect(initials("  аня")).toBe("А");
    expect(initials("")).toBe("?");
    expect(roomLink("ABC123")).toBe(`${window.location.origin}/room/ABC123`);
  });
});
