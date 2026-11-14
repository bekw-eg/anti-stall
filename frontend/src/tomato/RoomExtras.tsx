import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Headphones } from "lucide-react";
import type { Member, Roadmap } from "@/api/tomato";
import { initials, memberStatusLabel, readiness, roomLink } from "./format";
import { isTdRoad } from "./roadmapGeometry";
import { disabledReason } from "./socialRules";
import type { Tomato } from "./useTomato";
import type { Voice } from "./voice/useVoice";

const btn =
  "rounded-full px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

const BREAK_READY_HINT = "Все в сети нажали «Я готов» — следующий фокус начнётся сразу";

/** Кнопка основного действия под таймером: что можно сделать прямо сейчас (решает сервер). */
function Controls({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const actions = snap.me?.allowedActions ?? [];
  const phase = snap.room.phase;
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const [copied, setCopied] = useState(false);

  const isReady = Boolean(snap.me?.isReady);
  const canReady = phase === "waiting" || phase === "break";
  const readyButton = canReady && (
    <motion.button
      type="button"
      onClick={() => t.setReady(!isReady)}
      whileTap={{ scale: 0.97 }}
      className={`${btn} flex items-center gap-2 px-8 text-base shadow-sm ${
        isReady
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "border-2 border-emerald-500/80 bg-[var(--card)] text-[var(--fg)] hover:bg-emerald-500/15"
      }`}
    >
      {isReady && <Check size={18} />}
      {isReady ? "Не готов" : "Я готов"}
    </motion.button>
  );

  if (actions.includes("start_focus")) {
    const { ready: readyCount, total: totalCount, all: allReady } = readiness(snap.members, snap.me?.userId); // офлайн не ждём
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {readyButton}
          <motion.button
            type="button"
            disabled={!allReady}
            onClick={t.startFocus}
            whileTap={allReady ? { scale: 0.97 } : undefined}
            className={`${btn} px-10 text-white ${
              allReady
                ? "animate-pulse bg-zinc-900 hover:bg-black"
                : "cursor-not-allowed bg-zinc-900/45 opacity-60"
            }`}
          >
            Начать фокус
          </motion.button>
        </div>
        {!allReady && (
          <p className="text-xs text-[var(--muted)]">
            Ждём готовности всех участников в сети ({readyCount}/{totalCount})
          </p>
        )}
        {snap.members.length < 2 && (
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(roomLink(snap.room.code)).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} Ждём участников — скопировать ссылку
          </button>
        )}
      </div>
    );
  }
  if (actions.includes("abort_session")) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!confirm) { setConfirm(true); timer.current = setTimeout(() => setConfirm(false), 3500); return; }
          clearTimeout(timer.current); setConfirm(false); t.abortSession();
        }}
        className={`${btn} border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]`}
      >
        {confirm ? "Точно? Без награды, команда может не сделать шаг" : "Сдаться"}
      </button>
    );
  }
  if (actions.includes("skip_break")) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {readyButton}
          <button type="button" onClick={t.skipBreak} className={`${btn} border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]`}>Пропустить перерыв</button>
        </div>
        <p className="text-xs text-[var(--muted)]">{BREAK_READY_HINT}</p>
      </div>
    );
  }
  const hint =
    phase === "waiting" ? "Ждём, пока создатель запустит сессию"
    : phase === "focus" ? "Вы наблюдаете — присоединитесь в следующем цикле"
    : phase === "completed" ? "Комната закрыта"
    : phase === "break" ? BREAK_READY_HINT
    : "";
  return (
    <div className="flex flex-col items-center gap-2">
      {readyButton}
      {hint && <p className="text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

/** После сессии на перерыве: пользователь отмечает результат (влияет только на историю). */
function ResultPrompt({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const sess = snap.me?.session;
  const [sent, setSent] = useState<string | null>(null);
  if (snap.room.phase !== "break" || !sess || sess.status === "active" || sent === snap.room.cycleId) return null;
  const opts = [["done", "Сделал"], ["partial", "Частично"], ["not_done", "Не успел"]] as const;
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
      <span>Как прошла сессия?</span>
      {opts.map(([v, label]) => (
        <button key={v} type="button" onClick={() => { t.recordResult(v); setSent(snap.room.cycleId); }} className="rounded-full border border-[var(--line)] px-3 py-1 text-[var(--fg)] transition-colors hover:bg-[var(--card)]">{label}</button>
      ))}
    </div>
  );
}

function TaskField({ t }: { t: Tomato }) {
  const me = t.snapshot!.me;
  const editable = me?.allowedActions.includes("set_task") ?? false;
  const [value, setValue] = useState(me?.task ?? "");
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setValue(me?.task ?? ""); }, [me?.task]);
  const save = () => { editing.current = false; const v = value.trim(); if (v !== (me?.task ?? "")) t.setTask(v); };

  if (!editable) {
    return <p className="max-w-full truncate text-sm text-[var(--muted)]">{me?.task ? <>Сейчас: <span className="text-[var(--fg)]">{me.task}</span></> : "Задача не указана"}</p>;
  }
  return (
    <label className="block w-full">
      <span className="sr-only">Над чем вы работаете</span>
      <input
        value={value}
        onChange={(e) => { editing.current = true; setValue(e.target.value); }}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
        maxLength={80}
        placeholder="Над чем работаешь?"
        className="w-full border-0 border-b border-[var(--line)] bg-transparent px-1 py-2 text-center text-sm text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--fg)]"
      />
    </label>
  );
}

