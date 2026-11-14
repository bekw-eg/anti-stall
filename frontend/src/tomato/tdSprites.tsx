import { useId } from "react";
import { useReducedMotion } from "framer-motion";
import type { AvatarLook, AvatarSkin, TowerType } from "@/api/tomato";
import { AxolotlGlyph, lookOf } from "./Axolotl";

/**
 * SVG-спрайты Tower Wars «Аксолотли против Томатиков»: башни-аксолотли (пиксельный спрайт владельца
 * из Axolotl.tsx), Академия и портал (процедурные фигуры). Единица измерения снаружи — клетка поля: компонент рисует `<g>`
 * вокруг (0,0), вызывающий оборачивает его в `<g transform="translate(x y)">`.
 * Внутри рисуем в удобной сетке ±100 и масштабируем до нужного радиуса.
 * Анимации (аура, молнии, щит, вихрь портала) — SMIL, и только если пользователь не просил меньше движения.
 */

/** Безопасный для `url(#…)` идентификатор: React useId содержит двоеточия. */
const useSvgId = () => "td" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

/** Молния (ускорение): три разряда вокруг башни. */
const bolt = (x: number, y: number) => `M${x} ${y}l12 0l-7 13l10 0l-21 25l6 -17l-9 0Z`;
const HASTE_D = bolt(-86, -60) + bolt(68, -20) + bolt(-80, 30);

export interface AxolotlTowerProps {
  type: TowerType;
  level: number;
  /** Образ владельца башни: его цвет и вещи (без образа — цвет по типу башни). */
  look?: AvatarLook | null;
  /** Своё заклинание «Ускорение»: золотые молнии. */
  haste?: boolean;
  /** Чужое «Замедление башен»: фиолетовая сонная дымка и «z». */
  slowed?: boolean;
  /** Чужое «Отключение башни»: ледяная глыба с кляксой кетчупа. */
  disabled?: boolean;
}

/** Цвет башни без владельца (превью в магазине): стрелок — розовый, бомбардир — персиковый, крио — голубой. */
const TYPE_SKIN: Record<TowerType, AvatarSkin> = { arrow: "pink", cannon: "orange", frost: "blue" };
/** Значок типа башни в углу: лук, бомба, снежинка. */
const BADGE: Record<TowerType, { fill: string; icon: string; stroke: string }> = {
  arrow: { fill: "#FFCEC2", stroke: "#3B2422", icon: "M-9 9L9-9M9-9h-7M9-9v7M-9 9l4 0M-9 9l0-4" },
  cannon: { fill: "#5A3833", stroke: "#FFF4EF", icon: "M-2-1a8 8 0 1 0 0.01 0M4-7l4-4M8-11l3 1" },
  frost: { fill: "#CDE4FA", stroke: "#2F5E8C", icon: "M0-11V11M-9.5-5.5L9.5 5.5M-9.5 5.5L9.5-5.5" },
};

/**
 * Башня-аксолотль: пиксельный спрайт владельца (его цвет, очки и шарф). Уровень 2 — пиксельный шлем,
 * уровень 3 — корона и золотая аура. Тип башни — значок в углу. Пипсы снизу — уровень.
 */
export function AxolotlTower({ type, level, look, haste, slowed, disabled }: AxolotlTowerProps) {
  const id = useSvgId();
  const reduce = useReducedMotion();
  const lvl = Math.max(1, Math.min(3, Math.round(level || 1)));
  const l: AvatarLook = look ? lookOf(undefined, look) : { skin: TYPE_SKIN[type] ?? "pink", head: null, face: null, neck: null };
  const hat = lvl >= 3 ? "crown" : lvl === 2 ? "helmet" : l.head;
  const badge = BADGE[type] ?? BADGE.arrow;

  return (
    <g data-part="tower" data-type={type} data-level={lvl}>
      <g transform="scale(0.0045)">
        {lvl >= 3 && (
          <>
            <defs>
              <radialGradient id={`${id}a`}>
                <stop offset="0.45" stopColor="#ffd84a" stopOpacity="0.55" />
                <stop offset="1" stopColor="#ffd84a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle data-part="aura" r={100} fill={`url(#${id}a)`} opacity={0.8}>
              {!reduce && <animate attributeName="opacity" values="0.55;0.95;0.55" dur="2.4s" repeatCount="indefinite" />}
            </circle>
          </>
        )}
        <ellipse cx={0} cy={72} rx={50} ry={11} fill="#000" opacity={0.18} />
        <g transform="translate(-118 -146) scale(0.527)" data-part="sprite">
          <AxolotlGlyph look={l} head={hat} />
        </g>

        {/* Тип башни */}
        <g data-part="weapon" transform="translate(70 46)">
          <circle r={25} fill={badge.fill} stroke="#3B2422" strokeWidth={4} />
          <path d={badge.icon} fill="none" stroke={badge.stroke} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>

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
            <rect x={-72} y={-96} width={144} height={176} rx={16} fill={`url(#${id}i)`} stroke="#e4f8ff" strokeWidth={3} />
            <path d="M-58-82L-58-30M-46-82L-46-58" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
            <path d="M22-96L10-68L28-48L14-16" fill="none" stroke="#fff" strokeWidth={1.8} opacity={0.7} />
            <path d="M30 40q10-14 20-2q14-4 10 10q10 10-4 14q-6 12-16 2q-14 4-12-10q-10-8 2-14Z" fill="#d7261e" opacity={0.9} />
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
export function TowerPreview({ type, level = 1, size = 28, className, look }: { type: TowerType; level?: number; size?: number; className?: string; look?: AvatarLook | null }) {
  return (
    <svg viewBox="-0.5 -0.5 1 1" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <AxolotlTower type={type} level={level} look={look} />
    </svg>
  );
}
