import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Conn, Toast } from "./useTomato";

/** Состояние соединения: подключение, переподключение, офлайн. Только когда есть что сказать. */
export function ConnectionBanner({ conn, disconnectedFor, focusing, graceSec = 30 }: { conn: Conn; disconnectedFor: number; focusing: boolean; graceSec?: number }) {
  const text =
    conn === "connecting" ? "Подключаемся…"
    : conn === "reconnecting" ? (focusing && disconnectedFor >= 10 ? `Связь потеряна. Если не вернётся за ${graceSec} с — сессия прервётся без награды` : "Связь потеряна — переподключаемся…")
    : conn === "offline" ? "Нет сети — ждём подключения"
    : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[7.5rem] z-30 flex justify-center px-4 lg:top-[4.75rem]">
      <AnimatePresence>
        {text && (
          <motion.div
            key={conn}
            role="status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const DEMO_NOTE = "ускоренное время, прогресс не переносится в реальный аккаунт";

/**
 * Ненавязчивая плашка демо-сервера. compact — для шапки комнаты: пояснение видно только на широких экранах,
 * но всегда доступно в подсказке и для скринридера.
 */
export function DemoBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const full = `Демо-песочница: ${DEMO_NOTE}`;
  return (
    <span
      role="note"
      aria-label={full}
      title={full}
      data-testid="demo-badge"
      className={`inline-flex max-w-full items-center gap-1.5 bg-amber-100 font-medium text-amber-900 ring-1 ring-amber-200 ${compact ? "rounded-full px-2 py-0.5 text-[11px]" : "rounded-2xl px-3.5 py-1.5 text-left text-xs sm:rounded-full"} ${className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span aria-hidden className={compact ? "truncate" : ""}>
        Демо-песочница<span className={compact ? "hidden 2xl:inline" : ""}>: {DEMO_NOTE}</span>
      </span>
    </span>
  );
}

/**
 * Уведомления. Обычные — пилюлями слева внизу; награды («+7 XP · +6 монет») — крупно по центру экрана,
 * чтобы их было видно поверх игры.
 */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  const plain = toasts.filter((t) => t.tone !== "reward");
  const rewards = toasts.filter((t) => t.tone === "reward");
  return (
    <>
      <div className="pointer-events-none fixed bottom-28 left-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2 sm:left-8" aria-live="polite">
        <AnimatePresence>
          {plain.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-extrabold shadow-[0_4px_0_#3B2422] ${t.tone === "error" ? "bg-rose text-white" : t.tone === "warning" ? "bg-peach text-ink" : "bg-white text-ink"}`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-[26%] z-50 flex flex-col items-center gap-3 px-4" aria-live="polite">
        <AnimatePresence>
          {rewards.map((t) => (
            <motion.div
              key={t.id}
              data-testid="reward-pop"
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="flex items-center gap-3 rounded-full border-[3px] border-ink bg-white px-6 py-3 text-ink shadow-[0_6px_0_#3B2422]"
            >
              <Sparkles size={26} className="shrink-0 text-peach" strokeWidth={2.6} aria-hidden />
              <span className="font-display text-2xl leading-none sm:text-3xl"><span className="relative top-0.5">{t.text}</span></span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
