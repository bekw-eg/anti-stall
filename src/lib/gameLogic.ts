import { GameState } from '@/types/game';
import { UPGRADES, calculateUpgradePrice } from './upgrades';

export const INITIAL_STATE: GameState = {
  coins: 0,
  perClick: 1,
  passivePerSec: 0,
  totalClicks: 0,
  ownedUpgrades: {},
  unlockedAchievements: [],
  celebrationShown: false,
};

export function handleClick(state: GameState): GameState {
  return {
    ...state,
    coins: state.coins + state.perClick,
    totalClicks: state.totalClicks + 1,
  };
}

export function applyPassiveIncome(state: GameState, deltaSeconds: number): GameState {
  if (state.passivePerSec === 0) return state;
  
  return {
    ...state,
    coins: state.coins + (state.passivePerSec * deltaSeconds),
  };
}

export function purchaseUpgrade(state: GameState, upgradeId: string): GameState | null {
  const upgrade = UPGRADES.find(u => u.id === upgradeId);
  if (!upgrade) return null;

  const owned = state.ownedUpgrades[upgradeId] || 0;
  const price = calculateUpgradePrice(upgrade, owned);

  if (state.coins < price) return null;

  let newPerClick = state.perClick;
  let newPassivePerSec = state.passivePerSec;

  if (upgrade.clickBonus) {
    newPerClick += upgrade.clickBonus;
  }

  if (upgrade.clickMultiplier) {
    newPerClick *= upgrade.clickMultiplier;
  }

  if (upgrade.passiveBonus) {
    newPassivePerSec += upgrade.passiveBonus;
  }

  return {
    ...state,
    coins: state.coins - price,
    perClick: newPerClick,
    passivePerSec: newPassivePerSec,
    ownedUpgrades: {
      ...state.ownedUpgrades,
      [upgradeId]: owned + 1,
    },
  };
}

export function canAffordUpgrade(state: GameState, upgradeId: string): boolean {
  const upgrade = UPGRADES.find(u => u.id === upgradeId);
  if (!upgrade) return false;

  const owned = state.ownedUpgrades[upgradeId] || 0;
  const price = calculateUpgradePrice(upgrade, owned);

  return state.coins >= price;
}

export function shouldShowCelebration(state: GameState): boolean {
  if (state.celebrationShown) return false;
  
  if (state.coins >= 5000) return true;
  
  const legendaryUpgrade = UPGRADES.find(u => u.name.includes('Легендарный'));
  if (legendaryUpgrade && (state.ownedUpgrades[legendaryUpgrade.id] || 0) > 0) {
    return true;
  }
  
  return false;
}
