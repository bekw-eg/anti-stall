import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Clock, Flame, Gift, History, KeyRound, Lock, LogOut, Palette, RotateCcw, Settings, Shirt, Smartphone, Sparkles, Target, Trophy } from "lucide-react";
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
const xpForLevel = (n: number) => 50 * n * (n - 1); // как на сервере (catalog.js) — только для подписи цели

/*
 * Светлая система, как у «Друзей» и «Прогресса»: кремовый фон, белые карточки в толстой рамке цвета ink
 * с жёсткой тенью, цветные шапки карточек, крупные цифры шрифтом заголовков. Цвета заданы явно (text-ink,
 * text-mute), а не наследуются — профиль одинаково читается в шторке комнаты (в том числе на тёмном фокусе) и на главной.
 */
const CARD = "rounded-[24px] border-2 border-ink bg-white as-shadow-sm";
const INPUT = "h-11 min-w-0 flex-1 rounded-[14px] border-2 border-line bg-white px-3 text-ink outline-none placeholder:text-[#A08A86] focus:border-ink";
const PILL = "rounded-full bg-paper px-2.5 py-0.5 text-ink";
const sameLook = (a: AvatarLook, b: AvatarLook) => a.skin === b.skin && a.head === b.head && a.face === b.face && a.neck === b.neck;

