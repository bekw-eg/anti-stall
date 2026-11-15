import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Clock, Flame, Lock, Sun, Trophy } from "lucide-react";
import { TomatoApiError } from "@/api/tomato";
import type { Achievement, RoomStats, StudyStats } from "@/api/tomato";
import { apiErrorText, formatDuration } from "./format";
import { client } from "./useTomato";
import { TEAM_COLOR, teamTitle } from "./socialRules";
import { Avatar, SeedIcon } from "./screens/ui";
import type { Tomato } from "./useTomato";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Плитка цифры: значок в цветном квадрате, подпись, крупное число шрифтом заголовков. */
function Tile({ label, value, hint, testId, icon, tint }: { label: string; value: string; hint?: string; testId?: string; icon: ReactNode; tint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[20px] border-2 border-ink bg-white p-3.5 as-shadow-sm sm:p-4">
      <span className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border-2 border-ink text-ink" style={{ background: tint }} aria-hidden>{icon}</span>
        <span className="min-w-0 text-[13px] font-bold leading-tight text-mute">{label}</span>
      </span>
      <span className="font-display text-[28px] leading-none text-ink tabular-nums sm:text-[32px]" data-testid={testId}>{value}</span>
      {hint && <span className="text-xs font-semibold leading-snug text-mute">{hint}</span>}
    </div>
  );
}

