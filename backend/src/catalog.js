/** Статический игровой каталог: улучшения, достижения, дорожная карта, уровни. */

// ---- Уровни: уровень n наступает при 50·n·(n−1) XP (L2=100, L3=300, L4=600 …)
export const xpForLevel = (n) => 50 * n * (n - 1);
export function levelForXp(xp) {
  let n = 1;
  while (xp >= xpForLevel(n + 1)) n++;
  return n;
}

// ---- Улучшения (тратят Tomato Coins). Эффекты применяются на сервере и отдаются в /game
export const UPGRADES = {
  base_walls: {
    id: 'base_walls', title: 'Крепкие стены', description: '+25 к здоровью базы команды за уровень',
    maxLevel: 5, minLevel: 1, baseCost: 30, effect: { kind: 'baseHp', perLevel: 25 },
  },
  tower_power: {
    id: 'tower_power', title: 'Усиленные башни', description: '+10% к урону башен за уровень',
    maxLevel: 5, minLevel: 2, baseCost: 50, effect: { kind: 'towerDamagePct', perLevel: 10 },
  },
  team_aura: {
    id: 'team_aura', title: 'Командная аура', description: 'Ваш «Бонус» даёт друзьям на 5% больше XP за уровень',
    maxLevel: 3, minLevel: 3, baseCost: 60, effect: { kind: 'boostBonusPct', perLevel: 5 },
  },
};
export const upgradeCost = (def, currentLevel) => def.baseCost * (currentLevel + 1);

// ---- Достижения. condition(stats) — чистая функция от серверной статистики игрока
export const ACHIEVEMENTS = {
  first_focus: { id: 'first_focus', title: 'Первый фокус', description: 'Завершите первую фокус-сессию', reward: { coins: 10 }, condition: (s) => s.completedSessions >= 1 },
  five_sessions: { id: 'five_sessions', title: 'Пятёрочка', description: 'Завершите 5 фокус-сессий', reward: { coins: 25 }, condition: (s) => s.completedSessions >= 5 },
  streak_3: { id: 'streak_3', title: 'Регулярность', description: 'Занимайтесь 3 дня подряд', reward: { coins: 30 }, condition: (s) => s.bestStreakDays >= 3 },
  team_player: { id: 'team_player', title: 'Командный игрок', description: 'Внесите вклад в командное испытание', reward: { coins: 15 }, condition: (s) => s.teamContributions >= 1 },
  team_victory: { id: 'team_victory', title: 'Коллективная победа', description: 'Достигните цели командного испытания', reward: { coins: 40 }, condition: (s) => s.challengesWon >= 1 },
  helper: { id: 'helper', title: 'Друг познаётся', description: 'Помогите товарищу', reward: { coins: 10 }, condition: (s) => s.helpsSent >= 1 },
  prankster: { id: 'prankster', title: 'Шутник', description: 'Отправьте дружескую пакость', reward: { coins: 5 }, condition: (s) => s.pranksSent >= 1 },
  first_upgrade: { id: 'first_upgrade', title: 'Прокачка', description: 'Купите первое улучшение', reward: { coins: 15 }, condition: (s) => s.upgradesBought >= 1 },
  td_builder: { id: 'td_builder', title: 'Строитель', description: 'Постройте 5 башен в мини-игре', reward: { coins: 15 }, condition: (s) => s.towersBuilt >= 5 },
  td_first_win: { id: 'td_first_win', title: 'Оборона держится', description: 'Выиграйте первый раунд Tower Defense', reward: { coins: 20 }, condition: (s) => s.tdWins >= 1 },
  level_5: { id: 'level_5', title: 'Опытный ботан', description: 'Достигните 5 уровня', reward: { coins: 50 }, condition: (s) => s.level >= 5 },
};

