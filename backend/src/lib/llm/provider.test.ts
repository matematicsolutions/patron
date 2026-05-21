// Testy schemy multi-provider LLM abstraction (ADR-0014 T1).
//
// Cele testow:
// 1. Pokrycie pol enumow (ProviderId / EgressFlag / DataClassification).
// 2. Walidacja krzyzowa ChatRequest:
//    - attorney_client_privileged wymaga caseId + pseudonimSessionId
//    - client_general wymaga pseudonimSessionId
//    - public/internal nie wymagaja
// 3. Discriminated union ChatChunk - kazdy typ przechodzi parsowanie.
// 4. CostEstimate - reguly nieujemnosci, multiplier > 0.
// 5. RouterDecision - rejected reasons enum.
// 6. Strukturalna zgodnosc `z.infer<>` z typami z provider.ts (compile-time).

import { describe, expect, it } from "vitest";

import type {
    ChatChunk,
    ChatRequest,
    ChatResponse,
    Capabilities,
    CostEstimate,
    RouterDecision,
} from "./provider";
import {
    CapabilitiesSchema,
    ChatChunkSchema,
    ChatRequestSchema,
    ChatResponseSchema,
    CostEstimateSchema,
    DataClassificationSchema,
    EgressFlagSchema,
    MessageSchema,
    ProviderIdSchema,
    RequiredCapabilitiesSchema,
    RouterDecisionSchema,
    parseChatRequest,
    parseChatResponse,
    parseRouterDecision,
} from "./provider.schema";

describe("ProviderIdSchema", () => {
    it.each(["anthropic", "gemini", "ollama", "openai"] as const)(
        "akceptuje %s",
        (id) => {
            expect(ProviderIdSchema.parse(id)).toBe(id);
        },
    );

    it("odrzuca nieznane providery", () => {
        expect(() => ProviderIdSchema.parse("claude")).toThrow();
        expect(() => ProviderIdSchema.parse("deepseek")).toThrow();
        expect(() => ProviderIdSchema.parse("")).toThrow();
    });
});

describe("EgressFlagSchema", () => {
    it.each(["no-egress", "eu-only", "us-with-dpa"] as const)(
        "akceptuje %s",
        (flag) => {
            expect(EgressFlagSchema.parse(flag)).toBe(flag);
        },
    );

    it("odrzuca nieznana wartosc", () => {
        expect(() => EgressFlagSchema.parse("us")).toThrow();
    });
});

describe("DataClassificationSchema", () => {
    it.each([
        "public",
        "internal",
        "client_general",
        "attorney_client_privileged",
    ] as const)("akceptuje %s", (cls) => {
        expect(DataClassificationSchema.parse(cls)).toBe(cls);
    });

    it("odrzuca nieznana klasyfikacje", () => {
        expect(() => DataClassificationSchema.parse("confidential")).toThrow();
    });
});

describe("CapabilitiesSchema", () => {
    const valid: Capabilities = {
        egress: "no-egress",
        toolCalling: true,
        vision: false,
        contextWindow: 128_000,
        structuredOutput: true,
        streaming: true,
        reasoning: false,
    };

    it("akceptuje pelny zestaw flag", () => {
        expect(CapabilitiesSchema.parse(valid)).toEqual(valid);
    });

    it("wymaga dodatniej wartosci contextWindow", () => {
        expect(() =>
            CapabilitiesSchema.parse({ ...valid, contextWindow: 0 }),
        ).toThrow();
        expect(() =>
            CapabilitiesSchema.parse({ ...valid, contextWindow: -1 }),
        ).toThrow();
    });

    it("wymaga integer contextWindow", () => {
        expect(() =>
            CapabilitiesSchema.parse({ ...valid, contextWindow: 1024.5 }),
        ).toThrow();
    });

    it("odrzuca dodatkowy klucz NIE - zod default ignoruje", () => {
        // sprawdzenie ze parsing nie wybucha na dodatkowych kluczach
        // (zachowanie zod-default - strip vs throw).
        const withExtra = { ...valid, unknownFlag: true } as unknown;
        expect(() => CapabilitiesSchema.parse(withExtra)).not.toThrow();
    });
});

describe("MessageSchema", () => {
    it("akceptuje minimalna user message", () => {
        expect(
            MessageSchema.parse({ role: "user", content: "halo" }),
        ).toEqual({ role: "user", content: "halo" });
    });

    it("akceptuje tool message z toolCallId", () => {
        const msg = {
            role: "tool" as const,
            content: '{"result":"ok"}',
            toolCallId: "call_abc",
        };
        expect(MessageSchema.parse(msg)).toEqual(msg);
    });

    it("odrzuca pusta role", () => {
        expect(() =>
            MessageSchema.parse({ role: "", content: "halo" }),
        ).toThrow();
    });
});

