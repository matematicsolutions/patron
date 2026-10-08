// Odswiezenie modeli 2026-10-08. Pilnujemy trzech rzeczy, ktorych dotad nie pilnowal
// zaden test:
//  1. stary zapisany wybor mecenasa przechodzi na nastepce U TEGO SAMEGO dostawcy -
//     nie spada po cichu na domyslny model innego dostawcy (inna rezydencja danych);
//  2. lustro frontendu (ModelToggle.tsx: MODELS, LEGACY_MODEL_ALIASES, DEFAULT_MODEL_ID)
//     zgadza sie z backendem (models.ts) - czytamy plik frontendu ze zrodla;
//  3. cennik: stawki Claude 5.5 z cennika Anthropic, cena progowa Haiku 5.5,
//     poprawiona stawka gemini-3-flash-preview.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
    CLAUDE_LOW_MODELS,
    CLAUDE_MAIN_MODELS,
    CLAUDE_MID_MODELS,
    DEFAULT_MAIN_MODEL,
    LEGACY_MODEL_ALIASES,
    providerForModel,
    resolveModel,
} from "./models";
import { resolveCost } from "./pricing";

const FE = fs.readFileSync(
    path.join(__dirname, "../../../../frontend/src/app/components/assistant/ModelToggle.tsx"),
    "utf-8",
);
const feIds = [...FE.matchAll(/\bid: "([^"]+)"/g)].map((m) => m[1]!);
const feBlok = FE.slice(FE.indexOf("LEGACY_MODEL_ALIASES"), FE.indexOf("};", FE.indexOf("LEGACY_MODEL_ALIASES")));
const feAliasy = Object.fromEntries([...feBlok.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
const feDefault = /DEFAULT_MODEL_ID = "([^"]+)"/.exec(FE)?.[1];

describe("aliasy wycofanych modeli - ten sam dostawca", () => {
    it.each(Object.entries(LEGACY_MODEL_ALIASES))("%s -> %s", (stary, nowy) => {
        expect(resolveModel(stary, DEFAULT_MAIN_MODEL)).toBe(nowy);
        expect(providerForModel(nowy)).toBe(providerForModel(stary));
    });

    it("kontrola: nieznany id dalej spada na fallback", () => {
        expect(resolveModel("claude-nieistniejacy-9", "FALLBACK")).toBe("FALLBACK");
    });

    it("nowe id Claude sa na listach tierow", () => {
        expect([...CLAUDE_MAIN_MODELS]).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
        expect([...CLAUDE_MID_MODELS]).toEqual(["claude-sonnet-5-5"]);
        expect([...CLAUDE_LOW_MODELS]).toEqual(["claude-haiku-5-5"]);
    });
});

describe("lustro frontendu (ModelToggle.tsx)", () => {
    it("kontrola: parser widzi liste modeli, aliasy i domyslny model", () => {
        expect(feIds.length).toBeGreaterThan(5);
        expect(Object.keys(feAliasy).length).toBeGreaterThan(3);
        expect(feDefault).toBeTruthy();
    });

    it("DEFAULT_MODEL_ID frontendu == DEFAULT_MAIN_MODEL backendu", () => {
        expect(feDefault).toBe(DEFAULT_MAIN_MODEL);
    });

    it("kazdy alias backendu, ktorego nastepca jest w pickerze, jest we frontendzie z tym samym nastepca", () => {
        // Haiku nie jest w pickerze czatu (tylko tytuly i ustawienia) - jego alias zyje w backendzie.
        for (const [stary, nowy] of Object.entries(LEGACY_MODEL_ALIASES)) {
            if (feIds.includes(nowy)) expect(feAliasy[stary], stary).toBe(nowy);
            else expect(feAliasy[stary], stary).toBeUndefined();
        }
    });

    it("aliasy frontendu ponad backend to tylko slugi OpenRoutera; kazdy nastepca jest w pickerze", () => {
        for (const [stary, nowy] of Object.entries(feAliasy)) {
            if (!(stary in LEGACY_MODEL_ALIASES)) expect(stary.startsWith("openrouter/")).toBe(true);
            expect(feIds).toContain(nowy);
        }
    });

    it("kazdy model natywny z pickera przechodzi resolveModel bez zmiany (jest na liscie backendu)", () => {
        for (const id of feIds.filter((i) => !i.startsWith("openrouter/") && !i.startsWith("ollama/"))) {
            expect(resolveModel(id, "FALLBACK"), id).toBe(id);
        }
    });
});

describe("cennik 2026-10-08", () => {
    const koszt = (m: string, wej: number, wyj: number) => resolveCost(m, wej, wyj, null).costUsd!;

    it("Claude 5.5 natywnie i przez slug OpenRoutera - stawki bazowe Anthropic", () => {
        expect(koszt("claude-opus-5-5", 1e6, 1e6)).toBeCloseTo(24);
        expect(koszt("openrouter/anthropic/claude-opus-5.5", 1e6, 1e6)).toBeCloseTo(24);
        expect(koszt("claude-sonnet-5-5", 1e6, 1e6)).toBeCloseTo(12);
    });

    it("Haiku 5.5: cena progowa powyzej 100 tys. tokenow wejscia", () => {
        expect(koszt("claude-haiku-5-5", 50_000, 1_000)).toBeCloseTo(0.05 * 0.1 + 0.001 * 0.5);
        expect(koszt("claude-haiku-5-5", 150_000, 1_000)).toBeCloseTo(0.15 * 0.5 + 0.001 * 2.5);
        // Kontrola: dokladnie na progu jeszcze stawka podstawowa.
        expect(koszt("claude-haiku-5-5", 100_000, 0)).toBeCloseTo(0.1 * 0.1);
    });

    it("gemini-3-flash-preview: 0,50/3 (bylo 1,5/9 z tieru - zawyzenie ~3x)", () => {
        expect(koszt("openrouter/google/gemini-3-flash-preview", 1e6, 1e6)).toBeCloseTo(3.5);
    });
});
