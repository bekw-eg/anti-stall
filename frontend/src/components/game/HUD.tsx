import { useGame } from '@/contexts/GameContext';
import { Card } from '@/components/ui/card';
import { Coins, MousePointerClick, TrendingUp, Target } from 'lucide-react';

export function HUD() {
  const { state } = useGame();

  const stats = [
    {
      label: 'Монеты',
      value: Math.floor(state.coins).toLocaleString(),
      icon: Coins,
      gradient: 'gradient-primary',
    },
    {
      label: 'За клик',
      value: state.perClick.toLocaleString(),
      icon: MousePointerClick,
      gradient: 'gradient-secondary',
    },
    {
      label: 'Пассивно/сек',
      value: state.passivePerSec.toFixed(1),
      icon: TrendingUp,
      gradient: 'gradient-primary',
    },
    {
      label: 'Кликов всего',
      value: state.totalClicks.toLocaleString(),
      icon: Target,
      gradient: 'gradient-secondary',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4 shadow-card hover:shadow-elevated transition-shadow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
            <div className={`p-2 rounded-lg ${stat.gradient}`}>
              <stat.icon className="h-5 w-5 text-[hsl(155,45%,17%)]" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
