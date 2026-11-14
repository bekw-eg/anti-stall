import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Castle, Check, Flag, Lock } from "lucide-react";
import type { Roadmap, RoadmapNode } from "@/api/tomato";
import { NODE_STATUS_LABEL, defaultNode, edgeFill, isTdRoad, nodeById } from "./roadmapGeometry";

const TEAM_DOT: Record<string, string> = { A: "#EAA695", B: "#D9DE9F", shared: "#EAA695" };
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

/**
 * Интерактивная Road Map. Всё состояние (позиция, пройденные/закрытые этапы, доли пути, вклад)
 * приходит с сервера в `road`; здесь нет ни логики продвижения, ни собственных очков.
 * Маркер плавно переезжает, когда сервер меняет `positionNodeId`.
 * Во время Focus ничего не пульсирует: анимируются только изменения состояния.
 */
export function RoadMap({ road, meId }: { road: Roadmap; meId?: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  // left/top и pathLength не относятся к «transform»-анимациям, поэтому MotionConfig их не отключает — делаем это сами
  const reduce = useReducedMotion();
  const instant = { duration: 0 };
  const selected = nodeById(road, picked ?? "") ?? defaultNode(road);
  const pct = Math.min(100, (road.points / road.goal) * 100);
  const tdRules = isTdRoad(road);
  const nextText = road.next ? (road.next.stageId ? `До «${road.next.title}»: победа на этапе «${stageName(road, road.next.stageId)}»` : `До «${road.next.title}»: ещё ${road.next.pointsNeeded}`) : null;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-3 sm:p-5 lg:flex-row lg:overflow-hidden" aria-label={`Road Map: ${road.title}`}>
      {/* Карта — «доска» в стиле лендинга: толстая дорога, крупные жетоны этапов, флажки команд над узлом */}
      <div className="relative min-h-[19rem] flex-1 overflow-hidden rounded-[28px] border-2 border-ink bg-rose shadow-[0_6px_0_#3B2422] lg:min-h-0">
        <div className="pointer-events-none absolute inset-0 opacity-30" aria-hidden style={{ backgroundImage: "radial-gradient(#7A504B 1.5px, transparent 1.5px)", backgroundSize: "22px 22px" }} />
        <div className="absolute inset-x-[9%] bottom-[16%] top-[20%]">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {road.edges.map(([a, b]) => {
              const na = nodeById(road, a)!, nb = nodeById(road, b)!;
              const fill = edgeFill(road, a, b);
              const common = { x1: na.x * 100, y1: na.y * 100, x2: nb.x * 100, y2: nb.y * 100, vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const };
              return (
                <g key={`${a}-${b}`}>
                  <line {...common} stroke="#7A504B" strokeWidth={18} />
                  <line {...common} stroke="#FFCEC2" strokeOpacity={0.9} strokeWidth={5} strokeDasharray="1 14" />
                  <motion.line {...common} stroke="#EAA695" strokeWidth={12} initial={false} animate={{ pathLength: fill }} transition={reduce ? instant : { duration: 0.9, ease: "easeInOut" }} />
                </g>
              );
            })}
          </svg>

          {road.nodes.map((n, i) => {
            const isSel = selected.id === n.id;
            const boss = n.type === "boss";
            const tone = n.status === "completed" ? "border-ink bg-peach text-ink" : n.status === "current" ? "border-ink bg-cream text-ink" : n.status === "next" ? "border-dashed border-cream bg-rose text-cream" : "border-[#7A504B] bg-[#8E625D] text-[#D8BDB6]";
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setPicked(n.id)}
                aria-label={`${n.title}: ${NODE_STATUS_LABEL[n.status]}, ${requirementShort(road, n)}`}
                aria-pressed={isSel}
                className="group absolute z-[1] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 focus-visible:outline-none"
                style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
              >
                <span
                  className={`flex items-center justify-center rounded-full border-[3px] transition-[transform,background-color] duration-300 group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-cream ${boss ? "h-14 w-14 sm:h-16 sm:w-16" : "h-11 w-11 sm:h-12 sm:w-12"} ${tone} ${isSel ? "ring-4 ring-cream/80" : ""} ${n.status === "current" ? "shadow-[0_4px_0_#3B2422]" : ""}`}
                >
                  {n.status === "completed" ? <Check size={boss ? 26 : 22} strokeWidth={3} aria-hidden />
                    : n.status === "current" ? <Flag size={boss ? 24 : 20} strokeWidth={2.6} aria-hidden />
                    : n.status === "locked" ? (boss ? <Castle size={24} aria-hidden /> : <Lock size={18} aria-hidden />)
                    : boss ? <Castle size={24} aria-hidden /> : <span className="font-display text-lg leading-none"><span className="relative top-0.5">{i + 1}</span></span>}
                </span>
                <span className={`max-w-[7.5rem] whitespace-normal rounded-full px-2.5 py-0.5 text-center text-xs font-extrabold leading-tight sm:text-[13px] ${n.status === "locked" ? "bg-[#8E625D] text-[#F3E1DC]" : "border-2 border-ink bg-white text-ink"}`}>{n.title}</span>
              </button>
            );
          })}

          {/* Флажки команд: переезжают по серверной позиции. Две команды на одном узле расходятся в стороны. */}
          {road.teams.map((team) => {
            const at = nodeById(road, team.positionNodeId);
            if (!at) return null;
            const same = road.teams.filter((x) => x.positionNodeId === team.positionNodeId);
            const offset = (same.indexOf(team) - (same.length - 1) / 2) * 64;
            const mine = team.key === road.teamKey;
            return (
              <motion.div
                key={team.key}
                data-testid={`marker-${team.key}`}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                initial={false}
                animate={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                transition={reduce ? instant : MARKER_SPRING}
                aria-hidden
              >
                <span className="relative -top-12 flex flex-col items-center sm:-top-14" style={{ marginLeft: offset }}>
                  <span title={team.name} className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-ink px-2 py-1 text-xs font-extrabold shadow-[0_3px_0_#3B2422] ${mine ? "bg-ink text-cream" : "bg-white text-ink"}`}>
                    <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current" style={{ background: TEAM_DOT[team.key] ?? "#EAA695" }} />
                    {road.mode === "teams" ? `${team.key}${mine ? " · мы" : ""}` : "Мы"}
                  </span>
                  <span className="h-3 w-0.5 bg-ink" />
                </span>
              </motion.div>
            );
          })}
        </div>
        <p className="absolute bottom-3 left-4 right-4 text-center text-xs font-bold text-[#F3E1DC] sm:text-[13px]">Нажмите на этап, чтобы узнать, как его открыть</p>
      </div>

      {/* Подробности: этап, прогресс общего испытания, вклад участников */}
      <aside className="flex shrink-0 flex-col gap-4 overflow-y-auto rounded-[24px] border-2 border-soft bg-[var(--card)] p-4 text-sm text-[var(--fg)] sm:p-5 lg:w-80">
        <div>
          <p className="text-[15px] font-bold text-[var(--muted)]">{NODE_STATUS_LABEL[selected.status]}</p>
          <p className="mt-1 font-display text-2xl leading-tight"><span className="relative top-0.5">{selected.title}</span></p>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            {requirementLong(road, selected)}
            {selected.reward && ` · награда ${selected.reward.xp} XP, ${selected.reward.coins} монет`}
            {selected.reachedAt && ` · пройден ${new Date(selected.reachedAt).toLocaleTimeString()}`}
          </p>
        </div>

        {road.winner && (
          <p role="status" className="rounded-xl bg-[var(--fg)] px-3 py-2 text-xs font-medium text-[var(--field)]">
            {road.winner === "draw" ? "Ничья: обе команды достигли цели" : road.mode === "teams" ? `Победила команда ${road.winner}${road.winner === road.teamKey ? " — это вы" : ""}` : "Цель достигнута"}
          </p>
        )}

        <div>
          {road.mode === "teams" ? (
            <ul className="flex flex-col gap-2.5">
              {road.teams.map((team) => (
                <li key={team.key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className={team.key === road.teamKey ? "font-medium" : "text-[var(--muted)]"}>{team.name}{team.key === road.teamKey && " (вы)"}</span>
                    <span className="tabular-nums text-[var(--muted)]">{team.points}/{road.goal}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]" role="progressbar" aria-label={team.name} aria-valuenow={team.points} aria-valuemin={0} aria-valuemax={road.goal}>
                    <motion.div className="h-full rounded-full bg-[var(--fg)]" initial={false} animate={{ width: `${Math.min(100, (team.points / road.goal) * 100)}%` }} transition={reduce ? instant : { duration: 0.8 }} />
                  </div>
                </li>
              ))}
              {road.next && <p className="text-xs text-[var(--muted)]">Вашей команде {nextText!.replace(/^До/, "до")}</p>}
            </ul>
          ) : (
            <>
              <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
                <span>{road.completed ? "Цель достигнута" : nextText ?? road.title}</span>
                <span className="tabular-nums">{road.points}/{road.goal}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={road.points} aria-valuemin={0} aria-valuemax={road.goal}>
                <motion.div className="h-full rounded-full bg-[var(--fg)]" initial={false} animate={{ width: `${pct}%` }} transition={reduce ? instant : { duration: 0.8 }} />
              </div>
            </>
          )}
          {tdRules ? (
            <>
              <p className="mt-2 text-xs text-[var(--muted)]">Узлы карты открывают победы в Tower Defense на перерыве. Фокус-сессии дают очки вклада и пополняют казну команды — это проверяет сервер.</p>
              {(typeof road.focusPoints === "number" || typeof road.treasuryCoins === "number") && (
                <p className="mt-1 flex justify-between text-xs" data-testid="road-team-stats">
                  {typeof road.focusPoints === "number" && <span>Очки вклада: <span className="tabular-nums">{road.focusPoints}</span></span>}
                  {typeof road.treasuryCoins === "number" && <span>Казна: <span className="tabular-nums">{road.treasuryCoins}🪙</span></span>}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">Очко команде даёт каждая завершённая фокус-сессия — это проверяет сервер.</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[15px] font-bold text-[var(--muted)]">Вклад</p>
          {road.contributions.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Пока никто не внёс очков.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {road.contributions.map((c) => (
                <li key={c.userId} className="flex justify-between text-xs">
                  <span className="truncate">{c.name}{c.team && ` · ${c.team}`}{c.userId === meId && " (вы)"}</span>
                  <span className="tabular-nums">{c.points}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
