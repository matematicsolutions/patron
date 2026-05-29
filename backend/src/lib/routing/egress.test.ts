import { describe, it, expect } from "vitest";
import { egressForModel, isLocalModel } from "./egress";

describe("egressForModel - rejestr residency", () => {
    it("Ollama lokalny -> no-egress", () => {
        expect(egressForModel("ollama/llama3.3:70b")).toBe("no-egress");
        expect(egressForModel("ollama/bielik-11b-v2.3")).toBe("no-egress");
        expect(isLocalModel("ollama/qwen2.5:32b")).toBe(true);
    });

    it("modele chmurowe natywne -> us-with-dpa", () => {
        expect(egressForModel("claude-opus-4-7")).toBe("us-with-dpa");
        expect(egressForModel("gpt-5.5")).toBe("us-with-dpa");
        expect(egressForModel("gemini-3-flash-preview")).toBe("us-with-dpa");
    });

    it("OpenRouter -> us-with-dpa, takze dla modeli pozornie lokalnych (Bielik przez US infra)", () => {
        expect(egressForModel("openrouter/anthropic/claude-3.7-sonnet")).toBe(
            "us-with-dpa",
        );
        // Bielik przez OpenRouter NIE jest no-egress - request wychodzi do US.
        expect(egressForModel("openrouter/speakleash/bielik-11b-v2.3")).toBe(
            "us-with-dpa",
        );
        expect(isLocalModel("openrouter/speakleash/bielik-11b-v2.3")).toBe(false);
    });

    it("model nieznany -> us-with-dpa (fail-closed)", () => {
        expect(egressForModel("jakis-nieznany-model-2099")).toBe("us-with-dpa");
        expect(egressForModel("")).toBe("us-with-dpa");
        expect(isLocalModel("nieznany")).toBe(false);
    });
});
