import type { Roadmap, RoadmapNode } from "@/api/tomato";

/** Доля пройденного пути по ребру a→b (0..1). Считается только по очкам, пришедшим с сервера. */
export function edgeFill(road: Roadmap, from: string, to: string): number {
  const a = road.nodes.find((n) => n.id === from);
  const b = road.nodes.find((n) => n.id === to);
  if (!a || !b) return 0;
  if (road.points >= b.requiredPoints) return 1;
  if (road.points <= a.requiredPoints) return 0;
  return (road.points - a.requiredPoints) / (b.requiredPoints - a.requiredPoints);
}

/** Узел, о котором показываем подробности по умолчанию: следующий этап, а если цель достигнута — финальный. */
export function defaultNode(road: Roadmap): RoadmapNode {
  return road.nodes.find((n) => n.id === road.next?.nodeId) ?? road.nodes[road.nodes.length - 1];
}

export const nodeById = (road: Roadmap, id: string) => road.nodes.find((n) => n.id === id);

/** Подпись состояния узла для скринридеров и подсказок. */
export const NODE_STATUS_LABEL: Record<RoadmapNode["status"], string> = {
  completed: "пройден",
  current: "вы здесь",
  next: "следующий этап",
  locked: "закрыт",
};

/** Новые правила Tower Wars: узлы открывают победы в Tower Defense (сервер присылает challenge.kind = "td_stage_win"). */
export const isTdRoad = (road: Roadmap) => road.nodes.some((n) => n.challenge?.kind === "td_stage_win") || Boolean(road.next?.stageId);
