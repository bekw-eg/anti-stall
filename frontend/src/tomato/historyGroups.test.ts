import { describe, expect, it } from "vitest";
import type { StudySession } from "@/api/tomato";
import { GAP_MS, cycleOutcome, groupSessions, plural } from "./historyGroups";

const MIN = 60_000;
let n = 0;
const s = (over: Partial<StudySession>): StudySession => ({
  id: `s${++n}`, roomId: "r1", roomName: "Комната Bekw", cycleNo: 1, task: "Заработать лям", status: "completed", endReason: "finished",
  startedAt: 0, endedAt: 5 * MIN, scheduledEndAt: 5 * MIN, durationSec: 300, result: null, resultNote: null, rewarded: true, xp: 10, coins: 2,
  ...over,
});

describe("история по задачам", () => {
  it("подряд идущие циклы одной задачи в комнате — один заход с итогами", () => {
    const t0 = Date.UTC(2026, 10, 15, 6, 10);
    // сервер отдаёт новые сверху
    const list = [
      s({ cycleNo: 4, startedAt: t0 + 30 * MIN, endedAt: t0 + 35 * MIN, xp: 20, coins: 4 }),
      s({ cycleNo: 3, startedAt: t0 + 20 * MIN, endedAt: t0 + 22 * MIN, status: "aborted", endReason: "user_abort", rewarded: false, xp: 0, coins: 0 }),
      s({ cycleNo: 2, startedAt: t0 + 10 * MIN, endedAt: t0 + 15 * MIN, xp: 1, coins: 0 }),
      s({ cycleNo: 1, startedAt: t0, endedAt: t0 + 5 * MIN, xp: 3, coins: 1 }),
    ];
    const [g, ...rest] = groupSessions(list);
    expect(rest).toHaveLength(0);
    expect(g.cycles.map((c) => c.cycleNo)).toEqual([1, 2, 3, 4]);
    expect(g).toMatchObject({ counted: 3, early: 1, xp: 24, coins: 5, focusSec: 3 * 300 + 120 });
  });

  it("другая задача, другая комната или долгий перерыв — новый заход; новые заходы сверху", () => {
    const list = [
      s({ startedAt: 40 * MIN + GAP_MS, endedAt: 45 * MIN + GAP_MS, roomId: "r2" }), // та же комната r2, но через 2+ часа
      s({ startedAt: 30 * MIN, endedAt: 35 * MIN, roomId: "r2", roomName: "Другая" }), // другая комната
      s({ startedAt: 20 * MIN, endedAt: 25 * MIN, task: "Физика" }), // другая задача
      s({ startedAt: 10 * MIN, endedAt: 15 * MIN, task: "  ЗАРАБОТАТЬ ЛЯМ " }), // та же задача: регистр и пробелы не важны
      s({ startedAt: 0, endedAt: 5 * MIN }),
    ];
    const groups = groupSessions(list);
    expect(groups.map((g) => g.cycles.length)).toEqual([1, 1, 1, 2]);
    expect(groups[0].startedAt).toBe(40 * MIN + GAP_MS);
  });

  it("исход цикла словами", () => {
    expect(cycleOutcome(s({}))).toBe("засчитан");
    expect(cycleOutcome(s({ status: "aborted" }))).toContain("досрочно");
    expect(cycleOutcome(s({ endReason: "host_skip", rewarded: false }))).toContain("хост пропустил");
    expect(cycleOutcome(s({ endReason: "daily_cap", rewarded: false }))).toContain("лимит");
  });

  it("склонение", () => {
    expect([1, 2, 5, 11, 21, 22].map((k) => plural(k, "цикл", "цикла", "циклов"))).toEqual(["1 цикл", "2 цикла", "5 циклов", "11 циклов", "21 цикл", "22 цикла"]);
  });
});
