/**
 * 01 Welcome — лендинг (Figma, страница back). Тексты переведены и сверены с тем, что реально умеет сервер:
 * башни-аксолотли из каталога TD, помощь «бонус к опыту / щит», пакости «туман / стикер», карта из 4 узлов.
 */
import { motion, useReducedMotion } from "framer-motion";
import { DemoBadge } from "../Chrome";
import { TowerPreview } from "../tdSprites";
import { Avatar, Logo, RoadmapArt, Tag } from "./ui";

const wrap = "mx-auto w-full max-w-[1488px] px-4 sm:px-8 lg:px-12";
const h2 = "font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05]";
const lead = "mt-4 max-w-2xl text-lg text-mute sm:text-2xl sm:leading-snug";

function Eyebrow({ children, light = false }: { children: string; light?: boolean }) {
  return <p className={`mb-3 text-base font-bold sm:text-lg ${light ? "text-blush" : "text-rose"}`}>{children}</p>;
}

function Bullet({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <li className="flex items-start gap-3 text-base sm:text-[19px]">
      <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${dark ? "bg-peach" : "bg-olive"}`} aria-hidden />
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
        <section className={`${wrap} pb-14 pt-8 sm:pb-20 sm:pt-12`}>
          {demo && <DemoBadge className="mb-5" />}
          <h1 className="font-display text-[clamp(3.25rem,11vw,8rem)] leading-[0.95] text-peach">Учимся вместе.</h1>
          <div className="mt-6 h-1.5 rounded-full bg-peach sm:mt-8" aria-hidden />
          <div className="mt-6 flex flex-col gap-6 sm:mt-8 lg:flex-row lg:items-start lg:justify-between">
            <p className="max-w-3xl text-xl leading-snug sm:text-[28px]">
              Один таймер на всю комнату: 25 минут учёбы с друзьями в голосе, потом 5 минут командной tower defense.
              Пока идёт фокус, игра закрыта.
            </p>
            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <button type="button" onClick={onStart} disabled={!ready} className="as-btn as-btn-light w-full xs:w-auto sm:px-10">
                {ready ? "Начать" : "Загружаем…"}
              </button>
              <p className="text-[15px] text-mute sm:text-[17px]">Бесплатно. Можно войти гостем.</p>
              {offline && <p role="alert" className="text-sm font-bold text-[#B5402F]">Сервер не отвечает. Попробуйте обновить страницу.</p>}
            </div>
          </div>

          <div className="relative mx-auto mt-10 max-w-[1190px] pt-10 sm:mt-14">
            <div className="absolute inset-x-0 top-0 flex flex-wrap justify-between gap-2 px-[4%]">
              <Tag className="-rotate-2">Лагерь пройден</Tag>
              <Tag dot="#3B2422" className="hidden rotate-1 xs:inline-flex">Команда здесь</Tag>
              <Tag dot="#FFCEC2" className="-rotate-1">Крепость экзамена</Tag>
            </div>
            <RoadmapArt className="w-full" />
          </div>
        </section>

        {/* ---------- Problem ---------- */}
        <section className="bg-paper py-14 sm:py-24">
          <motion.div {...appear} className={`${wrap} grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-16`}>
            <h2 className={h2}>Сел учиться. Сорок минут спустя смотришь <span className="text-rose">шестое видео.</span></h2>
            <p className="text-lg text-mute sm:text-2xl sm:leading-snug">
              Одному легко откладывать. Рядом с друзьями сложнее: когда все уже начали, начинаешь и ты.
              Для этого и сделана комната: общий таймер, голоса на фоне и повод вернуться завтра.
            </p>
          </motion.div>
        </section>

        {/* ---------- Cycle ---------- */}
        <section id="how" className="scroll-mt-20 py-14 sm:py-24">
          <div className={wrap}>
            <Eyebrow>Как это работает</Eyebrow>
            <h2 className={h2}>25 учимся, 5 играем.</h2>
            <p className={lead}>Пока идёт таймер, игра закрыта, а чат только для чтения. На перерыве всё открывается.</p>

            <motion.div {...appear} className="mt-10 grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
              <article className="as-card as-shadow flex flex-col gap-5 border-ink bg-ink p-6 text-cream sm:p-8">
                <p className="text-lg font-bold text-blush">25:00 · Фокус</p>
                <p className="font-display text-[clamp(4.5rem,14vw,9.5rem)] leading-none">18:42</p>
                <div className="flex -space-x-2">{["Лотти", "Айгерим", "Тимур", "Сабина"].map((n) => <Avatar key={n} name={n} id={n} ring="#FFF4EF" />)}</div>
                <ul className="flex flex-col gap-2.5">
                  <Bullet dark>Карта размыта и закрыта</Bullet>
                  <Bullet dark>Чат только для чтения</Bullet>
                  <Bullet dark>Голос работает, микрофон можно выключить</Bullet>
                  <Bullet dark>Ушёл раньше времени, и цикл не засчитан</Bullet>
                </ul>
              </article>
              <div className="flex items-center justify-center gap-3 text-center lg:flex-col">
                <span className="font-display text-2xl text-rose sm:text-[28px]">потом</span>
                <span className="text-[15px] text-mute sm:text-[17px]">и так<br className="hidden lg:block" /> несколько циклов</span>
              </div>
              <article className="as-card as-shadow flex flex-col gap-5 bg-lime p-6 sm:p-8">
                <p className="text-lg font-bold text-olive">05:00 · Перерыв</p>
                <p className="font-display text-[clamp(4.5rem,14vw,9.5rem)] leading-none">04:12</p>
                <ul className="flex flex-col gap-2.5">
                  <Bullet>Открываются карта и поле башен</Bullet>
                  <Bullet>Казна команды строит оборону</Bullet>
                  <Bullet>Можно помочь другу и подшутить над соперником</Bullet>
                  <Bullet>Следующий фокус начнётся сам, когда кончится перерыв</Bullet>
                </ul>
              </article>
            </motion.div>
          </div>
        </section>

        {/* ---------- Game ---------- */}
        <section id="game" className="scroll-mt-20 bg-paper py-14 sm:py-24">
          <div className={wrap}>
            <Eyebrow>Игра</Eyebrow>
            <h2 className={h2}>Учитесь, чтобы строить башни.</h2>
            <p className={lead}>Две команды в одной комнате, у каждой своя дорога к Крепости экзамена. Следующий узел открывает победа в tower defense на перерыве.</p>
            <motion.ol {...appear} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Учитесь", "Полный цикл фокуса приносит монеты и опыт, часть уходит в казну команды."],
                ["Стройте", "На перерыве ставьте башни-аксолотли на деньги казны."],
                ["Держите волну", "Бой считает сервер. Победа двигает команду к следующему узлу."],
                ["Мешайте соперникам", "Наёмники-томаты и заклинания против второй команды."],
              ].map(([title, text], i) => (
                <li key={title} className="as-card flex flex-col gap-2 p-5 sm:p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-peach font-display text-2xl" aria-hidden><span className="mt-1">{i + 1}</span></span>
                  <h3 className="font-display text-2xl sm:text-[28px]">{title}</h3>
                  <p className="text-base text-mute sm:text-[17px]">{text}</p>
                </li>
              ))}
            </motion.ol>
            <ul className="mt-6 grid gap-4 md:grid-cols-3" aria-label="Башни">
              {([["arrow", "Лучник", "Быстрые одиночные выстрелы", 15], ["cannon", "Пушка", "Медленный урон по площади", 30], ["frost", "Мороз", "Замедляет врагов вдвое", 20]] as const).map(([type, name, text, cost]) => (
                <li key={type} className="flex items-center gap-4 rounded-[20px] border-2 border-ink bg-white p-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-paper"><TowerPreview type={type} size={44} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl font-extrabold">{name}</span>
                    <span className="block text-[15px] text-mute">{text}</span>
                  </span>
                  <span className="font-display text-2xl">{cost}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Social ---------- */}
        <section className="py-14 sm:py-24">
          <div className={wrap}>
            <Eyebrow>Помощь и пакости</Eyebrow>
            <h2 className={h2}>Поддержи своих, подшути над чужими.</h2>
            <p className={lead}>На перерыве можно помочь другу или беззлобно над ним подшутить. Пакости не мешают фокусу и не трогают награды.</p>
            <motion.div {...appear} className="mt-10 grid gap-5 md:grid-cols-2">
              <article className="as-card as-shadow bg-lime p-6 sm:p-8">
                <h3 className="font-display text-3xl sm:text-[40px]">Помочь другу</h3>
                <dl className="mt-5 flex flex-col gap-3">
                  <div className="rounded-[18px] border-2 border-ink bg-white p-4"><dt className="text-xl font-extrabold">Бонус к опыту</dt><dd className="text-mute">+25% опыта за следующую сессию друга</dd></div>
                  <div className="rounded-[18px] border-2 border-ink bg-white p-4"><dt className="text-xl font-extrabold">Щит</dt><dd className="text-mute">Отражает одну шутку, направленную в друга</dd></div>
                </dl>
              </article>
              <article className="as-card as-shadow bg-blush p-6 sm:p-8">
                <h3 className="font-display text-3xl sm:text-[40px]">Подшутить</h3>
                <dl className="mt-5 flex flex-col gap-3">
                  <div className="rounded-[18px] border-2 border-ink bg-white p-4"><dt className="text-xl font-extrabold">Туман</dt><dd className="text-mute">На несколько секунд затуманивает экран</dd></div>
                  <div className="rounded-[18px] border-2 border-ink bg-white p-4"><dt className="text-xl font-extrabold">Стикер</dt><dd className="text-mute">Смешная наклейка поверх экрана</dd></div>
                </dl>
              </article>
            </motion.div>
            <p className="mt-6 text-lg font-semibold text-mute">Пакости приходят только на перерыве. Если не хочется, их можно выключить в профиле.</p>
          </div>
        </section>

        {/* ---------- Fair play ---------- */}
        <section id="fair" className="scroll-mt-20 bg-ink py-14 text-cream sm:py-24">
          <div className={wrap}>
            <Eyebrow light>Честная игра</Eyebrow>
            <h2 className={h2}>Цикл не подделать.</h2>
            <p className="mt-4 max-w-2xl text-lg text-[#D8BDB6] sm:text-2xl sm:leading-snug">Награды что-то значат, только если их нельзя накрутить. Поэтому правила живут на сервере, а не в браузере.</p>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Время считает сервер", "Таймер идёт на сервере, экран только показывает его."],
                ["Полный цикл или ничего", "Награда приходит после полного фокуса. Закрыл вкладку, и цикл не засчитан."],
                ["Одна комната за раз", "Один аккаунт не может вести два фокуса одновременно."],
                ["Каждая трата проверяется", "Нельзя потратить больше, чем есть. Двойной клик не спишет дважды."],
              ].map(([title, text]) => (
                <li key={title} className="border-t-2 border-cocoa pt-5">
                  <h3 className="font-display text-2xl text-blush sm:text-[28px]">{title}</h3>
                  <p className="mt-2 text-base text-[#E9D6D1] sm:text-[19px]">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Progress ---------- */}
        <section className="py-14 sm:py-24">
          <div className={`${wrap} grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center`}>
            <div>
              <Eyebrow>Прогресс</Eyebrow>
              <h2 className={h2}>Возвращайтесь завтра.</h2>
              <p className={lead}>Уровень, монеты и достижения сохраняются между сессиями. На монеты покупаются улучшения для команды.</p>
            </div>
            <motion.div {...appear} className="as-card as-shadow flex flex-col gap-6 p-6 sm:p-8">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="font-display text-4xl">Уровень 4</p><p className="text-lg text-mute">340 / 500 XP</p></div>
                <div className="mt-3 h-4 overflow-hidden rounded-full border-2 border-ink bg-paper"><div className="h-full w-[68%] bg-rose" /></div>
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Достижения">
                {[["Первый фокус", "первая сессия"], ["Пятёрочка", "5 сессий"], ["Регулярность", "3 дня подряд"], ["Командный игрок", "вклад в цель"], ["Оборона держится", "первая победа"], ["Опытный ботан", "5 уровень"]].map(([title, text], i) => (
                  <li key={title} className={`rounded-[18px] border-2 p-3 ${i < 3 ? "border-ink bg-paper" : "border-dashed border-line"}`}>
                    <p className="font-extrabold leading-tight">{title}</p>
                    <p className="text-sm text-mute">{text}</p>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section className={`${wrap} pb-14 sm:pb-24`}>
          <div className="flex flex-col items-start gap-6 rounded-[32px] border-2 border-ink bg-rose p-6 text-white as-shadow sm:p-10 lg:flex-row lg:items-center lg:justify-between lg:rounded-full lg:px-16">
            <div>
              <h2 className="font-display text-[clamp(1.9rem,4.5vw,3.25rem)] leading-tight">Создайте комнату и позовите друзей.</h2>
              <p className="mt-2 text-lg text-blush sm:text-[22px]">Друзья заходят по ссылке или коду. Первый цикл начинается, когда все готовы.</p>
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