describe("RequiredCapabilitiesSchema", () => {
    it("akceptuje pusty obiekt (brak wymagan)", () => {
        expect(RequiredCapabilitiesSchema.parse({})).toEqual({});
    });

    it("akceptuje minContextWindow dodatni", () => {
        expect(
            RequiredCapabilitiesSchema.parse({ minContextWindow: 32_000 }),
        ).toEqual({ minContextWindow: 32_000 });
    });

    it("odrzuca minContextWindow ujemny", () => {
        expect(() =>
            RequiredCapabilitiesSchema.parse({ minContextWindow: -1 }),
        ).toThrow();
    });
});

describe("ChatRequestSchema - walidacja krzyzowa data classification", () => {
    const baseRequest = {
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "halo" }],
    };

    it("public bez caseId/pseudonim - ok", () => {
        const req = { ...baseRequest, dataClassification: "public" as const };
        expect(parseChatRequest(req)).toMatchObject({
            dataClassification: "public",
        });
    });

    it("internal (default) bez caseId/pseudonim - ok", () => {
        expect(parseChatRequest(baseRequest)).toMatchObject({
            model: "claude-opus-4-7",
        });
    });

    it("client_general bez pseudonimSessionId - odrzucony", () => {
        const req = {
            ...baseRequest,
            dataClassification: "client_general" as const,
        };
        expect(() => parseChatRequest(req)).toThrow(/pseudonimSessionId/);
    });

    it("client_general z pseudonimSessionId - ok", () => {
        const req = {
            ...baseRequest,
            dataClassification: "client_general" as const,
            pseudonimSessionId: "ps_xyz",
        };
        expect(parseChatRequest(req)).toMatchObject({
            pseudonimSessionId: "ps_xyz",
        });
    });

    it("attorney_client_privileged bez caseId i pseudonim - odrzucony z 2 issue", () => {
        const req = {
            ...baseRequest,
            dataClassification: "attorney_client_privileged" as const,
        };
        try {
            parseChatRequest(req);
            throw new Error("oczekiwano blad");
        } catch (err) {
            expect(String(err)).toMatch(/caseId/);
            expect(String(err)).toMatch(/pseudonimSessionId/);
        }
    });

    it("attorney_client_privileged z pelnym kontekstem - ok", () => {
        const req = {
            ...baseRequest,
            dataClassification: "attorney_client_privileged" as const,
            caseId: "CASE_2026_47",
            pseudonimSessionId: "ps_xyz",
        };
        expect(parseChatRequest(req)).toMatchObject({
            caseId: "CASE_2026_47",
            pseudonimSessionId: "ps_xyz",
        });
    });

    it("temperature poza zakresem - odrzucony", () => {
        expect(() =>
            parseChatRequest({ ...baseRequest, temperature: 2.5 }),
        ).toThrow();
        expect(() =>
            parseChatRequest({ ...baseRequest, temperature: -0.1 }),
        ).toThrow();
    });

    it("messages puste - odrzucony", () => {
        expect(() =>
            parseChatRequest({ model: "x", messages: [] }),
        ).toThrow();
    });

    it("model pusty string - odrzucony", () => {
        expect(() =>
            parseChatRequest({ model: "", messages: baseRequest.messages }),
        ).toThrow();
    });
});

describe("ChatResponseSchema", () => {
    const valid: ChatResponse = {
        providerId: "anthropic",
        model: "claude-opus-4-7",
        content: "halo",
        toolCalls: [],
        tokensIn: 120,
        tokensOut: 45,
        latencyMs: 850,
        costPln: 0.012,
    };

    it("akceptuje minimalna response", () => {
        expect(parseChatResponse(valid)).toEqual(valid);
    });

    it("odrzuca ujemne tokens", () => {
        expect(() =>
            parseChatResponse({ ...valid, tokensIn: -1 }),
        ).toThrow();
    });

    it("akceptuje response z tool calls + reasoning", () => {
        const withTools: ChatResponse = {
            ...valid,
            toolCalls: [
                {
                    id: "call_1",
                    name: "saos_search",
                    arguments: { sygnatura: "II FSK 1/24" },
                },
            ],
            reasoning: "myslimy...",
            auditEventId: "evt_001",
        };
        expect(parseChatResponse(withTools)).toEqual(withTools);
    });
});

