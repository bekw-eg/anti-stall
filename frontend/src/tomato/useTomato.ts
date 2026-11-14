import { useCallback, useEffect, useRef, useState } from "react";
import { TomatoApiError, TomatoClient, WS_CLOSE_UNAUTHORIZED } from "@/api/tomato";
import type { ChatMessage, Connection, CreateRoomInput, Me, MercType, RoomSnapshot, ServerEvent, SocialAction, SpellId, TdStateEvent, TdView, TomatoSocket } from "@/api/tomato";
import { apiErrorText, extractRoomCode } from "./format";
import { SHIELD_COST } from "./socialRules";
import { useNow } from "./useMedia";

export const client = new TomatoClient();

/**
 * Сохранённый аккаунт не подходит этому серверу: обычный на демо-сервере или песочный на обычном.
 * Старый backend поле sandbox не присылает — тогда аккаунт не трогаем.
 */
export const sandboxMismatch = (me: Pick<Me, "sandbox">, demoMode: boolean) => typeof me.sandbox === "boolean" && me.sandbox !== demoMode;

const ROOM_KEY = "tomato2.roomId";
const NAME_KEY = "tomato2.name";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** idle — нет комнаты; connecting — первое подключение; online; reconnecting — связь потеряна; offline — нет сети */
/** Границы ввода длительностей, секунды (GET /api/config → pomodoro). */
export interface TimerLimits {
  focusSeconds: [number, number];
  breakSeconds: [number, number];
  cycles: [number, number];
  demoFocusSeconds: [number, number];
  demoBreakSeconds: [number, number];
}
export const DEFAULT_LIMITS: TimerLimits = { focusSeconds: [60, 86_400], breakSeconds: [10, 7_200], cycles: [1, 12], demoFocusSeconds: [5, 600], demoBreakSeconds: [10, 300] };

export type Conn = "idle" | "connecting" | "online" | "reconnecting" | "offline";
export interface Toast { id: number; text: string; tone: "info" | "reward" | "warning" | "error" }

const teamLabel = (team?: string) => (team === "A" || team === "B" ? `${team}: ` : "");

/** Справочники игры для подписей событий (названия наёмников и заклинаний приходят с сервера) */
type TdNames = Pick<TdView, "team" | "mercenaries" | "spells"> | null | undefined;
const mercTitle = (td: TdNames, id?: string) => td?.mercenaries?.find((m) => m.id === id)?.title ?? "томата-наёмника";
const spellTitle = (td: TdNames, id?: string) => td?.spells?.find((s) => s.id === id)?.title ?? "заклинание";

/**
 * Текст и тон уведомления о событии комнаты (null — событие не показывается).
 * Свои действия игрок видит в самой игре, поэтому о них не напоминаем.
 */
