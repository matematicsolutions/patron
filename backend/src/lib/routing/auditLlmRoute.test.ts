import { describe, it, expect } from "vitest";
import {
    buildLlmRouteEvent,
    providerLabelForModel,
} from "./auditLlmRoute";

describe("providerLabelForModel", () => {
    it("rozroznia dostawcow istotnych dla residency", () => {
        expect(providerLabelForModel("ollama/llama3.3:70b")).toBe("ollama");
        expect(providerLabelForModel("openrouter/anthropic/claude-3.7")).toBe(
            "openrouter",
        );
        expect(providerLabelForModel("claude-opus-4-7")).toBe("anthropic");
        expect(providerLabelForModel("gpt-5.5")).toBe("openai");
        expect(providerLabelForModel("gemini-3-flash-preview")).toBe("google");
        expect(providerLabelForModel("cos-nieznanego")).toBe("unknown");
    });
});

describe("buildLlmRouteEvent", () => {
    it("zdarzenie ma typ llm_route i komplet pol w payload", () => {
        const ev = buildLlmRouteEvent({
            actorUserId: "user-1",
            chatId: "chat-1",
            caseId: "case-1",
            model: "gemini-3-flash-preview",
            provider: "google",
            egress: "us-with-dpa",
            classification: "client_general",
            action: "allow",
            reason: "us-allowed-by-administrator",
            latencyMs: 1234,
            usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.0012 },
        });
        expect(ev.event_type).toBe("llm_route");
        expect(ev.actor_user_id).toBe("user-1");
        expect(ev.chat_id).toBe("chat-1");
        const p = ev.payload as Record<string, unknown>;
        expect(p.model).toBe("gemini-3-flash-preview");
        expect(p.provider).toBe("google");
        expect(p.egress).toBe("us-with-dpa");
        expect(p.classification).toBe("client_general");
        expect(p.decision).toBe("allow");
        expect(p.reason).toBe("us-allowed-by-administrator");
        expect(p.case_id).toBe("case-1");
        expect(p.prompt_tokens).toBe(100);
        expect(p.completion_tokens).toBe(50);
        expect(p.cost_usd).toBe(0.0012);
        expect(p.cost_estimated).toBe(false);
        expect(p.latency_ms).toBe(1234);
    });

    it("realny koszt obecny -> cost_estimated false", () => {
        const ev = buildLlmRouteEvent({
            actorUserId: "u",
            model: "openrouter/x/y",
            provider: "openrouter",
            egress: "us-with-dpa",
            classification: "internal",
            action: "allow",
            reason: "us-allowed-by-administrator",
            usage: { costUsd: 0.5 },
        });
        const p = ev.payload as Record<string, unknown>;
        expect(p.cost_usd).toBe(0.5);
        expect(p.cost_estimated).toBe(false);
    });

    it("brak kosztu -> cost_usd null + cost_estimated true", () => {
        const ev = buildLlmRouteEvent({
            actorUserId: "u",
            model: "claude-opus-4-7",
            provider: "anthropic",
            egress: "us-with-dpa",
            classification: "internal",
            action: "allow",
            reason: "us-allowed-by-administrator",
        });
        const p = ev.payload as Record<string, unknown>;
        expect(p.cost_usd).toBeNull();
        expect(p.cost_estimated).toBe(true);
        expect(p.prompt_tokens).toBeNull();
    });

    it("zdarzenie blokady: decision block, brak usage", () => {
        const ev = buildLlmRouteEvent({
            actorUserId: "u",
            caseId: "case-x",
            model: "gemini-3-flash-preview",
            provider: "google",
            egress: "us-with-dpa",
            classification: "attorney_client_privileged",
            action: "block",
            reason: "privileged-requires-local",
        });
        const p = ev.payload as Record<string, unknown>;
        expect(p.decision).toBe("block");
        expect(p.reason).toBe("privileged-requires-local");
        expect(p.case_id).toBe("case-x");
    });
});
