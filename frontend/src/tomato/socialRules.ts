import type { Member } from "@/api/tomato";
import type { Tomato } from "./useTomato";

export type ActionType = "boost" | "shield" | "fog" | "sticker";
export const KIND: Record<ActionType, "help" | "prank"> = { boost: "help", shield: "help", fog: "prank", sticker: "prank" };
export const ACTION_TEXT: Record<ActionType, string> = { boost: "бонус к XP", shield: "щит от шуток", fog: "туман", sticker: "липучка" };
/** Цвета команд (как в макете): A — лосось, B — мокко; общий режим — светлый лосось */
export const TEAM_COLOR: Record<string, string> = { A: "#EAA695", B: "#A0726D", shared: "#FFCEC2" };
/** Цена щита по умолчанию; актуальную присылает сервер (GET /api/config → t.shieldCost) */
export const SHIELD_COST = 10;

/**
 * Почему действие сейчас недоступно (подсказка для кнопки). Окончательно решает сервер —
 * здесь только объяснение пользователю, чтобы не нажимать заведомо бесполезную кнопку.
 */
export function disabledReason(type: ActionType, target: Member, t: Pick<Tomato, "snapshot" | "feed"> & { shieldCost?: number }): string | null {
  const shieldCost = t.shieldCost ?? SHIELD_COST;
  const snap = t.snapshot!;
  const me = snap.me;
  if (!me) return "Вы не участник комнаты";
  if (snap.room.phase !== "break") return "Доступно на перерыве";
  const kind = KIND[type];
  const sentThisBreak = t.feed.some((a) => a.fromUserId === me.userId && a.toUserId === target.userId && a.type === type && a.at >= snap.room.phaseStartedAt);
  if (sentThisBreak) return "Уже отправлено в этот перерыв";
  if (kind === "help") {
    if (snap.room.mode === "teams" && target.team !== me.team) return "Помогать можно только своей команде";
    if (type === "shield" && me.coins < shieldCost) return `Нужно ${shieldCost} монет`;
    return null;
  }
  // Шутки — дебафф команде соперника (выключить нельзя): своим не отправляются
  if (snap.room.mode === "teams" && target.team === me.team) return "Шутки летят только в команду соперника";
  if (target.status === "focusing") return "Игрок занимается";
  return null;
}
