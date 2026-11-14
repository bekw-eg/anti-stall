import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { Clock, Flame, Heart, Lock, Play, Shield, ShieldPlus, Skull, Snail, Snowflake, Swords, Trophy, Zap, type LucideIcon } from "lucide-react";
import type { AvatarLook, EnemyType, MercType, SpellId, TdEffect, TdRound, TdTower, TdTowerDef, TdView, TowerType } from "@/api/tomato";
import { createTdRenderer, type TdRenderer } from "./tdCanvas";
import { AcademyBase, AxolotlTower, TomatoPortal, TowerPreview } from "./tdSprites";
import { SeedIcon } from "./screens/ui";
import type { TdFx, TdFxIcon } from "./useTomato";
import { teamTitle } from "./socialRules";

export interface TdActions {
  join: () => Promise<unknown>;
  start: (stageId?: string) => Promise<unknown>;
  build: (slot: string, type: string) => Promise<unknown>;
  upgrade: (slot: string, level: number) => Promise<unknown>;
  sendUnit: (type: MercType) => Promise<unknown>;
  castSpell: (spell: SpellId) => Promise<unknown>;
}

/** Игровые имена башен; цены, урон и описание — с сервера */
const TOWER_NAME: Record<TowerType, string> = { arrow: "Аксолотль-Стрелок", cannon: "Аксолотль-Бомбардир", frost: "Крио-Аксолотль" };
const TOWER_SHORT: Record<TowerType, string> = { arrow: "Стрелок", cannon: "Бомбардир", frost: "Крио" };
const MERC_SHORT: Record<MercType, string> = { cherry: "Черри", ripe: "Спелый", armored: "Броня", king: "Дредноут" };
const SPELL_SHORT: Record<SpellId, string> = { haste: "Ускорить", repair: "Щит базы", slow_towers: "Замедлить", disable_tower: "Заморозить", enrage_horde: "Ярость" };
const SPELL_ICON: Record<SpellId, LucideIcon> = { haste: Zap, repair: ShieldPlus, slow_towers: Snail, disable_tower: Snowflake, enrage_horde: Flame };
const ENEMY_NAME: Record<EnemyType, string> = {
  runner: "Бегун", grunt: "Солдат", tank: "Тяжёлый", boss: "Босс", cherry: "Черри-бегун", ripe: "Спелый томат", armored: "Броне-томат", king: "Томат-Дредноут",
};
/** Подписи действующих эффектов на поле */
const EFFECT_CHIP: Record<SpellId, { text: string; cls: string }> = {
  haste: { text: "Башни ускорены", cls: "bg-lime text-ink" },
  repair: { text: "Щит базы", cls: "bg-lime text-ink" },
  slow_towers: { text: "Башни замедлены", cls: "bg-peach text-ink" },
  disable_tower: { text: "Башня заморожена", cls: "bg-rose text-white" },
  enrage_horde: { text: "Ярость томатов", cls: "bg-rose text-white" },
};
const FX_ICON: Record<TdFxIcon, LucideIcon> = {
  swords: Swords, shield: Shield, zap: Zap, snail: Snail, snow: Snowflake, flame: Flame, heart: ShieldPlus, tomato: Swords, trophy: Trophy, skull: Skull, clock: Clock,
};
const FX_TONE: Record<TdFx["tone"], string> = {
  attack: "bg-rose text-white", defense: "bg-lime text-ink", win: "bg-lime text-ink", lose: "bg-ink text-cream", info: "bg-white text-ink",
};

const towerRange = (def: TdTowerDef | undefined, level: number) => (def ? def.range + 0.25 * (level - 1) : 0);
/** Эффекты раунда, которые ещё действуют по игровым часам сервера */
const liveEffects = (round: TdRound | null): TdEffect[] =>
  round && round.status === "running" ? (round.effects ?? []).filter((e) => e.expiresAtGameTime > round.t) : [];

/** Монета (семечко) + число: цена на кнопках и казна. */
function Cost({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}>{value}<SeedIcon className="h-4 w-4" /></span>;
}

