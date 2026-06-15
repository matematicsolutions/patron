import { describe, it, expect } from "vitest";
import { resolveCost, isLocalModel, PRICING } from "./pricing";

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

    it("brakujace tokeny traktowane jak 0", () => {
        const r = resolveCost("claude-opus-4-7", null, undefined, null);
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
