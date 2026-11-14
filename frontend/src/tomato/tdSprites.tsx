import { useId } from "react";
import { useReducedMotion } from "framer-motion";
import type { TowerType } from "@/api/tomato";

/**
 * Процедурные SVG-спрайты Tower Wars «Аксолотли против Томатиков»: башни-аксолотли, Академия и портал.
 * Без картинок и шрифтов — только фигуры. Единица измерения снаружи — клетка поля: компонент рисует `<g>`
 * вокруг (0,0), вызывающий оборачивает его в `<g transform="translate(x y)">`.
 * Внутри рисуем в удобной сетке ±100 и масштабируем до нужного радиуса.
 * Анимации (аура, молнии, щит, вихрь портала) — SMIL, и только если пользователь не просил меньше движения.
 */

/** Безопасный для `url(#…)` идентификатор: React useId содержит двоеточия. */
const useSvgId = () => "td" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

interface Palette {
  body: [string, string];
  belly: string;
  gill: string;
  gillLight: string;
  cheek: string;
  eye: string;
  outline: string;
  crest: string;
}

const PALETTE: Record<TowerType, Palette> = {
  arrow: { body: ["#ffd0dd", "#f08aac"], belly: "#ffe6ee", gill: "#df3f74", gillLight: "#ffa3c1", cheek: "#ff6f9a", eye: "#2b1a2e", outline: "#b8456d", crest: "#3fbf6a" },
  cannon: { body: ["#ffbcc9", "#d97591"], belly: "#ffdde5", gill: "#c13866", gillLight: "#f2829f", cheek: "#ff5f86", eye: "#2b1a2e", outline: "#a1385a", crest: "#d62f3a" },
  frost: { body: ["#eefbff", "#8ccdf0"], belly: "#f6fdff", gill: "#4aa9de", gillLight: "#eafcff", cheek: "#9ad6ff", eye: "#173049", outline: "#4b8fba", crest: "#7fe3ff" },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Жабры: по три с каждой стороны головы — отрезки «основание → кончик». */
const GILL_SEGS: [number, number, number, number][] = [
  [-40, -38, -80, -72], [-50, -20, -96, -30], [-50, -2, -88, 18],
  [40, -38, 80, -72], [50, -20, 96, -30], [50, -2, 88, 18],
];
/** Перистые жабры обычного аксолотля: изогнутые штрихи. */
const FEATHER_D = GILL_SEGS.map(([sx, sy, ex, ey]) => `M${sx} ${sy}Q${r1((sx + ex) / 2)} ${r1((sy + ey) / 2 - 10)} ${ex} ${ey}`).join("");
/** Кристаллические жабры крио-аксолотля: вытянутые ромбы. */
const CRYSTAL_D = GILL_SEGS.map(([sx, sy, ex, ey]) => {
  const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy);
  const nx = (-dy / len) * 10, ny = (dx / len) * 10;
  const mx = sx + dx * 0.55, my = sy + dy * 0.55;
  return `M${sx} ${sy}L${r1(mx + nx)} ${r1(my + ny)}L${ex} ${ey}L${r1(mx - nx)} ${r1(my - ny)}Z`;
}).join("");

/** Молния (ускорение): три разряда вокруг башни. */
const bolt = (x: number, y: number) => `M${x} ${y}l12 0l-7 13l10 0l-21 25l6 -17l-9 0Z`;
const HASTE_D = bolt(-86, -60) + bolt(68, -20) + bolt(-80, 30);

export interface AxolotlTowerProps {
  type: TowerType;
  level: number;
  /** Своё заклинание «Ускорение»: золотые молнии. */
  haste?: boolean;
  /** Чужое «Замедление башен»: фиолетовая сонная дымка и «z». */
  slowed?: boolean;
  /** Чужое «Отключение башни»: ледяная глыба с кляксой кетчупа. */
  disabled?: boolean;
}

/**
 * Башня-аксолотль. Стрелок — розовый с луком, Бомбардир — коренастый в бандане с мортирой,
 * Крио — ледяной с кристальными жабрами. Уровень 2 — серебряный шлем (у Бомбардира — очки),
 * уровень 3 — золотая корона, нагрудник и мягко пульсирующая аура.
 */
