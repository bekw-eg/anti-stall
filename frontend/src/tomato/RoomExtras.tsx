import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import type { Member, Roadmap } from "@/api/tomato";
import { STATUS_LABEL, initials, roomLink } from "./format";
import type { Tomato } from "./useTomato";

const btn =
  "rounded-full px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

/** Кнопка основного действия под таймером: что можно сделать прямо сейчас (решает сервер). */
function Controls({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const actions = snap.me?.allowedActions ?? [];
  const phase = snap.room.phase;
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const [copied, setCopied] = useState(false);

  if (actions.includes("start_focus")) {
    return (
      <div className="flex flex-col items-center gap-3">
        <motion.button type="button" onClick={t.startFocus} whileTap={{ scale: 0.97 }} className={`${btn} bg-zinc-900 px-10 text-white hover:bg-black`}>
          Начать фокус
        </motion.button>
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
        {confirm ? "Точно? Награды не будет" : "Завершить досрочно"}
      </button>
    );
  }
  if (actions.includes("skip_break")) {
    return <button type="button" onClick={t.skipBreak} className={`${btn} border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]`}>Пропустить перерыв</button>;
  }
  const hint =
    phase === "waiting" ? "Ждём, пока создатель запустит сессию"
    : phase === "focus" ? "Вы наблюдаете — присоединитесь в следующем цикле"
    : phase === "completed" ? "Комната закрыта"
    : "";
  return <p className="text-sm text-[var(--muted)]">{hint}</p>;
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
        <span className="hidden shrink-0 text-xs text-[var(--muted)] md:inline">{road.winner ? "Цель достигнута" : road.mode === "teams" ? "Гонка команд" : "Командная цель"}</span>
      ) : (
        <div className="mb-2 flex justify-between text-xs text-[var(--muted)]">
          <span>{road.completed ? "Командная цель достигнута" : "Командная цель"}</span>
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

/** Действия на перерыве: доступны только Break, во время Focus меню не показывается. */
function ActionMenu({ member, t }: { member: Member; t: Tomato }) {
  const [open, setOpen] = useState(false);
  const item = "block w-full rounded-md px-3 py-1.5 text-left text-xs hover:bg-black/5";
  const run = (fn: () => unknown) => () => { setOpen(false); fn(); };
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Действия для ${member.name}`} className="px-1 text-[var(--muted)] hover:text-[var(--fg)]">⋯</button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl bg-white p-1 text-zinc-900 shadow-xl ring-1 ring-black/10">
            <button type="button" className={item} onClick={run(() => t.help(member.userId, "boost"))}>Бонус к XP</button>
            <button type="button" className={item} onClick={run(() => t.help(member.userId, "shield"))}>Щит от шуток · 10 монет</button>
            {member.prankEnabled && (<>
              <button type="button" className={item} onClick={run(() => t.prank(member.userId, "fog"))}>Шутка: туман</button>
              <button type="button" className={item} onClick={run(() => t.prank(member.userId, "sticker"))}>Шутка: стикер</button>
            </>)}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function ParticipantsRow({ t, className = "" }: { t: Tomato; className?: string }) {
  const snap = t.snapshot!;
  const meId = snap.me?.userId;
  const onBreak = snap.room.phase === "break";
  return (
    <ul className={`flex gap-2 ${className || "flex-wrap justify-center"}`} aria-label="Участники">
      <AnimatePresence initial={false}>
        {snap.members.map((m: Member) => (
          <motion.li
            key={m.userId}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex shrink-0 items-center gap-2 rounded-full bg-[var(--card)] py-1.5 pl-1.5 pr-3 text-xs text-[var(--fg)]"
          >
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white">
              {initials(m.name)}
              <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#d9d9d9] ${CONN_COLOR[m.connection]}`} title={m.connection} />
            </span>
            <span className="max-w-[7rem] truncate font-medium">{m.name}{m.userId === meId && " (вы)"}</span>
            {(m.team === "A" || m.team === "B") && <span className="rounded bg-[var(--card)] px-1.5 text-[10px] font-semibold" title={`Команда ${m.team}`}>{m.team}</span>}
            <span className="text-[var(--muted)]">{STATUS_LABEL[m.status]}</span>
            {m.task && m.status !== "waiting" && <span className="hidden max-w-[8rem] truncate text-[var(--muted)] sm:inline">· {m.task}</span>}
            {onBreak && m.userId !== meId && (
              <ActionMenu member={m} t={t} />
            )}
          </motion.li>
        ))}
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
