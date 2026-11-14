import { useEffect, useState } from "react";
import { TomatoApiError } from "@/api/tomato";
import type { Achievement, RoomStats, StudyStats } from "@/api/tomato";
import { apiErrorText, formatDuration } from "./format";
import { client } from "./useTomato";
import type { Tomato } from "./useTomato";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function Tile({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-2xl bg-[var(--card)] px-4 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-light tabular-nums" data-testid={testId}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full bg-[var(--fg)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Статистика: личная (сессии, время, уровень, неделя, достижения) и командная. Всё — данные сервера. */
export function StatsPanel({ t }: { t: Tomato }) {
  const snap = t.snapshot!;
  const me = snap.me;
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [room, setRoom] = useState<RoomStats | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // «Повторить» — новый запрос
  // перечитываем, когда что-то могло измениться: награды, фаза, очки команды
  const refreshKey = `${me?.xp}:${me?.coins}:${snap.room.phase}:${snap.room.cycleNo}:${snap.challenge.points}:${snap.members.length}`;

  useEffect(() => {
    let alive = true;
    const fail = (e: unknown) => { if (alive) setError(e instanceof TomatoApiError ? apiErrorText(e) : "Нет связи с сервером"); };
    setError(null);
    client.stats().then((s) => alive && setStats(s)).catch(fail);
    client.roomStats(snap.room.id).then((r) => alive && setRoom(r)).catch(fail);
    client.achievements().then((a) => alive && setAchievements(a.achievements)).catch(fail);
    return () => { alive = false; };
  }, [refreshKey, snap.room.id, attempt]);

  const errorBox = error && (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--card)] px-4 py-3 text-sm lg:col-span-2" data-testid="stats-error">
      <span>Не удалось загрузить статистику: {error}</span>
      <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-full bg-[var(--fg)] px-4 py-1.5 text-xs font-medium text-[var(--field)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        Повторить
      </button>
    </div>
  );
  if (!stats) return error ? <div className="p-5 sm:p-6">{errorBox}</div> : <p className="p-6 text-sm text-[var(--muted)]">Загружаем статистику…</p>;
  const maxDay = Math.max(...stats.daily.map((d) => d.focusSeconds), 1);
  const span = stats.nextLevelXp - stats.levelStartXp;

  return (
    <div className="grid h-full gap-8 overflow-y-auto p-5 sm:p-6 lg:grid-cols-2" data-testid="stats-panel">
      {errorBox}
      <section aria-labelledby="me-stats-h" className="flex min-w-0 flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 id="me-stats-h" className="font-display text-xl">Ваш прогресс</h2>
          <span className="text-xs text-[var(--muted)] tabular-nums">{stats.coins} монет</span>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium" data-testid="stats-level">Уровень {stats.level}</span>
            <span className="text-xs tabular-nums text-[var(--muted)]">{stats.xp} / {stats.nextLevelXp} XP</span>
          </div>
          <Bar value={stats.xp - stats.levelStartXp} max={span} label="Прогресс уровня" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Tile label="Сессий завершено" value={String(stats.sessions.completed)} hint={stats.sessions.interrupted ? `прервано: ${stats.sessions.interrupted}` : undefined} testId="stats-sessions" />
          <Tile label="Время концентрации" value={formatDuration(stats.sessions.focusSeconds)} hint="только завершённые сессии" testId="stats-focus" />
          <Tile label="Сегодня" value={formatDuration(stats.sessions.todayFocusSeconds)} hint={`сессий: ${stats.sessions.todaySessions}`} />
          <Tile label="Лучшая серия" value={`${stats.bestStreakDays} дн.`} hint={`помощь: ${stats.social.helpsSent} · шутки: ${stats.social.pranksSent}`} />
        </div>

        <div>
          <p className="mb-2 text-[15px] font-bold text-[var(--muted)]">Последние 7 дней</p>
          <div className="flex h-24 gap-2" aria-label="Время концентрации по дням">
            {stats.daily.map((d) => (
              <div key={d.dayStart} className="flex h-full flex-1 flex-col items-center gap-1" title={`${formatDuration(d.focusSeconds)} · сессий: ${d.sessions}`}>
                <div className="relative w-full flex-1">
                  <div className="absolute inset-x-0 bottom-0 rounded-md bg-[var(--fg)] opacity-80 transition-[height] duration-500" data-day-bar={d.focusSeconds} style={{ height: `${d.focusSeconds ? Math.max(6, (d.focusSeconds / maxDay) * 100) : 2}%` }} />
                </div>
                <span className="text-[10px] text-[var(--muted)]">{WEEKDAY[new Date(d.dayStart).getDay()]}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[15px] font-bold text-[var(--muted)]">
            Достижения · <span data-testid="stats-achievements">{stats.achievements.unlocked} из {stats.achievements.total}</span>
          </p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {achievements.map((a) => (
              <li key={a.id} className={`rounded-xl bg-[var(--card)] px-3 py-2 ${a.unlocked ? "" : "opacity-45"}`} data-achievement={a.id} data-unlocked={a.unlocked ? "true" : "false"}>
                <p className="text-sm font-medium">{a.unlocked ? "● " : "○ "}{a.title}</p>
                <p className="text-[11px] leading-snug text-[var(--muted)]">{a.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="team-stats-h" className="flex min-w-0 flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 id="team-stats-h" className="font-display text-xl">Командный прогресс</h2>
          {room && <span className="text-xs text-[var(--muted)]">циклов: {room.cycles}</span>}
        </div>
        {!room ? <p className="text-sm text-[var(--muted)]">{error ? "Командная статистика не загрузилась" : "Загружаем…"}</p> : (
          <>
            {room.winner && (
              <p className="rounded-xl bg-[var(--card)] px-4 py-3 text-sm font-medium">
                {room.winner === "draw" ? "Ничья: обе команды дошли до цели" : room.mode === "teams" ? `Победила команда ${room.winner}` : "Команда дошла до цели"}
              </p>
            )}
            {room.teams.map((tm) => (
              <div key={tm.key} className="rounded-2xl bg-[var(--card)] p-4" data-team={tm.key}>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{tm.name}{me?.team === tm.key && room.mode === "teams" && <span className="ml-2 text-xs text-[var(--muted)]">ваша</span>}</span>
                  <span className="text-xs tabular-nums text-[var(--muted)]" data-testid={`team-points-${tm.key}`}>карта: {tm.points} / {tm.goal}</span>
                </div>
                <Bar value={tm.points} max={tm.goal} label={`Прогресс по карте: ${tm.name}`} />
                <p className="mt-2 text-xs text-[var(--muted)]">
                  сессий: {tm.completedSessions} · время: {formatDuration(tm.focusSeconds)}
                  {typeof tm.focusPoints === "number" && <> · очки вклада: {tm.focusPoints}</>}
                  {typeof tm.treasuryCoins === "number" && <> · казна: {tm.treasuryCoins}</>}
                </p>
                <table className="mt-3 w-full text-xs">
                  <thead className="text-left text-[var(--muted)]">
                    <tr><th className="pb-1 font-normal">Участник</th><th className="pb-1 text-right font-normal">Сессий</th><th className="pb-1 text-right font-normal">Время</th><th className="pb-1 text-right font-normal">Вклад</th></tr>
                  </thead>
                  <tbody>
                    {tm.members.map((m) => (
                      <tr key={m.userId} className="border-t border-[var(--line)]">
                        <td className="py-1.5 pr-2">{m.name}{m.userId === me?.userId && " (вы)"}</td>
                        <td className="py-1.5 text-right tabular-nums">{m.completedSessions}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatDuration(m.focusSeconds)}</td>
                        <td className="py-1.5 text-right tabular-nums">{m.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="text-xs text-[var(--muted)]">В комнате всего: {room.totals.completedSessions} сессий, {formatDuration(room.totals.focusSeconds)} концентрации.</p>
          </>
        )}
      </section>
    </div>
  );
}
