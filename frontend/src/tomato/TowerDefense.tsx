import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { EnemyType, TdTower, TdTowerDef, TdView, TowerType } from "@/api/tomato";

export interface TdActions {
  join: () => Promise<unknown>;
  start: (stageId?: string) => Promise<unknown>;
  build: (slot: string, type: string) => Promise<unknown>;
  upgrade: (slot: string, level: number) => Promise<unknown>;
}

const ENEMY_R: Record<EnemyType, number> = { runner: 0.17, grunt: 0.24, tank: 0.34, boss: 0.5 };
const STATUS_TEXT = { running: "идёт", won: "оборона выстояла", lost: "база пала", expired: "перерыв закончился" } as const;

/** Глиф башни: форма зависит от типа (лучник — треугольник, пушка — квадрат, мороз — ромб). */
function Glyph({ type, fill }: { type: TowerType; fill: string }) {
  if (type === "arrow") return <polygon points="0,-0.24 0.22,0.17 -0.22,0.17" fill={fill} />;
  if (type === "cannon") return <rect x={-0.18} y={-0.18} width={0.36} height={0.36} rx={0.05} fill={fill} />;
  return <polygon points="0,-0.25 0.2,0 0,0.25 -0.2,0" fill={fill} />;
}

const towerRange = (def: TdTowerDef | undefined, level: number) => (def ? def.range + 0.25 * (level - 1) : 0);

/**
 * Мини-игра Tower Defense. Компонент только рисует состояние сервера и отправляет намерения
 * (построить, улучшить, начать раунд). Ни HP, ни баланс, ни победитель здесь не вычисляются.
 */
