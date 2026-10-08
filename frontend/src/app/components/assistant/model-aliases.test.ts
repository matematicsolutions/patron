// Odswiezenie modeli 2026-10-08: zapisany w przegladarce wybor mecenasa spoza listy
// przechodzi na nastepce U TEGO SAMEGO dostawcy zamiast spadac na domyslny model
// innego dostawcy. Lustro backendu pilnuje backend/src/lib/llm/models-mirror.test.ts.
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, dozwolonyModel } from "./ModelToggle";

describe("dozwolonyModel", () => {
    it("stary Claude przez OpenRouter -> Claude 5.5 przez OpenRouter", () => {
        expect(dozwolonyModel("openrouter/anthropic/claude-opus-4.8")).toBe("openrouter/anthropic/claude-opus-5.5");
        expect(dozwolonyModel("openrouter/anthropic/claude-sonnet-4.6")).toBe("openrouter/anthropic/claude-sonnet-5.5");
    });

    it("stary Claude na wlasnym kluczu -> Claude 5.5 na wlasnym kluczu", () => {
        expect(dozwolonyModel("claude-opus-4-8")).toBe("claude-opus-5-5");
        expect(dozwolonyModel("claude-sonnet-4-6")).toBe("claude-sonnet-5-5");
    });

    it("model z listy bez zmian; nieznany -> null (wolajacy bierze domyslny)", () => {
        expect(dozwolonyModel(DEFAULT_MODEL_ID)).toBe(DEFAULT_MODEL_ID);
        expect(dozwolonyModel("model-ktorego-nie-ma")).toBeNull();
        expect(dozwolonyModel(null)).toBeNull();
    });
});
