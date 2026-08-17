// Testy komponentow frontendu (spec 012, A3-1). Osobny runner od Next -
// vitest + jsdom; alias "@" jak w tsconfig. `npm test`.
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.{ts,tsx}"],
        // globals: testing-library rejestruje wtedy auto-cleanup po kazdym
        // tescie (bez tego DOM z poprzednich testow zostaje i duplikuje matche).
        globals: true,
    },
});
