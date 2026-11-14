import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, LogOut } from "lucide-react";
import { extractRoomCode, formatSpan, roomLink } from "./format";
import { ProfilePanel } from "./ProfilePanel";
import { DEFAULT_LIMITS, type Tomato } from "./useTomato";

const field =
  "w-full rounded-xl border-0 bg-white/80 px-4 py-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/5 transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900 disabled:opacity-60";

const clamp = (v: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, v));

/**
 * Свободный ввод длительности (ч / мин / сек) вместо пресетов. Значение — секунды; при выходе из поля
 * подтягивается к границам, которые задаёт сервер (он всё равно проверяет их сам).
 */
export function DurationInput({ label, seconds, limits, onChange, disabled }: { label: string; seconds: number; limits: [number, number]; onChange: (v: number) => void; disabled?: boolean }) {
  const parts = { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60), s: seconds % 60 };
  const set = (k: "h" | "m" | "s", raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const next = { ...parts, [k]: n };
    onChange(next.h * 3600 + next.m * 60 + next.s);
  };
  const out = seconds < limits[0] || seconds > limits[1];
  const box = "w-full min-w-0 rounded-lg border-0 bg-white/80 px-2 py-2 text-center text-[15px] tabular-nums text-zinc-900 outline-none ring-1 ring-black/5 focus:bg-white focus:ring-2 focus:ring-zinc-900 disabled:opacity-60";
  return (
    <fieldset disabled={disabled} className="min-w-0" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onChange(clamp(seconds, limits)); }}>
      <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</legend>
      <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-white/50 p-1">
        {(["h", "m", "s"] as const).map((k) => (
          <label key={k} className="flex min-w-0 items-center gap-1 text-xs text-zinc-500">
            <input type="number" inputMode="numeric" min={0} max={k === "h" ? 24 : 59} value={parts[k]} onChange={(e) => set(k, e.target.value)} aria-label={`${label}: ${k === "h" ? "часы" : k === "m" ? "минуты" : "секунды"}`} className={box} />
            <span className="shrink-0">{k === "h" ? "ч" : k === "m" ? "м" : "с"}</span>
          </label>
        ))}
      </div>
      <p className={`mt-1.5 text-[11px] ${out ? "text-red-600" : "text-zinc-500"}`}>от {formatSpan(limits[0])} до {formatSpan(limits[1])}</p>
    </fieldset>
  );
}

export interface FormState {
  /** Фокус, секунды (вводит пользователь) */
  work: number;
  /** Перерыв, секунды */
  rest: number;
  /** Сколько циклов «фокус → перерыв» запланировано: столько остановок на карте */
  cycles: number;
  setCycles: (v: number) => void;
  demo: boolean;
  teamMode: boolean;
  setTeamMode: (v: boolean) => void;
  setWork: (v: number) => void;
  setRest: (v: number) => void;
  setDemo: (v: boolean) => void;
}

