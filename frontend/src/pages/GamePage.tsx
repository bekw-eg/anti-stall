import { HUD } from '@/components/game/HUD';
import { AxolotlClicker } from '@/components/game/AxolotlClicker';
import { Shop } from '@/components/game/Shop';

export default function GamePage() {
  return (
    <main className="container mx-auto px-4 py-8 space-y-8">
      <HUD />
      <div className="flex justify-center py-8">
        <AxolotlClicker />
      </div>
      <Shop />
    </main>
  );
}
