/**
 * Прогресс общей цели на главном экране комнаты (кейс §7: «какой прогресс достигнут по общей цели»):
 * сколько этапов карты пройдено, что следующее и вклад игрока фокус-сессиями. Подробно — в панели «Карта».
 */
import { Flag, Trophy } from "lucide-react";
import { TEAM_COLOR, teamTitle } from "../socialRules";
import type { Tomato } from "../useTomato";

export function GoalProgress({ t, dark = false, compact = false }: { t: Tomato; dark?: boolean; compact?: boolean }) {
  const snap = t.snapshot;
  if (!snap) return null;
  const road = snap.challenge;
  const meId = snap.me?.userId;
  const mine = road.contributions.find((c) => c.userId === meId)?.points ?? 0;
  const teams = road.mode === "teams";
  const rival = teams ? road.teams.find((x) => x.key !== road.teamKey) : undefined;
  const pct = road.goal ? Math.min(100, (road.points / road.goal) * 100) : 0;
  const fill = teams ? TEAM_COLOR[road.teamKey] ?? "#EAA695" : "#EAA695";
  const tone = dark
    ? { box: "border-[#6A4A45] bg-[#46302D] text-cream", mute: "text-[#D8BDB6]", track: "border-[#6A4A45] bg-[#2A1817]" }
    : { box: "border-ink bg-white text-ink as-shadow-sm", mute: "text-mute", track: "border-ink bg-soft" };
  const done = road.completed || road.finished;
  const plural = mine % 10 === 1 && mine % 100 !== 11 ? "сессия" : mine % 10 >= 2 && mine % 10 <= 4 && (mine % 100 < 10 || mine % 100 >= 20) ? "сессии" : "сессий";
  // на фокусе — маленькая плашка: цифра, тонкая полоска и вклад, без лишнего текста
  if (compact) {
    return (
      <section aria-label="Цель команды" data-testid="goal-progress" className={`flex w-full max-w-[15rem] flex-col gap-1.5 rounded-[16px] border-2 px-3 py-2 ${tone.box}`}>
        <p className="flex items-center justify-between gap-2 text-[13px] font-extrabold">
          <span className="flex items-center gap-1.5">{done ? <Trophy size={13} aria-hidden /> : <Flag size={13} aria-hidden />}Цель</span>
          <span className="font-display text-base leading-none tabular-nums" data-testid="goal-points"><span className="relative top-0.5">{road.points}/{road.goal}</span></span>
        </p>
        <div className={`h-2 overflow-hidden rounded-full border ${tone.track}`} role="progressbar" aria-label="Прогресс общей цели" aria-valuenow={road.points} aria-valuemin={0} aria-valuemax={road.goal}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
        </div>
        <p className={`truncate text-xs font-bold ${tone.mute}`}>вклад: {mine} {plural}</p>
      </section>
    );
  }
  return (
    <section aria-label="Цель команды" data-testid="goal-progress" className={`flex flex-col gap-2 rounded-[20px] border-2 p-3.5 ${tone.box}`}>
      <p className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold">
          {done ? <Trophy size={15} aria-hidden /> : <Flag size={15} aria-hidden />}
          <span className="truncate">{teams ? `Цель · ${teamTitle(road.teamKey)}` : "Цель команды"}</span>
        </span>
        <span className="shrink-0 font-display text-lg leading-none tabular-nums" data-testid="goal-points"><span className="relative top-0.5">{road.points}/{road.goal}</span></span>
      </p>
      <div className={`h-3 overflow-hidden rounded-full border-2 ${tone.track}`} role="progressbar" aria-label="Прогресс общей цели" aria-valuenow={road.points} aria-valuemin={0} aria-valuemax={road.goal}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: fill }} />
      </div>
      <p className={`text-[13px] font-bold leading-snug ${tone.mute}`}>
        {done ? "Крепость взята — цель достигнута" : road.next ? `Следующий этап — «${road.next.title}»` : "Последний этап — крепость"}
        {rival && <> · {teamTitle(rival.key)} {rival.points}/{road.goal}</>}
      </p>
      <p className={`text-[13px] font-bold ${tone.mute}`}>
        Ваш вклад: <b className={dark ? "text-cream" : "text-ink"}>{mine}</b> {plural}
        {typeof road.focusPoints === "number" && <> · команда: {road.focusPoints}</>}
      </p>
    </section>
  );
}
