/**
 * Стикеры поверх комнаты: квадратные заметки, которые можно повесить в любое место экрана
 * (лобби, фокус, перерыв), перетащить за верхнюю полоску, написать текст и нарисовать от руки.
 * Это личная доска: стикеры видны только вам и хранятся в этом браузере — сервер их не знает.
 * Позиция хранится в долях экрана, поэтому стикер остаётся на месте при смене размера окна.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, GripHorizontal, Maximize2, Minus, Pencil, Type, X } from "lucide-react";

export interface Sticker { id: string; x: number; y: number; color: string; tilt: number; text: string; drawing: string | null; z?: number; collapsed?: boolean }
export const MAX_STICKERS = 8;
const COLORS = ["#FFCEC2", "#D9DE9F", "#FCE3DB", "#F3D9A4"];
const keyFor = (userId: string) => `antistall.stickers.${userId}`;

function load(userId: string): Sticker[] {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "[]");
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string").slice(0, MAX_STICKERS) : [];
  } catch { return []; }
}

/** Состояние стикеров одного пользователя: добавить, изменить, убрать, спрятать все. */
export function useStickers(userId: string | undefined) {
  const [items, setItems] = useState<Sticker[]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setItems(userId ? load(userId) : []); }, [userId]);
  useEffect(() => {
    if (!userId) return;
    try { localStorage.setItem(keyFor(userId), JSON.stringify(items)); } catch { /* переполнено или приватный режим — живут до перезагрузки */ }
  }, [items, userId]);
  const add = useCallback(() => {
    setHidden(false);
    setItems((all) => {
      if (all.length >= MAX_STICKERS) return all;
      const n = all.length;
      // новый стикер — в правом верхнем углу (не на таймере), лесенкой, чтобы не лечь ровно на предыдущий
      return [...all, { id: `${Date.now()}`, x: 0.68 - (n % 4) * 0.05, y: 0.3 + (n % 4) * 0.06, color: COLORS[n % COLORS.length], tilt: [-3, 2, -1.5, 2.5][n % 4], text: "", drawing: null }];
    });
  }, []);
  const update = useCallback((id: string, patch: Partial<Sticker>) => setItems((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s))), []);
  const remove = useCallback((id: string) => setItems((all) => all.filter((s) => s.id !== id)), []);
  // наверх — через z-index, без перестановки в списке: иначе браузер переставит элемент и потеряет захват мыши при перетаскивании
  const toFront = useCallback((id: string) => setItems((all) => {
    const top = Math.max(0, ...all.map((x) => x.z ?? 0));
    return all.find((x) => x.id === id)?.z === top && top > 0 ? all : all.map((x) => (x.id === id ? { ...x, z: top + 1 } : x));
  }), []);
  return { items, hidden, setHidden, add, update, remove, toFront, full: items.length >= MAX_STICKERS };
}
export type Stickers = ReturnType<typeof useStickers>;

