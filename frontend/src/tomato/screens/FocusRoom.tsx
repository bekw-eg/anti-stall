/**
 * 07 Room / Focus (Figma, страница back): тёмный экран, чтобы было видно, что идёт фокус.
 * Слева участники, в центре таймер (время — с сервера), справа чат комнаты. Игра и пакости откроются на перерыве.
 */
import { GoalProgress } from "./GoalProgress";
import { useEffect, useRef, useState } from "react";
import { Lock, PenLine, SkipForward } from "lucide-react";
import { STATUS_LABEL, formatTime } from "../format";
import type { Tomato } from "../useTomato";
import { StickerBoard, StickerHint, type Stickers } from "./Stickers";
import { CHAT_CARD_SIZE, ChatPanel } from "../ChatPanel";
import { MemberAvatar } from "./ui";

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
      className={`flex flex-col items-start rounded-[12px] border-2 px-2.5 py-1 text-left transition-colors sm:rounded-[16px] sm:px-4 sm:py-2 ${confirm ? "border-peach bg-cocoa" : "border-[#8A625C] hover:bg-cocoa"}`}
    >
      <span className="whitespace-nowrap font-display text-sm leading-tight text-cream sm:text-lg"><span className="relative top-0.5"><span className="sm:hidden">{confirm ? "Точно?" : "Завершить"}</span><span className="hidden sm:inline">{confirm ? "Точно завершить?" : "Завершить досрочно"}</span></span></span>
      <span className="hidden text-[13px] text-[#D8BDB6] sm:block">{confirm ? "нажмите ещё раз, награды не будет" : "монеты за этот цикл не начислятся"}</span>
    </button>
  );
}

/**
 * Хост пропускает фокус для всех → сразу перерыв с игрой. Пропуск не поощряется (кейс — про терпение):
 * два подтверждения, «остаться» — главная кнопка, награда только за отработанную часть.
 */
function HostSkip({ t, remaining }: { t: Tomato; remaining: number }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  // без ответа — карточка сама закрывается, чтобы случайно не пропустить потом
  const go = (next: 0 | 1 | 2) => { clearTimeout(timer.current); setStep(next); if (next) timer.current = setTimeout(() => setStep(0), 10000); };
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") go(0); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);
  if (!t.snapshot?.me?.allowedActions.includes("skip_focus")) return null;

  if (step === 0) {
    return (
      <button type="button" data-testid="skip-focus" onClick={() => go(1)}
        className="relative z-10 inline-flex items-center gap-2 rounded-full border-2 border-[#8A625C] px-4 py-1.5 text-sm font-bold text-[#D8BDB6] transition-colors hover:bg-cocoa hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach">
        <SkipForward size={16} aria-hidden /> Пропустить фокус для всех
      </button>
    );
  }
  const last = step === 2;
  return (
    <div role="group" aria-live="polite" aria-label="Пропуск фокуса" data-testid="skip-focus-confirm"
      className="relative z-10 flex w-full max-w-[460px] flex-col items-center gap-3 rounded-[20px] border-2 border-peach bg-cocoa px-5 py-4 text-center">
      <p className="font-display text-lg leading-tight text-cream sm:text-xl"><span className="relative top-0.5">
        {last ? `Точно? Осталось ${formatTime(remaining)}` : "Пропустить фокус для всех?"}
      </span></p>
      <p className="text-sm text-[#D8BDB6]">
        {last ? "Терпение — тоже навык. Это последнее подтверждение." : "Перерыв с игрой начнётся сразу у всех. Награда — только за отработанное время, шаг по карте не засчитается."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => go(0)} autoFocus
          className="rounded-full bg-cream px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach">
          {last ? "Дотерплю" : "Остаться в фокусе"}
        </button>
        <button type="button" disabled={busy} data-testid={last ? "skip-focus-final" : "skip-focus-next"}
          onClick={async () => { if (!last) return go(2); clearTimeout(timer.current); setBusy(true); await t.skipFocus(); setBusy(false); setStep(0); }}
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#8A625C] px-4 py-1.5 text-sm font-bold text-cream transition-colors hover:border-peach disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach">
          <SkipForward size={15} aria-hidden /> {last ? "Пропустить сейчас" : "Да, пропустить"}
        </button>
      </div>
    </div>
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
      {/* Стикеры — всегда верхний слой экрана фокуса (z-25): поверх таймера, чата, подсказок и полосы голоса (z-20),
          но под выезжающими панелями (z-30) и шапкой (z-40). Мешает — стикер можно сдвинуть или свернуть. */}
      {stickers && <StickerBoard board={stickers} />}
      {/* ---------- Участники ---------- */}
      <section aria-label="Участники" className="order-2 flex min-w-0 flex-col gap-3 lg:order-none lg:pt-24">
        <p className="text-[15px] font-bold text-[#D8BDB6]">в комнате · {snap.members.length}</p>
        <ul className="flex gap-4 overflow-x-auto pb-1 pt-3 lg:flex-col lg:gap-5 lg:overflow-visible">
          {snap.members.map((m) => (
            <li key={m.userId} className="flex shrink-0 items-center gap-3">
              <MemberAvatar name={m.name} id={m.userId} look={m.avatar} connection={m.connection} size={36} ring="#FFF4EF" host={m.role === "host"} />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 max-w-[11rem] break-words text-base font-bold leading-tight text-cream">{m.name}{m.userId === me?.userId ? " (вы)" : ""}</span>
                <span className={`text-sm ${m.connection === "offline" ? "text-peach" : STATUS_TONE[m.status] ?? "text-[#D8BDB6]"}`}>{m.connection === "offline" ? "нет связи" : STATUS_LABEL[m.status]}</span>
              </span>
            </li>
          ))}
        </ul>
        {/* общая цель видна и во время фокуса — спокойно, без кнопок: играть можно на перерыве */}
        <GoalProgress t={t} dark compact />
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
        <HostSkip t={t} remaining={remaining} />
      </section>

      {/* ---------- Чат комнаты (в фокусе — только чтение) ---------- */}
      <aside aria-label="Чат комнаты" className="order-3 flex min-h-0 flex-col gap-2 lg:order-none lg:max-h-[calc(100dvh-13rem)]">
        <p data-testid="game-later" className="flex items-center gap-2 self-start rounded-full bg-cocoa px-3 py-1 text-[13px] font-bold text-[#F3E1DC]">
          <Lock size={14} aria-hidden />Игра откроется на перерыве
        </p>
        <div className={`flex ${CHAT_CARD_SIZE} shrink-0 flex-col overflow-hidden rounded-[28px] border-2 border-[#8A625C] bg-[#4A2E2B]`}>
          <ChatPanel t={t} />
        </div>
      </aside>
    </div>
  );
}

export { EndEarly };