/** Томаты-наёмники: одна форма, отличия — размер, шлем и корона. */
export function TomatoGlyph({ type, size = 30 }: { type: MercType; size?: number }) {
  const r = type === "cherry" ? 6 : type === "ripe" ? 9 : 8.5;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      <circle cx={12} cy={14} r={r} fill={type === "cherry" ? "#D9534F" : "#E8665A"} stroke="#3B2422" strokeWidth={1.6} />
      <ellipse cx={12 - r * 0.35} cy={14 - r * 0.4} rx={r * 0.28} ry={r * 0.18} fill="#FFCEC2" opacity={0.85} />
      <path d={`M12 ${14 - r} l-2.6 -1.6 M12 ${14 - r} l2.6 -1.6 M12 ${14 - r} v-2.4`} stroke="#5E6B1F" strokeWidth={1.8} strokeLinecap="round" />
      {type === "armored" && <path d="M4.2 12.6 Q12 3.2 19.8 12.6 Z" fill="#B8A39E" stroke="#3B2422" strokeWidth={1.4} strokeLinejoin="round" />}
      {type === "king" && <path d="M6.5 6.8 L8.2 2.8 L10.4 5.6 L12 2.2 L13.6 5.6 L15.8 2.8 L17.5 6.8 Z" fill="#F2C94C" stroke="#3B2422" strokeWidth={1.3} strokeLinejoin="round" />}
    </svg>
  );
}

/**
 * Tower Wars «Аксолотли против Томатиков». Компонент только рисует состояние сервера и отправляет намерения.
 * В командном режиме у команды одна роль на перерыв: защита строит башни и усиливает оборону,
 * атака шлёт томатов и дебаффы на поле защиты. Обе стороны видят одно поле — поле защиты.
 */
