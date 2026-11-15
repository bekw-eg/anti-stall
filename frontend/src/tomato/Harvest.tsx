/**
 * Harvest («Урожай») — мини-игра чётных перерывов, адаптация prototypes/harvest под комнату:
 * играют настоящие Красные и Синие (в комнате без команд — против ботов-огородников).
 * Клиент рисует дождь из зерна раунда, двигает свою корзину и сообщает серверу «поймал»;
 * счёт, комбо, заряды шуток и итог приходят с сервера (кадры harvest_frame).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudFog, Snowflake, Sprout, Trophy } from "lucide-react";
import type { HarvestLive, HarvestPlayer, HarvestTeamLive } from "@/api/tomato";
import { lookOf } from "./Axolotl";
import { HV, KINDS, clampX, coversItem, itemAt, makeRain, multOf, type RainItem } from "./harvestEngine";
import { createRenderer, makeSpots, type DrawBasket, type HarvestRenderer, type Spot } from "./harvestCanvas";
import { TEAM_COLOR, teamTitle } from "./socialRules";
import { PrankSwitch } from "./PrankSwitch";
import { useNow } from "./useMedia";
import type { Tomato } from "./useTomato";
import { Avatar } from "./screens/ui";

const BASKET_COLOR: Record<string, string> = { pink: "#F4A7B9", blue: "#9FC3EA", mint: "#9EE0C4", yellow: "#F5D77A", purple: "#C9B0EE", orange: "#F5B183" };
const BOT_COLOR = ["#9FB8C2", "#B9A6C9", "#C9B79C", "#A9C2A0", "#D7A9B5"];
const RIVAL_BOTS = "#9FB8C2";
const teamColor = (key: string | undefined) => (key === "A" || key === "B" ? TEAM_COLOR[key] : key === "bots" ? RIVAL_BOTS : "#EAA695");
const teamLabel = (key: string | undefined) => (key === "bots" ? "Огородники" : key === "shared" ? "Ваша команда" : teamTitle(key));
const fmt = (s: number) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
const rank = (ps: HarvestPlayer[]) => [...ps].sort((a, b) => b.pts - a.pts || b.caught - a.caught);
const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); };

function Charges({ n }: { n: number }) {
  return (
    <span className="flex gap-1.5" role="img" aria-label={`Шуток осталось: ${n}`}>
      {Array.from({ length: HV.MAX_CHARGES }, (_, i) => <i key={i} className={`h-[18px] w-[18px] rounded-full border-2 border-ink ${i < n ? "bg-[#E26D5A]" : "bg-paper"}`} />)}
    </span>
  );
}

/** Панель справа — как в Tower Defense: белая карточка, заголовок капсом. */
function Panel({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`as-card flex flex-col gap-2 p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg uppercase leading-none"><span className="relative top-0.5">{title}</span></h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Кнопка-плитка шутки (как плитки башен и заклинаний в TD): иконка, имя, клавиша. */
function PrankTile({ icon, label, hotkey, bg, disabled, onClick, title, testId }: { icon: ReactNode; label: string; hotkey: string; bg: string; disabled: boolean; onClick: () => void; title?: string; testId: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title} data-testid={testId}
      className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-ink px-1.5 py-2 text-ink shadow-[0_3px_0_#3B2422] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${bg}`}>
      <span className="flex h-8 items-center justify-center" aria-hidden>{icon}</span>
      <span className="max-w-full truncate text-[15px] font-extrabold leading-tight">{label}</span>
      <kbd className="hidden rounded-md border-2 border-ink bg-white/70 px-1.5 font-sans text-xs font-extrabold sm:inline">{hotkey}</kbd>
    </button>
  );
}

