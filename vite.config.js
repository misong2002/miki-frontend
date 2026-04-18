import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendPort = Number(process.env.MIKI_FRONTEND_PORT ?? 38673);
const backendPort = Number(process.env.MIKI_BACKEND_PORT ?? 38674);
const apiBaseUrl =
  process.env.VITE_API_BASE_URL ?? `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiBaseUrl,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: frontendPort,
    strictPort: true,
  },
});