export function AxolotlTower({ type, level, haste, slowed, disabled }: AxolotlTowerProps) {
  const id = useSvgId();
  const reduce = useReducedMotion();
  const p = PALETTE[type] ?? PALETTE.arrow;
  const lvl = Math.max(1, Math.min(3, Math.round(level || 1)));
  const stocky = type === "cannon";
  const body = `url(#${id}b)`;

  return (
    <g data-part="tower" data-type={type} data-level={lvl}>
      <g transform="scale(0.0045)">
        <defs>
          <radialGradient id={`${id}b`} cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" stopColor={p.body[0]} />
            <stop offset="1" stopColor={p.body[1]} />
          </radialGradient>
          {lvl >= 2 && (
            <linearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={lvl >= 3 ? "#fff3b0" : "#f4f7fb"} />
              <stop offset="0.55" stopColor={lvl >= 3 ? "#f2b81f" : "#a9b3bf"} />
              <stop offset="1" stopColor={lvl >= 3 ? "#a8700c" : "#66707c"} />
            </linearGradient>
          )}
          {lvl >= 3 && (
            <radialGradient id={`${id}a`}>
              <stop offset="0.45" stopColor="#ffd84a" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ffd84a" stopOpacity="0" />
            </radialGradient>
          )}
        </defs>

        {/* Аура легендарного уровня */}
        {lvl >= 3 && (
          <circle data-part="aura" r={98} fill={`url(#${id}a)`} opacity={0.8}>
            {!reduce && <animate attributeName="opacity" values="0.55;0.95;0.55" dur="2.4s" repeatCount="indefinite" />}
          </circle>
        )}

        <ellipse cx={0} cy={82} rx={52} ry={10} fill="#000" opacity={0.18} />
        {/* Хвост */}
        <path d="M28 58Q80 72 88 36Q72 56 30 46Z" fill={body} stroke={p.outline} strokeWidth={2.5} />

        {/* Жабры за головой */}
        {type === "frost" ? (
          <path data-part="gills" d={CRYSTAL_D} fill={p.gillLight} stroke={p.gill} strokeWidth={3} strokeLinejoin="round" />
        ) : (
          <g data-part="gills" fill="none">
            <path d={FEATHER_D} stroke={p.gill} strokeWidth={22} strokeDasharray="4 4" opacity={0.75} />
            <path d={FEATHER_D} stroke={p.gill} strokeWidth={13} strokeLinecap="round" />
            <path d={FEATHER_D} stroke={p.gillLight} strokeWidth={5} strokeLinecap="round" />
          </g>
        )}

        {/* Туловище, животик, лапки */}
        <ellipse cx={0} cy={42} rx={stocky ? 47 : 40} ry={34} fill={body} stroke={p.outline} strokeWidth={2.5} />
        <ellipse cx={0} cy={50} rx={stocky ? 30 : 24} ry={20} fill={p.belly} />
        <ellipse cx={-22} cy={74} rx={12} ry={7} fill={p.body[1]} />
        <ellipse cx={22} cy={74} rx={12} ry={7} fill={p.body[1]} />
        {lvl >= 3 && (
          <g data-part="armor">
            <path d="M-30 22Q0 13 30 22L26 60Q0 72-26 60Z" fill={`url(#${id}m)`} stroke="#9a6a10" strokeWidth={2.5} />
            <circle cx={0} cy={40} r={7} fill="#e8394a" stroke="#fff3b0" strokeWidth={2} />
          </g>
        )}

        {/* Голова */}
        <ellipse cx={0} cy={-10} rx={stocky ? 60 : 56} ry={42} fill={body} stroke={p.outline} strokeWidth={2.5} />
        {type === "cannon" && (
          <g data-part="bandana">
            <path d="M-56-22Q0-56 56-22L54-11Q0-44-54-11Z" fill="#d62f3a" />
            <path d="M50-20l20-12l-4 15ZM50-17l18 8l-15 7Z" fill="#a81b26" />
          </g>
        )}
        <circle cx={-22} cy={-10} r={10.5} fill={p.eye} />
        <circle cx={22} cy={-10} r={10.5} fill={p.eye} />
        <circle cx={-18.5} cy={-14} r={3.6} fill="#fff" />
        <circle cx={25.5} cy={-14} r={3.6} fill="#fff" />
        <ellipse cx={-36} cy={6} rx={8} ry={5} fill={p.cheek} opacity={0.5} />
        <ellipse cx={36} cy={6} rx={8} ry={5} fill={p.cheek} opacity={0.5} />
        <path d="M-10 8Q0 17 10 8" fill="none" stroke={p.eye} strokeWidth={3} strokeLinecap="round" />

        {/* Уровень 2: шлем (у Бомбардира — лётные очки) */}
        {lvl === 2 && (type === "cannon" ? (
          <g data-part="helmet">
            <rect x={-56} y={-40} width={112} height={7} rx={3.5} fill="#4a4f58" />
            <circle cx={-20} cy={-37} r={11} fill="#7fd0ff" stroke={`url(#${id}m)`} strokeWidth={5} />
            <circle cx={20} cy={-37} r={11} fill="#7fd0ff" stroke={`url(#${id}m)`} strokeWidth={5} />
          </g>
        ) : (
          <g data-part="helmet">
            <path d="M-50-26Q-50-64 0-66Q50-64 50-26Z" fill={`url(#${id}m)`} stroke="#66707c" strokeWidth={2.5} />
            <rect x={-54} y={-31} width={108} height={9} rx={4.5} fill="#8b95a1" />
            <path d="M-4-66Q0-90 18-86Q6-80 6-66Z" fill={p.crest} />
          </g>
        ))}
        {/* Уровень 3: корона */}
        {lvl >= 3 && (
          <g data-part="crown">
            <path d="M-34-42L-42-80L-18-60L0-88L18-60L42-80L34-42Z" fill={`url(#${id}m)`} stroke="#9a6a10" strokeWidth={2.5} strokeLinejoin="round" />
            <circle cx={0} cy={-56} r={5} fill="#e8394a" />
            <circle cx={-22} cy={-50} r={4} fill="#3ab4ff" />
            <circle cx={22} cy={-50} r={4} fill="#3ab4ff" />
          </g>
        )}

        {/* Оружие */}
        {type === "arrow" && (
          <g data-part="weapon">
            <path d="M54-8Q88 31 54 70" fill="none" stroke="#8a5a2b" strokeWidth={6} strokeLinecap="round" />
            <path d="M54-8L54 70" stroke="#f5e9d0" strokeWidth={1.5} />
            <path d="M16 31L82 31M16 31l-8-7M16 31l-8 7" stroke="#6b4423" strokeWidth={3.5} strokeLinecap="round" />
            <path d="M80 23L95 31L80 39Z" fill="#3fbf6a" />
          </g>
        )}
        {type === "cannon" && (
          <g data-part="weapon">
            <rect x={26} y={52} width={46} height={18} rx={4} fill="#6b4f3a" />
            <g transform="rotate(-35 48 52)">
              <rect x={35} y={14} width={26} height={42} rx={7} fill="#3d4450" stroke="#1f242b" strokeWidth={2} />
              <rect x={31} y={10} width={34} height={9} rx={3} fill="#5f6a78" />
            </g>
            <circle cx={34} cy={72} r={8} fill="#3a2d22" stroke="#c9a36b" strokeWidth={2.5} />
            <circle cx={64} cy={72} r={8} fill="#3a2d22" stroke="#c9a36b" strokeWidth={2.5} />
            <circle cx={74} cy={46} r={4} fill="#ffb020" />
          </g>
        )}
        {type === "frost" && (
          <g data-part="weapon">
            <path d="M62-30L62 76" stroke="#a7d8f5" strokeWidth={5} strokeLinecap="round" />
            <circle cx={62} cy={-40} r={13} fill="#bff0ff" opacity={0.55} />
            <path d="M48-40L76-40M55-52L69-28M55-28L69-52" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
          </g>
        )}
        <circle cx={type === "frost" ? 56 : 42} cy={34} r={9} fill={p.body[1]} stroke={p.outline} strokeWidth={2} />
        <circle cx={-38} cy={38} r={9} fill={p.body[1]} stroke={p.outline} strokeWidth={2} />

        {/* Пипсы уровня */}
        <g data-part="pips">
          <rect x={-(lvl * 8 + 4)} y={84} width={lvl * 16 + 8} height={14} rx={7} fill="#141020" opacity={0.75} />
          {Array.from({ length: lvl }, (_, i) => (
            <circle key={i} cx={-(lvl - 1) * 8 + i * 16} cy={91} r={4.5} fill={lvl >= 3 ? "#ffd447" : lvl === 2 ? "#d9e2ec" : "#ffffff"} />
          ))}
        </g>

        {/* Эффекты заклинаний */}
        {haste && (
          <path data-part="haste" d={HASTE_D} fill="#ffd23f" stroke="#a86f00" strokeWidth={2} strokeLinejoin="round">
            {!reduce && <animate attributeName="opacity" values="1;0.45;1" dur="0.6s" repeatCount="indefinite" />}
          </path>
        )}
        {slowed && (
          <g data-part="haze">
            <defs>
              <radialGradient id={`${id}h`}>
                <stop offset="0.2" stopColor="#8b5cf6" stopOpacity="0.55" />
                <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx={0} cy={0} rx={98} ry={74} fill={`url(#${id}h)`} />
            <path d="M40-70h14l-14 16h14M62-92h10l-10 12h10" fill="none" stroke="#efe4ff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
              {!reduce && <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite" />}
            </path>
          </g>
        )}
        {disabled && (
          <g data-part="ice">
            <defs>
              <linearGradient id={`${id}i`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f0fcff" stopOpacity="0.85" />
                <stop offset="1" stopColor="#7cc8ee" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            <rect x={-72} y={-80} width={144} height={170} rx={16} fill={`url(#${id}i)`} stroke="#e4f8ff" strokeWidth={3} />
            <path d="M-58-66L-58-14M-46-66L-46-42" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
            <path d="M22-80L10-52L28-32L14 0" fill="none" stroke="#fff" strokeWidth={1.8} opacity={0.7} />
            <path d="M30 50q10-14 20-2q14-4 10 10q10 10-4 14q-6 12-16 2q-14 4-12-10q-10-8 2-14Z" fill="#d7261e" opacity={0.9} />
          </g>
        )}
      </g>
    </g>
  );
}

/** Цвет полоски здоровья: зелёный → жёлтый → красный. */
function hpFill(pct: number): string {
  return pct > 60 ? "#4ade80" : pct > 30 ? "#facc15" : "#ef4444";
}

/** Академия Аксолотлей — база игроков: школа-замок с гербом, полоска HP и купол щита при «Ремонте». */
export function AcademyBase({ hpPct, shielded }: { hpPct: number; shielded?: boolean }) {
  const id = useSvgId();
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, Number.isFinite(hpPct) ? hpPct : 0));
  const stone = `url(#${id}s)`;
  return (
    <g data-part="academy">
      <g transform="scale(0.005)">
        <defs>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3edff" />
            <stop offset="1" stopColor="#b6a6da" />
          </linearGradient>
        </defs>
        <ellipse cx={0} cy={80} rx={84} ry={12} fill="#000" opacity={0.2} />
        {/* Башенки */}
        <rect x={-80} y={-8} width={30} height={84} fill={stone} stroke="#7d6ba6" strokeWidth={2.5} />
        <rect x={50} y={-8} width={30} height={84} fill={stone} stroke="#7d6ba6" strokeWidth={2.5} />
        <path d="M-86-8L-65-52L-44-8ZM44-8L65-52L86-8Z" fill="#ff8fb1" stroke="#c4527a" strokeWidth={2.5} strokeLinejoin="round" />
        <rect x={-70} y={12} width={10} height={15} rx={5} fill="#ffe08a" />
        <rect x={60} y={12} width={10} height={15} rx={5} fill="#ffe08a" />
        {/* Главный корпус с крышей и флажком */}
        <rect x={-50} y={-26} width={100} height={102} fill={stone} stroke="#7d6ba6" strokeWidth={2.5} />
        <path d="M-58-26L0-70L58-26Z" fill="#ff9cbc" stroke="#c4527a" strokeWidth={2.5} strokeLinejoin="round" />
        <path d="M0-70L0-98" stroke="#6b5a7a" strokeWidth={3} />
        <path d="M0-98L24-91L0-84Z" fill="#39c6e8" />
        <path d="M-16 76V44Q0 24 16 44V76Z" fill="#5b3f6e" />
        {/* Герб: щит с мордочкой аксолотля */}
        <g data-part="emblem">
          <path d="M-20-16H20V4Q20 22 0 31Q-20 22-20 4Z" fill="#3aa8d8" stroke="#fff" strokeWidth={3} />
          <path d="M-8 2l-7-5M-8 6l-8 0M-8 10l-7 5M8 2l7-5M8 6l8 0M8 10l7 5" stroke="#e2477a" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={0} cy={6} r={8.5} fill="#ffb3c7" />
          <circle cx={-3.2} cy={4.5} r={1.7} fill="#2b1a2e" />
          <circle cx={3.2} cy={4.5} r={1.7} fill="#2b1a2e" />
        </g>
        {/* Полоска здоровья */}
        <g data-part="hp">
          <rect x={-70} y={-120} width={140} height={14} rx={7} fill="#000" opacity={0.45} />
          <rect x={-70} y={-120} width={1.4 * pct} height={14} rx={7} fill={hpFill(pct)} />
          <rect x={-70} y={-120} width={140} height={14} rx={7} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={2} />
        </g>
        {/* Энергетический купол «Ремонта» */}
        {shielded && (
          <g data-part="dome">
            <defs>
              <radialGradient id={`${id}d`} cx="0.5" cy="0.8" r="0.8">
                <stop offset="0.5" stopColor="#5ee7ff" stopOpacity="0.05" />
                <stop offset="1" stopColor="#5ee7ff" stopOpacity="0.45" />
              </radialGradient>
            </defs>
            <path d="M-100 82A100 112 0 0 1 100 82Z" fill={`url(#${id}d)`} stroke="#5ee7ff" strokeWidth={3}>
              {!reduce && <animate attributeName="opacity" values="0.7;1;0.7" dur="1.6s" repeatCount="indefinite" />}
            </path>
          </g>
        )}
      </g>
    </g>
  );
}