/** Карточка с цветной шапкой (как командные карточки в «Прогрессе»). */
function Card({ title, icon, tint, aside, children, className = "", testId, label }: { title: ReactNode; icon?: ReactNode; tint: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string; label?: string }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col overflow-hidden ${className}`} data-testid={testId} aria-label={label}>
      <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-4 py-2.5" style={{ background: tint }}>
        <h3 className="flex min-w-0 items-center gap-2 font-display text-lg leading-none text-ink">
          {icon && <span className="shrink-0" aria-hidden>{icon}</span>}
          <span className="relative top-0.5 truncate">{title}</span>
        </h3>
        {aside}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/** Толстая полоска прогресса в обводке — та же, что в «Прогрессе». */
function Bar({ pct, label, color = "#EAA695", small = false }: { pct: number; label: string; color?: string; small?: boolean }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`${small ? "h-3" : "h-4"} overflow-hidden rounded-full border-2 border-ink bg-white`} role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

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

  if (!progress) return <p className="min-h-full bg-paper p-6 text-sm font-bold text-mute">Загружаем профиль…</p>;

  return (
    <div className="flex min-h-full flex-col gap-5 bg-paper p-4 text-ink sm:p-6" data-testid="profile-panel">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5 pt-0.5" role="tablist" aria-label="Разделы профиля">
        {TABS.map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`profile-tab-${id}`}
            className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full border-2 px-4 text-[15px] font-extrabold text-ink transition-colors ${tab === id ? "border-ink bg-lime as-shadow-sm" : "border-line bg-white hover:border-ink"}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "look" && <LookTab t={t} progress={progress} onLeave={onLeave} unlocked={unlocked} />}

      {tab === "upgrades" && (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="upgrades">
          {focusing && <li className="rounded-[16px] border-2 border-dashed border-line bg-white px-3 py-2.5 text-sm font-bold text-mute md:col-span-2">Покупки доступны на перерыве.</li>}
          {progress.upgrades.map((u) => (
            <li key={u.id} className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold leading-tight">{u.title}</p>
                  <p className="mt-1 text-sm text-mute">{u.description}</p>
                </div>
                <span className="shrink-0 rounded-full border-2 border-ink bg-petal px-2.5 py-0.5 font-display text-base leading-none tabular-nums"><span className="relative top-0.5">{u.level}/{u.maxLevel}</span></span>
              </div>
              <div className="flex gap-1.5" aria-hidden>{Array.from({ length: u.maxLevel }, (_, i) => <span key={i} className={`h-3 flex-1 rounded-full border-2 border-ink ${i < u.level ? "bg-peach" : "bg-white"}`} />)}</div>
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
        <div className="flex flex-col gap-3">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl leading-none">Достижения</span>
            <span className="text-sm font-extrabold text-mute">{progress.achievements.filter((a) => a.unlocked).length} из {progress.achievements.length}</span>
          </p>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {progress.achievements.map((a) => (
              <li key={a.id} data-achievement={a.id} data-unlocked={a.unlocked ? "true" : "false"}
                className={`flex items-start gap-3 rounded-[18px] border-2 p-3.5 ${a.unlocked ? "border-ink bg-[#EEF0D2] as-shadow-sm" : "border-dashed border-line bg-white"}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${a.unlocked ? "border-ink bg-lime text-ink" : "border-line text-[#B8A39E]"}`} aria-hidden>
                  {a.unlocked ? <Trophy size={16} strokeWidth={2.5} /> : <Lock size={15} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`font-extrabold leading-tight ${a.unlocked ? "text-ink" : "text-mute"}`}>{a.title}</span>
                    <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-white px-1.5 text-xs font-extrabold leading-5 text-ink">+{a.reward.coins}<SeedIcon className="h-3.5 w-3.5" /></span>
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-mute">{a.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "history" && <HistoryList sessions={sessions} />}

      {tab === "settings" && (
        <div className="flex flex-col gap-4">
          {t.demoMode && <DemoBadge className="self-start" />}
          <label className={`${CARD} flex cursor-pointer items-start gap-3 p-4`}>
            <input
              type="checkbox" role="switch" data-testid="pranks-toggle" className="mt-1 h-5 w-5 shrink-0 accent-[#A0726D]"
              checked={progress.prankEnabled}
              onChange={async (e) => {
                // галочка переключается сразу; при ошибке сервера — откат
                const on = e.target.checked;
                setProgress((p) => (p ? { ...p, prankEnabled: on } : p));
                const ok = await t.setPranksEnabled(on);
                if (!ok) setProgress((p) => (p ? { ...p, prankEnabled: !on } : p));
              }}
            />
            <span><span className="font-extrabold">Получать шутки</span><span className="block text-sm text-mute">Шутки — часть игры на перерыве. Если выключить, вас нельзя выбрать целью и отправлять их тоже нельзя.</span></span>
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = login0 ? await t.changePassword(current, password) : await t.registerAccount(name, login.trim(), password);
    if (ok) { setPassword(""); setCurrent(""); }
    setBusy(false);
  };
  return (
    <Card title={login0 ? <>Аккаунт: {login0}</> : "Сохранить аккаунт"} icon={<KeyRound size={18} />} tint="#FFCEC2" testId="account-card" label="Аккаунт">
      <p className="text-sm text-mute">{login0 ? "Входите этим логином и паролем на любом устройстве. Здесь можно сменить пароль." : "Сейчас вы гость: профиль одноразовый и исчезнет, когда закроете браузер. Задайте логин и пароль — прогресс, друзья и образ сохранятся, входите с любого устройства. Почта не нужна."}</p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        {login0 ? (
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" placeholder="Текущий пароль" aria-label="Текущий пароль" className={INPUT} />
        ) : (
          <input value={login} onChange={(e) => setLogin(e.target.value)} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Логин" aria-label="Логин" className={INPUT} />
        )}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="new-password" placeholder={login0 ? "Новый пароль" : "Пароль (от 8 символов)"} aria-label={login0 ? "Новый пароль" : "Пароль"} className={INPUT} />
        <button type="submit" disabled={busy || password.length < 8 || (login0 ? !current : login.trim().length < 3)} className="as-btn as-btn-primary as-btn-sm shrink-0">{login0 ? "Сменить" : "Сохранить"}</button>
      </form>
    </Card>
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
    <Card title="Вход с другого устройства" icon={<Smartphone size={18} />} tint="#D9DE9F" testId="transfer-card" label="Вход с другого устройства">
      <p className="text-sm text-mute">Чтобы открыть аккаунт на телефоне или другом компьютере, возьмите одноразовый код и введите его там на экране входа — «Перенести аккаунт». Друзья, уровень и образ останутся с вами.</p>
      {code && left > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] border-2 border-dashed border-rose bg-white px-4 py-3">
          <span className="font-display text-3xl tracking-[0.12em] text-ink" data-testid="transfer-code"><span className="relative top-1">{code.code}</span></span>
          <span className="text-sm font-bold text-mute">действует ещё {left} мин, только один раз</span>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); const c = await t.newTransferCode(); if (c) setCode(c); setBusy(false); }}
          className="as-btn as-btn-secondary as-btn-sm self-start"><KeyRound size={18} aria-hidden />Получить код</button>
      )}
    </Card>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <button type="button" onClick={onLeave} className="as-btn as-btn-secondary as-btn-sm self-start">
      <LogOut size={18} aria-hidden /> Выйти из комнаты
    </button>
  );
}

/** Плитка цифры, как в «Прогрессе»: значок в цветном квадрате, подпись, крупное число. */
function Stat({ icon, value, label, tint }: { icon: ReactNode; value: string; label: string; tint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[18px] border-2 border-ink bg-white p-3 as-shadow-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border-2 border-ink text-ink" style={{ background: tint }} aria-hidden>{icon}</span>
        <span className="min-w-0 truncate text-[13px] font-bold leading-tight text-mute">{label}</span>
      </span>
      <span className="truncate font-display text-[26px] leading-none tabular-nums text-ink"><span className="relative top-0.5">{value}</span></span>
    </div>
  );
}

/** Вкладка «Образ»: слева аксолотль (герой) и выбор цвета, справа инвентарь, статистика и ближайшая награда. */
function LookTab({ t, progress, onLeave, unlocked }: { t: Tomato; progress: Progress; onLeave?: () => void; unlocked: { skins: string[]; items: string[] } | null }) {
  const me = t.snapshot?.me;
  const level = me?.level ?? progress.level;
  const coins = me?.coins ?? progress.coins ?? t.user?.coins ?? 0;
  const saved = useMemo(() => lookOf(me?.userId ?? progress.userId, me?.avatar ?? t.user?.avatar), [me?.userId, me?.avatar, t.user?.avatar, progress.userId]);
  const [draft, setDraft] = useState<AvatarLook>(saved);
  const [saving, setSaving] = useState(false);
  // сохранённый образ сменился (например, с другой вкладки) — показываем его
  useEffect(() => { setDraft(saved); }, [saved]);
  const dirty = !sameLook(draft, saved);
  const cat = t.avatarCatalog;

  const span = progress.nextLevelXp - progress.levelStartXp;
  const pct = span > 0 ? ((progress.xp - progress.levelStartXp) / span) * 100 : 100;
  // открыто ли: список от сервера (уровень и игра), без него — по уровню; вещи «за игру» без списка — закрыты
  const itemLocked = (it: (typeof cat.items)[number]) => (unlocked ? !unlocked.items.includes(it.id) : it.minLevel > level || !!it.unlock);
  const skinLocked = (sk: (typeof cat.skins)[number]) => (unlocked ? !unlocked.skins.includes(sk.id) : sk.minLevel > level);
  // ближайшая закрытая вещь или цвет — «текущая цель»
  const next = [...cat.items.filter((x) => !x.unlock), ...cat.skins].filter((x) => x.minLevel > level).sort((a, b) => a.minLevel - b.minLevel)[0];
  const goalXp = next ? xpForLevel(next.minLevel) : 0;
  const achCount = progress.achievements.filter((a) => a.unlocked).length;
  const worn = [draft.head, draft.face, draft.neck].filter(Boolean).length;

  const toggleItem = (slot: "head" | "face" | "neck", id: string) => setDraft((d) => ({ ...d, [slot]: d[slot] === id ? null : id }));
  const save = async () => {
    setSaving(true);
    const ok = await t.saveAvatar(draft);
    setSaving(false);
    if (ok) t.push("Образ сохранён — его видят все в комнате");
  };

  const skinTitle = cat.skins.find((x) => x.id === draft.skin)?.title ?? "";
  const saveBtn = (cls: string, testId = "save-look") => (
    <button type="button" onClick={save} disabled={!dirty || saving} className={`as-btn as-btn-primary as-btn-sm whitespace-nowrap ${cls}`} data-testid={testId}>
      <Check size={18} strokeWidth={3} aria-hidden /> {saving ? "Сохраняем…" : dirty ? "Сохранить образ" : "Образ сохранён"}
    </button>
  );

  /*
   * Слева — герой (аксолотль на фоне своего цвета) и выбор цвета, справа — инвентарь и цифры.
   * На широком экране левая колонка прилипает к верху: меняешь вещи справа и сразу видишь результат.
   * На телефоне колонки идут друг под другом, а превью прилипает к верху панели
   * (левая колонка становится `contents`, порядок задаёт `order-*`).
   */
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start lg:gap-5">
      <div className="contents lg:sticky lg:top-0 lg:row-span-3 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        {/* ---------- герой: аксолотль, имя, уровень, XP ---------- */}
        <div className="sticky top-0 z-10 order-1 -mx-4 bg-paper px-4 pb-2 sm:-mx-6 sm:px-6 lg:static lg:order-none lg:mx-0 lg:bg-transparent lg:p-0" data-testid="look-preview">
          <div className={`${CARD} flex items-stretch overflow-hidden lg:flex-col`}>
            <div className="relative flex shrink-0 items-end justify-center border-r-2 border-ink p-1.5 lg:border-b-2 lg:border-r-0 lg:p-3" style={{ background: SKIN_BG[draft.skin] }}>
              <div className="h-[96px] w-[96px] sm:h-[132px] sm:w-[132px] lg:h-[220px] lg:w-[220px]">
                <Axolotl look={draft} size={220} className="h-full w-full" title={`Ваш аксолотль: ${skinTitle}`} />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-3 sm:gap-3 sm:p-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lime font-display text-lg text-ink sm:h-12 sm:w-12 sm:text-xl" title="Уровень"><span className="relative top-0.5">{level}</span></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-xl leading-tight text-ink sm:text-3xl"><span className="relative top-0.5">{progress.name}</span></span>
                  <span className="block text-xs font-bold tabular-nums text-mute sm:text-sm">уровень {level} · {progress.xp} / {progress.nextLevelXp} XP</span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-petal px-2.5 py-0.5 xs:inline-flex" title="Ваши монеты" aria-label={`Монеты: ${coins}`}>
                  <SeedIcon className="h-5 w-5" /><span className="font-display text-lg leading-none tabular-nums" aria-hidden><span className="relative top-0.5">{coins}</span></span>
                </span>
              </div>
              <Bar pct={pct} label="Прогресс уровня" />
              {/* на телефоне «Сохранить» прямо у превью: не нужно листать вниз */}
              {dirty && saveBtn("lg:hidden !min-h-[2.5rem] self-start", "save-look-top")}
            </div>
          </div>
        </div>

        {/* ---------- выбор цвета ---------- */}
        <Card title="Выбери аксолотля" icon={<Palette size={18} />} tint="#FFCEC2" className="order-2 lg:order-none"
          aside={<span className="truncate rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-xs font-extrabold text-ink">{skinTitle}</span>}>
          <div className="grid grid-cols-6 gap-2">
            {cat.skins.map((sk) => {
              const locked = skinLocked(sk);
              const on = draft.skin === sk.id;
              return (
                <div key={sk.id} className="flex min-w-0 flex-col items-center gap-1">
                  <button type="button" disabled={locked} aria-pressed={on} aria-label={locked ? `${sk.title}: с ${sk.minLevel} уровня` : sk.title} title={locked ? `«${sk.title}» откроется на ${sk.minLevel} уровне` : sk.title}
                    onClick={() => setDraft((d) => ({ ...d, skin: sk.id }))} data-skin-tile={sk.id}
                    className={`relative flex aspect-square w-full items-end justify-center overflow-hidden rounded-[14px] border-2 transition-shadow ${on ? "border-ink ring-2 ring-rose ring-offset-2 ring-offset-white" : locked ? "border-dashed border-line" : "border-line hover:border-ink"} disabled:cursor-not-allowed`} style={{ background: SKIN_BG[sk.id] }}>
                    <span className={`w-[88%] ${locked ? "opacity-40 grayscale" : ""}`}><Axolotl look={{ skin: sk.id, head: null, face: null, neck: null }} crop="head" size={48} className="h-auto w-full" /></span>
                    {locked && <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink" aria-hidden><Lock size={10} strokeWidth={3} /></span>}
                  </button>
                  {locked && <span className="whitespace-nowrap text-[10px] font-extrabold leading-none text-mute">ур. {sk.minLevel}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---------- инвентарь ---------- */}
      <Card title="Инвентарь" icon={<Shirt size={18} />} tint="#FCE3DB" className="order-3 lg:order-none lg:col-start-2 lg:row-start-1"
        aside={<span className="shrink-0 rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-xs font-extrabold text-ink">надето: {worn}</span>}>
        <ul className="grid grid-cols-3 gap-2.5 xs:grid-cols-4" aria-label="Вещи">
          {cat.items.map((it) => {
            const locked = itemLocked(it);
            const on = draft[it.slot] === it.id;
            return (
              <li key={it.id}>
                <button type="button" disabled={locked} aria-pressed={on} onClick={() => toggleItem(it.slot, it.id)} data-item-tile={it.id}
                  title={locked ? `«${it.title}»: ${it.unlock ? it.unlock.label : `откроется на ${it.minLevel} уровне`}` : on ? `Снять: ${it.title}` : `Надеть: ${it.title}`}
                  className={`relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[16px] border-2 p-1 transition-colors ${on ? "border-ink bg-[#EEF0D2] as-shadow-sm" : locked ? "border-dashed border-line bg-white" : "border-line bg-paper hover:border-ink"} disabled:cursor-not-allowed`}>
                  <span className={locked ? "opacity-40 grayscale" : ""}><ItemIcon id={it.id} size={52} /></span>
                  <span className={`max-w-full truncate px-0.5 text-[11px] font-extrabold leading-tight tracking-tight ${locked ? "text-mute" : "text-ink"}`}>{it.title}</span>
                  {locked && <span className="max-w-full truncate rounded-full bg-soft px-1.5 text-[10px] font-extrabold leading-4 text-ink">{it.unlock ? "Harvest" : `ур. ${it.minLevel}`}</span>}
                  {on && <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-lime text-ink" aria-hidden><Check size={14} strokeWidth={3} /></span>}
                  {locked && <span className="absolute right-1.5 top-1.5 text-mute" aria-hidden><Lock size={13} strokeWidth={2.5} /></span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {saveBtn("min-w-[13rem] flex-1")}
          {dirty && (
            <button type="button" onClick={() => setDraft(saved)} className="as-btn as-btn-secondary as-btn-sm whitespace-nowrap">
              <RotateCcw size={16} aria-hidden /> Отменить
            </button>
          )}
        </div>
        <p className="text-xs font-semibold text-mute">Ваш аксолотль — в жетоне комнаты, в чате и на башнях, которые вы строите в Tower Wars. Новые вещи открываются с уровнем.</p>
      </Card>

      {/* ---------- учебная статистика ---------- */}
      <section className="order-4 flex min-w-0 flex-col gap-3 lg:order-none lg:col-start-2" aria-label="Учебная статистика">
        <h3 className="font-display text-2xl leading-none text-ink">Учебная статистика</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          <Stat icon={<Target size={15} strokeWidth={2.5} />} tint="#D9DE9F" value={String(progress.stats.completedSessions)} label="сессий" />
          <Stat icon={<Clock size={15} strokeWidth={2.5} />} tint="#FFCEC2" value={formatDuration(progress.stats.focusSeconds ?? 0)} label="в фокусе" />
          <Stat icon={<Flame size={15} strokeWidth={2.5} />} tint="#EAA695" value={`${progress.stats.bestStreakDays} дн.`} label="серия" />
          <Stat icon={<Trophy size={15} strokeWidth={2.5} />} tint="#FCE3DB" value={String(achCount)} label="наград" />
        </div>
      </section>

      {/* ---------- ближайшая награда ---------- */}
      <div className="order-5 flex min-w-0 flex-col gap-4 lg:order-none lg:col-start-2">
        {next && (
          <Card title="Следующая награда" icon={<Gift size={18} />} tint="#D9DE9F" testId="next-unlock">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-2 border-ink" style={{ background: "slot" in next ? "#F6EFEC" : SKIN_BG[next.id as AvatarLook["skin"]] }}>
                {"slot" in next ? <ItemIcon id={next.id} size={42} /> : <Axolotl look={{ skin: next.id as AvatarLook["skin"], head: null, face: null, neck: null }} crop="head" size={46} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold leading-tight">«{next.title}»</p>
                <p className="text-sm font-bold text-mute">откроется на {next.minLevel} уровне</p>
              </div>
            </div>
            <Bar pct={(progress.xp / Math.max(1, goalXp)) * 100} label="Прогресс до следующей награды" color="#D9DE9F" small />
            <p className="-mt-1 text-right text-xs font-bold tabular-nums text-mute">{progress.xp} / {goalXp} XP</p>
          </Card>
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
  if (groups.length === 0) return <p className="rounded-[16px] border-2 border-dashed border-line bg-white px-4 py-3 text-sm font-bold text-mute">Занятий пока нет.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="history">
      <p className="text-sm font-semibold text-mute">Карточка — одна задача за один заход в комнату. Нажмите, чтобы увидеть её циклы фокуса.</p>
      <ul className="flex flex-col gap-3">
        {groups.map((g, i) => {
          const day = formatDay(g.startedAt);
          const span = `${formatClock(g.startedAt)}–${formatClock(g.endedAt)}`;
          return (
            <li key={g.key} className={`${CARD} overflow-hidden`} data-history-group={g.key}>
              <details className="group" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-[#FFFBF9] [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="break-words text-[17px] font-extrabold leading-tight text-ink">{g.task?.trim() || "Без задачи"}</span>
                    <span className="text-sm text-mute">{g.roomName} · {day}, {span}</span>
                    <span className="flex flex-wrap gap-1.5 text-[13px] font-bold">
                      <span className={PILL}>{plural(g.cycles.length, "цикл", "цикла", "циклов")}</span>
                      <span className={PILL}>засчитано {g.counted}</span>
                      {g.early > 0 && <span className="rounded-full bg-blush px-2.5 py-0.5 text-ink">без награды {g.early}</span>}
                      <span className={PILL}>{formatDuration(g.focusSec)} фокуса</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap rounded-full border-2 border-ink bg-lime px-2.5 py-0.5 font-display text-base leading-none text-ink"><span className="relative top-0.5">+{g.xp} XP</span></span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-mute">+{g.coins}<SeedIcon className="h-4 w-4" /></span>
                    <ChevronDown size={18} className="mt-1 text-ink transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <ol className="flex flex-col border-t-2 border-ink bg-paper px-4 py-1.5" aria-label="Циклы фокуса">
                  {g.cycles.map((c, j) => (
                    <li key={c.id} className={`flex items-start justify-between gap-3 py-2 text-sm ${j ? "border-t-2 border-soft" : ""}`}>
                      <span className="min-w-0">
                        <span className="font-extrabold text-ink">Цикл {c.cycleNo}</span>
                        <span className="text-mute"> · {formatClock(c.startedAt)} · {formatDuration(c.status === "active" ? c.durationSec : workedSec(c))} · {cycleOutcome(c)}</span>
                        {c.rating ? <span className="text-rose" aria-label={`оценка ${c.rating} из 5`}> · {"★".repeat(c.rating)}</span> : null}
                        {c.result && <span className="text-mute"> · {RESULT_LABEL[c.result]}</span>}
                      </span>
                      <span className={`shrink-0 whitespace-nowrap text-right font-extrabold ${c.rewarded ? "text-ink" : "text-mute"}`}>
                        {c.rewarded ? `+${c.xp} XP · +${c.coins}` : "—"}
                        {c.rewarded && c.bonusXp ? <span className="block text-[12px] font-bold text-olive">бонус команды +{c.bonusXp} XP</span> : null}
                      </span>
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
