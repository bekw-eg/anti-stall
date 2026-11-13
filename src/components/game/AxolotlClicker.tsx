import { useGame } from '@/contexts/GameContext';
import { motion } from 'framer-motion';
import axolotlImg from '@/assets/axolotl.png';
import { useState, useRef } from 'react';

type ClickEffect = {
  id: number;
  x: number;
  y: number;
};

export function AxolotlClicker() {
  const { click } = useGame();
  const [clickCount, setClickCount] = useState(0);
  const [effects, setEffects] = useState<ClickEffect[]>([]);
  const effectIdRef = useRef(0);

  const handleClick = (e: React.MouseEvent) => {
    click();
    setClickCount(prev => prev + 1);
    
    // Получаем координаты клика относительно изображения
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Создаем новый эффект
    const newEffect = {
      id: effectIdRef.current++,
      x,
      y
    };
    
    setEffects(prev => [...prev, newEffect]);
    
    // Удаляем эффект через 1 секунду
    setTimeout(() => {
      setEffects(prev => prev.filter(effect => effect.id !== newEffect.id));
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      // Создаем искусственное событие для клавиатурного клика
      const fakeEvent = {
        currentTarget: e.currentTarget,
        clientX: 0,
        clientY: 0
      } as unknown as React.MouseEvent;
      handleClick(fakeEvent);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <motion.button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="relative focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/50 rounded-full"
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
        aria-label="Кликнуть по аксолотлю"
        tabIndex={0}
      >
        <div className="relative">
          <motion.div
            key={clickCount}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 0.3 }}
          >
            <img
              src={axolotlImg}
              alt="Милый розовый аксолотль"
              className="w-64 h-64 md:w-80 md:h-80 object-contain drop-shadow-2xl select-none"
            />
          </motion.div>
          
          {/* Контейнер для эффектов "+1" */}
          <div className="absolute inset-0 pointer-events-none">
            {effects.map((effect) => (
              <motion.div
                key={effect.id}
                className="absolute text-2xl font-bold text-white drop-shadow-lg pointer-events-none"
                style={{
                  left: effect.x,
                  top: effect.y,
                  transform: 'translate(-50%, -50%)'
                }}
                initial={{ opacity: 1, y: 0, scale: 1 }}
                animate={{ 
                  opacity: 0, 
                  y: -50, 
                  scale: 1.2,
                  transition: { duration: 1 }
                }}
              >
                +1
              </motion.div>
            ))}
          </div>
        </div>
      </motion.button>

      {/* Sound toggle removed */}
    </div>
  );
}