export function describeEvent(ev: ServerEvent, myId?: string, td?: TdNames): { text: string; tone: Toast["tone"] } | null {
  const myTeam = td?.team;
  const d = ev.data as {
    winner?: string; team?: string; draw?: boolean; kind?: string; xp?: number; coins?: number; levelUp?: boolean; level?: number; title?: string;
    rewarded?: boolean; status?: string; to?: string; blocked?: boolean; target?: string; type?: string; spell?: string; queued?: boolean; by?: string;
    startedBy?: string; bonusTeam?: string | null; counterattackCoins?: number;
  };
  const info = (text: string | null, tone: Toast["tone"] = "info") => (text ? { text, tone } : null);
  switch (ev.type) {
    case "reward_granted": return info(d.kind === "achievement" ? null : `+${d.xp} XP · +${d.coins} монет${d.levelUp ? ` · уровень ${d.level}` : ""}`, "reward");
    case "achievement_unlocked": return info(`Достижение: ${d.title}`, "reward");
    case "session_completed": return info(d.rewarded ? null : d.status === "completed" ? "Сессия завершена, дневной лимит наград исчерпан" : "Сессия прервана — без награды");
    case "td_round_finished":
      if (myTeam && d.team !== myTeam) return null;
      return info(d.status === "won" ? "Оборона выстояла" : d.status === "lost" ? "База пала — в следующий перерыв получится лучше" : "Перерыв закончился — раунд завершён");
    case "td_duel_result": return info(d.winner === "draw" ? "Дуэль: ничья" : `Дуэль: победила команда ${d.winner}`);
    case "td_rematch_started": {
      const bonus = d.bonusTeam && d.bonusTeam === myTeam ? ` · «Контратака»: +${d.counterattackCoins} в казну` : "";
      return info(`Смена ролей! Начался раунд 2 — реванш${bonus}`);
    }
    case "td_unit_sent": {
      if (!myTeam || d.by === myId) return null;
      const title = mercTitle(td, d.type);
      if (d.team !== myTeam && d.target === myTeam) {
        return info(`Соперник прислал наёмника: ${title}!${d.queued ? " Выйдет, когда начнётся ваш раунд" : ""}`, "warning");
      }
      if (d.team !== myTeam) return null;
      return info(d.target === myTeam ? `Подкрепление волны: ${title}` : `Команда отправила сопернику: ${title}`);
    }
    case "td_spell_cast": {
      if (!myTeam || d.by === myId) return null;
      const title = spellTitle(td, d.spell);
      if (d.team !== myTeam && d.target === myTeam) return info(`Соперник наложил на вас «${title}»!`, "warning");
      if (d.team !== myTeam) return null;
      return info(d.target === myTeam ? `Команда усилила оборону: «${title}»` : `Команда наложила на соперника «${title}»`);
    }
    case "node_reached": return info(`${teamLabel(d.team)}этап пройден: ${d.title}`.replace(/^./, (c) => c.toUpperCase()), "reward");
    case "challenge_completed": return info(d.draw ? "Ничья: обе команды достигли цели" : d.team === "shared" ? "Команда достигла цели" : `Команда ${d.team} победила`, "reward");
    case "help_applied": {
      const h = ev.data as { type?: string };
      return info(d.to === myId ? (h.type === "shield" ? "Вам подарили щит от шуток" : "Вам помогли: бонус к XP в следующей сессии") : null);
    }
    case "prank_applied": return info(d.to === myId ? (d.blocked ? "Щит отразил шутку" : null) : null); // сама шутка видна на экране
    default: return null;
  }
}

/**
 * События игры, после которых нужен полный GET /td (этапы, дуэль, реванш).
 * Частые td_tower_*, td_unit_sent, td_spell_cast несут изменения вместе с td_state — перезагрузка не нужна.
 */
const TD_RELOAD_EVENTS = new Set(["td_round_started", "td_round_finished", "td_rematch_started", "td_duel_result"]);

/**
 * Всё серверное состояние нового интерфейса. Здесь НЕТ собственного таймера сессии:
 * фаза и время окончания приходят с сервера; remainingMs — только отображение phaseEndsAt.
 */
