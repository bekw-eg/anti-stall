/**
 * «Как вы поработали?» ★1–5 — сразу после фокуса, на перерыве (этап 6.2).
 * Оценка уходит на сервер один раз; в конце перерыва сервер начисляет командный бонус по средней оценке команды.
 * Клиент ничего не считает: только отправляет звёзды и показывает, что уже отмечено.
 */
import { useState } from "react";
import { Star } from "lucide-react";

const STAR_LABEL = ["", "совсем не вышло", "так себе", "нормально", "хорошо", "отлично"];

export function SessionRating({ rating, onRate }: { rating: number | null; onRate: (stars: number) => Promise<unknown> | void }) {
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const value = rating ?? picked;
  const shown = hover || value || 0;
  if (value) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[15px]" role="status" data-testid="session-rating-done">
        <span className="font-bold text-mute">Ваша оценка:</span>
        <span className="flex text-peach" aria-label={`${value} из 5`}>
          {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={18} aria-hidden fill={n <= value ? "currentColor" : "none"} />)}
        </span>
        <span className="text-mute">командный бонус — в конце перерыва</span>
      </p>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1.5 text-[15px] sm:w-auto sm:flex-row sm:items-center sm:gap-3">
      <span className="font-bold text-mute">Как вы поработали?</span>
      <div role="radiogroup" aria-label="Как вы поработали" className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={false} aria-label={`${n} из 5 — ${STAR_LABEL[n]}`} title={STAR_LABEL[n]}
            onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(0)}
            // ответ виден сразу; сервер отказал (null) — звёзды снова доступны, ошибку покажет общий тост
            onClick={async () => { setPicked(n); if ((await onRate(n)) === null) setPicked(null); }}
            className={`rounded-full p-1 transition-colors hover:bg-petal ${n <= shown ? "text-peach" : "text-line"}`}>
            <Star size={26} aria-hidden fill={n <= shown ? "currentColor" : "none"} strokeWidth={2.2} />
          </button>
        ))}
      </div>
      <span className="text-[13px] text-mute">{shown ? STAR_LABEL[shown] : "оценка команды даст бонус XP"}</span>
    </div>
  );
}
