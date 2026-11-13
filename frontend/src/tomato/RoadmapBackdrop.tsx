import type { Roadmap } from "@/api/tomato";

/**
 * Размытый фон-заглушка под будущую Road Map / мини-игру. Рисуется из реальных данных
 * сервера (узлы и связи), статичен — во время Focus никаких отвлекающих анимаций.
 */
export function RoadmapBackdrop({ road }: { road: Roadmap }) {
  const byId = new Map(road.nodes.map((n) => [n.id, n]));
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22] blur-[3px]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {road.edges.map(([a, b]) => {
        const na = byId.get(a), nb = byId.get(b);
        if (!na || !nb) return null;
        const done = road.points >= nb.requiredPoints;
        return <line key={`${a}-${b}`} x1={na.x * 100} y1={na.y * 100} x2={nb.x * 100} y2={nb.y * 100} stroke="currentColor" strokeWidth={done ? 0.5 : 0.25} />;
      })}
      {road.nodes.map((n) => (
        <circle key={n.id} cx={n.x * 100} cy={n.y * 100} r={n.type === "boss" ? 2.6 : 1.8} fill="currentColor" opacity={road.points >= n.requiredPoints ? 1 : 0.45} />
      ))}
    </svg>
  );
}
