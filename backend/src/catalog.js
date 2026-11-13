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
  level_5: { id: 'level_5', title: 'Опытный ботан', description: 'Достигните 5 уровня', reward: { coins: 50 }, condition: (s) => s.level >= 5 },
};

// ---- Road Map: общая карта командного испытания (узлы + связи).
// requiredPoints — сколько командных очков нужно для достижения узла.
export const ROADMAP = {
  id: 'forest-march',
  title: 'Марш к крепости экзамена',
  nodes: [
    { id: 'camp', title: 'Лагерь', x: 0.08, y: 0.72, requiredPoints: 0, type: 'start' },
    { id: 'forest', title: 'Лес знаний', x: 0.3, y: 0.38, requiredPoints: 2, type: 'focus_goal' },
    { id: 'bridge', title: 'Мост дедлайнов', x: 0.54, y: 0.66, requiredPoints: 4, type: 'focus_goal' },
    { id: 'fortress', title: 'Крепость экзамена', x: 0.82, y: 0.3, requiredPoints: 6, type: 'boss' },
  ],
  edges: [['camp', 'forest'], ['forest', 'bridge'], ['bridge', 'fortress']],
};

export const HELP_TYPES = ['boost', 'shield'];
export const PRANK_TYPES = ['fog', 'sticker'];

export const BASE_HP = 100;
