import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: true,
    // Dev-прокси к Tomato backend (см. backend/README.md): /api → REST, /ws → WebSocket
    proxy: {
      "/api": { target: process.env.VITE_BACKEND_URL ?? "http://localhost:8787", changeOrigin: true },
      "/ws": { target: process.env.VITE_BACKEND_URL ?? "http://localhost:8787", ws: true },
    },
  },
  preview: {
    allowedHosts: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
