// Czerwone testy audytu 2026-09 (docs/AUDYT_2026-09.md). Osobny runner:
// kazdy test opisuje ZADANE zachowanie i jest czerwony na kodzie z dnia audytu,
// wiec nie wchodzi do domyslnej bramki `npm test` (src/**, test/**).
// Uruchomienie: npx vitest run -c audit-2609/vitest.config.ts   (z backend/)
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["audit-2609/**/*.test.ts"],
        exclude: ["node_modules", "dist"],
        pool: "forks",
        fileParallelism: false,
    },
});