// ---- Road Map: общая карта командного испытания (узлы + связи).
// Узлы двигают только победы в Tower Defense: победа в этапе узла i (TD.stages[i].node === nodes[i].id)
// открывает узел i+1, победа в этапе последнего узла (крепость) — цель испытания.
// requiredPoints — сколько побед в TD (переходов по карте) нужно, чтобы дойти до узла.
export const ROADMAP = {
  id: 'forest-march',
  title: 'Марш к крепости экзамена',
  nodes: [
    { id: 'camp', title: 'Лагерь', x: 0.08, y: 0.72, requiredPoints: 0, type: 'start' },
    { id: 'forest', title: 'Лес знаний', x: 0.3, y: 0.38, requiredPoints: 1, type: 'focus_goal' },
    { id: 'bridge', title: 'Мост дедлайнов', x: 0.54, y: 0.66, requiredPoints: 2, type: 'focus_goal' },
    { id: 'fortress', title: 'Крепость экзамена', x: 0.82, y: 0.3, requiredPoints: 3, type: 'boss' },
  ],
  edges: [['camp', 'forest'], ['forest', 'bridge'], ['bridge', 'fortress']],
};

export const HELP_TYPES = ['boost', 'shield'];
export const PRANK_TYPES = ['fog', 'sticker'];

export const BASE_HP = 100;