export function Harvest({ t }: { t: Tomato }) {
  const view = t.harvest;
  const snap = t.snapshot!;
  const meId = snap.me?.userId ?? "";
  const round = view?.round ?? null;
  const live: HarvestLive | undefined = view?.live;
  const rain = useMemo(() => (round ? makeRain(round.seed, round.duration) : null), [round]);
  const myTeam = view?.myTeam ?? undefined;
  const rivalKey = round?.teams.find((k) => k !== myTeam);
  const playing = !!round && !!myTeam && round.teams.includes(myTeam) && round.botTeam !== myTeam;
  const looks = useMemo(() => new Map(snap.members.map((m) => [m.userId, m.avatar])), [snap.members]);

  // ---------------- локальное состояние игры (ref: холст обновляется каждый кадр, React — нет)
  const cv = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const rend = useRef<HarvestRenderer | null>(null);
  const miniRend = useRef<HarvestRenderer | null>(null);
  const myX = useRef<number>(HV.W / 2);
  const input = useRef({ left: false, right: false, pointerX: null as number | null });
  const local = useRef(new Set<number>()); // мои заявки «поймал» (до ответа сервера)
  const seen = useRef(new Map<string, Set<number>>()); // какие поимки команды уже показаны «+N»
  const shownX = useRef(new Map<string, number>()); // сглаженные позиции чужих корзин
  const spots = useRef<{ key: string; list: Spot[] } | null>(null);
  const lastT = useRef<number | null>(null);
  const sent = useRef({ x: -1, at: 0 });
  const [targetId, setTargetId] = useState<string | null>(null); // null — всегда лидер соперников
  const [wiped, setWiped] = useState(0); // перерисовать курсор после стирания клякс

  // новый раунд — всё локальное с нуля; своя корзина — на «своей» грядке по порядку в команде
  useEffect(() => {
    local.current = new Set(); seen.current = new Map(); shownX.current = new Map(); spots.current = null; lastT.current = null;
    rend.current?.clear(); miniRend.current?.clear();
    const team = t.harvestFrame.current?.teams.find((x) => x.key === myTeam);
    const idx = Math.max(0, team?.players.findIndex((p) => p.id === meId) ?? 0);
    const n = Math.max(1, team?.players.length ?? 1);
    myX.current = clampX((HV.W * (idx + 0.5)) / n);
  }, [round?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // телефон и планшет: к началу раунда прокручиваем страницу к полю — поле и кнопки шуток видны целиком,
  // не уходят под полосу голоса и кнопку чата внизу экрана
  const fieldBox = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!round || round.status !== "running" || typeof window === "undefined" || window.innerWidth >= 1024) return;
    fieldBox.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [round?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // рендеры холстов
  useEffect(() => {
    if (!cv.current || !mini.current) return;
    rend.current = createRenderer(cv.current);
    miniRend.current = createRenderer(mini.current, { mini: true });
    return () => { rend.current?.destroy(); miniRend.current?.destroy(); rend.current = null; miniRend.current = null; };
  }, [round?.id]);

  // ---------------- главный цикл: ввод, своя корзина, заявки «поймал», отрисовка обоих полей
  const latest = useRef({ t, round, rain, myTeam, rivalKey, playing, looks, meId });
  latest.current = { t, round, rain, myTeam, rivalKey, playing, looks, meId };
  useEffect(() => {
    let raf = 0, prev = performance.now();
    const basketsOf = (team: HarvestTeamLive | undefined, frame: HarvestLive | null, sNow: number, dt: number, isMine: boolean): DrawBasket[] => {
      const L = latest.current;
      if (!team) return [];
      const eff = frame?.effects ?? [];
      const on = (id: string, kind: string) => eff.some((e) => e.target === id && e.kind === kind && sNow < e.untilMs);
      return team.players.map((p, i) => {
        let x: number;
        if (isMine && p.id === L.meId && L.playing) x = myX.current;
        else {
          const target = p.x ?? (HV.W * (i + 0.5)) / team.players.length;
          const cur = shownX.current.get(p.id) ?? target;
          x = cur + (target - cur) * Math.min(1, dt * 12);
          shownX.current.set(p.id, x);
        }
        const look = p.bot ? lookOf(p.id, null) : lookOf(p.id, L.looks.get(p.id));
        return { id: p.id, name: p.id === L.meId ? "Вы" : p.name, x, color: p.bot ? BOT_COLOR[i % BOT_COLOR.length] : BASKET_COLOR[look.skin], isMe: p.id === L.meId, frozen: on(p.id, "freeze"), splat: on(p.id, "splat"), look };
      });
    };
    const itemsOf = (rainItems: RainItem[], caught: Set<number>, tSec: number) => {
      const out = [];
      for (const it of rainItems) {
        if (it.t0 > tSec) continue;
        if (caught.has(it.id) && tSec >= it.crossT) continue;
        const p = itemAt(it, tSec);
        if (p) out.push({ id: it.id, kind: it.kind, r: it.r, ...p });
      }
      return out;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      const L = latest.current;
      const R = rend.current, MR = miniRend.current;
      if (!L.round || !L.rain || !R || !MR) { raf = requestAnimationFrame(frame); return; }
      const F = L.t.harvestFrame.current?.roundId === L.round.id ? L.t.harvestFrame.current : null;
      const sNow = L.t.serverNow();
      const tSec = Math.min(L.round.duration + 3, (sNow - L.round.startedAt) / 1000);
      const running = L.round.status === "running" && tSec >= 0 && tSec <= L.round.duration;
      const mine = F?.teams.find((x) => x.key === L.myTeam);
      const rival = F?.teams.find((x) => x.key === L.rivalKey);
      const eff = F?.effects ?? [];
      const frozen = eff.some((e) => e.target === L.meId && e.kind === "freeze" && sNow < e.untilMs);
      const splat = eff.find((e) => e.target === L.meId && e.kind === "splat" && sNow < e.untilMs);

      // своя корзина: клавиши или мышь/палец, с той же предельной скоростью, что проверяет сервер
      if (L.playing && running && !frozen) {
        const inp = input.current;
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (dir) myX.current = clampX(myX.current + dir * HV.KEY_SPEED * dt);
        else if (inp.pointerX !== null) { const d = inp.pointerX - myX.current; myX.current = clampX(myX.current + Math.sign(d) * Math.min(Math.abs(d), HV.PLAYER_SPEED * dt)); }
        if (Math.abs(sent.current.x - myX.current) > 1 && now - sent.current.at > 90) { sent.current = { x: myX.current, at: now }; L.t.harvestMove(myX.current); }
      }

      // заявки «поймал»: помидор пересёк край корзины между прошлым и этим кадром, а корзина под ним
      const prevT = lastT.current ?? tSec;
      const teamCaught = new Set<number>([...(mine?.caught ?? []), ...local.current]);
      if (L.playing && L.round.status === "running") {
        for (const it of L.rain.items) {
          if (it.crossT <= prevT) continue;
          if (it.crossT > tSec) break;
          if (teamCaught.has(it.id) || !coversItem(it, myX.current)) continue;
          local.current.add(it.id); teamCaught.add(it.id);
          const m = mine?.mult ?? 1;
          if (it.kind === "rotten") R.pop(it.x, "−2", { bad: true });
          else R.pop(it.x, `+${KINDS[it.kind].pts * m}`, { gold: it.kind === "golden" });
          const id = it.id, x = myX.current;
          L.t.harvestCatch(id, x).then((r) => { if (!r) local.current.delete(id); });
        }
      }
      // поимки товарищей (и соперников на мини-поле) — всплывающие очки
      const popNew = (team: HarvestTeamLive | undefined, r: HarvestRenderer) => {
        if (!team) return;
        let s = seen.current.get(team.key);
        if (!s) { s = new Set(team.caught); seen.current.set(team.key, s); return; }
        for (const id of team.caught) {
          if (s.has(id)) continue;
          s.add(id);
          if (local.current.has(id) && team.key === L.myTeam) continue;
          const it = L.rain.byId.get(id);
          if (it) r.pop(it.x, it.kind === "rotten" ? "−2" : `+${KINDS[it.kind].pts}`, { bad: it.kind === "rotten", gold: it.kind === "golden" });
        }
      };
      popNew(mine, R); popNew(rival, MR);
      // упавшие на землю — кляксы
      const rivalCaught = new Set(rival?.caught ?? []);
      for (const it of L.rain.items) {
        if (it.groundT <= prevT || it.groundT > tSec) continue;
        if (!teamCaught.has(it.id)) R.splat(it.x, it.kind);
        if (!rivalCaught.has(it.id)) MR.splat(it.x, it.kind);
      }
      lastT.current = tSec;

      // клякса на моём экране: новая шутка — новые кляксы; стираются кликом, исчезают с концом шутки
      if (splat) { const key = `${splat.at}`; if (spots.current?.key !== key) spots.current = { key, list: makeSpots(Math.round(splat.at * 1000)) }; }
      else if (spots.current) spots.current = null;
      const left = splat ? (splat.untilMs - sNow) / 1000 : 0;

      R.tick(dt); MR.tick(dt);
      R.draw({ items: itemsOf(L.rain.items, teamCaught, tSec), baskets: basketsOf(mine, F, sNow, dt, true), mult: mine ? multOf(mine.combo) : 1, spots: spots.current?.list.length ? spots.current.list : null, spotAlpha: Math.min(1, left) });
      MR.draw({ items: itemsOf(L.rain.items, rivalCaught, tSec), baskets: basketsOf(rival, F, sNow, dt, false), mult: 1, spots: null, spotAlpha: 0 });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------- управление
  const rivalTeam = live?.teams.find((x) => x.key === rivalKey);
  const myTeamLive = live?.teams.find((x) => x.key === myTeam);
  // кто выключил получение шуток (Профиль → Настройки), тот не цель — сервер всё равно откажет
  const prankable = (p: HarvestPlayer) => p.prankEnabled !== false;
  const leader = rivalTeam ? rank(rivalTeam.players.filter(prankable))[0] : undefined;
  const target = rivalTeam?.players.find((p) => p.id === targetId && prankable(p)) ?? leader;
  const charges = live?.charges[meId] ?? view?.charges ?? 1;
  const sNow = t.serverNow();
  const tSec = round ? (sNow - round.startedAt) / 1000 : 0;
  const running = !!round && round.status === "running" && tSec >= 0 && tSec <= round.duration;
  const effOn = (id: string, kind: string) => (live?.effects ?? []).some((e) => e.target === id && e.kind === kind && sNow < e.untilMs);
  useNow(250, !!round && round.status === "running");

  const prank = async (kind: "freeze" | "splat", who = target) => {
    if (!who || !running || charges <= 0 || effOn(who.id, kind)) return;
    await t.harvestPrank(who.id, kind);
  };
  const prankRef = useRef(prank);
  prankRef.current = prank;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (["ArrowLeft", "a", "A", "ф", "Ф"].includes(e.key)) { input.current.left = true; input.current.pointerX = null; e.preventDefault(); }
      if (["ArrowRight", "d", "D", "в", "В"].includes(e.key)) { input.current.right = true; input.current.pointerX = null; e.preventDefault(); }
      if (["q", "Q", "й", "Й"].includes(e.key)) prankRef.current("splat");
      if (["e", "E", "у", "У"].includes(e.key)) prankRef.current("freeze");
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A", "ф", "Ф"].includes(e.key)) input.current.left = false;
      if (["ArrowRight", "d", "D", "в", "В"].includes(e.key)) input.current.right = false;
    };
    addEventListener("keydown", down); addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, []);
  const toField = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * HV.W, y: ((e.clientY - r.top) / r.height) * HV.H }; };
  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => { input.current.pointerX = toField(e).x; };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toField(e);
    if (spots.current?.list.length) {
      spots.current.list = spots.current.list.filter((s) => Math.hypot(s.x - p.x, s.y - p.y) > s.r);
      setWiped((n) => n + 1);
    } else input.current.pointerX = p.x;
  };

  // ---------------- состояния раунда
  const result = round?.status === "finished" ? round.result : null;
  const myPts = myTeamLive?.players.find((p) => p.id === meId)?.pts ?? 0;
  const ranked = myTeamLive ? rank(myTeamLive.players) : [];
  const myPlace = ranked.findIndex((p) => p.id === meId) + 1;
  const mScore = myTeamLive?.score ?? 0, rScore = rivalTeam?.score ?? 0;
  const combo = myTeamLive?.combo ?? 0, m = multOf(combo);
  const splatted = !!spots.current?.list.length;
  void wiped;

  const H2 = "font-display uppercase leading-none";
  let overlay: ReactNode = null;
  if (!view) overlay = <p className="font-bold">Загружаем Harvest…</p>;
  else if (!round) overlay = <><h2 className={`${H2} text-3xl`}><span className="relative top-1">Harvest</span></h2><p className="mt-2 font-bold text-mute">Перерыв слишком короткий для раунда — сыграем на следующем.</p></>;
  else if (result) {
    const won = result.winner === myTeam, draw = result.winner === "draw";
    const mine = result.teams[myTeam ?? ""], theirs = result.teams[rivalKey ?? ""];
    const players = Object.entries(mine?.players ?? {}).map(([id, p]) => ({ id, ...p, name: myTeamLive?.players.find((x) => x.id === id)?.name ?? snap.members.find((x) => x.userId === id)?.name ?? "Игрок" })).sort((a, b) => b.pts - a.pts);
    overlay = (
      <>
        <span className="flex items-center justify-center gap-3">
          <Trophy size={30} strokeWidth={2.6} aria-hidden className={won ? "text-olive" : "text-mute"} />
          <h2 className={`${H2} text-[clamp(22px,4.5vw,36px)]`} data-testid="harvest-result"><span className="relative top-1">{draw ? "Ничья" : won ? "Ваша команда победила!" : `Победили ${teamLabel(result.winner).toLowerCase()}`}</span></h2>
        </span>
        <p className="mt-2 font-extrabold">{mine?.score ?? 0} : {theirs?.score ?? 0}{result.rewards[meId] ? ` · +${result.rewards[meId].xp} XP` : ""}{won ? " · шаг по карте" : ""}</p>
        <ul className="mx-auto mt-3 hidden max-w-sm flex-col text-left sm:flex">
          {players.map((p, i) => (
            <li key={p.id} className={`flex items-center gap-3 border-t-2 border-soft px-2 py-1.5 font-bold first:border-0 ${p.id === meId ? "rounded-[10px] bg-paper" : ""}`}>
              <span className="w-5 text-center font-display text-lg">{i + 1}</span>{p.id === meId ? "Вы" : p.name}<b className="ml-auto font-display text-xl">{p.pts}</b>
            </li>
          ))}
        </ul>
        <p className="mt-3 hidden text-sm font-bold text-mute sm:block">Лучшая серия {mine?.bestCombo ?? 0} · пропущено {mine?.missed ?? 0}</p>
        <p className="mt-1 text-sm font-extrabold text-olive">Следующий перерыв — Tower Defense</p>
      </>
    );
  } else if (tSec < 0) {
    overlay = (
      <>
        <span className="flex items-center justify-center gap-3">
          <Sprout size={30} strokeWidth={2.6} aria-hidden className="text-olive" />
          <h2 className={`${H2} text-[28px] sm:text-4xl`}><span className="relative top-1">Harvest</span></h2>
        </span>
        <p className="mt-1 text-sm font-bold text-mute sm:text-base">{round.duration} с против {rivalKey === "bots" ? "огородников" : "соперников"}<span className="hidden sm:inline">. На обоих полях один и тот же дождь</span>.</p>
        <ul className="mx-auto my-3 hidden max-w-sm flex-col gap-1 text-left text-[15px] font-bold sm:flex">
          <li className="flex items-center gap-2"><i className="h-4 w-4 rounded-full border-2 border-ink bg-[#E26D5A]" />Помидор<b className="ml-auto font-display">+1</b></li>
          <li className="flex items-center gap-2"><i className="h-4 w-4 rounded-full border-2 border-ink bg-[#F2B84B]" />Золотой — и ещё шутка<b className="ml-auto font-display">+3</b></li>
          <li className="flex items-center gap-2"><i className="h-4 w-4 rounded-full border-2 border-ink bg-[#7D625E]" />Гнилой — уворачивайтесь<b className="ml-auto font-display">−2</b></li>
          <li className="flex items-center gap-2"><i className="h-4 w-4 rounded-full border-2 border-ink bg-peach" />5 подряд без пропусков<b className="ml-auto font-display">×2</b></li>
        </ul>
        <p className="mt-1 font-display text-5xl leading-none sm:mt-0 sm:text-6xl" aria-live="polite"><span className="relative top-1">{Math.ceil(-tSec)}</span></p>
        <p className="mt-2 hidden text-sm font-bold text-mute sm:block">Мышь, палец или <kbd className="rounded-md border-2 border-ink bg-paper px-1.5 text-xs">←</kbd> <kbd className="rounded-md border-2 border-ink bg-paper px-1.5 text-xs">→</kbd></p>
      </>
    );
  }

  const feed = t.harvestFeed.filter((f) => f.roundId === round?.id && sNow < (round?.startedAt ?? 0) + f.at * 1000 + 3000);
  const feedText = (f: (typeof feed)[number]) => {
    const verb = f.kind === "freeze" ? "заморозил(а)" : "забрызгал(а)";
    if (f.to === meId) return f.kind === "freeze" ? `${f.fromName} заморозил(а) вашу корзину!` : `${f.fromName} забрызгал(а) экран — кликайте по кляксам`;
    if (f.from === meId) return `Вы ${f.kind === "freeze" ? "заморозили" : "забрызгали"} ${f.toName}`;
    return `${f.fromName} ${verb} ${f.toName}`;
  };
  const myPranksOn = snap.me?.prankEnabled !== false;
  const canPrank = running && playing && charges > 0 && myPranksOn;
  /** Выбор цели: «Лидер» соперников (по умолчанию) или конкретный игрок. На телефоне — одной прокручиваемой строкой. */
  const targetChips = (scroll: boolean) => (
    <div className={`flex gap-1.5 ${scroll ? "min-w-0 flex-1 overflow-x-auto py-1 pl-1 pr-1 [scrollbar-width:none]" : "flex-wrap"}`} role="radiogroup" aria-label="Цель шутки">
      <button type="button" role="radio" aria-checked={targetId === null} onClick={() => setTargetId(null)}
        className={`inline-flex shrink-0 items-center rounded-full border-2 border-ink px-3 py-1 text-sm font-extrabold transition-colors ${targetId === null ? "bg-peach" : "bg-white hover:bg-blush"}`}>Лидер</button>
      {rivalTeam?.players.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={targetId === p.id} onClick={() => setTargetId(p.id)} disabled={!prankable(p)}
          title={prankable(p) ? undefined : `${p.name} отключил(а) шутки`}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-ink py-0.5 pl-0.5 pr-3 text-sm font-extrabold transition-colors disabled:cursor-not-allowed disabled:border-dashed disabled:border-line disabled:text-mute ${targetId === p.id ? "bg-peach" : "bg-white hover:bg-blush"} ${p === leader ? "outline-dashed outline-2 outline-offset-2 outline-rose" : ""}`}>
          <Avatar name={p.name} id={p.id} look={p.bot ? null : looks.get(p.id)} size={22} ring="#3B2422" />{p.name}{!prankable(p) && <span className="font-bold">· шутки выкл.</span>}
          {effOn(p.id, "freeze") && <Snowflake size={13} aria-label="заморожен" />}{effOn(p.id, "splat") && <CloudFog size={13} aria-label="в кляксах" />}
        </button>
      ))}
    </div>
  );
  const splatOff = !canPrank || !target || effOn(target.id, "splat");
  const freezeOff = !canPrank || !target || effOn(target.id, "freeze");
  const left = round ? (tSec < 0 ? round.duration : round.duration - tSec) : 0;

  return (
    // широкий экран: слева поле, под ним поле соперников и лидеры; справа роль, счёт и шутки. Телефон — одной колонкой
    <div className="grid w-full gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" data-testid="harvest">
      {/* ---------------- поле (как поле Tower Defense: рамка, тень, луг) */}
      <section ref={fieldBox} className="flex min-w-0 scroll-mt-[136px] flex-col gap-2.5 lg:col-start-1 lg:row-start-1" aria-label="Harvest: поле команды">
        <div className="relative aspect-[5/3] overflow-hidden rounded-[24px] border-2 border-ink bg-lime shadow-[0_6px_0_#3B2422]">
          <canvas ref={cv} className="block h-full w-full touch-none" style={{ cursor: splatted ? "pointer" : running && playing ? "none" : "default" }}
            aria-label="Ваше поле: помидоры падают, двигайте корзину, чтобы ловить" data-testid="harvest-field"
            onPointerMove={onPointer} onPointerDown={onDown} />
          {/* счёт прямо на поле: видно, что соперник (в т. ч. бот) тоже ловит */}
          {round && myTeamLive && rivalTeam && (
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full border-2 border-ink bg-white/90 px-2.5 py-1 font-display text-sm leading-none shadow-[0_2px_0_#3B2422] sm:right-3 sm:top-3 sm:text-lg" data-testid="field-score" aria-label={`Счёт: ${mScore} — ${rScore}`}>
              <i className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: teamColor(myTeam) }} />
              <span className="relative top-0.5">{mScore} : {rScore}</span>
              <i className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: teamColor(rivalKey) }} />
              {rivalTeam.bots && <span className="font-sans text-[10px] font-extrabold text-mute sm:text-xs">бот</span>}
            </div>
          )}
          <div className="pointer-events-none absolute left-1/2 top-3 flex w-max max-w-[90%] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
            {feed.slice(-3).reverse().map((f) => (
              <div key={f.id} className={`flex items-center gap-2 rounded-full border-2 border-ink px-3 py-1.5 text-sm font-extrabold shadow-[0_3px_0_#3B2422] sm:text-[15px] ${f.to === meId ? "bg-rose text-white" : f.from === meId ? "bg-lime text-ink" : "bg-white text-ink"}`}>
                {f.kind === "freeze" ? <Snowflake size={16} aria-hidden /> : <CloudFog size={16} aria-hidden />}{feedText(f)}
              </div>
            ))}
          </div>
          {overlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/30 p-3 sm:p-4">
              <div className="max-h-full w-[min(460px,100%)] overflow-auto rounded-[24px] border-[3px] border-ink bg-white px-4 py-3 text-center shadow-[0_6px_0_#3B2422] sm:px-7 sm:py-5">{overlay}</div>
            </div>
          )}
        </div>
        {/* телефон и планшет: шутки сразу под полем — большие кнопки под большой палец, без прокрутки к панели */}
        <section className="flex flex-col gap-2 rounded-[20px] border-2 border-ink bg-white p-2.5 shadow-[0_4px_0_#3B2422] lg:hidden" aria-label="Шутки">
          <div className="flex items-center gap-2">
            <b className="shrink-0 font-display text-base uppercase leading-none"><span className="relative top-0.5">Шутки</span></b>
            <Charges n={charges} />
            {targetChips(true)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={splatOff} onClick={() => prank("splat")} data-testid="harvest-splat-touch" title={target ? `Клякса: ${target.name}` : undefined}
              className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-[14px] border-2 border-ink bg-blush px-2 text-base font-extrabold shadow-[0_3px_0_#3B2422] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:shadow-none">
              <CloudFog size={20} strokeWidth={2.4} aria-hidden /><span className="truncate">Клякса</span>
            </button>
            <button type="button" disabled={freezeOff} onClick={() => prank("freeze")} data-testid="harvest-freeze-touch" title={target ? `Заморозка: ${target.name}` : undefined}
              className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-[14px] border-2 border-ink bg-[#CFE6EE] px-2 text-base font-extrabold shadow-[0_3px_0_#3B2422] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:shadow-none">
              <Snowflake size={20} strokeWidth={2.4} aria-hidden /><span className="truncate">Заморозка</span>
            </button>
          </div>
          <PrankSwitch t={t} className="self-start" />
        </section>
        <ul className="flex flex-wrap gap-1.5 text-sm font-extrabold" aria-label="Помидоры">
          <li className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-1"><i className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-[#E26D5A]" />+1</li>
          <li className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-1"><i className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-[#F2B84B]" />+3 и шутка</li>
          <li className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-1"><i className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-[#7D625E]" />−2</li>
          <li className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-1">5 подряд — ×2</li>
          <li className="inline-flex items-center px-1 py-1 font-bold text-olive">Забрызгали? Кликайте по кляксам</li>
        </ul>
      </section>

      {/* ---------------- HUD: справа на широком экране, снизу на телефоне (как в Tower Defense) */}
      <aside className="flex min-w-0 flex-col gap-3 text-ink lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {/* карточка роли */}
        <section aria-label="Раунд Harvest" className="flex items-center gap-3 rounded-[24px] border-2 border-ink bg-ink px-4 py-3 text-cream shadow-[0_6px_0_#3B2422]">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-lime text-ink"><Sprout size={26} strokeWidth={2.4} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-2xl uppercase leading-none"><span className="relative top-0.5">Сбор урожая</span></span>
            <span className="mt-1 block text-[13px] font-bold leading-snug opacity-85">Поймайте больше, чем {rivalKey === "bots" ? "огородники" : teamLabel(rivalKey).toLowerCase()}</span>
          </span>
          {round && (
            <span className={`shrink-0 rounded-full px-2.5 py-1 font-display text-xl tabular-nums leading-none ${running && left <= 10 ? "bg-peach text-ink" : "bg-cream text-ink"}`} role="timer" aria-label={`До конца раунда ${Math.ceil(Math.max(0, left))} с`}>
              <span className="relative top-0.5">{fmt(left)}</span>
            </span>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {/* шутки */}
          <Panel title="Шутки" aside={<Charges n={charges} />} className="hidden lg:flex">
            {targetChips(false)}
            <div className="grid grid-cols-2 gap-2">
              <PrankTile icon={<CloudFog size={26} strokeWidth={2.4} />} label="Клякса" hotkey="Q" bg="bg-blush hover:bg-peach" testId="harvest-splat"
                disabled={splatOff} onClick={() => prank("splat")} title={target ? `Клякса: ${target.name} — помидоры на весь экран` : undefined} />
              <PrankTile icon={<Snowflake size={26} strokeWidth={2.4} />} label="Заморозка" hotkey="E" bg="bg-[#CFE6EE] hover:bg-[#B9DCE8]" testId="harvest-freeze"
                disabled={freezeOff} onClick={() => prank("freeze")} title={target ? `Заморозка: корзина ${target.name} стоит` : undefined} />
            </div>
            <p className="text-[13px] font-bold text-mute">{myPranksOn ? "Только по соперникам. Золотой помидор — ещё одна шутка." : "Вы отключили шутки — отправлять их тоже нельзя."}</p>
            <PrankSwitch t={t} className="self-start" />
          </Panel>

          {/* счёт */}
          <Panel title="Счёт" aside={<span className={`rounded-full border-2 border-ink px-2.5 pt-1 pb-0.5 font-display text-lg leading-none ${m > 1 ? "bg-peach" : "bg-white"}`}>×{m}</span>}>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-extrabold text-mute"><i className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: teamColor(myTeam) }} />{teamLabel(myTeam)}</span>
                <b className="block font-display text-[44px] leading-[.95]" data-testid="harvest-score"><span className="relative top-1">{mScore}</span></b>
              </div>
              <div className="min-w-0 text-right">
                <span className="flex items-center justify-end gap-1.5 text-sm font-extrabold text-mute">{teamLabel(rivalKey)}<i className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: teamColor(rivalKey) }} /></span>
                <b className="block font-display text-[44px] leading-[.95] text-mute"><span className="relative top-1">{rScore}</span></b>
              </div>
            </div>
            <div className="h-4 overflow-hidden rounded-full border-2 border-ink" style={{ background: teamColor(rivalKey) }} role="progressbar" aria-label="Гонка команд" aria-valuenow={mScore} aria-valuemin={0} aria-valuemax={mScore + rScore || 1}>
              <i className="block h-full border-r-2 border-ink transition-[width] duration-200" style={{ width: `${mScore + rScore ? (mScore / (mScore + rScore)) * 100 : 50}%`, background: teamColor(myTeam) }} />
            </div>
            <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-soft"><i className="block h-full rounded-full bg-peach transition-[width] duration-150" style={{ width: `${m === 3 ? 100 : ((combo % 5) / 5) * 100}%` }} /></div>
            <p className="text-sm font-bold text-mute">{m === 3 ? `Максимальное комбо: ${combo} подряд` : `Ещё ${5 - (combo % 5)} подряд без пропусков — ×${m + 1}`}</p>
            <p className="rounded-xl bg-lime px-3 py-2 text-[13px] font-extrabold">Награда — опыт. Победа — шаг по карте и шляпа для аксолотля</p>
          </Panel>

        </div>
      </aside>

      <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-start-2">
          {/* поле соперников */}
          <Panel title="Поле соперников">
            <div className="relative aspect-[5/3] overflow-hidden rounded-[16px] border-2 border-ink bg-lime">
              <canvas ref={mini} className="block h-full w-full" aria-label="Поле соперников" />
              <span className="absolute left-2 top-1.5 rounded-full border-2 border-ink px-2 text-xs font-extrabold" style={{ background: teamColor(rivalKey), color: rivalKey === "A" || rivalKey === "B" ? "#fff" : undefined }}>{teamLabel(rivalKey)}</span>
            </div>
          </Panel>

          {/* лидеры */}
          <Panel title="Лидеры" aside={<span className="text-sm font-extrabold text-mute">{teamLabel(myTeam).toLowerCase()}</span>}>
            <p className="text-sm font-extrabold">{!myPlace ? "Ловите больше всех" : myPlace === 1 ? (ranked[1] && ranked[1].pts === myPts ? `Делите 1-е место с ${ranked[1].name}` : "Вы на 1-м месте") : `Вы на ${myPlace}-м месте, до ${ranked[myPlace - 2].name} — ${ranked[myPlace - 2].pts - myPts}`}</p>
            <ol className="flex flex-col gap-1">
              {ranked.map((p, i) => (
                <li key={p.id} className={`flex h-11 items-center gap-2.5 rounded-[14px] px-2 ${p.id === meId ? "bg-paper ring-2 ring-inset ring-ink" : ""}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-display text-[16px] ${i === 0 ? "border-ink bg-[#F2B84B]" : i === 1 ? "border-ink bg-[#E6D6D1]" : i === 2 ? "border-ink bg-[#D9A27E]" : "border-transparent"}`}><span className="relative top-0.5">{i + 1}</span></span>
                  <Avatar name={p.name} id={p.id} look={p.bot ? null : looks.get(p.id)} size={30} ring={teamColor(myTeam)} />
                  <span className="min-w-0 flex-1 truncate font-bold">{p.id === meId ? "Вы" : p.name}</span>
                  {effOn(p.id, "freeze") && <Snowflake size={15} aria-label="заморожен" />}
                  <span className="font-display text-xl"><span className="relative top-0.5">{p.pts}</span></span>
                </li>
              ))}
            </ol>
            {result && result.winner === myTeam && <p className="flex items-center gap-2 text-sm font-extrabold text-olive"><Trophy size={16} aria-hidden />Победа засчитана команде</p>}
          </Panel>
      </div>
    </div>
  );
}
