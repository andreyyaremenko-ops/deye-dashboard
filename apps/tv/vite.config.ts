import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import legacy from "@vitejs/plugin-legacy";
import { transformAsync } from "@babel/core";
import presetEnv from "@babel/preset-env";

// Старі ТБ без ES-модулів (Tizen 2.4 2016 — WebKit 538, лише ES5, без Promise/fetch/Map) отримують окрему
// збірку з <script nomodule>: Babel до ES5 + core-js за фактичним використанням + fetch. Сучасні браузери її не вантажать.
const LEGACY_TARGETS = ["safari >= 8", "chrome >= 38"];

/** plugin-legacy вважає ES2015 нижньою межею: обгортки CommonJS від rolldown у чанку поліфілів лишаються
 *  стрілками (`(t,r)=>{…}`), і Tizen 2.4 падає на першому рядку. Доганяємо всі legacy-чанки до ES5 вже після нього. */
function es5LegacyChunks(): Plugin {
  return {
    name: "es5-legacy-chunks",
    apply: "build",
    enforce: "post",
    async generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.fileName.includes("-legacy")) continue;
        const out = await transformAsync(chunk.code, {
          babelrc: false, configFile: false, compact: true, sourceType: "script",
          // typeof-symbol не можна: хелпер _typeof всередині самого поліфіла Symbol ламає його ще до встановлення
          presets: [[presetEnv, { targets: LEGACY_TARGETS, modules: false, exclude: ["transform-typeof-symbol"] }]],
        });
        if (out?.code) chunk.code = out.code;
      }
    },
  };
}

// Сторінка для ТБ. Роздається Caddy з /s/<token>: base "/s/" + handle_path.
export default defineConfig({
  base: "/s/",
  plugins: [
    preact(),
    legacy({ targets: LEGACY_TARGETS, additionalLegacyPolyfills: ["whatwg-fetch"] }),
    es5LegacyChunks(),
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: { proxy: { "/api": "http://localhost:3000", "/ws": { target: "ws://localhost:3000", ws: true } } },
});
