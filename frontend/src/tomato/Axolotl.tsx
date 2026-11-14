/**
 * Пиксельный аксолотль игрока: спрайт цвета (448×448, сетка 32×32 «пикселя» по 14 px) и аксессуары,
 * нарисованные в той же сетке — поэтому вещи садятся на голову без размытия и не выбиваются из стиля.
 * Один и тот же рисунок используется в жетонах участников, на странице образа и в башнях Tower Wars.
 */
import type { AvatarLook, AvatarSkin } from "@/api/tomato";
import pink from "@/assets/axolotl/pink.png";
import blue from "@/assets/axolotl/blue.png";
import mint from "@/assets/axolotl/mint.png";
import yellow from "@/assets/axolotl/yellow.png";
import purple from "@/assets/axolotl/purple.png";
import orange from "@/assets/axolotl/orange.png";

export const SKIN_SRC: Record<AvatarSkin, string> = { pink, blue, mint, yellow, purple, orange };
/** Фон жетона под цвет аксолотля: светлый тон той же гаммы. */
export const SKIN_BG: Record<AvatarSkin, string> = {
  pink: "#FFE1E6", blue: "#DCEBFF", mint: "#D6F5EA", yellow: "#FFF1C4", purple: "#EEE0FF", orange: "#FFE2CC",
};
export const SKINS = Object.keys(SKIN_SRC) as AvatarSkin[];
const FREE: AvatarSkin[] = ["pink", "blue", "mint"];

/** Цвет по умолчанию, пока игрок ничего не выбрал (как на сервере: из id). */
export function defaultSkin(id: string | undefined): AvatarSkin {
  let h = 0;
  for (const ch of String(id ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FREE[h % FREE.length];
}
export const lookOf = (id: string | undefined, look?: Partial<AvatarLook> | null): AvatarLook =>
  ({ skin: look?.skin && SKIN_SRC[look.skin] ? look.skin : defaultSkin(id), head: look?.head ?? null, face: look?.face ?? null, neck: look?.neck ?? null });

const P = 14; // один «пиксель» спрайта

/** Палитры вещей. K — контур (тон контура спрайтов), остальные буквы — цвета конкретной вещи. */
const K = "#2E1A1C";
interface Art { x: number; y: number; rows: string[]; colors: Record<string, string> }

/** Пиксельные вещи: x, y — левая верхняя клетка в сетке 32×32 спрайта. Симметричные вещи центрированы по x = 16. */
export const ITEM_ART: Record<string, Art> = {
  crown: {
    x: 11, y: 2, colors: { K, Y: "#F2B84B", L: "#FFE08A", R: "#E5534B", B: "#4FA3E8" },
    rows: [
      "K...KK...K",
      "KK.KLLK.KK",
      "KYKYLYYKYK",
      "KYBYRRYBYK",
      "KLYYYYYYYK",
      "KKKKKKKKKK",
    ],
  },
  beanie: {
    x: 10, y: 1, colors: { K, W: "#FFF4EF", R: "#E5675A", D: "#C24E43" },
    rows: [
      ".....KK.....",
      "....KWWK....",
      "..KKKKKKKK..",
      ".KRRDRRDRRK.",
      "KRRDRRDRRDRK",
      "KWWWWWWWWWWK",
      "KKKKKKKKKKKK",
    ],
  },
  party: {
    x: 12, y: -1, colors: { K, Y: "#FFD447", T: "#58C4BC", S: "#FF8FB1" },
    rows: [
      "...YY...",
      "...KK...",
      "..KTTK..",
      "..KSTK..",
      ".KTTSTK.",
      ".KSTTTK.",
      "KTTSTTSK",
      "KKKKKKKK",
    ],
  },
  bow: {
    x: 19, y: 3, colors: { K, R: "#E5534B", L: "#FF8C82", Y: "#FFD447" },
    rows: [
      "KK...KK",
      "KLKKKLK",
      "KRRYRRK",
      "KRKKKRK",
      "KK...KK",
    ],
  },
  headphones: {
    x: 5, y: 4, colors: { K, G: "#7D625E", C: "#EAA695", L: "#FFCEC2" },
    rows: [
      "......KKKKKKKKKK......",
      ".....KGGGGGGGGGGK.....",
      "....KGK........KGK....",
      "...KGK..........KGK...",
      "..KGK............KGK..",
      ".KKKK............KKKK.",
      "KCLCK............KCLCK",
      "KCCCK............KCCCK",
      "KCCCK............KCCCK",
      ".KKK..............KKK.",
    ],
  },
  glasses: {
    x: 9, y: 10, colors: { K, g: "rgba(255,255,255,.28)" },
    rows: [
      "KKKKK....KKKKK",
      "KgggKKKKKKgggK",
      "KgggK....KgggK",
      "KgggK....KgggK",
      "KKKKK....KKKKK",
    ],
  },
  shades: {
    x: 9, y: 10, colors: { K, D: "#2B2B3A", W: "#8E8EA8" },
    rows: [
      "KKKKKKKKKKKKKK",
      "KWDDKKKKKKWDDK",
      "KDDDK....KDDDK",
      "KDDDK....KDDDK",
      ".KKK......KKK.",
    ],
  },
  scarf: {
    x: 9, y: 17, colors: { K, R: "#E5675A", W: "#FFF4EF" },
    rows: [
      "KKKKKKKKKKKKKK",
      "KRRWRRWRRWRRRK",
      "KKKKKKKKKRRWRK",
      ".........KRRK.",
      ".........KWRK.",
      ".........KRRK.",
      ".........KKKK.",
    ],
  },
  /** Только для башен: шлем 2-го уровня. */
  helmet: {
    x: 10, y: 2, colors: { K, C: "#5E6B1F", S: "#B8C2CC", W: "#F4F7FB" },
    rows: [
      "....KCCK....",
      "..KKKKKKKK..",
      ".KSSWSSSSSK.",
      "KSSWSSSSSSSK",
      "KSSSSSSSSSSK",
      "KKKKKKKKKKKK",
    ],
  },
};

/** Пути одной вещи: по одному <path> на цвет — узлов мало даже на поле с десятком башен. */
export function ItemPaths({ id }: { id: string }) {
  const art = ITEM_ART[id];
  if (!art) return null;
  const byColor = new Map<string, string>();
  art.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = row[dx];
      if (c === ".") continue;
      byColor.set(c, (byColor.get(c) ?? "") + `M${(art.x + dx) * P} ${(art.y + dy) * P}h${P}v${P}h-${P}z`);
    }
  });
  return (
    <g data-item={id}>
      {[...byColor].map(([c, d]) => <path key={c} d={d} fill={art.colors[c]} />)}
    </g>
  );
}

