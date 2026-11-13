import type {
  Achievement, TdView, CreateRoomInput, IceConfig, Me, Progress, Roadmap, RoomSnapshot, RoomStats, ServerEvent, SocialAction, StudySession, StudyStats, Upgrade, VoicePeer,
} from "./types";

export class TomatoApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const TOKEN_KEY = "tomato.token";

export interface ClientOptions {
  /** По умолчанию — тот же origin (dev: vite-прокси). Для отдельного хоста: "https://api.example.com" */
  baseUrl?: string;
}

/**
 * Framework-agnostic клиент Tomato backend. Новый дизайн может использовать его как есть
 * (или поверх него написать свои хуки): никакой бизнес-логики здесь нет, только транспорт.
 */
export class TomatoClient {
  token: string | null;
  private baseUrl: string;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.token = typeof localStorage !== "undefined" ? safe(() => localStorage.getItem(TOKEN_KEY)) : null;
  }

  setToken(token: string | null) {
    this.token = token;
    safe(() => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY)));
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new TomatoApiError(res.status, e.code ?? "HTTP_ERROR", e.message ?? res.statusText, e.details);
    }
    return json as T;
  }

  // --- пользователь
  async register(name: string): Promise<Me> {
    const { user, token } = await this.request<{ user: Me; token: string }>("POST", "/api/users", { name });
    this.setToken(token);
    return user;
  }
  me = () => this.request<Me>("GET", "/api/users/me");
  updateMe = (patch: { name?: string; prankEnabled?: boolean }) => this.request<Me>("PATCH", "/api/users/me", patch);
  progress = () => this.request<Progress>("GET", "/api/users/me/progress");
  sessions = (limit = 50) => this.request<{ sessions: StudySession[] }>("GET", `/api/users/me/sessions?limit=${limit}`);
  achievements = () => this.request<{ achievements: Achievement[] }>("GET", "/api/users/me/achievements");
  /** tzOffsetMin — минуты к UTC (для Алматы +300): нужен только чтобы сервер правильно резал сутки */
  stats = (tzOffsetMin = -new Date().getTimezoneOffset()) => this.request<StudyStats>("GET", `/api/users/me/stats?tz=${tzOffsetMin}`);
  upgrades = () => this.request<{ upgrades: Upgrade[] }>("GET", "/api/users/me/upgrades");
  buyUpgrade = (id: string, expectedLevel?: number) =>
    this.request<{ upgradeId: string; level: number; cost: number }>("POST", `/api/users/me/upgrades/${id}/purchase`, { expectedLevel });
  config = () => this.request<Record<string, unknown>>("GET", "/api/config");

  // --- комнаты
  createRoom = (input: CreateRoomInput) => this.request<RoomSnapshot>("POST", "/api/rooms", input);
  joinByCode = (code: string) => this.request<RoomSnapshot>("POST", "/api/rooms/join", { code });
  room = (id: string) => this.request<RoomSnapshot>("GET", `/api/rooms/${id}`);
  leaveRoom = (id: string) => this.request<{ left: boolean }>("POST", `/api/rooms/${id}/leave`);
  updateSettings = (id: string, s: CreateRoomInput) => this.request<RoomSnapshot>("PATCH", `/api/rooms/${id}/settings`, s);
  setTeam = (id: string, team: "A" | "B") => this.request<RoomSnapshot>("POST", `/api/rooms/${id}/team`, { team });
  setTask = (id: string, title: string) => this.request<{ task: string | null }>("POST", `/api/rooms/${id}/task`, { title });
  startFocus = (id: string) => this.request<RoomSnapshot>("POST", `/api/rooms/${id}/start`);
  abortSession = (id: string) => this.request<{ status: string }>("POST", `/api/rooms/${id}/session/abort`);
  recordResult = (id: string, result: "done" | "partial" | "not_done", note?: string) =>
    this.request("POST", `/api/rooms/${id}/session/result`, { result, note });
  skipBreak = (id: string) => this.request<RoomSnapshot>("POST", `/api/rooms/${id}/skip-break`);
  roadmap = (id: string) => this.request<Roadmap>("GET", `/api/rooms/${id}/roadmap`);
  help = (id: string, targetUserId: string, type: "boost" | "shield") =>
    this.request("POST", `/api/rooms/${id}/social/help`, { targetUserId, type });
  prank = (id: string, targetUserId: string, type: "fog" | "sticker") =>
    this.request("POST", `/api/rooms/${id}/social/prank`, { targetUserId, type });
  socialFeed = (id: string) => this.request<{ actions: SocialAction[] }>("GET", `/api/rooms/${id}/social`);
  roomStats = (id: string) => this.request<RoomStats>("GET", `/api/rooms/${id}/stats`);

  // --- голос (сигналинг — по WebSocket, см. TomatoSocket.sendRaw)
  voicePeers = (id: string) => this.request<{ roomId: string; peers: VoicePeer[]; maxPeers: number }>("GET", `/api/rooms/${id}/voice`);
  iceServers = () => this.request<IceConfig>("GET", "/api/voice/ice-servers");

  // --- Tower Defense (только на перерыве; всё решает сервер)
  td = (id: string) => this.request<TdView>("GET", `/api/rooms/${id}/td`);
  tdJoin = (id: string) => this.request<TdView>("POST", `/api/rooms/${id}/td/join`);
  tdStart = (id: string, stageId?: string) => this.request<TdView>("POST", `/api/rooms/${id}/td/start`, { stageId });
  tdBuild = (id: string, slotId: string, type: string, requestId: string) =>
    this.request<{ action: string; slotId: string; cost: number; replayed?: boolean }>("POST", `/api/rooms/${id}/td/build`, { slotId, type, requestId });
  tdUpgrade = (id: string, slotId: string, requestId: string, expectedLevel?: number) =>
    this.request<{ action: string; slotId: string; level: number; cost: number; replayed?: boolean }>("POST", `/api/rooms/${id}/td/upgrade`, { slotId, requestId, expectedLevel });

  /** Открывает WebSocket с авто-переподключением. */
  connect(): TomatoSocket {
    if (!this.token) throw new Error("Нет токена: сначала register()");
    const base = this.baseUrl || (typeof location !== "undefined" ? location.origin : "");
    return new TomatoSocket(base.replace(/^http/, "ws") + "/ws", () => this.token!);
  }
}

