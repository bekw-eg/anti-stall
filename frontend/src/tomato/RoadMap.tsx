import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Castle, Check, Flag, Lock } from "lucide-react";
import type { Roadmap, RoadmapNode } from "@/api/tomato";
import { NODE_STATUS_LABEL, defaultNode, edgeFill, isTdRoad, nodeById } from "./roadmapGeometry";
import { SeedIcon } from "./screens/ui";
import { TEAM_COLOR, teamTitle } from "./socialRules";

const MARKER_SPRING = { type: "spring", stiffness: 90, damping: 18, mass: 1 } as const;
/** Название этапа TD: этапы привязаны к узлам карты (id этапа = id узла) */
const stageName = (road: Roadmap, stageId: string) => road.nodes.find((n) => n.id === stageId)?.title ?? stageId;
/** Условие узла коротко — для подписи кнопки */
function requirementShort(road: Roadmap, n: RoadmapNode) {
  if (n.challenge?.kind === "td_stage_win") return `победа в обороне «${stageName(road, n.challenge.stageId)}»`;
  return `${n.requiredPoints} очков`;
}
/** Условие узла подробно — для карточки этапа */
function requirementLong(road: Roadmap, n: RoadmapNode) {
  if (n.type === "start") return "Отсюда начинался путь";
  if (n.challenge?.kind === "td_stage_win") return `Откроет победа в Tower Defense на этапе «${stageName(road, n.challenge.stageId)}»`;
  return `Нужно командных очков: ${n.requiredPoints}`;
}

