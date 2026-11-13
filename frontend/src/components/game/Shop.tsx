import { UPGRADES } from '@/lib/upgrades';
import { UpgradeCard } from './UpgradeCard';

export function Shop() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Магазин апгрейдов</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {UPGRADES.map((upgrade) => (
          <UpgradeCard key={upgrade.id} upgrade={upgrade} />
        ))}
      </div>
    </div>
  );
}
