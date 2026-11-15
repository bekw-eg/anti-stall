/**
 * 05 Auth / Guest (Figma, страница back) + выбор «создать / войти по коду».
 * На сервере аккаунт — это имя и токен (без почты и пароля), поэтому экраны 02–04 с email не подключены:
 * вход гостем — единственный честный путь. Комната создаётся с настройками по умолчанию, хост меняет их в лобби.
 */
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { DemoBadge } from "../Chrome";
import { extractRoomCode } from "../format";
import type { Tomato } from "../useTomato";
import { Avatar, Logo } from "./ui";

export type JoinMode = "create" | "join";

/**
 * Перенос аккаунта на это устройство: код со старого устройства (Профиль → Настройки → «Получить код»).
 * Отдельная мини-форма внутри основной: Enter в поле кода не отправляет форму входа.
 */
function TransferEntry({ t }: { t: Tomato }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = code.replace(/[^A-Za-z0-9]/g, "").length >= 9;
  const go = async () => { if (!ok || busy) return; setBusy(true); await t.redeemTransfer(code); setBusy(false); };
  if (!open) {
    return (
      <p className="text-base text-mute">
        Профиль живёт в этом браузере. Играли на другом устройстве?{" "}
        <button type="button" onClick={() => setOpen(true)} className="font-extrabold text-ink underline underline-offset-4 hover:text-rose" data-testid="open-transfer">Перенести аккаунт</button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border-2 border-line bg-paper p-4" data-testid="transfer-entry">
      <span className="as-label">Код переноса</span>
      <p className="-mt-1 text-sm text-mute">На старом устройстве: Профиль → Настройки → «Получить код». Код действует 10 минут.</p>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
          maxLength={14} autoCapitalize="characters" spellCheck={false} placeholder="ABC-DEF-GHJ" aria-label="Код переноса"
          className="as-input min-w-0 flex-1 font-display tracking-[0.12em] placeholder:font-sans placeholder:tracking-normal" />
        <button type="button" onClick={go} disabled={!ok || busy} className="as-btn as-btn-secondary as-btn-sm shrink-0 sm:min-h-[4rem]">{busy ? "…" : "Войти"}</button>
      </div>
    </div>
  );
}

export function JoinScreen({ t, initialMode, initialCode = "", onBack }: { t: Tomato; initialMode: JoinMode; initialCode?: string; onBack: () => void }) {
  const [mode, setMode] = useState<JoinMode>(initialCode ? "join" : initialMode);
  const [code, setCode] = useState(initialCode);
  // как в макете лобби: по умолчанию две команды (A и B); выключить можно до создания, потом режим не меняется
  const [teamMode, setTeamMode] = useState(true);
  const name = t.name;
  const nameOk = name.trim().length > 0;
  const codeOk = Boolean(extractRoomCode(code));
  const level = t.user?.level ?? 1;
  const coins = t.user?.coins ?? 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameOk || t.busy) return;
    if (mode === "create") {
      // демо-сервер: секунды вместо минут, комната всегда демо (сервер это проверяет)
      const timing = t.demoMode ? { demo: true, focusSeconds: 25, breakSeconds: 15 } : { focusSeconds: 25 * 60, breakSeconds: 5 * 60 };
      t.createRoom(name, { ...timing, cycles: 4, teamMode });
    } else if (codeOk) t.joinRoom(name, code);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white" data-testid="join-screen">
      <header className="mx-auto flex w-full max-w-[1488px] items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6 lg:px-12">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl py-2 text-lg font-bold sm:text-xl">
          <ArrowLeft size={24} strokeWidth={2.4} aria-hidden /> Назад
        </button>
        <Logo />
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-10 px-4 pb-12 sm:px-8 lg:grid-cols-[minmax(0,560px)_minmax(0,400px)] lg:justify-between lg:gap-16 lg:pb-20">
        <form onSubmit={submit} className="flex flex-col gap-6 sm:gap-7" aria-labelledby="join-h">
          <div className="flex flex-col gap-3">
            <h1 id="join-h" className="font-display text-[clamp(2.25rem,7vw,3.25rem)] leading-[1.05]">Вход гостем</h1>
            <p className="text-lg text-mute sm:text-xl">Нужно только имя. Уровень и монеты сохранятся в этом браузере.</p>
            {t.demoMode && <DemoBadge className="self-start" />}
          </div>

          <label className="flex flex-col gap-2.5">
            <span className="as-label">Как тебя зовут?</span>
            <input value={name} onChange={(e) => t.setName(e.target.value)} maxLength={24} required autoComplete="nickname" placeholder="Например, Лотти" className="as-input" />
          </label>

          <div className="flex rounded-[18px] border-2 border-ink bg-paper p-1" role="radiogroup" aria-label="Что сделать">
            {([["create", "Создать комнату"], ["join", "Войти по коду"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
                className={`flex-1 rounded-[14px] px-3 py-3 text-base font-extrabold transition-colors sm:text-lg ${mode === id ? "bg-white text-ink as-shadow-sm" : "text-mute hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === "create" ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-[18px] border-2 border-line bg-white p-4">
              <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#A0726D]" />
              <span>
                <span className="block text-lg font-extrabold">Две команды</span>
                <span className="block text-mute">Красные и Синие идут к цели наперегонки и мешают друг другу на перерыве. После создания режим не меняется.</span>
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-2.5">
              <span className="as-label">Код или ссылка на комнату</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" spellCheck={false} placeholder="K7QM2X" className="as-input font-display tracking-[0.12em] placeholder:font-sans placeholder:tracking-normal" />
            </label>
          )}

          <button type="submit" className="as-btn as-btn-primary w-full" disabled={!nameOk || t.busy || (mode === "join" && !codeOk)}>
            {t.busy ? "Подождите…" : mode === "create" ? "Создать комнату" : "Войти в комнату"}
          </button>
          <TransferEntry t={t} />
        </form>

        <aside className="hidden flex-col items-center gap-5 text-center lg:flex" aria-label="Ваш жетон">
          <div className="flex aspect-square w-full max-w-[400px] items-center justify-center rounded-full border-2 border-ink bg-rose as-shadow">
            <Avatar name={name || "?"} id={t.user?.id ?? name} look={t.user?.avatar} size={180} ring="#3B2422" />
          </div>
          <p className="font-display text-[44px] leading-none">{name.trim() || "Ваше имя"}</p>
          <p className="text-xl text-mute">Уровень {level} · {coins} монет</p>
        </aside>
      </main>
    </div>
  );
}
