import { useEffect, useState } from 'react';
import { useGame } from '@/contexts/GameContext';
import { shouldShowCelebration } from '@/lib/gameLogic';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PartyPopper } from 'lucide-react';

export function CelebrationModal() {
  const { state, markCelebrationShown } = useGame();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (shouldShowCelebration(state)) {
      setOpen(true);
    }
  }, [state]);

  const handleClose = () => {
    setOpen(false);
    markCelebrationShown();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="p-4 rounded-full bg-gradient-primary">
              <PartyPopper className="h-12 w-12 text-white" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">Секретная страница</DialogTitle>
          <DialogDescription className="text-center text-lg">
            Сайт собран и задеплоен! Отличная работа!
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center mt-4">
          <Button onClick={handleClose} size="lg" className="gradient-primary">
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