/** Содержимое выдвижной панели настроек (серая область справа). */
export function SettingsContent({ t, form, onCollapse, initialCode = "" }: { t: Tomato; form: FormState; onCollapse: () => void; initialCode?: string }) {
  const snap = t.snapshot;
  const room = snap?.room;
  const inRoom = Boolean(room);
  const isHost = Boolean(snap?.me?.isHost);
  const canEditRoom = inRoom && isHost && room!.phase === "waiting";
  const locked = inRoom && !canEditRoom;

  const [code, setCode] = useState(initialCode);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"main" | "profile">("main");
  const nameOk = t.name.trim().length > 0;
  const codeOk = extractRoomCode(code) !== null;

  const demo = form.demo || t.demoMode; // демо-сервер: песочный аккаунт создаёт только демо-комнаты
  const lim = t.limits ?? DEFAULT_LIMITS;
  const focusLim = demo ? lim.demoFocusSeconds : lim.focusSeconds;
  const breakLim = demo ? lim.demoBreakSeconds : lim.breakSeconds;
  const settingsInput = { ...(demo && !inRoom ? { demo: true } : {}), focusSeconds: form.work, breakSeconds: form.rest, cycles: form.cycles };
  const valid = form.work >= focusLim[0] && form.work <= focusLim[1] && form.rest >= breakLim[0] && form.rest <= breakLim[1];
  const cyclesLocked = inRoom && room!.cycleNo > 0; // план циклов задаёт карту — меняется только до первого фокуса
  const changed = room ? room.settings.focusSec !== form.work || room.settings.breakSec !== form.rest || (room.settings.cycles ?? 4) !== form.cycles : false;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6 sm:p-8 [&_*]:[--fg:#111]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCollapse}
          className="flex items-center gap-1.5 rounded-full py-1 pr-3 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          {inRoom ? <><ChevronRight size={18} /> Свернуть</> : <><ChevronLeft size={18} /> Назад</>}
        </button>
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-900">{inRoom ? "Комната" : "Настройки"}</h2>
      </div>

      {t.user && (
        <div className="flex rounded-xl bg-white/50 p-1" role="tablist" aria-label="Раздел">
          {([["main", inRoom ? "Комната" : "Настройки"], ["profile", "Профиль"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${view === id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {view === "profile" && t.user ? <ProfilePanel t={t} /> : (<>
      {/* Таймер */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DurationInput label="Фокус" seconds={form.work} limits={focusLim} onChange={form.setWork} disabled={locked} />
        <DurationInput label="Перерыв" seconds={form.rest} limits={breakLim} onChange={form.setRest} disabled={locked} />
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Циклов «фокус → перерыв»</span>
        <input
          type="number" inputMode="numeric" min={lim.cycles[0]} max={lim.cycles[1]} value={form.cycles} disabled={locked || cyclesLocked}
          onChange={(e) => form.setCycles(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          onBlur={() => form.setCycles(clamp(form.cycles, lim.cycles))}
          className={`${field} tabular-nums`}
        />
        <span className="mt-1.5 block text-[11px] text-zinc-500">
          {cyclesLocked ? "План уже идёт — число циклов не меняется до новой комнаты" : `Остановок на карте столько же, сколько перерывов (${lim.cycles[0]}–${lim.cycles[1]}). После перерыва следующий фокус стартует сам.`}
        </span>
      </label>

      {/* На демо-сервере демо-режим не выбирается: он включён и заблокирован, причина — в подписи */}
      {t.demoMode && !inRoom && (
        <label className="flex cursor-not-allowed items-start gap-3 rounded-xl bg-white/50 px-4 py-3 text-sm text-zinc-700">
          <input type="checkbox" checked disabled readOnly aria-describedby="demo-mode-note" className="mt-1 h-4 w-4 accent-zinc-900" />
          <span>
            <span className="block font-medium text-zinc-900">Демо-режим</span>
            <span id="demo-mode-note" className="text-xs text-zinc-500">
              Короткие циклы в секундах для показа. Включён всегда: это демо-песочница — здесь создаются только демо-комнаты,
              а прогресс не переносится в реальный аккаунт.
            </span>
          </span>
        </label>
      )}
      {!inRoom && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/50 px-4 py-3 text-sm text-zinc-700">
          <input type="checkbox" checked={form.teamMode} onChange={(e) => form.setTeamMode(e.target.checked)} className="mt-1 h-4 w-4 accent-zinc-900" />
          <span>
            <span className="block font-medium text-zinc-900">Команды A и B</span>
            <span className="text-xs text-zinc-500">Две команды идут по одной карте — побеждает первая, набравшая цель.</span>
          </span>
        </label>
      )}
      {inRoom && room!.mode === "teams" && (
        <fieldset disabled={room!.phase !== "waiting"}>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Ваша команда</legend>
          <div className="flex rounded-xl bg-white/50 p-1" role="radiogroup" aria-label="Ваша команда">
            {(["A", "B"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={snap?.me?.team === k} onClick={() => t.setTeam(k)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${snap?.me?.team === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}>
                Команда {k}
              </button>
            ))}
          </div>
          {room!.phase !== "waiting" && <p className="mt-2 text-xs text-zinc-500">Сменить команду можно между циклами.</p>}
        </fieldset>
      )}
      {inRoom && room!.demo && <p className="text-xs text-zinc-500">Демо-комната: фокус {formatSpan(room!.settings.focusSec)}, перерыв {formatSpan(room!.settings.breakSec)}.</p>}
      {locked && <p className="text-xs text-zinc-500">Длительность меняет создатель комнаты, пока комната ждёт старта.</p>}

      {/* Имя */}
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Ваше имя</span>
        <input value={t.name} onChange={(e) => t.setName(e.target.value)} maxLength={24} placeholder="Например, Лотти" autoComplete="nickname" className={field} disabled={inRoom} />
      </label>

      {!inRoom ? (
        <>
          <button
            type="button"
            disabled={!nameOk || !valid || t.busy}
            onClick={() => t.createRoom(t.name, { ...settingsInput, teamMode: form.teamMode })}
            className="rounded-xl bg-zinc-900 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {t.busy ? "Подождите…" : "Создать комнату"}
          </button>

          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500" aria-hidden>
            <span className="h-px flex-1 bg-black/10" /> или <span className="h-px flex-1 bg-black/10" />
          </div>

          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (nameOk && codeOk) t.joinRoom(t.name, code); }}>
            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Код или ссылка на комнату</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7QM2X или https://…/room/K7QM2X" className={`${field} font-mono`} />
            </label>
            <button
              type="submit"
              disabled={!nameOk || !codeOk || t.busy}
              className="rounded-xl bg-white/70 py-3.5 text-[15px] font-medium text-zinc-900 ring-1 ring-black/10 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Войти в комнату
            </button>
          </form>
        </>
      ) : (
        <>
          {canEditRoom && changed && (
            <button type="button" disabled={t.busy || !valid} onClick={() => t.updateSettings(settingsInput)} className="rounded-xl bg-zinc-900 py-3.5 text-[15px] font-medium text-white hover:bg-black disabled:bg-zinc-400">
              Сохранить настройки
            </button>
          )}

          <div className="rounded-xl bg-white/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Пригласить друзей</p>
            <p className="mt-2 font-mono text-3xl tracking-[0.25em] text-zinc-900">{room!.code}</p>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(roomLink(room!.code)).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="mt-3 flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Участники · {snap!.members.length}</p>
            <ul className="flex flex-col gap-1.5 text-sm text-zinc-800">
              {snap!.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between rounded-lg bg-white/50 px-3 py-2">
                  <span className="truncate">{m.name}{m.role === "host" && <span className="ml-2 text-xs text-zinc-500">создатель</span>}{(m.team === "A" || m.team === "B") && <span className="ml-2 text-xs font-semibold text-zinc-500">{m.team}</span>}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${m.connection === "online" ? "bg-emerald-500" : m.connection === "reconnecting" ? "bg-amber-400" : "bg-zinc-400"}`} />
                </li>
              ))}
            </ul>
          </div>

          <button type="button" onClick={t.leaveRoom} className="mt-auto flex items-center justify-center gap-2 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900">
            <LogOut size={16} /> Выйти из комнаты
          </button>
        </>
      )}
      </>)}
    </div>
  );
}
