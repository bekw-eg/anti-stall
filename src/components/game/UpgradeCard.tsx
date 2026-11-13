import { motion } from 'framer-motion';
import { useGame } from '@/contexts/GameContext';
import { Upgrade } from '@/types/game';
import { calculateUpgradePrice } from '@/lib/upgrades';
import { canAffordUpgrade } from '@/lib/gameLogic';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Coins } from 'lucide-react';

interface UpgradeCardProps {
  upgrade: Upgrade;
}

export function UpgradeCard({ upgrade }: UpgradeCardProps) {
  const { state, buyUpgrade } = useGame();
  const owned = state.ownedUpgrades[upgrade.id] || 0;
  const price = calculateUpgradePrice(upgrade, owned);
  const canAfford = canAffordUpgrade(state, upgrade.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="shadow-card hover:shadow-elevated transition-shadow h-full flex flex-col">
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="text-lg">{upgrade.name}</CardTitle>
            {owned > 0 && (
              <Badge variant="secondary" className="ml-2">
                {owned}
              </Badge>
            )}
          </div>
          <CardDescription>{upgrade.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4 text-[hsl(155,60%,50%)]" />
            <span className="font-semibold text-muted-foreground">{price.toLocaleString()}</span>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => buyUpgrade(upgrade.id)}
            disabled={!canAfford}
            variant={canAfford ? 'default' : 'outline'}
          >
            Купить
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
