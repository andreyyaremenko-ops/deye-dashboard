import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  // пререндер лендінгу: workspace-пакет із .ts-джерелами бандлимо, решту лишаємо node
  ssr: { noExternal: ["@deye/shared"] },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
