import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import type { EnemyType, MercType, SpellId, TdEffect, TdRound, TdTower, TdTowerDef, TdView, TowerType } from "@/api/tomato";
import { createTdRenderer, type TdRenderer } from "./tdCanvas";
import { AcademyBase, AxolotlTower, TomatoPortal, TowerPreview } from "./tdSprites";

export interface TdActions {
  join: () => Promise<unknown>;
  start: (stageId?: string) => Promise<unknown>;
  build: (slot: string, type: string) => Promise<unknown>;
  upgrade: (slot: string, level: number) => Promise<unknown>;
  sendUnit: (type: MercType) => Promise<unknown>;
  castSpell: (spell: SpellId) => Promise<unknown>;
  rematch: (stageId?: string) => Promise<unknown>;
}

const STATUS_TEXT = { running: "идёт", won: "оборона выстояла", lost: "база пала", expired: "перерыв закончился" } as const;
/** Игровые имена башен; цены, урон и описание — с сервера */
const TOWER_NAME: Record<TowerType, string> = { arrow: "Аксолотль-Стрелок", cannon: "Аксолотль-Бомбардир", frost: "Крио-Аксолотль" };
const MERC_SHORT: Record<MercType, string> = { cherry: "Черри", ripe: "Спелый", armored: "Броне-томат", king: "Дредноут" };
const MERC_ICON: Record<MercType, string> = { cherry: "🍒", ripe: "🍅", armored: "🪖", king: "👑" };
const SPELL_SHORT: Record<SpellId, string> = {
  haste: "Ускорить своих", repair: "Щит базы", slow_towers: "Замедлить башни врага", disable_tower: "Заморозить башню", enrage_horde: "Ярость томатов",
};
const SPELL_ICON: Record<SpellId, string> = { haste: "⚡", repair: "🛡️", slow_towers: "💤", disable_tower: "🧊", enrage_horde: "😡" };
const ENEMY_NAME: Record<EnemyType, string> = {
  runner: "Бегун", grunt: "Солдат", tank: "Тяжёлый", boss: "Босс", cherry: "Черри-бегун", ripe: "Спелый томат", armored: "Броне-томат", king: "Томат-Дредноут",
};
/** Подписи действующих эффектов на своём поле */
const EFFECT_CHIP: Record<SpellId, { text: string; cls: string }> = {
  haste: { text: "⚡ Башни ускорены", cls: "bg-lime text-ink" },
  repair: { text: "🛡️ Щит базы", cls: "bg-lime text-ink" },
  slow_towers: { text: "💤 Башни замедлены", cls: "bg-peach text-ink" },
  disable_tower: { text: "🧊 Башня заморожена", cls: "bg-rose text-white" },
  enrage_horde: { text: "😡 Ярость томатов", cls: "bg-rose text-white" },
};

const towerRange = (def: TdTowerDef | undefined, level: number) => (def ? def.range + 0.25 * (level - 1) : 0);
/** Эффекты раунда, которые ещё действуют по игровым часам сервера */
const liveEffects = (round: TdRound | null): TdEffect[] =>
  round && round.status === "running" ? (round.effects ?? []).filter((e) => e.expiresAtGameTime > round.t) : [];

/**
 * Tower Wars «Аксолотли против Томатиков». Компонент только рисует состояние сервера и отправляет намерения
 * (построить, улучшить, начать раунд, выпустить наёмника, заклинание, реванш). Ни урон, ни HP, ни казна,
 * ни победитель здесь не вычисляются: SVG — карта и башни, canvas (tdCanvas) — интерполяция врагов и снаряды.
 */
