/**
 * 08 Room / Break (Figma, страница back): перерыв = время игры.
 * Слева — поле Tower Defense на всю высоту, справа — кнопка карты, итог цикла и одна карточка «Чат / Друзья».
 */
import { useState } from "react";
import { Map as MapIcon, MessageCircle, SkipForward, Users } from "lucide-react";
import { ChatPanel } from "../ChatPanel";
import { SocialPanel } from "../SocialPanel";
import { TowerDefense } from "../TowerDefense";
import type { Tomato } from "../useTomato";
import { LIGHT_VARS } from "./RoomChrome";

export function BreakRoom({ t, onOpenMap }: { t: Tomato; onOpenMap: () => void }) {
  const snap = t.snapshot!;
  const me = snap.me;
  const actions = me?.allowedActions ?? [];
  const td = t.td;
  // «Как прошла сессия?» — влияет только на историю, отмечается один раз за перерыв
  const [sent, setSent] = useState<string | null>(null);
  const sess = me?.session;
  const askResult = Boolean(sess && sess.status !== "active" && sent !== snap.room.cycleId && actions.includes("record_result"));
  const [side, setSide] = useState<"chat" | "friends">("chat");
  const road = snap.challenge;
  return (
    <div className="grid min-h-0 flex-1 gap-4 px-3 pb-4 sm:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:gap-6 lg:px-12" style={LIGHT_VARS}>
      {/* Игра — главное на перерыве: занимает почти весь экран, без лишних полосок сверху */}
      <section aria-label="Tower Defense" className="as-card as-shadow min-w-0 overflow-hidden border-[2.5px] bg-lime" style={{ ["--card" as string]: "#FFFFFF" }}>
        <div className="h-auto lg:h-[min(80vh,760px)]">
          {/* td от прошлой фазы (enabled = false) не показываем: на долю секунды мелькало бы «сейчас время учёбы» */}
          {td?.enabled ? (
            <TowerDefense td={td} actions={{ join: t.tdJoin, start: t.tdStart, build: t.tdBuild, upgrade: t.tdUpgrade, sendUnit: t.tdSendUnit, castSpell: t.tdCastSpell, rematch: t.tdRematch }} />
          ) : (
            <p className="p-6 text-lg font-bold text-olive">Загружаем игру…</p>
          )}
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-4">
        {/* Дорога команды одной строкой — полная карта по кнопке */}
        <button type="button" onClick={onOpenMap} className="flex items-center gap-3 rounded-[20px] border-2 border-ink bg-paper px-4 py-3 text-left hover:bg-petal">
          <MapIcon size={22} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold">Карта команды · {road.points}/{road.goal}</span>
            <span className="block truncate text-sm text-mute">{road.next ? `Дальше: «${road.next.title}» — нужна победа в игре` : "Цель достигнута"}</span>
          </span>
        </button>

        {/* «Я готов» на перерыве не нужен: следующий фокус по плану начнётся сам, а после плана готовность спросит лобби */}
        {(askResult || actions.includes("skip_break")) && (
          <section aria-label="После цикла" className="flex flex-col gap-3 rounded-[20px] border-2 border-soft p-4">
            {askResult && (
              <div className="flex flex-wrap items-center gap-2 text-[15px]">
                <span className="font-bold text-mute">Как прошла сессия?</span>
                {([["done", "Сделал"], ["partial", "Частично"], ["not_done", "Не успел"]] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => { t.recordResult(v); setSent(snap.room.cycleId); }} className="rounded-full border-2 border-ink bg-white px-3 py-1 font-extrabold hover:bg-petal">{label}</button>
                ))}
              </div>
            )}
            {actions.includes("skip_break") && (
              <button type="button" onClick={t.skipBreak} className="as-btn as-btn-secondary as-btn-sm self-start"><SkipForward size={18} aria-hidden /> Пропустить перерыв</button>
            )}
          </section>
        )}

        {/* Чат и друзья — одна карточка с вкладками вместо двух */}
        <section id="break-social" aria-label="Чат и друзья" className="flex min-h-[360px] flex-col overflow-hidden rounded-[24px] border-2 border-soft bg-paper xl:min-h-0 xl:flex-1">
          <div role="tablist" className="grid grid-cols-2 gap-1 border-b-2 border-soft bg-white p-1.5">
            {([["chat", "Чат", MessageCircle], ["friends", `Друзья · ${snap.members.length}`, Users]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={side === id} onClick={() => setSide(id)}
                className={`flex items-center justify-center gap-2 rounded-[12px] py-2 text-[15px] font-extrabold ${side === id ? "bg-ink text-cream" : "text-ink hover:bg-paper"}`}>
                <Icon size={17} aria-hidden />{label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col" hidden={side !== "chat"}><ChatPanel t={t} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white" hidden={side !== "friends"}><SocialPanel t={t} /></div>
        </section>
      </div>
    </div>
  );
}
