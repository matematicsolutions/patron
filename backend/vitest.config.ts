import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        exclude: ["node_modules", "dist"],
        // Pojedyncze pliki testow uruchamiamy szeregowo by uniknac
        // konfliktow przy mockowaniu globalnych zmiennych srodowiskowych.
        pool: "forks",
        fileParallelism: false,
    },
});
