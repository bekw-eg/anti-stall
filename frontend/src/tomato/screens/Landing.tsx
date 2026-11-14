/**
 * 01 Welcome — лендинг (Figma, страница back). Тексты переведены и сверены с тем, что реально умеет сервер:
 * башни-аксолотли из каталога TD, помощь «бонус к опыту / щит», пакости «туман / стикер», карта из 4 узлов.
 */
import { motion, useReducedMotion } from "framer-motion";
import { DemoBadge } from "../Chrome";
import { TowerPreview } from "../tdSprites";
import { Avatar, Logo, RoadmapArt, Tag } from "./ui";

const wrap = "mx-auto w-full max-w-[1488px] px-4 sm:px-8 lg:px-12";
const h2 = "font-display text-[clamp(1.6rem,3.6vw,2.6rem)] leading-[1.05]";
const lead = "mt-3 max-w-2xl text-base text-mute sm:text-lg sm:leading-snug";

function Eyebrow({ children, light = false }: { children: string; light?: boolean }) {
  return <p className={`mb-2 text-sm font-bold sm:text-base ${light ? "text-blush" : "text-rose"}`}>{children}</p>;
}

function Bullet({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 text-[15px] sm:text-base">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dark ? "bg-peach" : "bg-olive"}`} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

export function Landing({ onStart, onJoin, ready, serverOk, demo }: { onStart: () => void; onJoin: () => void; ready: boolean; serverOk: boolean | null; demo: boolean }) {
  const reduce = useReducedMotion();
  // анимация появления при прокрутке — только если браузер умеет IntersectionObserver и не просили меньше движения
  const appear = reduce || typeof IntersectionObserver === "undefined" ? {} : { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.45 } };
  const offline = ready && serverOk === false;

  return (
    <div className="min-h-[100dvh] bg-white text-ink" data-testid="landing">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-30 border-b-2 border-soft bg-white/95 backdrop-blur">
        <nav className={`${wrap} flex h-16 items-center justify-between gap-3 sm:h-[88px]`} aria-label="Главное меню">
          <a href="#top" aria-label="AntiStall, наверх"><Logo /></a>
          <ul className="hidden items-center gap-8 text-[19px] font-bold lg:flex">
            <li><a className="hover:text-rose" href="#how">Как это работает</a></li>
            <li><a className="hover:text-rose" href="#game">Игра</a></li>
            <li><a className="hover:text-rose" href="#fair">Честная игра</a></li>
          </ul>
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" onClick={onJoin} className="as-btn as-btn-secondary as-btn-sm hidden sm:inline-flex">По коду</button>
            <button type="button" onClick={onStart} disabled={!ready} className="as-btn as-btn-primary as-btn-sm">Начать</button>
          </div>
        </nav>
      </header>

      <main id="top">
        {/* ---------- Hero ---------- */}
        <section className={`${wrap} pb-10 pt-6 sm:pb-14 sm:pt-10`}>
          {demo && <DemoBadge className="mb-5" />}
          <h1 className="font-display text-[clamp(2.5rem,7vw,5rem)] leading-[0.95] text-peach">Учимся вместе.</h1>
          <div className="mt-4 h-1 rounded-full bg-peach sm:mt-6" aria-hidden />
          <div className="mt-4 flex flex-col gap-4 sm:mt-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-2xl text-lg leading-snug sm:text-xl">
              Общий таймер: 25 минут учёбы с друзьями, потом 5 минут командной tower defense.
            </p>
            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <button type="button" onClick={onStart} disabled={!ready} className="as-btn as-btn-light w-full xs:w-auto sm:px-10">
                {ready ? "Начать" : "Загружаем…"}
              </button>
              <p className="text-sm text-mute">Бесплатно, можно гостем.</p>
              {offline && <p role="alert" className="text-sm font-bold text-[#B5402F]">Сервер не отвечает. Попробуйте обновить страницу.</p>}
            </div>
          </div>

          <div className="relative mx-auto mt-8 max-w-[880px] pt-10 sm:mt-10">
            <div className="absolute inset-x-0 top-0 flex flex-wrap justify-between gap-2 px-[4%]">
              <Tag className="-rotate-2">Лагерь пройден</Tag>
              <Tag dot="#3B2422" className="hidden rotate-1 xs:inline-flex">Команда здесь</Tag>
              <Tag dot="#FFCEC2" className="-rotate-1">Крепость экзамена</Tag>
            </div>
            <RoadmapArt className="w-full" />
          </div>
        </section>

        {/* ---------- Cycle ---------- */}
        <section id="how" className="scroll-mt-20 bg-paper py-10 sm:py-14">
          <div className={wrap}>
            <Eyebrow>Как это работает</Eyebrow>
            <h2 className={h2}>25 учимся, 5 играем.</h2>
            <p className={lead}>Пока идёт таймер, игра закрыта. На перерыве всё открывается.</p>

            <motion.div {...appear} className="mt-6 grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr] lg:gap-5">
              <article className="as-card as-shadow flex flex-col gap-3 border-ink bg-ink p-5 text-cream sm:p-6">
                <p className="text-base font-bold text-blush">Фокус · 25 минут</p>
                <p className="font-display text-[clamp(2.75rem,6vw,4rem)] leading-none">18:42</p>
                <div className="flex -space-x-2">{["Лотти", "Айгерим", "Тимур", "Сабина"].map((n) => <Avatar key={n} name={n} id={n} ring="#FFF4EF" />)}</div>
                <ul className="flex flex-col gap-2.5">
                  <Bullet dark>Игра закрыта, можно вести стикеры-заметки</Bullet>
                  <Bullet dark>Голос работает, микрофон можно выключить</Bullet>
                  <Bullet dark>Ушёл раньше — цикл не засчитан</Bullet>
                </ul>
              </article>
              <div className="flex items-center justify-center gap-3 text-center lg:flex-col">
                <span className="font-display text-xl text-rose sm:text-2xl">потом</span>
                <span className="text-sm text-mute">и так<br className="hidden md:block" /> по кругу</span>
              </div>
              <article className="as-card as-shadow flex flex-col gap-3 bg-lime p-5 sm:p-6">
                <p className="text-base font-bold text-olive">Перерыв · 5 минут</p>
                <p className="font-display text-[clamp(2.75rem,6vw,4rem)] leading-none">04:12</p>
                <ul className="flex flex-col gap-2.5">
                  <Bullet>Строите башни-аксолотли на казну команды</Bullet>
                  <Bullet>Помогаете своим, подшучиваете над соперником</Bullet>
                  <Bullet>Следующий фокус начнётся сам</Bullet>
                </ul>
              </article>
            </motion.div>
          </div>
        </section>

        {/* ---------- Game ---------- */}
        <section id="game" className="scroll-mt-20 py-10 sm:py-14">
          <div className={wrap}>
            <Eyebrow>Игра</Eyebrow>
            <h2 className={h2}>Учитесь, чтобы строить башни.</h2>
            <p className={lead}>Две команды, у каждой своя дорога к Крепости экзамена. Следующий этап открывает победа в игре.</p>
            <motion.ol {...appear} className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Учитесь", "Фокус приносит монеты в казну команды."],
                ["Стройте", "Ставьте башни-аксолотли на перерыве."],
                ["Держите волну", "Победа двигает команду по карте."],
                ["Мешайте", "Наёмники-томаты против соперника."],
              ].map(([title, text], i) => (
                <li key={title} className="as-card flex items-start gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-peach font-display text-lg" aria-hidden><span className="mt-1">{i + 1}</span></span>
                  <span className="min-w-0"><h3 className="font-display text-lg sm:text-xl">{title}</h3>
                  <p className="text-sm text-mute sm:text-[15px]">{text}</p></span>
                </li>
              ))}
            </motion.ol>
            <ul className="mt-4 grid gap-3 md:grid-cols-3" aria-label="Башни">
              {([["arrow", "Лучник", "Быстрые одиночные выстрелы", 15], ["cannon", "Пушка", "Медленный урон по площади", 30], ["frost", "Мороз", "Замедляет врагов вдвое", 20]] as const).map(([type, name, text, cost]) => (
                <li key={type} className="flex items-center gap-3 rounded-[18px] border-2 border-soft bg-white p-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-paper"><TowerPreview type={type} size={44} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold">{name}</span>
                    <span className="block text-sm text-mute">{text}</span>
                  </span>
                  <span className="font-display text-lg">{cost}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Social ---------- */}
        <section className="bg-paper py-10 sm:py-14">
          <div className={wrap}>
            <Eyebrow>Помощь и пакости</Eyebrow>
            <h2 className={h2}>Поддержи своих, подшути над чужими.</h2>
            <p className={lead}>Только на перерыве: фокусу не мешает, награды не трогает.</p>
            <motion.div {...appear} className="mt-6 grid gap-4 md:grid-cols-2">
              <article className="as-card bg-lime p-5">
                <h3 className="font-display text-2xl">Помочь другу</h3>
                <dl className="mt-3 flex flex-col gap-2">
                  <div className="rounded-[14px] border-2 border-ink bg-white px-3 py-2"><dt className="text-base font-extrabold">Бонус к опыту</dt><dd className="text-sm text-mute">+25% опыта за следующую сессию друга</dd></div>
                  <div className="rounded-[14px] border-2 border-ink bg-white px-3 py-2"><dt className="text-base font-extrabold">Щит</dt><dd className="text-sm text-mute">Отражает одну шутку, направленную в друга</dd></div>
                </dl>
              </article>
              <article className="as-card bg-blush p-5">
                <h3 className="font-display text-2xl">Подшутить</h3>
                <dl className="mt-3 flex flex-col gap-2">
                  <div className="rounded-[14px] border-2 border-ink bg-white px-3 py-2"><dt className="text-base font-extrabold">Туман</dt><dd className="text-sm text-mute">На несколько секунд затуманивает экран</dd></div>
                  <div className="rounded-[14px] border-2 border-ink bg-white px-3 py-2"><dt className="text-base font-extrabold">Стикер</dt><dd className="text-sm text-mute">Смешная наклейка поверх экрана</dd></div>
                </dl>
              </article>
            </motion.div>
            
          </div>
        </section>

        {/* ---------- Fair play ---------- */}
        <section id="fair" className="scroll-mt-20 bg-ink py-10 text-cream sm:py-14">
          <div className={wrap}>
            <Eyebrow light>Честная игра</Eyebrow>
            <h2 className={h2}>Цикл не подделать.</h2>
            <p className="mt-3 max-w-2xl text-base text-[#D8BDB6] sm:text-lg">Таймер и все правила живут на сервере, а не в браузере.</p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Время считает сервер", "Таймер идёт на сервере, экран только показывает его."],
                ["Полный цикл или ничего", "Награда приходит после полного фокуса. Закрыл вкладку, и цикл не засчитан."],
                ["Одна комната за раз", "Один аккаунт не может вести два фокуса одновременно."],
                ["Каждая трата проверяется", "Нельзя потратить больше, чем есть. Двойной клик не спишет дважды."],
              ].map(([title, text]) => (
                <li key={title} className="border-t-2 border-cocoa pt-3">
                  <h3 className="font-display text-lg text-blush sm:text-xl">{title}</h3>
                  <p className="mt-1 text-sm text-[#E9D6D1] sm:text-[15px]">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section className={`${wrap} py-10 sm:py-14`}>
          <div className="flex flex-col items-start gap-5 rounded-[28px] border-2 border-ink bg-rose p-5 text-white as-shadow sm:p-8 lg:flex-row lg:items-center lg:justify-between lg:rounded-full lg:px-12">
            <div>
              <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">Создайте комнату и позовите друзей.</h2>
              <p className="mt-1 text-base text-blush sm:text-lg">Друзья заходят по ссылке или коду.</p>
            </div>
            <div className="flex w-full flex-col gap-3 xs:w-auto xs:flex-row">
              <button type="button" onClick={onStart} disabled={!ready} className="as-btn as-btn-secondary">Создать комнату</button>
              <button type="button" onClick={onJoin} disabled={!ready} className="as-btn as-btn-light">Войти по коду</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-soft">
        <div className={`${wrap} flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between`}>
          <Logo compact />
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[17px] font-bold text-mute">
            <li><a href="#how" className="hover:text-ink">Как это работает</a></li>
            <li><a href="#game" className="hover:text-ink">Игра</a></li>
            <li><a href="#fair" className="hover:text-ink">Честная игра</a></li>
          </ul>
          <p className="text-base text-mute">AntiStall · сделано на хакатоне</p>
        </div>
      </footer>
    </div>
  );
}