function StickerNote({ s, board, active, onActivate, area }: { s: Sticker; board: Stickers; active: boolean; onActivate: () => void; area: { w: number; h: number } }) {
  const [mode, setMode] = useState<"text" | "draw">(s.drawing && !s.text ? "draw" : "text");
  const vp = area; // размеры области фокуса (между шапкой и полосой голоса), а не всего окна
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drag = useRef<{ cx: number; cy: number; x0: number; y0: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // во время перетаскивания — локально, без записи
  const size = Math.max(120, Math.min(vp.w < 600 ? 150 : vp.w < 1000 ? 176 : 196, vp.h - 8));
  const collapsed = Boolean(s.collapsed);
  // свёрнутый стикер — узкая плашка: занимает мало места и не закрывает таймер
  const w = collapsed ? Math.max(size, 190) : size, h = collapsed ? 40 : size;

  // Рисунок: восстановить сохранённый, подогнать под размер стикера
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext?.("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size * dpr; c.height = (size - 32) * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = "#3B2422";
    if (s.drawing) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, size, size - 32); img.src = s.drawing; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const penDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext?.("2d"); if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
    const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y); ctx.stroke();
  };
  const penMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext?.("2d"); if (!ctx) return;
    const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke();
  };
  const penUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    board.update(s.id, { drawing: canvas.current?.toDataURL("image/png") ?? null });
  };
  const clearDrawing = () => {
    const c = canvas.current; const ctx = c?.getContext?.("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    board.update(s.id, { drawing: null });
  };

  // Перетаскивание за полоску сверху; позиция в долях экрана, стикер не уходит за края
  // стикер не выходит за область фокуса (шапка с кнопками и полоса голоса остаются свободными)
  // отступ от краёв: стикер наклонён, его угол не должен заезжать на шапку и полосу голоса
  const M = 14;
  const clampPos = (px: number, py: number) => ({ x: Math.min(Math.max(px, M), Math.max(M, vp.w - w - M)) / vp.w, y: Math.min(Math.max(py, M), Math.max(M, vp.h - h - M)) / vp.h });
  const gripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onActivate(); board.toFront(s.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault(); // без выделения текста на странице во время перетаскивания
    drag.current = { cx: e.clientX, cy: e.clientY, x0: s.x * vp.w, y0: s.y * vp.h };
  };
  const gripMove = (e: React.PointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) setPos(clampPos(d.x0 + e.clientX - d.cx, d.y0 + e.clientY - d.cy)); };
  const gripUp = () => { if (drag.current && pos) board.update(s.id, pos); drag.current = null; setPos(null); };
  const keyMove = (e: React.KeyboardEvent<HTMLDivElement>) => { // клавиатура: стрелки двигают стикер
    const step = e.shiftKey ? 40 : 12;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault(); board.update(s.id, clampPos(s.x * vp.w + d[0], s.y * vp.h + d[1]));
  };

  const at = pos ?? { x: s.x, y: s.y };
  const left = Math.max(M, Math.min(at.x * vp.w, vp.w - w - M)), top = Math.max(M, Math.min(at.y * vp.h, vp.h - h - M));
  const preview = s.text.trim().split(/\s+/).slice(0, 4).join(" ") || (s.drawing ? "рисунок" : "пустой стикер");
  const tool = "flex h-7 w-7 items-center justify-center rounded-lg text-ink transition-colors hover:bg-white/60";
  return (
    <div
      role="group" aria-label="Стикер" data-sticker={s.id}
      onPointerDown={onActivate}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[10px] border-2 border-ink text-ink"
      style={{ left, top, width: w, height: h, zIndex: s.z ?? 0, background: s.color, transform: `rotate(${pos ? 0 : s.tilt}deg)`, boxShadow: active ? "0 8px 0 #3B2422" : "0 4px 0 #3B2422", transition: pos ? "none" : "transform .15s" }}
    >
      <div
        tabIndex={0} aria-label="Переместить стикер (стрелки)" onKeyDown={keyMove}
        onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp}
        className={`flex shrink-0 cursor-grab touch-none select-none items-center justify-between pl-1.5 pr-1 active:cursor-grabbing ${collapsed ? "h-full" : "h-8 border-b-2 border-ink/20 bg-black/[.04]"}`}
      >
        <GripHorizontal size={18} className="shrink-0 text-ink/60" aria-hidden />
        {collapsed && <span className="min-w-0 flex-1 truncate px-1.5 text-[13px] font-extrabold" title={s.text || undefined}>{preview}</span>}
        <div className="flex shrink-0 items-center">
          {collapsed ? (
            <button type="button" className={tool} aria-label="Развернуть стикер" title="Развернуть" onClick={() => board.update(s.id, { collapsed: false })}><Maximize2 size={14} /></button>
          ) : (<>
          <button type="button" className={`${tool} ${mode === "text" ? "bg-white/70" : ""}`} aria-pressed={mode === "text"} aria-label="Писать" title="Писать" onClick={() => setMode("text")}><Type size={15} /></button>
          <button type="button" className={`${tool} ${mode === "draw" ? "bg-white/70" : ""}`} aria-pressed={mode === "draw"} aria-label="Рисовать" title="Рисовать" onClick={() => setMode("draw")}><Pencil size={15} /></button>
          {s.drawing && <button type="button" className={tool} aria-label="Стереть рисунок" title="Стереть рисунок" onClick={clearDrawing}><Eraser size={15} /></button>}
          <button type="button" className={tool} aria-label="Свернуть стикер" title="Свернуть" onClick={() => board.update(s.id, { collapsed: true })}><Minus size={16} strokeWidth={2.6} /></button>
          </>)}
          <button type="button" className={tool} aria-label="Убрать стикер" title="Убрать стикер" onClick={() => board.remove(s.id)}><X size={16} strokeWidth={2.6} /></button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1" hidden={collapsed}>
        <canvas
          ref={canvas} aria-label="Поле для рисования"
          onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp}
          className={`absolute inset-0 h-full w-full ${mode === "draw" ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
        />
        <textarea
          value={s.text} maxLength={140} onChange={(e) => board.update(s.id, { text: e.target.value })}
          placeholder={mode === "text" ? "Напишите…" : ""} aria-label="Текст стикера"
          className={`absolute inset-0 h-full w-full resize-none bg-transparent p-2.5 text-[15px] font-bold leading-snug text-ink outline-none placeholder:font-semibold placeholder:text-ink/40 ${mode === "draw" ? "pointer-events-none" : ""}`}
        />
      </div>
    </div>
  );
}

/**
 * Слой стикеров внутри экрана фокуса: занимает область между шапкой и полосой голоса и лежит ПОВЕРХ таймера,
 * чтобы цифры не закрывали текст заметки. Мешает стикер — его можно свернуть в плашку или спрятать все разом.
 * Стикеры не могут попасть на кнопки шапки — область их не включает.
 */
export function StickerBoard({ board }: { board: Stickers }) {
  const [active, setActive] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setArea({ w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[15] overflow-hidden" data-testid="sticker-board" hidden={board.hidden || !board.items.length}>
      {area && area.w > 0 && board.items.map((s) => <StickerNote key={s.id} s={s} board={board} area={area} active={active === s.id} onActivate={() => setActive(s.id)} />)}
    </div>
  );
}