/**
 * Рисунок в координатах спрайта (0..448) — для вставки в любой <svg> (башни Tower Wars).
 * Порядок слоёв: шея → лицо → голова (шапка поверх жабр).
 */
export function AxolotlGlyph({ look, head }: { look: AvatarLook; head?: string | null }) {
  const hat = head === undefined ? look.head : head;
  return (
    <g shapeRendering="crispEdges" data-skin={look.skin}>
      <image href={SKIN_SRC[look.skin]} x={0} y={0} width={448} height={448} style={{ imageRendering: "pixelated" }} preserveAspectRatio="none" />
      {look.neck && <ItemPaths id={look.neck} />}
      {look.face && <ItemPaths id={look.face} />}
      {hat && <ItemPaths id={hat} />}
    </g>
  );
}

/** Самостоятельный аксолотль. crop="head" — голова и плечи для круглых жетонов. */
export function Axolotl({ look, size = 96, crop = "full", className = "", title }: { look: AvatarLook; size?: number; crop?: "full" | "head"; className?: string; title?: string }) {
  const viewBox = crop === "head" ? "84 28 280 280" : "0 -14 448 448";
  return (
    <svg viewBox={viewBox} width={size} height={size} className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <AxolotlGlyph look={look} />
    </svg>
  );
}

/** Вещь отдельно (иконка в инвентаре): viewBox по её клеткам с полями. */
export function ItemIcon({ id, size = 48, className = "" }: { id: string; size?: number; className?: string }) {
  const art = ITEM_ART[id];
  if (!art) return null;
  const w = Math.max(...art.rows.map((r) => r.length)) * P, h = art.rows.length * P;
  const side = Math.max(w, h) + P;
  const x = art.x * P - (side - w) / 2, y = art.y * P - (side - h) / 2;
  return (
    <svg viewBox={`${x} ${y} ${side} ${side}`} width={size} height={size} className={className} aria-hidden focusable="false" shapeRendering="crispEdges">
      <ItemPaths id={id} />
    </svg>
  );
}
