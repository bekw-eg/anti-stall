import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useParams } from "react-router-dom";
import { ConnectionBanner, DemoBadge, Toasts } from "./Chrome";
import { cycleLabel, formatTime } from "./format";
import { PrankOverlay } from "./PrankOverlay";
import { RoomInvites } from "./FriendsTab";
import { BreakRoom } from "./screens/BreakRoom";
import { EndEarly, FocusRoom } from "./screens/FocusRoom";
import { JoinScreen, type JoinMode } from "./screens/JoinScreen";
import { Landing } from "./screens/Landing";
import { Lobby } from "./screens/Lobby";
import { DARK_VARS, LIGHT_VARS, ProfileChip, RoomNav, SheetPanel, type Sheet } from "./screens/RoomChrome";
import { useStickers, type Stickers } from "./screens/Stickers";
import { Logo, MemberAvatar, PhasePill } from "./screens/ui";
import { client, useTomato, type Tomato } from "./useTomato";
import { VoiceBar } from "./VoiceBar";
import { useVoice } from "./voice/useVoice";

/**
 * Интерфейс AntiStall по макету Figma (страница back):
 * 01 Welcome → 05 Auth / Guest → комната: 06 Lobby (ожидание) · 07 Focus · 08 Break.
 * Экран комнаты выбирает фаза с сервера; все данные и действия — из useTomato (готовый backend).
 */
export default function TomatoApp() {
  const { code: routeCode } = useParams();
  const t = useTomato(routeCode);
  const room = t.snapshot?.room;
  const phase = room?.phase;
  const voice = useVoice(client, t.socket, room?.id ?? null, t.snapshot?.me?.userId);
  const stickers = useStickers(t.snapshot?.me?.userId);

  const [screen, setScreen] = useState<"landing" | "join">(routeCode ? "join" : "landing");
  const [joinMode, setJoinMode] = useState<JoinMode>("create");
  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Панель открывается под шапкой комнаты, чтобы кнопки шапки оставались доступными (повторное нажатие закрывает)
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeaderH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [room?.id]);

  useEffect(() => { document.title = "AntiStall"; }, []);

  // Вышли из комнаты — возвращаемся к экрану входа, панели закрываем
  const hadRoom = useRef(false);
  useEffect(() => {
    if (room) hadRoom.current = true;
    else if (hadRoom.current) { hadRoom.current = false; setScreen("join"); setSheet(null); }
  }, [room]);

  // Перерыв = время игры: при входе в перерыв один раз подгружаем его игру (TD или Harvest)
  const { loadTd, loadHarvest } = t;
  const breakGame = t.snapshot?.room.breakGame ?? "td";
  const prevPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase === "break" && was !== "break") { if (breakGame === "harvest") loadHarvest(); else loadTd(); }
  }, [phase, breakGame, loadTd, loadHarvest]);

  const dark = phase === "focus";
  const looks = Object.fromEntries((t.snapshot?.members ?? []).map((m) => [m.userId, m.avatar]));
  return (
    <MotionConfig reducedMotion="user">
      <div data-testid="tomato-app" className={`tomato-root min-h-[100dvh] font-sans ${dark ? "bg-ink text-cream" : "bg-white text-ink"}`} style={dark ? DARK_VARS : LIGHT_VARS}>
        <ConnectionBanner conn={t.conn} disconnectedFor={t.disconnectedFor} focusing={t.snapshot?.me?.status === "focusing"} graceSec={t.graceSec} />
        <Toasts toasts={t.toasts} />
        <RoomInvites t={t} />
        {room && <PrankOverlay t={t} />}

        {!room ? (
          screen === "landing" ? (
            <Landing
              ready={t.boot === "ready"} serverOk={t.serverOk} demo={t.demoMode}
              onStart={() => { setJoinMode("create"); setScreen("join"); window.scrollTo(0, 0); }}
              onJoin={() => { setJoinMode("join"); setScreen("join"); window.scrollTo(0, 0); }}
            />
          ) : (
            <JoinScreen t={t} initialMode={joinMode} initialCode={routeCode ?? ""} onBack={() => setScreen("landing")} />
          )
        ) : (
          <div className="flex min-h-[100dvh] flex-col">
            {/* высота по содержимому: если стикеров или участников много, страница прокручивается, полоса голоса прилипает к низу */}
            {/* повторное нажатие кнопки шапки закрывает панель */}
            <RoomHeader t={t} headerRef={headerRef} active={sheet} stickers={stickers} onOpen={(s) => setSheet((cur) => (cur === s ? null : s))} />
            {phase === "focus" ? <FocusRoom t={t} stickers={stickers} /> : phase === "break" ? <BreakRoom t={t} onOpenMap={() => setSheet("map")} /> : <Lobby t={t} />}
            <div className="sticky bottom-0 z-20 px-3 pb-3 pt-1 sm:px-8 sm:pb-5 lg:px-12">
              <VoiceBar conn={t.conn} voice={voice} meId={t.snapshot?.me?.userId} tone={dark ? "light" : "dark"} note={voiceNote(t)} looks={looks} />
            </div>
          </div>
        )}

        <SheetPanel t={t} sheet={room ? sheet : null} onClose={closeSheet} top={headerH} />
      </div>
    </MotionConfig>
  );
}

