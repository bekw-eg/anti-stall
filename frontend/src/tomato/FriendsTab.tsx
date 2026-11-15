/**
 * «Мои друзья»: свой код друга, добавление по коду, входящие заявки, друзья с их статусом
 * (в сети / в фокусе / в какой комнате) и кнопки «Позвать» в свою комнату и «Зайти» к другу.
 * Всё решает сервер (заявки, лимиты, кто кому друг); здесь — только показ и намерения.
 */
import { useEffect, useState } from "react";
import { Check, Copy, LogIn, Send, UserPlus, X } from "lucide-react";
import type { Friend } from "@/api/tomato";
import { roomLink } from "./format";
import type { Tomato } from "./useTomato";
import { Avatar, MemberAvatar } from "./screens/ui";

const H3 = "font-display text-lg uppercase leading-none";
const btn = "inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1.5 text-[13px] font-extrabold shadow-[0_3px_0_#3B2422] transition active:translate-y-[2px] active:shadow-[0_1px_0_#3B2422] disabled:opacity-50 disabled:shadow-none";

function statusOf(f: Friend) {
  if (f.connection === "offline") return "не в сети";
  if (f.focusing && f.room) return `в фокусе · «${f.room.name}»`;
  if (f.room) return f.room.phase === "break" ? `на перерыве · «${f.room.name}»` : `в комнате «${f.room.name}»`;
  return "в сети";
}

/** Друзья — только у зарегистрированных: гость одноразовый, его связи не сохраняются. */
export function FriendsTab({ t }: { t: Tomato }) {
  if (!t.user?.login) {
    return (
      <div className="flex flex-col gap-2 rounded-[18px] border-2 border-dashed border-line p-4 text-sm" data-testid="friends-guest">
        <p className="font-extrabold">Друзья — для аккаунтов</p>
        <p className="text-mute">Вы зашли гостем: гость одноразовый и исчезнет, когда закроете браузер. Задайте логин и пароль в профиле — и добавляйте друзей, они сохранятся.</p>
      </div>
    );
  }
  return <FriendsList t={t} />;
}

