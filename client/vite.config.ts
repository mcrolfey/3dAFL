import { defineConfig } from "vite";

// API_PORT lets a second copy run alongside the default one (e.g. PORT=8788 on the server).
const apiPort = process.env.API_PORT ?? "8787";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/ws": {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
});
