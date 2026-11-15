/**
 * Стикеры поверх комнаты: квадратные заметки, которые можно повесить в любое место экрана
 * (лобби, фокус, перерыв), перетащить за верхнюю полоску, написать текст и нарисовать от руки.
 * Это личная доска: стикеры видны только вам и хранятся в этом браузере — сервер их не знает.
 * Позиция хранится в долях экрана, поэтому стикер остаётся на месте при смене размера окна.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, GripHorizontal, MoveDiagonal2, Pencil, StickyNote, Type, X } from "lucide-react";

/** scale — размер стикера относительно обычного (0.6…1.6), меняется за уголок */
export interface Sticker { id: string; x: number; y: number; color: string; tilt: number; text: string; drawing: string | null; z?: number; scale?: number }
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100));
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
      // новый стикер — не на таймере, лесенкой, чтобы не лечь ровно на предыдущий:
      // на широком экране справа сверху (над закрытой картой), на узком — ниже таймера и полосы прогресса
      const narrow = typeof window !== "undefined" && window.innerWidth < 1024;
      const x = narrow ? 0.06 + (n % 4) * 0.06 : 0.68 - (n % 4) * 0.05;
      const y = narrow ? 0.3 + (n % 4) * 0.04 : 0.16 + (n % 4) * 0.06;
      return [...all, { id: `${Date.now()}`, x, y, color: COLORS[n % COLORS.length], tilt: [-3, 2, -1.5, 2.5][n % 4], text: "", drawing: null, scale: narrow ? 0.85 : 1 }];
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
  const [liveScale, setLiveScale] = useState<number | null>(null); // во время изменения размера — локально
  const resize = useRef<{ cx: number; cy: number; s0: number } | null>(null);
  const base = vp.w < 600 ? 150 : vp.w < 1000 ? 184 : 210;
  const scale = liveScale ?? s.scale ?? 1;
  const size = Math.round(Math.max(96, Math.min(base * scale, vp.h - 8, vp.w - 28)));

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
  const clampPos = (px: number, py: number) => ({ x: Math.min(Math.max(px, M), Math.max(M, vp.w - size - M)) / vp.w, y: Math.min(Math.max(py, M), Math.max(M, vp.h - size - M)) / vp.h });
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

  // Размер: тянуть за уголок справа снизу (или +/− на нём с клавиатуры)
  const sizeDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    onActivate(); board.toFront(s.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
    resize.current = { cx: e.clientX, cy: e.clientY, s0: s.scale ?? 1 };
  };
  const sizeMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = resize.current; if (!r) return;
    const d = (e.clientX - r.cx + e.clientY - r.cy) / 2;
    setLiveScale(clampScale(r.s0 + d / base));
  };
  const sizeUp = () => { if (resize.current && liveScale !== null) board.update(s.id, { scale: liveScale }); resize.current = null; setLiveScale(null); };
  const sizeKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === "+" || e.key === "=" || e.key === "ArrowUp" ? 0.1 : e.key === "-" || e.key === "ArrowDown" ? -0.1 : 0;
    if (!d) return;
    e.preventDefault(); board.update(s.id, { scale: clampScale((s.scale ?? 1) + d) });
  };

  const at = pos ?? { x: s.x, y: s.y };
  const left = Math.max(M, Math.min(at.x * vp.w, vp.w - size - M)), top = Math.max(M, Math.min(at.y * vp.h, vp.h - size - M));
  const tool = "flex h-7 w-7 items-center justify-center rounded-lg text-ink transition-colors hover:bg-white/60";
  return (
    <div
      role="group" aria-label="Стикер" data-sticker={s.id}
      onPointerDown={onActivate}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[10px] border-2 border-ink text-ink"
      style={{ left, top, width: size, height: size, zIndex: s.z ?? 0, background: s.color, transform: `rotate(${pos || liveScale !== null ? 0 : s.tilt}deg)`, boxShadow: active ? "0 8px 0 #3B2422" : "0 4px 0 #3B2422", transition: pos || liveScale !== null ? "none" : "transform .15s" }}
    >
      <div
        tabIndex={0} aria-label="Переместить стикер (стрелки)" onKeyDown={keyMove}
        onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp}
        className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center justify-between border-b-2 border-ink/20 bg-black/[.04] pl-1.5 pr-1 active:cursor-grabbing"
      >
        <GripHorizontal size={18} className="text-ink/60" aria-hidden />
        <div className="flex items-center">
          <button type="button" className={`${tool} ${mode === "text" ? "bg-white/70" : ""}`} aria-pressed={mode === "text"} aria-label="Писать" title="Писать" onClick={() => setMode("text")}><Type size={15} /></button>
          <button type="button" className={`${tool} ${mode === "draw" ? "bg-white/70" : ""}`} aria-pressed={mode === "draw"} aria-label="Рисовать" title="Рисовать" onClick={() => setMode("draw")}><Pencil size={15} /></button>
          {s.drawing && <button type="button" className={tool} aria-label="Стереть рисунок" title="Стереть рисунок" onClick={clearDrawing}><Eraser size={15} /></button>}
          <button type="button" className={tool} aria-label="Убрать стикер" title="Убрать стикер" onClick={() => board.remove(s.id)}><X size={16} strokeWidth={2.6} /></button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvas} aria-label="Поле для рисования"
          onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp}
          className={`absolute inset-0 h-full w-full ${mode === "draw" ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
        />
        <textarea
          value={s.text} maxLength={140} onChange={(e) => board.update(s.id, { text: e.target.value })}
          placeholder={mode === "text" ? "Напишите…" : ""} aria-label="Текст стикера"
          className={`absolute inset-0 h-full w-full resize-none bg-transparent p-2.5 pb-5 font-bold leading-snug text-ink outline-none placeholder:font-semibold placeholder:text-ink/50 ${size < 130 ? "text-[13px]" : "text-[15px]"} ${mode === "draw" ? "pointer-events-none" : ""}`}
        />
        <button
          type="button" aria-label="Изменить размер стикера (тяните или +/−)" title="Тяните, чтобы изменить размер"
          onPointerDown={sizeDown} onPointerMove={sizeMove} onPointerUp={sizeUp} onPointerCancel={sizeUp} onKeyDown={sizeKey}
          className="absolute bottom-0.5 right-0.5 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-md text-ink/60 hover:bg-white/60 hover:text-ink"
        >
          <MoveDiagonal2 size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

const HINT_KEY = "antistall.stickers.hint";

/**
 * Подсказка над таймером: что такое стикеры и как с ними работать. Закрывается крестиком навсегда (в этом браузере).
 */
export function StickerHint({ board }: { board: Stickers }) {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return true; } });
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem(HINT_KEY, "1"); } catch { /* приватный режим */ } };
  const has = board.items.length > 0;
  return (
    <div role="note" data-testid="sticker-hint" className="relative z-10 flex w-full max-w-[620px] items-start gap-2.5 rounded-[16px] border-2 border-[#8A625C] bg-cocoa/80 px-3 py-2 text-left text-sm text-cream sm:text-[15px]">
      <StickyNote size={18} className="mt-0.5 shrink-0 text-peach" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        {has
          ? <>Стикер — ваша заметка на время фокуса: <b>Т</b> — писать, <b>карандаш</b> — рисовать, тяните за верх, размер — за уголок. Видно только вам.</>
          : <>Нужна заметка или шпаргалка? Нажмите <b>«Стикер»</b> в шапке: можно писать и рисовать. Видно только вам.</>}
      </p>
      {has && (
        <button type="button" onClick={close} aria-label="Скрыть подсказку" className="shrink-0 rounded-lg p-0.5 text-[#D8BDB6] hover:bg-cocoa hover:text-cream"><X size={16} /></button>
      )}
    </div>
  );
}

/**
 * Слой стикеров внутри экрана фокуса: занимает область между шапкой и полосой голоса и лежит поверх таймера,
 * чтобы таймер и полоса прогресса не закрывали текст стикера. Стикеры не могут попасть на кнопки шапки — область их не включает.
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
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[25] overflow-hidden" data-testid="sticker-board" hidden={board.hidden || !board.items.length}>
      {area && area.w > 0 && board.items.map((s) => <StickerNote key={s.id} s={s} board={board} area={area} active={active === s.id} onActivate={() => setActive(s.id)} />)}
    </div>
  );
}
