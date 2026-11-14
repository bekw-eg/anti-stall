import type { Member, MemberStatus } from "@/api/tomato";

export const pad = (n: number) => n.toString().padStart(2, "0");

export function formatTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  // Длительность вводит пользователь (фокус до 24 ч): от часа показываем ч:мм:сс
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Точная длительность словами без нулевых частей: «1 ч 30 мин», «45 с», «2 мин 10 с». */
export function formatSpan(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const parts: string[] = [];
  if (s >= 3600) parts.push(`${Math.floor(s / 3600)} ч`);
  if (Math.floor((s % 3600) / 60)) parts.push(`${Math.floor((s % 3600) / 60)} мин`);
  if (s % 60 || !parts.length) parts.push(`${s % 60} с`);
  return parts.join(" ");
}

const CODE_RE = /^[A-Z0-9]{6}$/;

/** Принимает «K7QM2X», «k7qm2x» или ссылку вида https://host/room/K7QM2X (?room=K7QM2X). */
export function extractRoomCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromPath = /\/room\/([A-Za-z0-9]{6})(?:[/?#]|$)/.exec(text)?.[1];
  const fromQuery = /[?&]room=([A-Za-z0-9]{6})(?:&|#|$)/.exec(text)?.[1];
  const code = (fromPath ?? fromQuery ?? text).toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Коды ошибок API, для которых у интерфейса свой понятный текст; для остальных — сообщение сервера. */
export const API_ERROR_TEXT: Record<string, string> = {
  SANDBOX_DEMO_ONLY: "В демо-песочнице доступны только демо-комнаты",
  DEMO_SANDBOX_ONLY: "Это демо-комната: войти в неё можно только из демо-песочницы",
  DEMO_DISABLED: "Демо-режим на этом сервере выключен",
  // Tower Wars
  INSUFFICIENT_TEAM_FUNDS: "В казне команды не хватает монет",
  RIVAL_NOT_IN_BATTLE: "Соперник уже не в бою — его раунд закончился",
  NO_ACTIVE_ROUND: "Сейчас нет идущего раунда",
  NO_RIVAL: "Соперника нет: в общем режиме доступны только свои заклинания",
  MERC_COOLDOWN: "Наёмники ещё собираются — подождите секунду",
  REMATCH_USED: "Реванш в этом перерыве уже был",
};
export const apiErrorText = (e: { code: string; message?: string }) => API_ERROR_TEXT[e.code] ?? (e.message || "Что-то пошло не так");

export const roomLink = (code: string) => `${window.location.origin}/room/${code}`;

export const STATUS_LABEL: Record<MemberStatus, string> = {
  waiting: "ждёт", // в комнате, но ещё не отметил «Я готов»
  focusing: "в фокусе",
  finished: "закончил",
  aborted: "вышел раньше",
  abandoned: "нет связи",
  spectating: "наблюдает",
  resting: "отдыхает",
};

/** Подпись участника: пока готовность можно отметить (ожидание / перерыв), отметка «готов» важнее статуса. */
export const memberStatusLabel = (m: Pick<Member, "status" | "isReady">, showReady: boolean) =>
  showReady && m.isReady ? "готов" : STATUS_LABEL[m.status];

/**
 * Готовность к старту фокуса. Сервер участников без связи дольше grace-периода (connection: "offline")
 * пропускает, поэтому их готовность не ждём; себя считаем всегда.
 */
export function readiness(members: Pick<Member, "userId" | "isReady" | "connection">[], meId?: string) {
  const present = members.filter((m) => m.connection !== "offline" || m.userId === meId);
  const ready = present.filter((m) => Boolean(m.isReady)).length;
  return { ready, total: present.length, all: present.length > 0 && ready === present.length };
}

export const initials = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** Длительность для статистики: «45 с», «25 мин», «2 ч 05 мин». */
export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`;
}

/** Сколько прошло: «только что», «3 мин назад», «2 ч назад». */
export function formatAgo(atMs: number, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (s < 45) return "только что";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} мин назад`;
  return `${Math.round(s / 3600)} ч назад`;
}

/**
 * Код комнаты из текущего адреса. Адрес меняется через history.replaceState (вошли → /room/КОД, вышли → /),
 * а параметр роутера при этом остаётся прежним — поэтому читаем window.location, а не useParams.
 */
export const currentRouteCode = (path = typeof window === "undefined" ? "" : window.location.pathname) => extractRoomCode(path) ?? "";

/** «цикл 3 из 4» или, когда план уже выполнен и создатель продолжил, «цикл 7, сверх плана». */
export function cycleLabel(cycleNo: number, planned: number) {
  const n = Math.max(1, cycleNo);
  return n <= planned ? `цикл ${n} из ${planned}` : `цикл ${n}, сверх плана`;
}
