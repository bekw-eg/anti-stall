/**
 * Общие элементы макета AntiStall (Figma, страница back → Components):
 * логотип, аватар-жетон, иконка семечка, «доска» Road Map для лендинга и закрытой карты.
 */
import type { ReactNode } from "react";
import type { Connection } from "@/api/tomato";

/** Цвета жетонов из макета (экран 05 Auth / Guest). Цвет участника постоянный: считается из его id. */
export const TOKEN_COLORS = ["#EAA695", "#FFCEC2", "#A0726D", "#D3DB8E", "#8C7D4A", "#F1E3DE"] as const;
const DARK_TOKENS = new Set(["#A0726D", "#8C7D4A"]);

export function colorFor(id: string | undefined) {
  if (!id) return TOKEN_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TOKEN_COLORS[h % TOKEN_COLORS.length];
}

/** Знак логотипа: путь из трёх узлов (экспорт из Figma, Components → Logo → mark). */
export function LogoMark({ className = "h-9 w-[52px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 52 36" fill="none" aria-hidden className={className}>
      <path d="M8 27L26 12L44 22" strokeWidth="4" strokeLinecap="round" stroke="#EAA695" />
      <ellipse cx="8" cy="27" rx="7.5" ry="6" fill="#EAA695" />
      <ellipse cx="44" cy="22" rx="7.5" ry="6" fill="#EAA695" />
      <ellipse cx="26" cy="12" rx="10" ry="8" fill="#A0726D" />
      <ellipse cx="26" cy="12" rx="13.5" ry="11.5" stroke="#A0726D" strokeWidth="2" strokeDasharray="3.3 3.3" />
    </svg>
  );
}

export function Logo({ tone = "ink", compact = false }: { tone?: "ink" | "cream"; compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5" aria-label="AntiStall">
      <LogoMark className={compact ? "h-7 w-10" : "h-8 w-[46px] sm:h-9 sm:w-[52px]"} />
      <span className={`font-display leading-none ${compact ? "text-xl" : "text-[26px] sm:text-[32px]"} ${tone === "cream" ? "text-cream" : "text-ink"} ${compact ? "hidden lg:inline" : ""}`} aria-hidden>
        AntiStall
      </span>
    </span>
  );
}

export function SeedIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 22" fill="none" aria-hidden className={className}>
      <path d="M11 3.5C15 7 16.5 10.3 16.5 13.2C16.5 16.3 14.1 18.5 11 18.5C7.9 18.5 5.5 16.3 5.5 13.2C5.5 10.3 7 7 11 3.5Z" fill="#EAA695" stroke="#3B2422" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M11 9.5V15.5" stroke="#3B2422" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Круглый жетон участника: инициал на цвете жетона, обводка. */
