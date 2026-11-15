/**
 * 06 Room / Lobby (Figma, страница back): ожидание перед циклом.
 * Слева — таймер первого цикла, настройки (меняет только создатель), задача, «Я готов» и старт.
 * Справа — приглашение, участники (по командам, если режим команд) и чат комнаты.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Clock, Minus, Plus } from "lucide-react";
import { CHAT_CARD_SIZE, ChatPanel } from "../ChatPanel";
import { formatSpan, formatTime, parseDuration, readiness } from "../format";
import type { Tomato } from "../useTomato";
import { DEFAULT_LIMITS } from "../useTomato";
import { Invite } from "./RoomChrome";
import { TEAM_COLOR, TEAM_TITLE } from "../socialRules";
import { MemberAvatar } from "./ui";
import { GoalProgress } from "./GoalProgress";

function Stepper({ label, value, onChange, step, min, max, format, disabled }: {
  label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; format: (v: number) => string; disabled: boolean;
}) {
  const btn = "flex h-full w-8 shrink-0 items-center justify-center text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-30 sm:w-12";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2.5">
      <span className="as-label text-sm">{label}</span>
      <div className="flex h-12 items-center overflow-hidden rounded-[16px] border-2 border-ink bg-white sm:h-[52px] sm:rounded-[18px] 2xl:h-[60px]">
        <button type="button" className={btn} disabled={disabled || value - step < min} onClick={() => onChange(Math.max(min, value - step))} aria-label={`${label}: меньше`}><Minus size={20} aria-hidden /></button>
        <output className="min-w-0 flex-1 truncate text-center text-base font-extrabold sm:text-xl" aria-live="polite">{format(value)}</output>
        <button type="button" className={btn} disabled={disabled || value + step > max} onClick={() => onChange(Math.min(max, value + step))} aria-label={`${label}: больше`}><Plus size={20} aria-hidden /></button>
      </div>
    </div>
  );
}

/**
 * Время фокуса или перерыва: можно напечатать (25 → 25 мин, 0:30, 1:30:00, «1 ч 30 мин», «45 с») или
 * подправить кнопками ±. Значение вне границ не сохраняется — под полем подсказка с допустимым диапазоном.
 */
function TimeField({ label, value, onChange, step, min, max, disabled }: {
  label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; disabled: boolean;
}) {
  const [text, setText] = useState<string | null>(null); // null — не редактируется, показываем значение
  const [error, setError] = useState<string | null>(null);
  const range = `от ${formatSpan(min)} до ${formatSpan(max)}`;
  const commit = () => {
    if (text === null) return;
    const v = parseDuration(text);
    setText(null);
    if (v === null) { setError(`Не понял время. Например: 25, 0:30, 1 ч 30 мин`); return; }
    if (v < min || v > max) { setError(`Можно ${range}`); return; }
    setError(null);
    if (v !== value) onChange(v);
  };
  const btn = "flex h-full w-8 shrink-0 items-center justify-center text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-30 sm:w-12";
  const id = `time-${label}`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2.5">
      <label htmlFor={id} className="as-label text-sm">{label}</label>
      <div className={`flex h-12 items-center overflow-hidden rounded-[16px] border-2 bg-white sm:h-[52px] sm:rounded-[18px] 2xl:h-[60px] ${error ? "border-rose" : "border-ink"} focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-peach`}>
        <button type="button" className={btn} disabled={disabled || value - step < min} onClick={() => { setError(null); onChange(Math.max(min, value - step)); }} aria-label={`${label}: меньше`}><Minus size={20} aria-hidden /></button>
        <input
          id={id}
          type="text"
          inputMode="text"
          disabled={disabled}
          value={text ?? formatSpan(value)}
          onFocus={(e) => { setText(formatSpan(value)); requestAnimationFrame(() => e.target.select()); }}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(null); setError(null); e.currentTarget.blur(); } }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          title={`Введите время ${range}: 25, 0:30, 1 ч 30 мин`}
          data-testid={`time-${label === "Фокус" ? "focus" : "break"}`}
          className="min-w-0 flex-1 bg-transparent text-center text-base font-extrabold outline-none disabled:cursor-not-allowed sm:text-xl"
        />
        <button type="button" className={btn} disabled={disabled || value + step > max} onClick={() => { setError(null); onChange(Math.min(max, value + step)); }} aria-label={`${label}: больше`}><Plus size={20} aria-hidden /></button>
      </div>
      {error && <p id={`${id}-err`} role="alert" className="text-xs font-bold text-rose sm:text-sm">{error}</p>}
    </div>
  );
}