export function TowerDefense({ td, actions }: { td: TdView; actions: TdActions }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string>(td.defaultStageId);
  const [pending, setPending] = useState(false);
  const [mercCooling, setMercCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joined = useRef(false);

  // Вход в игру этого перерыва (фиксирует участие — от этого зависит награда)
  useEffect(() => {
    if (td.enabled && !joined.current) { joined.current = true; actions.join(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [td.enabled]);
  useEffect(() => () => { if (coolTimer.current) clearTimeout(coolTimer.current); }, []);

  const run = async (fn: () => Promise<unknown>) => { setPending(true); try { return await fn(); } finally { setPending(false); } };
  const { map, round } = td;
  const current = round?.current ? round : null; // раунд прошлого перерыва — не текущий
  const running = current?.status === "running";
  const towerAt = (slot: string): TdTower | undefined => td.towers.find((t) => t.slot === slot);
  const sel = selected ? map.slots.find((s) => s.id === selected) : null;
  const selTower = selected ? towerAt(selected) : undefined;
  const treasury = td.treasuryCoins ?? 0;
  const stage = td.stages.find((s) => s.id === stageId) ?? td.stages[0];
  const finished = current && current.status !== "running";
  const canAct = td.enabled && !pending;
  const hpPct = current ? Math.max(0, (current.hp / current.hpMax) * 100) : 100;
  const effects = liveEffects(current);
  const versus = td.mode === "teams";
  const rival = td.rival;
  const rivalRound = rival?.round?.current ? rival.round : null;

  // Куда уйдут наёмники и можно ли сейчас (окончательно решает сервер)
  const merc: { ok: boolean; hint: string } = !versus
    ? running ? { ok: true, hint: "Подкрепление волны: за каждого убитого наёмника казна получит ×1,5 его цены." } : { ok: false, hint: "Подкрепление волны выпускается только в идущий раунд." }
    : !rival ? { ok: false, hint: "Соперника пока нет." }
    : !rivalRound ? { ok: true, hint: `Команда ${rival.team} ещё не начала раунд — наёмники ждут её старта.` }
    : rivalRound.status === "running" ? { ok: true, hint: `Наёмники выйдут на поле команды ${rival.team}.` }
    : { ok: false, hint: "Соперник уже закончил раунд — штурмовать некого." };
  const spellState = (target: "self" | "rival"): { ok: boolean; hint: string | null } =>
    target === "self"
      ? running ? { ok: true, hint: null } : { ok: false, hint: "Свои заклинания — только во время раунда." }
      : !versus || !rival ? { ok: false, hint: "Атакующие заклинания — только в режиме «Команда A против B»: здесь соперника нет." }
      : rivalRound?.status === "running" ? { ok: true, hint: null } : { ok: false, hint: "Соперник сейчас не в бою." };

  const sendUnit = async (type: MercType) => {
    await run(() => actions.sendUnit(type));
    // короткая пауза кнопок — подсказка о серверном кулдауне, а не правило (его проверяет сервер)
    setMercCooling(true);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = setTimeout(() => setMercCooling(false), Math.max(0, td.mercCooldownSec ?? 0) * 1000);
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:flex-row lg:overflow-hidden" aria-label="Tower Defense">
      <TdField td={td} current={current} effects={effects} selected={selected} onSelect={setSelected} hpPct={hpPct} />

      {/* HUD: справа на широком экране, снизу на телефоне */}
      <aside className="flex min-w-0 shrink-0 flex-col gap-3 text-sm text-[var(--fg)] lg:w-[22rem] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin] [&>*]:shrink-0">
        {!td.enabled ? (
          <p role="status" className="as-card p-4 text-xs font-bold text-mute">Игра доступна только на перерыве. Сейчас — время учёбы.</p>
        ) : (
          <>
            <Treasury coins={treasury} team={versus ? td.team : null} />

            {/* Раунд */}
            <Section title={current && current.roundNo > 1 ? `Раунд ${current.roundNo} · реванш` : "Раунд"}>
              {current ? (
                <div>
                  <div className="mb-1.5 flex justify-between gap-2 text-xs text-[var(--muted)]">
                    <span className="min-w-0 truncate">{stageTitle(td, current.stageId)} · {STATUS_TEXT[current.status]}</span>
                    <span className="shrink-0 tabular-nums">волна {Math.max(1, current.wave)}/{current.waves}</span>
                  </div>
                  <HpBar value={current.hp} max={current.hpMax} label="Здоровье базы" tone="pink" />
                  <p className="mt-1.5 flex justify-between text-xs text-[var(--muted)]">
                    <span>база {current.hp}/{current.hpMax}</span>
                    <span>побеждено {current.kills}/{current.total}</span>
                  </p>
                  {finished && (
                    <p role="status" className={`mt-2 rounded-xl px-3 py-2 text-xs font-medium ${current.status === "won" ? "bg-lime text-ink" : current.status === "lost" ? "bg-rose text-white" : "bg-ink text-paper"}`}>
                      {current.status === "won" ? "Победа! Академия выстояла. Награду получили все, кто играл в раунде." : current.status === "lost" ? "База пала. Башни остались, усильте оборону и попробуйте снова." : "Перерыв закончился, возвращаемся к учёбе."}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--muted)]">Постройте башни на деньги казны и начните раунд. Игра закроется вместе с перерывом.</p>
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
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${stageId === s.id ? "bg-peach text-ink" : "border-2 border-ink bg-white hover:bg-blush"} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {s.unlocked ? s.title : `🔒 ${s.nodeTitle}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {stage.waves} волн · {stage.enemies} врагов · награда {stage.reward.xp} XP, {stage.reward.coins} монет{stage.wins === 0 ? " (×1,5 за первое прохождение)" : ""}
                  </p>
                  <button type="button" disabled={!canAct || !stage.unlocked} onClick={() => run(() => actions.start(stageId))} className="as-btn as-btn-sm as-btn-primary font-display w-full justify-center disabled:opacity-40">
                    Начать раунд
                  </button>
                </div>
              )}
            </Section>

            {/* Оборона */}
            <Section title="Башни-аксолотли">
              {effects.length > 0 && <EffectChips effects={effects} className="mb-2" />}
              {!sel ? (
                <p className="text-xs text-[var(--muted)]">Выберите место на поле, чтобы построить или улучшить башню.</p>
              ) : selTower ? (
                <TowerCard tower={selTower} def={td.towerTypes.find((d) => d.id === selTower.type)!} maxLevel={td.maxLevel} treasury={treasury} disabled={!canAct} onUpgrade={() => run(() => actions.upgrade(sel.id, selTower.level))} />
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Построить башню">
                  {td.towerTypes.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={!canAct || treasury < d.cost}
                        onClick={() => run(() => actions.build(sel.id, d.id))}
                        title={treasury < d.cost ? `В казне не хватает ${d.cost - treasury} 🪙` : undefined}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white px-3 py-2 text-left transition hover:bg-blush active:scale-[.98] disabled:opacity-40"
                      >
                        <TowerPreview type={d.id} size={34} className="shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block font-medium">{TOWER_NAME[d.id] ?? d.title}</span><span className="block text-xs text-[var(--muted)]">{d.description} · урон {d.damage}, радиус {d.range}</span></span>
                        <span className="font-display shrink-0 text-base tabular-nums">{d.cost}🪙</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Штурм и поддержка */}
            <Section title="Штурм и поддержка">
              {td.mercenaries?.length > 0 && (
                <>
                  <p className="mb-1.5 text-xs text-[var(--muted)]">{versus ? "Наёмники-томаты" : "Подкрепление волны"}</p>
                  <div className="grid grid-cols-2 gap-1.5" aria-label="Наёмники">
                    {td.mercenaries.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!canAct || !merc.ok || mercCooling || treasury < m.cost}
                        onClick={() => sendUnit(m.id)}
                        title={`${m.title}: ${m.description}. HP ${m.hp}, урон по базе ${m.damage}${m.armor ? `, броня ${Math.round(m.armor * 100)}%` : ""}`}
                        className="flex min-w-0 items-center gap-1.5 rounded-xl border-2 border-ink bg-white px-2.5 py-2 text-left text-xs font-bold transition hover:bg-blush active:scale-95 disabled:opacity-40"
                      >
                        <span aria-hidden>{MERC_ICON[m.id] ?? "🍅"}</span>
                        <span className="min-w-0 truncate">{MERC_SHORT[m.id] ?? m.title} · {m.cost}🪙</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]" data-testid="merc-hint">{merc.hint}</p>
                </>
              )}
              {td.spells?.length > 0 && (
                <>
                  <p className="mb-1.5 mt-3 text-xs text-[var(--muted)]">Заклинания</p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1" aria-label="Заклинания">
                    {td.spells.map((sp) => {
                      const st = spellState(sp.target);
                      const attack = sp.target === "rival";
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          disabled={!canAct || !st.ok || treasury < sp.cost}
                          onClick={() => run(() => actions.castSpell(sp.id))}
                          title={`${sp.title}: ${sp.description} (${sp.duration} с)${st.hint ? `. ${st.hint}` : ""}`}
                          data-spell={sp.id}
                          className={`flex min-w-0 items-center gap-1.5 rounded-xl border-2 border-ink px-2.5 py-2 text-left text-xs font-bold transition active:scale-95 disabled:opacity-40 ${attack ? "bg-blush hover:bg-peach" : "bg-lime hover:bg-[#CDD38E]"}`}
                        >
                          <span aria-hidden>{SPELL_ICON[sp.id] ?? "✨"}</span>
                          <span className="min-w-0">{SPELL_SHORT[sp.id] ?? sp.title} · {sp.cost}🪙</span>
                        </button>
                      );
                    })}
                  </div>
                  {!versus && <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]" data-testid="spell-hint">Атакующие заклинания работают только в режиме «Команда A против B» — здесь соперника нет.</p>}
                  {!running && <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">Свои заклинания — во время идущего раунда.</p>}
                </>
              )}
            </Section>

            {/* Соперник и реванш */}
            {(rival || td.duel || td.rematch?.available || finished || (current?.roundNo ?? 1) > 1) && (
              <Section title={rival ? "Соперник и Реванш" : "Реванш"}>
                {rival && (
                  <div className="text-xs">
                    <p className="mb-1 font-bold">Соперник · команда {rival.team}</p>
                    <p className="mb-1.5 flex justify-between gap-2 text-[var(--muted)]">
                      <span>башен: {rival.towers}</span>
                      <span className="tabular-nums">казна {rival.treasuryCoins ?? 0}🪙</span>
                    </p>
                    {rivalRound ? (
                      <>
                        <HpBar value={rivalRound.hp} max={rivalRound.hpMax} label={`Здоровье базы команды ${rival.team}`} tone="red" />
                        <p className="mt-1 flex justify-between gap-2 text-[var(--muted)]">
                          <span className="tabular-nums">база {rivalRound.hp}/{rivalRound.hpMax} · {STATUS_TEXT[rivalRound.status]}</span>
                          <span className="tabular-nums">волна {Math.max(1, rivalRound.wave)}/{rivalRound.waves}</span>
                        </p>
                        {liveEffects(rivalRound).length > 0 && <EffectChips effects={liveEffects(rivalRound)} className="mt-1.5" />}
                      </>
                    ) : (
                      <p className="text-[var(--muted)]">раунд не начат</p>
                    )}
                  </div>
                )}
                {td.duel && (
                  <div role="status" className="mt-2 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-paper">
                    <p>{td.duel.winner === "draw" ? "Дуэль: ничья" : td.duel.winner === td.team ? "Дуэль выиграла ваша команда" : `Дуэль выиграла команда ${td.duel.winner}`}{td.duel.roundNo > 1 ? ` · раунд ${td.duel.roundNo}` : ""}</p>
                    {Object.keys(td.duel.scores).length > 0 && (
                      <p className="mt-0.5 tabular-nums opacity-70">{Object.entries(td.duel.scores).map(([k, v]) => `${k} ${v}`).join(" : ")}</p>
                    )}
                  </div>
                )}
                {td.rematch && <Rematch td={td} disabled={!canAct} onRematch={() => run(() => actions.rematch(current?.stageId ?? stageId))} showReason={Boolean(finished) || (current?.roundNo ?? 1) > 1} />}
              </Section>
            )}

            <p className="text-[11px] leading-snug text-[var(--muted)]">Базу укрепляют «Крепкие стены» (сейчас {td.base.hpMax} HP), урон башен растёт от «Усиленных башен» (×{td.base.damageMult.toFixed(1)}). Казну пополняют фокус-сессии команды.</p>
          </>
        )}
      </aside>
    </div>
  );
}

const stageTitle = (td: TdView, id: string) => td.stages.find((s) => s.id === id)?.title ?? id;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="as-card p-3">
      <h3 className="font-display mb-2 text-base uppercase leading-none text-ink">{title}</h3>
      {children}
    </section>
  );
}

function HpBar({ value, max, label, tone }: { value: number; max: number; label: string; tone: "pink" | "red" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = pct <= 30 ? "bg-rose" : tone === "pink" ? "bg-peach" : "bg-rose";
  return (
    <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-soft" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function EffectChips({ effects, className = "" }: { effects: TdEffect[]; className?: string }) {
  const kinds = [...new Set(effects.map((e) => e.kind))];
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {kinds.map((k) => <span key={k} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${EFFECT_CHIP[k]?.cls ?? "bg-ink text-paper"}`}>{EFFECT_CHIP[k]?.text ?? k}</span>)}
    </div>
  );
}

/** Казна команды крупно: число «докручивается» до серверного значения, изменение всплывает. */
function Treasury({ coins, team }: { coins: number; team: string | null }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(coins);
  const from = useRef(coins);
  const prev = useRef(coins);
  const [delta, setDelta] = useState<{ id: number; d: number } | null>(null);

  useEffect(() => {
    if (reduce) { from.current = coins; setShown(coins); return; }
    const controls = animate(from.current, coins, { duration: 0.6, ease: "easeOut", onUpdate: (v) => { from.current = v; setShown(Math.round(v)); } });
    return () => controls.stop();
  }, [coins, reduce]);
  useEffect(() => {
    const d = coins - prev.current;
    prev.current = coins;
    if (d === 0) return;
    const id = Date.now() + Math.random();
    setDelta({ id, d });
    const timer = setTimeout(() => setDelta((x) => (x?.id === id ? null : x)), 1300);
    return () => clearTimeout(timer);
  }, [coins]);

  return (
    <div className="relative overflow-hidden rounded-[24px] border-2 border-ink bg-ink px-4 py-3 text-paper shadow-[0_6px_0_#3B2422]">
      <p className="text-sm font-bold text-peach">{team ? `Казна команды ${team}` : "Казна команды"}</p>
      <p className="font-display flex items-baseline gap-1.5 text-3xl tabular-nums" aria-label={`Казна команды: ${coins} монет`} data-testid="treasury" data-value={coins}>
        <span aria-hidden className="sr-only">Казна команды:</span>
        <span aria-hidden>{shown}</span>
        <span aria-hidden>🪙</span>
      </p>
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.id}
            aria-hidden
            className={`absolute right-3 top-2 rounded-full px-2 py-0.5 text-xs font-bold ${delta.d > 0 ? "bg-lime text-ink" : "bg-rose text-white"}`}
            initial={{ opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
          >
            {delta.d > 0 ? `+${delta.d}` : `−${Math.abs(delta.d)}`}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Rematch({ td, disabled, onRematch, showReason }: { td: TdView; disabled: boolean; onRematch: () => void; showReason: boolean }) {
  const r = td.rematch;
  const bonus = r.bonusTeam && r.counterattackCoins > 0
    ? r.bonusTeam === td.team
      ? `Контратака: проигравшим дуэль +${r.counterattackCoins}🪙 в казну — это вам!`
      : `Контратака: команда ${r.bonusTeam} получит +${r.counterattackCoins}🪙 в казну.`
    : null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {r.available ? (
        <button type="button" disabled={disabled} onClick={onRematch} className="as-btn as-btn-sm as-btn-light font-display w-full justify-center disabled:opacity-40">
          Смена ролей / Реванш (Раунд {Math.max(2, r.roundNo)})
        </button>
      ) : (
        showReason && r.reason && <p className="text-xs text-[var(--muted)]" data-testid="rematch-reason">Реванш недоступен: {r.reason}</p>
      )}
      {bonus && <p className="text-xs font-bold text-rose">{bonus}</p>}
    </div>
  );
}

function TowerCard({ tower, def, maxLevel, treasury, disabled, onUpgrade }: { tower: TdTower; def: TdTowerDef; maxLevel: number; treasury: number; disabled: boolean; onUpgrade: () => void }) {
  const cost = tower.level < maxLevel ? def.upgradeCosts[tower.level - 1] : null;
  return (
    <div>
      <p className="font-bold">{TOWER_NAME[def.id] ?? def.title} · уровень {tower.level}/{maxLevel}</p>
      <p className="text-xs text-[var(--muted)]">Построил: {tower.ownerName}. {def.description}.</p>
      <button type="button" disabled={disabled || cost === null || treasury < (cost ?? 0)} onClick={onUpgrade} className="as-btn as-btn-sm as-btn-primary font-display mt-2 w-full justify-center disabled:opacity-40">
        {cost === null ? "Максимальный уровень" : `Улучшить · ${cost}🪙`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- поле

/** Расстояние от точки до полилинии тропы — только чтобы не сажать цветы на дорогу. */
function distToPath(x: number, y: number, path: [number, number][]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + k * dx), y - (ay + k * dy)));
  }
  return best;
}

/** Детерминированные украшения луга (цветы, кусты, камни) вне тропы и мест под башни. */
function useDecor(map: TdView["map"]) {
  return useMemo(() => {
    const out: { x: number; y: number; kind: number }[] = [];
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
        if (h % 5 > 1) continue;
        const cx = x + 0.2 + ((h >>> 3) % 60) / 100, cy = y + 0.2 + ((h >>> 9) % 60) / 100;
        if (distToPath(cx, cy, map.path) < 0.75) continue;
        if (map.slots.some((s) => Math.hypot(s.x - cx, s.y - cy) < 0.62)) continue;
        out.push({ x: cx, y: cy, kind: (h >>> 5) % 4 });
      }
    }
    return out;
  }, [map]);
}

function Decor({ kind }: { kind: number }) {
  if (kind === 0 || kind === 1) {
    const petal = kind === 0 ? "#ff9ccc" : "#ffe066";
    return (
      <g>
        {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={0.07 * Math.cos((a * Math.PI) / 180)} cy={0.07 * Math.sin((a * Math.PI) / 180)} r={0.05} fill={petal} />)}
        <circle r={0.035} fill={kind === 0 ? "#fff3a0" : "#e8590c"} />
      </g>
    );
  }
  if (kind === 2) {
    return (
      <g>
        <circle cx={-0.09} cy={0.02} r={0.12} fill="#3f8f3a" />
        <circle cx={0.09} cy={0.03} r={0.11} fill="#3f8f3a" />
        <circle cx={0} cy={-0.06} r={0.13} fill="#4fa847" />
        <circle cx={0.04} cy={-0.1} r={0.025} fill="#e03131" />
      </g>
    );
  }
  return (
    <g>
      <ellipse cy={0.05} rx={0.14} ry={0.05} fill="rgba(0,0,0,.18)" />
      <path d="M-0.13 0.04 Q-0.12 -0.1 0 -0.11 Q0.13 -0.08 0.13 0.04 Z" fill="#a8a29e" stroke="#78716c" strokeWidth={0.02} />
    </g>
  );
}

/**
 * Поле: SVG-слой (луг, тропа, портал, Академия, места и башни) + canvas поверх (враги, снаряды, всплывающий урон).
 * Оба слоя лежат в одном контейнере с пропорциями карты — координаты совпадают.
 */
function TdField({ td, current, effects, selected, onSelect, hpPct }: {
  td: TdView; current: TdRound | null; effects: TdEffect[]; selected: string | null; onSelect: (id: string | null) => void; hpPct: number;
}) {
  const { map } = td;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { grass: `${uid}-grass`, stones: `${uid}-stones`, glowBase: `${uid}-gb`, glowPortal: `${uid}-gp` };
  const decor = useDecor(map);
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TdRenderer | null>(null);
  const roundRef = useRef<TdRound | null>(current);
  roundRef.current = current;

  const pathPoints = map.path.map(([x, y]) => `${x},${y}`).join(" ");
  const start = map.path[0];
  const end = map.path[map.path.length - 1];
  const towerAt = (slot: string) => td.towers.find((t) => t.slot === slot);
  const sel = selected ? map.slots.find((s) => s.id === selected) : null;
  const selTower = selected ? towerAt(selected) : undefined;
  const hasted = effects.some((e) => e.kind === "haste");
  const slowedTowers = effects.some((e) => e.kind === "slow_towers");
  const shielded = effects.some((e) => e.kind === "repair");
  const disabledSlots = new Set(effects.filter((e) => e.kind === "disable_tower" && e.targetSlot).map((e) => e.targetSlot as string));
  const geometryKey = JSON.stringify([map.cols, map.rows, map.path, map.slots]);

  // Canvas-рендерер врагов и снарядов: создаётся под геометрию карты, получает каждое новое состояние раунда.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: TdRenderer | null = null;
    try {
      renderer = createTdRenderer(canvas, { cols: map.cols, rows: map.rows, path: map.path, slots: map.slots, reducedMotion: Boolean(reduce) });
    } catch (e) {
      console.error("[tomato] canvas Tower Defense не запустился", e);
    }
    rendererRef.current = renderer;
    renderer?.setRound(roundRef.current, performance.now()); // размер канваса рендерер отслеживает сам (свой ResizeObserver)
    return () => {
      renderer?.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey, reduce]);
  // Новый объект раунда = новое серверное состояние: время получения — опора для интерполяции
  useEffect(() => { rendererRef.current?.setRound(current, performance.now()); }, [current]);

  const toggle = (id: string) => onSelect(selected === id ? null : id);
  const finished = current && current.status !== "running" ? current.status : null;

  return (
    <div
      className="relative flex w-full shrink-0 items-center justify-center [aspect-ratio:var(--td-ar)] lg:h-full lg:min-h-0 lg:flex-1 lg:shrink lg:[aspect-ratio:auto] lg:[container-type:size]"
      style={{ "--td-ar": `${map.cols} / ${map.rows}` } as React.CSSProperties}
    >
      <div
        className="relative overflow-hidden rounded-[24px] border-2 border-ink bg-lime shadow-[0_6px_0_#3B2422]"
        style={{ aspectRatio: `${map.cols} / ${map.rows}`, width: `min(100%, calc(100cqh * ${map.cols} / ${map.rows}))` }}
        data-testid="td-field"
      >
        <svg viewBox={`0 0 ${map.cols} ${map.rows}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Игровое поле">
          <defs>
            <pattern id={ids.grass} patternUnits="userSpaceOnUse" width={2} height={2}>
              <rect width={2} height={2} fill="#D9DE9F" />
              <rect width={1} height={1} fill="#E4E9B8" />
              <rect x={1} y={1} width={1} height={1} fill="#E4E9B8" />
              <path d="M0.25 0.7l0.05-0.14l0.05 0.14M1.3 0.35l0.04-0.12l0.04 0.12M0.7 1.6l0.05-0.14l0.05 0.14M1.6 1.25l0.04-0.12l0.04 0.12" fill="none" stroke="#B7BE7A" strokeWidth={0.03} strokeLinecap="round" />
            </pattern>
            <pattern id={ids.stones} patternUnits="userSpaceOnUse" width={0.6} height={0.6}>
              <rect width={0.6} height={0.6} fill="#EAA695" />
              <ellipse cx={0.15} cy={0.15} rx={0.11} ry={0.08} fill="#c7b39a" stroke="#9c8667" strokeWidth={0.015} />
              <ellipse cx={0.43} cy={0.3} rx={0.1} ry={0.09} fill="#cdbba3" stroke="#9c8667" strokeWidth={0.015} />
              <ellipse cx={0.2} cy={0.47} rx={0.09} ry={0.07} fill="#bfae95" stroke="#9c8667" strokeWidth={0.015} />
            </pattern>
            <radialGradient id={ids.glowBase}>
              <stop offset="0%" stopColor="#ff8fc8" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#ff8fc8" stopOpacity={0} />
            </radialGradient>
            <radialGradient id={ids.glowPortal}>
              <stop offset="0%" stopColor="#ff3b30" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#ff3b30" stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* Луг */}
          <rect width={map.cols} height={map.rows} fill={`url(#${ids.grass})`} />
          {decor.map((d, i) => <g key={i} transform={`translate(${d.x} ${d.y})`} aria-hidden><Decor kind={d.kind} /></g>)}

          {/* Тропа: край, утоптанная земля, камни */}
          <polyline points={pathPoints} fill="none" stroke="#3B2422" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pathPoints} fill="none" stroke="#EAA695" strokeWidth={0.88} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pathPoints} fill="none" stroke={`url(#${ids.stones})`} strokeWidth={0.72} strokeLinecap="round" strokeLinejoin="round" />

          {/* Портал томатов и Академия Аксолотлей */}
          <circle cx={start[0]} cy={start[1]} r={0.95} fill={`url(#${ids.glowPortal})`} />
          <g transform={`translate(${start[0]} ${start[1]})`} data-testid="portal"><TomatoPortal /></g>
          <circle cx={end[0]} cy={end[1]} r={1.05} fill={`url(#${ids.glowBase})`} />
          <g transform={`translate(${end[0]} ${end[1]})`} data-testid="base" aria-label={current ? `Академия: ${current.hp}/${current.hpMax}` : "Академия Аксолотлей"}>
            <AcademyBase hpPct={hpPct} shielded={shielded} />
          </g>

          {/* Радиус выбранной башни */}
          {sel && selTower && (
            <circle cx={sel.x} cy={sel.y} r={towerRange(td.towerTypes.find((d) => d.id === selTower.type), selTower.level)} fill="#A0726D" fillOpacity={0.14} stroke="#3B2422" strokeOpacity={0.7} strokeWidth={0.04} strokeDasharray="0.14 0.12" />
          )}

          {/* Места и башни */}
          {map.slots.map((s) => {
            const tw = towerAt(s.id);
            const isSel = selected === s.id;
            const title = tw ? TOWER_NAME[tw.type] ?? td.towerTypes.find((d) => d.id === tw.type)?.title : null;
            return (
              <g
                key={s.id}
                transform={`translate(${s.x} ${s.y})`}
                role="button"
                tabIndex={0}
                aria-label={tw ? `Башня «${title}», уровень ${tw.level}` : `Свободное место ${s.id}`}
                aria-pressed={isSel}
                onClick={() => toggle(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.id); } }}
                className="group cursor-pointer outline-none"
                data-testid={`slot-${s.id}`}
              >
                <circle r={0.62} fill="transparent" /> {/* увеличенная область нажатия для пальца */}
                {tw ? (
                  <>
                    <ellipse cy={0.32} rx={0.36} ry={0.11} fill="rgba(59,36,34,.25)" />
                    <AxolotlTower type={tw.type} level={tw.level} haste={hasted} slowed={slowedTowers} disabled={disabledSlots.has(s.id)} />
                  </>
                ) : (
                  <>
                    <rect x={-0.36} y={-0.36} width={0.72} height={0.72} rx={0.14} fill="#FFFFFF" fillOpacity={isSel ? 0.95 : 0.7} stroke="#3B2422" strokeOpacity={isSel ? 0.9 : 0.45} strokeWidth={0.04} />
                    
                    <path d="M-0.1 0H0.1M0 -0.1V0.1" stroke="#A0726D" strokeWidth={0.06} strokeLinecap="round" />
                  </>
                )}
                <circle r={0.54} fill="none" stroke="#3B2422" strokeWidth={0.05} className="opacity-0 group-focus-visible:opacity-100" />
                {isSel && <circle r={0.5} fill="none" stroke="#A0726D" strokeWidth={0.08} />}
              </g>
            );
          })}

          {/* Враги рисует canvas; здесь — невидимые узлы с серверным состоянием для скринридеров и тестов */}
          <g opacity={0} pointerEvents="none" aria-label="Враги на поле">
            {current?.enemies.map((e) => (
              <g key={e.id} transform={`translate(${e.x} ${e.y})`} data-testid="enemy" data-type={e.type} data-merc={e.isMerc ? "true" : undefined}>
                <title>{`${ENEMY_NAME[e.type] ?? e.type}${e.isMerc ? " (наёмник)" : ""}: ${Math.max(0, Math.round(e.hp))}/${e.maxHp}`}</title>
                <circle r={0.2} />
              </g>
            ))}
          </g>
        </svg>

        <canvas ref={canvasRef} data-testid="td-canvas" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />

        {current && (
          <span aria-hidden className="font-display pointer-events-none absolute right-2 top-2 rounded-full border-2 border-ink bg-white px-2.5 py-1 text-xs uppercase leading-none text-ink">
            Wave {Math.max(1, current.wave)}/{current.waves} · {current.enemies.length} 🍅
          </span>
        )}
        {effects.length > 0 && <EffectChips effects={effects} className="pointer-events-none absolute left-2 top-2" />}

        <AnimatePresence>
          {finished && (
            <motion.div
              key={`${current!.id}-${finished}`}
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 18 }}
            >
              <span className={`rounded-2xl px-5 py-2.5 text-lg font-display border-2 border-ink shadow-[0_6px_0_#3B2422] sm:text-2xl ${finished === "won" ? "bg-lime text-ink" : finished === "lost" ? "bg-rose text-white" : "bg-ink text-paper"}`}>
                {finished === "won" ? "Оборона выстояла!" : finished === "lost" ? "База пала" : "Перерыв закончился"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
