import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import TomatoApp from "./tomato/TomatoApp";

/** Маршруты Tomato: главная и ссылка-приглашение; всё остальное (в т. ч. старые /game, /legacy) — на главную. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TomatoApp />} />
      <Route path="/room/:code" element={<TomatoApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const App = () => (
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
);

export default App;
