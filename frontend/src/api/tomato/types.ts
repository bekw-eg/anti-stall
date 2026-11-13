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
}

export interface Roadmap {
  roadmapId: string;
  title: string;
  teamKey: string;
  points: number;
  goal: number;
  completed: boolean;
  completedAt: number | null;
  reward: { xp: number; coins: number };
  positionNodeId: string;
  nodes: RoadmapNode[];
  edges: [string, string][];
  contributions: { userId: string; name: string; points: number }[];
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
  stats: { completedSessions: number; bestStreakDays: number; helpsSent: number; pranksSent: number };
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

export interface CreateRoomInput {
  name?: string;
  focusMinutes?: number;
  breakMinutes?: number;
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
  | "player_status_changed" | "task_updated" | "settings_changed"
  | "timer_started" | "timer_tick" | "phase_changed"
  | "session_completed" | "reward_granted" | "balance_changed" | "achievement_unlocked"
  | "roadmap_updated" | "challenge_completed" | "help_applied" | "prank_applied"
  | "heartbeat_ack" | "unsubscribed" | "error";
