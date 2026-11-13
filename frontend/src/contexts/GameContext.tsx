import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { GameState, STORAGE_KEY, STORAGE_VERSION, StoredData } from '@/types/game';
import { INITIAL_STATE, handleClick as gameHandleClick, applyPassiveIncome, purchaseUpgrade as gamePurchaseUpgrade, shouldShowCelebration } from '@/lib/gameLogic';
import { checkNewAchievements, ACHIEVEMENTS } from '@/lib/achievements';
import { toast } from '@/hooks/use-toast';

interface GameContextType {
  state: GameState;
  click: () => void;
  buyUpgrade: (upgradeId: string) => void;
  markCelebrationShown: () => void;
  resetGame: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

function loadState(): GameState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return INITIAL_STATE;

    const parsed: StoredData = JSON.parse(stored);
    if (parsed.version !== STORAGE_VERSION) return INITIAL_STATE;

    return { ...INITIAL_STATE, ...parsed.state };
  } catch {
    return INITIAL_STATE;
  }
}

function saveState(state: GameState) {
  try {
    const data: StoredData = {
      version: STORAGE_VERSION,
      state,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save state', error);
  }
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>(loadState);
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (state.passivePerSec === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const deltaSeconds = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      setState(prev => applyPassiveIncome(prev, deltaSeconds));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.passivePerSec]);

  useEffect(() => {
    lastTickRef.current = Date.now();
  }, []);

  const click = useCallback(() => {
    setState(prevState => {
      const newState = gameHandleClick(prevState);
      const newAchievements = checkNewAchievements(prevState, newState);

      if (newAchievements.length > 0) {
        newAchievements.forEach(id => {
          const achievement = ACHIEVEMENTS.find(a => a.id === id);
          if (achievement) {
            toast({
              title: achievement.name,
              description: achievement.description,
            });
          }
        });

        return {
          ...newState,
          unlockedAchievements: [...newState.unlockedAchievements, ...newAchievements],
        };
      }

      return newState;
    });
  }, []);

  const buyUpgrade = useCallback((upgradeId: string) => {
    setState(prevState => {
      const newState = gamePurchaseUpgrade(prevState, upgradeId);
      if (!newState) {
        toast({
          title: 'Недостаточно монет',
          variant: 'destructive',
        });
        return prevState;
      }

      const newAchievements = checkNewAchievements(prevState, newState);

      toast({
        title: 'Куплено!',
        description: 'Апгрейд успешно куплен',
      });

      if (newAchievements.length > 0) {
        newAchievements.forEach(id => {
          const achievement = ACHIEVEMENTS.find(a => a.id === id);
          if (achievement) {
            toast({
              title: achievement.name,
              description: achievement.description,
            });
          }
        });

        return {
          ...newState,
          unlockedAchievements: [...newState.unlockedAchievements, ...newAchievements],
        };
      }

      return newState;
    });
  }, []);

  // sound/mute features removed

  const markCelebrationShown = useCallback(() => {
    setState(prev => ({ ...prev, celebrationShown: true }));
  }, []);

  const resetGame = useCallback(() => {
    setState(INITIAL_STATE);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (shouldShowCelebration(state) && !state.celebrationShown) {
      import('canvas-confetti').then(confetti => {
        confetti.default({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      });
    }
  }, [state]);

  return (
    <GameContext.Provider value={{ state, click, buyUpgrade, markCelebrationShown, resetGame }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
}