export function TowerDefense({ td, actions, fx = null, looks }: { td: TdView; actions: TdActions; fx?: TdFx | null; looks?: Record<string, AvatarLook | undefined> }) {
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
  const { map } = td;
  const versus = td.mode === "teams";
  const role = versus ? td.role ?? null : null;
  const attack = role === "attack";
  const rival = td.rival;
  const ownRound = td.round?.current ? td.round : null; // раунд прошлого перерыва — не текущий
  const rivalRound = rival?.round?.current ? rival.round : null;
  // поле в бою: у атаки — поле защиты (соперника), у защиты и в общем режиме — своё
  const current = attack ? rivalRound : ownRound;
  const towers = attack ? rival?.towerList ?? [] : td.towers;
  const running = current?.status === "running";
  const finished = current && current.status !== "running" ? current : null;
  const towerAt = (slot: string): TdTower | undefined => towers.find((t) => t.slot === slot);
  const sel = !attack && selected ? map.slots.find((s) => s.id === selected) : null;
  const selTower = sel ? towerAt(sel.id) : undefined;
  const treasury = td.treasuryCoins ?? 0;
  const stage = td.stages.find((s) => s.id === stageId) ?? td.stages[0];
  const canAct = td.enabled && !pending;
  const hpPct = current ? Math.max(0, (current.hp / current.hpMax) * 100) : 100;
  const effects = liveEffects(current);
  const selfSpells = (td.spells ?? []).filter((s) => s.target === "self");
  const rivalSpells = (td.spells ?? []).filter((s) => s.target === "rival");

  // наёмники: в командном режиме — только у атаки, в общем — «подкрепление волны» в свой раунд (окончательно решает сервер)
  const mercOk = !versus ? running : rivalRound ? rivalRound.status === "running" : true;
  const mercHint = !versus ? (running ? "Подкрепление: за убитого — ×1,5 цены в казну" : "Подкрепление — во время раунда")
    : !rivalRound ? "Томаты выйдут, когда начнётся раунд" : rivalRound.status === "running" ? null : "Раунд окончен";

  const sendUnit = async (type: MercType) => {
    await run(() => actions.sendUnit(type));
    // короткая пауза кнопок — подсказка о серверном кулдауне, а не правило (его проверяет сервер)
    setMercCooling(true);
    if (coolTimer.current) clearTimeout(coolTimer.current);
    coolTimer.current = setTimeout(() => setMercCooling(false), Math.max(0, td.mercCooldownSec ?? 0) * 1000);
  };

  const mercTiles = td.mercenaries?.length > 0 && (
    <Panel title={versus ? "Томаты в атаку" : "Подкрепление"} hint={mercHint}>
      <div className="grid grid-cols-2 gap-2" aria-label="Наёмники">
        {td.mercenaries.map((m) => (
          <Tile key={m.id} label={MERC_SHORT[m.id] ?? m.title} cost={m.cost} tone="rose"
            icon={<TomatoGlyph type={m.id} size={34} />}
            disabled={!canAct || !mercOk || mercCooling || treasury < m.cost}
            title={`${m.title}: ${m.description}. HP ${m.hp}, урон по базе ${m.damage}${m.armor ? `, броня ${Math.round(m.armor * 100)}%` : ""}`}
            onClick={() => sendUnit(m.id)} />
        ))}
      </div>
    </Panel>
  );
  const spellTiles = (list: typeof selfSpells, title: string, tone: "lime" | "rose") => list.length > 0 && (
    <Panel title={title} hint={running ? null : "Заклинания работают во время раунда"}>
      <div className={`grid gap-2 ${list.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} aria-label="Заклинания">
        {list.map((sp) => {
          const Icon = SPELL_ICON[sp.id] ?? Zap;
          return (
            <Tile key={sp.id} label={SPELL_SHORT[sp.id] ?? sp.title} cost={sp.cost} tone={tone} data-spell={sp.id}
              icon={<Icon size={26} strokeWidth={2.4} />}
              disabled={!canAct || !running || treasury < sp.cost}
              title={`${sp.title}: ${sp.description} (${sp.duration} с)`}
              onClick={() => run(() => actions.castSpell(sp.id))} />
          );
        })}
      </div>
    </Panel>
  );

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:flex-row lg:overflow-hidden" aria-label="Tower Defense">
      <TdField td={td} current={current} towers={towers} effects={effects} selected={attack ? null : selected} onSelect={attack ? undefined : setSelected} hpPct={hpPct} fx={fx} looks={looks} />

      {/* HUD: справа на широком экране, снизу на телефоне */}
      <aside className="flex min-w-0 shrink-0 flex-col gap-3 pb-16 text-ink lg:w-[22rem] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin] [&>*]:shrink-0">
        {!td.enabled ? (
          <p role="status" className="as-card p-4 text-base font-bold text-mute">Игра доступна только на перерыве. Сейчас — время учёбы.</p>
        ) : (
          <>
            <RoleCard role={role} rivalTeam={rival?.team ?? null} coins={treasury} team={versus ? td.team : null} />

            {/* Раунд */}
            <Panel title={current ? `Волна ${Math.max(1, current.wave)} из ${current.waves}` : attack ? "Атака" : "Раунд"}>
              {current ? (
                <div className="flex flex-col gap-2">
                  <HpBar value={current.hp} max={current.hpMax} label={attack ? `Здоровье базы: ${teamTitle(rival?.team).toLowerCase()}` : "Здоровье базы"} />
                  <p className="flex justify-between text-sm font-bold text-mute">
                    <span className="inline-flex items-center gap-1"><Heart size={15} className="fill-rose text-rose" aria-hidden />база {current.hp}/{current.hpMax}</span>
                    <span>сбито {current.kills}/{current.total}</span>
                  </p>
                  {finished && (
                    <p role="status" className={`rounded-xl px-3 py-2 text-sm font-extrabold ${resultTone(finished.status, attack)}`}>{resultText(finished.status, attack)}</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Этап">
                    {td.stages.map((s) => (
                      <button key={s.id} type="button" role="radio" aria-checked={stageId === s.id} disabled={!s.unlocked}
                        title={s.unlocked ? `Награда: ${s.reward.xp} XP, ${s.reward.coins} монет` : `Откроется после узла «${s.nodeTitle}» на карте`}
                        onClick={() => setStageId(s.id)}
                        className={`inline-flex items-center gap-1 rounded-full border-2 px-3 py-1.5 text-sm font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${stageId === s.id ? "border-ink bg-peach" : "border-ink bg-white hover:bg-blush"}`}>
                        {!s.unlocked && <Lock size={13} aria-label="закрыто" />}{s.unlocked ? s.title : s.nodeTitle}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm font-bold text-mute">{stage.waves} волны · {stage.enemies} врагов · {stage.reward.xp} XP</p>
                  <button type="button" disabled={!canAct || !stage.unlocked} onClick={() => run(() => actions.start(stageId))} className="as-btn as-btn-primary as-btn-sm w-full">
                    <Play size={18} className="fill-white" aria-hidden />{attack ? "Начать атаку" : "Начать раунд"}
                  </button>
                </div>
              )}
            </Panel>

            {attack ? (
              <>
                {mercTiles}
                {spellTiles(rivalSpells, "Дебаффы защите", "rose")}
              </>
            ) : (
              <>
                <Panel title="Башни" hint={sel ? null : "Нажмите на «+» на поле"}>
                  {sel && (selTower ? (
                    <TowerCard look={looks?.[selTower.ownerId]} tower={selTower} def={td.towerTypes.find((d) => d.id === selTower.type)!} maxLevel={td.maxLevel} treasury={treasury} disabled={!canAct} onUpgrade={() => run(() => actions.upgrade(sel.id, selTower.level))} />
                  ) : (
                    <div className="grid grid-cols-3 gap-2" aria-label="Построить башню">
                      {td.towerTypes.map((d) => (
                        <Tile key={d.id} label={TOWER_SHORT[d.id] ?? d.title} cost={d.cost} tone="white" aria-label={`${TOWER_NAME[d.id] ?? d.title}, ${d.cost} монет`}
                          icon={<TowerPreview type={d.id} size={40} />}
                          disabled={!canAct || treasury < d.cost}
                          title={`${TOWER_NAME[d.id] ?? d.title}: ${d.description} · урон ${d.damage}, радиус ${d.range}`}
                          onClick={() => run(() => actions.build(sel.id, d.id))} />
                      ))}
                    </div>
                  ))}
                </Panel>
                {spellTiles(selfSpells, "Усиления", "lime")}
                {!versus && mercTiles}
              </>
            )}

            {td.duel && versus && (
              <p role="status" className="rounded-[16px] border-2 border-ink bg-ink px-3 py-2 text-sm font-extrabold text-cream">
                {td.duel.winner === td.team ? "Дуэль выиграла ваша команда" : td.duel.winner === "draw" ? "Дуэль: ничья" : `Дуэль выиграли ${teamTitle(td.duel.winner).toLowerCase()}`}
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const resultText = (status: TdRound["status"], attack: boolean) =>
  status === "won" ? (attack ? "Атака отбита: база выстояла" : "Победа! База выстояла")
  : status === "lost" ? (attack ? "База взята — победа атаки!" : "База пала")
  : "Перерыв закончился";
const resultTone = (status: TdRound["status"], attack: boolean) =>
  status === "expired" ? "bg-ink text-cream" : (status === "won") !== attack ? "bg-lime text-ink" : "bg-rose text-white";

/** Роль команды крупно + казна: сразу видно, что делать на этом перерыве. */
function RoleCard({ role, rivalTeam, coins, team }: { role: "defense" | "attack" | null; rivalTeam: string | null; coins: number; team: string | null }) {
  const Icon = role === "attack" ? Swords : Shield;
  const title = role === "attack" ? "Вы в атаке" : role === "defense" ? "Вы в обороне" : "Оборона вместе";
  const sub = role === "attack" ? `Шлите томатов на базу: ${teamTitle(rivalTeam).toLowerCase()}` : role === "defense" ? "Стройте башни, не пустите томатов к базе" : "Стройте башни и держите базу";
  return (
    <section aria-label="Ваша роль" data-testid="td-role" data-role={role ?? "shared"}
      className={`flex items-center gap-3 rounded-[24px] border-2 border-ink px-4 py-3 shadow-[0_6px_0_#3B2422] ${role === "attack" ? "bg-rose text-white" : "bg-ink text-cream"}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] ${role === "attack" ? "bg-white text-rose" : "bg-lime text-ink"}`}><Icon size={26} strokeWidth={2.4} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-2xl uppercase leading-none"><span className="relative top-0.5">{title}</span></span>
        <span className="mt-1 block text-[13px] font-bold leading-snug opacity-85">{sub}</span>
      </span>
      <Treasury coins={coins} team={team} />
    </section>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string | null; children?: ReactNode }) {
  return (
    <section aria-label={title} className="as-card flex flex-col gap-2 p-3">
      <h3 className="font-display text-lg uppercase leading-none"><span className="relative top-0.5">{title}</span></h3>
      {hint && <p className="-mt-1 text-[13px] font-bold text-mute">{hint}</p>}
      {children}
    </section>
  );
}

/** Кнопка-плитка действия: крупная иконка, короткое имя и цена. Подробности — во всплывающей подсказке. */
function Tile({ icon, label, cost, tone, disabled, onClick, title, ...rest }: {
  icon: ReactNode; label: string; cost: number; tone: "white" | "lime" | "rose"; disabled: boolean; onClick: () => void; title?: string; "aria-label"?: string; "data-spell"?: string;
}) {
  const bg = tone === "lime" ? "bg-lime hover:bg-[#CDD38E]" : tone === "rose" ? "bg-blush hover:bg-peach" : "bg-white hover:bg-blush";
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title} {...rest}
      className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-ink px-1.5 py-2 text-ink shadow-[0_3px_0_#3B2422] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${bg}`}>
      <span className="flex h-10 items-center justify-center" aria-hidden>{icon}</span>
      <span className="max-w-full truncate text-[15px] font-extrabold leading-tight">{label}</span>
      <Cost value={cost} className="text-sm font-extrabold" />
    </button>
  );
}

function HpBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-4 overflow-hidden rounded-full border-2 border-ink bg-soft" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full transition-all duration-500 ${pct <= 30 ? "bg-rose" : "bg-peach"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function EffectChips({ effects, className = "" }: { effects: TdEffect[]; className?: string }) {
  const kinds = [...new Set(effects.map((e) => e.kind))];
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {kinds.map((k) => {
        const Icon = SPELL_ICON[k] ?? Zap;
        return (
          <span key={k} className={`inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-extrabold ${EFFECT_CHIP[k]?.cls ?? "bg-ink text-paper"}`}>
            <Icon size={13} strokeWidth={2.6} aria-hidden />{EFFECT_CHIP[k]?.text ?? k}
          </span>
        );
      })}
    </div>
  );
}

