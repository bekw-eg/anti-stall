import { useEffect, useRef, useState } from "react";
import { ArrowDown, Send } from "lucide-react";
import { formatAgo } from "./format";
import { Avatar } from "./screens/ui";
import { TEAM_COLOR } from "./socialRules";
import { useNow } from "./useMedia";
import type { Tomato } from "./useTomato";

const MAX_LEN = 300;
/** Одинаковая высота окна чата везде (лобби, фокус, перерыв): лента прокручивается внутри, страница не растёт. */
export const CHAT_CARD_SIZE = "h-[min(540px,66dvh)] min-h-[300px]";
/** «У дна» — допуск в пикселях, чтобы прокрутка вниз не срывалась на долях пикселя. */
const NEAR_BOTTOM = 48;

/**
 * Текстовый чат комнаты. В фокусе — только чтение (учёба важнее), на перерыве и в ожидании можно писать.
 * Правила (длина, антиспам, фаза) проверяет сервер; здесь — только подсказки и отображение.
 */
export function ChatPanel({ t }: { t: Tomato }) {
  useNow(15_000);
  const snap = t.snapshot!;
  const meId = snap.me?.userId;
  const teamOf = new Map(snap.members.map((m) => [m.userId, m.team]));
  const lookById = new Map(snap.members.map((m) => [m.userId, m.avatar]));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const seenCount = useRef(t.chat.length);
  const [unseen, setUnseen] = useState(0);
  const now = t.serverNow();

  const toBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setUnseen(0);
  };
  // при открытии — сразу к последним сообщениям
  useEffect(() => { toBottom(); }, []);
  // Новое сообщение: если читатель внизу (или написал сам) — прокручиваем; если листает историю — не дёргаем,
  // а показываем кнопку «Новые»
  useEffect(() => {
    const added = t.chat.length - seenCount.current;
    seenCount.current = t.chat.length;
    if (added <= 0) return;
    const last = t.chat[t.chat.length - 1];
    if (atBottom.current || last?.userId === meId) toBottom();
    else setUnseen((n) => n + added);
  }, [t.chat.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
    if (atBottom.current && unseen) setUnseen(0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    const ok = await t.sendChat(v);
    setSending(false);
    if (ok) setText("");
  };

  return (
    <div className="flex h-full flex-col gap-3 p-5 sm:p-6" data-testid="chat-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">Чат комнаты</h2>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <ol ref={listRef} onScroll={onScroll} tabIndex={0} data-testid="chat-list"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-2 [scrollbar-color:var(--muted)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fg)]"
        aria-label="Сообщения" aria-live="polite">
        {t.chat.length === 0 && <li className="text-sm text-[var(--muted)]">Пока тихо. Напишите первым.</li>}
        {t.chat.map((m) => {
          const mine = m.userId === meId;
          return (
            <li key={m.id} className={`flex items-start gap-2 ${mine ? "flex-row-reverse text-right" : ""}`} data-chat-message={m.id}>
              <Avatar name={m.name} id={m.userId} look={lookById.get(m.userId)} size={28} ring={TEAM_COLOR[teamOf.get(m.userId) ?? "shared"] ?? "#3B2422"} className="mt-0.5" />
              <div className={`min-w-0 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-[var(--fg)] text-[var(--field)]" : "bg-[var(--card)]"}`}>
                <p className={`text-[11px] ${mine ? "opacity-70" : "text-[var(--muted)]"}`}>{mine ? "вы" : m.name} · {formatAgo(m.at, now)}</p>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {unseen > 0 && (
        <button type="button" onClick={() => toBottom()} data-testid="chat-new"
          className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--fg)] px-3 py-1.5 text-xs font-bold text-[var(--field)] shadow-md">
          <ArrowDown size={14} aria-hidden />Новые · {unseen}
        </button>
      )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Сообщение</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_LEN}
            placeholder="Напишите сообщение…"
            className="w-full rounded-full border border-[var(--line)] bg-transparent px-4 py-2 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <button type="submit" disabled={sending || !text.trim()} aria-label="Отправить" className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--field)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
