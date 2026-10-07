import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
  },
  server: {
    port: 5173,
    // Docker Desktop on Windows doesn't forward host filesystem change
    // events into the container's bind mount, so chokidar's default
    // watcher never fires and the dev server keeps serving a stale
    // transform cache. Polling works around that.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
