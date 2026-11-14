import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Roadmap, RoadmapNode } from "@/api/tomato";
import { NODE_STATUS_LABEL, defaultNode, edgeFill, isTdRoad, nodeById } from "./roadmapGeometry";

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
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-3 sm:p-5 lg:flex-row" aria-label={`Road Map: ${road.title}`}>
      {/* Карта */}
      <div className="relative min-h-[11rem] flex-1">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {road.edges.map(([a, b]) => {
            const na = nodeById(road, a)!, nb = nodeById(road, b)!;
            const fill = edgeFill(road, a, b);
            const common = { x1: na.x * 100, y1: na.y * 100, x2: nb.x * 100, y2: nb.y * 100, vectorEffect: "non-scaling-stroke" as const };
            return (
              <g key={`${a}-${b}`}>
                <line {...common} stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} strokeDasharray={fill >= 1 ? undefined : "2 6"} strokeLinecap="round" />
                <motion.line {...common} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" initial={false} animate={{ pathLength: fill }} transition={reduce ? instant : { duration: 0.9, ease: "easeInOut" }} />
              </g>
            );
          })}
        </svg>

        {road.nodes.map((n) => {
          const done = n.status === "completed" || n.status === "current";
          const isSel = selected.id === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setPicked(n.id)}
              aria-label={`${n.title}: ${NODE_STATUS_LABEL[n.status]}, ${requirementShort(road, n)}`}
              aria-pressed={isSel}
              className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 focus-visible:outline-none"
              style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
            >
              <span
                className={`flex items-center justify-center rounded-full border-2 transition-colors duration-500 group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-focus-visible:ring-[var(--fg)] ${n.type === "boss" ? "h-8 w-8 sm:h-10 sm:w-10" : "h-5 w-5 sm:h-7 sm:w-7"} ${
                  done ? "border-[var(--fg)] bg-[var(--fg)]" : n.status === "next" ? "border-[var(--fg)] border-dashed bg-transparent" : "border-[var(--line)] bg-transparent opacity-60"
                } ${isSel ? "ring-2 ring-[var(--fg)] ring-offset-2 ring-offset-transparent" : ""}`}
              >
                {n.type === "boss" && <span className={`h-2 w-2 rounded-full ${done ? "bg-[var(--field)]" : "bg-[var(--fg)]"}`} />}
              </span>
              <span className={`max-w-[6.5rem] text-center text-[11px] leading-tight sm:text-xs ${n.status === "locked" ? "text-[var(--muted)] opacity-70" : "text-[var(--fg)]"}`}>{n.title}</span>
            </button>
          );
        })}

        {/* Маркеры команд: переезжают по серверной позиции. Две команды на одном узле расходятся в стороны. */}
        {road.teams.map((team, i) => {
          const at = nodeById(road, team.positionNodeId);
          if (!at) return null;
          const same = road.teams.filter((x) => x.positionNodeId === team.positionNodeId);
          const offset = (same.indexOf(team) - (same.length - 1) / 2) * 64;
          const mine = team.key === road.teamKey;
          const filled = i === 0;
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
              <span className="relative -top-7 flex flex-col items-center sm:-top-9" style={{ marginLeft: offset }}>
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${filled ? "bg-[var(--fg)] text-[var(--field)]" : "border border-[var(--fg)] bg-[var(--field)] text-[var(--fg)]"} ${mine && road.mode === "teams" ? "ring-2 ring-[var(--fg)] ring-offset-1 ring-offset-transparent" : ""}`}>{team.name}</span>
                <span className="h-2 w-px bg-[var(--fg)]" />
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Подробности: этап, прогресс общего испытания, вклад участников */}
      <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--card)] p-4 text-sm text-[var(--fg)] lg:w-72">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{NODE_STATUS_LABEL[selected.status]}</p>
          <p className="mt-1 text-base font-medium">{selected.title}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
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
          <p className="mb-1.5 text-xs uppercase tracking-wider text-[var(--muted)]">Вклад</p>
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
