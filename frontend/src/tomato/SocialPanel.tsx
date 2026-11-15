import { useEffect, useState } from "react";
import { FriendsTab } from "./FriendsTab";
import { Clock, CloudFog, Shield, Sparkles, Sticker, UserCheck, UserPlus } from "lucide-react";
import type { Member } from "@/api/tomato";
import { memberStatusLabel } from "./format";
import { Avatar } from "./screens/ui";
import { ACTION_TEXT, KIND, TEAM_COLOR, TEAM_TINT, TEAM_TITLE, disabledReason, type ActionType } from "./socialRules";
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
      className={`flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1.5 text-[13px] font-extrabold text-ink shadow-[0_3px_0_#3B2422] transition-[transform,box-shadow] active:translate-y-[2px] active:shadow-[0_1px_0_#3B2422] disabled:cursor-not-allowed disabled:border-line disabled:bg-white disabled:text-[#B8A39E] disabled:shadow-none ${KIND[type] === "help" ? "bg-[#EEF0D2] hover:bg-lime" : "bg-petal hover:bg-blush"}`}
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
  const [tab, setTab] = useState<"room" | "friends">("room");
  const incoming = t.friends?.incoming.length ?? 0;
  // свежий список друзей при открытии панели (онлайн-статусы меняются)
  const { loadFriends } = t;
  useEffect(() => { loadFriends(); }, [loadFriends]);
  return (
    <div className="flex min-h-full flex-col gap-4 bg-paper p-5 sm:p-6" data-testid="social-panel">
      <div className="flex rounded-[18px] border-2 border-ink bg-white p-1" role="tablist" aria-label="Люди">
        {([["room", `В комнате · ${t.snapshot!.members.length}`], ["friends", "Мои друзья"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`social-tab-${id}`}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-[14px] px-3 py-2.5 text-[15px] font-extrabold transition-colors ${tab === id ? "bg-peach text-ink" : "text-mute hover:text-ink"}`}>
            {label}
            {id === "friends" && incoming > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-ink bg-rose px-1.5 text-xs font-extrabold text-white" aria-label={`Заявок: ${incoming}`}>{incoming}</span>}
          </button>
        ))}
      </div>
      {tab === "room" ? <RoomPeople t={t} /> : <FriendsTab t={t} />}
    </div>
  );
}

/** Вкладка «В комнате»: люди комнаты по командам, баффы и шутки на перерыве, кнопка «В друзья». */
function RoomPeople({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const me = snap.me;
  const onBreak = snap.room.phase === "break";
  const teams = snap.room.mode === "teams";
  const groups = teams
    ? (["A", "B"] as const).map((k) => ({ key: k, title: TEAM_TITLE[k], members: snap.members.filter((m) => m.team === k) }))
    : [{ key: "shared", title: "Комната", members: snap.members }];

  return (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-2xl leading-none">В комнате · {snap.members.length}</h2>
        <p className={`flex items-start gap-2 rounded-[16px] border-2 px-3 py-2 text-sm font-bold ${onBreak ? "border-ink bg-lime text-ink" : "border-dashed border-rose bg-white text-mute"}`} data-testid="social-phase-note">
          <Sparkles size={16} className="mt-0.5 shrink-0" aria-hidden />
          {onBreak
            ? teams ? "Перерыв: бафф своим, дебафф соперникам — шутки ослабляют башни их команды" : "Перерыв: помогите другу или подшутите"
            : snap.room.phase === "focus" ? "Сейчас фокус — баффы и шутки откроются на перерыве" : "Баффы и шутки откроются на перерыве"}
        </p>
      </div>

      <div className="grid gap-4">
        {groups.map((g) => {
          const color = TEAM_COLOR[g.key] ?? TEAM_COLOR.shared;
          return (
            <section key={g.key} aria-label={g.title} className="overflow-hidden rounded-[24px] border-2 border-ink bg-white as-shadow-sm" data-team={g.key}>
              <h3 className={`flex items-center justify-between gap-2 border-b-2 border-ink px-4 py-2.5 font-display text-xl leading-none ${teams ? "text-white" : "text-ink"}`} style={{ background: color }}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="relative top-0.5 truncate">{g.title}</span>
                  {teams && me?.team === g.key && <span className="rounded-full border-2 border-ink bg-white px-2 py-0.5 font-sans text-xs font-extrabold text-ink">ваша</span>}
                </span>
                <span className={`font-sans text-sm font-extrabold ${teams ? "text-white/90" : "text-mute"}`}>{g.members.length}</span>
              </h3>
              {g.members.length === 0 && <p className="px-4 py-3 text-sm font-semibold text-mute">Пока никого</p>}
              <ul className="flex flex-col">
                {g.members.map((m, i) => {
                  const mine = m.userId === me?.userId;
                  const ally = !teams || m.team === me?.team;
                  return (
                    <li key={m.userId} className={`flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${i ? "border-t-2 border-soft" : ""}`} style={mine ? { background: TEAM_TINT[g.key] ?? TEAM_TINT.shared } : undefined} data-member={m.userId}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={m.name} id={m.userId} look={m.avatar} size={44} ring={teams ? color : "#3B2422"} />
                        <div className="min-w-0">
                          <p className="truncate font-extrabold leading-tight">{m.name}{mine && " (вы)"}</p>
                          <p className="text-sm font-semibold text-mute">
                            ур. {m.level} · {memberStatusLabel(m, false)}
                            {mine && me && me.effects.length > 0 && <span className="font-extrabold text-olive" data-testid="my-effects"> · {me.effects.map((e) => (e.kind === "boost" ? "бонус к XP" : "щит")).join(", ")}</span>}
                          </p>
                        </div>
                      </div>
                      {!mine && (
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <FriendButton t={t} userId={m.userId} name={m.name} />
                          {onBreak && ally && <ActionButton type="boost" target={m} t={t} icon={<Sparkles size={14} />} label="Бонус к XP" />}
                          {onBreak && ally && <ActionButton type="shield" target={m} t={t} icon={<Shield size={14} />} label={`Щит · ${t.shieldCost}`} />}
                          {onBreak && (!teams || !ally) && <ActionButton type="fog" target={m} t={t} icon={<CloudFog size={14} />} label="Туман" />}
                          {onBreak && (!teams || !ally) && <ActionButton type="sticker" target={m} t={t} icon={<Sticker size={14} />} label="Липучка" />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <ul className="grid gap-2 text-sm font-semibold text-mute xs:grid-cols-2">
        <li className="flex items-start gap-2 rounded-[16px] border-2 border-soft bg-white px-3 py-2"><Sparkles size={15} className="mt-0.5 shrink-0 text-olive" aria-hidden />Бонус: +{t.boostPct}% опыта за следующую сессию</li>
        <li className="flex items-start gap-2 rounded-[16px] border-2 border-soft bg-white px-3 py-2"><Shield size={15} className="mt-0.5 shrink-0 text-olive" aria-hidden />Щит отражает одну шутку</li>
        <li className="flex items-start gap-2 rounded-[16px] border-2 border-soft bg-white px-3 py-2 xs:col-span-2"><CloudFog size={15} className="mt-0.5 shrink-0 text-rose" aria-hidden />{teams ? "Туман и липучка ослабляют башни соперника до конца перерыва." : "Шутки действуют до конца перерыва."} Не больше {t.prankRules.maxPerBreak} за перерыв.</li>
      </ul>
    </>
  );
}

/** «В друзья» у участника комнаты: отправить заявку, принять встречную или показать, что уже друзья. */
function FriendButton({ t, userId, name }: { t: Tomato; userId: string; name: string }) {
  const rel = t.relations[userId];
  const [busy, setBusy] = useState(false);
  const pill = "inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[13px] font-extrabold";
  if (rel === "friend") return <span className={`${pill} border-olive bg-[#EEF0D2] text-olive`} data-friend={userId}><UserCheck size={14} aria-hidden />Друг</span>;
  if (rel === "outgoing") return <span className={`${pill} border-dashed border-line bg-white text-mute`} data-friend={userId}><Clock size={14} aria-hidden />Заявка отправлена</span>;
  const run = async () => { setBusy(true); await (rel === "incoming" ? t.friendAccept(userId) : t.friendAdd({ userId })); setBusy(false); };
  return (
    <button type="button" disabled={busy} onClick={run} data-friend={userId} aria-label={rel === "incoming" ? `Принять заявку: ${name}` : `Добавить в друзья: ${name}`}
      className={`${pill} border-ink bg-white text-ink shadow-[0_3px_0_#3B2422] hover:bg-blush active:translate-y-[2px] active:shadow-[0_1px_0_#3B2422] disabled:opacity-50`}>
      <UserPlus size={14} aria-hidden />{rel === "incoming" ? "Принять в друзья" : "В друзья"}
    </button>
  );
}
