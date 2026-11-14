import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { BarChart3, Map as MapIcon, MessageSquare, Settings, Swords, Timer, Users } from "lucide-react";
import { useParams } from "react-router-dom";
import { ConnectionBanner, DemoBadge, Toasts } from "./Chrome";
import { currentRouteCode, formatSpan } from "./format";
import { SPRING, FIELD_DARK, FIELD_LIGHT } from "./motion";
import { PrankOverlay } from "./PrankOverlay";
import { ParticipantsRow, RoadmapSlot } from "./RoomExtras";
import { RoadMap } from "./RoadMap";
import { RoadmapBackdrop } from "./RoadmapBackdrop";
import { SettingsContent } from "./SettingsContent";
import { SocialPanel } from "./SocialPanel";
import { ChatPanel } from "./ChatPanel";
import { StatsPanel } from "./StatsPanel";
import { TimerBlock } from "./TimerBlock";
import { TowerDefense } from "./TowerDefense";
import { useMediaQuery } from "./useMedia";
import { client, useTomato } from "./useTomato";
import { VoiceBar } from "./VoiceBar";
import { useVoice } from "./voice/useVoice";
import { Welcome } from "./Welcome";

const PANEL_KEY = "tomato2.panel";
type Panel = "map" | "game" | "social" | "stats" | "chat" | null;
const PANELS: Panel[] = ["map", "game", "social", "stats", "chat"];
const LIGHT_VARS = { "--fg": "#111111", "--muted": "rgba(17,17,17,.55)", "--card": "rgba(255,255,255,.55)", "--line": "rgba(17,17,17,.16)", "--field": "#d9d9d9" };
const DARK_VARS = { "--fg": "#ffffff", "--muted": "rgba(255,255,255,.62)", "--card": "rgba(255,255,255,.1)", "--line": "rgba(255,255,255,.2)", "--field": "#1d1d1f" };

/**
 * Новый интерфейс Tomato. Три состояния: Welcome → Settings (панель справа) → Focus Room.
 * Весь контент — реальные данные backend (см. useTomato); анимации — только оформление.
 */
