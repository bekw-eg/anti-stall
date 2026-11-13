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

// ---------------------------------------------------------------------------- Tower Defense
import type { TdRound, TdView } from "@/api/tomato";

export const TD_SLOTS = [
  { id: "s1", x: 2.5, y: 2.5 }, { id: "s2", x: 2.5, y: 0.5 }, { id: "s3", x: 5.5, y: 2.5 }, { id: "s4", x: 3.5, y: 3.5 },
];

export function makeTdRound(over: Partial<TdRound> = {}): TdRound {
  return {
    id: "r1", team: "shared", stageId: "camp", status: "running", current: true, startedAt: 0, endsAt: 300_000, finishedAt: null, speed: 1,
    t: 10, wave: 1, waves: 2, spawned: 3, total: 7, hp: 100, hpMax: 100, kills: 1, leaked: 0, enemies: [], result: null, ...over,
  };
}

export function makeTd(over: Partial<TdView> = {}): TdView {
  return {
    enabled: true, phase: "break", mode: "shared", team: "shared", breakEndsAt: 300_000, serverTime: 0,
    map: { cols: 12, rows: 7, path: [[0.5, 1.5], [4.5, 1.5], [4.5, 4.5], [8.5, 4.5], [8.5, 2.5], [11.5, 2.5]], slots: TD_SLOTS, pathLength: 16 },
    towerTypes: [
      { id: "arrow", title: "Лучник", description: "Быстрые одиночные выстрелы", cost: 15, range: 2.6, damage: 12, cooldown: 0.6, upgradeCosts: [12, 18] },
      { id: "cannon", title: "Пушка", description: "Урон по площади", cost: 30, range: 2.2, damage: 30, cooldown: 1.6, splash: 1, upgradeCosts: [24, 36] },
      { id: "frost", title: "Мороз", description: "Замедляет врага", cost: 20, range: 2.4, damage: 3, cooldown: 0.9, upgradeCosts: [16, 24] },
    ],
    enemyTypes: [{ id: "runner", title: "Бегун", hp: 36, speed: 1.4, damage: 4 }],
    maxLevel: 3,
    stages: [
      { id: "camp", title: "Тренировочный рубеж", node: "camp", nodeTitle: "Лагерь", unlocked: true, reward: { xp: 8, coins: 6 }, waves: 2, enemies: 7, wins: 0, bestHpLeft: null },
      { id: "forest", title: "Оборона Леса знаний", node: "forest", nodeTitle: "Лес знаний", unlocked: true, reward: { xp: 20, coins: 12 }, waves: 3, enemies: 19, wins: 1, bestHpLeft: 90 },
      { id: "bridge", title: "Оборона Моста дедлайнов", node: "bridge", nodeTitle: "Мост дедлайнов", unlocked: false, reward: { xp: 30, coins: 18 }, waves: 3, enemies: 17, wins: 0, bestHpLeft: null },
    ],
    defaultStageId: "forest",
    base: { hpMax: 100, damageMult: 1, wallLevels: 0, powerLevels: 0 },
    towers: [{ slot: "s3", type: "arrow", level: 1, ownerId: "u2", ownerName: "Аня" }],
    round: null, rival: null, duel: null,
    me: { userId: "me", coins: 40, participated: false },
    ...over,
  };
}
