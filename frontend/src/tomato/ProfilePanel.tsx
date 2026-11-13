import { useEffect, useState } from "react";
import { client } from "./useTomato";
import type { Tomato } from "./useTomato";
import type { Progress, StudySession } from "@/api/tomato";
import { formatDuration } from "./format";

type Tab = "upgrades" | "achievements" | "history";
const SESSION_LABEL: Record<string, string> = { completed: "завершена", aborted: "досрочно", abandoned: "нет связи", active: "идёт" };
const RESULT_LABEL: Record<string, string> = { done: "сделал", partial: "частично", not_done: "не успел" };

const card = "rounded-xl bg-white/60 px-4 py-3 text-sm text-zinc-800";

/** Профиль игрока: данные целиком с сервера (прогресс, улучшения, достижения, история). */
export function ProfilePanel({ t }: { t: Tomato }) {
  const [tab, setTab] = useState<Tab>("upgrades");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const me = t.snapshot?.me;
  const focusing = me?.status === "focusing";
  // перечитываем после наград/покупок: меняются xp и монеты в снимке комнаты
  const refreshKey = `${me?.xp ?? ""}:${me?.coins ?? ""}:${t.snapshot?.room.phase ?? ""}`;

  const load = async () => {
    const p = await t.call(() => client.progress());
    if (p) setProgress(p);
    const h = await t.call(() => client.sessions(30));
    if (h) setSessions(h.sessions);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (!progress) return <p className="text-sm text-zinc-500">Загружаем профиль…</p>;
  const span = progress.nextLevelXp - progress.levelStartXp;
  const pct = Math.min(100, ((progress.xp - progress.levelStartXp) / span) * 100);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl bg-white/60 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-lg font-medium text-zinc-900">{progress.name}</p>
          <p className="text-sm text-zinc-600">Уровень {progress.level}</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-zinc-900 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 flex justify-between text-xs text-zinc-500">
          <span className="tabular-nums">{progress.xp} / {progress.nextLevelXp} XP</span>
          <span className="tabular-nums">{progress.coins} монет · занятий: {progress.stats.completedSessions} · {formatDuration(progress.stats.focusSeconds ?? 0)}</span>
        </p>
        {progress.effects.length > 0 && (
          <p className="mt-2 text-xs text-zinc-600">
            Активно: {progress.effects.map((e) => (e.kind === "boost" ? "бонус к XP" : "щит от шуток")).join(", ")}
          </p>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-zinc-900"
          checked={progress.prankEnabled}
          onChange={async (e) => {
            // галочка переключается сразу; при ошибке сервера — откат
            const on = e.target.checked;
            setProgress((p) => (p ? { ...p, prankEnabled: on } : p));
            const ok = await t.setPranksEnabled(on);
            if (!ok) setProgress((p) => (p ? { ...p, prankEnabled: !on } : p));
          }}
        />
        <span>Получать дружеские шутки<span className="block text-xs text-zinc-500">Если выключить, отправлять их тоже нельзя.</span></span>
      </label>

      <div className="flex rounded-xl bg-white/50 p-1" role="tablist">
        {([["upgrades", "Улучшения"], ["achievements", "Достижения"], ["history", "История"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors sm:text-sm ${tab === id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "upgrades" && (
        <ul className="flex flex-col gap-2">
          {focusing && <li className="text-xs text-zinc-500">Покупки доступны на перерыве.</li>}
          {progress.upgrades.map((u) => (
            <li key={u.id} className={`${card} flex items-center gap-3`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-zinc-900">{u.title} <span className="font-normal text-zinc-500 tabular-nums">{u.level}/{u.maxLevel}</span></p>
                <p className="text-xs text-zinc-500">{u.description}</p>
              </div>
              <button
                type="button"
                disabled={u.maxed || u.locked || !u.canBuy || focusing}
                onClick={async () => { await t.call(() => client.buyUpgrade(u.id, u.level)); load(); }}
                className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium tabular-nums text-white transition-colors hover:bg-black disabled:bg-zinc-300 disabled:text-zinc-500"
              >
                {u.maxed ? "Максимум" : u.locked ? `с ур. ${u.minPlayerLevel}` : `${u.nextCost} монет`}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "achievements" && (
        <ul className="flex flex-col gap-2">
          {progress.achievements.map((a) => (
            <li key={a.id} className={`${card} ${a.unlocked ? "" : "opacity-50"}`}>
              <p className="font-medium text-zinc-900">{a.unlocked ? "● " : "○ "}{a.title} <span className="font-normal text-zinc-500">+{a.reward.coins}</span></p>
              <p className="text-xs text-zinc-500">{a.description}</p>
            </li>
          ))}
        </ul>
      )}

      {tab === "history" && (
        <ul className="flex flex-col gap-2">
          {sessions.length === 0 && <li className="text-sm text-zinc-500">Занятий пока нет.</li>}
          {sessions.map((s) => (
            <li key={s.id} className={card}>
              <p className="font-medium text-zinc-900">{s.task ?? "Без задачи"}{s.result && <span className="ml-2 font-normal text-zinc-500">· {RESULT_LABEL[s.result]}</span>}</p>
              <p className="text-xs text-zinc-500">
                {new Date(s.startedAt).toLocaleString()} · {SESSION_LABEL[s.status]}
                {s.rewarded ? ` · +${s.xp} XP, +${s.coins} монет` : " · без награды"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
