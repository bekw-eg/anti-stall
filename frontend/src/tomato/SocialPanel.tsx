import { useState } from "react";
import { CloudFog, Shield, Sparkles, Sticker } from "lucide-react";
import type { Member, SocialAction } from "@/api/tomato";
import { formatAgo, initials } from "./format";
import { ACTION_TEXT, KIND, disabledReason, type ActionType } from "./socialRules";
import { useNow } from "./useMedia";
import type { Tomato } from "./useTomato";

function ActionButton({ type, target, t, icon, label }: { type: ActionType; target: Member; t: Tomato; icon: React.ReactNode; label: string }) {
  const [busy, setBusy] = useState(false);
  const reason = disabledReason(type, target, t);
  const run = async () => {
    setBusy(true);
    const r = KIND[type] === "help" ? await t.help(target.userId, type as "boost" | "shield") : await t.prank(target.userId, type as "fog" | "sticker");
    setBusy(false);
    if (r) t.push(KIND[type] === "help" ? `${target.name}: ${ACTION_TEXT[type]} отправлен` : (r as { blocked?: boolean }).blocked ? `Щит ${target.name} отразил шутку` : `Шутка улетела: ${ACTION_TEXT[type]}`);
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

function FeedItem({ a, names, meId, now }: { a: SocialAction; names: Map<string, string>; meId?: string; now: number }) {
  const who = (id: string) => (id === meId ? "вы" : names.get(id) ?? "игрок");
  const verb = a.kind === "help" ? (a.type === "shield" ? "подарил(а) щит" : "дал(а) бонус к XP") : a.status === "blocked" ? `пошутил(а) (${ACTION_TEXT[a.type as ActionType]}) — щит отразил` : `отправил(а) ${ACTION_TEXT[a.type as ActionType]}`;
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 text-[var(--fg)]"><b className="font-medium">{who(a.fromUserId)}</b> {verb} → <b className="font-medium">{who(a.toUserId)}</b></span>
      <span className="shrink-0 text-[var(--muted)]">{formatAgo(a.at, now)}</span>
    </li>
  );
}

/** Помощь и шутки: действия на перерыве, свои эффекты, переключатель, лента комнаты. */
export function SocialPanel({ t }: { t: Tomato }) {
  useNow(5000);
  const snap = t.snapshot!;
  const me = snap.me;
  const onBreak = snap.room.phase === "break";
  const others = snap.members.filter((m) => m.userId !== me?.userId);
  const names = new Map(snap.members.map((m) => [m.userId, m.name]));
  const now = t.serverNow();
  const [savingToggle, setSavingToggle] = useState(false);

  return (
    <div className="grid h-full gap-6 overflow-y-auto p-5 sm:p-6 lg:grid-cols-[1fr_20rem]" data-testid="social-panel">
      <section aria-labelledby="friends-h" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="friends-h" className="text-sm font-semibold uppercase tracking-[0.2em]">Друзья</h2>
          <p className="text-xs text-[var(--muted)]" data-testid="social-phase-note">
            {onBreak ? `Перерыв: помогите другу или подшутите — до ${t.prankRules.maxPerBreak} шуток, не чаще раза в ${Math.max(1, Math.round((snap.room.demo ? t.prankRules.demoCooldownMs : t.prankRules.cooldownMs) / 1000))} с` : "Сейчас все занимаются — помощь и шутки откроются на перерыве"}
          </p>
        </div>
        {others.length === 0 && <p className="text-sm text-[var(--muted)]">Пока вы одни в комнате — позовите друзей по ссылке.</p>}
        <ul className="flex flex-col gap-2">
          {others.map((m) => (
            <li key={m.userId} className="flex flex-col gap-3 rounded-2xl bg-[var(--card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-member={m.userId}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white">{initials(m.name)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}{(m.team === "A" || m.team === "B") && <span className="ml-2 text-xs text-[var(--muted)]">команда {m.team}</span>}</p>
                  <p className="text-xs text-[var(--muted)]">ур. {m.level}{!m.prankEnabled && " · шутки выключены"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ActionButton type="boost" target={m} t={t} icon={<Sparkles size={13} />} label="Бонус к XP" />
                <ActionButton type="shield" target={m} t={t} icon={<Shield size={13} />} label={`Щит · ${t.shieldCost}`} />
                <ActionButton type="fog" target={m} t={t} icon={<CloudFog size={13} />} label="Туман" />
                <ActionButton type="sticker" target={m} t={t} icon={<Sticker size={13} />} label="Стикер" />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
          Бонус: +{t.boostPct}% XP за следующую сессию друга. Щит отражает одну шутку. Шутки длятся несколько секунд, заканчиваются вместе с перерывом и не трогают ни таймер, ни награды.
        </p>
      </section>

      <aside className="flex min-w-0 flex-col gap-5">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Ваши эффекты</h3>
          {me && me.effects.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="my-effects">
              {me.effects.map((e) => (
                <li key={e.id} className="flex items-center gap-2 rounded-xl bg-[var(--card)] px-3 py-2">
                  {e.kind === "boost" ? <Sparkles size={14} /> : <Shield size={14} />}
                  <span>{e.kind === "boost" ? "Бонус к XP — сработает в следующей сессии" : "Щит — отразит одну шутку"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]" data-testid="my-effects">Активных эффектов нет</p>
          )}
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-[var(--card)] px-4 py-3 text-sm">
          <span>
            <span className="block font-medium">Получать шуточные эффекты</span>
            <span className="text-xs text-[var(--muted)]">Если выключить, отправлять их тоже нельзя</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            data-testid="pranks-toggle"
            className="mt-1 h-4 w-4 shrink-0 accent-zinc-900"
            checked={me?.prankEnabled ?? true}
            disabled={savingToggle}
            onChange={async (e) => { setSavingToggle(true); await t.setPranksEnabled(e.target.checked); setSavingToggle(false); }}
          />
        </label>

        <div className="min-h-0">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Лента комнаты</h3>
          {t.feed.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Пока тихо</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="social-feed">
              {t.feed.slice(0, 12).map((a) => <FeedItem key={a.id} a={a} names={names} meId={me?.userId} now={now} />)}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
