import { motion } from "framer-motion";
import { DemoBadge } from "./Chrome";
import { EASE } from "./motion";

export function Welcome({ onStart, ready, serverOk, demo = false }: { onStart: () => void; ready: boolean; serverOk: boolean | null; demo?: boolean }) {
  const letters = "TOMATO".split("");
  return (
    <motion.section
      key="welcome"
      className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
      exit={{ opacity: 0, y: -24, filter: "blur(6px)" }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {demo && (
        <motion.div className="absolute inset-x-4 top-6 flex justify-center" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4, ease: EASE }}>
          <DemoBadge />
        </motion.div>
      )}

      <h1 className="flex text-[clamp(2.75rem,12vw,7rem)] font-light leading-none tracking-[0.18em] text-zinc-900" aria-label="Tomato">
        {letters.map((l, i) => (
          <motion.span
            key={i}
            aria-hidden
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1 + i * 0.07, ease: EASE }}
          >
            {l}
          </motion.span>
        ))}
      </h1>

      <motion.p
        className="mt-6 max-w-sm text-base text-zinc-500 sm:text-lg"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.7, ease: EASE }}
      >
        Учись вместе. Отдыхай с удовольствием.
      </motion.p>

      <motion.button
        type="button"
        onClick={onStart}
        disabled={!ready}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1, ease: EASE }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        className="mt-12 rounded-full bg-zinc-900 px-12 py-3.5 text-base font-medium text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,.5)] transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900 disabled:bg-zinc-300 disabled:shadow-none"
      >
        {ready ? "Начать" : "Загрузка…"}
      </motion.button>

      <div className="absolute bottom-6 h-5 text-xs text-zinc-400" role="status" aria-live="polite">
        {serverOk === false && "Сервер недоступен — пробуем подключиться…"}
      </div>
    </motion.section>
  );
}
