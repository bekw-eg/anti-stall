import { useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { LIGHT_VARS } from "./screens/RoomChrome";
import type { Tomato } from "./useTomato";

/**
 * Чат комнаты на перерыве: облачко в углу с подписью «Чат» и счётчиком новых сообщений.
 * По нажатию справа выезжает окно чата; игра остаётся на месте.
 * Только на экранах уже 1280 px: на широких чат стоит колонкой справа от игры, как на фокусе и в лобби.
 */
export function ChatBubble({ t }: { t: Tomato }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(t.chat.length);
  const closeRef = useRef<HTMLButtonElement>(null);
  const unread = open ? 0 : Math.max(0, t.chat.length - seen);

  useEffect(() => { if (open) setSeen(t.chat.length); }, [open, t.chat.length]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-30 flex flex-col items-end gap-3 sm:bottom-28 sm:right-8 lg:right-12 xl:hidden" style={LIGHT_VARS}>
      {open && (
        <section
          role="dialog"
          aria-label="Чат комнаты"
          className="pointer-events-auto relative flex h-[min(520px,62dvh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border-2 border-ink bg-white text-ink as-shadow"
        >
          <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Закрыть чат"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-[12px] border-2 border-ink bg-white hover:bg-paper">
            <X size={18} aria-hidden />
          </button>
          <ChatPanel t={t} />
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `Чат: новых сообщений ${unread}` : "Чат"}
        data-testid="chat-bubble"
        className="pointer-events-auto relative inline-flex items-center gap-2.5 rounded-full border-2 border-ink bg-paper py-1.5 pl-1.5 pr-5 text-ink transition-transform as-shadow-sm hover:-translate-y-0.5 active:translate-y-0.5"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-cream">
          <MessageCircle size={22} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="font-display text-xl leading-none"><span className="relative top-0.5">Чат</span></span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-ink bg-peach px-1 text-xs font-extrabold" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
