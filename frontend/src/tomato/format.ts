import type { MemberStatus } from "@/api/tomato";

export const pad = (n: number) => n.toString().padStart(2, "0");

export function formatTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
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

export const roomLink = (code: string) => `${window.location.origin}/room/${code}`;

export const STATUS_LABEL: Record<MemberStatus, string> = {
  waiting: "готов",
  focusing: "в фокусе",
  finished: "закончил",
  aborted: "вышел раньше",
  abandoned: "нет связи",
  spectating: "наблюдает",
  resting: "отдыхает",
};

export const initials = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
