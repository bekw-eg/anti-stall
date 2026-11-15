/**
 * Главная (страница профиля): профиль и образ, статистика, друзья, «создать / войти по коду».
 * Сюда ведёт аватарка на лендинге, в том числе из комнаты — это НЕ выход: участие, таймер и награды идут дальше,
 * а полоса сверху показывает фазу и возвращает в комнату одним нажатием. Логотип ведёт на лендинг.
 *
 * Цвета задаются здесь явно (text-ink + светлые переменные): главная может открываться поверх тёмного фокуса,
 * и без этого заголовки, имя и код друга наследовали светлый текст тёмной темы и сливались с белым фоном.
 */
import { useState } from "react";
import { ArrowRight, BarChart3, DoorOpen, KeyRound, Plus, Shirt, Users } from "lucide-react";
import { formatTime } from "../format";
import { FriendsTab } from "../FriendsTab";
import { ProfilePanel } from "../ProfilePanel";
import { StatsPanel } from "../StatsPanel";
import type { Tomato } from "../useTomato";
import { DemoBadge } from "../Chrome";
import { LIGHT_VARS } from "./RoomChrome";
import type { JoinMode } from "./JoinScreen";
import { Avatar, Logo } from "./ui";

type Section = "profile" | "stats" | "friends";
const SECTIONS: [Section, string, React.ReactNode][] = [
  ["profile", "Профиль и образ", <Shirt key="i" size={18} aria-hidden />],
  ["stats", "Статистика", <BarChart3 key="i" size={18} aria-hidden />],
  ["friends", "Друзья", <Users key="i" size={18} aria-hidden />],
];
const PHASE_WORD: Record<string, string> = { waiting: "ждём всех", focus: "идёт фокус", break: "перерыв", completed: "комната закрыта" };

/** Полоса «вы в комнате»: фаза, таймер и возврат. Видна только если игрок в комнате. */
export function RoomReturnBar({ t, onReturn }: { t: Tomato; onReturn: () => void }) {
  const room = t.snapshot?.room;
  if (!room) return null;
  const left = t.remainingMs !== null && (room.phase === "focus" || room.phase === "break") ? formatTime(Math.ceil(t.remainingMs / 1000)) : null;
  const focus = room.phase === "focus";
  return (
    <div className={`sticky top-0 z-40 border-b-2 border-ink ${focus ? "bg-ink text-cream" : "bg-lime text-ink"}`} data-testid="room-return-bar">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-8">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[15px] font-bold sm:text-base">
          <span>Вы в комнате</span>
          <span className="truncate font-extrabold">«{room.name}»</span>
          <span className={focus ? "text-[#D8BDB6]" : "text-mute"}>· {PHASE_WORD[room.phase] ?? room.phase}{left && <> · <span className="tabular-nums">{left}</span></>}</span>
        </p>
        <button type="button" onClick={onReturn} className={`as-btn as-btn-sm ${focus ? "as-btn-light" : "as-btn-primary"}`} data-testid="return-to-room">
          Вернуться в комнату <ArrowRight size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function Home({ t, onReturn, onJoinScreen, onLogo }: { t: Tomato; onReturn: () => void; onJoinScreen: (mode: JoinMode) => void; onLogo?: () => void }) {
  const [section, setSection] = useState<Section>("profile");
  const inRoom = Boolean(t.snapshot?.room);
  const user = t.user;
  const name = user?.name ?? t.name;
  const level = t.snapshot?.me?.level ?? user?.level ?? 1;
  const coins = t.snapshot?.me?.coins ?? user?.coins ?? 0;
  const guest = !user?.login;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white text-ink" style={LIGHT_VARS} data-testid="home-screen">
      <RoomReturnBar t={t} onReturn={onReturn} />
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6">
        {onLogo ? (
          <button type="button" onClick={onLogo} data-testid="home-logo" aria-label="AntiStall: на первую страницу" title="На первую страницу" className="rounded-[12px] p-1 transition-colors hover:bg-paper">
            <Logo />
          </button>
        ) : <Logo />}
        {/* на телефоне — аватар и уровень, имя и монеты — с планшета */}
        <span className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full border-2 border-ink bg-white py-1 pl-1 pr-4 text-ink" data-testid="home-chip">
          <Avatar name={name || "?"} id={user?.id} look={user?.avatar} size={34} ring="#3B2422" />
          <span className="hidden max-w-[10rem] truncate text-lg font-extrabold sm:inline">{name}</span>
          <span className="whitespace-nowrap text-sm font-bold text-mute sm:text-base">ур. {level}<span className="hidden sm:inline"> · {coins} монет</span></span>
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-4 pb-14 sm:px-8">
        <section aria-labelledby="home-h" className="flex flex-col gap-5 rounded-[28px] bg-paper p-5 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div className="flex flex-col gap-2">
            <h1 id="home-h" className="font-display text-[clamp(2rem,6vw,3rem)] leading-[1.05]"><span className="relative top-1">Привет, {name}!</span></h1>
            <p className="max-w-xl text-base text-mute sm:text-lg">
              {inRoom ? "Комната продолжает работать без вас на экране: таймер и награды идут, вернуться можно в любой момент."
                : "Соберите друзей в комнату и запустите общий таймер. Здесь — ваш профиль, статистика и друзья."}
            </p>
            {guest && (
              <p className="flex items-start gap-2 text-sm font-semibold text-mute">
                <KeyRound size={16} className="mt-0.5 shrink-0" aria-hidden />
                Вы гость: профиль исчезнет, когда закроете браузер. Задайте логин и пароль в «Профиль и образ» → «Настройки», чтобы сохранить прогресс.
              </p>
            )}
            {t.demoMode && <DemoBadge className="self-start" />}
          </div>
          <div className="flex shrink-0 flex-col gap-2.5 xs:flex-row sm:flex-col lg:flex-row">
            {inRoom ? (
              <button type="button" onClick={onReturn} className="as-btn as-btn-primary"><DoorOpen size={20} aria-hidden /> В комнату</button>
            ) : (
              <>
                <button type="button" onClick={() => onJoinScreen("create")} className="as-btn as-btn-primary" data-testid="home-create"><Plus size={20} aria-hidden /> Создать комнату</button>
                <button type="button" onClick={() => onJoinScreen("join")} className="as-btn as-btn-secondary" data-testid="home-join">Войти по коду</button>
              </>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Разделы">
            {SECTIONS.map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)} data-testid={`home-tab-${id}`}
                className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-[16px] border-2 px-4 text-base font-extrabold transition-colors ${section === id ? "border-ink bg-ink text-cream" : "border-line bg-white text-ink hover:border-ink"}`}>
                {icon}{label}
              </button>
            ))}
          </div>
          {section === "profile" && (
            <div className="overflow-hidden rounded-[28px] border-2 border-soft">
              <ProfilePanel t={t} canLogout={!t.snapshot} />
            </div>
          )}
          {section === "stats" && (
            <div className="overflow-hidden rounded-[28px] border-2 border-soft" style={LIGHT_VARS}>
              <StatsPanel t={t} />
            </div>
          )}
          {section === "friends" && (
            <div className="rounded-[28px] border-2 border-soft p-5 sm:p-6" style={LIGHT_VARS}>
              <FriendsTab t={t} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
