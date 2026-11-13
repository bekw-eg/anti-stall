/** Контракт Tomato backend (см. backend/docs/API.md). Не зависит от React и от дизайна. */

export type Phase = "waiting" | "focus" | "break" | "completed";
export type MemberStatus = "waiting" | "focusing" | "finished" | "aborted" | "abandoned" | "spectating" | "resting";
export type Connection = "online" | "reconnecting" | "offline";

export interface Member {
  userId: string;
  name: string;
  role: "host" | "member";
  level: number;
  team: string;
  isReady?: boolean;
  task: string | null;
  status: MemberStatus;
  connection: Connection;
  prankEnabled: boolean;
  contribution: number;
  session: { id: string; status: "active" | "completed" | "aborted" | "abandoned"; rewarded: boolean } | null;
}

export interface RoadmapNode {
  id: string;
  title: string;
  x: number; // 0..1 — относительные координаты для отрисовки карты
  y: number;
  requiredPoints: number;
  type: "start" | "focus_goal" | "boss";
  status: "completed" | "current" | "next" | "locked";
  challenge: { kind: string; required: number } | null;
  /** Когда сервер зафиксировал прохождение этапа (null — ещё не пройден / стартовый узел) */
  reachedAt: number | null;
  /** Награда за этап: у промежуточных — этапная, у финального — командная */
  reward: { xp: number; coins: number } | null;
  /** Доля пути до узла от предыдущего (0..1) — считает сервер */
  progress: number;
}

export interface RoadmapTeam {
  key: string; // "shared" | "A" | "B"
  name: string;
  points: number;
  positionNodeId: string;
  /** дошла до финального узла */
  finished: boolean;
  /** победила (получила командную награду) */
  completed: boolean;
}

export interface Roadmap {
  roadmapId: string;
  title: string;
  /** "shared" — одна общая команда, "teams" — Team A против Team B */
  mode: "shared" | "teams";
  /** Команда зрителя: верхний уровень (points, nodes[].status, next…) описывает её */
  teamKey: string;
  points: number;
  goal: number;
  completed: boolean;
  finished: boolean;
  winner: "A" | "B" | "draw" | null;
  completedAt: number | null;
  reward: { xp: number; coins: number };
  positionNodeId: string;
  /** Следующий этап и сколько очков до него; null, если цель достигнута */
  next: { nodeId: string; title: string; pointsNeeded: number } | null;
  /** Участок пути между текущим и следующим узлом и доля пройденного */
  segment: { from: string; to: string; progress: number } | null;
  /** Команды. Сейчас одна общая; Team A/B — задел, UI показывает маркер на каждую */
  teams: RoadmapTeam[];
  nodes: RoadmapNode[];
  edges: [string, string][];
  contributions: { userId: string; name: string; points: number; team?: string }[];
}

export interface RoomInfo {
  id: string;
  code: string;
  name: string;
  hostId: string;
  phase: Phase;
  cycleId: string | null;
  cycleNo: number;
  demo: boolean;
  mode: "shared" | "teams";
  settings: { focusSec: number; breakSec: number };
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  serverTime: number;
  remainingMs: number | null;
}

export interface LevelInfo {
  level: number;
  xp: number;
  levelStartXp: number;
  nextLevelXp: number;
}

export interface Effect {
  id: number;
  kind: "boost" | "shield";
  sourceUserId: string;
  createdAt: number;
  expiresAt: number;
}

export interface RoomSnapshot {
  room: RoomInfo;
  members: Member[];
  challenge: Roadmap;
  me?: LevelInfo & {
    userId: string;
    isMember: boolean;
    isHost: boolean;
    team: string | null;
    isReady?: boolean;
    status: MemberStatus | null;
    task: string | null;
    session: Member["session"];
    coins: number;
    prankEnabled: boolean;
    effects: Effect[];
    /** Что разрешено сейчас (сервер всё равно перепроверяет каждое действие). */
    allowedActions: string[];
  };
}