function FriendsList({ t }: { t: Tomato }) {
  const f = t.friends;
  const myRoom = t.snapshot?.room ?? null;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  // статусы друзей меняются — перечитываем, пока вкладка открыта
  const { loadFriends } = t;
  useEffect(() => {
    loadFriends();
    const id = setInterval(loadFriends, 20_000);
    return () => clearInterval(id);
  }, [loadFriends]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (!v || busy) return;
    setBusy(true);
    if (await t.friendAdd({ code: v })) setCode("");
    setBusy(false);
  };
  const copy = () => {
    if (!f) return;
    navigator.clipboard?.writeText(f.code).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!f) return <p className="font-bold text-mute">Загружаем друзей…</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="friends-tab">
      {/* свой код и добавление по коду */}
      <section className="flex flex-col gap-3 rounded-[24px] border-2 border-ink bg-white p-4 as-shadow-sm" aria-label="Ваш код друга">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-mute">Ваш код друга</p>
            <p className="font-display text-[32px] leading-none tracking-[0.12em]" data-testid="my-friend-code"><span className="relative top-1">{f.code}</span></p>
          </div>
          <button type="button" onClick={copy} className={`${btn} bg-white hover:bg-blush`} aria-live="polite">
            {copied ? <><Check size={14} aria-hidden />Скопировано</> : <><Copy size={14} aria-hidden />Скопировать</>}
          </button>
        </div>
        <p className="-mt-1 text-[13px] font-bold text-mute">Продиктуйте или отправьте код — по нему вас добавят в друзья. А тех, с кем вы учились, можно добавить прямо из комнаты.</p>
        <form onSubmit={add} className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} autoCapitalize="characters" spellCheck={false} placeholder="Код друга" aria-label="Код друга"
            className="h-12 min-w-0 flex-1 rounded-[16px] border-2 border-line bg-white px-4 font-display text-lg tracking-[0.1em] text-ink outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-[#A08A86] focus:border-ink" />
          <button type="submit" disabled={!code.trim() || busy} className="as-btn as-btn-primary as-btn-sm shrink-0" data-testid="add-friend"><UserPlus size={18} aria-hidden />Добавить</button>
        </form>
      </section>

      {/* входящие заявки */}
      {f.incoming.length > 0 && (
        <section className="flex flex-col gap-2 rounded-[24px] border-2 border-ink bg-white p-4 as-shadow-sm" aria-label="Заявки в друзья">
          <h3 className={H3}><span className="relative top-0.5">Заявки · {f.incoming.length}</span></h3>
          <ul className="flex flex-col">
            {f.incoming.map((r, i) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 py-2 ${i ? "border-t-2 border-soft" : ""}`} data-request={r.id}>
                <Avatar name={r.name} id={r.id} look={r.avatar} size={40} />
                <span className="min-w-[8rem] flex-1"><span className="block truncate font-extrabold">{r.name}</span>{r.level && <span className="text-sm font-bold text-mute">ур. {r.level}</span>}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => t.friendAccept(r.id)} className={`${btn} bg-lime hover:bg-[#CDD38E]`}><Check size={14} aria-hidden />Принять</button>
                  <button type="button" onClick={() => t.friendRemove(r.id)} className={`${btn} bg-white hover:bg-blush`} aria-label={`Отклонить: ${r.name}`}><X size={14} aria-hidden />Отклонить</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* друзья */}
      <section className="flex flex-col gap-2 rounded-[24px] border-2 border-ink bg-white p-4 as-shadow-sm" aria-label="Друзья">
        <h3 className={H3}><span className="relative top-0.5">Друзья · {f.friends.length}</span></h3>
        {f.friends.length === 0 ? (
          <p className="rounded-[16px] border-2 border-dashed border-line px-3 py-3 text-sm font-bold text-mute">Пока никого. Нажмите «В друзья» у человека во вкладке «В комнате» или добавьте по коду.</p>
        ) : (
          <ul className="flex flex-col">
            {f.friends.map((fr, i) => {
              const here = !!myRoom && fr.room?.id === myRoom.id;
              const canJoin = !!fr.room && !here;
              const canInvite = !!myRoom && !here && fr.connection !== "offline";
              return (
                <li key={fr.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${i ? "border-t-2 border-soft" : ""}`} data-friend-row={fr.id}>
                  <MemberAvatar name={fr.name} id={fr.id} look={fr.avatar} connection={fr.connection} size={44} />
                  <span className="min-w-[9.5rem] flex-1">
                    <span className="block truncate font-extrabold">{fr.name} <span className="font-bold text-mute">· ур. {fr.level}</span></span>
                    <span className={`block truncate text-sm font-bold ${fr.connection === "offline" ? "text-mute" : "text-olive"}`}>{here ? "здесь, в вашей комнате" : statusOf(fr)}</span>
                  </span>
                  <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {canInvite && <button type="button" onClick={() => t.friendInvite(fr.id, fr.name)} className={`${btn} bg-peach hover:bg-[#E29A88]`}><Send size={14} aria-hidden />Позвать</button>}
                    {canJoin && <button type="button" onClick={() => window.location.assign(roomLink(fr.room!.code))} className={`${btn} bg-white hover:bg-blush`}><LogIn size={14} aria-hidden />Зайти</button>}
                    {confirm === fr.id ? (
                      <button type="button" onClick={() => { setConfirm(null); t.friendRemove(fr.id); }} onBlur={() => setConfirm(null)} className={`${btn} bg-rose text-white`} autoFocus>Удалить?</button>
                    ) : (
                      <button type="button" onClick={() => setConfirm(fr.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-mute hover:bg-paper hover:text-ink" aria-label={`Удалить из друзей: ${fr.name}`} title="Удалить из друзей"><X size={16} /></button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* отправленные заявки */}
      {f.outgoing.length > 0 && (
        <section className="flex flex-col gap-1 rounded-[24px] border-2 border-dashed border-line bg-white/70 p-4" aria-label="Отправленные заявки">
          <h3 className={`${H3} text-mute`}><span className="relative top-0.5">Ждут ответа · {f.outgoing.length}</span></h3>
          <ul className="flex flex-col">
            {f.outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-1.5">
                <Avatar name={r.name} id={r.id} look={r.avatar} size={32} />
                <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
                <button type="button" onClick={() => t.friendRemove(r.id)} className="text-sm font-extrabold text-mute underline-offset-2 hover:text-ink hover:underline">Отменить</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Приглашения друзей в комнату: карточки под шапкой, «Зайти» открывает комнату по коду. */
export function RoomInvites({ t }: { t: Tomato }) {
  if (!t.roomInvites?.length) return null;
  return (
    <div className="fixed right-3 top-[7.5rem] z-40 flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 sm:right-6 lg:top-[5.75rem]" aria-live="polite">
      {t.roomInvites.map((inv) => (
        <div key={inv.id} role="status" data-testid="room-invite" className="flex items-center gap-3 rounded-[20px] border-2 border-ink bg-white px-3 py-2.5 shadow-[0_5px_0_#3B2422]">
          <Avatar name={inv.fromName} id={inv.from} look={t.friends?.friends.find((f) => f.id === inv.from)?.avatar} size={40} />
          <span className="min-w-0 flex-1 text-sm font-bold leading-snug"><b className="font-extrabold">{inv.fromName}</b> зовёт в «{inv.roomName}»</span>
          <button type="button" onClick={() => window.location.assign(roomLink(inv.roomCode))} className={`${btn} bg-peach hover:bg-[#E29A88]`}><LogIn size={14} aria-hidden />Зайти</button>
          <button type="button" onClick={() => t.dismissInvite(inv.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mute hover:bg-paper hover:text-ink" aria-label="Закрыть приглашение"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
