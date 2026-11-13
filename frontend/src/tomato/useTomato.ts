import { useCallback, useEffect, useRef, useState } from "react";
import { TomatoApiError, TomatoClient } from "@/api/tomato";
import type { CreateRoomInput, Me, RoomSnapshot, ServerEvent, TomatoSocket } from "@/api/tomato";
import { extractRoomCode } from "./format";
import { useNow } from "./useMedia";

export const client = new TomatoClient();

const ROOM_KEY = "tomato2.roomId";
const NAME_KEY = "tomato2.name";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** idle — нет комнаты; connecting — первое подключение; online; reconnecting — связь потеряна; offline — нет сети */
export type Conn = "idle" | "connecting" | "online" | "reconnecting" | "offline";
export interface Toast { id: number; text: string; tone: "info" | "reward" | "error" }

const teamLabel = (team?: string) => (team === "A" || team === "B" ? `${team}: ` : "");

function describeEvent(ev: ServerEvent, myId?: string): string | null {
  const d = ev.data as { team?: string; draw?: boolean; kind?: string; xp?: number; coins?: number; levelUp?: boolean; level?: number; title?: string; rewarded?: boolean; status?: string; to?: string; blocked?: boolean };
  switch (ev.type) {
    case "reward_granted": return d.kind === "achievement" ? null : `+${d.xp} XP · +${d.coins} монет${d.levelUp ? ` · уровень ${d.level}` : ""}`;
    case "achievement_unlocked": return `Достижение: ${d.title}`;
    case "session_completed": return d.rewarded ? null : d.status === "completed" ? "Сессия завершена, дневной лимит наград исчерпан" : "Сессия прервана — без награды";
    case "node_reached": return `${teamLabel(d.team)}этап пройден: ${d.title}`.replace(/^./, (c) => c.toUpperCase());
    case "challenge_completed": return d.draw ? "Ничья: обе команды достигли цели" : d.team === "shared" ? "Команда достигла цели" : `Команда ${d.team} победила`;
    case "help_applied": return d.to === myId ? "Вам помогли: бонус к XP в следующей сессии" : null;
    case "prank_applied": return d.to === myId ? (d.blocked ? "Щит отразил шутку" : "Вам отправили шутку") : null;
    default: return null;
  }
}

/**
 * Всё серверное состояние нового интерфейса. Здесь НЕТ собственного таймера сессии:
 * фаза и время окончания приходят с сервера; remainingMs — только отображение phaseEndsAt.
 */
