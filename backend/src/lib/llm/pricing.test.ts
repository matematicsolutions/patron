import { describe, it, expect } from "vitest";
import { resolveCost, isLocalModel, PRICING } from "./pricing";
import {
    CLAUDE_MAIN_MODELS,
    CLAUDE_MID_MODELS,
    CLAUDE_LOW_MODELS,
    GEMINI_MAIN_MODELS,
    GEMINI_MID_MODELS,
    GEMINI_LOW_MODELS,
    OPENAI_MAIN_MODELS,
    OPENAI_MID_MODELS,
    OPENAI_LOW_MODELS,
} from "./models";

describe("pricing.resolveCost", () => {
    it("realny cost_usd z dostawcy wygrywa - estimated=false", () => {
        const r = resolveCost("gpt-5.5", 1000, 1000, 0.42);
        expect(r).toEqual({ costUsd: 0.42, estimated: false, unpriced: false });
    });

    it("realny koszt 0 tez jest realny (nie myli z brakiem)", () => {
        const r = resolveCost("gpt-5.5", 1000, 1000, 0);
        expect(r.costUsd).toBe(0);
        expect(r.estimated).toBe(false);
    });

    it("model lokalny (Ollama) -> koszt 0, brak oplaty API", () => {
        const r = resolveCost("ollama/llama3.3:70b", 5000, 5000, null);
        expect(r).toEqual({ costUsd: 0, estimated: true, unpriced: false });
    });

    it("model w cenniku bez realnego kosztu -> szacowany z tokenow", () => {
        // claude-opus-4-7: 5 USD/Mtok in, 25 USD/Mtok out.
        // 1M in + 1M out = 5 + 25 = 30 USD.
        const r = resolveCost("claude-opus-4-7", 1_000_000, 1_000_000, null);
        expect(r.estimated).toBe(true);
        expect(r.unpriced).toBe(false);
        expect(r.costUsd).toBeCloseTo(30, 6);
    });

    it("model spoza cennika bez realnego kosztu -> null, unpriced", () => {
        const r = resolveCost("jakis-egzotyczny-model-x", 1000, 1000, null);
        expect(r).toEqual({ costUsd: null, estimated: true, unpriced: true });
    });

    it("OpenRouter prefix mapuje na koncowy segment cennika", () => {
        const r = resolveCost("openrouter/openai/gpt-5.4-nano", 1_000_000, 0, null);
        // gpt-5.4-nano: 0.2 USD/Mtok in -> 1M in = 0.2 USD.
        expect(r.unpriced).toBe(false);
        expect(r.costUsd).toBeCloseTo(0.2, 6);
    });

    it("brak licznikow tokenow = NIEROZLICZONE, nie zero", () => {
        // Odwrocenie decyzji 2026-08-21. Poprzednio "brakujace tokeny traktowane
        // jak 0" - przez co panel kosztu po 5 realnych wywolaniach Gemini pokazywal
        // "0,00 USD / 0 nierozliczonych", czyli brak pomiaru udawal darmowosc.
        const r = resolveCost("claude-opus-4-7", null, undefined, null);
        expect(r.costUsd).toBeNull();
        expect(r.unpriced).toBe(true);
    });

    it("zero tokenow to nadal koszt 0, a nie brak pomiaru", () => {
        const r = resolveCost("claude-opus-4-7", 0, 0, null);
        expect(r.costUsd).toBe(0);
        expect(r.unpriced).toBe(false);
    });
});

describe("pricing.isLocalModel", () => {
    it("rozpoznaje prefiksy ollama", () => {
        expect(isLocalModel("ollama/llama3.3")).toBe(true);
        expect(isLocalModel("ollama:llama3.3")).toBe(true);
        expect(isLocalModel("claude-opus-4-7")).toBe(false);
    });
});

describe("pricing.PRICING integralnosc", () => {
    it("kazda pozycja ma source + asOf + dodatnie stawki", () => {
        for (const [model, p] of Object.entries(PRICING)) {
            expect(p.source, model).toBeTruthy();
            expect(p.asOf, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(p.inputPerMtokUsd, model).toBeGreaterThan(0);
            expect(p.outputPerMtokUsd, model).toBeGreaterThan(0);
        }
    });
});

describe("pricing.PRICING pokrycie obu sciezek rozliczenia", () => {
    // Sciezka "wlasny klucz": kazdy model z tierow w models.ts musi miec stawke,
    // inaczej panel kosztow pokaze mecenasowi same tokeny zamiast kwoty.
    it("kazdy natywny model z models.ts ma wpis w cenniku", () => {
        const native = [
            ...CLAUDE_MAIN_MODELS,
            ...CLAUDE_MID_MODELS,
            ...CLAUDE_LOW_MODELS,
            ...GEMINI_MAIN_MODELS,
            ...GEMINI_MID_MODELS,
            ...GEMINI_LOW_MODELS,
            ...OPENAI_MAIN_MODELS,
            ...OPENAI_MID_MODELS,
            ...OPENAI_LOW_MODELS,
        ];
        for (const model of native) {
            expect(PRICING[model], model).toBeDefined();
        }
    });

    it("kazdy natywny model z cennika ma lustro OpenRoutera", () => {
        // Slug OpenRoutera ma kropki tam, gdzie id natywne ma myslniki
        // (claude-opus-4-8 -> anthropic/claude-opus-4.8), wiec porownujemy
        // po znormalizowanej koncowce, nie po calym id.
        const norm = (id: string) => id.replace(/[.-]/g, "");
        const orTails = Object.keys(PRICING)
            .filter((k) => k.startsWith("openrouter/"))
            .map((k) => norm(k.slice(k.lastIndexOf("/") + 1)));
        const native = Object.keys(PRICING).filter((k) => !k.startsWith("openrouter/"));
        for (const model of native) {
            expect(orTails, model).toContain(norm(model));
        }
    });

    it("model direct i jego lustro OpenRoutera wyceniaja sie osobno", () => {
        // Regresja: klucz OpenRoutera ma kropki, wiec dopasowanie po koncowym
        // segmencie nie trafialo w tabele i model wpadal jako `unpriced`.
        const or = resolveCost("openrouter/anthropic/claude-opus-4.8", 1_000_000, 0, null);
        expect(or.unpriced).toBe(false);
        expect(or.costUsd).toBeCloseTo(5, 6);

        const direct = resolveCost("claude-opus-4-8", 1_000_000, 0, null);
        expect(direct.unpriced).toBe(false);
        expect(direct.costUsd).toBeCloseTo(5, 6);
    });

    it("Opus 5 (direct) - 1M in + 1M out = 30 USD", () => {
        const r = resolveCost("claude-opus-5", 1_000_000, 1_000_000, null);
        expect(r.estimated).toBe(true);
        expect(r.costUsd).toBeCloseTo(30, 6);
    });

    it("model tylko-OpenRouterowy (Qwen) tez ma stawke", () => {
        const r = resolveCost("openrouter/qwen/qwen3.6-flash", 1_000_000, 0, null);
        expect(r.unpriced).toBe(false);
        expect(r.costUsd).toBeCloseTo(0.1875, 6);
    });
});