/** Казна команды: число «докручивается» до серверного значения, изменение всплывает. */
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
    <span className="relative flex shrink-0 flex-col items-end" title={team ? `Казна: ${teamTitle(team).toLowerCase()}` : "Казна команды"}>
      <span className="font-display flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xl tabular-nums text-ink" aria-label={`Казна команды: ${coins} монет`} data-testid="treasury" data-value={coins}>
        <span className="sr-only">Казна команды:</span>
        <span aria-hidden className="relative top-0.5">{shown}</span>
        <SeedIcon className="h-5 w-5" />
      </span>
      <AnimatePresence>
        {delta && (
          <motion.span key={delta.id} aria-hidden
            className={`absolute -top-3 right-0 rounded-full border-2 border-ink px-1.5 text-xs font-extrabold ${delta.d > 0 ? "bg-lime text-ink" : "bg-white text-ink"}`}
            initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: reduce ? 0 : 0.3 }}>
            {delta.d > 0 ? `+${delta.d}` : `−${Math.abs(delta.d)}`}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function TowerCard({ tower, def, maxLevel, treasury, disabled, onUpgrade, look }: { look?: AvatarLook; tower: TdTower; def: TdTowerDef; maxLevel: number; treasury: number; disabled: boolean; onUpgrade: () => void }) {
  const cost = tower.level < maxLevel ? def.upgradeCosts[tower.level - 1] : null;
  return (
    <div className="flex items-center gap-3">
      <TowerPreview type={def.id} level={tower.level} look={look} size={52} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">{TOWER_SHORT[def.id] ?? def.title} · ур. {tower.level}/{maxLevel}</p>
        <p className="truncate text-xs text-mute" title={def.description}>построил {tower.ownerName}</p>
        <button type="button" disabled={disabled || cost === null || treasury < (cost ?? 0)} onClick={onUpgrade} className="as-btn as-btn-primary as-btn-sm mt-2 w-full">
          {cost === null ? "Максимальный уровень" : <>Улучшить · <Cost value={cost} /></>}
        </button>
      </div>
    </div>
  );
}

