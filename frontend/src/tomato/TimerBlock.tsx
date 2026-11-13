import { AnimatePresence, motion } from "framer-motion";
import { formatTime } from "./format";
import { SPRING } from "./motion";
import { RoomExtras } from "./RoomExtras";
import type { Tomato } from "./useTomato";

const PHASE_LABEL = { waiting: "Ожидание", focus: "Фокус", break: "Перерыв", completed: "Завершено" } as const;

/**
 * Единый таймер. Он НИКОГДА не размонтируется между экранами: меняется только
 * расположение родительской сетки, а `layout` плавно переводит таймер между позициями.
 * Время — это отображение серверного phaseEndsAt, сам клиент ничего не завершает.
 */
export function TimerBlock({ t, open, previewSeconds, summary }: { t: Tomato; open: boolean; previewSeconds: number; summary: React.ReactNode }) {
  const room = t.snapshot?.room;
  const live = room && (room.phase === "focus" || room.phase === "break") && t.remainingMs !== null;
  const seconds = live ? Math.ceil(t.remainingMs! / 1000) : room ? (room.phase === "completed" ? 0 : room.settings.focusSec) : previewSeconds;
  const label = room ? PHASE_LABEL[room.phase] : "Готово";
  const total = room && room.phaseEndsAt ? room.phaseEndsAt - room.phaseStartedAt : 0;
  const progress = live && total > 0 ? Math.min(1, Math.max(0, 1 - t.remainingMs! / total)) : 0;
  const inRoom = Boolean(room);

  return (
    <>
      <div /> {/* верхняя строка сетки: под название/кнопки */}

      <motion.div
        layout
        transition={SPRING}
        role="timer"
        aria-label={`${label}: ${formatTime(seconds)}`}
        className="pointer-events-auto flex select-none flex-col items-center"
        style={{ color: "var(--timer)" }}
      >
        <motion.span layout="position" transition={SPRING} className="mb-3 text-xs font-medium uppercase tracking-[0.35em] opacity-60">
          {label}
        </motion.span>
        <motion.p
          layout
          transition={SPRING}
          className={`font-light leading-none tracking-tight tabular-nums ${open ? "text-6xl lg:text-7xl" : "text-[clamp(4.5rem,min(20vw,20vh),11rem)]"}`}
        >
          {formatTime(seconds)}
        </motion.p>
        <motion.div layout="position" transition={SPRING} className="mt-6 h-px w-full overflow-hidden" style={{ background: "color-mix(in srgb, currentColor 15%, transparent)", opacity: inRoom && live ? 1 : 0 }}>
          <motion.div className="h-px w-full origin-left bg-current" animate={{ scaleX: progress }} transition={{ duration: 0.3, ease: "linear" }} />
        </motion.div>
      </motion.div>

      <motion.div layout transition={SPRING} className="pointer-events-auto mt-6 flex w-full justify-center self-start overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          {open ? <motion.div key="summary" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>{summary}</motion.div>
            : inRoom ? <RoomExtras key="extras" t={t} /> : null}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