type Handler = (ev: ServerEvent) => void;

/**
 * WebSocket с экспоненциальным переподключением. После реконнекта сам заново авторизуется
 * и подписывается на комнаты: сервер присылает свежий room_state, награды повторно не выдаются.
 */
export class TomatoSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private rooms = new Set<string>();
  private attempt = 0;
  private closed = false;
  private hb: ReturnType<typeof setInterval> | null = null;
  /** serverTime − Date.now(): используйте serverNow() для таймера, а не локальные часы. */
  clockOffset = 0;

  constructor(private url: string, private getToken: () => string) {
    this.open();
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  on(type: string, fn: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  subscribe(roomId: string) {
    this.rooms.add(roomId);
    this.send({ type: "subscribe", roomId });
  }
  unsubscribe(roomId: string) {
    this.rooms.delete(roomId);
    this.send({ type: "unsubscribe", roomId });
  }

  close() {
    this.closed = true;
    if (this.hb) clearInterval(this.hb);
    this.ws?.close();
  }

  /** Сокет авторизован (получен hello) — можно отправлять голосовые сигналы. */
  get ready() {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Отправка произвольного сообщения (голосовой сигналинг). false — нет соединения, сообщение не ушло. */
  sendRaw(msg: object): boolean {
    if (!this.ready) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  private authed = false;

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private emit(ev: ServerEvent) {
    this.handlers.get(ev.type)?.forEach((h) => h(ev));
    this.handlers.get("*")?.forEach((h) => h(ev));
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ type: "auth", token: this.getToken() }));
    };
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data) as ServerEvent;
      if (typeof ev.ts === "number") this.clockOffset = ev.ts - Date.now();
      if (ev.type === "hello") {
        this.authed = true;
        this.rooms.forEach((id) => this.send({ type: "subscribe", roomId: id }));
        if (this.hb) clearInterval(this.hb);
        this.hb = setInterval(() => this.send({ type: "heartbeat" }), 5000); // присутствие
      }
      this.emit(ev);
    };
    ws.onclose = () => {
      this.authed = false;
      if (this.hb) clearInterval(this.hb);
      this.emit({ type: "disconnected", ts: Date.now(), data: {} });
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.attempt++);
      setTimeout(() => !this.closed && this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
