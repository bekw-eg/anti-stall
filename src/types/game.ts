export interface GameState {
  coins: number;
  perClick: number;
  passivePerSec: number;
  totalClicks: number;
  ownedUpgrades: Record<string, number>;
  unlockedAchievements: string[];
  celebrationShown: boolean;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  priceGrowth: number;
  clickBonus?: number;
  passiveBonus?: number;
  clickMultiplier?: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  checkUnlock: (state: GameState) => boolean;
}

export const STORAGE_KEY = 'axolotl_lab_v1';
export const STORAGE_VERSION = 1;

export interface StoredData {
  version: number;
  state: GameState;
}
