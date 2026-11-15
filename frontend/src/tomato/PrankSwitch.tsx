/**
 * «Получать шутки» — переключатель рядом с местами, где шутят (кейс §5.5: получение пакостей можно отключить).
 * Тот же флаг, что в Профиль → Настройки; проверяет сервер (выключивший не цель и сам не шутит).
 */
import { useState } from "react";
import type { Tomato } from "./useTomato";

export function PrankSwitch({ t, className = "" }: { t: Tomato; className?: string }) {
  const on = t.snapshot?.me?.prankEnabled !== false;
  const [busy, setBusy] = useState(false);
  const toggle = async () => { if (busy) return; setBusy(true); await t.setPranksEnabled(!on); setBusy(false); };
  return (
    <button type="button" role="switch" aria-checked={on} onClick={toggle} disabled={busy} data-testid="pranks-switch"
      title={on ? "Нажмите, чтобы в вас не шутили (и вы тоже не сможете шутить)" : "Нажмите, чтобы снова получать шутки"}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 border-ink bg-white py-1 pl-1 pr-3 text-[13px] font-extrabold text-ink transition-colors hover:bg-paper disabled:opacity-60 ${className}`}>
      <span className={`relative h-5 w-9 shrink-0 rounded-full border-2 border-ink transition-colors ${on ? "bg-lime" : "bg-soft"}`} aria-hidden>
        <span className={`absolute top-[2px] h-3 w-3 rounded-full bg-ink transition-[left] duration-150 ${on ? "left-[17px]" : "left-[2px]"}`} />
      </span>
      {on ? "Получать шутки: да" : "Получать шутки: нет"}
    </button>
  );
}