export default function TomatoApp() {
  const { code: routeCode } = useParams();
  const t = useTomato(routeCode);
  const desktop = useMediaQuery("(min-width: 900px)");
  const reduce = useReducedMotion(); // left/top/clipPath не отключаются MotionConfig — переключаем на мгновенные сами
  const instant = { duration: 0 };

  const [screen, setScreen] = useState<"welcome" | "stage">("welcome");
  const [open, setOpen] = useState(false); // панель настроек
  // Раскрывающийся слой над комнатой: Road Map, игра (только перерыв), друзья, статистика. Открыт максимум один.
  const [panel, setPanel] = useState<Panel>(() => { try { const v = sessionStorage.getItem(PANEL_KEY) as Panel; return PANELS.includes(v) ? v : null; } catch { return null; } });
  useEffect(() => { try { sessionStorage.setItem(PANEL_KEY, panel ?? ""); } catch { /* ignore */ } }, [panel]);
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const mapOpen = panel === "map";
  const gameOpen = panel === "game";
  const toggleMap = () => toggle("map");
  const toggleGame = () => toggle("game");
  // Длительности в секундах — их вводит пользователь (без пресетов), границы проверяет сервер
  const [work, setWork] = useState(25 * 60);
  const [rest, setRest] = useState(5 * 60);
  const [cycles, setCycles] = useState(4);
  const [demoPick, setDemo] = useState(false);
  const demo = demoPick || t.demoMode; // демо-сервер: любая новая комната — демо
  // Демо-сервер: стартовые значения короткие (секунды), пользователь всё равно может их поменять
  useEffect(() => { if (t.demoMode) { setWork((w) => (w === 25 * 60 ? 25 : w)); setRest((r) => (r === 5 * 60 ? 15 : r)); } }, [t.demoMode]);
  const [teamMode, setTeamMode] = useState(false);

  const room = t.snapshot?.room;
  const inRoom = Boolean(room);
  const voice = useVoice(client, t.socket, room?.id ?? null, t.snapshot?.me?.userId);

  useEffect(() => { document.title = "AntiStall"; }, []);

  // Первичный показ после загрузки: восстановленная комната → фокус-комната; ссылка-приглашение → настройки
  const booted = useRef(false);
  useEffect(() => {
    if (t.boot !== "ready" || booted.current) return;
    booted.current = true;
    if (inRoom) { setScreen("stage"); setOpen(false); }
    else if (routeCode) { setScreen("stage"); setOpen(true); }
  }, [t.boot, inRoom, routeCode]);

  // Вошли в комнату → настройки уходят, таймер уезжает в центр; вышли → панель возвращается
  const prevRoom = useRef<string | null>(null);
  useEffect(() => {
    const id = room?.id ?? null;
    if (id && prevRoom.current !== id) {
      setOpen(false);
      setWork(room!.settings.focusSec);
      setRest(room!.settings.breakSec);
      setCycles(room!.settings.cycles ?? 4);
      setDemo(room!.demo);
    }
    if (!id && prevRoom.current) { setOpen(true); setPanel(null); }
    prevRoom.current = id;
  }, [room]);

  const onBreak = inRoom && room!.phase === "break";
  const showGame = onBreak && gameOpen && !open; // игра существует только на перерыве
  const showMap = inRoom && mapOpen && !open;
  const showSocial = inRoom && panel === "social" && !open;
  const showStats = inRoom && panel === "stats" && !open;
  const showChat = inRoom && panel === "chat" && !open;
  const mode = open ? "settings" : showMap || showGame || showSocial || showStats || showChat ? "map" : "room";
  const phase = room?.phase;
  const { loadTd } = t;
  // Свежее состояние игры; два повода сразу (начало перерыва + раскрытие панели) — один запрос
  const lastTdLoad = useRef(0);
  const freshTd = useCallback(() => {
    if (Date.now() - lastTdLoad.current < 1000) return;
    lastTdLoad.current = Date.now();
    loadTd();
  }, [loadTd]);
  // Перерыв = время игры: фаза стала break — игра раскрывается сама и подгружает состояние;
  // перерыв кончился — панель игры закрывается. Явно открытые настройки (`open`) всё равно важнее: showGame их учитывает.
  const prevPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = inRoom ? phase : undefined;
    if (!inRoom) return;
    if (phase === "break" && was !== "break") {
      setPanel("game");
      freshTd();
    } else if (phase !== "break") setPanel((p) => (p === "game" ? null : p));
  }, [inRoom, phase, freshTd]);
  useEffect(() => { if (showGame) freshTd(); }, [showGame, freshTd]); // повторное открытие вручную — свежее состояние

  const dark = inRoom && room!.phase === "break" && !open;
  const vars = { ...(dark ? DARK_VARS : LIGHT_VARS), "--timer": open ? "#111111" : "var(--fg)" } as React.CSSProperties;
  const previewSeconds = work;
  // Сводка под таймером: настройки комнаты (если она есть) или введённые в форме
  const sumFocus = room ? room.settings.focusSec : work;
  const sumBreak = room ? room.settings.breakSec : rest;
  const sumCycles = room ? room.settings.cycles ?? 4 : cycles;

  const headBtn = "flex items-center gap-2 rounded-full bg-[var(--card)] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current";
  const reveal = {
    initial: { opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" },
    animate: { opacity: 1, clipPath: "inset(0% 0% 0% 0% round 24px)" },
    exit: { opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" },
    transition: reduce ? instant : { ...SPRING, opacity: { duration: 0.35 } },
  };
  const panelBox = "absolute inset-x-3 bottom-[5.5rem] top-[16rem] overflow-hidden rounded-[24px] bg-[var(--card)] sm:inset-x-6 sm:bottom-24 lg:top-[11.75rem]";

  const fieldAnimate = desktop
    ? { left: open ? "54%" : "0%", top: "0%" }
    : { left: "0%", top: open ? "38%" : "0%" };

  return (
    <MotionConfig reducedMotion="user">
      <div className="tomato-root fixed inset-0 overflow-hidden bg-white font-sans text-zinc-900 antialiased">
        <ConnectionBanner conn={t.conn} disconnectedFor={t.disconnectedFor} focusing={t.snapshot?.me?.status === "focusing"} graceSec={t.graceSec} />
        <Toasts toasts={t.toasts} />
        {inRoom && <PrankOverlay t={t} />}

        <AnimatePresence>
          {screen === "welcome" && <Welcome key="welcome" ready={t.boot === "ready"} serverOk={t.serverOk} demo={t.demoMode} onStart={() => { setScreen("stage"); setOpen(!inRoom); }} />}
        </AnimatePresence>

        <AnimatePresence>
          {screen === "stage" && (
            <motion.div key="stage" className="absolute inset-3 sm:inset-4" style={vars} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              {/* Серое поле: правая панель настроек ⇄ фокус-комната (одна и та же форма меняет размер) */}
              <motion.div
                className="absolute inset-0 overflow-hidden rounded-[28px] sm:rounded-[36px]"
                initial={{ opacity: 0, backgroundColor: FIELD_LIGHT, ...(desktop ? { left: "100%" } : { top: "100%" }) }}
                animate={{ opacity: 1, backgroundColor: dark ? FIELD_DARK : FIELD_LIGHT, ...fieldAnimate }}
                transition={reduce ? instant : { ...SPRING, backgroundColor: { duration: 0.9 }, opacity: { duration: 0.4 } }}
              />

              {/* Заглушка под Road Map / мини-игру: размытая карта из реальных данных */}
              <AnimatePresence>
                {inRoom && !open && mode === "room" && (
                  <motion.div key="roadmap" className="absolute inset-0" style={{ color: "var(--fg)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
                    <RoadmapBackdrop road={t.snapshot!.challenge} />
                    {room!.phase === "focus" && (
                      <p data-testid="game-later" className="pointer-events-none absolute inset-x-0 bottom-[6.25rem] text-center text-xs tracking-wide text-[var(--muted)] sm:bottom-28">
                        Игра откроется на перерыве
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Шапка комнаты */}
              <AnimatePresence>
                {inRoom && !open && (
                  <motion.header key="head" className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-5 sm:px-8" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={{ color: "var(--fg)" }}>
                    <div className="min-w-0">
                      <h1 className="truncate text-sm font-semibold">{room!.name}</h1>
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="font-mono text-xs tracking-widest text-[var(--muted)]">{room!.code}</p>
                        {t.demoMode && <DemoBadge compact className="min-w-0" />}
                      </div>
                    </div>
                    <ParticipantsRow t={t} voice={voice} className="order-last w-full flex-nowrap justify-start overflow-x-auto pb-1 lg:order-none lg:w-auto lg:min-w-0 lg:flex-1 lg:[justify-content:safe_center] [scrollbar-width:thin]" /* одна строка: высота шапки не зависит от числа игроков, иначе компактный таймер наезжает на участников */ />
                    <div className="flex items-center gap-2">
                      {onBreak && (
                        <button type="button" onClick={toggleGame} aria-pressed={gameOpen} className="flex items-center gap-2 rounded-full bg-[var(--card)] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" aria-label={gameOpen ? "Закрыть игру" : "Открыть игру"}>
                          {gameOpen ? <Timer size={16} /> : <Swords size={16} />} <span className="hidden sm:inline">{gameOpen ? "Таймер" : "Игра"}</span>
                        </button>
                      )}
                      <button type="button" onClick={() => toggle("social")} aria-pressed={panel === "social"} data-testid="open-social" className={headBtn} aria-label={panel === "social" ? "Вернуться к таймеру" : "Друзья: помощь и шутки"}>
                        {panel === "social" ? <Timer size={16} /> : <Users size={16} />} <span className="hidden sm:inline">{panel === "social" ? "Таймер" : "Друзья"}</span>
                      </button>
                      <button type="button" onClick={() => toggle("chat")} aria-pressed={panel === "chat"} data-testid="open-chat" className={headBtn} aria-label={panel === "chat" ? "Вернуться к таймеру" : "Чат комнаты"}>
                        {panel === "chat" ? <Timer size={16} /> : <MessageSquare size={16} />} <span className="hidden sm:inline">{panel === "chat" ? "Таймер" : "Чат"}</span>
                      </button>
                      <button type="button" onClick={() => toggle("stats")} aria-pressed={panel === "stats"} data-testid="open-stats" className={headBtn} aria-label={panel === "stats" ? "Вернуться к таймеру" : "Прогресс и статистика"}>
                        {panel === "stats" ? <Timer size={16} /> : <BarChart3 size={16} />} <span className="hidden sm:inline">{panel === "stats" ? "Таймер" : "Прогресс"}</span>
                      </button>
                      <button type="button" onClick={toggleMap} aria-pressed={mapOpen} className="flex items-center gap-2 rounded-full bg-[var(--card)] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" aria-label={mapOpen ? "Вернуться к таймеру" : "Открыть Road Map"}>
                        {mapOpen ? <Timer size={16} /> : <MapIcon size={16} />} <span className="hidden sm:inline">{mapOpen ? "Таймер" : "Карта"}</span>
                      </button>
                      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full bg-[var(--card)] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" aria-label="Открыть настройки">
                        <Settings size={16} /> <span className="hidden sm:inline">Настройки</span>
                      </button>
                    </div>
                  </motion.header>
                )}
              </AnimatePresence>

              {/* Таймер + то, что под ним. Сетка меняет раскладку — таймер плавно переезжает (layout). */}
              <div
                className={`pointer-events-none absolute inset-0 grid justify-items-center ${
                  open
                    ? desktop ? "grid-rows-[minmax(1.5rem,11vh)_auto_1fr] pr-[46%]" : "grid-rows-[minmax(.5rem,2vh)_auto_1fr] pb-[62%]"
                    : mode === "map" ? "grid-rows-[8.25rem_auto_1fr] lg:grid-rows-[4.25rem_auto_1fr]"
                    : "grid-rows-[1fr_auto_1fr]"
                }`}
              >
                <TimerBlock
                  t={t}
                  mode={mode}
                  previewSeconds={previewSeconds}
                  summary={!desktop ? null : (
                    <div className="flex h-28 min-w-40 flex-col items-center justify-center rounded-2xl bg-[#d9d9d9] px-4 text-zinc-900">
                      <span className="text-xl font-light tabular-nums">{formatSpan(sumFocus)} / {formatSpan(sumBreak)}</span>
                      <span className="mt-1 text-xs text-zinc-500">фокус / перерыв · циклов: {sumCycles}</span>
                    </div>
                  )}
                />
              </div>

              {/* Road Map раскрывается из центра; таймер при этом уменьшается и уходит наверх (layout) */}
              <AnimatePresence>
                {showMap && (
                  <motion.section
                    key="map"
                    aria-label="Road Map"
                    className="absolute inset-x-3 bottom-[5.5rem] top-[15rem] overflow-hidden rounded-[24px] bg-[var(--card)] sm:inset-x-6 sm:bottom-24 lg:top-[11.75rem]"
                    style={{ color: "var(--fg)" }}
                    initial={{ opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" }}
                    animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0% round 24px)" }}
                    exit={{ opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" }}
                    transition={reduce ? instant : { ...SPRING, opacity: { duration: 0.35 } }}
                  >
                    <RoadMap road={t.snapshot!.challenge} meId={t.snapshot!.me?.userId} />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Tower Defense: тот же раскрывающийся слой, но только на перерыве */}
              <AnimatePresence>
                {showGame && (
                  <motion.section
                    key="game"
                    aria-label="Tower Defense"
                    className="absolute inset-x-3 bottom-[5.5rem] top-[16rem] overflow-hidden rounded-[24px] bg-[var(--card)] sm:inset-x-6 sm:bottom-24 lg:top-[11.75rem]"
                    style={{ color: "var(--fg)" }}
                    initial={{ opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" }}
                    animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0% round 24px)" }}
                    exit={{ opacity: 0, clipPath: "inset(42% 32% 42% 32% round 28px)" }}
                    transition={reduce ? instant : { ...SPRING, opacity: { duration: 0.35 } }}
                  >
                    {t.td ? <TowerDefense td={t.td} actions={{ join: t.tdJoin, start: t.tdStart, build: t.tdBuild, upgrade: t.tdUpgrade, sendUnit: t.tdSendUnit, castSpell: t.tdCastSpell, rematch: t.tdRematch }} /> : <p className="p-6 text-sm text-[var(--muted)]">Загружаем игру…</p>}
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Друзья: помощь, шутки, лента. Во время Focus — только просмотр, действия заблокированы */}
              <AnimatePresence>
                {showSocial && (
                  <motion.section key="social" aria-label="Друзья" className={panelBox} style={{ color: "var(--fg)" }} {...reveal}>
                    <SocialPanel t={t} />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Статистика: личный и командный прогресс */}
              <AnimatePresence>
                {showStats && (
                  <motion.section key="stats" aria-label="Прогресс" className={panelBox} style={{ color: "var(--fg)" }} {...reveal}>
                    <StatsPanel t={t} />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Текстовый чат комнаты: в фокусе только чтение */}
              <AnimatePresence>
                {showChat && (
                  <motion.section key="chat" aria-label="Чат" className={panelBox} style={{ color: "var(--fg)" }} {...reveal}>
                    <ChatPanel t={t} />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Панель настроек выдвигается справа (на узких экранах — снизу) */}
              <AnimatePresence>
                {open && (
                  <motion.aside
                    key="panel"
                    aria-label="Настройки"
                    className={`absolute ${desktop ? "inset-y-0 right-0 w-[46%]" : "inset-x-0 bottom-0 h-[62%]"}`}
                    initial={desktop ? { x: "35%", opacity: 0 } : { y: "35%", opacity: 0 }}
                    animate={{ x: 0, y: 0, opacity: 1 }}
                    exit={desktop ? { x: "35%", opacity: 0 } : { y: "35%", opacity: 0 }}
                    transition={SPRING}
                  >
                    <SettingsContent
                      t={t}
                      initialCode={currentRouteCode()}
                      form={{ work, rest, cycles, demo, teamMode, setWork, setRest, setCycles, setDemo, setTeamMode }}
                      onCollapse={() => (inRoom ? setOpen(false) : setScreen("welcome"))}
                    />
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* Нижняя Voice-полоса */}
              <AnimatePresence>{inRoom && !open && <VoiceBar key="voice" conn={t.conn} voice={voice} meId={t.snapshot?.me?.userId} center={<button type="button" onClick={toggleMap} className="block w-full rounded-lg py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={mapOpen ? "Закрыть Road Map" : "Открыть Road Map"}><RoadmapSlot inline road={t.snapshot!.challenge} /></button>} />}</AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
