import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Check, ChevronDown, Clock, Flame, History, KeyRound, Lock, LogOut, Palette, RotateCcw, Settings, Shirt, Smartphone, Sparkles, Target, Trophy } from "lucide-react";
import { client } from "./useTomato";
import type { Tomato } from "./useTomato";
import type { AvatarLook, Progress, StudySession } from "@/api/tomato";
import { formatDuration } from "./format";
import { cycleOutcome, formatClock, formatDay, groupSessions, plural, workedSec } from "./historyGroups";
import { Axolotl, ItemIcon, SKIN_BG, lookOf } from "./Axolotl";
import { DemoBadge } from "./Chrome";
import { SeedIcon } from "./screens/ui";

type Tab = "look" | "upgrades" | "achievements" | "history" | "settings";
const TABS: [Tab, string, ReactNode][] = [
  ["look", "Образ", <Shirt key="i" size={17} aria-hidden />],
  ["upgrades", "Улучшения", <Sparkles key="i" size={17} aria-hidden />],
  ["achievements", "Достижения", <Trophy key="i" size={17} aria-hidden />],
  ["history", "История", <History key="i" size={17} aria-hidden />],
  ["settings", "Настройки", <Settings key="i" size={17} aria-hidden />],
];
const RESULT_LABEL: Record<string, string> = { done: "сделал", partial: "частично", not_done: "не успел" };
const xpForLevel = (n: number) => 50 * n * (n - 1); // как на сервере (catalog.js)

/* Тёмная палитра страницы образа (по референсу): шоколадный фон, карточки чуть светлее, акцент — персик. */
const CARD = "rounded-[24px] border-2 border-[#6A4A45] bg-[#46302D]";
const MUTED = "text-[#D8BDB6]";
const sameLook = (a: AvatarLook, b: AvatarLook) => a.skin === b.skin && a.head === b.head && a.face === b.face && a.neck === b.neck;

/**
 * Профиль = страница образа аксолотля: превью, инвентарь вещей и выбор цвета, сохранение на сервер.
 * Остальное — во вкладках: улучшения, достижения, история, настройки. Данные целиком с сервера.
 */
