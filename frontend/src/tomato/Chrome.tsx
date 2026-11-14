import { AnimatePresence, motion } from "framer-motion";
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
        Демо-песочница<span className={compact ? "hidden xl:inline" : ""}>: {DEMO_NOTE}</span>
      </span>
    </span>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute bottom-28 left-5 z-30 flex flex-col items-start gap-2 sm:left-8" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className={`rounded-full px-4 py-2 text-sm shadow-lg ${t.tone === "error" ? "bg-red-600 text-white" : t.tone === "warning" ? "bg-amber-400 text-zinc-950 ring-1 ring-amber-600/30" : "bg-white text-zinc-900 ring-1 ring-black/10"}`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