export function useTomato(initialCode?: string) {
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [user, setUser] = useState<Me | null>(null);
  const [name, setName] = useState(store.get(NAME_KEY) ?? "");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [conn, setConn] = useState<Conn>("idle");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [disconnectedFor, setDisconnectedFor] = useState(0);

  const offsetRef = useRef(0); // serverTime − Date.now()
  const refreshRef = useRef<() => void>(() => undefined);
  const myIdRef = useRef<string | undefined>(undefined);
  myIdRef.current = snapshot?.me?.userId ?? user?.id;

  const serverNow = () => Date.now() + offsetRef.current;
  const phaseEndsAt = snapshot?.room.phaseEndsAt ?? null;
  useNow(250, phaseEndsAt !== null); // перерисовка для отображения оставшегося времени
  const remainingMs = phaseEndsAt === null ? null : Math.max(0, phaseEndsAt - serverNow());

  // ---------------------------------------------------------------- уведомления
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 5000);
  }, []);

  const applySnapshot = useCallback((s: RoomSnapshot) => {
    offsetRef.current = s.room.serverTime - Date.now();
    setSnapshot(s);
  }, []);

  const leaveLocal = useCallback(() => {
    setRoomId(null);
    setSnapshot(null);
    setConn("idle");
    store.set(ROOM_KEY, null);
    window.history.replaceState(null, "", "/");
  }, []);

  const enterRoom = useCallback((s: RoomSnapshot) => {
    applySnapshot(s);
    setRoomId(s.room.id);
    store.set(ROOM_KEY, s.room.id);
    window.history.replaceState(null, "", `/room/${s.room.code}`);
  }, [applySnapshot]);

  /** Единая обработка ошибок: сеть, устаревший токен, ошибки домена. */
  const call = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const r = await fn();
      setServerOk(true);
      return r;
    } catch (e) {
      if (e instanceof TomatoApiError) {
        if (e.status === 401) {
          client.setToken(null);
          setUser(null);
          leaveLocal();
          push("Сессия устарела — войдите заново", "error");
        } else push(e.message, "error");
      } else {
        setServerOk(false);
        push("Нет связи с сервером", "error");
      }
      return null;
    }
  }, [leaveLocal, push]);

  // ---------------------------------------------------------------- загрузка и восстановление
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (;;) {
        try {
          const h = await fetch("/api/health").then((r) => r.json());
          if (cancelled) return;
          setServerOk(true);
          setDemoAvailable(Boolean(h.demoMode));
          offsetRef.current = h.serverTime - Date.now();
        } catch {
          if (cancelled) return;
          setServerOk(false);
          await sleep(3000);
          if (cancelled) return;
          continue;
        }
        try {
          if (client.token) {
            const me = await client.me();
            if (cancelled) return;
            setUser(me);
            setName((n) => n || me.name);
            const saved = store.get(ROOM_KEY);
            const code = initialCode ? extractRoomCode(initialCode) : null;
            if (code) enterRoom(await client.joinByCode(code));
            else if (saved) enterRoom(await client.room(saved));
          }
        } catch (e) {
          if (e instanceof TomatoApiError) {
            if (e.status === 401) client.setToken(null);
            else store.set(ROOM_KEY, null); // комната закрыта / нет доступа
          } else {
            await sleep(3000); // сеть пропала посреди восстановления — повторяем
            if (cancelled) return;
            continue;
          }
        }
        if (!cancelled) setBoot("ready");
        return;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- комната: REST-снимок + WebSocket
  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    let everOnline = false;
    setConn("connecting");

    const refresh = () => {
      client.room(roomId).then((s) => alive && applySnapshot(s)).catch((e) => {
        if (!alive) return;
        if (e instanceof TomatoApiError && (e.status === 403 || e.status === 404)) { leaveLocal(); push("Комната недоступна", "error"); }
      });
    };
    refreshRef.current = refresh;
    refresh();

    const socket: TomatoSocket = client.connect();
    socket.subscribe(roomId);
    socket.on("hello", () => { everOnline = true; setConn("online"); });
    socket.on("disconnected", () => setConn(everOnline ? "reconnecting" : "connecting"));
    socket.on("room_state", (ev) => { if (ev.roomId === roomId) { applySnapshot(ev.data as RoomSnapshot); if (ev.ts) offsetRef.current = ev.ts - Date.now(); } });
    socket.on("error", (ev) => {
      if ((ev.data as { code?: string }).code === "UNAUTHORIZED") { client.setToken(null); setUser(null); leaveLocal(); }
    });
    socket.on("*", (ev) => {
      if (ev.type === "reward_granted" || ev.type === "balance_changed") refresh(); // блок me живёт в снимке
      const text = describeEvent(ev, myIdRef.current);
      if (text) push(text, ev.type === "reward_granted" || ev.type === "achievement_unlocked" || ev.type === "challenge_completed" || ev.type === "node_reached" ? "reward" : "info");
    });

    // Присутствие: WS шлёт heartbeat сам; REST-heartbeat страхует от обрыва только сокета.
    const hb = setInterval(() => { client.request("POST", "/api/heartbeat", {}).then(() => setServerOk(true)).catch(() => undefined); }, 5000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onOnline = () => refresh();
    const onOffline = () => setConn("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      alive = false;
      socket.close();
      clearInterval(hb);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [roomId, applySnapshot, leaveLocal, push]);

  // Время вышло, а сервер фазу ещё не сменил (задержка сети) — не решаем сами, а запрашиваем состояние.
  useEffect(() => {
    if (!roomId || phaseEndsAt === null) return;
    const id = setInterval(() => { if (serverNow() > phaseEndsAt + 1500) refreshRef.current(); }, 1500);
    return () => clearInterval(id);
  }, [roomId, phaseEndsAt]);

  // Сколько времени нет связи (для предупреждения про grace-период сервера)
  useEffect(() => {
    if (conn === "online" || conn === "idle") { setDisconnectedFor(0); return; }
    const since = Date.now();
    const id = setInterval(() => setDisconnectedFor(Math.round((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(id);
  }, [conn]);

  // ---------------------------------------------------------------- действия
  const ensureUser = useCallback(async (displayName: string) => {
    const trimmed = displayName.trim();
    if (client.token) {
      const me = await call(() => client.me());
      if (me && me.name !== trimmed) { const u = await call(() => client.updateMe({ name: trimmed })); if (u) setUser(u); }
      else if (me) setUser(me);
      if (client.token) { store.set(NAME_KEY, trimmed); return true; }
    }
    const u = await call(() => client.register(trimmed));
    if (!u) return false;
    setUser(u);
    store.set(NAME_KEY, trimmed);
    return true;
  }, [call]);

  const withBusy = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }, []);

  const createRoom = useCallback((displayName: string, input: CreateRoomInput) => withBusy(async () => {
    if (!(await ensureUser(displayName))) return false;
    const s = await call(() => client.createRoom({ name: `Комната ${displayName.trim()}`, ...input }));
    if (s) enterRoom(s);
    return Boolean(s);
  }), [call, ensureUser, enterRoom, withBusy]);

  const joinRoom = useCallback((displayName: string, codeOrLink: string) => withBusy(async () => {
    const code = extractRoomCode(codeOrLink);
    if (!code) { push("Неверный код или ссылка", "error"); return false; }
    if (!(await ensureUser(displayName))) return false;
    const s = await call(() => client.joinByCode(code));
    if (s) enterRoom(s);
    return Boolean(s);
  }), [call, ensureUser, enterRoom, push, withBusy]);

  const room = snapshot?.room;
  const rid = room?.id ?? "";
  const leaveRoom = useCallback(async () => { if (!rid) return; await call(() => client.leaveRoom(rid)); leaveLocal(); }, [call, leaveLocal, rid]);
  const startFocus = useCallback(() => call(() => client.startFocus(rid)), [call, rid]);
  const abortSession = useCallback(() => call(() => client.abortSession(rid)), [call, rid]);
  const skipBreak = useCallback(() => call(() => client.skipBreak(rid)), [call, rid]);
  const setTeam = useCallback((team: "A" | "B") => call(() => client.setTeam(rid, team)), [call, rid]);
  const setTask = useCallback((title: string) => call(() => client.setTask(rid, title)), [call, rid]);
  const updateSettings = useCallback((s: CreateRoomInput) => withBusy(() => call(() => client.updateSettings(rid, s))), [call, rid, withBusy]);
  const help = useCallback((userId: string, type: "boost" | "shield") => call(() => client.help(rid, userId, type)), [call, rid]);
  const prank = useCallback((userId: string, type: "fog" | "sticker") => call(() => client.prank(rid, userId, type)), [call, rid]);
  const recordResult = useCallback((result: "done" | "partial" | "not_done") => call(() => client.recordResult(rid, result)), [call, rid]);

  return {
    boot, serverOk, demoAvailable, user, name, setName, snapshot, conn, busy, toasts, disconnectedFor, remainingMs,
    call, createRoom, joinRoom, leaveRoom, startFocus, abortSession, skipBreak, setTask, setTeam, updateSettings, help, prank, recordResult,
  };
}
export type Tomato = ReturnType<typeof useTomato>;
