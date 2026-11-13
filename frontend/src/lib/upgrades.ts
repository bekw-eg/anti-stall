import { Upgrade } from '@/types/game';

export const UPGRADES: Upgrade[] = [
  {
    id: 'shiny_paw',
    name: 'Блестящая лапка',
    description: '+1 к монетам за клик',
    basePrice: 50,
    priceGrowth: 1.35,
    clickBonus: 1,
  },
  {
    id: 'worm_snack',
    name: 'Сочная червячная закуска',
    description: '+1 пассивно/сек',
    basePrice: 150,
    priceGrowth: 1.30,
    passiveBonus: 1,
  },
  {
    id: 'double_splash',
    name: 'Двойной всплеск',
    description: 'Множитель клика ×2',
    basePrice: 500,
    priceGrowth: 1.45,
    clickMultiplier: 2,
  },
  {
    id: 'aqua_motor',
    name: 'Аква-моторчик',
    description: '+5 пассивно/сек',
    basePrice: 1200,
    priceGrowth: 1.40,
    passiveBonus: 5,
  },
  {
    id: 'legendary_fin',
    name: 'Легендарный плавник',
    description: '+10 за клик',
    basePrice: 2500,
    priceGrowth: 1.50,
    clickBonus: 10,
  },
  {
    id: 'hydro_reactor',
    name: 'Гидро-реактор',
    description: '+20 пассивно/сек',
    basePrice: 8000,
    priceGrowth: 1.55,
    passiveBonus: 20,
  },
];

export function calculateUpgradePrice(upgrade: Upgrade, owned: number): number {
  return Math.ceil(upgrade.basePrice * Math.pow(upgrade.priceGrowth, owned));
}
