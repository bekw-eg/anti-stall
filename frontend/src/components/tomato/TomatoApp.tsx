import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronRight,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
} from "lucide-react";
import { TomatoApiError, TomatoClient } from "@/api/tomato";
import type { Progress, RoomSnapshot, ServerEvent, StudySession } from "@/api/tomato";
import { useTomatoRoom } from "@/hooks/useTomatoRoom";

type Screen = "welcome" | "settings" | "room";

const WORK_PRESETS = [15, 25, 45, 50];
const REST_PRESETS = [5, 10, 15];

/** Единый spring для всех layout-переходов — так движение выглядит цельным. */
const SPRING = { type: "spring", stiffness: 220, damping: 28, mass: 0.9 } as const;

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/* -------------------------------------------------------------------------- */
/*  Фон                                                                       */
/* -------------------------------------------------------------------------- */

function Background({ blurred }: { blurred: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-rose-100 via-orange-50 to-red-100">
      <motion.div
        className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-red-400/50 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-32 right-0 h-[28rem] w-[28rem] rounded-full bg-orange-300/50 blur-3xl"
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-1/2 top-1/3 h-72 w-72 rounded-full bg-emerald-300/40 blur-3xl"
        animate={{ x: [0, 60, 0], y: [0, -40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Заглушка под будущую игру / роудмап: в комнате фон размывается сильнее */}
      <motion.div
        className="absolute inset-0 bg-white/0"
        animate={{
          backdropFilter: blurred ? "blur(24px)" : "blur(0px)",
          backgroundColor: blurred ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0)",
        }}
        transition={{ duration: 0.8 }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  UI-кирпичики                                                              */
/* -------------------------------------------------------------------------- */

function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl border border-white/60 bg-white/50 shadow-xl shadow-red-900/10 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function Chip({
  group,
  active,
  onClick,
  children,
}: {
  group: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-2xl px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "text-white" : "text-red-900/70 hover:bg-white/60"
      }`}
    >
      {active && (
        <motion.span
          layoutId={`chip-bg-${group}`}
          className="absolute inset-0 rounded-2xl bg-red-500 shadow-md shadow-red-500/30"
          transition={SPRING}
        />
      )}
      <span className="relative">{children}</span>
    </button>
  );
}

function ToggleButton({
  on,
  onClick,
  label,
  iconOn,
  iconOff,
}: {
  on: boolean; // true = звук включён
  onClick: () => void;
  label: string;
  iconOn: ReactNode;
  iconOff: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={!on}
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.05 }}
      className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
        on ? "bg-white/70 text-red-900 hover:bg-white" : "bg-red-500 text-white shadow-md shadow-red-500/40"
      }`}
    >
      {on ? iconOn : iconOff}
    </motion.button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Экран 1: Приветствие                                                      */
/* -------------------------------------------------------------------------- */

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      key="welcome"
      className="absolute inset-0 flex cursor-grab flex-col items-center justify-center gap-8 px-6 text-center active:cursor-grabbing"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -120, filter: "blur(8px)" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      // свайп влево / скролл → переход к настройкам
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.3}
      onDragEnd={(_, info) => {
        if (info.offset.x < -80 || info.velocity.x < -500) onStart();
      }}
      onWheel={(e) => {
        if (Math.abs(e.deltaY) > 20 || Math.abs(e.deltaX) > 20) onStart();
      }}
    >
      <div className="select-none">
        <motion.div
          className="mb-4 text-7xl"
          animate={{ rotate: [-6, 6, -6] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          🍅
        </motion.div>
        <h1 className="text-6xl font-extrabold tracking-tight text-red-950 sm:text-7xl">Tomato</h1>
        <p className="mt-3 text-lg text-red-900/70">Боталка с Pomodoro — работайте вместе</p>
      </div>

      <motion.button
        type="button"
        onClick={onStart}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
        className="group flex items-center gap-2 rounded-full bg-red-500 px-10 py-4 text-lg font-bold text-white shadow-xl shadow-red-500/40 transition-colors hover:bg-red-600"
      >
        Начать
        <ChevronRight className="transition-transform group-hover:translate-x-1" size={22} />
      </motion.button>

      <p className="select-none text-sm text-red-900/50">или свайпните влево</p>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Таймер — ОДИН элемент, который переезжает между экранами                  */
/* -------------------------------------------------------------------------- */

function TimerCard({
  seconds,
  label,
  inRoom,
  children,
}: {
  seconds: number;
  label: string;
  inRoom: boolean;
  children?: ReactNode;
}) {
  return (
    <motion.div
      // layout: Framer сам анимирует позицию и размер при смене положения в потоке
      layout
      transition={SPRING}
      style={{ borderRadius: 32 }} // radius в style — чтобы layout корректно компенсировал искажения
      className="flex flex-col items-center border border-white/60 bg-white/50 shadow-2xl shadow-red-900/15 backdrop-blur-xl"
    >
      <motion.div
        layout
        transition={SPRING}
        className={inRoom ? "px-12 py-10 sm:px-20 sm:py-14" : "px-10 py-6"}
      >
        <motion.p
          layout
          transition={SPRING}
          className={`select-none text-center font-mono font-extrabold tabular-nums tracking-tight text-red-950 ${
            inRoom ? "text-7xl sm:text-9xl" : "text-6xl"
          }`}
        >
          {formatTime(seconds)}
        </motion.p>

        <AnimatePresence initial={false}>
          {inRoom && (
            <motion.div
              key="timer-controls"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center overflow-hidden"
            >
              <p className="mt-4 text-sm font-semibold uppercase tracking-widest text-red-900/60">{label}</p>
              <div className="mb-1 mt-5 flex min-h-14 items-center justify-center">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Экран 2: Настройки                                                        */
/* -------------------------------------------------------------------------- */

const inputCls =
  "w-full rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-red-950 placeholder:text-red-900/40 outline-none transition focus:border-red-400 focus:ring-4 focus:ring-red-400/20";

function SettingsPanel(p: {
  work: number;
  rest: number;
  name: string;
  code: string;
  demo: boolean;
  demoAvailable: boolean;
  inRoom: boolean;
  busy: boolean;
  error: string | null;
  onWork: (v: number) => void;
  onRest: (v: number) => void;
  onName: (v: string) => void;
  onCode: (v: string) => void;
  onDemo: (v: boolean) => void;
  onSubmit: () => void;
  onLeave: () => void;
}) {
  const canSubmit = p.name.trim().length > 0 && !p.busy;
  const label = p.inRoom ? "Вернуться в комнату" : p.code.trim() ? "Войти в комнату" : "Создать комнату";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) p.onSubmit();
      }}
      className="w-full"
    >
      <GlassCard className="space-y-6 p-6 sm:p-8">
        <div>
          <label className="mb-2 block text-sm font-semibold text-red-950">Работа, мин</label>
          <div className="flex flex-wrap gap-1 rounded-2xl bg-white/40 p-1">
            {WORK_PRESETS.map((m) => (
              <Chip key={m} group="work" active={p.work === m} onClick={() => p.onWork(m)}>
                {m}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-red-950">Отдых, мин</label>
          <div className="flex flex-wrap gap-1 rounded-2xl bg-white/40 p-1">
            {REST_PRESETS.map((m) => (
              <Chip key={m} group="rest" active={p.rest === m} onClick={() => p.onRest(m)}>
                {m}
              </Chip>
            ))}
          </div>
        </div>

        {p.demoAvailable && (
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 text-sm transition-colors ${
              p.demo ? "border-red-500 bg-red-50/80" : "border-white/70 bg-white/50"
            }`}
          >
            <input type="checkbox" className="mt-1 h-4 w-4 accent-red-500" checked={p.demo} onChange={(e) => p.onDemo(e.target.checked)} />
            <span className="text-red-950">
              <span className="block font-bold">⚡ Демо-режим для жюри</span>
              <span className="text-xs text-red-900/70">
                Фокус 25 секунд вместо 25 минут, перерыв 15 секунд. Правила и награды те же.
                {p.inRoom && " Меняется только до старта сессии (если вы создатель) — иначе выйдите и создайте комнату заново."}
              </span>
            </span>
          </label>
        )}

        <div>
          <label htmlFor="user-name" className="mb-2 block text-sm font-semibold text-red-950">
            Ваше имя
          </label>
          <input
            id="user-name"
            value={p.name}
            onChange={(e) => p.onName(e.target.value)}
            maxLength={24}
            placeholder="Например, Лотти"
            className={inputCls}
          />
        </div>

        {!p.inRoom && (
          <div>
            <label htmlFor="room-code" className="mb-2 block text-sm font-semibold text-red-950">
              Код комнаты <span className="font-normal text-red-900/50">(чтобы войти к друзьям)</span>
            </label>
            <input
              id="room-code"
              value={p.code}
              onChange={(e) => p.onCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="Оставьте пустым, чтобы создать свою"
              className={`${inputCls} font-mono tracking-widest`}
            />
          </div>
        )}

        {p.error && <p className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-800">{p.error}</p>}

        <motion.button
          type="submit"
          disabled={!canSubmit}
          whileHover={canSubmit ? { scale: 1.02 } : undefined}
          whileTap={canSubmit ? { scale: 0.97 } : undefined}
          className="w-full rounded-2xl bg-red-500 py-3.5 text-base font-bold text-white shadow-lg shadow-red-500/40 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300 disabled:shadow-none"
        >
          {p.busy ? "…" : label}
        </motion.button>
        {p.inRoom && (
          <button type="button" onClick={p.onLeave} className="w-full text-sm font-semibold text-red-900/60 hover:text-red-900">
            Выйти из комнаты
          </button>
        )}
      </GlassCard>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Экран 3: боковая панель комнаты (участники, прогресс, соц. действия)      */
/* -------------------------------------------------------------------------- */

const STATUS_LABEL: Record<string, string> = {
  waiting: "ждёт",
  focusing: "учится",
  finished: "закончил",
  aborted: "вышел раньше",
  abandoned: "пропал",
  spectating: "наблюдает",
  resting: "отдыхает",
};
const CONN_COLOR: Record<string, string> = { online: "bg-emerald-500", reconnecting: "bg-amber-400", offline: "bg-gray-400" };

function RoomPanel({
  snap,
  onTask,
  onHelp,
  onPrank,
  onResult,
}: {
  snap: RoomSnapshot;
  onTask: (title: string) => void;
  onHelp: (userId: string, type: "boost" | "shield") => void;
  onPrank: (userId: string, type: "fog" | "sticker") => void;
  onResult: (result: "done" | "partial" | "not_done") => void;
}) {
  const me = snap.me;
  const isBreak = snap.room.phase === "break";
  const canTask = me?.allowedActions.includes("set_task");
  const [task, setTask] = useState("");
  const road = snap.challenge;
  const target = road.nodes.find((n) => n.status === "next");
  const [resultCycle, setResultCycle] = useState<string | null>(null); // цикл, для которого результат уже отмечен
  const askResult = isBreak && me?.session && me.session.status !== "active" && resultCycle !== snap.room.cycleId;

  return (
    <GlassCard className="hidden max-h-[calc(100vh-9rem)] w-72 space-y-4 overflow-y-auto p-4 md:block">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-red-950">Код комнаты</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(snap.room.code).catch(() => undefined)}
          className="rounded-lg bg-white/70 px-2 py-1 font-mono font-bold tracking-widest text-red-700"
          title="Скопировать"
        >
          {snap.room.code}
        </button>
      </div>

      {me && (
        <div className="text-xs text-red-950">
          <div className="mb-1 flex justify-between font-semibold">
            <span>Ур. {me.level}</span>
            <span>
              {me.xp}/{me.nextLevelXp} XP · {me.coins} 🍅
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${Math.min(100, ((me.xp - me.levelStartXp) / (me.nextLevelXp - me.levelStartXp)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="text-xs text-red-950">
        <div className="mb-1 flex justify-between font-semibold">
          <span>{road.completed ? "Цель достигнута 🏆" : `Цель: ${target?.title ?? road.title}`}</span>
          <span>
            {road.points}/{road.goal}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/60">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (road.points / road.goal) * 100)}%` }} />
        </div>
      </div>

      <ul className="space-y-2">
        {snap.members.map((m) => (
          <li key={m.userId} className="rounded-2xl bg-white/50 px-3 py-2 text-sm text-red-950">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${CONN_COLOR[m.connection]}`} />
              <span className="truncate font-semibold">
                {m.name}
                {m.role === "host" && " 👑"}
              </span>
              <span className="ml-auto shrink-0 text-xs text-red-900/60">{STATUS_LABEL[m.status] ?? m.status}</span>
            </div>
            <div className="mt-0.5 truncate pl-4 text-xs text-red-900/60">
              {m.task ?? "без задачи"} · вклад {m.contribution}
            </div>
            {isBreak && me && m.userId !== me.userId && (
              <div className="mt-1 flex flex-wrap gap-1 pl-4">
                <button type="button" onClick={() => onHelp(m.userId, "boost")} className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs" title="+XP к следующей сессии">
                  🤝 Бонус
                </button>
                <button type="button" onClick={() => onHelp(m.userId, "shield")} className="rounded-lg bg-sky-100 px-2 py-0.5 text-xs" title="Защита от пакости, 10 монет">
                  🛡 Щит
                </button>
                {m.prankEnabled && (
                  <>
                    <button type="button" onClick={() => onPrank(m.userId, "fog")} className="rounded-lg bg-orange-100 px-2 py-0.5 text-xs">
                      😈 Туман
                    </button>
                    <button type="button" onClick={() => onPrank(m.userId, "sticker")} className="rounded-lg bg-orange-100 px-2 py-0.5 text-xs">
                      🎭 Стикер
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {askResult && (
        <div className="rounded-2xl bg-white/60 p-3 text-xs text-red-950">
          <p className="mb-2 font-semibold">Как прошла сессия?</p>
          <div className="flex gap-1">
            {([["done", "✅ Сделал"], ["partial", "🟡 Частично"], ["not_done", "❌ Нет"]] as const).map(([v, text]) => (
              <button
                key={v}
                type="button"
                onClick={() => { onResult(v); setResultCycle(snap.room.cycleId); }}
                className="flex-1 rounded-lg bg-white px-1 py-1"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}

      {canTask && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onTask(task);
          }}
        >
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onBlur={() => task.trim() && onTask(task)}
            maxLength={80}
            placeholder="Чем займёшься?"
            className={`${inputCls} py-2 text-sm`}
          />
        </form>
      )}
    </GlassCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Профиль: улучшения, достижения, история, настройки пакостей               */
/* -------------------------------------------------------------------------- */

type Tab = "upgrades" | "achievements" | "history";
const RESULT_ICON: Record<string, string> = { done: "✅", partial: "🟡", not_done: "❌" };
const SESSION_LABEL: Record<string, string> = { completed: "завершена", aborted: "досрочно", abandoned: "прервана (нет связи)", active: "идёт" };

function ProfileDrawer({ refreshKey, onClose, onError }: { refreshKey: number; onClose: () => void; onError: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>("upgrades");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);

  const load = () => {
    client.progress().then(setProgress).catch((e) => onError(errMsg(e)));
    client.sessions(30).then((r) => setSessions(r.sessions)).catch(() => undefined);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [refreshKey]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      onError(errMsg(e));
    }
    load();
  };

  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 30, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto"
      >
        <GlassCard className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-red-950">
              {progress ? `${progress.name} · ур. ${progress.level}` : "Профиль"}
            </h3>
            <button type="button" onClick={onClose} className="rounded-full bg-white/70 px-3 py-1 text-sm font-semibold text-red-900">
              Закрыть
            </button>
          </div>

          {progress && (
            <>
              <p className="text-sm text-red-950">
                {progress.xp}/{progress.nextLevelXp} XP · {progress.coins} 🍅 · занятий: {progress.stats.completedSessions}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-red-950">
                <input
                  type="checkbox"
                  checked={progress.prankEnabled}
                  onChange={(e) => act(() => client.updateMe({ prankEnabled: e.target.checked }))}
                />
                Получать дружеские пакости (если выключить — и отправлять нельзя)
              </label>
              {progress.effects.length > 0 && (
                <p className="text-xs text-red-900/70">
                  Активно: {progress.effects.map((e) => (e.kind === "boost" ? "🤝 Бонус (+XP к следующей сессии)" : "🛡 Щит")).join(", ")}
                </p>
              )}

              <div className="flex gap-1 rounded-2xl bg-white/40 p-1">
                {([["upgrades", "Улучшения"], ["achievements", "Достижения"], ["history", "История"]] as const).map(([id, text]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`flex-1 rounded-xl px-3 py-1.5 text-sm font-semibold ${tab === id ? "bg-red-500 text-white" : "text-red-900/70"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>

              {tab === "upgrades" && (
                <ul className="space-y-2">
                  {progress.upgrades.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 rounded-2xl bg-white/50 px-3 py-2 text-sm text-red-950">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {u.title} <span className="font-normal text-red-900/60">{u.level}/{u.maxLevel}</span>
                        </p>
                        <p className="text-xs text-red-900/60">{u.description}</p>
                      </div>
                      <button
                        type="button"
                        disabled={u.maxed || u.locked || !u.canBuy}
                        onClick={() => act(() => client.buyUpgrade(u.id, u.level))}
                        className="shrink-0 rounded-xl bg-red-500 px-3 py-1.5 text-xs font-bold text-white disabled:bg-red-200"
                      >
                        {u.maxed ? "Макс." : u.locked ? `ур. ${u.minPlayerLevel}+` : `${u.nextCost} 🍅`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {tab === "achievements" && (
                <ul className="space-y-2">
                  {progress.achievements.map((a) => (
                    <li key={a.id} className={`rounded-2xl px-3 py-2 text-sm ${a.unlocked ? "bg-emerald-100/70" : "bg-white/40 opacity-60"}`}>
                      <p className="font-semibold text-red-950">
                        {a.unlocked ? "🏅" : "🔒"} {a.title} <span className="font-normal text-red-900/60">+{a.reward.coins} 🍅</span>
                      </p>
                      <p className="text-xs text-red-900/60">{a.description}</p>
                    </li>
                  ))}
                </ul>
              )}

              {tab === "history" && (
                <ul className="space-y-2">
                  {sessions.length === 0 && <li className="text-sm text-red-900/60">Занятий пока нет</li>}
                  {sessions.map((s) => (
                    <li key={s.id} className="rounded-2xl bg-white/50 px-3 py-2 text-sm text-red-950">
                      <p className="font-semibold">
                        {s.task ?? "Без задачи"} {s.result && RESULT_ICON[s.result]}
                      </p>
                      <p className="text-xs text-red-900/60">
                        {new Date(s.startedAt).toLocaleString()} · {SESSION_LABEL[s.status]}
                        {s.rewarded ? ` · +${s.xp} XP, +${s.coins} 🍅` : " · без награды"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Voice bar (локальные кнопки: голосовой связи в MVP нет)                   */
/* -------------------------------------------------------------------------- */

function VoiceBar() {
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);

  // Как в Discord: deafen глушит и микрофон тоже
  const micOff = muted || deafened;

  return (
    <motion.div
      key="voice-bar"
      initial={{ y: "120%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "120%", opacity: 0 }}
      transition={{ ...SPRING, delay: 0.25 }}
      className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <GlassCard className="flex items-center gap-4 rounded-full px-4 py-3 sm:gap-6 sm:px-6">
        <div className="flex items-center gap-2 pl-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-semibold text-red-950">Voice</span>
        </div>

        <div className="flex gap-2">
          <ToggleButton
            on={!micOff}
            onClick={() => setMuted((v) => !v)}
            label={micOff ? "Включить микрофон" : "Выключить микрофон"}
            iconOn={<Mic size={22} />}
            iconOff={<MicOff size={22} />}
          />
          <ToggleButton
            on={!deafened}
            onClick={() => setDeafened((v) => !v)}
            label={deafened ? "Включить звук" : "Выключить звук"}
            iconOn={<Headphones size={22} />}
            iconOff={<HeadphoneOff size={22} />}
          />
        </div>
      </GlassCard>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Корневой компонент: всё состояние — серверное                             */
/* -------------------------------------------------------------------------- */

const client = new TomatoClient();
const ROOM_KEY = "tomato.roomId";
const NAME_KEY = "tomato.name";
const errMsg = (e: unknown) => (e instanceof TomatoApiError ? e.message : "Нет связи с сервером");
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

interface Toast {
  id: number;
  text: string;
}

function describeEvent(ev: ServerEvent, myId: string | undefined): string | null {
  const d = ev.data as Record<string, any>;
  switch (ev.type) {
    case "reward_granted":
      return d.kind === "achievement" ? null : `+${d.xp} XP, +${d.coins} 🍅${d.levelUp ? ` — новый уровень ${d.level}!` : ""}`;
    case "achievement_unlocked":
      return `🏅 Достижение: ${d.title}`;
    case "session_completed":
      return d.rewarded ? null : d.status === "completed" ? "Сессия завершена, награда за сегодня исчерпана" : "Сессия прервана — без награды";
    case "challenge_completed":
      return "🏆 Команда достигла цели!";
    case "help_applied":
      return d.to === myId ? `🤝 Вам помогли: +${d.xpBonusPct ?? ""}% XP к следующей сессии` : null;
    case "prank_applied":
      return d.to === myId ? (d.blocked ? "🛡 Щит отразил пакость" : `😈 Вам отправили «${d.type === "fog" ? "туман" : "стикер"}»`) : null;
    default:
      return null;
  }
}

export default function TomatoApp() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [workMin, setWorkMin] = useState(25);
  const [restMin, setRestMin] = useState(5);
  const [name, setName] = useState(store.get(NAME_KEY) ?? "");
  const [code, setCode] = useState("");
  const [demo, setDemo] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileKey, setProfileKey] = useState(0);

  const { snapshot, remainingMs, events } = useTomatoRoom(client, roomId);
  const inRoom = screen === "room";
  const me = snapshot?.me;

  // Режим демо на сервере + восстановление комнаты после перезагрузки страницы
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((h) => { setDemoAvailable(Boolean(h.demoMode)); if (h.demoMode) setDemo(true); }).catch(() => undefined);
    const saved = store.get(ROOM_KEY);
    if (client.token && saved) {
      client.room(saved).then(() => { setRoomId(saved); setScreen("room"); }).catch(() => store.set(ROOM_KEY, null));
    }
  }, []);

  // Уведомления о наградах и событиях
  const seen = useRef(0);
  useEffect(() => {
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    for (const ev of fresh) {
      const text = describeEvent(ev, me?.userId);
      if (!text) continue;
      const id = Date.now() + Math.random();
      setProfileKey((k) => k + 1); // профиль обновится после наград/покупок
      setToasts((t) => [...t.slice(-3), { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    }
  }, [events, me?.userId]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
      setTimeout(() => setError(null), 5000);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim();
      if (client.token) {
        // токен мог устареть (например, сервер пересоздал БД) — тогда регистрируемся заново
        await client.me().catch((e) => { if (e instanceof TomatoApiError && e.status === 401) client.setToken(null); else throw e; });
      }
      if (!client.token) await client.register(trimmed);
      else if (trimmed !== store.get(NAME_KEY)) await client.updateMe({ name: trimmed });
      store.set(NAME_KEY, trimmed);

      if (roomId) {
        if (snapshot?.me?.isHost && snapshot.room.phase === "waiting") {
          await client.updateSettings(roomId, demo ? { demo: true, focusSeconds: 25, breakSeconds: 15 } : { focusMinutes: workMin, breakMinutes: restMin });
        }
      } else {
        const snap = code.trim()
          ? await client.joinByCode(code.trim())
          : await client.createRoom(
              demo
                ? { name: `Комната ${trimmed}`, demo: true, focusSeconds: 25, breakSeconds: 15 }
                : { name: `Комната ${trimmed}`, focusMinutes: workMin, breakMinutes: restMin },
            );
        setRoomId(snap.room.id);
        store.set(ROOM_KEY, snap.room.id);
      }
      setScreen("room");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!roomId) return;
    await run(() => client.leaveRoom(roomId));
    setRoomId(null);
    store.set(ROOM_KEY, null);
  }

  // Что показывает таймер: серверное оставшееся время, а до старта — длительность фокуса
  const seconds = snapshot
    ? snapshot.room.phaseEndsAt !== null && remainingMs !== null
      ? Math.ceil(remainingMs / 1000)
      : snapshot.room.settings.focusSec
    : workMin * 60;
  const phase = snapshot?.room.phase;
  const label = phase === "focus" ? "Фокус" : phase === "break" ? "Перерыв" : phase === "completed" ? "Комната закрыта" : "Ожидание старта";
  const actions = me?.allowedActions ?? [];

  const timerControls = !snapshot ? null : actions.includes("start_focus") ? (
    <motion.button
      type="button"
      onClick={() => run(() => client.startFocus(snapshot.room.id))}
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.06 }}
      aria-label="Старт"
      className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/40"
    >
      <Play size={24} className="translate-x-0.5" />
    </motion.button>
  ) : actions.includes("abort_session") ? (
    <motion.button
      type="button"
      onClick={() => run(() => client.abortSession(snapshot.room.id))}
      whileTap={{ scale: 0.95 }}
      className="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-red-900"
    >
      <Pause size={16} /> Завершить досрочно (без награды)
    </motion.button>
  ) : actions.includes("skip_break") ? (
    <button type="button" onClick={() => run(() => client.skipBreak(snapshot.room.id))} className="rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-red-900">
      Пропустить перерыв
    </button>
  ) : (
    <p className="text-sm text-red-900/60">
      {phase === "waiting" ? "Ждём, пока создатель запустит сессию" : phase === "focus" ? "Вы наблюдаете за сессией" : ""}
    </p>
  );

  return (
    <div className="relative h-screen w-full overflow-hidden font-sans">
      <Background blurred={inRoom} />

      <LayoutGroup>
        {demoAvailable && (
          <div className="absolute bottom-3 right-3 z-10 whitespace-nowrap rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white shadow">
            ⚡ Демо-сервер
          </div>
        )}

        {/* Экран 1 */}
        <AnimatePresence>
          {screen === "welcome" && <WelcomeScreen onStart={() => setScreen("settings")} />}
        </AnimatePresence>

        {/* Экраны 2 и 3: таймер живёт здесь всегда и просто меняет положение */}
        {screen !== "welcome" && (
          <motion.div
            layout
            transition={SPRING}
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto px-4 py-8"
          >
            {/* Кнопка «назад» — только в комнате */}
            <AnimatePresence>
              {inRoom && (
                <motion.button
                  key="back"
                  type="button"
                  onClick={() => setScreen("settings")}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-4 py-2 text-sm font-semibold text-red-950 shadow-lg shadow-red-900/10 backdrop-blur-xl sm:left-6 sm:top-6"
                >
                  <ArrowLeft size={18} />
                  Настройки
                </motion.button>
              )}
            </AnimatePresence>

            {/* Профиль: улучшения, достижения, история */}
            {inRoom && (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="absolute left-4 top-16 flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-4 py-2 text-sm font-semibold text-red-950 shadow-lg shadow-red-900/10 backdrop-blur-xl sm:left-6 sm:top-20"
            >
              👤 Профиль
            </button>
            )}

            {/* Название комнаты */}
            <AnimatePresence>
              {inRoom && (
                <motion.h2
                  key="room-title"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-5 max-w-[50%] truncate text-lg font-bold text-red-950 sm:top-7"
                >
                  🍅 {snapshot?.room.name ?? ""}
                </motion.h2>
              )}
            </AnimatePresence>

            <TimerCard seconds={seconds} label={label} inRoom={inRoom}>
              {timerControls}
            </TimerCard>

            {/* popLayout: уходящая панель сразу выпадает из потока,
                поэтому таймер едет в центр одновременно с её исчезновением */}
            <AnimatePresence mode="popLayout">
              {screen === "settings" && (
                <motion.div
                  key="settings-wrap"
                  initial={{ opacity: 0, y: 40, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 40, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-full max-w-md"
                >
                  <SettingsPanel
                    work={workMin}
                    rest={restMin}
                    name={name}
                    code={code}
                    demo={demo}
                    demoAvailable={demoAvailable}
                    inRoom={Boolean(roomId)}
                    busy={busy}
                    error={error}
                    onWork={setWorkMin}
                    onRest={setRestMin}
                    onName={setName}
                    onCode={setCode}
                    onDemo={setDemo}
                    onSubmit={submit}
                    onLeave={leave}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Участники и прогресс — справа, не мешают таймеру */}
            <AnimatePresence>
              {inRoom && snapshot && (
                <motion.div
                  key="room-panel"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ delay: 0.2 }}
                  className="absolute right-6 top-6"
                >
                  <RoomPanel
                    snap={snapshot}
                    onTask={(t) => run(() => client.setTask(snapshot.room.id, t))}
                    onHelp={(id, type) => run(() => client.help(snapshot.room.id, id, type))}
                    onPrank={(id, type) => run(() => client.prank(snapshot.room.id, id, type))}
                    onResult={(r) => run(() => client.recordResult(snapshot.room.id, r))}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Уведомления: награды, достижения, соц. действия */}
        <div className="pointer-events-none absolute bottom-24 left-4 z-10 flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                className="rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-sm font-semibold text-red-950 shadow-lg backdrop-blur-xl"
              >
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {inRoom && error && (
          <div className="absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-xl bg-red-100 px-4 py-2 text-sm text-red-800 shadow">{error}</div>
        )}

        <AnimatePresence>
          {profileOpen && <ProfileDrawer refreshKey={profileKey} onClose={() => setProfileOpen(false)} onError={(m) => { setError(m); setTimeout(() => setError(null), 5000); }} />}
        </AnimatePresence>

        {/* Voice chat bar */}
        <AnimatePresence>{inRoom && <VoiceBar />}</AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