/**
 * Точка интеграции Road Map. Сейчас — только прогресс командной цели по данным сервера
 * (`snapshot.challenge`): те же nodes/edges потом отрисует полноценная карта.
 */
export function RoadmapSlot({ road, inline = false }: { road: Roadmap; inline?: boolean }) {
  const pct = Math.min(100, (road.points / road.goal) * 100);
  const vars = inline ? ({ "--fg": "#fff", "--muted": "rgba(255,255,255,.75)", "--line": "rgba(255,255,255,.3)" } as React.CSSProperties) : undefined;
  return (
    <div className={inline ? "flex w-full items-center gap-3" : "w-full"} style={vars} aria-label={`Командная цель: ${road.points} из ${road.goal}`}>
      {inline ? (
        <span className="hidden shrink-0 text-xs text-[var(--muted)] md:inline">{road.winner ? "Цель достигнута" : road.mode === "teams" ? "Гонка команд" : isTdRoad(road) ? "Путь победами" : "Командная цель"}</span>
      ) : (
        <div className="mb-2 flex justify-between text-xs text-[var(--muted)]">
          <span>{road.completed ? "Командная цель достигнута" : isTdRoad(road) ? "Путь победами в обороне" : "Командная цель"}</span>
          <span className="tabular-nums">{road.points}/{road.goal}</span>
        </div>
      )}
      <div className="relative h-3 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line)]" />
        <motion.div className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[var(--fg)]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
        {road.nodes.map((n) => (
          <span
            key={n.id}
            title={n.title}
            className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--fg)] ${road.points >= n.requiredPoints ? "bg-[var(--fg)]" : "bg-transparent opacity-50"}`}
            style={{ left: `${(n.requiredPoints / road.goal) * 100}%` }}
          />
        ))}
      </div>
      {inline && (
        <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
          {road.mode === "teams" ? road.teams.map((t) => `${t.key} ${t.points}`).join(" : ") : `${road.points}/${road.goal}`}
        </span>
      )}
    </div>
  );
}

const CONN_COLOR = { online: "bg-emerald-500", reconnecting: "bg-amber-400", offline: "bg-zinc-400" } as const;
const CONN_TITLE = { online: "в сети", reconnecting: "переподключается", offline: "не в сети" } as const;

/** Быстрые действия на перерыве: доступны только Break, во время Focus меню не показывается. */
function ActionMenu({ member, t }: { member: Member; t: Tomato }) {
  const [open, setOpen] = useState(false);
  const item = "block w-full rounded-md px-3 py-1.5 text-left text-xs hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40";
  const run = (fn: () => unknown) => () => { setOpen(false); fn(); };
  const opts = [
    ["boost", "Бонус к XP", () => t.help(member.userId, "boost")],
    ["shield", "Щит от шуток · 10 монет", () => t.help(member.userId, "shield")],
    ["fog", "Шутка: туман", () => t.prank(member.userId, "fog")],
    ["sticker", "Шутка: липучка", () => t.prank(member.userId, "sticker")],
  ] as const;
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Действия для ${member.name}`} className="px-1 text-[var(--muted)] hover:text-[var(--fg)]">⋯</button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl bg-white p-1 text-zinc-900 shadow-xl ring-1 ring-black/10">
            {opts.map(([type, label, fn]) => {
              const reason = disabledReason(type, member, t);
              return <button key={type} type="button" className={item} disabled={reason !== null} title={reason ?? undefined} onClick={run(fn)}>{label}{reason && <span className="block text-[10px] text-zinc-500">{reason}</span>}</button>;
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function ParticipantsRow({ t, voice, className = "" }: { t: Tomato; voice?: Voice; className?: string }) {
  const snap = t.snapshot!;
  const meId = snap.me?.userId;
  const phase = snap.room.phase;
  const onBreak = phase === "break";
  const showReady = phase === "waiting" || phase === "break";
  const inVoice = new Map((voice?.peers ?? []).map((p) => [p.userId, p]));
  return (
    <ul className={`flex gap-2 ${className || "flex-wrap justify-center"}`} aria-label="Участники">
      <AnimatePresence initial={false}>
        {snap.members.map((m: Member) => {
          const isReady = showReady && Boolean(m.isReady);
          const speaking = Boolean(inVoice.get(m.userId)?.speaking);
          return (
            <motion.li
              key={m.userId}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={`flex shrink-0 items-center gap-2 rounded-full bg-[var(--card)] py-1.5 pl-1.5 pr-3 text-xs text-[var(--fg)] ${
                isReady ? "ring-1 ring-emerald-500/60" : ""
              }`}
            >
              <span
                className={`relative flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white transition-shadow ${
                  speaking ? "ring-2 ring-emerald-400" : isReady ? "ring-2 ring-emerald-500" : ""
                }`}
                data-connection={m.connection}
                data-member-avatar={m.userId}
              >
                {initials(m.name)}
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#d9d9d9] ${CONN_COLOR[m.connection]}`} title={CONN_TITLE[m.connection]} />
              </span>
              <span className="max-w-[7rem] truncate font-medium">{m.name}{m.userId === meId && " (вы)"}</span>
              {inVoice.has(m.userId) && <Headphones size={12} className="shrink-0 text-[var(--muted)]" aria-label="в голосе" />}
              {(m.team === "A" || m.team === "B") && <span className="rounded bg-[var(--card)] px-1.5 text-[10px] font-semibold" title={`Команда ${m.team}`}>{m.team}</span>}
              {isReady ? (
                <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-500">
                  <Check size={12} /> {memberStatusLabel(m, showReady)}
                </span>
              ) : (
                <span className="text-[var(--muted)]">{memberStatusLabel(m, showReady)}</span>
              )}
              {m.task && m.status !== "waiting" && <span className="hidden max-w-[8rem] truncate text-[var(--muted)] sm:inline">· {m.task}</span>}
              {onBreak && m.userId !== meId && (
                <ActionMenu member={m} t={t} />
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function RoomExtras({ t }: { t: Tomato }) {
  return (
    <motion.div
      key="extras"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 pb-4"
    >
      <Controls t={t} />
      <ResultPrompt t={t} />
      <TaskField t={t} />
    </motion.div>
  );
}