/** Толстая полоска прогресса в обводке, как на карте команды. */
function Bar({ value, max, label, color = "#EAA695" }: { value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-4 overflow-hidden rounded-full border-2 border-ink bg-white" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

const H2 = "font-display text-2xl leading-none text-ink";

/**
 * Статистика: личная (сессии, время, уровень, неделя, достижения) и командная. Всё — данные сервера.
 * Без комнаты (главная страница) — только личная часть.
 */
export function StatsPanel({ t }: { t: Tomato }) {
  const snap = t.snapshot;
  const me = snap?.me;
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [room, setRoom] = useState<RoomStats | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // «Повторить» — новый запрос
  // перечитываем, когда что-то могло измениться: награды, фаза, очки команды
  const refreshKey = `${me?.xp ?? t.user?.xp}:${me?.coins ?? t.user?.coins}:${snap?.room.phase}:${snap?.room.cycleNo}:${snap?.challenge.points}:${snap?.members.length}`;
  const roomId = snap?.room.id ?? null;

  useEffect(() => {
    let alive = true;
    const fail = (e: unknown) => { if (alive) setError(e instanceof TomatoApiError ? apiErrorText(e) : "Нет связи с сервером"); };
    setError(null);
    client.stats().then((s) => alive && setStats(s)).catch(fail);
    if (roomId) client.roomStats(roomId).then((r) => alive && setRoom(r)).catch(fail);
    else setRoom(null);
    client.achievements().then((a) => alive && setAchievements(a.achievements)).catch(fail);
    return () => { alive = false; };
  }, [refreshKey, roomId, attempt]);

  const errorBox = error && (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[18px] border-2 border-ink bg-white px-4 py-3 text-sm font-bold lg:col-span-2" data-testid="stats-error">
      <span>Не удалось загрузить статистику: {error}</span>
      <button type="button" onClick={() => setAttempt((n) => n + 1)} className="as-btn as-btn-secondary as-btn-sm">
        Повторить
      </button>
    </div>
  );
  if (!stats) return error ? <div className="p-5 sm:p-6">{errorBox}</div> : <p className="p-6 text-sm text-mute">Загружаем статистику…</p>;
  const maxDay = Math.max(...stats.daily.map((d) => d.focusSeconds), 1);
  const span = stats.nextLevelXp - stats.levelStartXp;
  const today = new Date().toDateString();
  const look = new Map((snap?.members ?? []).map((m) => [m.userId, m.avatar]));

  return (
    <div className="grid min-h-full content-start gap-8 bg-paper p-5 sm:p-6 lg:grid-cols-2" data-testid="stats-panel">
      {errorBox}
      <section aria-labelledby="me-stats-h" className="flex min-w-0 flex-col gap-4">
        <h2 id="me-stats-h" className={H2}>Ваш прогресс</h2>

        <div className="flex flex-col gap-3 rounded-[24px] border-2 border-ink bg-white p-4 as-shadow-sm sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lime font-display text-2xl text-ink" aria-hidden><span className="relative top-0.5">{stats.level}</span></span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl leading-tight" data-testid="stats-level">Уровень {stats.level}</span>
              <span className="text-sm font-bold text-mute tabular-nums">{stats.xp} / {stats.nextLevelXp} XP</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-petal px-3 py-1" title="Ваши монеты">
              <SeedIcon className="h-5 w-5" /><span className="font-display text-xl leading-none tabular-nums"><span className="relative top-0.5">{stats.coins}</span></span>
            </span>
          </div>
          <Bar value={stats.xp - stats.levelStartXp} max={span} label="Прогресс уровня" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Tile icon={<CheckCircle2 size={17} strokeWidth={2.5} />} tint="#D9DE9F" label="Сессии" value={String(stats.sessions.completed)} hint={stats.sessions.interrupted ? `завершено · прервано: ${stats.sessions.interrupted}` : "завершено полностью"} testId="stats-sessions" />
          <Tile icon={<Clock size={17} strokeWidth={2.5} />} tint="#FFCEC2" label="Время в фокусе" value={formatDuration(stats.sessions.focusSeconds)} hint="только полные сессии" testId="stats-focus" />
          <Tile icon={<Sun size={17} strokeWidth={2.5} />} tint="#FCE3DB" label="Сегодня" value={formatDuration(stats.sessions.todayFocusSeconds)} hint={`сессий: ${stats.sessions.todaySessions}`} />
          <Tile icon={<Flame size={17} strokeWidth={2.5} />} tint="#EAA695" label="Лучшая серия" value={`${stats.bestStreakDays} дн.`} hint={`помощь: ${stats.social.helpsSent} · шутки: ${stats.social.pranksSent}`} />
        </div>

        <div className="rounded-[24px] border-2 border-ink bg-white p-4 as-shadow-sm sm:p-5">
          <p className="mb-3 font-display text-lg leading-none">Последние 7 дней</p>
          <div className="flex h-28 gap-2" aria-label="Время концентрации по дням">
            {stats.daily.map((d) => {
              const isToday = new Date(d.dayStart).toDateString() === today;
              return (
                <div key={d.dayStart} className="flex h-full flex-1 flex-col items-center gap-1.5" title={`${formatDuration(d.focusSeconds)} · сессий: ${d.sessions}`}>
                  <div className="relative w-full flex-1">
                    {d.focusSeconds ? (
                      <div className="absolute inset-x-0 bottom-0 rounded-[8px] border-2 border-ink transition-[height] duration-500" data-day-bar={d.focusSeconds} style={{ height: `${Math.max(12, (d.focusSeconds / maxDay) * 100)}%`, background: isToday ? "#A0726D" : "#EAA695" }} />
                    ) : (
                      <div className="absolute inset-x-0 bottom-0 h-1.5 rounded-full bg-soft" data-day-bar={0} />
                    )}
                  </div>
                  <span className={`text-xs font-extrabold ${isToday ? "text-ink" : "text-mute"}`}>{WEEKDAY[new Date(d.dayStart).getDay()]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-3 flex items-baseline justify-between gap-2">
            <span className="font-display text-lg leading-none">Достижения</span>
            <span className="text-sm font-extrabold text-mute" data-testid="stats-achievements">{stats.achievements.unlocked} из {stats.achievements.total}</span>
          </p>
          <ul className="grid grid-cols-1 gap-2 xs:grid-cols-2">
            {achievements.map((a) => (
              <li key={a.id} data-achievement={a.id} data-unlocked={a.unlocked ? "true" : "false"}
                className={`flex items-start gap-2.5 rounded-[16px] border-2 px-3 py-2.5 ${a.unlocked ? "border-ink bg-[#EEF0D2]" : "border-dashed border-line bg-white/70"}`}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${a.unlocked ? "border-ink bg-lime text-ink" : "border-line text-[#B8A39E]"}`} aria-hidden>
                  {a.unlocked ? <Trophy size={14} strokeWidth={2.5} /> : <Lock size={13} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-extrabold leading-tight ${a.unlocked ? "text-ink" : "text-mute"}`}>{a.title}</span>
                  <span className="block text-xs leading-snug text-mute">{a.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {roomId && (
      <section aria-labelledby="team-stats-h" className="flex min-w-0 flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="team-stats-h" className={H2}>Командный прогресс</h2>
          {room && <span className="text-sm font-extrabold text-mute">циклов: {room.cycles}</span>}
        </div>
        {!room ? <p className="text-sm text-mute">{error ? "Командная статистика не загрузилась" : "Загружаем…"}</p> : (
          <>
            {room.winner && (
              <p className="flex items-center gap-2 rounded-[18px] border-2 border-ink bg-lime px-4 py-3 font-extrabold">
                <Trophy size={18} aria-hidden />
                {room.winner === "draw" ? "Ничья: обе команды дошли до цели" : room.mode === "teams" ? `Победили ${teamTitle(room.winner).toLowerCase()}` : "Команда дошла до цели"}
              </p>
            )}
            {room.teams.map((tm) => {
              const color = TEAM_COLOR[tm.key] ?? TEAM_COLOR.shared;
              const mineTeam = me?.team === tm.key && room.mode === "teams";
              return (
                <div key={tm.key} className="overflow-hidden rounded-[24px] border-2 border-ink bg-white as-shadow-sm" data-team={tm.key}>
                  <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-4 py-3" style={{ background: room.mode === "teams" ? color : "#FFCEC2" }}>
                    <span className={`flex min-w-0 items-center gap-2 font-display text-xl leading-none ${room.mode === "teams" ? "text-white" : "text-ink"}`}>
                      <span className="relative top-0.5 truncate">{room.mode === "teams" ? teamTitle(tm.key) : tm.name}</span>
                      {mineTeam && <span className="rounded-full border-2 border-ink bg-white px-2 py-0.5 font-sans text-xs font-extrabold text-ink">ваша</span>}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-sm font-extrabold text-ink tabular-nums" data-testid={`team-points-${tm.key}`}>карта: {tm.points} / {tm.goal}</span>
                  </div>
                  <div className="flex flex-col gap-3 p-4">
                    <Bar value={tm.points} max={tm.goal} label={`Прогресс по карте: ${tm.name}`} color={room.mode === "teams" ? color : "#EAA695"} />
                    <ul className="flex flex-wrap gap-1.5 text-xs font-extrabold text-ink">
                      <li className="rounded-full bg-paper px-2.5 py-1">сессий: {tm.completedSessions}</li>
                      <li className="rounded-full bg-paper px-2.5 py-1">время: {formatDuration(tm.focusSeconds)}</li>
                      {typeof tm.focusPoints === "number" && <li className="rounded-full bg-paper px-2.5 py-1">очки вклада: {tm.focusPoints}</li>}
                      {typeof tm.treasuryCoins === "number" && <li className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1">казна: {tm.treasuryCoins}<SeedIcon className="h-3.5 w-3.5" /></li>}
                    </ul>
                    {tm.members.length === 0 ? <p className="rounded-[14px] border-2 border-dashed border-line px-3 py-2 text-sm text-mute">Пока никого</p> : (
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs font-extrabold text-mute">
                          <tr><th className="pb-1.5 font-extrabold">Участник</th><th className="pb-1.5 text-right font-extrabold">Сессий</th><th className="pb-1.5 text-right font-extrabold">Время</th><th className="pb-1.5 text-right font-extrabold">Вклад</th></tr>
                        </thead>
                        <tbody>
                          {tm.members.map((m) => (
                            <tr key={m.userId} className="border-t-2 border-soft">
                              <td className="py-2 pr-2">
                                <span className="flex min-w-0 items-center gap-2">
                                  <Avatar name={m.name} id={m.userId} look={look.get(m.userId)} size={28} ring={room.mode === "teams" ? color : "#3B2422"} />
                                  <span className="truncate font-bold">{m.name}{m.userId === me?.userId && " (вы)"}</span>
                                </span>
                              </td>
                              <td className="py-2 text-right font-bold tabular-nums">{m.completedSessions}</td>
                              <td className="py-2 text-right font-bold tabular-nums">{formatDuration(m.focusSeconds)}</td>
                              <td className="py-2 text-right font-display tabular-nums"><span className="relative top-0.5">{m.points}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="text-sm font-semibold text-mute">В комнате всего: {room.totals.completedSessions} сессий, {formatDuration(room.totals.focusSeconds)} концентрации.</p>
          </>
        )}
      </section>
      )}
    </div>
  );
}