export interface Me extends LevelInfo {
  id: string;
  name: string;
  coins: number;
  prankEnabled: boolean;
  /** Песочный аккаунт демо-сервера: играет только в демо-комнатах (старый backend поле не присылает) */
  sandbox?: boolean;
  createdAt: number;
  activeSession: { id: string; roomId: string; scheduledEndAt: number } | null;
  rooms: { id: string; code: string; name: string; phase: Phase }[];
}

export interface Upgrade {
  id: string;
  title: string;
  description: string;
  level: number;
  maxLevel: number;
  minPlayerLevel: number;
  nextCost: number | null;
  locked: boolean;
  maxed: boolean;
  canBuy: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  reward: { coins: number };
  unlocked: boolean;
  unlockedAt: number | null;
}

export interface Progress extends LevelInfo {
  userId: string;
  name: string;
  coins: number;
  prankEnabled: boolean;
  stats: { completedSessions: number; bestStreakDays: number; helpsSent: number; pranksSent: number; focusSeconds: number; interruptedSessions: number };
  upgrades: Upgrade[];
  achievements: Achievement[];
  effects: Effect[];
}

export interface StudySession {
  id: string;
  roomId: string;
  roomName: string;
  cycleNo: number;
  task: string | null;
  status: "active" | "completed" | "aborted" | "abandoned";
  endReason: string | null;
  startedAt: number;
  endedAt: number | null;
  scheduledEndAt: number;
  durationSec: number;
  result: "done" | "partial" | "not_done" | null;
  resultNote: string | null;
  rewarded: boolean;
  xp: number;
  coins: number;
}

/** GET /api/users/me/stats — личная статистика (всё считает сервер) */
export interface StudyStats extends LevelInfo {
  userId: string;
  name: string;
  coins: number;
  sessions: {
    completed: number;
    rewarded: number;
    interrupted: number;
    focusSeconds: number;
    averageSeconds: number;
    todayFocusSeconds: number;
    todaySessions: number;
  };
  bestStreakDays: number;
  social: { helpsSent: number; pranksSent: number; helpsReceived: number; pranksReceived: number };
  achievements: { unlocked: number; total: number };
  daily: { dayStart: number; focusSeconds: number; sessions: number }[];
}

export interface RoomStatsMember {
  userId: string;
  name: string;
  team: string;
  completedSessions: number;
  interruptedSessions: number;
  focusSeconds: number;
  points: number;
}

/** GET /api/rooms/:id/stats — командный прогресс комнаты */
export interface RoomStats {
  roomId: string;
  mode: "shared" | "teams";
  cycles: number;
  goal: number;
  winner: "A" | "B" | "draw" | null;
  teams: {
    key: string;
    name: string;
    points: number;
    goal: number;
    finished: boolean;
    completed: boolean;
    positionNodeId: string;
    completedSessions: number;
    focusSeconds: number;
    members: RoomStatsMember[];
  }[];
  totals: { completedSessions: number; focusSeconds: number };
}

/** Действие помощи/пакости из ленты комнаты */
export interface SocialAction {
  id: number;
  kind: "help" | "prank";
  type: "boost" | "shield" | "fog" | "sticker";
  fromUserId: string;
  toUserId: string;
  status: "applied" | "blocked";
  at: number;
  effectEndsAt: number | null;
}

// ---------------------------------------------------------------------------- Голос
export interface VoicePeer {
  userId: string;
  name: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  joinedAt: number;
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  ttlSec: number;
  /** настроен ли TURN (звонок пройдёт и через строгий NAT) */
  relay: boolean;
}

/** Сигнал WebRTC, который сервер пересылает между участниками голосового канала */
export type VoiceSignal =
  | { description: { type: "offer" | "answer"; sdp: string } }
  | { candidate: RTCIceCandidateInit | null };

/** GET /api/health */
export interface HealthInfo {
  status: string;
  serverTime: number;
  /** Демо-сервер: песочные аккаунты и только демо-комнаты */
  demoMode: boolean;
}

export interface RegisterOptions {
  /** Песочный аккаунт — только если сервер в демо-режиме (иначе 403 DEMO_DISABLED) */
  sandbox?: boolean;
}

