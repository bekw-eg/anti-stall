import { useGame } from '@/contexts/GameContext';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, Trophy } from 'lucide-react';

export default function AchievementsPage() {
  const { state } = useGame();

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Достижения</h1>
          <p className="text-xl text-muted-foreground">
            Разблокировано: {state.unlockedAchievements.length} из {ACHIEVEMENTS.length}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {ACHIEVEMENTS.map((achievement) => {
            const isUnlocked = state.unlockedAchievements.includes(achievement.id);
            
            return (
              <Card
                key={achievement.id}
                className={`shadow-card transition-all ${
                  isUnlocked
                    ? 'border-primary/50 shadow-elevated'
                    : 'opacity-60 grayscale'
                }`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isUnlocked ? 'gradient-primary' : 'bg-muted'}`}>
                        {isUnlocked ? (
                          <Trophy className="h-6 w-6 text-[hsl(155,45%,17%)]" />
                        ) : (
                          <Lock className="h-6 w-6 text-[hsl(155,60%,50%)]" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{achievement.name}</CardTitle>
                      </div>
                    </div>
                    {isUnlocked && (
                      <Badge variant="secondary" className="bg-success text-success-foreground">
                        Открыто
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {achievement.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}