describe("ChatChunkSchema - discriminated union", () => {
    it("akceptuje content chunk", () => {
        const c: ChatChunk = { type: "content", delta: "ha" };
        expect(ChatChunkSchema.parse(c)).toEqual(c);
    });

    it("akceptuje reasoning chunk", () => {
        const c: ChatChunk = { type: "reasoning", delta: "myslimy" };
        expect(ChatChunkSchema.parse(c)).toEqual(c);
    });

    it("akceptuje reasoning_end chunk", () => {
        const c: ChatChunk = { type: "reasoning_end" };
        expect(ChatChunkSchema.parse(c)).toEqual(c);
    });

    it("akceptuje tool_call_start chunk", () => {
        const c: ChatChunk = {
            type: "tool_call_start",
            call: { id: "c_1", name: "f", arguments: {} },
        };
        expect(ChatChunkSchema.parse(c)).toEqual(c);
    });

    it("akceptuje done chunk z pelna response", () => {
        const c: ChatChunk = {
            type: "done",
            response: {
                providerId: "ollama",
                model: "llama-3.3-70b",
                content: "halo",
                toolCalls: [],
                tokensIn: 10,
                tokensOut: 5,
                latencyMs: 100,
                costPln: 0,
            },
        };
        expect(ChatChunkSchema.parse(c)).toEqual(c);
    });

    it("odrzuca nieznany type", () => {
        expect(() =>
            ChatChunkSchema.parse({ type: "unknown", delta: "x" }),
        ).toThrow();
    });
});

describe("CostEstimateSchema", () => {
    const valid: CostEstimate = {
        providerId: "gemini",
        model: "gemini-2.5-pro",
        tokensInEstimate: 1000,
        tokensOutEstimate: 4000,
        costPlnEstimate: 0.08,
        outputMultiplier: 4,
    };

    it("akceptuje walidna estymate", () => {
        expect(CostEstimateSchema.parse(valid)).toEqual(valid);
    });

    it("odrzuca outputMultiplier <= 0", () => {
        expect(() =>
            CostEstimateSchema.parse({ ...valid, outputMultiplier: 0 }),
        ).toThrow();
        expect(() =>
            CostEstimateSchema.parse({ ...valid, outputMultiplier: -1 }),
        ).toThrow();
    });

    it("odrzuca ujemny costPlnEstimate", () => {
        expect(() =>
            CostEstimateSchema.parse({ ...valid, costPlnEstimate: -0.01 }),
        ).toThrow();
    });
});

describe("RouterDecisionSchema", () => {
    const valid: RouterDecision = {
        primary: "anthropic",
        fallbackChain: ["gemini", "ollama"],
        rejectedProviders: [
            {
                providerId: "openai",
                reason: "egress_classification_mismatch",
            },
        ],
        decisionMs: 4,
    };

    it("akceptuje walidna decyzje", () => {
        expect(parseRouterDecision(valid)).toEqual(valid);
    });

    it("akceptuje decyzje bez rejected (pusta lista)", () => {
        const d: RouterDecision = {
            ...valid,
            rejectedProviders: [],
        };
        expect(parseRouterDecision(d)).toEqual(d);
    });

    it("odrzuca nieznany reason", () => {
        expect(() =>
            parseRouterDecision({
                ...valid,
                rejectedProviders: [
                    { providerId: "openai", reason: "unknown_reason" },
                ],
            }),
        ).toThrow();
    });
});

describe("Strukturalna zgodnosc z typami provider.ts (compile-time)", () => {
    // Te asercje sa kontraktem - jezeli z.infer<typeof Schema> nie zgadza
    // sie z typem z provider.ts, TSC zglosi blad. Test runtime jedynie
    // potwierdza ze kod sie kompiluje i instancje sa konstruowalne.

    it("ChatRequest z provider.ts mozna sparowac przez schema", () => {
        const req: ChatRequest = {
            model: "claude-opus-4-7",
            messages: [{ role: "user", content: "halo" }],
            dataClassification: "internal",
        };
        const parsed = parseChatRequest(req);
        expect(parsed.model).toBe(req.model);
    });

    it("ChatResponse z provider.ts mozna sparowac przez schema", () => {
        const resp: ChatResponse = {
            providerId: "anthropic",
            model: "claude-opus-4-7",
            content: "halo",
            toolCalls: [],
            tokensIn: 10,
            tokensOut: 5,
            latencyMs: 100,
            costPln: 0.001,
        };
        const parsed = parseChatResponse(resp);
        expect(parsed.providerId).toBe(resp.providerId);
    });

    it("Capabilities z provider.ts mozna sparowac przez schema", () => {
        const caps: Capabilities = {
            egress: "no-egress",
            toolCalling: false,
            vision: false,
            contextWindow: 32_000,
            structuredOutput: false,
            streaming: true,
            reasoning: false,
        };
        const parsed = CapabilitiesSchema.parse(caps);
        expect(parsed.egress).toBe("no-egress");
    });
});