/** Баннер посреди поля: событие сервера (fx) или новая волна. Сам исчезает через пару секунд. */
function FieldBanner({ fx }: { fx: TdFx | null }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<TdFx | null>(fx);
  useEffect(() => {
    setShown(fx);
    if (!fx) return;
    const timer = setTimeout(() => setShown((x) => (x?.id === fx.id ? null : x)), fx.small ? 1600 : 2300);
    return () => clearTimeout(timer);
  }, [fx]);
  const Icon = shown ? FX_ICON[shown.icon] ?? Swords : Swords;
  return (
    <AnimatePresence>
      {shown && (
        <motion.div key={shown.id} role="status" data-testid="td-banner"
          className={`pointer-events-none absolute inset-0 z-20 flex justify-center p-4 ${shown.small ? "items-start pt-12" : "items-center"}`}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.08 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 20 }}>
          {shown.small ? (
            <div className={`flex max-w-full items-center gap-2 rounded-full border-2 border-ink px-3 py-1.5 shadow-[0_3px_0_#3B2422] ${FX_TONE[shown.tone]}`}>
              <TomatoGlyph type="ripe" size={22} />
              <span className="font-display text-base uppercase leading-none"><span className="relative top-0.5">{shown.title}</span></span>
              {shown.sub && <span className="hidden text-sm font-bold sm:inline">{shown.sub}</span>}
            </div>
          ) : (
            <div className={`flex max-w-full flex-col items-center gap-1 rounded-[24px] border-[3px] border-ink px-5 py-3 text-center shadow-[0_6px_0_#3B2422] sm:px-8 sm:py-4 ${FX_TONE[shown.tone]}`}>
              <span className="flex items-center gap-3">
                {shown.icon === "tomato" ? <TomatoGlyph type="ripe" size={36} /> : <Icon size={32} strokeWidth={2.6} aria-hidden />}
                <span className="font-display text-2xl uppercase leading-none sm:text-4xl"><span className="relative top-1">{shown.title}</span></span>
              </span>
              {shown.sub && <span className="text-sm font-extrabold sm:text-base">{shown.sub}</span>}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
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
function TdField({ td, current, towers, effects, selected, onSelect, hpPct, fx, looks }: {
  td: TdView; current: TdRound | null; towers: TdTower[]; effects: TdEffect[]; selected: string | null; onSelect?: (id: string | null) => void; hpPct: number; fx: TdFx | null;
  looks?: Record<string, AvatarLook | undefined>;
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
  const towerAt = (slot: string) => towers.find((t) => t.slot === slot);
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

  const toggle = (id: string) => onSelect?.(selected === id ? null : id);
  const readOnly = !onSelect; // атака смотрит на поле защиты, строить там нельзя

  // Новая волна → баннер «Волна N»; события сервера (fx) приходят снаружи — показываем самое свежее
  const [waveFx, setWaveFx] = useState<TdFx | null>(null);
  const lastWave = useRef<{ id: string; wave: number } | null>(null);
  useEffect(() => {
    if (!current || current.status !== "running") return;
    const prev = lastWave.current;
    lastWave.current = { id: current.id, wave: current.wave };
    if (prev && prev.id === current.id && current.wave > prev.wave && current.wave > 1) {
      setWaveFx({ id: Date.now() + Math.random(), title: `Волна ${current.wave}`, sub: current.wave === current.waves ? "Последняя — держитесь!" : `из ${current.waves}`, tone: "attack", icon: "swords" });
    }
  }, [current]);
  const banner = [fx, waveFx].filter(Boolean).sort((a, b) => b!.id - a!.id)[0] ?? null;

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
                role={readOnly ? undefined : "button"}
                tabIndex={readOnly ? -1 : 0}
                aria-label={tw ? `Башня «${title}», уровень ${tw.level}` : `Свободное место ${s.id}`}
                aria-pressed={isSel}
                onClick={() => toggle(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.id); } }}
                className={`group outline-none ${readOnly ? "" : "cursor-pointer"}`}
                data-testid={`slot-${s.id}`}
              >
                <circle r={0.62} fill="transparent" /> {/* увеличенная область нажатия для пальца */}
                {tw ? (
                  <>
                    <ellipse cy={0.32} rx={0.36} ry={0.11} fill="rgba(59,36,34,.25)" />
                    <AxolotlTower type={tw.type} level={tw.level} look={looks?.[tw.ownerId]} haste={hasted} slowed={slowedTowers} disabled={disabledSlots.has(s.id)} />
                  </>
                ) : readOnly ? null : (
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
          <span aria-hidden className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-1 text-sm font-extrabold leading-none text-ink">
            Волна {Math.max(1, current.wave)}/{current.waves}<span className="text-mute">·</span>{current.enemies.length}<TomatoGlyph type="ripe" size={16} />
          </span>
        )}
        {effects.length > 0 && <EffectChips effects={effects} className="pointer-events-none absolute left-2 top-2 max-w-[70%]" />}
        <FieldBanner fx={banner} />
      </div>
    </div>
  );
}