// ---------------------------------------------------------------------------------------------
// Tower Defense на перерывах. Карта, башни, враги и этапы — данные; симуляцию ведёт сервер (src/td/engine.js).
// Координаты — в клетках поля 12×7 (центры клеток: x+0.5, y+0.5). Клиент получает карту с сервера и только рисует.
export const TD = {
  step: 0.25, // шаг симуляции, игровых секунд
  baseDamageScale: 1,
  map: {
    cols: 12,
    rows: 7,
    path: [[0.5, 1.5], [4.5, 1.5], [4.5, 4.5], [8.5, 4.5], [8.5, 2.5], [11.5, 2.5]],
    slots: [
      { id: 's1', x: 2.5, y: 2.5 }, { id: 's2', x: 2.5, y: 0.5 }, { id: 's3', x: 5.5, y: 2.5 }, { id: 's4', x: 3.5, y: 3.5 },
      { id: 's5', x: 6.5, y: 3.5 }, { id: 's6', x: 6.5, y: 5.5 }, { id: 's7', x: 9.5, y: 3.5 }, { id: 's8', x: 7.5, y: 3.5 },
      { id: 's9', x: 10.5, y: 1.5 }, { id: 's10', x: 10.5, y: 3.5 },
    ],
  },
  maxLevel: 3,
  towers: {
    arrow: { id: 'arrow', title: 'Лучник', description: 'Быстрые одиночные выстрелы', cost: 15, range: 2.6, damage: 12, cooldown: 0.6 },
    cannon: { id: 'cannon', title: 'Пушка', description: 'Медленный урон по площади', cost: 30, range: 2.2, damage: 30, cooldown: 1.6, splash: 1.0 },
    frost: { id: 'frost', title: 'Мороз', description: 'Замедляет врага вдвое', cost: 20, range: 2.4, damage: 3, cooldown: 0.9, slow: { factor: 0.5, duration: 1.5 } },
  },
  /** Улучшение уровня: урон ×(1 + 0.5·(lvl−1)), радиус +0.25·(lvl−1) */
  levelDamage: (lvl) => 1 + 0.5 * (lvl - 1),
  levelRange: (lvl) => 0.25 * (lvl - 1),
  upgradeCost: (def, toLevel) => Math.round(def.cost * (toLevel === 2 ? 0.8 : 1.2)),
  enemies: {
    runner: { id: 'runner', title: 'Бегун', hp: 36, speed: 1.4, damage: 4 },
    grunt: { id: 'grunt', title: 'Солдат', hp: 90, speed: 1.0, damage: 8 },
    tank: { id: 'tank', title: 'Тяжёлый', hp: 260, speed: 0.6, damage: 15 },
    boss: { id: 'boss', title: 'Босс', hp: 1400, speed: 0.5, damage: 40 },
  },
  /**
   * Tower Wars: наёмники, которых команда покупает из казны и выпускает на поле соперника
   * (в shared — «Подкрепление волны» в свой раунд за награду). hp не масштабируется этапом,
   * armor — доля поглощаемого урона башен: урон × (1 − armor).
   */
  mercenaries: {
    cherry: { id: 'cherry', title: 'Черри-бегун', description: 'Крошечный и шустрый: проскакивает мимо медленных башен', cost: 2, hp: 30, speed: 1.6, damage: 3, armor: 0 },
    ripe: { id: 'ripe', title: 'Спелый томат', description: 'Сбалансированный боец: давит числом', cost: 5, hp: 95, speed: 1.05, damage: 7, armor: 0 },
    armored: { id: 'armored', title: 'Броне-томат в каске', description: 'Каска гасит четверть урона башен', cost: 12, hp: 280, speed: 0.65, damage: 15, armor: 0.25 },
    king: { id: 'king', title: 'Томат-Дредноут', description: 'Ходячая крепость в латах: медленный, но почти неуязвимый', cost: 25, hp: 900, speed: 0.5, damage: 30, armor: 0.35 },
  },
  /**
   * Заклинания из казны. target: 'self' — на свой раунд, 'rival' — на раунд соперника.
   * duration — в игровых секундах; повтор того же заклинания продлевает срок, а не складывается.
   */
  spells: {
    haste: { id: 'haste', title: 'Гипер-жабры Аксолотлей', description: 'Башни стреляют в 1.35 раза чаще', target: 'self', cost: 10, duration: 6, factor: 1.35 },
    repair: { id: 'repair', title: 'Регенерация базы', description: '+20 к здоровью базы и щит: −30% урона по базе', target: 'self', cost: 12, duration: 5, heal: 20, factor: 0.3 },
    slow_towers: { id: 'slow_towers', title: 'Сонная пыльца', description: 'Башни соперника перезаряжаются в 1.65 раза дольше', target: 'rival', cost: 10, duration: 6, factor: 1.65 },
    disable_tower: { id: 'disable_tower', title: 'Кетчуп-заморозка', description: 'Самая прокачанная башня соперника не стреляет', target: 'rival', cost: 14, duration: 5 },
    enrage_horde: { id: 'enrage_horde', title: 'Ярость Томатов', description: 'Враги на поле соперника бегут в 1.4 раза быстрее', target: 'rival', cost: 12, duration: 5, factor: 1.4 },
  },
  mercCooldownSec: 0.8, // пауза между отправками наёмников одной командой (реальные секунды)
  mercBountyShared: 1.5, // в shared убийство «подкрепления» приносит в казну cost × 1.5
  /** Этапы привязаны к узлам Road Map: узел пройден командой → этап открыт. at — игровая секунда начала волны. */
  stages: [
    {
      id: 'camp', node: 'camp', title: 'Тренировочный рубеж', hpScale: 1, reward: { xp: 8, coins: 6 },
      waves: [{ at: 2, groups: [{ type: 'runner', count: 4, gap: 2.2 }] }, { at: 16, groups: [{ type: 'grunt', count: 3, gap: 3 }] }],
    },
    {
      id: 'forest', node: 'forest', title: 'Первая засада', hpScale: 1.5, reward: { xp: 20, coins: 12 },
      waves: [
        { at: 2, groups: [{ type: 'runner', count: 6, gap: 1.8 }] },
        { at: 18, groups: [{ type: 'grunt', count: 5, gap: 2.4 }] },
        { at: 36, groups: [{ type: 'grunt', count: 4, gap: 2 }, { type: 'runner', count: 4, gap: 1.5, delay: 1 }] },
      ],
    },
    {
      id: 'bridge', node: 'bridge', title: 'Оборона перевала', hpScale: 2.4, reward: { xp: 30, coins: 18 },
      waves: [
        { at: 2, groups: [{ type: 'grunt', count: 6, gap: 2 }] },
        { at: 20, groups: [{ type: 'tank', count: 2, gap: 5 }, { type: 'runner', count: 6, gap: 1.4, delay: 2 }] },
        { at: 42, groups: [{ type: 'tank', count: 3, gap: 4 }] },
      ],
    },
    {
      id: 'fortress', node: 'fortress', title: 'Штурм Крепости экзамена', hpScale: 3.6, reward: { xp: 50, coins: 30 },
      waves: [
        { at: 2, groups: [{ type: 'grunt', count: 7, gap: 1.8 }] },
        { at: 20, groups: [{ type: 'tank', count: 3, gap: 4 }, { type: 'runner', count: 8, gap: 1.2, delay: 2 }] },
        { at: 44, groups: [{ type: 'tank', count: 4, gap: 3.5 }] },
        { at: 66, groups: [{ type: 'boss', count: 1, gap: 1 }, { type: 'runner', count: 6, gap: 1.5, delay: 3 }] },
      ],
    },
  ],
};