/** Узел-«шайба» на доске: пройденный — объёмная, текущий — крупнее с флажком, следующий — мигает, закрытый — контур. */
function NodeToken({ n, here, next }: { n: RoadmapNode; here: boolean; next: boolean }) {
  const done = n.status === "completed" || n.status === "current";
  const goal = n.type === "boss";
  if (here) {
    return (
      <span className="relative flex items-center justify-center">
        <span className="absolute h-[4.5rem] w-[4.5rem] rounded-full border-2 border-dashed border-cream/80 sm:h-24 sm:w-24" aria-hidden />
        <span className="relative h-10 w-14 rounded-[50%] bg-peach shadow-[0_6px_0_#6E4641] sm:h-12 sm:w-[4.25rem]">
          <span className="absolute left-1/2 top-1.5 h-2.5 w-7 -translate-x-1/2 rounded-[50%] bg-blush/80" aria-hidden />
        </span>
        <Flag className="absolute -top-7 left-1/2 h-7 w-7 -translate-x-[15%] fill-cream text-ink sm:-top-8 sm:h-8 sm:w-8" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (done) {
    return (
      <span className="relative flex h-8 w-11 items-center justify-center rounded-[50%] bg-peach shadow-[0_5px_0_#6E4641] sm:h-9 sm:w-12">
        <span className="absolute left-1/2 top-1 h-2 w-6 -translate-x-1/2 rounded-[50%] bg-blush/80" aria-hidden />
        {goal ? <Castle size={18} className="relative text-ink" aria-hidden /> : <Check size={16} strokeWidth={3} className="relative mt-1 text-ink/70" aria-hidden />}
      </span>
    );
  }
  if (next) {
    return (
      <span className="as-blink flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-cream sm:h-12 sm:w-12" data-testid="next-node">
        {goal && <Castle size={20} className="text-ink" aria-hidden />}
      </span>
    );
  }
  return (
    <span className={`flex items-center justify-center rounded-full border-2 border-blush/60 ${goal ? "h-11 w-11 bg-blush/90 sm:h-12 sm:w-12" : "h-8 w-8 sm:h-9 sm:w-9"}`}>
      {goal ? <Castle size={20} className="text-ink" aria-hidden /> : <Lock size={13} className="text-blush/70" aria-hidden />}
    </span>
  );
}

/**
 * Карта команды — «доска»: узлы-шайбы на дороге, флажок там, где команда сейчас, следующий этап мигает.
 * Всё состояние (позиция, пройденные/закрытые этапы, доли пути, вклад) приходит с сервера в `road`.
 * Маркеры команд плавно переезжают, когда сервер меняет `positionNodeId`.
 */
export function RoadMap({ road, meId }: { road: Roadmap; meId?: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const instant = { duration: 0 };
  const selected = nodeById(road, picked ?? "") ?? defaultNode(road);
  const pct = Math.min(100, (road.points / road.goal) * 100);
  const tdRules = isTdRoad(road);
  const nextText = road.next ? (road.next.stageId ? `До «${road.next.title}»: победа на этапе «${stageName(road, road.next.stageId)}»` : `До «${road.next.title}»: ещё ${road.next.pointsNeeded}`) : null;
  const myTeam = road.teams.find((t) => t.key === road.teamKey) ?? road.teams[0];
  const hereId = myTeam?.positionNodeId;
  const nextId = road.next?.nodeId;
  const cleared = road.nodes.filter((n) => n.status === "completed" || n.status === "current").length;
  const levelNo = Math.max(1, road.nodes.findIndex((n) => n.id === hereId) + 1);

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4 sm:p-6" aria-label={`Road Map: ${road.title}`}>
      {/* ---------- Доска ---------- */}
      <div className="relative sm:pt-4">
        <ul className="relative z-20 mb-3 flex flex-wrap gap-2 sm:absolute sm:inset-x-10 sm:top-0 sm:mb-0 sm:justify-between" aria-label="Обозначения">
          <li className="as-pill border-2 border-ink bg-white text-ink"><span className="h-2.5 w-2.5 rounded-full bg-peach" aria-hidden />пройдено {cleared}</li>
          <li className="as-pill border-2 border-ink bg-white text-ink"><Flag size={13} className="fill-ink" aria-hidden />вы здесь · уровень {levelNo} из {road.nodes.length}</li>
          <li className="as-pill hidden border-2 border-ink bg-white text-ink sm:inline-flex"><Castle size={13} aria-hidden />цель сезона</li>
        </ul>
        <div
          className="relative w-full overflow-hidden rounded-[40px] bg-rose [aspect-ratio:1.15/1] sm:rounded-full sm:[aspect-ratio:2.7/1]"
          style={{ backgroundImage: "radial-gradient(rgba(59,36,34,.22) 1.2px, transparent 1.6px)", backgroundSize: "34px 34px" }}
        >
          <div className="absolute inset-x-[7%] bottom-[16%] top-[24%]">
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {road.edges.map(([a, b]) => {
                const na = nodeById(road, a)!, nb = nodeById(road, b)!;
                const fill = edgeFill(road, a, b);
                const common = { x1: na.x * 100, y1: na.y * 100, x2: nb.x * 100, y2: nb.y * 100, vectorEffect: "non-scaling-stroke" as const };
                return (
                  <g key={`${a}-${b}`}>
                    <line {...common} stroke="#FFCEC2" strokeOpacity={0.45} strokeWidth={4} strokeDasharray={fill >= 1 ? undefined : "2 9"} strokeLinecap="round" />
                    <motion.line {...common} stroke="#FFCEC2" strokeWidth={5} strokeLinecap="round" initial={false} animate={{ pathLength: fill }} transition={reduce ? instant : { duration: 0.9, ease: "easeInOut" }} />
                  </g>
                );
              })}
            </svg>

            {road.nodes.map((n) => {
              const isSel = selected.id === n.id;
              const here = n.id === hereId;
              const next = n.id === nextId;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setPicked(n.id)}
                  aria-label={`${n.title}: ${NODE_STATUS_LABEL[n.status]}, ${requirementShort(road, n)}`}
                  aria-pressed={isSel}
                  className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-2xl focus-visible:outline-none"
                  style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
                >
                  <span className={`rounded-full transition-transform group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-cream ${isSel ? "ring-2 ring-cream ring-offset-4 ring-offset-rose" : ""}`}>
                    <NodeToken n={n} here={here} next={next} />
                  </span>
                  <span className={`${here ? "mt-3 sm:mt-5" : ""} max-w-[6.5rem] whitespace-nowrap text-center text-[11px] font-extrabold leading-tight sm:max-w-none sm:text-sm ${n.status === "locked" && !next ? "text-cream/60" : "text-cream"}`}>
                    {n.title}
                    {next && <span className="ml-1 hidden rounded-full bg-cream px-1.5 py-px text-[10px] font-extrabold text-ink sm:inline">дальше</span>}
                  </span>
                </button>
              );
            })}

            {/* Маркеры команд: переезжают по серверной позиции. Две команды на одном узле расходятся в стороны. */}
            {road.teams.map((team) => {
              const at = nodeById(road, team.positionNodeId);
              if (!at) return null;
              const same = road.teams.filter((x) => x.positionNodeId === team.positionNodeId);
              const offset = (same.indexOf(team) - (same.length - 1) / 2) * 60;
              const mine = team.key === road.teamKey || road.mode !== "teams";
              const label = road.mode === "teams" ? `${teamTitle(team.key)}${mine ? " · мы" : ""}` : "Мы";
              return (
                <motion.div
                  key={team.key}
                  data-testid={`marker-${team.key}`}
                  className="pointer-events-none absolute z-10 -translate-x-1/2"
                  initial={false}
                  animate={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                  transition={reduce ? instant : MARKER_SPRING}
                  aria-hidden
                >
                  <span className={`relative flex flex-col items-center ${team.positionNodeId === hereId ? "-top-[5.75rem] sm:-top-[6.75rem]" : "-top-[3.75rem] sm:-top-[4.25rem]"}`} style={{ marginLeft: offset }}>
                    <span className={`whitespace-nowrap rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-extrabold sm:text-xs ${road.mode === "teams" ? "text-white" : mine ? "bg-ink text-cream" : "bg-white text-ink"}`} style={road.mode === "teams" ? { background: TEAM_COLOR[team.key] } : undefined}>{label}</span>
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------- Подробности: этап, прогресс, вклад ---------- */}
      <aside className="grid gap-3 text-sm text-ink sm:grid-cols-2">
        <section className="flex flex-col gap-1.5 rounded-[20px] bg-paper p-4">
          <p className="text-[13px] font-extrabold uppercase tracking-wide text-mute">{NODE_STATUS_LABEL[selected.status]}</p>
          <p className="font-display text-xl leading-tight"><span className="relative top-0.5">{selected.title}</span></p>
          <p className="text-[13px] text-mute">{requirementLong(road, selected)}</p>
          {selected.reward && (
            <p className="flex items-center gap-1.5 text-[13px] font-bold">награда {selected.reward.xp} XP, {selected.reward.coins} монет <SeedIcon className="h-4 w-4" /></p>
          )}
          {selected.reachedAt && <p className="text-xs text-mute">пройден {new Date(selected.reachedAt).toLocaleTimeString()}</p>}
          {road.winner && (
            <p role="status" className="mt-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-cream">
              {road.winner === "draw" ? "Ничья: обе команды достигли цели" : road.mode === "teams" ? `Победили ${teamTitle(road.winner).toLowerCase()}${road.winner === road.teamKey ? " — это вы" : ""}` : "Цель достигнута"}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2.5 rounded-[20px] bg-paper p-4">
          {road.mode === "teams" ? (
            <ul className="flex flex-col gap-2.5">
              {road.teams.map((team) => (
                <li key={team.key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className={team.key === road.teamKey ? "font-extrabold" : "text-mute"}>{team.name}{team.key === road.teamKey && " (вы)"}</span>
                    <span className="tabular-nums text-mute">{team.points}/{road.goal}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white" role="progressbar" aria-label={team.name} aria-valuenow={team.points} aria-valuemin={0} aria-valuemax={road.goal}>
                    <motion.div className={`h-full rounded-full ${team.key === road.teamKey ? "bg-peach" : "bg-line"}`} initial={false} animate={{ width: `${Math.min(100, (team.points / road.goal) * 100)}%` }} transition={reduce ? instant : { duration: 0.8 }} />
                  </div>
                </li>
              ))}
              {road.next && <p className="text-xs text-mute">Вашей команде {nextText!.replace(/^До/, "до")}</p>}
            </ul>
          ) : (
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-mute">
                <span>{road.completed ? "Цель достигнута" : nextText ?? road.title}</span>
                <span className="tabular-nums">{road.points}/{road.goal}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white" role="progressbar" aria-valuenow={road.points} aria-valuemin={0} aria-valuemax={road.goal}>
                <motion.div className="h-full rounded-full bg-peach" initial={false} animate={{ width: `${pct}%` }} transition={reduce ? instant : { duration: 0.8 }} />
              </div>
            </div>
          )}
          {tdRules ? (
            <>
              <p className="text-xs text-mute">Узлы карты открывают победы в Tower Defense на перерыве. Фокус-сессии пополняют казну команды.</p>
              {(typeof road.focusPoints === "number" || typeof road.treasuryCoins === "number") && (
                <p className="flex justify-between text-xs font-bold" data-testid="road-team-stats">
                  {typeof road.focusPoints === "number" && <span>Очки вклада: <span className="tabular-nums">{road.focusPoints}</span></span>}
                  {typeof road.treasuryCoins === "number" && <span className="inline-flex items-center gap-1">Казна: <span className="tabular-nums">{road.treasuryCoins}</span><SeedIcon className="h-3.5 w-3.5" /></span>}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-mute">Очко команде даёт каждая завершённая фокус-сессия — это проверяет сервер.</p>
          )}
          <div>
            <p className="mb-1 text-xs font-extrabold text-mute">Вклад</p>
            {road.contributions.length === 0 ? (
              <p className="text-xs text-mute">Пока никто не внёс очков.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {road.contributions.map((c) => (
                  <li key={c.userId} className="flex justify-between text-xs">
                    <span className="truncate">{c.name}{c.team && c.team !== "shared" && ` · ${teamTitle(c.team)}`}{c.userId === meId && " (вы)"}</span>
                    <span className="tabular-nums">{c.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
