import { Achievement, GameState } from '@/types/game';

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_splash',
    name: 'Первый всплеск',
    description: 'Сделано 10 кликов',
    checkUnlock: (state) => state.totalClicks >= 10,
  },
  {
    id: 'coin_rain',
    name: 'Монетный дождь',
    description: 'Накоплено 100 монет',
    checkUnlock: (state) => state.coins >= 100,
  },
  {
    id: 'first_purchase',
    name: 'Первые покупки',
    description: 'Куплен 1 апгрейд',
    checkUnlock: (state) => Object.values(state.ownedUpgrades).some(count => count > 0),
  },
  {
    id: 'real_farmer',
    name: 'Настоящий фермер',
    description: 'Пассивный доход ≥ 10/сек',
    checkUnlock: (state) => state.passivePerSec >= 10,
  },
  {
    id: 'paw_power',
    name: 'Сила лапки',
    description: 'За клик ≥ 10',
    checkUnlock: (state) => state.perClick >= 10,
  },
  {
    id: 'ultra_clicker',
    name: 'Ультра-кликер',
    description: 'Сделано 1000 кликов',
    checkUnlock: (state) => state.totalClicks >= 1000,
  },
  {
    id: 'lagoon_lord',
    name: 'Владыка лагуны',
    description: 'Накоплено 100000 монет',
    checkUnlock: (state) => state.coins >= 100000,
  },
  {
    id: 'upgrade_master',
    name: 'Мастер апгрейдов',
    description: 'Куплено 10 апгрейдов',
    checkUnlock: (state) => Object.values(state.ownedUpgrades).reduce((sum, count) => sum + count, 0) >= 10,
  },
];

export function checkNewAchievements(prevState: GameState, currentState: GameState): string[] {
  const newUnlocked: string[] = [];
  
  for (const achievement of ACHIEVEMENTS) {
    const wasUnlocked = prevState.unlockedAchievements.includes(achievement.id);
    const isNowUnlocked = achievement.checkUnlock(currentState);
    
    if (!wasUnlocked && isNowUnlocked) {
      newUnlocked.push(achievement.id);
    }
  }
  
  return newUnlocked;
}
