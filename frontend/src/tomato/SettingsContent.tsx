import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Copy, LogOut } from "lucide-react";
import { extractRoomCode, roomLink } from "./format";
import { ProfilePanel } from "./ProfilePanel";
import type { Tomato } from "./useTomato";

const WORK_PRESETS = [15, 25, 45, 50];
const REST_PRESETS = [5, 10, 15];

const field =
  "w-full rounded-xl border-0 bg-white/80 px-4 py-3 text-[15px] text-zinc-900 outline-none ring-1 ring-black/5 transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900 disabled:opacity-60";

function Segmented({ label, values, value, onChange, disabled }: { label: string; values: number[]; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</legend>
      <div className="relative flex rounded-xl bg-white/50 p-1" role="radiogroup" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className="relative flex-1 rounded-lg py-2 text-sm font-medium tabular-nums text-zinc-600 transition-colors aria-checked:text-white disabled:cursor-not-allowed"
          >
            {value === v && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-lg bg-zinc-900" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className="relative">{v}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface FormState {
  work: number;
  rest: number;
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

  const settingsInput = form.demo ? { demo: true, focusSeconds: 25, breakSeconds: 15 } : { focusMinutes: form.work, breakMinutes: form.rest };
  const changed = room ? (room.demo ? false : room.settings.focusSec !== form.work * 60 || room.settings.breakSec !== form.rest * 60) : false;

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
        <Segmented label="Фокус, мин" values={WORK_PRESETS} value={form.work} onChange={form.setWork} disabled={locked || form.demo} />
        <Segmented label="Перерыв, мин" values={REST_PRESETS} value={form.rest} onChange={form.setRest} disabled={locked || form.demo} />
      </div>

      {t.demoAvailable && !inRoom && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/50 px-4 py-3 text-sm text-zinc-700">
          <input type="checkbox" checked={form.demo} onChange={(e) => form.setDemo(e.target.checked)} className="mt-1 h-4 w-4 accent-zinc-900" />
          <span>
            <span className="block font-medium text-zinc-900">Демо-режим</span>
            <span className="text-xs text-zinc-500">Фокус 25 секунд, перерыв 15 секунд. Правила и награды те же.</span>
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
      {inRoom && room!.demo && <p className="text-xs text-zinc-500">Демо-комната: фокус {room!.settings.focusSec} с, перерыв {room!.settings.breakSec} с.</p>}
      {locked && !room!.demo && <p className="text-xs text-zinc-500">Длительность меняет создатель комнаты до старта сессии.</p>}

      {/* Имя */}
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Ваше имя</span>
        <input value={t.name} onChange={(e) => t.setName(e.target.value)} maxLength={24} placeholder="Например, Лотти" autoComplete="nickname" className={field} disabled={inRoom} />
      </label>

      {!inRoom ? (
        <>
          <button
            type="button"
            disabled={!nameOk || t.busy}
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
            <button type="button" disabled={t.busy} onClick={() => t.updateSettings(settingsInput)} className="rounded-xl bg-zinc-900 py-3.5 text-[15px] font-medium text-white hover:bg-black disabled:bg-zinc-400">
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