export function Avatar({ name, id, size = 36, ring = "#3B2422", className = "" }: { name: string; id?: string; size?: number; ring?: string; className?: string }) {
  const bg = colorFor(id ?? name);
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-display leading-none ${className}`}
      style={{ width: size, height: size, background: bg, border: `2.5px solid ${ring}`, color: DARK_TOKENS.has(bg) ? "#FFF4EF" : "#3B2422", fontSize: Math.round(size * 0.46) }}
      aria-hidden
    >
      <span style={{ marginTop: Math.round(size * 0.08) }}>{(name.trim()[0] ?? "?").toUpperCase()}</span>
    </span>
  );
}

/** «Доска» дороги к цели: декоративная (лендинг, закрытая карта в фокусе). Настоящая карта — RoadMap. */
export function RoadmapArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1190 320" fill="none" aria-hidden className={className} preserveAspectRatio="xMidYMid meet">
      <rect width="1190" height="320" rx="160" fill="#A0726D" />
      <g fill="#8E625D">
        {[[210, 70], [360, 262], [520, 58], [690, 270], [840, 60], [990, 268], [1110, 96], [70, 130]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="4" />)}
      </g>
      <path d="M130 212 L285 138 L440 200 L600 112" stroke="#EAA695" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M600 112 L760 196 L915 128 L1065 196" stroke="#FFCEC2" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0 19" opacity=".85" />
      <g fill="#7A504B">
        <ellipse cx="130" cy="220" rx="32" ry="25" /><ellipse cx="285" cy="146" rx="32" ry="25" /><ellipse cx="440" cy="208" rx="32" ry="25" />
        <ellipse cx="600" cy="121" rx="44" ry="35" /><ellipse cx="760" cy="204" rx="30" ry="24" /><ellipse cx="915" cy="136" rx="30" ry="24" /><ellipse cx="1065" cy="205" rx="38" ry="30" />
      </g>
      <g fill="#EAA695"><ellipse cx="130" cy="212" rx="32" ry="25" /><ellipse cx="285" cy="138" rx="32" ry="25" /><ellipse cx="440" cy="200" rx="32" ry="25" /></g>
      <g fill="#F6C6B9"><ellipse cx="130" cy="203" rx="15" ry="6" /><ellipse cx="285" cy="129" rx="15" ry="6" /><ellipse cx="440" cy="191" rx="15" ry="6" /></g>
      <ellipse cx="600" cy="112" rx="66" ry="54" stroke="#FFCEC2" strokeWidth="3" strokeDasharray="10 9" />
      <ellipse cx="600" cy="112" rx="44" ry="35" fill="#EAA695" />
      <ellipse cx="600" cy="99" rx="22" ry="8" fill="#F6C6B9" />
      <path d="M600 104 V38" stroke="#3B2422" strokeWidth="4" strokeLinecap="round" />
      <path d="M602 40 L632 50 L602 62 Z" fill="#FFF4EF" stroke="#3B2422" strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="760" cy="196" rx="30" ry="24" fill="#A0726D" stroke="#FFCEC2" strokeWidth="4" />
      <ellipse cx="915" cy="128" rx="30" ry="24" fill="#A0726D" stroke="#FFCEC2" strokeWidth="4" />
      <ellipse cx="1065" cy="196" rx="38" ry="30" fill="#FFCEC2" />
      <path d="M1049 208 V186 H1055 V191 H1061 V186 H1069 V191 H1075 V186 H1081 V208 Z" fill="#A0726D" stroke="#7A504B" strokeWidth="2" strokeLinejoin="round" />
      <path d="M1062 208 V200 A3 3 0 0 1 1068 200 V208" fill="#FFCEC2" />
    </svg>
  );
}

/** Подпись-«наклейка» над доской (лендинг). */
export function Tag({ children, dot = "#EAA695", className = "" }: { children: ReactNode; dot?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-3 py-1 text-sm font-bold text-ink ${className}`}>
      <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink" style={{ background: dot }} aria-hidden />
      {children}
    </span>
  );
}

/** Значок «ожидание / фокус / перерыв» в верхней строке комнаты. */
export function PhasePill({ children, tone = "paper", dot }: { children: ReactNode; tone?: "paper" | "cocoa" | "lime"; dot?: string }) {
  const cls = tone === "cocoa" ? "bg-cocoa text-cream" : tone === "lime" ? "bg-[#EEF0D2] text-olive" : "bg-paper text-mute";
  return (
    <span className={`as-pill whitespace-nowrap ${cls}`}>
      {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  );
}

const PRESENCE: Record<Connection, { color: string; label: string }> = {
  online: { color: "#5E6B1F", label: "в сети" },
  reconnecting: { color: "#EAA695", label: "переподключается" },
  offline: { color: "#B8A39E", label: "нет связи" },
};

/** Корона создателя комнаты — сидит на жетоне сверху. */
export function Crown({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" fill="none" aria-hidden className={className}>
      <path d="M3 13.5 L2 4 L7.5 8.5 L12 2 L16.5 8.5 L22 4 L21 13.5 Z" fill="#F2B84B" stroke="#3B2422" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="2.2" r="1.6" fill="#FFF4EF" stroke="#3B2422" strokeWidth="1.2" />
    </svg>
  );
}

/** Жетон участника с точкой присутствия (в сети / переподключается / нет связи); у создателя комнаты — корона. */
export function MemberAvatar({ name, id, connection, size = 36, ring = "#3B2422", host = false }: { name: string; id: string; connection: Connection; size?: number; ring?: string; host?: boolean }) {
  const p = PRESENCE[connection] ?? PRESENCE.online;
  return (
    <span className="relative inline-flex shrink-0" data-member-avatar={id} data-connection={connection} data-host={host ? "true" : undefined} title={`${name}${host ? " · создатель комнаты" : ""}: ${p.label}`}>
      {host && <span className="absolute left-1/2 z-10 -translate-x-1/2 -rotate-6" style={{ width: Math.round(size * 0.78), top: -Math.round(size * 0.5) }}><Crown className="block w-full" /></span>}
      <Avatar name={name} id={id} size={size} ring={ring} />
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white" style={{ background: p.color }} aria-label={p.label} role="img" />
    </span>
  );
}
