/**
 * 07 Room / Focus (Figma, страница back): тёмный экран, чтобы было видно, что идёт фокус.
 * Слева участники, в центре таймер (время — с сервера), справа закрытая карта. Игра и пакости откроются на перерыве.
 */
import { useEffect, useRef, useState } from "react";
import { Lock, PenLine } from "lucide-react";
import { STATUS_LABEL, formatTime } from "../format";
import type { Tomato } from "../useTomato";
import { StickerBoard, StickerHint, type Stickers } from "./Stickers";
import { MemberAvatar, RoadmapArt } from "./ui";

/**
 * Тёмная обводка и жёсткая тень у цифр: на тёмном фоне почти не видны, а когда сзади стикер —
 * отделяют цифры от него, и таймер читается.
 */
const TIMER_SHADOW: React.CSSProperties = { WebkitTextStroke: "0.06em #2A1817", paintOrder: "stroke fill", textShadow: "0 0.05em 0 #2A1817, 0 0.08em 0.12em rgba(42,24,23,.55)" };

const STATUS_TONE: Record<string, string> = { focusing: "text-[#D3DB8E]", aborted: "text-peach", abandoned: "text-peach", finished: "text-blush" };

/** «Завершить досрочно»: двойное подтверждение, награды за цикл не будет. */
function EndEarly({ t }: { t: Tomato }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!t.snapshot?.me?.allowedActions.includes("abort_session")) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm) { setConfirm(true); timer.current = setTimeout(() => setConfirm(false), 4000); return; }
        clearTimeout(timer.current); setConfirm(false); t.abortSession();
      }}
      className={`flex flex-col items-start rounded-[16px] border-2 px-3 py-1.5 text-left transition-colors sm:px-4 sm:py-2 ${confirm ? "border-peach bg-cocoa" : "border-[#8A625C] hover:bg-cocoa"}`}
    >
      <span className="font-display text-base leading-tight text-cream sm:text-lg"><span className="relative top-0.5">{confirm ? "Точно завершить?" : "Завершить досрочно"}</span></span>
      <span className="hidden text-[13px] text-[#D8BDB6] sm:block">{confirm ? "нажмите ещё раз, награды не будет" : "монеты за этот цикл не начислятся"}</span>
    </button>
  );
}

export function FocusRoom({ t, stickers }: { t: Tomato; stickers?: Stickers }) {
  const snap = t.snapshot!;
  const room = snap.room;
  const me = snap.me;
  const remaining = t.remainingMs !== null ? Math.ceil(t.remainingMs / 1000) : room.settings.focusSec;
  const total = room.phaseEndsAt ? room.phaseEndsAt - room.phaseStartedAt : 0;
  const progress = t.remainingMs !== null && total > 0 ? Math.min(1, Math.max(0, 1 - t.remainingMs / total)) : 0;
  const watching = me?.status !== "focusing";

  return (
    <div className="relative grid flex-1 gap-8 px-4 pb-6 pt-2 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)_minmax(240px,300px)] lg:gap-8 lg:px-12 xl:grid-cols-[220px_minmax(0,1fr)_minmax(260px,340px)]">
      {/* стикеры — слой под таймером, только на фокусе и только в этой области */}
      {stickers && <StickerBoard board={stickers} />}
      {/* ---------- Участники ---------- */}
      <section aria-label="Участники" className="order-2 flex min-w-0 flex-col gap-3 lg:order-none lg:pt-24">
        <p className="text-[15px] font-bold text-[#D8BDB6]">в комнате · {snap.members.length}</p>
        <ul className="flex gap-4 overflow-x-auto pb-1 pt-3 lg:flex-col lg:gap-5 lg:overflow-visible">
          {snap.members.map((m) => (
            <li key={m.userId} className="flex shrink-0 items-center gap-3">
              <MemberAvatar name={m.name} id={m.userId} connection={m.connection} size={36} ring="#FFF4EF" host={m.role === "host"} />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 max-w-[11rem] break-words text-base font-bold leading-tight text-cream">{m.name}{m.userId === me?.userId ? " (вы)" : ""}</span>
                <span className={`text-sm ${m.connection === "offline" ? "text-peach" : STATUS_TONE[m.status] ?? "text-[#D8BDB6]"}`}>{m.connection === "offline" ? "нет связи" : STATUS_LABEL[m.status]}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Таймер ---------- */}
      <section aria-label="Фокус" className="order-1 flex min-w-0 flex-col items-center justify-center gap-6 py-4 sm:gap-7 lg:order-none">
        {stickers && !watching && <StickerHint board={stickers} />}
        <p role="timer" aria-label={`Фокус: ${formatTime(remaining)}`} style={TIMER_SHADOW} className="pointer-events-none relative z-10 font-display text-[clamp(4.5rem,min(13vw,30vh),18.75rem)] leading-none pt-[0.1em] text-cream tabular-nums">
          {formatTime(remaining)}
        </p>
        <div className="relative z-10 h-3 w-full max-w-[620px] overflow-hidden rounded-full bg-cocoa" aria-hidden>
          <div className="h-full rounded-full bg-peach transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="flex max-w-full items-center gap-3 rounded-[16px] border-2 border-[#8A625C] px-5 py-3 text-lg font-semibold text-cream">
          <PenLine size={20} className="shrink-0 text-peach" aria-hidden />
          <span className="break-words text-left">{watching ? "Вы наблюдаете: присоединитесь в следующем цикле" : me?.task || "Задача не указана"}</span>
        </p>
      </section>

      {/* ---------- Закрытая карта ---------- */}
      <aside aria-label="Карта закрыта" className="order-3 lg:order-none">
        <div className="relative flex h-full min-h-[180px] items-center justify-center overflow-hidden rounded-[28px] bg-rose sm:min-h-[220px] lg:min-h-[480px]">
          <RoadmapArt className="absolute h-auto w-[150%] max-w-none opacity-80 blur-[2px] lg:w-[155%] lg:rotate-90" />
          <div className="relative flex flex-col items-center gap-3 bg-ink/45 px-6 py-6 text-center lg:absolute lg:inset-0 lg:justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-cream text-ink sm:h-[68px] sm:w-[68px]"><Lock size={28} aria-hidden /></span>
            <p className="font-display text-2xl text-cream sm:text-[28px]"><span className="relative top-0.5">Карта закрыта</span></p>
            <p data-testid="game-later" className="max-w-[18rem] text-base text-[#F3E1DC]">Игра откроется на перерыве</p>
            <p className="max-w-[18rem] text-sm text-[#F3E1DC]/80">Пакости вас не достанут, пока идёт фокус.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export { EndEarly };
