import { describe, expect, it } from "vitest";
import { API_ERROR_TEXT, apiErrorText, extractRoomCode, formatTime, initials, memberStatusLabel, readiness, roomLink } from "./format";

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

describe("memberStatusLabel", () => {
  it("в ожидании: не готов → «ждёт», готов → «готов» (без английского Ready)", () => {
    expect(memberStatusLabel({ status: "waiting", isReady: false }, true)).toBe("ждёт");
    expect(memberStatusLabel({ status: "waiting" }, true)).toBe("ждёт");
    expect(memberStatusLabel({ status: "waiting", isReady: true }, true)).toBe("готов");
  });
  it("вне ожидания/перерыва отметка готовности не показывается", () => {
    expect(memberStatusLabel({ status: "focusing", isReady: true }, false)).toBe("в фокусе");
  });
});

describe("readiness", () => {
  const m = (userId: string, connection: "online" | "reconnecting" | "offline", isReady: boolean) => ({ userId, connection, isReady });
  it("участников без связи не ждём, переподключающихся — ждём", () => {
    expect(readiness([m("me", "online", true), m("a", "offline", false)], "me")).toEqual({ ready: 1, total: 1, all: true });
    expect(readiness([m("me", "online", true), m("a", "reconnecting", false)], "me")).toEqual({ ready: 1, total: 2, all: false });
  });
  it("себя считаем всегда, даже если сервер видит нас офлайн", () => {
    expect(readiness([m("me", "offline", false), m("a", "online", true)], "me")).toEqual({ ready: 1, total: 2, all: false });
  });
});

describe("apiErrorText", () => {
  it("коды песочницы — понятным русским текстом, остальное — сообщение сервера", () => {
    for (const code of ["SANDBOX_DEMO_ONLY", "DEMO_SANDBOX_ONLY", "DEMO_DISABLED"]) expect(apiErrorText({ code, message: "x" })).toBe(API_ERROR_TEXT[code]);
    expect(apiErrorText({ code: "WRONG_PHASE", message: "Нельзя сейчас" })).toBe("Нельзя сейчас");
    expect(apiErrorText({ code: "HTTP_ERROR", message: "" })).toBe("Что-то пошло не так");
  });
});
