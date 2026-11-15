import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary, installErrorReporting } from "./errorReporting";
import "./index.css";

installErrorReporting();
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