/** Спиральный рукав вихря портала (повторяется с поворотом). */
const ARM_D = "M0 0Q26-6 34-34Q40-58 66-56";

/** Портал, из которого выходят томаты: красно-зелёный вихрь. */
export function TomatoPortal() {
  const id = useSvgId();
  const reduce = useReducedMotion();
  return (
    <g data-part="portal">
      <g transform="scale(0.003)">
        <defs>
          <radialGradient id={`${id}g`}>
            <stop offset="0.55" stopColor="#ff3b30" stopOpacity="0" />
            <stop offset="0.8" stopColor="#ff3b30" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ff3b30" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}c`}>
            <stop offset="0" stopColor="#1a0503" />
            <stop offset="0.7" stopColor="#8e1b14" />
            <stop offset="1" stopColor="#d93a2a" />
          </radialGradient>
        </defs>
        <circle r={100} fill={`url(#${id}g)`} />
        <circle r={74} fill={`url(#${id}c)`} stroke="#5e0f0b" strokeWidth={10} />
        <g fill="none" strokeWidth={8} strokeLinecap="round" opacity={0.9}>
          {!reduce && <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="4s" repeatCount="indefinite" />}
          <path d={ARM_D} stroke="#ff6a55" />
          <path d={ARM_D} stroke="#4cc25a" transform="rotate(90)" />
          <path d={ARM_D} stroke="#ff6a55" transform="rotate(180)" />
          <path d={ARM_D} stroke="#4cc25a" transform="rotate(270)" />
        </g>
        <circle r={12} fill="#ffcf5a" opacity={0.6} />
      </g>
    </g>
  );
}

/** Превью башни для кнопок HUD: самостоятельный `<svg>` с той же графикой. */
export function TowerPreview({ type, level = 1, size = 28, className }: { type: TowerType; level?: number; size?: number; className?: string }) {
  return (
    <svg viewBox="-0.5 -0.5 1 1" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <AxolotlTower type={type} level={level} />
    </svg>
  );
}