export function ProfilePanel({ t, onLeave }: { t: Tomato; onLeave?: () => void }) {
  const [tab, setTab] = useState<Tab>("look");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [unlocked, setUnlocked] = useState<{ skins: string[]; items: string[] } | null>(null); // что открыто — решает сервер
  const me = t.snapshot?.me;
  const focusing = me?.status === "focusing";
  // перечитываем после наград/покупок: меняются xp и монеты в снимке комнаты
  const refreshKey = `${me?.xp ?? ""}:${me?.coins ?? ""}:${t.snapshot?.room.phase ?? ""}`;

  const load = async () => {
    const p = await t.call(() => client.progress());
    if (p) setProgress(p);
    const h = await t.call(() => client.sessions(100)); // хватит на несколько заходов по задачам
    if (h) setSessions(h.sessions);
    const m = await t.call(() => client.me());
    if (m?.avatarUnlocked) setUnlocked(m.avatarUnlocked);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (!progress) return <p className={`p-6 text-sm ${MUTED}`}>Загружаем профиль…</p>;

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6" data-testid="profile-panel">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Разделы профиля">
        {TABS.map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`profile-tab-${id}`}
            className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-[14px] border-2 px-4 text-[15px] font-extrabold transition-colors ${tab === id ? "border-peach bg-peach text-ink" : "border-[#6A4A45] text-cream hover:bg-[#5A3833]"}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "look" && <LookTab t={t} progress={progress} onLeave={onLeave} unlocked={unlocked} />}

      {tab === "upgrades" && (
        <ul className="grid gap-3 md:grid-cols-2">
          {focusing && <li className={`text-sm ${MUTED} md:col-span-2`}>Покупки доступны на перерыве.</li>}
          {progress.upgrades.map((u) => (
            <li key={u.id} className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="min-w-0">
                <p className="flex items-baseline justify-between gap-2 font-extrabold">{u.title}<span className={`text-sm tabular-nums ${MUTED}`}>{u.level}/{u.maxLevel}</span></p>
                <p className={`text-sm ${MUTED}`}>{u.description}</p>
              </div>
              <div className="flex gap-1" aria-hidden>{Array.from({ length: u.maxLevel }, (_, i) => <span key={i} className={`h-2 flex-1 rounded-full ${i < u.level ? "bg-peach" : "bg-[#6A4A45]"}`} />)}</div>
              <button type="button" disabled={u.maxed || u.locked || !u.canBuy || focusing}
                onClick={async () => { await t.call(() => client.buyUpgrade(u.id, u.level)); load(); }}
                className="as-btn as-btn-light as-btn-sm self-start tabular-nums">
                {u.maxed ? "Максимум" : u.locked ? `с ${u.minPlayerLevel} уровня` : <><SeedIcon className="h-5 w-5" />{u.nextCost}</>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "achievements" && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {progress.achievements.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 rounded-[20px] border-2 p-3.5 ${a.unlocked ? "border-peach bg-[#5A3833]" : "border-dashed border-[#6A4A45] opacity-70"}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${a.unlocked ? "border-peach bg-peach text-ink" : "border-[#6A4A45] text-[#B8A39E]"}`} aria-hidden>
                {a.unlocked ? <Trophy size={16} strokeWidth={2.5} /> : <Lock size={15} strokeWidth={2.5} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2 font-extrabold">{a.title}<span className="inline-flex items-center gap-0.5 text-sm text-peach">+{a.reward.coins}<SeedIcon className="h-3.5 w-3.5" /></span></span>
                <span className={`block text-sm ${MUTED}`}>{a.description}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "history" && <HistoryList sessions={sessions} />}

      {tab === "settings" && (
        <div className="flex flex-col gap-4">
          {t.demoMode && <DemoBadge className="self-start" />}
          <label className={`${CARD} flex cursor-pointer items-start gap-3 p-4`}>
            <input
              type="checkbox" role="switch" data-testid="pranks-toggle" className="mt-1 h-5 w-5 accent-[#EAA695]"
              checked={progress.prankEnabled}
              onChange={async (e) => {
                // галочка переключается сразу; при ошибке сервера — откат
                const on = e.target.checked;
                setProgress((p) => (p ? { ...p, prankEnabled: on } : p));
                const ok = await t.setPranksEnabled(on);
                if (!ok) setProgress((p) => (p ? { ...p, prankEnabled: !on } : p));
              }}
            />
            <span><span className="font-extrabold">Получать шутки</span><span className={`block text-sm ${MUTED}`}>Шутки — часть игры на перерыве. Если выключить, вас нельзя выбрать целью и отправлять их тоже нельзя.</span></span>
          </label>
          <AccountCard t={t} name={progress.name} />
          {t.user?.login && <TransferCard t={t} />}
          {onLeave && <LeaveButton onLeave={onLeave} />}
        </div>
      )}
    </div>
  );
}

/** Аккаунт: гость закрепляет его логином и паролем; у зарегистрированного — смена пароля. */
function AccountCard({ t, name }: { t: Tomato; name: string }) {
  const login0 = t.user?.login ?? null;
  const [login, setLogin] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const input = "h-11 min-w-0 flex-1 rounded-[14px] border-2 border-[#6A4A45] bg-[#2A1817] px-3 text-cream outline-none placeholder:text-[#B8A39E] focus:border-peach";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = login0 ? await t.changePassword(current, password) : await t.registerAccount(name, login.trim(), password);
    if (ok) { setPassword(""); setCurrent(""); }
    setBusy(false);
  };
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label="Аккаунт" data-testid="account-card">
      <p className="flex items-center gap-2 font-extrabold"><KeyRound size={18} aria-hidden />{login0 ? <>Аккаунт: <span className="text-peach">{login0}</span></> : "Сохранить аккаунт"}</p>
      <p className={`text-sm ${MUTED}`}>{login0 ? "Входите этим логином и паролем на любом устройстве. Здесь можно сменить пароль." : "Сейчас вы гость: профиль одноразовый и исчезнет, когда закроете браузер. Задайте логин и пароль — прогресс, друзья и образ сохранятся, входите с любого устройства. Почта не нужна."}</p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        {login0 ? (
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" placeholder="Текущий пароль" aria-label="Текущий пароль" className={input} />
        ) : (
          <input value={login} onChange={(e) => setLogin(e.target.value)} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Логин" aria-label="Логин" className={input} />
        )}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="new-password" placeholder={login0 ? "Новый пароль" : "Пароль (от 8 символов)"} aria-label={login0 ? "Новый пароль" : "Пароль"} className={input} />
        <button type="submit" disabled={busy || password.length < 8 || (login0 ? !current : login.trim().length < 3)} className="as-btn as-btn-light as-btn-sm shrink-0">{login0 ? "Сменить" : "Сохранить"}</button>
      </form>
    </section>
  );
}

/**
 * Вход с другого устройства: аккаунт гостевой (ключ в этом браузере), поэтому для телефона или второго компьютера
 * выдаётся одноразовый код на 10 минут. На новом устройстве: экран входа → «Перенести аккаунт» → код.
 */
function TransferCard({ t }: { t: Tomato }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - t.serverNow()) / 60_000)) : 0;
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label="Вход с другого устройства" data-testid="transfer-card">
      <p className="flex items-center gap-2 font-extrabold"><Smartphone size={18} aria-hidden />Вход с другого устройства</p>
      <p className={`text-sm ${MUTED}`}>Чтобы открыть аккаунт на телефоне или другом компьютере, возьмите одноразовый код и введите его там на экране входа — «Перенести аккаунт». Друзья, уровень и образ останутся с вами.</p>
      {code && left > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[18px] border-2 border-peach bg-[#2A1817] px-4 py-3">
          <span className="font-display text-3xl tracking-[0.12em] text-cream" data-testid="transfer-code"><span className="relative top-1">{code.code}</span></span>
          <span className={`text-sm font-bold ${MUTED}`}>действует ещё {left} мин, только один раз</span>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); const c = await t.newTransferCode(); if (c) setCode(c); setBusy(false); }}
          className="as-btn as-btn-light as-btn-sm self-start"><KeyRound size={18} aria-hidden />Получить код</button>
      )}
    </section>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <button type="button" onClick={onLeave} className={`inline-flex h-11 items-center gap-2 self-start rounded-[14px] border-2 border-[#6A4A45] px-4 font-extrabold text-cream hover:bg-[#5A3833]`}>
      <LogOut size={18} aria-hidden /> Выйти из комнаты
    </button>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 px-1 text-center">
      <span className="text-peach" aria-hidden>{icon}</span>
      <span className="font-display text-2xl leading-none tabular-nums"><span className="relative top-0.5">{value}</span></span>
      <span className={`whitespace-nowrap text-xs font-bold leading-tight ${MUTED}`}>{label}</span>
    </div>
  );
}

/** Вкладка «Образ»: превью + статистика слева, инвентарь и цвета справа. */
function LookTab({ t, progress, onLeave, unlocked }: { t: Tomato; progress: Progress; onLeave?: () => void; unlocked: { skins: string[]; items: string[] } | null }) {
  const me = t.snapshot?.me;
  const level = me?.level ?? progress.level;
  const saved = useMemo(() => lookOf(me?.userId ?? progress.userId, me?.avatar ?? t.user?.avatar), [me?.userId, me?.avatar, t.user?.avatar, progress.userId]);
  const [draft, setDraft] = useState<AvatarLook>(saved);
  const [saving, setSaving] = useState(false);
  // сохранённый образ сменился (например, с другой вкладки) — показываем его
  useEffect(() => { setDraft(saved); }, [saved]);
  const dirty = !sameLook(draft, saved);
  const cat = t.avatarCatalog;

  const span = progress.nextLevelXp - progress.levelStartXp;
  const pct = Math.min(100, ((progress.xp - progress.levelStartXp) / span) * 100);
  // ближайшая закрытая вещь или цвет — «текущая цель»
  // открыто ли: список от сервера (уровень и игра), без него — по уровню; вещи «за игру» без списка — закрыты
  const itemLocked = (it: (typeof cat.items)[number]) => (unlocked ? !unlocked.items.includes(it.id) : it.minLevel > level || !!it.unlock);
  const skinLocked = (sk: (typeof cat.skins)[number]) => (unlocked ? !unlocked.skins.includes(sk.id) : sk.minLevel > level);
  const next = [...cat.items.filter((x) => !x.unlock), ...cat.skins].filter((x) => x.minLevel > level).sort((a, b) => a.minLevel - b.minLevel)[0];
  const goalXp = next ? xpForLevel(next.minLevel) : 0;
  const achCount = progress.achievements.filter((a) => a.unlocked).length;

  const toggleItem = (slot: "head" | "face" | "neck", id: string) => setDraft((d) => ({ ...d, [slot]: d[slot] === id ? null : id }));
  const save = async () => {
    setSaving(true);
    const ok = await t.saveAvatar(draft);
    setSaving(false);
    if (ok) t.push("Образ сохранён — его видят все в комнате");
  };

  const skinTitle = cat.skins.find((x) => x.id === draft.skin)?.title ?? "";
  const saveBtn = (cls: string, testId = "save-look") => (
    <button type="button" onClick={save} disabled={!dirty || saving} className={`as-btn as-btn-light as-btn-sm whitespace-nowrap ${cls}`} data-testid={testId}>
      <Check size={18} strokeWidth={3} aria-hidden /> {saving ? "Сохраняем…" : dirty ? "Сохранить образ" : "Образ сохранён"}
    </button>
  );

  /*
   * Раскладка как на референсе: слева аксолотль и выбор цвета, справа инвентарь.
   * На широком экране левая колонка прилипает к верху — меняешь вещи справа и сразу видишь результат.
   * На телефоне и планшете колонки идут друг под другом, поэтому превью прилипает к верху панели
   * (левая колонка становится `contents`, порядок задаёт `order-*`).
   */
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-5">
      <div className="contents lg:sticky lg:top-0 lg:row-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        {/* ---------- превью ---------- */}
        <div className="sticky top-0 z-10 order-1 -mx-5 flex items-center gap-3 border-b-2 border-[#5A3833] bg-ink px-5 py-2.5 sm:-mx-6 sm:gap-5 sm:px-6 lg:static lg:order-none lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0" data-testid="look-preview">
          <div className="relative h-[104px] w-[104px] shrink-0 sm:h-[150px] sm:w-[150px] lg:h-[200px] lg:w-[200px]">
            <Axolotl look={draft} size={200} className="h-full w-full" title={`Ваш аксолотль: ${skinTitle}`} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3">
            <p className="truncate font-display text-2xl leading-none sm:text-4xl"><span className="relative top-1">{progress.name}</span></p>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-cream py-0.5 pl-0.5 pr-2.5 sm:gap-2 sm:py-1 sm:pl-1 sm:pr-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cream font-display text-base text-ink sm:h-8 sm:w-8 sm:text-lg"><span className="relative top-0.5">{level}</span></span>
                <span className="text-sm font-extrabold sm:text-base">уровень</span>
              </span>
              <span className={`whitespace-nowrap text-xs font-bold tabular-nums sm:text-sm ${MUTED}`}>{progress.xp} / {progress.nextLevelXp} XP</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border-2 border-[#6A4A45] bg-[#2A1817]" role="progressbar" aria-label="Прогресс уровня" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-peach transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            {/* на телефоне «Сохранить» прямо у превью: не нужно листать вниз */}
            {dirty && saveBtn("lg:hidden !min-h-[2.5rem] self-start", "save-look-top")}
          </div>
        </div>

        {/* ---------- выбор цвета (под превью, как «Выбери аксолотля» на референсе) ---------- */}
        <div className={`${CARD} order-2 flex flex-col gap-3 p-4 lg:order-none`}>
          <p className="flex items-center gap-2 whitespace-nowrap text-sm font-extrabold"><Palette size={16} aria-hidden />Выбери аксолотля<span className={`truncate font-bold ${MUTED}`}>· {skinTitle}</span></p>
          <div className="grid grid-cols-6 gap-2">
            {cat.skins.map((sk) => {
              const locked = skinLocked(sk);
              const on = draft.skin === sk.id;
              return (
                <div key={sk.id} className="flex min-w-0 flex-col items-center gap-1">
                  <button type="button" disabled={locked} aria-pressed={on} aria-label={locked ? `${sk.title}: с ${sk.minLevel} уровня` : sk.title} title={locked ? `«${sk.title}» откроется на ${sk.minLevel} уровне` : sk.title}
                    onClick={() => setDraft((d) => ({ ...d, skin: sk.id }))} data-skin-tile={sk.id}
                    className={`relative flex aspect-square w-full items-end justify-center overflow-hidden rounded-[14px] border-2 ${on ? "border-cream ring-2 ring-peach" : "border-[#6A4A45]"} disabled:cursor-not-allowed`} style={{ background: SKIN_BG[sk.id] }}>
                    <span className={`w-[88%] ${locked ? "opacity-40 grayscale" : ""}`}><Axolotl look={{ skin: sk.id, head: null, face: null, neck: null }} crop="head" size={48} className="h-auto w-full" /></span>
                    {locked && <Lock size={12} className="absolute right-1 top-1 text-ink" aria-hidden />}
                  </button>
                  {locked && <span className="whitespace-nowrap text-[10px] font-extrabold leading-none text-[#B8A39E]">ур. {sk.minLevel}</span>}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* ---------- справа: инвентарь ---------- */}
      <div className={`${CARD} order-3 flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:order-none lg:col-start-2 lg:row-start-1`}>
        <p className="flex items-center gap-2 font-display text-xl leading-none"><Shirt size={20} aria-hidden /><span className="relative top-0.5">Инвентарь</span></p>
        <ul className="grid grid-cols-3 gap-2.5 xs:grid-cols-4" aria-label="Вещи">
          {cat.items.map((it) => {
            const locked = itemLocked(it);
            const on = draft[it.slot] === it.id;
            return (
              <li key={it.id}>
                <button type="button" disabled={locked} aria-pressed={on} onClick={() => toggleItem(it.slot, it.id)} data-item-tile={it.id}
                  title={locked ? `«${it.title}»: ${it.unlock ? it.unlock.label : `откроется на ${it.minLevel} уровне`}` : on ? `Снять: ${it.title}` : `Надеть: ${it.title}`}
                  className={`relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[16px] border-2 p-1 transition-colors ${on ? "border-cream bg-[#5A3833]" : "border-[#6A4A45] bg-[#3B2422] hover:border-peach"} disabled:cursor-not-allowed`}>
                  <span className={locked ? "opacity-50" : ""}><ItemIcon id={it.id} size={54} /></span>
                  <span className={`max-w-full whitespace-nowrap px-0.5 text-[11px] font-extrabold leading-tight tracking-tight ${locked ? "text-[#B8A39E]" : "text-cream"}`}>{it.title}</span>
                  {locked && <span className="max-w-full truncate rounded-full bg-[#2A1817] px-1.5 text-[10px] font-extrabold leading-4 text-[#D8BDB6]">{it.unlock ? "Harvest" : `ур. ${it.minLevel}`}</span>}
                  {on && <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-cream text-ink" aria-hidden><Check size={14} strokeWidth={3} /></span>}
                  {locked && <span className="absolute right-1.5 top-1.5 text-[#B8A39E]" aria-hidden><Lock size={13} /></span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {saveBtn("min-w-[14rem] flex-1")}
          {dirty && (
            <button type="button" onClick={() => setDraft(saved)} className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[14px] border-2 border-[#6A4A45] px-3 font-extrabold text-cream hover:bg-[#5A3833]">
              <RotateCcw size={16} aria-hidden /> Отменить
            </button>
          )}
        </div>
        <p className={`text-xs ${MUTED}`}>Ваш аксолотль — в жетоне комнаты, в чате и на башнях, которые вы строите в Tower Wars. Новые вещи открываются с уровнем.</p>
      </div>

      {/* ---------- статистика и цель: под инвентарём (слева остаётся короткая колонка, она прилипает) ---------- */}
      <div className="order-4 flex min-w-0 flex-col gap-4 lg:order-none lg:col-start-2">
        <div className={`${CARD} p-4`}>
          <p className="mb-3 flex items-center gap-2 whitespace-nowrap font-extrabold"><BarChart3 size={18} aria-hidden /> Учебная статистика</p>
          <div className="grid grid-cols-4 divide-x divide-[#6A4A45]">
            <Stat icon={<Target size={18} />} value={String(progress.stats.completedSessions)} label="сессий" />
            <Stat icon={<Clock size={18} />} value={formatDuration(progress.stats.focusSeconds ?? 0)} label="в фокусе" />
            <Stat icon={<Flame size={18} />} value={String(progress.stats.bestStreakDays)} label="дней" />
            <Stat icon={<Trophy size={18} />} value={`${achCount}`} label="наград" />
          </div>
        </div>

        {next && (
          <div className={`${CARD} flex items-center gap-3 p-4`} data-testid="next-unlock">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border-2 border-[#6A4A45] bg-[#2A1817]">
              {"slot" in next ? <ItemIcon id={next.id} size={38} /> : <Axolotl look={{ skin: next.id, head: null, face: null, neck: null }} crop="head" size={40} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-bold ${MUTED}`}>Следующая награда</p>
              <p className="text-sm font-extrabold">«{next.title}» — с {next.minLevel} уровня</p>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#2A1817]">
                <div className="h-full rounded-full bg-peach" style={{ width: `${Math.min(100, (progress.xp / Math.max(1, goalXp)) * 100)}%` }} />
              </div>
              <p className={`mt-1 text-right text-xs font-bold tabular-nums ${MUTED}`}>{progress.xp} / {goalXp} XP</p>
            </div>
          </div>
        )}
        {onLeave && <LeaveButton onLeave={onLeave} />}
      </div>
    </div>
  );
}

/**
 * История по задачам: карточка — один заход (задача в комнате), внутри — его циклы фокуса.
 * Раньше каждый цикл был отдельной карточкой с той же задачей — выглядело как четыре разные задачи.
 */
function HistoryList({ sessions }: { sessions: StudySession[] }) {
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  if (groups.length === 0) return <p className={`text-sm ${MUTED}`}>Занятий пока нет.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="history">
      <p className={`text-sm ${MUTED}`}>Карточка — одна задача за один заход в комнату. Нажмите, чтобы увидеть её циклы фокуса.</p>
      <ul className="flex flex-col gap-2.5">
        {groups.map((g, i) => {
          const day = formatDay(g.startedAt);
          const span = `${formatClock(g.startedAt)}–${formatClock(g.endedAt)}`;
          return (
            <li key={g.key} className={CARD} data-history-group={g.key}>
              <details className="group" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="break-words text-[17px] font-extrabold leading-tight">{g.task?.trim() || "Без задачи"}</span>
                    <span className={`text-sm ${MUTED}`}>{g.roomName} · {day}, {span}</span>
                    <span className="flex flex-wrap gap-1.5 text-[13px] font-bold">
                      <span className="rounded-full bg-[#5A3E3A] px-2.5 py-0.5">{plural(g.cycles.length, "цикл", "цикла", "циклов")}</span>
                      <span className="rounded-full bg-[#5A3E3A] px-2.5 py-0.5">засчитано {g.counted}</span>
                      {g.early > 0 && <span className="rounded-full bg-[#5A3E3A] px-2.5 py-0.5 text-peach">без награды {g.early}</span>}
                      <span className="rounded-full bg-[#5A3E3A] px-2.5 py-0.5">{formatDuration(g.focusSec)} фокуса</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap font-display text-lg leading-none text-peach"><span className="relative top-0.5">+{g.xp} XP</span></span>
                    <span className={`whitespace-nowrap text-sm ${MUTED}`}>+{g.coins} монет</span>
                    <ChevronDown size={18} className="mt-1 transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <ol className="flex flex-col border-t-2 border-[#6A4A45] px-4 py-1.5" aria-label="Циклы фокуса">
                  {g.cycles.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-bold">Цикл {c.cycleNo}</span>
                        <span className={MUTED}> · {formatClock(c.startedAt)} · {formatDuration(c.status === "active" ? c.durationSec : workedSec(c))} · {cycleOutcome(c)}</span>
                        {c.result && <span className={MUTED}> · {RESULT_LABEL[c.result]}</span>}
                      </span>
                      <span className={`shrink-0 whitespace-nowrap font-bold ${c.rewarded ? "text-cream" : MUTED}`}>{c.rewarded ? `+${c.xp} XP · +${c.coins}` : "—"}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
