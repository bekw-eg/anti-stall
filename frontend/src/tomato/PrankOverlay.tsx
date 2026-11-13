import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useNow } from "./useMedia";
import type { Tomato } from "./useTomato";

/** Стикер-помидор: рисунок, а не эмодзи — одинаково выглядит везде. */
function TomatoSticker() {
  return (
    <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden>
      <circle cx="60" cy="64" r="44" fill="#fff" />
      <circle cx="60" cy="66" r="38" fill="#e2553f" />
      <path d="M60 30 l6 10 l11 -3 l-7 9 l8 8 l-12 -2 l-6 10 l-6 -10 l-12 2 l8 -8 l-7 -9 l11 3z" fill="#5f8a3a" />
      <ellipse cx="46" cy="64" rx="5" ry="6.5" fill="#1d1d1f" />
      <ellipse cx="74" cy="64" rx="5" ry="6.5" fill="#1d1d1f" />
      <path d="M46 80 q14 12 28 0" stroke="#1d1d1f" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M57 84 q3 9 8 0" fill="#f6a5a5" />
    </svg>
  );
}

/**
 * Шуточный эффект, отправленный мне. Только визуальный, только на перерыве, сам заканчивается
 * (сервер обрезает его концом перерыва) и убирается одним нажатием. Таймеру и кнопкам не мешает.
 */
export function PrankOverlay({ t }: { t: Tomato }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const snap = t.snapshot;
  const meId = snap?.me?.userId;
  const now = t.serverNow();
  const active = !snap || snap.room.phase !== "break" ? [] : t.feed.filter(
    (a) => a.kind === "prank" && a.status === "applied" && a.toUserId === meId && a.effectEndsAt !== null && a.effectEndsAt > now && !dismissed.has(a.id),
  );
  useNow(500, active.length > 0);
  const fog = active.find((a) => a.type === "fog");
  const sticker = active.find((a) => a.type === "sticker");
  const name = (id: string) => snap?.members.find((m) => m.userId === id)?.name ?? "друг";
  const dismiss = (id: number) => setDismissed((s) => new Set(s).add(id));

  return (
    <>
      <AnimatePresence>
        {fog && (
          <motion.div
            key={`fog-${fog.id}`}
            data-testid="prank-fog"
            className="pointer-events-none fixed inset-0 z-20 bg-white/30 backdrop-blur-[5px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sticker && (
          <motion.div
            key={`sticker-${sticker.id}`}
            data-testid="prank-sticker"
            className="pointer-events-none fixed right-[8%] top-[22%] z-20 drop-shadow-xl"
            initial={{ opacity: 0, scale: 0.4, rotate: -30 }}
            animate={{ opacity: 1, scale: 1, rotate: -12 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
          >
            <TomatoSticker />
          </motion.div>
        )}
      </AnimatePresence>
      {/* над Voice-полосой: не перекрывает ни таймер, ни шапку */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {active.slice(0, 2).map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-900 py-1.5 pl-4 pr-1.5 text-xs font-medium text-white shadow-lg"
              role="status"
            >
              <span>{a.type === "fog" ? "Туман" : "Стикер"} от {name(a.fromUserId)} · {Math.max(1, Math.ceil(((a.effectEndsAt ?? now) - now) / 1000))} с</span>
              <button type="button" onClick={() => dismiss(a.id)} data-testid="prank-dismiss" className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                <X size={12} /> Убрать
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