/** Подсказка в полосе голоса — только когда она что-то сообщает: кто ушёл с фокуса и что будет после перерыва. */
function voiceNote(t: Tomato) {
  const snap = t.snapshot!;
  if (snap.room.phase === "focus") {
    const left = snap.members.filter((m) => m.status === "aborted").map((m) => m.name);
    return left.length ? `${left.join(", ")}: фокус прерван раньше, цикл не засчитан` : undefined;
  }
  if (snap.room.phase === "break") {
    // сервер сам запускает следующий фокус, пока не пройдены запланированные циклы
    return snap.room.cycleNo < (snap.room.settings.cycles ?? 4) ? "Следующий фокус начнётся сам, когда закончится перерыв" : "Это был последний цикл по плану: после перерыва комната вернётся в лобби";
  }
  return undefined;
}

/**
 * Верхняя строка комнаты. Три группы: слева логотип и комната (не сжимается уже 18rem), справа навигация,
 * посередине то, что относится к фазе (таймер перерыва / «Завершить досрочно»). Когда места мало,
 * средняя группа уходит на вторую строку — ничего не наезжает друг на друга.
 */
function RoomHeader({ t, onOpen, headerRef, active, stickers }: { t: Tomato; onOpen: (s: Exclude<Sheet, null>) => void; headerRef: React.Ref<HTMLElement>; active: Sheet; stickers: Stickers }) {
  const snap = t.snapshot!;
  const room = snap.room;
  const planned = room.settings.cycles ?? 4;
  const dark = room.phase === "focus";
  const remaining = t.remainingMs !== null ? Math.ceil(t.remainingMs / 1000) : room.settings.breakSec;
  const allReady = snap.members.length > 0 && snap.members.every((m) => m.isReady || m.connection === "offline");
  const planDone = room.cycleNo >= planned;

  return (
    <header ref={headerRef} className={`sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:gap-x-5 sm:gap-y-3 sm:px-8 sm:py-4 lg:px-12 ${dark ? "bg-ink" : "border-b-2 border-soft bg-white"}`}>
      {/* ряд 1 на телефоне: логотип, комната, профиль; с sm — как раньше, всё в одну линию */}
      <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto sm:grow sm:basis-[16rem] sm:gap-4">
        <Logo tone={dark ? "cream" : "ink"} compact />
        <span className={`hidden h-9 w-0.5 shrink-0 sm:block ${dark ? "bg-cocoa" : "bg-soft"}`} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={`truncate text-base font-extrabold leading-tight sm:text-[22px] ${dark ? "text-cream" : "text-ink"}`} title={room.name}>{room.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {room.phase === "focus" && <PhasePill tone="cocoa" dot="#EAA695">фокус · {cycleLabel(room.cycleNo, planned)}</PhasePill>}
            {room.phase === "break" && <PhasePill>перерыв после: {cycleLabel(room.cycleNo, planned)}</PhasePill>}
            {room.phase === "waiting" && <PhasePill tone={allReady ? "lime" : "paper"}>{planDone && room.cycleNo > 0 ? "план выполнен" : allReady ? "все готовы" : "ждём всех"}</PhasePill>}
            {room.phase === "completed" && <PhasePill>комната закрыта</PhasePill>}
            {room.demo && <DemoBadge compact className="hidden sm:inline-flex" />}
          </div>
        </div>
        <ProfileChip t={t} dark={dark} onOpen={() => onOpen("profile")} className="ml-auto sm:hidden" />
      </div>

      {(room.phase === "break" || room.phase === "focus") && (
        // телефон: справа во втором ряду рядом с иконками; планшет: слева во втором ряду; широкий — в одну линию
        <div className="order-3 ml-auto flex sm:order-2 sm:ml-0 xl:order-none">
          {room.phase === "break" ? (
            <div role="timer" aria-label={`Перерыв: ${formatTime(remaining)}`} className="flex items-center gap-2 rounded-full border-2 border-ink bg-petal py-1 pl-3 pr-1 as-shadow-sm sm:gap-3 sm:py-1.5 sm:pl-5 sm:pr-1.5 sm:as-shadow">
              <span className="font-display text-sm sm:text-xl"><span className="relative top-0.5">перерыв</span></span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-display text-xl tabular-nums sm:px-4 sm:py-1 sm:text-[36px]"><span className="relative top-0.5 sm:top-1">{formatTime(remaining)}</span></span>
            </div>
          ) : <EndEarly t={t} />}
        </div>
      )}

      <div className="order-2 flex shrink-0 items-center gap-2 sm:order-3 sm:ml-auto sm:gap-3 xl:order-none">
        {room.phase === "break" && (
          <ul className="hidden items-center -space-x-1.5 2xl:flex" aria-label="Участники">
            {snap.members.slice(0, 6).map((m) => <li key={m.userId}><MemberAvatar name={m.name} id={m.userId} look={m.avatar} connection={m.connection} size={34} host={m.role === "host"} /></li>)}
            {snap.members.length > 6 && <li className="pl-3 text-sm font-bold text-mute">+{snap.members.length - 6}</li>}
          </ul>
        )}
        <RoomNav t={t} dark={dark} onOpen={onOpen} active={active} stickers={room.phase === "focus" ? stickers : undefined} />
      </div>
    </header>
  );
}
