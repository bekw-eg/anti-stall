/**
 * 08 Room / Break (Figma, страница back): перерыв = время игры.
 * Сверху — дорога команды к цели, ниже — игра. Друзья — по кнопке в шапке. Чат — колонкой справа от игры
 * (на том же месте, что в лобби и на фокусе) от 1280 px; на узких экранах — облачко в углу, чтобы игре хватило места.
 */
import { useState } from "react";
import { Check, Flag, SkipForward } from "lucide-react";
import { ChatBubble } from "../ChatBubble";
import { CHAT_CARD_SIZE, ChatPanel } from "../ChatPanel";
import { Harvest } from "../Harvest";
import { TowerDefense } from "../TowerDefense";
import type { Tomato } from "../useTomato";
import { LIGHT_VARS } from "./RoomChrome";

/** Полоска узлов карты из реальных данных сервера (полная карта — в панели «Карта»). */
function RoadStrip({ t, onOpenMap }: { t: Tomato; onOpenMap: () => void }) {
  const road = t.snapshot!.challenge;
  const nodes = road.nodes ?? [];
  const current = nodes.find((n) => n.status === "current") ?? nodes.find((n) => n.status === "next");
  return (
    <section aria-label="Дорога команды" className="flex flex-col gap-2.5 rounded-[20px] bg-paper p-3 sm:flex-row sm:items-center sm:gap-6 sm:rounded-[28px] sm:p-5">
      {/* на телефоне узлы — одной строкой с прокруткой, а не стопкой из трёх строк над игрой */}
      <ol className="-mx-1 flex min-w-0 flex-1 flex-nowrap items-center gap-x-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:gap-y-2 sm:overflow-visible sm:px-0 sm:pb-0" aria-label="Узлы карты">
        {nodes.map((n, i) => {
          const done = n.status === "completed";
          const here = n === current;
          return (
            <li key={n.id} className="flex min-w-0 shrink-0 items-center gap-1">
              {i > 0 && <span className={`h-1.5 w-6 rounded-full sm:w-10 ${done || here ? "bg-peach" : "bg-line"}`} aria-hidden />}
              <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 px-2.5 py-1 text-[13px] font-extrabold sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[15px] ${here ? "border-ink bg-peach text-ink" : done ? "border-peach bg-white text-ink" : "border-line bg-white text-mute"}`}>
                {here && <Flag size={14} aria-hidden />}{done && <Check size={14} aria-hidden />}{n.title}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex shrink-0 items-center justify-between gap-4">
        <p className="text-[15px] text-mute"><span className="font-display text-xl text-ink sm:text-2xl"><span className="relative top-0.5">{road.points}/{road.goal}</span></span> побед до цели</p>
        <button type="button" onClick={onOpenMap} className="as-btn as-btn-secondary as-btn-sm">Карта</button>
      </div>
    </section>
  );
}

export function BreakRoom({ t, onOpenMap }: { t: Tomato; onOpenMap: () => void }) {
  const snap = t.snapshot!;
  const me = snap.me;
  const actions = me?.allowedActions ?? [];
  const td = t.td;
  // «Как прошла сессия?» — влияет только на историю, отмечается один раз за перерыв
  const [sent, setSent] = useState<string | null>(null);
  const sess = me?.session;
  const askResult = Boolean(sess && sess.status !== "active" && sent !== snap.room.cycleId && actions.includes("record_result"));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 sm:px-8 lg:px-12" style={LIGHT_VARS}>
      <div className="flex flex-col gap-3">
        <RoadStrip t={t} onOpenMap={onOpenMap} />
        {/* «Я готов» на перерыве не нужен: следующий фокус по плану начнётся сам, а после плана готовность спросит лобби */}
        {(askResult || actions.includes("skip_break")) && (
          <section aria-label="После цикла" className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] bg-paper px-3 py-2 sm:rounded-[28px] sm:px-5">
            {askResult && (
              // три ответа — одной строкой-переключателем (на телефоне подпись над ним), а не россыпью по разным строкам
              <div className="flex w-full flex-col gap-1.5 text-[15px] sm:w-auto sm:flex-row sm:items-center sm:gap-3">
                <span className="font-bold text-mute">Как прошла сессия?</span>
                <div role="group" aria-label="Как прошла сессия" className="grid grid-cols-3 overflow-hidden rounded-full border-2 border-ink bg-white sm:inline-grid">
                  {([["done", "Сделал"], ["partial", "Частично"], ["not_done", "Не успел"]] as const).map(([v, label], i) => (
                    <button key={v} type="button" onClick={() => { t.recordResult(v); setSent(snap.room.cycleId); }}
                      className={`whitespace-nowrap px-2 py-1.5 font-extrabold transition-colors hover:bg-petal sm:px-4 ${i ? "border-l-2 border-ink" : ""}`}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            {actions.includes("skip_break") && (
              <button type="button" onClick={t.skipBreak} className="as-btn as-btn-secondary as-btn-sm"><SkipForward size={18} aria-hidden /> Пропустить перерыв</button>
            )}
          </section>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div className="min-w-0">
      {snap.room.breakGame === "harvest" ? (
        // чётный перерыв — Harvest (Tower Defense — на нечётных)
        <section aria-label="Harvest" className="as-card as-shadow overflow-hidden border-[2.5px] bg-lime">
          <Harvest t={t} />
        </section>
      ) : (
      <section aria-label="Tower Defense" className="as-card as-shadow overflow-hidden border-[2.5px] bg-lime" style={{ ["--card" as string]: "#FFFFFF" }}>
        <div className="h-auto lg:h-[min(78vh,760px)]">
          {td ? (
            <TowerDefense td={td} actions={{ join: t.tdJoin, start: t.tdStart, build: t.tdBuild, upgrade: t.tdUpgrade, sendUnit: t.tdSendUnit, castSpell: t.tdCastSpell }} fx={t.tdFx} looks={Object.fromEntries(snap.members.map((m) => [m.userId, m.avatar]))} />
          ) : (
            <p className="p-6 text-lg font-bold text-olive">Загружаем игру…</p>
          )}
        </div>
      </section>
      )}
      </div>
      <aside aria-label="Чат комнаты" className={`as-card as-shadow hidden ${CHAT_CARD_SIZE} flex-col overflow-hidden border-[2.5px] bg-white xl:sticky xl:top-28 xl:flex`}>
        <ChatPanel t={t} />
      </aside>
      </div>
      <ChatBubble t={t} />
    </div>
  );
}
