import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Map as MapIcon, Settings, Timer } from "lucide-react";
import { useParams } from "react-router-dom";
import { ConnectionBanner, Toasts } from "./Chrome";
import { SPRING, FIELD_DARK, FIELD_LIGHT } from "./motion";
import { ParticipantsRow, RoadmapSlot } from "./RoomExtras";
import { RoadMap } from "./RoadMap";
import { RoadmapBackdrop } from "./RoadmapBackdrop";
import { SettingsContent } from "./SettingsContent";
import { TimerBlock } from "./TimerBlock";
import { useMediaQuery } from "./useMedia";
import { useTomato } from "./useTomato";
import { VoiceBar } from "./VoiceBar";
import { Welcome } from "./Welcome";

const MAP_KEY = "tomato2.mapOpen";
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

  const [screen, setScreen] = useState<"welcome" | "stage">("welcome");
  const [open, setOpen] = useState(false); // панель настроек
  const [mapOpen, setMapOpen] = useState(() => { try { return sessionStorage.getItem(MAP_KEY) === "1"; } catch { return false; } }); // Road Map (открывается отдельным действием)
  useEffect(() => { try { sessionStorage.setItem(MAP_KEY, mapOpen ? "1" : "0"); } catch { /* ignore */ } }, [mapOpen]);
  const [work, setWork] = useState(25);
  const [rest, setRest] = useState(5);
  const [demo, setDemo] = useState(false);
  const [teamMode, setTeamMode] = useState(false);

  const room = t.snapshot?.room;
  const inRoom = Boolean(room);

  useEffect(() => { document.title = "Tomato"; }, []);
  useEffect(() => { if (t.demoAvailable) setDemo(true); }, [t.demoAvailable]);

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
      setWork(room!.settings.focusSec / 60 >= 1 ? Math.round(room!.settings.focusSec / 60) : 25);
      setRest(room!.settings.breakSec / 60 >= 1 ? Math.round(room!.settings.breakSec / 60) : 5);
      setDemo(room!.demo);
    }
    if (!id && prevRoom.current) { setOpen(true); setMapOpen(false); }
    prevRoom.current = id;
  }, [room]);

  const showMap = inRoom && mapOpen && !open;
  const mode = open ? "settings" : showMap ? "map" : "room";
  const dark = inRoom && room!.phase === "break" && !open;
  const vars = { ...(dark ? DARK_VARS : LIGHT_VARS), "--timer": open ? "#111111" : "var(--fg)" } as React.CSSProperties;
  const previewSeconds = demo ? 25 : work * 60;
  // Сводка под таймером: настройки комнаты (если она есть) или выбранные в форме
  const sumDemo = room ? room.demo : demo;
  const sumFocus = room ? (room.demo ? room.settings.focusSec : room.settings.focusSec / 60) : demo ? 25 : work;
  const sumBreak = room ? (room.demo ? room.settings.breakSec : room.settings.breakSec / 60) : demo ? 15 : rest;
  const sumUnit = sumDemo ? "сек" : "мин";

  const fieldAnimate = desktop
    ? { left: open ? "54%" : "0%", top: "0%" }
    : { left: "0%", top: open ? "38%" : "0%" };

  return (
    <MotionConfig reducedMotion="user">
      <div className="fixed inset-0 overflow-hidden bg-white font-sans text-zinc-900 antialiased">
        <ConnectionBanner conn={t.conn} disconnectedFor={t.disconnectedFor} focusing={t.snapshot?.me?.status === "focusing"} />
        <Toasts toasts={t.toasts} />

        <AnimatePresence>
          {screen === "welcome" && <Welcome key="welcome" ready={t.boot === "ready"} serverOk={t.serverOk} onStart={() => { setScreen("stage"); setOpen(!inRoom); }} />}
        </AnimatePresence>

        <AnimatePresence>
          {screen === "stage" && (
            <motion.div key="stage" className="absolute inset-3 sm:inset-4" style={vars} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              {/* Серое поле: правая панель настроек ⇄ фокус-комната (одна и та же форма меняет размер) */}
              <motion.div
                className="absolute inset-0 overflow-hidden rounded-[28px] sm:rounded-[36px]"
                initial={{ opacity: 0, backgroundColor: FIELD_LIGHT, ...(desktop ? { left: "100%" } : { top: "100%" }) }}
                animate={{ opacity: 1, backgroundColor: dark ? FIELD_DARK : FIELD_LIGHT, ...fieldAnimate }}
                transition={{ ...SPRING, backgroundColor: { duration: 0.9 }, opacity: { duration: 0.4 } }}
              />

              {/* Заглушка под Road Map / мини-игру: размытая карта из реальных данных */}
              <AnimatePresence>
                {inRoom && !open && !mapOpen && (
                  <motion.div key="roadmap" className="absolute inset-0" style={{ color: "var(--fg)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
                    <RoadmapBackdrop road={t.snapshot!.challenge} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Шапка комнаты */}
              <AnimatePresence>
                {inRoom && !open && (
                  <motion.header key="head" className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-5 sm:px-8" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={{ color: "var(--fg)" }}>
                    <div className="min-w-0">
                      <h1 className="truncate text-sm font-semibold">{room!.name}</h1>
                      <p className="font-mono text-xs tracking-widest text-[var(--muted)]">{room!.code}</p>
                    </div>
                    <ParticipantsRow t={t} className="order-last w-full flex-nowrap justify-start overflow-x-auto pb-1 lg:order-none lg:w-auto lg:flex-wrap lg:justify-center lg:overflow-visible lg:pb-0" />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setMapOpen((v) => !v)} aria-pressed={mapOpen} className="flex items-center gap-2 rounded-full bg-[var(--card)] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" aria-label={mapOpen ? "Вернуться к таймеру" : "Открыть Road Map"}>
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
                    : showMap ? "grid-rows-[8.25rem_auto_1fr] lg:grid-rows-[4.25rem_auto_1fr]"
                    : "grid-rows-[1fr_auto_1fr]"
                }`}
              >
                <TimerBlock
                  t={t}
                  mode={mode}
                  previewSeconds={previewSeconds}
                  summary={!desktop ? null : (
                    <div className="flex h-28 w-40 flex-col items-center justify-center rounded-2xl bg-[#d9d9d9] text-zinc-900">
                      <span className="text-3xl font-light tabular-nums">{sumFocus} / {sumBreak}</span>
                      <span className="mt-1 text-xs text-zinc-500">фокус / перерыв, {sumUnit}</span>
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
                    transition={{ ...SPRING, opacity: { duration: 0.35 } }}
                  >
                    <RoadMap road={t.snapshot!.challenge} meId={t.snapshot!.me?.userId} />
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
                      initialCode={routeCode ?? ""}
                      form={{ work, rest, demo, teamMode, setWork, setRest, setDemo, setTeamMode }}
                      onCollapse={() => (inRoom ? setOpen(false) : setScreen("welcome"))}
                    />
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* Нижняя Voice-полоса */}
              <AnimatePresence>{inRoom && !open && <VoiceBar key="voice" conn={t.conn} center={<button type="button" onClick={() => setMapOpen((v) => !v)} className="block w-full rounded-lg py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={mapOpen ? "Закрыть Road Map" : "Открыть Road Map"}><RoadmapSlot inline road={t.snapshot!.challenge} /></button>} />}</AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
