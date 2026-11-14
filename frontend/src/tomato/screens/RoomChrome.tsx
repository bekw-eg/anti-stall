/**
 * Общее для экранов комнаты (06 Lobby, 07 Focus, 08 Break): верхняя строка, навигация к карте / прогрессу / профилю,
 * выезжающая панель и приглашение. Готовые панели (RoadMap, StatsPanel, ProfilePanel, ChatPanel) читают цвета
 * из CSS-переменных — здесь они заданы в палитре макета.
 */
import { useEffect, useRef, useState } from "react";
import { BarChart3, Check, Copy, Eye, EyeOff, LogOut, Map as MapIcon, StickyNote, Users, X } from "lucide-react";
import { DemoBadge } from "../Chrome";
import { roomLink } from "../format";
import { ProfilePanel } from "../ProfilePanel";
import { RoadMap } from "../RoadMap";
import { SocialPanel } from "../SocialPanel";
import { StatsPanel } from "../StatsPanel";
import type { Tomato } from "../useTomato";
import type { Stickers } from "./Stickers";
import { Avatar, SeedIcon } from "./ui";

export const LIGHT_VARS = { "--fg": "#3B2422", "--muted": "#7D625E", "--card": "#F6EFEC", "--line": "#CDB3AE", "--field": "#FFFFFF" } as React.CSSProperties;
export const DARK_VARS = { "--fg": "#FFF4EF", "--muted": "#D8BDB6", "--card": "rgba(255,244,239,.08)", "--line": "#8A625C", "--field": "#3B2422" } as React.CSSProperties;

export type Sheet = "map" | "stats" | "social" | "profile" | null;

