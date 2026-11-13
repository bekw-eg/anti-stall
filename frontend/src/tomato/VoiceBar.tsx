import { AnimatePresence, motion } from "framer-motion";
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { VoicePeer } from "@/api/tomato";
import type { Conn } from "./useTomato";
import type { Voice } from "./voice/useVoice";
import { initials } from "./format";
import { SPRING } from "./motion";

const MAX_AVATARS = 5;

function statusText(v: Voice, conn: Conn): string {
  if (!v.supported) return "Голос доступен только по HTTPS";
  if (v.error) return v.error;
  if (conn === "offline") return "Нет сети";
  switch (v.status) {
    case "joining": return v.mic === "requesting" ? "Разрешите доступ к микрофону…" : "Подключаемся…";
    case "reconnecting": return "Переподключение…";
    case "connected": {
      const n = v.peers.length;
      if (v.mic === "denied") return `Слушаете · нет доступа к микрофону`;
      if (v.mic === "unavailable") return `Слушаете · микрофон не найден`;
      return n <= 1 ? "Вы в голосе · ждём остальных" : `В голосе · ${n}`;
    }
    default: return v.peers.length ? `В голосе ${v.peers.length} — присоединяйтесь` : "Голос выключен";
  }
}

function PeerAvatar({ p, me }: { p: VoicePeer; me: boolean }) {
  return (
    <motion.li
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ duration: 0.2 }}
      className="relative"
      title={`${p.name}${me ? " (вы)" : ""}${p.deafened ? " · звук выключен" : p.muted ? " · микрофон выключен" : p.speaking ? " · говорит" : ""}`}
      data-voice-peer={p.userId}
      data-speaking={p.speaking ? "true" : "false"}
      data-muted={p.muted ? "true" : "false"}
      data-deafened={p.deafened ? "true" : "false"}
    >
      <motion.span
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-xs font-semibold text-zinc-900"
        animate={{ boxShadow: p.speaking ? "0 0 0 2px #6b6b6b, 0 0 0 4px #6ee7b7" : "0 0 0 2px #6b6b6b, 0 0 0 2px rgba(0,0,0,0)" }}
        transition={{ duration: 0.15 }}
      >
        {initials(p.name)}
      </motion.span>
      {(p.muted || p.deafened) && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-white ring-2 ring-[#6b6b6b]" aria-hidden>
          {p.deafened ? <HeadphoneOff size={9} /> : <MicOff size={9} />}
        </span>
      )}
    </motion.li>
  );
}

/**
 * Нижняя полоса Voice: настоящий голосовой канал комнаты (WebRTC).
 * В голос входят по кнопке — таймер и комната работают и без звука.
 */
export function VoiceBar({ conn, voice: v, meId, center }: { conn: Conn; voice: Voice; meId?: string; center?: React.ReactNode }) {
  const dot = v.status === "connected" ? (v.mic === "granted" ? "bg-emerald-400" : "bg-amber-300") : v.inVoice ? "bg-amber-300" : conn === "online" ? "bg-white/40" : "bg-zinc-400";
  const shown = v.peers.slice(0, MAX_AVATARS);
  const extra = v.peers.length - shown.length;
  const micDenied = v.inVoice && (v.mic === "denied" || v.mic === "unavailable");

  const Btn = ({ off, onClick, label, children, warn = false, testId }: { off: boolean; onClick: () => void; label: string; children: React.ReactNode; warn?: boolean; testId?: string }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={off}
      data-testid={testId}
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${off ? "bg-white text-zinc-900" : "text-white hover:bg-white/15"}`}
    >
      {children}
      {warn && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
    </button>
  );

  return (
    <motion.div
      initial={{ y: "160%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "160%", opacity: 0 }}
      transition={{ ...SPRING, delay: 0.15 }}
      className="absolute inset-x-3 bottom-3 flex h-14 items-center justify-between gap-3 rounded-2xl bg-[#6b6b6b] px-4 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,.5)] sm:inset-x-4 sm:bottom-4"
      data-testid="voice-bar"
      data-voice-status={v.status}
    >
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="font-medium">Voice</span>
        <span className="hidden max-w-[16rem] truncate text-white/70 md:inline" role="status" data-testid="voice-status">{statusText(v, conn)}</span>
      </div>

      <ul className="flex min-w-0 items-center gap-1.5" aria-label="В голосовом канале">
        <AnimatePresence initial={false}>
          {shown.map((p) => <PeerAvatar key={p.userId} p={p} me={p.userId === meId} />)}
        </AnimatePresence>
        {extra > 0 && <li className="pl-1 text-xs text-white/70">+{extra}</li>}
      </ul>

      <div className="hidden min-w-0 flex-1 lg:block lg:max-w-sm">{center}</div>

      <div className="flex shrink-0 items-center gap-1">
        {!v.inVoice ? (
          <button
            type="button"
            onClick={v.join}
            disabled={!v.supported || !v.ready}
            data-testid="voice-join"
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <Volume2 size={16} /> <span>Войти в голос</span>
          </button>
        ) : (
          <>
            <Btn
              off={!v.micOn}
              warn={micDenied}
              onClick={v.toggleMute}
              testId="voice-mute"
              label={micDenied ? "Нет доступа к микрофону — разрешить снова" : v.micOn ? "Выключить микрофон" : "Включить микрофон"}
            >
              {v.micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </Btn>
            <Btn off={v.deafened} onClick={v.toggleDeafen} testId="voice-deafen" label={v.deafened ? "Включить звук" : "Выключить звук (никого не слышать)"}>
              {v.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
            </Btn>
            <Btn off={false} onClick={v.leave} testId="voice-leave" label="Выйти из голоса">
              <PhoneOff size={18} />
            </Btn>
          </>
        )}
      </div>
    </motion.div>
  );
}