export function useTomato(initialCode?: string) {
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  // health.demoMode: демо-сервер — песочные аккаунты и только демо-комнаты
  const [demoMode, setDemoMode] = useState(false);
  const demoRef = useRef(false);
  // Параметры сервера (GET /api/config, hello): значения по умолчанию — на случай, если их там нет
  const [graceSec, setGraceSec] = useState(30);
  const [shieldCost, setShieldCost] = useState(SHIELD_COST);
  const [boostPct, setBoostPct] = useState(25); // бонус к XP от помощи — актуальный приходит из /api/config
  // правила шуток для подсказки в «Друзьях»; в демо-комнатах свой, короткий кулдаун
  const [prankRules, setPrankRules] = useState({ cooldownMs: 20_000, demoCooldownMs: 20_000, maxPerBreak: 3 });
  // Границы длительностей (вводит пользователь, сервер проверяет); актуальные приходят из /api/config
  const [limits, setLimits] = useState<TimerLimits>(DEFAULT_LIMITS);
  const [user, setUser] = useState<Me | null>(null);
  const [name, setName] = useState(store.get(NAME_KEY) ?? "");
  const [roomId, setRoomId] = useState<string | null>(null);
  const leavingRef = useRef(false); // идёт добровольный выход: снимок «вы не участник» — не ошибка
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [conn, setConn] = useState<Conn>("idle");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [disconnectedFor, setDisconnectedFor] = useState(0);
  const [td, setTd] = useState<TdView | null>(null);
  const tdRef = useRef<TdView | null>(null);
  tdRef.current = td;
  const [socket, setSocket] = useState<TomatoSocket | null>(null); // общий сокет комнаты (голос использует его же)
  const [feed, setFeed] = useState<SocialAction[]>([]); // лента помощи и шуток комнаты
  const [chat, setChat] = useState<ChatMessage[]>([]); // текстовый чат комнаты (последние сообщения)

  const offsetRef = useRef(0); // serverTime − Date.now()
  const refreshRef = useRef<() => void>(() => undefined);
  const myIdRef = useRef<string | undefined>(undefined);
  myIdRef.current = snapshot?.me?.userId ?? user?.id;
  const snapRef = useRef<RoomSnapshot | null>(null);
  snapRef.current = snapshot;
  const tickRefreshAt = useRef(0);

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
    setTd(null);
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
  const report = useCallback((e: unknown) => {
    if (e instanceof TomatoApiError) {
      if (e.status === 401) {
        client.setToken(null);
        setUser(null);
        leaveLocal();
        push("Сессия устарела — войдите заново", "error");
      } else push(apiErrorText(e), "error");
    } else {
      setServerOk(false);
      push("Нет связи с сервером", "error");
    }
  }, [leaveLocal, push]);

  const call = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const r = await fn();
      setServerOk(true);
      return r;
    } catch (e) {
      report(e);
      return null;
    }
  }, [report]);

  // ---------------------------------------------------------------- загрузка и восстановление
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (;;) {
        try {
          const h = await client.health();
          if (cancelled) return;
          setServerOk(true);
          demoRef.current = Boolean(h.demoMode);
          setDemoMode(demoRef.current);
          offsetRef.current = h.serverTime - Date.now();
        } catch {
          if (cancelled) return;
          setServerOk(false);
          await sleep(3000);
          if (cancelled) return;
          continue;
        }
        client.config().then((c) => {
          if (cancelled) return;
          const cfg = c as { social?: { shield?: { cost?: number }; boost?: { xpBonusPct?: number }; prankRules?: { cooldownMs?: number; demoCooldownMs?: number; maxPerBreak?: number } }; presence?: { graceMs?: number }; pomodoro?: Partial<TimerLimits> };
          const pom = cfg.pomodoro;
          if (pom && Array.isArray(pom.focusSeconds) && Array.isArray(pom.breakSeconds)) setLimits((l) => ({ ...l, ...pom }));
          if (typeof cfg.social?.shield?.cost === "number") setShieldCost(cfg.social.shield.cost);
          if (typeof cfg.social?.boost?.xpBonusPct === "number") setBoostPct(cfg.social.boost.xpBonusPct);
          const pr = cfg.social?.prankRules;
          if (pr) setPrankRules((p) => {
            const cooldownMs = typeof pr.cooldownMs === "number" ? pr.cooldownMs : p.cooldownMs;
            return { cooldownMs, demoCooldownMs: typeof pr.demoCooldownMs === "number" ? pr.demoCooldownMs : cooldownMs, maxPerBreak: typeof pr.maxPerBreak === "number" ? pr.maxPerBreak : p.maxPerBreak };
          });
          if (typeof cfg.presence?.graceMs === "number" && cfg.presence.graceMs > 0) setGraceSec(Math.round(cfg.presence.graceMs / 1000));
        }).catch(() => undefined);
        const code = initialCode ? extractRoomCode(initialCode) : null;
        try {
          if (client.token) {
            const me = await client.me();
            if (cancelled) return;
            if (sandboxMismatch(me, demoRef.current)) {
              // аккаунт с другого типа сервера: забываем его, при входе зарегистрируемся заново (один раз, по действию пользователя)
              client.setToken(null);
              store.set(ROOM_KEY, null);
            } else {
              setUser(me);
              setName((n) => n || me.name);
              const saved = store.get(ROOM_KEY);
              if (code) enterRoom(await client.joinByCode(code));
              else if (saved) enterRoom(await client.room(saved));
              // localStorage потерян (очистили данные сайта, другая вкладка в приватном режиме),
              // а сервер помнит активную комнату — возвращаемся в последнюю
              else if (me.rooms?.length) enterRoom(await client.room(me.rooms[me.rooms.length - 1].id));
            }
          }
        } catch (e) {
          if (e instanceof TomatoApiError) {
            if (e.status === 401) {
              client.setToken(null); // устарел или выдан другим сервером (у демо — своя БД)
              store.set(ROOM_KEY, null);
            } else {
              // комната закрыта / нет доступа — забываем; 5xx/429 — оставляем до следующей загрузки
              const gone = e.status === 403 || e.status === 404 || e.status === 409;
              if (gone) store.set(ROOM_KEY, null);
              if (code) push(`Не удалось войти в комнату ${code}: ${apiErrorText(e)}`, "error");
              else if (!gone) push(apiErrorText(e), "error");
            }
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
    leavingRef.current = false; // новая комната — флаг выхода из прошлой больше не действует
    let everOnline = false;
    let ended = false; // комната уже сброшена — повторные сигналы (REST + WS) не дублируют тосты
    setConn("connecting");

    /** Комнаты для нас больше нет (вышли в другой вкладке, закрыта): сбрасываем её локально. */
    const roomGone = (text: string) => {
      if (!alive || ended) return;
      ended = true;
      leaveLocal();
      if (!leavingRef.current) push(text, "error"); // сам вышел — ошибки нет
    };
    /** Токен не принят сокетом (4401 / UNAUTHORIZED): разлогиниваем явно, а не молча. */
    const unauthorized = () => {
      if (!alive || ended) return;
      ended = true;
      client.setToken(null);
      setUser(null);
      leaveLocal();
      push("Сессия устарела — войдите заново", "error");
    };
    const applyRoom = (s: RoomSnapshot) => {
      if (s.me && s.me.isMember === false) roomGone("Вы больше не участник этой комнаты");
      else applySnapshot(s);
    };

    const refresh = () => {
      client.room(roomId).then((s) => alive && applyRoom(s)).catch((e) => {
        if (!alive) return;
        if (e instanceof TomatoApiError && (e.status === 403 || e.status === 404)) roomGone("Комната недоступна");
      });
    };
    refreshRef.current = refresh;
    refresh();

    const socket: TomatoSocket = client.connect();
    socket.subscribe(roomId);
    setSocket(socket);
    client.socialFeed(roomId).then((r) => alive && setFeed(r.actions)).catch(() => undefined);
    client.chat(roomId).then((r) => alive && setChat(r.messages)).catch(() => undefined);
    socket.on("hello", (ev) => {
      everOnline = true;
      setConn("online");
      const g = (ev.data as { graceMs?: number }).graceMs;
      if (typeof g === "number" && g > 0) setGraceSec(Math.round(g / 1000));
    });
    socket.on("disconnected", (ev) => {
      if (!alive || ended) return; // сокет закрыт нами (выход из комнаты) — это не потеря связи
      if ((ev.data as { code?: number }).code === WS_CLOSE_UNAUTHORIZED) unauthorized();
      else setConn(everOnline ? "reconnecting" : "connecting");
    });
    socket.on("room_state", (ev) => {
      if (ev.roomId !== roomId) return;
      if (ev.ts) offsetRef.current = ev.ts - Date.now();
      applyRoom(ev.data as RoomSnapshot);
    });
    // timer_tick (раз в секунду) — единый источник часов: сверяем смещение с сервером, а если фаза или
    // время окончания разошлись со снимком (пропущенное событие), запрашиваем свежий снимок, а не решаем сами
    socket.on("timer_tick", (ev) => {
      if (ev.roomId !== roomId) return;
      const d = ev.data as { serverTime?: number; phase?: string; phaseEndsAt?: number | null };
      if (typeof d.serverTime === "number") offsetRef.current = d.serverTime - Date.now();
      const s = snapRef.current;
      if (s && (s.room.phase !== d.phase || s.room.phaseEndsAt !== d.phaseEndsAt) && Date.now() - tickRefreshAt.current > 2000) {
        tickRefreshAt.current = Date.now();
        refresh();
      }
    });
    socket.on("error", (ev) => {
      const code = (ev.data as { code?: string }).code;
      if (code === "UNAUTHORIZED") unauthorized();
      else if (code === "NOT_A_MEMBER" || code === "ROOM_NOT_FOUND") roomGone("Комната недоступна: вы вышли из неё или она закрыта");
    });
    socket.on("*", (ev) => {
      if (ev.type === "player_ready_changed") {
        const d = ev.data as { userId: string; isReady: boolean };
        setSnapshot((prev) => {
          if (!prev) return prev;
          const members = prev.members.map((m) => (m.userId === d.userId ? { ...m, isReady: d.isReady } : m));
          const me = prev.me && prev.me.userId === d.userId ? { ...prev.me, isReady: d.isReady } : prev.me;
          return { ...prev, members, me };
        });
        return;
      }
      if (ev.type === "reward_granted" || ev.type === "balance_changed") refresh(); // блок me живёт в снимке
      // онлайн/переподключение участника: сервер шлёт только это событие, снимок комнаты не меняется
      if (ev.type === "player_status_changed") {
        const d = ev.data as { userId: string; connection?: Connection };
        if (d.connection) setSnapshot((s) => s && { ...s, members: s.members.map((m) => (m.userId === d.userId ? { ...m, connection: d.connection! } : m)) });
      }
      if (ev.type === "chat_message") {
        const m = ev.data as ChatMessage;
        setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-100)));
        return;
      }
      if (ev.type === "help_applied" || ev.type === "prank_applied") {
        const d = ev.data as { actionId: number; type: SocialAction["type"]; from: string; to: string; team?: string | null; blocked?: boolean; at: number; effectEndsAt?: number | null };
        const item: SocialAction = {
          id: d.actionId, kind: ev.type === "help_applied" ? "help" : "prank", type: d.type, fromUserId: d.from, toUserId: d.to, toTeam: d.team ?? null,
          status: d.blocked ? "blocked" : "applied", at: d.at, effectEndsAt: d.effectEndsAt ?? null,
        };
        setFeed((f) => [item, ...f.filter((x) => x.id !== item.id)].slice(0, 30));
        // эффекты и монеты живут в снимке: получателю и отправителю нужен свежий
        if (d.to === myIdRef.current || d.from === myIdRef.current) refresh();
      }
      // Tower Defense: td_state приходит часто и содержит только состояние одной команды — вливаем в локальный вид
      if (ev.type === "td_state") {
        const d = ev.data as TdStateEvent;
        setTd((prev) => {
          if (!prev) return prev;
          // казну присылает сервер вместе с состоянием команды (старый сервер поля не знает — оставляем прежнее)
          const treasury = (fallback: number) => (typeof d.treasuryCoins === "number" ? d.treasuryCoins : fallback);
          if (d.team === prev.team) return { ...prev, towers: d.towers, round: d.round, treasuryCoins: treasury(prev.treasuryCoins) };
          if (prev.rival && prev.rival.team === d.team) return { ...prev, rival: { ...prev.rival, towers: d.towers.length, round: d.round, treasuryCoins: treasury(prev.rival.treasuryCoins) } };
          return prev;
        });
        return;
      }
      if (TD_RELOAD_EVENTS.has(ev.type) && tdRef.current) client.td(roomId).then((v) => alive && setTd(v)).catch(() => undefined);
      const toast = describeEvent(ev, myIdRef.current, tdRef.current);
      if (toast) push(toast.text, toast.tone);
    });

    // Присутствие: WS шлёт heartbeat сам; REST-heartbeat страхует от обрыва только сокета.
    const hb = setInterval(() => { client.request("POST", "/api/heartbeat", {}).then(() => setServerOk(true)).catch(() => undefined); }, 5000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    // сеть вернулась: если сокет пережил обрыв, сам он hello не пришлёт — снимаем «Нет сети» здесь
    const onOnline = () => { refresh(); setConn(socket.ready ? "online" : everOnline ? "reconnecting" : "connecting"); };
    const onOffline = () => setConn("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      alive = false;
      socket.close();
      setSocket(null);
      setFeed([]);
      setChat([]);
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
  /**
   * Аккаунт под этот сервер. Сохранённый токен проверяется: 401 (устарел / с другого сервера) или
   * несовпадение sandbox ↔ demoMode — токен сбрасывается и делается ровно одна новая регистрация.
   */
  const ensureUser = useCallback(async (displayName: string) => {
    const trimmed = displayName.trim();
    if (client.token) {
      let me: Me | null = null;
      try {
        me = await client.me();
        setServerOk(true);
      } catch (e) {
        if (!(e instanceof TomatoApiError && e.status === 401)) { report(e); return false; }
      }
      if (me && !sandboxMismatch(me, demoRef.current)) {
        const u = me.name !== trimmed ? await call(() => client.updateMe({ name: trimmed })) : me;
        if (!client.token) return false; // 401 на переименовании — call уже всё сбросил
        setUser(u ?? me);
        store.set(NAME_KEY, trimmed);
        return true;
      }
      client.setToken(null);
      setUser(null);
    }
    const u = await call(() => client.register(trimmed, demoRef.current ? { sandbox: true } : {}));
    if (!u) return false;
    setUser(u);
    store.set(NAME_KEY, trimmed);
    return true;
  }, [call, report]);

  const withBusy = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }, []);

  const createRoom = useCallback((displayName: string, input: CreateRoomInput) => withBusy(async () => {
    if (!(await ensureUser(displayName))) return false;
    // на демо-сервере песочный аккаунт может создать только демо-комнату
    const s = await call(() => client.createRoom({ name: `Комната ${displayName.trim()}`, ...input, ...(demoRef.current ? { demo: true } : {}) }));
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
  /** Выход: локально — только если сервер подтвердил (или комнаты для нас уже нет: 403/404). */
  const leaveRoom = useCallback(async () => {
    if (!rid) return false;
    // пока сервер обрабатывает выход, он ещё успевает прислать снимок «вы не участник» — это не ошибка
    leavingRef.current = true;
    try {
      await client.leaveRoom(rid);
      setServerOk(true);
    } catch (e) {
      const gone = e instanceof TomatoApiError && (e.status === 403 || e.status === 404);
      if (!gone) { leavingRef.current = false; report(e); return false; } // при 401 report уже сбросил комнату и токен
    }
    leaveLocal();
    // уровень и монеты на экране входа — свежие, а не с момента входа в комнату
    client.me().then((m) => setUser(m)).catch(() => undefined);
    return true;
  }, [leaveLocal, report, rid]);
  const startFocus = useCallback(() => call(() => client.startFocus(rid)), [call, rid]);
  const abortSession = useCallback(() => call(() => client.abortSession(rid)), [call, rid]);
  const skipBreak = useCallback(() => call(() => client.skipBreak(rid)), [call, rid]);
  const setTeam = useCallback((team: "A" | "B") => call(() => client.setTeam(rid, team)), [call, rid]);
  const setReady = useCallback(async (ready: boolean) => {
    const s = await call(() => client.setReady(rid, ready));
    if (s) applySnapshot(s);
    return s;
  }, [applySnapshot, call, rid]);
  const setTask = useCallback((title: string) => call(() => client.setTask(rid, title)), [call, rid]);
  const updateSettings = useCallback((s: CreateRoomInput) => withBusy(() => call(() => client.updateSettings(rid, s))), [call, rid, withBusy]);
  const help = useCallback((userId: string, type: "boost" | "shield") => call(() => client.help(rid, userId, type)), [call, rid]);
  const prank = useCallback((userId: string, type: "fog" | "sticker") => call(() => client.prank(rid, userId, type)), [call, rid]);
  // --- Tower Defense: клиент только отправляет намерения; цену, баланс и результат решает сервер
  const newRequestId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`.padEnd(12, "0"));
  const loadTd = useCallback(async () => { if (!rid) return null; const v = await call(() => client.td(rid)); if (v) setTd(v); return v; }, [call, rid]);
  const tdJoin = useCallback(async () => { const v = await call(() => client.tdJoin(rid)); if (v) setTd(v); return v; }, [call, rid]);
  const tdStart = useCallback(async (stageId?: string) => { const v = await call(() => client.tdStart(rid, stageId)); if (v) setTd(v); return v; }, [call, rid]);
  const tdBuild = useCallback(async (slot: string, type: string) => { const r = await call(() => client.tdBuild(rid, slot, type, newRequestId())); if (r) await loadTd(); return r; }, [call, loadTd, rid]);
  const tdUpgrade = useCallback(async (slot: string, level: number) => { const r = await call(() => client.tdUpgrade(rid, slot, newRequestId(), level)); if (r) await loadTd(); return r; }, [call, loadTd, rid]);
  /** Баланс казны из ответа сервера (td_state следом принесёт его же вместе с полем) */
  const setTreasury = useCallback((coins: number | undefined) => {
    if (typeof coins === "number") setTd((prev) => (prev ? { ...prev, treasuryCoins: coins } : prev));
  }, []);
  const tdSendUnit = useCallback(async (type: MercType) => { const r = await call(() => client.tdSendUnit(rid, type, newRequestId())); if (r) setTreasury(r.treasuryCoins); return r; }, [call, rid, setTreasury]);
  const tdCastSpell = useCallback(async (spell: SpellId) => { const r = await call(() => client.tdCastSpell(rid, spell, newRequestId())); if (r) setTreasury(r.treasuryCoins); return r; }, [call, rid, setTreasury]);
  const tdRematch = useCallback(async (stageId?: string) => { const v = await call(() => client.tdRematch(rid, stageId)); if (v) setTd(v); return v; }, [call, rid]);

  // Перерыв закончился — обновляем состояние игры (раунд закрыт, игра недоступна)
  const phase = snapshot?.room.phase;
  useEffect(() => { if (phase && phase !== "break" && tdRef.current?.enabled) loadTd(); }, [phase, loadTd]);

  const recordResult = useCallback((result: "done" | "partial" | "not_done") => call(() => client.recordResult(rid, result)), [call, rid]);

  /** Отправить сообщение в чат комнаты; true — сервер принял (сообщение придёт и по WS, дубль отсекается по id). */
  const sendChat = useCallback(async (text: string) => {
    const m = await call(() => client.sendChat(rid, text));
    if (m) setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-100)));
    return Boolean(m);
  }, [call, rid]);

  /** Получать шутки: переключатель меняется сразу, сервер подтверждает (при ошибке — откат). */
  const setPranksEnabled = useCallback(async (on: boolean) => {
    const apply = (v: boolean) => {
      setSnapshot((s) => (s?.me ? { ...s, me: { ...s.me, prankEnabled: v }, members: s.members.map((m) => (m.userId === s.me!.userId ? { ...m, prankEnabled: v } : m)) } : s));
      setUser((u) => (u ? { ...u, prankEnabled: v } : u));
    };
    apply(on);
    const r = await call(() => client.updateMe({ prankEnabled: on }));
    if (!r) apply(!on);
    return Boolean(r);
  }, [call]);

  // Качество фокуса: пока идёт своя сессия, сообщаем серверу об уходе со вкладки и возврате.
  // Это может только снизить качество (обрывы связи сервер видит сам), поэтому подмена клиента ничего не даёт.
  const focusing = snapshot?.me?.status === "focusing";
  useEffect(() => {
    if (!focusing || !rid || typeof document === "undefined") return;
    const send = (state: "away" | "back") => { client.reportAttention(rid, state).catch(() => undefined); };
    const onVis = () => send(document.visibilityState === "hidden" ? "away" : "back");
    if (document.visibilityState === "hidden") send("away");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [focusing, rid]);

  return {
    boot, serverOk, demoMode, graceSec, shieldCost, boostPct, prankRules, limits, user, name, setName, snapshot, conn, busy, toasts, disconnectedFor, remainingMs, socket, feed, serverNow,
    call, push, td, loadTd, tdJoin, tdStart, tdBuild, tdUpgrade, tdSendUnit, tdCastSpell, tdRematch, createRoom, joinRoom, leaveRoom, startFocus, abortSession, skipBreak, setTask, setTeam, setReady, updateSettings, help, prank, recordResult, setPranksEnabled, chat, sendChat,
  };
}
export type Tomato = ReturnType<typeof useTomato>;
