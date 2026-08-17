// Testy walidacji OLLAMA_HOST (defense-in-depth SSRF).
//
// OLLAMA_HOST jest jedynym punktem, gdzie operator wskazuje instancje Ollama
// (lokalna lub zdalna w sieci kancelarii). Bez walidacji atakujacy, ktory
// przejalby env/konfiguracje, mogl przekierowac wywolania LLM (z trescia pisma)
// na endpoint metadata chmury i wykrasc kredencjale instancji. Blokujemy hosty
// metadata + link-local 169.254/16, ale NIE RFC1918 (zdalna Ollama w LAN
// kancelarii to legalny scenariusz).

import { describe, expect, it } from "vitest";
import { validateOllamaHost } from "./ollama";

describe("validateOllamaHost (SSRF guard)", () => {
    it("przepuszcza localhost i typowe hosty", () => {
        expect(validateOllamaHost("http://localhost:11434")).toBe(
            "http://localhost:11434",
        );
        expect(validateOllamaHost("http://127.0.0.1:11434")).toBe(
            "http://127.0.0.1:11434",
        );
    });

    it("przepuszcza zdalna Ollame w sieci LAN kancelarii (RFC1918)", () => {
        expect(validateOllamaHost("http://192.168.1.50:11434")).toBeTruthy();
        expect(validateOllamaHost("http://10.0.0.5:11434")).toBeTruthy();
        expect(validateOllamaHost("https://ollama.kancelaria.local")).toBeTruthy();
    });

    it("blokuje endpointy metadata chmury (SSRF)", () => {
        expect(() => validateOllamaHost("http://169.254.169.254/")).toThrow(
            /SSRF|metadata|link-local/i,
        );
        expect(() => validateOllamaHost("http://169.254.170.2/")).toThrow();
        expect(() => validateOllamaHost("http://100.100.100.200/")).toThrow();
        expect(() =>
            validateOllamaHost("http://metadata.google.internal/"),
        ).toThrow();
    });

    it("blokuje caly zakres link-local 169.254/16", () => {
        expect(() => validateOllamaHost("http://169.254.1.1:80")).toThrow(
            /link-local|SSRF/i,
        );
    });

    it("blokuje niedozwolone protokoly", () => {
        expect(() => validateOllamaHost("file:///etc/passwd")).toThrow(
            /protokol|protocol/i,
        );
        expect(() => validateOllamaHost("ftp://host/")).toThrow();
    });

    it("rzuca czytelny blad dla nie-URL", () => {
        expect(() => validateOllamaHost("nie-jest-urlem")).toThrow(
            /nieprawidlowy URL|URL/i,
        );
    });
});