/** Задача на цикл: сохраняется на сервере при потере фокуса или Enter. */
export function TaskInput({ t, dark = false }: { t: Tomato; dark?: boolean }) {
  const me = t.snapshot!.me;
  const editable = me?.allowedActions.includes("set_task") ?? false;
  const [value, setValue] = useState(me?.task ?? "");
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setValue(me?.task ?? ""); }, [me?.task]);
  const save = () => { editing.current = false; const v = value.trim(); if (v !== (me?.task ?? "")) t.setTask(v); };
  return (
    <label className="flex w-full flex-col gap-2.5">
      <span className={`as-label ${dark ? "text-cream" : ""}`}>Над чем работаешь в этом цикле?</span>
      <input
        value={value}
        disabled={!editable}
        onChange={(e) => { editing.current = true; setValue(e.target.value); }}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={80}
        placeholder="Например, алгебра: логарифмы, № 1–15"
        className="as-input"
      />
    </label>
  );
}

/** Участники: в режиме команд — две колонки A и B, иначе одна сетка. */
function Members({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const teams = snap.room.mode === "teams";
  const meId = snap.me?.userId;
  const canSwitch = snap.me?.allowedActions.includes("set_team") ?? false;
  const row = (m: (typeof snap.members)[number]) => (
    <li key={m.userId} className={`flex min-w-0 items-center gap-2.5 rounded-[14px] bg-white px-3 pb-2 pt-4 ${m.userId === meId ? "ring-2 ring-ink" : ""}`} style={teams ? { borderLeft: `5px solid ${TEAM_COLOR[m.team] ?? TEAM_COLOR.shared}` } : undefined} data-ready={m.isReady ? "true" : "false"}>
      <MemberAvatar name={m.name} id={m.userId} look={m.avatar} connection={m.connection} size={34} host={m.role === "host"} />
      {/* имя целиком сверху, под ним — готовность; создателя отмечает корона, себя — обводка строки */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-bold leading-tight">{m.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {m.connection === "offline" ? (
            <span className="text-sm font-bold text-[#B5402F]">нет связи</span>
          ) : m.isReady ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-olive bg-[#EEF0D2] px-2 text-[13px] font-extrabold text-olive"><Check size={13} strokeWidth={3} aria-hidden />готов</span>
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-dashed border-line px-2 text-[13px] font-bold text-mute"><Clock size={13} aria-hidden />не готов</span>
          )}
        </span>
      </span>
    </li>
  );
  if (!teams) {
    return (
      <div className="flex flex-col gap-2.5" role="group" aria-label="Участники">
        <p className="as-label">В комнате · {snap.members.length}</p>
        <p className="-mt-1 text-sm text-mute">Комната без команд: все идут к цели вместе. Красные и Синие включаются при создании комнаты.</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{snap.members.map(row)}</ul>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" role="group" aria-label="Участники">
      {(["A", "B"] as const).map((k) => {
        const list = snap.members.filter((m) => m.team === k);
        const mine = snap.me?.team === k;
        return (
          <div key={k} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 whitespace-nowrap font-display text-lg" data-team-title={k}><span className="h-3.5 w-3.5 rounded-full border-2 border-ink" style={{ background: TEAM_COLOR[k] }} aria-hidden /><span className="relative top-0.5">{TEAM_TITLE[k]}</span></p>
              {canSwitch && !mine && <button type="button" onClick={() => t.setTeam(k)} className="rounded-full border-2 border-ink bg-white px-3 py-0.5 text-sm font-extrabold hover:bg-petal">Сюда</button>}
            </div>
            <ul className="flex flex-col gap-2">{list.length ? list.map(row) : <p className="rounded-[14px] border-2 border-dashed border-line px-3 py-2.5 text-sm text-mute">Пока никого</p>}</ul>
          </div>
        );
      })}
    </div>
  );
}

export function Lobby({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const room = snap.room;
  const me = snap.me;
  const actions = me?.allowedActions ?? [];
  const isHost = Boolean(me?.isHost);
  const canEdit = actions.includes("update_settings");
  const lim = t.limits ?? DEFAULT_LIMITS;
  const demo = room.demo;
  const { ready, total, all } = readiness(snap.members, me?.userId);
  const closed = room.phase === "completed";
  const isReady = Boolean(me?.isReady);
  // План циклов выполнен: комната вернулась в лобби, и каждый следующий старт — цикл «сверх плана»
  const planDone = room.cycleNo > 0 && room.cycleNo >= (room.settings.cycles ?? 4);

  // Настройки: локальное значение сразу, на сервер уходит после короткой паузы (не на каждый клик)
  const [focusSec, setFocusSec] = useState(room.settings.focusSec);
  const [breakSec, setBreakSec] = useState(room.settings.breakSec);
  const [cycles, setCycles] = useState(room.settings.cycles ?? 4);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setFocusSec(room.settings.focusSec); setBreakSec(room.settings.breakSec); setCycles(room.settings.cycles ?? 4); } }, [room.settings.focusSec, room.settings.breakSec, room.settings.cycles]);
  const { updateSettings } = t;
  useEffect(() => {
    if (!dirty.current) return;
    const id = setTimeout(() => { dirty.current = false; updateSettings({ focusSeconds: focusSec, breakSeconds: breakSec, cycles }); }, 450);
    return () => clearTimeout(id);
  }, [focusSec, breakSec, cycles, updateSettings]);
  const edit = (set: (v: number) => void) => (v: number) => { dirty.current = true; set(v); };

  const fLim = demo ? lim.demoFocusSeconds : lim.focusSeconds;
  const bLim = demo ? lim.demoBreakSeconds : lim.breakSeconds;

  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,540px)]">
      {/* ---------- Setup ---------- */}
      <section className="flex flex-col items-center justify-center gap-4 px-4 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-5 2xl:gap-7" aria-label="Подготовка к циклу">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-lg font-bold text-mute sm:text-xl">{closed ? "сессия завершена" : planDone ? "дополнительный цикл длится" : room.cycleNo > 0 ? "следующий цикл длится" : "первый цикл длится"}</p>
          <p className="font-display text-[clamp(3.5rem,min(15vw,14vh),13.75rem)] leading-none pt-[0.12em] text-rose" data-testid="lobby-timer">{formatTime(focusSec)}</p>
        </div>

        {!closed && (
          <>
            <div className="grid w-full max-w-[700px] grid-cols-3 gap-2 sm:gap-4">
              <TimeField label="Фокус" value={focusSec} onChange={edit(setFocusSec)} step={demo ? 5 : 60} min={fLim[0]} max={fLim[1]} disabled={!canEdit} />
              <TimeField label="Перерыв" value={breakSec} onChange={edit(setBreakSec)} step={demo ? 5 : 60} min={bLim[0]} max={bLim[1]} disabled={!canEdit} />
              {/* до первого фокуса — сколько циклов всего; потом — сколько ещё впереди (пройденные не отменяются) */}
              {room.cycleNo > 0 ? (
                <Stepper label="Ещё циклов" value={Math.max(0, cycles - room.cycleNo)} onChange={edit((v: number) => setCycles(room.cycleNo + v))} step={1} min={0} max={lim.cycles[1]} format={(v) => String(v)} disabled={!canEdit} />
              ) : (
                <Stepper label="Циклы" value={cycles} onChange={edit(setCycles)} step={1} min={lim.cycles[0]} max={lim.cycles[1]} format={(v) => String(v)} disabled={!canEdit} />
              )}
            </div>
            {planDone && (
              <p className="w-full max-w-[640px] rounded-[18px] border-2 border-olive bg-[#EEF0D2] px-4 py-3 text-center text-base font-bold text-olive" role="note">
                План выполнен: пройдено циклов — {room.cycleNo}. Добавьте «Ещё циклов», и они пойдут подряд; иначе каждый старт — один цикл сверх плана.
              </p>
            )}
            {/* на невысоких экранах (ноутбук 1366×768) подсказку прячем, чтобы «Начать фокус» не уходила под полосу голоса */}
            <p className="max-w-[640px] text-center text-base text-mute [@media(max-height:820px)]:hidden">
              {isHost ? "Настройки меняете вы. " : "Настройки меняет создатель комнаты. "}Награда — только за полный цикл фокуса.
            </p>
            <div className="w-full max-w-[600px]"><TaskInput t={t} /></div>

            {/* Своё состояние крупно и словами: «готов / не готов» не должно читаться только по цвету кнопки */}
            <div role="status" data-testid="my-ready" data-ready={isReady ? "true" : "false"}
              className={`flex w-full max-w-[600px] items-center gap-3 rounded-[18px] border-2 px-4 py-3 ${isReady ? "border-olive bg-[#EEF0D2]" : "border-dashed border-line bg-paper"}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${isReady ? "border-olive bg-lime text-olive" : "border-line bg-white text-mute"}`} aria-hidden>
                {isReady ? <Check size={22} strokeWidth={3} /> : <Clock size={20} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-lg font-extrabold ${isReady ? "text-olive" : "text-ink"}`}>{isReady ? "Вы готовы" : "Вы ещё не готовы"}</span>
                <span className="block text-[15px] text-mute">
                  {isReady ? (all ? "Все готовы, можно начинать" : "Ждём остальных") : "Нажмите «Я готов», когда сядете за задачу"}
                </span>
              </span>
              <span className={`shrink-0 whitespace-nowrap rounded-full border-2 px-3 py-1 text-[15px] font-extrabold ${all ? "border-olive bg-lime text-olive" : "border-line bg-white text-mute"}`} aria-live="polite" data-testid="ready-count">
                {ready}/{total} готовы
              </span>
            </div>

            <div className={`grid w-full max-w-[600px] gap-3 ${actions.includes("start_focus") && actions.includes("set_ready") ? "xs:grid-cols-2" : ""}`}>
              {actions.includes("set_ready") && (
                <button type="button" onClick={() => t.setReady(!isReady)} aria-pressed={isReady} title={isReady ? "Нажмите, чтобы отменить готовность" : undefined}
                  className={`as-btn whitespace-nowrap ${isReady ? "as-btn-ready" : "as-btn-light"}`}>
                  {isReady ? <><Check size={22} strokeWidth={3} aria-hidden />Вы готовы</> : "Я готов"}
                </button>
              )}
              {actions.includes("start_focus") && (
                <button type="button" onClick={t.startFocus} disabled={!all || t.busy} className="as-btn as-btn-primary whitespace-nowrap">Начать фокус</button>
              )}
            </div>
            {!actions.includes("start_focus") && <p className="text-center text-mute">Фокус запускает создатель комнаты, когда все готовы.</p>}
          </>
        )}
        {closed && <p className="max-w-md text-center text-lg text-mute">Создатель закрыл комнату. Прогресс сохранён, а новую комнату можно создать из профиля → «Выйти из комнаты».</p>}
      </section>

      {/* ---------- Room panel ---------- */}
      <aside className="flex min-h-0 flex-col gap-7 border-t-2 border-soft bg-paper px-4 py-7 sm:px-8 lg:border-l-2 lg:border-t-0 lg:px-9 lg:py-8" aria-label="Комната">
        <Invite code={room.code} />
        <GoalProgress t={t} />
        <Members t={t} />
        <div className={`flex ${CHAT_CARD_SIZE} shrink-0 flex-col overflow-hidden rounded-[22px] border-2 border-line bg-white`}>
          <ChatPanel t={t} />
        </div>
      </aside>
    </div>
  );
}
