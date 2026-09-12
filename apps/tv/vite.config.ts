import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Сторінка для ТБ. Роздається Caddy з /s/<token>: base "/s/" + handle_path.
export default defineConfig({
  base: "/s/",
  plugins: [preact()],
  build: {
    target: "es2015",          // старі ТБ-браузери (Chromium 38–55 у Tizen/webOS 2015–2018)
    outDir: "dist",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: { proxy: { "/api": "http://localhost:3000", "/ws": { target: "ws://localhost:3000", ws: true } } },
});
