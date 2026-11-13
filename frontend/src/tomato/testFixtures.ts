import type { Roadmap, RoadmapNode, RoadmapTeam } from "@/api/tomato";

/** Фикстуры для тестов карты. Форма совпадает с тем, что отдаёт backend (см. backend/docs/API.md). */
const node = (id: string, title: string, x: number, y: number, requiredPoints: number, type: RoadmapNode["type"]): RoadmapNode => ({
  id, title, x, y, requiredPoints, type, status: "locked", challenge: type === "start" ? null : { kind: "team_focus_points", required: requiredPoints },
  reachedAt: null, reward: type === "start" ? null : { xp: 25, coins: 10 }, progress: 0,
});

export const BASE_NODES: RoadmapNode[] = [
  node("camp", "Лагерь", 0.08, 0.72, 0, "start"),
  node("forest", "Лес знаний", 0.3, 0.38, 2, "focus_goal"),
  node("bridge", "Мост дедлайнов", 0.54, 0.66, 4, "focus_goal"),
  node("fortress", "Крепость экзамена", 0.82, 0.3, 6, "boss"),
];

const posOf = (points: number) => [...BASE_NODES].reverse().find((n) => points >= n.requiredPoints)!.id;

export function makeTeam(key: string, points: number, extra: Partial<RoadmapTeam> = {}): RoadmapTeam {
  return { key, name: key === "shared" ? "Команда" : `Команда ${key}`, points, positionNodeId: posOf(points), finished: points >= 6, completed: false, ...extra };
}

/** Карта глазами команды `teamKey` (как её считает сервер). */
export function makeRoad(points: number, over: Partial<Roadmap> = {}): Roadmap {
  const idx = BASE_NODES.findIndex((n) => n.id === posOf(points));
  const nextIdx = Math.min(idx + 1, BASE_NODES.length - 1);
  const finished = points >= 6;
  const nodes = BASE_NODES.map((n, i) => ({
    ...n,
    status: (i <= idx ? (i === idx && !finished ? "current" : "completed") : i === nextIdx ? "next" : "locked") as RoadmapNode["status"],
    reachedAt: i > 0 && i <= idx ? 1_700_000_000_000 + i : null,
  }));
  return {
    roadmapId: "forest-march", title: "Марш к крепости экзамена", mode: "shared", teamKey: "shared", points, goal: 6, completed: false, finished,
    winner: null, completedAt: null, reward: { xp: 150, coins: 60 }, positionNodeId: BASE_NODES[idx].id,
    next: finished ? null : { nodeId: BASE_NODES[nextIdx].id, title: BASE_NODES[nextIdx].title, pointsNeeded: BASE_NODES[nextIdx].requiredPoints - points },
    segment: null, teams: [makeTeam("shared", points)], nodes,
    edges: [["camp", "forest"], ["forest", "bridge"], ["bridge", "fortress"]], contributions: [], ...over,
  };
}
