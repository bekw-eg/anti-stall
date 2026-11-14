import { useState } from "react";
import { CloudFog, Shield, Sparkles, Sticker } from "lucide-react";
import type { Member } from "@/api/tomato";
import { initials, memberStatusLabel } from "./format";
import { ACTION_TEXT, KIND, TEAM_COLOR, disabledReason, type ActionType } from "./socialRules";
import type { Tomato } from "./useTomato";

function ActionButton({ type, target, t, icon, label }: { type: ActionType; target: Member; t: Tomato; icon: React.ReactNode; label: string }) {
  const [busy, setBusy] = useState(false);
  const reason = disabledReason(type, target, t);
  const run = async () => {
    setBusy(true);
    const r = KIND[type] === "help" ? await t.help(target.userId, type as "boost" | "shield") : await t.prank(target.userId, type as "fog" | "sticker");
    setBusy(false);
    if (r) t.push(KIND[type] === "help" ? `${target.name}: ${ACTION_TEXT[type]} отправлен` : (r as { blocked?: boolean }).blocked ? "Щит соперника отразил шутку" : `Шутка улетела: ${ACTION_TEXT[type]}`);
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || reason !== null}
      title={reason ?? undefined}
      aria-label={`${label} — ${target.name}${reason ? ` (${reason})` : ""}`}
      data-action={type}
      className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
    >
      {icon} {label}
    </button>
  );
}

/**
 * «Друзья» — просто список людей комнаты, разбитый по цветам команд. На перерыве у строк появляются действия:
 * своей команде — бафф (бонус, щит), команде соперника — дебафф (туман, липучка). Выключить шутки нельзя:
 * это игровая механика перерыва, в фокус она не попадает.
 */
export function SocialPanel({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const me = snap.me;
  const onBreak = snap.room.phase === "break";
  const teams = snap.room.mode === "teams";
  const groups = teams
    ? (["A", "B"] as const).map((k) => ({ key: k, title: `Команда ${k}`, members: snap.members.filter((m) => m.team === k) }))
    : [{ key: "shared", title: "Комната", members: snap.members }];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5 sm:p-6" data-testid="social-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">Друзья · {snap.members.length}</h2>
        <p className="text-xs text-[var(--muted)]" data-testid="social-phase-note">
          {onBreak
            ? teams ? "Перерыв: бафф своим, дебафф соперникам — шутки ослабляют башни их команды" : "Перерыв: помогите другу или подшутите"
            : snap.room.phase === "focus" ? "Сейчас фокус — баффы и шутки откроются на перерыве" : "Баффы и шутки откроются на перерыве"}
        </p>
      </div>

      <div className="grid gap-3">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title} className="rounded-2xl bg-[var(--card)] px-4 py-3" style={{ borderLeft: `5px solid ${TEAM_COLOR[g.key] ?? TEAM_COLOR.shared}` }} data-team={g.key}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="h-3 w-3 rounded-full" style={{ background: TEAM_COLOR[g.key] ?? TEAM_COLOR.shared }} />
              {g.title}{teams && me?.team === g.key && <span className="text-xs font-normal text-[var(--muted)]">· ваша</span>}
            </h3>
            {g.members.length === 0 && <p className="text-xs text-[var(--muted)]">Пока никого</p>}
            <ul className="flex flex-col gap-2">
              {g.members.map((m) => {
                const mine = m.userId === me?.userId;
                const ally = !teams || m.team === me?.team;
                return (
                  <li key={m.userId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-member={m.userId}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-zinc-900" style={{ background: TEAM_COLOR[m.team] ?? TEAM_COLOR.shared }}>{initials(m.name)}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.name}{mine && " (вы)"}</p>
                        <p className="text-xs text-[var(--muted)]">
                          ур. {m.level} · {memberStatusLabel(m, false)}
                          {mine && me && me.effects.length > 0 && <span data-testid="my-effects"> · {me.effects.map((e) => (e.kind === "boost" ? "бонус к XP" : "щит")).join(", ")}</span>}
                        </p>
                      </div>
                    </div>
                    {onBreak && !mine && (
                      <div className="flex flex-wrap gap-1.5">
                        {ally && <ActionButton type="boost" target={m} t={t} icon={<Sparkles size={13} />} label="Бонус к XP" />}
                        {ally && <ActionButton type="shield" target={m} t={t} icon={<Shield size={13} />} label={`Щит · ${t.shieldCost}`} />}
                        {(!teams || !ally) && <ActionButton type="fog" target={m} t={t} icon={<CloudFog size={13} />} label="Туман" />}
                        {(!teams || !ally) && <ActionButton type="sticker" target={m} t={t} icon={<Sticker size={13} />} label="Липучка" />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Бонус: +{t.boostPct}% опыта за следующую сессию. Щит отражает одну шутку.
        {teams ? " Туман и липучка ослабляют башни соперника до конца перерыва." : " Шутки действуют до конца перерыва."} Не больше {t.prankRules.maxPerBreak} за перерыв.
      </p>
    </div>
  );
}
