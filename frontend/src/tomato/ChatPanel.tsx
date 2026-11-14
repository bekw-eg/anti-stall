import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { formatAgo, initials } from "./format";
import { TEAM_COLOR } from "./socialRules";
import { useNow } from "./useMedia";
import type { Tomato } from "./useTomato";

const MAX_LEN = 300;

/**
 * Текстовый чат комнаты. В фокусе — только чтение (учёба важнее), на перерыве и в ожидании можно писать.
 * Правила (длина, антиспам, фаза) проверяет сервер; здесь — только подсказки и отображение.
 */
export function ChatPanel({ t }: { t: Tomato }) {
  useNow(15_000);
  const snap = t.snapshot!;
  const meId = snap.me?.userId;
  const readOnly = snap.room.phase === "focus";
  const teamOf = new Map(snap.members.map((m) => [m.userId, m.team]));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const now = t.serverNow();

  // Новое сообщение — прокручиваем вниз
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [t.chat.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || readOnly || sending) return;
    setSending(true);
    const ok = await t.sendChat(v);
    setSending(false);
    if (ok) setText("");
  };

  return (
    <div className="flex h-full flex-col gap-3 p-5 sm:p-6" data-testid="chat-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em]">Чат комнаты</h2>
        <p className="text-xs text-[var(--muted)]">{readOnly ? "Идёт фокус — чат только для чтения" : "Можно писать"}</p>
      </div>

      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-label="Сообщения" aria-live="polite">
        {t.chat.length === 0 && <li className="text-sm text-[var(--muted)]">Пока тихо — напишите первым на перерыве.</li>}
        {t.chat.map((m) => {
          const mine = m.userId === meId;
          return (
            <li key={m.id} className={`flex items-start gap-2 ${mine ? "flex-row-reverse text-right" : ""}`} data-chat-message={m.id}>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-zinc-900" style={{ background: TEAM_COLOR[teamOf.get(m.userId) ?? "shared"] ?? TEAM_COLOR.shared }}>
                {initials(m.name)}
              </span>
              <div className={`min-w-0 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-[var(--fg)] text-[var(--field)]" : "bg-[var(--card)]"}`}>
                <p className={`text-[11px] ${mine ? "opacity-70" : "text-[var(--muted)]"}`}>{mine ? "вы" : m.name} · {formatAgo(m.at, now)}</p>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Сообщение</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_LEN}
            disabled={readOnly}
            placeholder={readOnly ? "Чат откроется на перерыве" : "Напишите сообщение…"}
            className="w-full rounded-full border border-[var(--line)] bg-transparent px-4 py-2 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <button type="submit" disabled={readOnly || sending || !text.trim()} aria-label="Отправить" className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--field)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
