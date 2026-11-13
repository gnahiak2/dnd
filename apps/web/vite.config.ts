import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = process.env.LK_SERVER_URL ?? "http://localhost:8787";
const wsUrl = serverUrl.replace(/^http/, "ws");
const port = Number(process.env.LK_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true,
    proxy: {
      "/api": { target: serverUrl, changeOrigin: true },
      "/ws": { target: wsUrl, ws: true, changeOrigin: true },
    },
  },
  preview: { port, strictPort: true },
});
