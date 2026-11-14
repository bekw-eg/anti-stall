import { AnimatePresence, motion } from "framer-motion";
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { VoicePeer } from "@/api/tomato";
import type { Conn } from "./useTomato";
import type { Voice } from "./voice/useVoice";
import { initials } from "./format";
import { SPRING } from "./motion";
import { colorFor } from "./screens/ui";

const MAX_AVATARS = 5;

function statusText(v: Voice, conn: Conn): string {
  if (!v.supported) return "Браузер не поддерживает голос";
  if (v.error) return v.error;
  if (conn === "offline") return "Нет сети";
  switch (v.status) {
    case "joining": return v.mic === "requesting" ? "Разрешите доступ к микрофону…" : "Подключаемся…";
    case "reconnecting": return "Переподключение…";
    case "connected": {
      const n = v.peers.length;
      if (v.mic === "denied") return v.canTalk ? "Слушаете · нет доступа к микрофону" : "Слушаете · говорить можно только по HTTPS";
      if (v.mic === "unavailable") return `Слушаете · микрофон не найден`;
      return n <= 1 ? "Вы в голосе · ждём остальных" : `В голосе · ${n}`;
    }
    default:
      if (!v.canTalk) return v.peers.length ? `В голосе ${v.peers.length} · здесь можно только слушать (нужен HTTPS)` : "Здесь можно только слушать: микрофон работает по HTTPS";
      return v.peers.length ? `В голосе ${v.peers.length}, присоединяйтесь` : ""; // «не в голосе» и так видно по кнопке «Войти в голос»
  }
}

function PeerAvatar({ p, me, ring }: { p: VoicePeer; me: boolean; ring: string }) {
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
        className="flex h-9 w-9 items-center justify-center rounded-full font-display text-base"
        style={{ background: colorFor(p.userId), border: `2.5px solid ${ring}`, color: "#3B2422" }}
        animate={{ boxShadow: p.speaking ? "0 0 0 3px #D9DE9F" : "0 0 0 0 rgba(0,0,0,0)" }}
        transition={{ duration: 0.15 }}
      >
        <span className="relative top-0.5">{initials(p.name)}</span>
      </motion.span>
      {(p.muted || p.deafened) && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-cream ring-2 ring-white" aria-hidden>
          {p.deafened ? <HeadphoneOff size={9} /> : <MicOff size={9} />}
        </span>
      )}
    </motion.li>
  );
}

/**
 * Полоса голоса (макет: 07 Focus — светлая на тёмном фоне, 06/08 — тёмная на светлом).
 * Настоящий голосовой канал комнаты (WebRTC). В голос входят по кнопке — таймер и комната работают и без звука.
 * `note` — подсказка посередине (что сейчас с чатом и циклом).
 */
export function VoiceBar({ conn, voice: v, meId, note, tone = "dark" }: { conn: Conn; voice: Voice; meId?: string; note?: React.ReactNode; tone?: "light" | "dark" }) {
  const light = tone === "light";
  const dot = v.status === "connected" ? (v.mic === "granted" ? "bg-olive" : "bg-amber-400") : v.inVoice ? "bg-amber-400" : conn === "online" ? (light ? "bg-line" : "bg-[#8A625C]") : "bg-zinc-400";
  const shown = v.peers.slice(0, MAX_AVATARS);
  const extra = v.peers.length - shown.length;
  const micDenied = v.inVoice && (v.mic === "denied" || v.mic === "unavailable");
  const ring = light ? "#3B2422" : "#3B2422";

  const Btn = ({ off, onClick, label, text, children, warn = false, testId }: { off: boolean; onClick: () => void; label: string; text: string; children: React.ReactNode; warn?: boolean; testId?: string }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={off}
      data-testid={testId}
      className={`relative flex h-11 items-center gap-2 rounded-[14px] border-2 border-ink px-3 text-[15px] font-extrabold text-ink transition-colors sm:h-12 sm:px-4 ${off ? "bg-petal" : "bg-white hover:bg-paper"}`}
    >
      {children}<span className="hidden md:inline">{text}</span>
      {warn && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
    </button>
  );

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...SPRING, delay: 0.1 }}
      className={`flex min-h-[4.25rem] w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] px-3 py-2.5 sm:flex-nowrap sm:pl-6 ${light ? "bg-cream text-ink" : "bg-ink text-cream"}`}
      data-testid="voice-bar"
      data-voice-status={v.status}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="whitespace-nowrap text-[17px] font-extrabold">Голос{v.peers.length ? ` · ${v.peers.length}` : ""}</span>
        <span className={`hidden max-w-[22rem] truncate text-[15px] md:inline ${light ? "text-mute" : "text-[#D8BDB6]"} empty:hidden`} role="status" data-testid="voice-status">{statusText(v, conn)}</span>
      </div>

      <ul className="flex min-w-0 items-center -space-x-1.5" aria-label="В голосовом канале">
        <AnimatePresence initial={false}>
          {shown.map((p) => <PeerAvatar key={p.userId} p={p} me={p.userId === meId} ring={ring} />)}
        </AnimatePresence>
        {extra > 0 && <li className="pl-3 text-sm font-bold">+{extra}</li>}
      </ul>

      {note ? <p className={`order-last hidden w-full min-w-0 text-[15px] sm:order-none sm:block sm:w-auto sm:flex-1 sm:truncate ${light ? "text-mute" : "text-[#D8BDB6]"}`} title={typeof note === "string" ? note : undefined}>{note}</p> : <span className="hidden sm:block sm:flex-1" aria-hidden />}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!v.inVoice ? (
          <button
            type="button"
            onClick={v.join}
            disabled={!v.supported || !v.ready}
            data-testid="voice-join"
            className="flex h-11 items-center gap-2 rounded-[14px] border-2 border-ink bg-white px-4 text-[15px] font-extrabold text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60 sm:h-12"
          >
            <Volume2 size={18} aria-hidden /> <span>{v.canTalk ? "Войти в голос" : "Слушать голос"}</span>
          </button>
        ) : (
          <>
            <Btn
              off={!v.micOn}
              warn={micDenied}
              onClick={v.toggleMute}
              testId="voice-mute"
              text={v.micOn ? "Микрофон" : "Микр. выкл."}
              label={micDenied ? "Нет доступа к микрофону — разрешить снова" : v.micOn ? "Выключить микрофон" : "Включить микрофон"}
            >
              {v.micOn ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
            </Btn>
            <Btn off={v.deafened} onClick={v.toggleDeafen} testId="voice-deafen" text={v.deafened ? "Звук выкл." : "Звук"} label={v.deafened ? "Включить звук" : "Выключить звук (никого не слышать)"}>
              {v.deafened ? <HeadphoneOff size={18} aria-hidden /> : <Headphones size={18} aria-hidden />}
            </Btn>
            <Btn off={false} onClick={v.leave} testId="voice-leave" text="Выйти" label="Выйти из голоса">
              <PhoneOff size={18} aria-hidden />
            </Btn>
          </>
        )}
      </div>
    </motion.div>
  );
}
