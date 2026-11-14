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

/**
 * Карта по новым правилам Tower Wars: узлы открывают победы в TD (requiredPoints = число побед),
 * points — пройденные узлы, goal = 4; у сервера есть очки вклада и казна команды.
 */
export function makeTdRoad(wins: number, over: Partial<Roadmap> = {}): Roadmap {
  const nodes = BASE_NODES.map((n, i) => ({
    ...n,
    requiredPoints: i,
    challenge: i === 0 ? null : { kind: "td_stage_win" as const, stageId: BASE_NODES[i - 1].id },
    status: (i < wins ? "completed" : i === wins ? "current" : i === wins + 1 ? "next" : "locked") as RoadmapNode["status"],
  }));
  const next = nodes[wins + 1];
  return makeRoad(0, {
    points: wins, goal: 4, focusPoints: 7, treasuryCoins: 42, positionNodeId: nodes[Math.min(wins, 3)].id, nodes,
    teams: [{ key: "shared", name: "Команда", points: wins, positionNodeId: nodes[Math.min(wins, 3)].id, finished: wins >= 4, completed: false }],
    next: next ? { nodeId: next.id, title: next.title, pointsNeeded: 1, stageId: nodes[wins].id } : null,
    ...over,
  });
}

// ---------------------------------------------------------------------------- Tower Defense
import type { TdEnemy, TdRound, TdView } from "@/api/tomato";

export function makeEnemy(over: Partial<TdEnemy> & Pick<TdEnemy, "id">): TdEnemy {
  return { type: "runner", x: 1, y: 1.5, s: 0.5, hp: 36, maxHp: 36, speed: 1.4, slowed: false, hasted: false, armor: 0, isMerc: false, ...over };
}

export const TD_SLOTS = [
  { id: "s1", x: 2.5, y: 2.5 }, { id: "s2", x: 2.5, y: 0.5 }, { id: "s3", x: 5.5, y: 2.5 }, { id: "s4", x: 3.5, y: 3.5 },
];

export function makeTdRound(over: Partial<TdRound> = {}): TdRound {
  return {
    id: "r1", team: "shared", roundNo: 1, stageId: "camp", status: "running", current: true, startedAt: 0, endsAt: 300_000, finishedAt: null, speed: 1,
    t: 10, wave: 1, waves: 2, spawned: 3, total: 7, hp: 100, hpMax: 100, kills: 1, leaked: 0, enemies: [], shots: [], effects: [], result: null, ...over,
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
    me: { userId: "me", coins: 3, participated: false }, // личные монеты — не для игры: платит казна
    treasuryCoins: 40,
    mercenaries: [
      { id: "cherry", title: "Черри-бегун", description: "Крошечный и шустрый", cost: 2, hp: 30, speed: 1.6, damage: 3, armor: 0 },
      { id: "ripe", title: "Спелый томат", description: "Давит числом", cost: 5, hp: 95, speed: 1.05, damage: 7, armor: 0 },
      { id: "armored", title: "Броне-томат в каске", description: "Каска гасит четверть урона", cost: 12, hp: 280, speed: 0.65, damage: 15, armor: 0.25 },
      { id: "king", title: "Томат-Дредноут", description: "Ходячая крепость", cost: 25, hp: 900, speed: 0.5, damage: 30, armor: 0.35 },
    ],
    spells: [
      { id: "haste", title: "Гипер-жабры", description: "Башни стреляют чаще", cost: 10, duration: 6, target: "self" },
      { id: "repair", title: "Регенерация базы", description: "+20 HP и щит", cost: 12, duration: 5, target: "self" },
      { id: "slow_towers", title: "Сонная пыльца", description: "Башни соперника медленнее", cost: 10, duration: 6, target: "rival" },
      { id: "disable_tower", title: "Кетчуп-заморозка", description: "Лучшая башня соперника молчит", cost: 14, duration: 5, target: "rival" },
      { id: "enrage_horde", title: "Ярость Томатов", description: "Враги соперника быстрее", cost: 12, duration: 5, target: "rival" },
    ],
    mercCooldownSec: 0.8,
    rematch: { available: false, reason: null, roundNo: 1, counterattackCoins: 40, bonusTeam: null },
    ...over,
  };
}
