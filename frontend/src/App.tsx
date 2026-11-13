import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GameProvider } from "./contexts/GameContext";
import { Navbar } from "./components/Navbar";
import { CelebrationModal } from "./components/CelebrationModal";
import GamePage from "./pages/GamePage";
import AchievementsPage from "./pages/AchievementsPage";
import AboutPage from "./pages/AboutPage";
import NotFound from "./pages/NotFound";
import TomatoApp from "./tomato/TomatoApp";
import LegacyTomatoApp from "./components/tomato/TomatoApp";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <GameProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Tomato — полноэкранный флоу без навбара */}
            <Route path="/" element={<TomatoApp />} />
            <Route path="/room/:code" element={<TomatoApp />} />
            {/* Прежний временный интерфейс сохранён для восстановления/сравнения */}
            <Route path="/legacy" element={<LegacyTomatoApp />} />
            <Route
              path="/*"
              element={
                <div className="min-h-screen flex flex-col overflow-x-hidden">
                  <Navbar />
                  <main className="flex-1 pt-[60px] md:pt-16">
                    <Routes>
                      <Route path="/game" element={<GamePage />} />
                      <Route path="/achievements" element={<AchievementsPage />} />
                      <Route path="/about" element={<AboutPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </main>
                  <CelebrationModal />
                </div>
              }
            />
          </Routes>
        </BrowserRouter>
      </GameProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
