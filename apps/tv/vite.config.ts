import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Сторінка для ТБ. Роздається Caddy з /s/<token>: base "/s/" + handle_path.
export default defineConfig({
  base: "/s/",
  plugins: [preact()],
  build: {
    target: "es2018",          // старі ТБ-браузери (Tizen/webOS 2019+)
    outDir: "dist",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: { proxy: { "/api": "http://localhost:3000", "/ws": { target: "ws://localhost:3000", ws: true } } },
});
