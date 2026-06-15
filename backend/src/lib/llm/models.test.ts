// Testy routingu modeli lokalnych (Ollama, no-egress).
//
// Regresja: resolveModel przepuszczal tylko ALL_MODELS + openrouter/, wiec
// ollama/* spadalo na fallback (DEFAULT_MAIN_MODEL = gemini, chmura US). To
// blokowalo /draft/refine strazikiem egress mimo wyboru modelu lokalnego i
// lamalo obietnice "no-egress lokalnie" (tajemnica zawodowa). Patrz egress.ts.

import { describe, expect, it } from "vitest";
import {
    DEFAULT_MAIN_MODEL,
    isOllamaModel,
    OLLAMA_PREFIX,
    providerForModel,
    resolveModel,
} from "./models";
import { egressForModel } from "../routing/egress";

describe("routing modeli lokalnych (Ollama)", () => {
    it("isOllamaModel rozpoznaje prefiks ollama/", () => {
        expect(isOllamaModel("ollama/llama3.2:3b")).toBe(true);
        expect(isOllamaModel("ollama/qwen2.5:32b")).toBe(true);
        expect(isOllamaModel("gemini-3-flash-preview")).toBe(false);
        expect(isOllamaModel("openrouter/x/y")).toBe(false);
        expect(OLLAMA_PREFIX).toBe("ollama/");
    });

    it("resolveModel PRZEPUSZCZA ollama/* (nie spada na fallback)", () => {
        expect(resolveModel("ollama/llama3.2:3b", DEFAULT_MAIN_MODEL)).toBe(
            "ollama/llama3.2:3b",
        );
        expect(resolveModel("ollama/bielik-11b-v2.3", "fb")).toBe(
            "ollama/bielik-11b-v2.3",
        );
        // Sedno regresji: NIE wraca DEFAULT_MAIN_MODEL (gemini, chmura).
        expect(resolveModel("ollama/llama3.2:3b", DEFAULT_MAIN_MODEL)).not.toBe(
            DEFAULT_MAIN_MODEL,
        );
    });

    it("przepuszczony ollama/* ma egress no-egress (straznik dopusci)", () => {
        const m = resolveModel("ollama/llama3.2:3b", DEFAULT_MAIN_MODEL);
        expect(egressForModel(m)).toBe("no-egress");
    });

    it("providerForModel rzuca dla ollama/* (dispatch jest wczesniej w index.ts)", () => {
        // ollama NIE jest w unii `Provider` warstwy funkcyjnej - completeText /
        // streamChatWithTools dispatchuja je przez isOllamaModel przed tym guardem.
        expect(() => providerForModel("ollama/llama3.2:3b")).toThrow();
    });
});
