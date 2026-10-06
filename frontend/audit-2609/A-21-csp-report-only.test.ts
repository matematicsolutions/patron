// A-21: CSP frontendu (next.config.ts) jest wysylana wylacznie jako
// Content-Security-Policy-Report-Only, a Electron (desktop/main.js) nie dokleja
// wlasnej polityki - img-src/connect-src 'self' niczego nie blokuja, wiec druga
// warstwa obrony przed zero-click eksfiltracja (A-20) nie istnieje (punkt otwarty
// z audytu 2026-06-02, wciaz aktualny).
// Oczekiwane zachowanie: egzekwowany naglowek Content-Security-Policy z img-src
// bez zewnetrznych hostow.
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("A-21 - CSP egzekwowana, nie tylko raportowana", () => {
    it("na kazdej sciezce jest egzekwowany Content-Security-Policy z img-src ograniczonym do wlasnego origin", async () => {
        const rules = (await nextConfig.headers?.()) ?? [];
        const all = rules.find((r) => r.source === "/:path*");
        const enforced = all?.headers.find(
            (h) => h.key.toLowerCase() === "content-security-policy",
        );
        expect(enforced, "brak egzekwowanego naglowka CSP").toBeDefined();
        const imgSrc = enforced!.value
            .split(";")
            .map((d) => d.trim())
            .find((d) => d.startsWith("img-src"));
        expect(imgSrc).toBeDefined();
        expect(imgSrc).not.toMatch(/https?:|\*/);
    });
});
