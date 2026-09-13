import { defineConfig } from "vitest/config";
// makeTestApp прогоняє 12 міграцій + seed у PGlite; при паралельних сьютах 10 с замало
export default defineConfig({ test: { hookTimeout: 60_000, testTimeout: 20_000 } });
