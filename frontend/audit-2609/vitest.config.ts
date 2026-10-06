// Czerwone testy audytu 2026-09 (docs/AUDYT_2026-09.md) - poza domyslna bramka.
// Uruchomienie: npx vitest run -c audit-2609/vitest.config.ts   (z frontend/)
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
    test: {
        environment: "jsdom",
        include: ["audit-2609/**/*.test.{ts,tsx}"],
        globals: true,
    },
});