export interface CreateRoomInput {
  name?: string;
  focusMinutes?: number;
  breakMinutes?: number;
  /** Командный режим: Team A против Team B */
  teamMode?: boolean;
  /** Только если сервер запущен с TOMATO_DEMO=1 */
  demo?: boolean;
  focusSeconds?: number;
  breakSeconds?: number;
}

/** Все серверные события WebSocket: { type, ts, roomId?, reqId?, data } */
export interface ServerEvent<T = unknown> {
  type: string;
  ts: number;
  roomId?: string;
  reqId?: number | string;
  data: T;
}

export type ServerEventType =
  | "hello" | "room_joined" | "room_state" | "player_joined" | "player_left" | "host_changed"
  | "player_status_changed" | "team_changed" | "task_updated" | "settings_changed"
  | "timer_started" | "timer_tick" | "phase_changed"
  | "session_completed" | "reward_granted" | "balance_changed" | "achievement_unlocked"
  | "td_state" | "td_round_started" | "td_round_finished" | "td_tower_built" | "td_tower_upgraded" | "td_duel_result" | "roadmap_updated" | "node_reached" | "challenge_completed" | "help_applied" | "prank_applied"
  | "voice_roster" | "voice_joined" | "voice_left" | "voice_peer_joined" | "voice_peer_left" | "voice_state" | "voice_signal" | "voice_kicked"
  | "heartbeat_ack" | "unsubscribed" | "error";

// ---------------------------------------------------------------------------- Tower Defense
export type TowerType = "arrow" | "cannon" | "frost";
export type EnemyType = "runner" | "grunt" | "tank" | "boss";
export type RoundStatus = "running" | "won" | "lost" | "expired";

export interface TdTowerDef {
  id: TowerType;
  title: string;
  description: string;
  cost: number;
  range: number;
  damage: number;
  cooldown: number;
  splash?: number;
  upgradeCosts: [number, number];
}

export interface TdTower {
  slot: string;
  type: TowerType;
  level: number;
  ownerId: string;
  ownerName: string;
}

export interface TdEnemy {
  id: number;
  type: EnemyType;
  x: number; // клетки поля
  y: number;
  hp: number;
  maxHp: number;
  slowed: boolean;
}

export interface TdRound {
  id: string;
  team: string;
  stageId: string;
  status: RoundStatus;
  current: boolean;
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
  speed: number;
  t: number;
  wave: number;
  waves: number;
  spawned: number;
  total: number;
  hp: number;
  hpMax: number;
  kills: number;
  leaked: number;
  enemies: TdEnemy[];
  result: { hpLeft: number; hpMax: number; kills: number; leaked: number; total: number; gameTime: number } | null;
}

export interface TdStage {
  id: string;
  title: string;
  node: string;
  nodeTitle: string;
  unlocked: boolean;
  reward: { xp: number; coins: number };
  waves: number;
  enemies: number;
  wins: number;
  bestHpLeft: number | null;
}

export interface TdView {
  enabled: boolean;
  phase: string;
  mode: "shared" | "teams";
  team: string;
  breakEndsAt: number | null;
  serverTime: number;
  map: { cols: number; rows: number; path: [number, number][]; slots: { id: string; x: number; y: number }[]; pathLength: number };
  towerTypes: TdTowerDef[];
  enemyTypes: { id: EnemyType; title: string; hp: number; speed: number; damage: number }[];
  maxLevel: number;
  stages: TdStage[];
  defaultStageId: string;
  base: { hpMax: number; damageMult: number; wallLevels: number; powerLevels: number };
  towers: TdTower[];
  round: TdRound | null;
  rival: { team: string; towers: number; round: TdRound | null } | null;
  duel: { stageId: string; winner: "A" | "B" | "draw"; scores: Record<string, number> } | null;
  me: { userId: string; coins: number; participated: boolean };
}

/** Событие td_state: состояние игры одной команды */
export interface TdStateEvent {
  team: string;
  towers: TdTower[];
  round: TdRound | null;
}