export function TowerDefense({ td, actions }: { td: TdView; actions: TdActions }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string>(td.defaultStageId);
  const [pending, setPending] = useState(false);
  const joined = useRef(false);

  // Вход в игру этого перерыва (фиксирует участие — от этого зависит награда)
  useEffect(() => {
    if (td.enabled && !joined.current) { joined.current = true; actions.join(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [td.enabled]);

  const run = async (fn: () => Promise<unknown>) => { setPending(true); try { await fn(); } finally { setPending(false); } };
  const { map, round } = td;
  const current = round?.current ? round : null;
  const towerAt = (slot: string): TdTower | undefined => td.towers.find((t) => t.slot === slot);
  const sel = selected ? map.slots.find((s) => s.id === selected) : null;
  const selTower = selected ? towerAt(selected) : undefined;
  const coins = td.me.coins;
  const pathPoints = map.path.map(([x, y]) => `${x},${y}`).join(" ");
  const end = map.path[map.path.length - 1];
  const stage = td.stages.find((s) => s.id === stageId) ?? td.stages[0];
  const finished = current && current.status !== "running";
  const canAct = td.enabled && !pending;
  const hpPct = current ? Math.max(0, (current.hp / current.hpMax) * 100) : 100;

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-3 sm:p-5 lg:flex-row" aria-label="Tower Defense">
      {/* Поле */}
      <div className="relative min-h-[11rem] flex-1">
        <svg viewBox={`0 0 ${map.cols} ${map.rows}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Игровое поле">
          <polyline points={pathPoints} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={0.75} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pathPoints} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.04} strokeDasharray="0.15 0.2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Вход врагов и база */}
          <circle cx={map.path[0][0]} cy={map.path[0][1]} r={0.22} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={0.05} />
          <g transform={`translate(${end[0]} ${end[1]})`} data-testid="base">
            <rect x={-0.42} y={-0.42} width={0.84} height={0.84} rx={0.14} fill="currentColor" />
            <rect x={-0.16} y={-0.1} width={0.32} height={0.3} fill="var(--field)" />
            <polygon points="-0.26,-0.08 0,-0.3 0.26,-0.08" fill="var(--field)" />
            <rect x={-0.5} y={-0.72} width={1} height={0.1} rx={0.05} fill="currentColor" fillOpacity={0.2} />
            <rect x={-0.5} y={-0.72} width={Math.max(0, hpPct / 100)} height={0.1} rx={0.05} fill="currentColor" />
          </g>

          {/* Радиус выбранной башни */}
          {sel && selTower && <circle cx={sel.x} cy={sel.y} r={towerRange(td.towerTypes.find((d) => d.id === selTower.type), selTower.level)} fill="currentColor" fillOpacity={0.06} stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.03} strokeDasharray="0.12 0.12" />}

          {/* Места и башни */}
          {map.slots.map((s) => {
            const tw = towerAt(s.id);
            const isSel = selected === s.id;
            return (
              <g
                key={s.id}
                transform={`translate(${s.x} ${s.y})`}
                role="button"
                tabIndex={0}
                aria-label={tw ? `Башня «${td.towerTypes.find((d) => d.id === tw.type)?.title}», уровень ${tw.level}` : `Свободное место ${s.id}`}
                aria-pressed={isSel}
                onClick={() => setSelected(isSel ? null : s.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(isSel ? null : s.id))}
                className="cursor-pointer outline-none"
                data-testid={`slot-${s.id}`}
              >
                <circle r={0.62} fill="transparent" /> {/* увеличенная область нажатия для пальца */}
                {tw ? (
                  <>
                    <circle r={0.4} fill="currentColor" />
                    <Glyph type={tw.type} fill="var(--field)" />
                    {Array.from({ length: tw.level }).map((_, i) => <circle key={i} cx={(i - (tw.level - 1) / 2) * 0.16} cy={0.58} r={0.05} fill="currentColor" />)}
                  </>
                ) : (
                  <circle r={0.34} fill="none" stroke="currentColor" strokeOpacity={isSel ? 0.9 : 0.4} strokeWidth={0.06} strokeDasharray="0.14 0.1" />
                )}
                {isSel && <circle r={0.5} fill="none" stroke="currentColor" strokeWidth={0.06} />}
              </g>
            );
          })}

          {/* Враги: позиции присылает сервер, плавность — только отрисовка */}
          {current?.enemies.map((e) => (
            <motion.g key={e.id} initial={false} animate={{ x: e.x, y: e.y }} transition={{ duration: 0.5, ease: "linear" }} data-testid="enemy">
              <circle r={ENEMY_R[e.type]} fill="currentColor" fillOpacity={e.slowed ? 0.45 : 0.9} stroke="currentColor" strokeWidth={e.type === "boss" ? 0.08 : 0} />
              <rect x={-0.22} y={-ENEMY_R[e.type] - 0.14} width={0.44} height={0.05} fill="currentColor" fillOpacity={0.2} />
              <rect x={-0.22} y={-ENEMY_R[e.type] - 0.14} width={0.44 * (e.hp / e.maxHp)} height={0.05} fill="currentColor" />
            </motion.g>
          ))}
        </svg>
      </div>

      {/* Панель */}
      <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--card)] p-4 text-sm text-[var(--fg)] lg:w-80">
        {!td.enabled ? (
          <p role="status" className="text-xs text-[var(--muted)]">Игра доступна только на перерыве. Сейчас — время учёбы.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{td.mode === "teams" ? `Оборона · команда ${td.team}` : "Оборона"}</p>
              <p className="tabular-nums" aria-label="Монеты">{coins} монет</p>
            </div>

            {/* Раунд */}
            {current ? (
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-[var(--muted)]">
                  <span>{stageTitle(td, current.stageId)} · {STATUS_TEXT[current.status]}</span>
                  <span className="tabular-nums">волна {Math.max(1, current.wave)}/{current.waves}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]" role="progressbar" aria-label="Здоровье базы" aria-valuenow={current.hp} aria-valuemin={0} aria-valuemax={current.hpMax}>
                  <div className="h-full rounded-full bg-[var(--fg)] transition-all duration-500" style={{ width: `${hpPct}%` }} />
                </div>
                <p className="mt-1.5 flex justify-between text-xs text-[var(--muted)]">
                  <span>база {current.hp}/{current.hpMax}</span>
                  <span>побеждено {current.kills}/{current.total}</span>
                </p>
                {!finished && (current.debuffs?.length ?? 0) > 0 && (
                  <p role="status" data-testid="td-debuffs" className="mt-2 rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs">
                    Шутки соперника: {current.debuffs!.map((d) => (d.type === "fog" ? `туман — дальность башен −${Math.round((1 - d.rangeMult) * 100)}%` : `липучка — башни стреляют в ${d.cooldownMult} раза реже`)).join("; ")}
                  </p>
                )}
                {finished && (
                  <p role="status" className="mt-2 rounded-xl bg-[var(--fg)] px-3 py-2 text-xs font-medium text-[var(--field)]">
                    {current.status === "won" ? `Победа! Награда начислена сервером (только участникам раунда).` : current.status === "lost" ? "База пала. Башни остались — усильте оборону в следующий перерыв." : "Перерыв закончился — раунд завершён, продолжаем учёбу."}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--muted)]">Постройте башни за монеты и начните раунд. Игра закрывается вместе с перерывом — учёба важнее.</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Этап">
                  {td.stages.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={stageId === s.id}
                      disabled={!s.unlocked}
                      title={s.unlocked ? `Награда: ${s.reward.xp} XP, ${s.reward.coins} монет` : `Откроется после узла «${s.nodeTitle}» на карте`}
                      onClick={() => setStageId(s.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${stageId === s.id ? "bg-[var(--fg)] text-[var(--field)]" : "border border-[var(--line)]"} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {s.unlocked ? s.title : `🔒 ${s.nodeTitle}`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {stage.waves} волн · {stage.enemies} врагов · награда {stage.reward.xp} XP, {stage.reward.coins} монет{stage.wins === 0 ? " (×1,5 за первое прохождение)" : ""}
                </p>
                <button type="button" disabled={!canAct || !stage.unlocked} onClick={() => run(() => actions.start(stageId))} className="rounded-xl bg-[var(--fg)] py-2.5 text-sm font-medium text-[var(--field)] transition-opacity disabled:opacity-40">
                  Начать раунд
                </button>
              </div>
            )}

            {/* Выбранное место */}
            <div className="border-t border-[var(--line)] pt-3">
              {!sel ? (
                <p className="text-xs text-[var(--muted)]">Выберите место на поле, чтобы построить или улучшить башню.</p>
              ) : selTower ? (
                <TowerCard tower={selTower} def={td.towerTypes.find((d) => d.id === selTower.type)!} maxLevel={td.maxLevel} coins={coins} disabled={!canAct} onUpgrade={() => run(() => actions.upgrade(sel.id, selTower.level))} />
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Построить башню">
                  {td.towerTypes.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={!canAct || coins < d.cost}
                        onClick={() => run(() => actions.build(sel.id, d.id))}
                        className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2 text-left transition-colors hover:bg-[var(--card)] disabled:opacity-40"
                      >
                        <span><span className="block font-medium">{d.title}</span><span className="block text-xs text-[var(--muted)]">{d.description} · урон {d.damage}, радиус {d.range}</span></span>
                        <span className="ml-3 shrink-0 tabular-nums">{d.cost}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Команды A/B */}
            {td.rival && (
              <div className="border-t border-[var(--line)] pt-3 text-xs">
                <p className="mb-1 uppercase tracking-wider text-[var(--muted)]">Соперник · команда {td.rival.team}</p>
                <p className="flex justify-between"><span>башен: {td.rival.towers}</span><span className="tabular-nums">{td.rival.round?.current ? `база ${td.rival.round.hp}/${td.rival.round.hpMax} · ${STATUS_TEXT[td.rival.round.status]}` : "раунд не начат"}</span></p>
                {td.duel && <p role="status" className="mt-2 rounded-xl bg-[var(--fg)] px-3 py-2 font-medium text-[var(--field)]">{td.duel.winner === "draw" ? "Дуэль: ничья" : td.duel.winner === td.team ? "Дуэль выиграла ваша команда" : `Дуэль выиграла команда ${td.duel.winner}`}</p>}
              </div>
            )}

            <p className="text-[11px] leading-snug text-[var(--muted)]">Базу укрепляют «Крепкие стены» (сейчас {td.base.hpMax} HP), урон башен растёт от «Усиленных башен» (×{td.base.damageMult.toFixed(1)}).</p>
          </>
        )}
      </aside>
    </div>
  );
}

const stageTitle = (td: TdView, id: string) => td.stages.find((s) => s.id === id)?.title ?? id;

function TowerCard({ tower, def, maxLevel, coins, disabled, onUpgrade }: { tower: TdTower; def: TdTowerDef; maxLevel: number; coins: number; disabled: boolean; onUpgrade: () => void }) {
  const cost = tower.level < maxLevel ? def.upgradeCosts[tower.level - 1] : null;
  return (
    <div>
      <p className="font-medium">{def.title} · уровень {tower.level}/{maxLevel}</p>
      <p className="text-xs text-[var(--muted)]">Построил: {tower.ownerName}. {def.description}.</p>
      <button type="button" disabled={disabled || cost === null || coins < (cost ?? 0)} onClick={onUpgrade} className="mt-2 w-full rounded-xl bg-[var(--fg)] py-2 text-sm font-medium text-[var(--field)] disabled:opacity-40">
        {cost === null ? "Максимальный уровень" : `Улучшить · ${cost} монет`}
      </button>
    </div>
  );
}