/** Иконка-кнопка в шапке: на телефоне только значок, с sm — подпись. */
function NavButton({ onClick, label, children, dark, testId, pressed }: { onClick: () => void; label: string; children: React.ReactNode; dark: boolean; testId?: string; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} data-testid={testId} aria-pressed={pressed}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-[12px] border-2 text-[15px] font-extrabold transition-colors sm:h-11 sm:w-auto sm:rounded-[14px] sm:px-3 ${dark ? `border-[#8A625C] text-cream hover:bg-cocoa ${pressed ? "bg-cocoa" : ""}` : `border-ink text-ink as-shadow-sm hover:bg-paper ${pressed ? "bg-lime" : "bg-white"}`}`}>
      {children}<span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

/** Правая часть шапки: карта, прогресс, монеты, жетон профиля. */
export function RoomNav({ t, dark = false, onOpen, active = null, stickers }: { t: Tomato; dark?: boolean; onOpen: (s: Exclude<Sheet, null>) => void; active?: Sheet; stickers?: Stickers }) {
  const me = t.snapshot?.me;
  const name = t.user?.name ?? t.name;
  return (
    <div className="flex items-center gap-1.5 sm:gap-3">
      {stickers && (
        <span className="flex items-center gap-1.5 sm:gap-1">
          <NavButton dark={dark} onClick={stickers.add} label={stickers.full ? "Стикеров максимум" : "Стикер"} testId="add-sticker"><StickyNote size={18} aria-hidden /></NavButton>
          {stickers.items.length > 0 && (
            <NavButton dark={dark} pressed={stickers.hidden} onClick={() => stickers.setHidden(!stickers.hidden)} label={stickers.hidden ? `Показать стикеры (${stickers.items.length})` : "Спрятать стикеры"} testId="toggle-stickers">
              {stickers.hidden ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </NavButton>
          )}
        </span>
      )}
      <NavButton dark={dark} pressed={active === "social"} onClick={() => onOpen("social")} label="Друзья" testId="open-social"><Users size={18} aria-hidden /></NavButton>
      <NavButton dark={dark} pressed={active === "map"} onClick={() => onOpen("map")} label="Карта" testId="open-map"><MapIcon size={18} aria-hidden /></NavButton>
      <NavButton dark={dark} pressed={active === "stats"} onClick={() => onOpen("stats")} label="Прогресс" testId="open-stats"><BarChart3 size={18} aria-hidden /></NavButton>
      <span className={`hidden items-center gap-1.5 sm:inline-flex ${dark ? "text-cream" : "text-ink"}`} title="Ваши монеты" aria-label={`Монеты: ${me?.coins ?? 0}`}>
        <SeedIcon /><span className="font-display text-2xl leading-none" aria-hidden><span className="relative top-0.5">{me?.coins ?? 0}</span></span>
      </span>
      <ProfileChip t={t} dark={dark} onOpen={() => onOpen("profile")} className="hidden sm:inline-flex" />
    </div>
  );
}

/** Жетон профиля: на телефоне — только аватар в первом ряду шапки, с sm — имя и уровень в навигации. */
export function ProfileChip({ t, dark, onOpen, className = "" }: { t: Tomato; dark: boolean; onOpen: () => void; className?: string }) {
  const me = t.snapshot?.me;
  const name = t.user?.name ?? t.name;
  return (
    <button type="button" onClick={onOpen} data-testid="open-profile" aria-label="Профиль и выход из комнаты"
      className={`h-10 shrink-0 items-center gap-2 rounded-full border-2 p-0.5 sm:h-12 sm:py-1 sm:pl-1 sm:pr-4 ${dark ? "border-[#8A625C] text-cream" : "border-ink bg-white text-ink"} ${className || "inline-flex"}`}>
      <Avatar name={name || "?"} id={me?.userId} size={32} ring={dark ? "#FFF4EF" : "#3B2422"} />
      <span className="hidden max-w-[9rem] truncate text-lg font-extrabold sm:inline">{name}</span>
      <span className={`hidden text-base md:inline ${dark ? "text-[#D8BDB6]" : "text-mute"}`}>ур. {me?.level ?? t.user?.level ?? 1}</span>
    </button>
  );
}

/** Выезжающая панель справа (на телефоне — на весь экран). */
export function SheetPanel({ t, sheet, onClose, top = 0 }: { t: Tomato; sheet: Sheet; onClose: () => void; top?: number }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sheet) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, onClose]);
  if (!sheet || !t.snapshot) return null;
  const title = sheet === "map" ? "Карта команды" : sheet === "stats" ? "Прогресс" : sheet === "social" ? "Друзья" : "Профиль";
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-end" style={{ top }} role="dialog" aria-label={title}>
      <button type="button" aria-label="Закрыть" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" />
      <section className="relative flex h-full w-full flex-col border-l-2 border-ink bg-white text-ink sm:w-[min(640px,92vw)] lg:w-[min(880px,70vw)]" style={LIGHT_VARS}>
        <header className="flex items-center justify-between gap-3 border-b-2 border-soft px-5 py-4 sm:px-6">
          <h2 className="font-display text-2xl sm:text-3xl">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть панель" className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-ink bg-white as-shadow-sm"><X size={20} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sheet === "map" && <div><RoadMap road={t.snapshot.challenge} meId={t.snapshot.me?.userId} /></div>}
          {sheet === "stats" && <StatsPanel t={t} />}
          {sheet === "social" && <SocialPanel t={t} />}
          {sheet === "profile" && (
            <div className="flex flex-col gap-4 p-5 sm:p-6">
              {t.demoMode && <DemoBadge className="self-start" />}
              <ProfilePanel t={t} />
              <button type="button" onClick={async () => { if (await t.leaveRoom()) onClose(); }} className="as-btn as-btn-secondary as-btn-sm self-start">
                <LogOut size={18} aria-hidden /> Выйти из комнаты
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Приглашение: код комнаты и кнопка «скопировать ссылку». */
export function Invite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(roomLink(code)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="as-label">Позвать друзей</p>
      <div className="flex flex-col gap-3 xs:flex-row">
        <span className="flex h-14 flex-1 items-center justify-center rounded-[16px] border-2 border-dashed border-rose bg-white px-4 font-display text-2xl tracking-[0.12em] text-rose" aria-label={`Код комнаты ${code.split("").join(" ")}`}>
          <span className="relative top-0.5">{code}</span>
        </span>
        <button type="button" onClick={copy} className="as-btn as-btn-secondary as-btn-sm xs:min-h-[3.5rem]" aria-live="polite">
          {copied ? <><Check size={18} aria-hidden /> Скопировано</> : <><Copy size={18} aria-hidden /> Ссылка</>}
        </button>
      </div>
    </div>
  );
}
