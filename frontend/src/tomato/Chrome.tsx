import { AnimatePresence, motion } from "framer-motion";
import type { Conn, Toast } from "./useTomato";

/** Состояние соединения: подключение, переподключение, офлайн. Только когда есть что сказать. */
export function ConnectionBanner({ conn, disconnectedFor, focusing }: { conn: Conn; disconnectedFor: number; focusing: boolean }) {
  const text =
    conn === "connecting" ? "Подключаемся…"
    : conn === "reconnecting" ? (focusing && disconnectedFor >= 10 ? "Связь потеряна. Если не вернётся за 30 с — сессия прервётся без награды" : "Связь потеряна — переподключаемся…")
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
            className={`rounded-full px-4 py-2 text-sm shadow-lg ${t.tone === "error" ? "bg-red-600 text-white" : "bg-white text-zinc-900 ring-1 ring-black/10"}`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
