import { useState } from "react";
import { motion } from "framer-motion";
import { Headphones, HeadphoneOff, Mic, MicOff } from "lucide-react";
import type { Conn } from "./useTomato";
import { SPRING } from "./motion";

const CONN_TEXT: Record<Conn, string> = {
  idle: "", connecting: "Подключение…", online: "Подключено", reconnecting: "Переподключение…", offline: "Нет сети",
};

/** Нижняя полоса Voice. Голосовой связи в MVP нет: Mute/Deafen — локальные переключатели, индикатор — реальное WS-соединение. */
export function VoiceBar({ conn, center }: { conn: Conn; center?: React.ReactNode }) {
  const [muted, setMuted] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const micOff = muted || deaf;
  const dot = conn === "online" ? "bg-emerald-400" : conn === "offline" ? "bg-zinc-300" : "bg-amber-300";

  const Btn = ({ off, onClick, label, children }: { off: boolean; onClick: () => void; label: string; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={off}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${off ? "bg-white text-zinc-900" : "text-white hover:bg-white/15"}`}
    >
      {children}
    </button>
  );

  return (
    <motion.div
      initial={{ y: "160%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "160%", opacity: 0 }}
      transition={{ ...SPRING, delay: 0.15 }}
      className="absolute inset-x-3 bottom-3 flex h-14 items-center justify-between rounded-2xl bg-[#6b6b6b] px-4 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,.5)] sm:inset-x-4 sm:bottom-4"
    >
      <div className="flex items-center gap-3 text-sm">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <span className="font-medium">Voice</span>
        <span className="hidden text-white/70 lg:inline" role="status">{CONN_TEXT[conn]}</span>
      </div>
      <div className="mx-4 min-w-0 flex-1 sm:mx-8 sm:max-w-sm">{center}</div>
      <div className="flex gap-1">
        <Btn off={micOff} onClick={() => setMuted((v) => !v)} label={micOff ? "Включить микрофон" : "Выключить микрофон"}>
          {micOff ? <MicOff size={18} /> : <Mic size={18} />}
        </Btn>
        <Btn off={deaf} onClick={() => setDeaf((v) => !v)} label={deaf ? "Включить звук" : "Выключить звук"}>
          {deaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </Btn>
      </div>
    </motion.div>
  );
}
