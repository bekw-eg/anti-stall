import type { StudySession } from "@/api/tomato";

/**
 * История занятий по задачам: подряд идущие циклы одной комнаты с той же задачей — это один заход
 * («Заработать лям · 4 цикла»), а не четыре разные задачи. Новый заход начинается, если сменились
 * комната или задача, либо между циклами прошло больше GAP_MS.
 */
export const GAP_MS = 2 * 60 * 60 * 1000;

export interface SessionGroup {
  key: string;
  task: string | null;
  roomName: string;
  startedAt: number;
  endedAt: number;
  cycles: StudySession[]; // по времени, от раннего к позднему
  counted: number; // засчитанные (с наградой)
  early: number; // завершены досрочно / потеря связи
  xp: number;
  coins: number;
  focusSec: number; // реально отработанное время
}

const norm = (task: string | null) => (task ?? "").trim().toLowerCase();
/** Сколько реально отработано в цикле (досрочный выход или пропуск хостом — меньше плана). */
export const workedSec = (s: StudySession) => {
  if (s.status === "active") return 0;
  const end = s.endedAt ?? s.scheduledEndAt;
  return Math.max(0, Math.min(s.durationSec, Math.round((end - s.startedAt) / 1000)));
};

/** sessions — как отдаёт сервер (новые сверху). Группы — тоже новые сверху. */
export function groupSessions(sessions: StudySession[]): SessionGroup[] {
  const asc = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const groups: SessionGroup[] = [];
  for (const s of asc) {
    const g = groups[groups.length - 1];
    const same = g && g.cycles[0].roomId === s.roomId && norm(g.task) === norm(s.task) && s.startedAt - g.endedAt <= GAP_MS;
    const cur: SessionGroup = same
      ? g
      : { key: s.id, task: s.task, roomName: s.roomName, startedAt: s.startedAt, endedAt: s.startedAt, cycles: [], counted: 0, early: 0, xp: 0, coins: 0, focusSec: 0 };
    if (!same) groups.push(cur);
    cur.cycles.push(s);
    cur.endedAt = Math.max(cur.endedAt, s.endedAt ?? s.scheduledEndAt);
    if (s.rewarded) cur.counted += 1;
    if (s.status === "aborted" || s.status === "abandoned") cur.early += 1;
    cur.xp += s.rewarded ? s.xp + (s.bonusXp ?? 0) : 0;
    cur.coins += s.rewarded ? s.coins + (s.bonusCoins ?? 0) : 0;
    cur.focusSec += workedSec(s);
  }
  return groups.reverse();
}

/** Что случилось с циклом — понятными словами. */
export function cycleOutcome(s: StudySession): string {
  if (s.status === "active") return "идёт";
  if (s.status === "aborted") return "завершён досрочно — без награды";
  if (s.status === "abandoned") return "потеря связи — без награды";
  if (s.endReason === "host_skip") return s.rewarded ? "хост пропустил фокус — награда за отработанное" : "хост пропустил фокус — без награды";
  if (s.endReason === "daily_cap") return "засчитан, дневной лимит наград";
  return s.rewarded ? "засчитан" : "засчитан без награды";
}

const ruDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const ruTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
export const formatDay = (ms: number) => ruDate.format(ms);
export const formatClock = (ms: number) => ruTime.format(ms);

/** «1 цикл», «2 цикла», «5 циклов» */
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return `${n} ${many}`;
  if (b === 1) return `${n} ${one}`;
  if (b >= 2 && b <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}
