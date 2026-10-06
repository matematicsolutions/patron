// D-07: Gdy konektor MCP pada w turze researchu (runMcpTool -> isError: true, np.
// ECONNREFUSED / timeout / 5xx SAOS), uzytkownik nie dostaje ZADNEGO sygnalu: blad idzie
// wylacznie do modelu jako tool_result (lib/chat/stream.ts:553-575 - mcpSources
// pomija bledy), a grounding cytatow MCP (ADR-0146) odpala sie TYLKO gdy
// mcpSources.length > 0 || mcpCitations.length > 0 (stream.ts:688). Jesli model mimo
// to poda "doslowny" cytat z orzeczenia (halucynacja po nieudanym wyszukiwaniu - model
// najgorszego przypadku), odpowiedz wyglada jak ugruntowana w orzecznictwie: brak
// eventu mcp_grounding (zolty "nie zweryfikowano"), brak informacji o awarii konektora.
// ADR-0146/AGENTS.md: "a missing source text is yellow 'not verified', never green,
// and a grounding failure is an explicit signal in the UI, never silence".
// Oczekiwane: awaria konektora w turze -> jawny sygnal w SSE (event mcp_* z bledem
// konektora albo mcp_grounding oznaczajacy cytat jako niezweryfikowany).
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        streamChatWithTools: vi.fn(async (params: any) => {
            await params.runTools([
                { id: "m1", name: "saos__search_judgments", input: { query: "przedawnienie zachowku" } },
            ]);
            const text =
                "Sad Najwyzszy w wyroku z 12 marca 2020 r. wskazal:\n\n" +
                "> Roszczenie o zachowek przedawnia sie z uplywem pieciu lat od ogloszenia testamentu.\n\n" +
                "Zatem roszczenie klienta jest przedawnione.";
            params.callbacks?.onContentDelta?.(text);
            return { fullText: text };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return {
        ...orig,
        getMcpTools: vi.fn(async () => [{
            type: "function",
            function: { name: "saos__search_judgments", description: "Szukaj orzeczen", parameters: { type: "object", properties: { query: { type: "string" } } } },
        }]),
        isMcpTool: vi.fn((n: string) => n.includes("__")),
        // Konektor lezy (dokladnie ksztalt z lib/mcp/index.ts:578-584).
        runMcpTool: vi.fn(async (name: string) => ({
            text: JSON.stringify({ error: `MCP tool "${name}" failed: connect ECONNREFUSED 127.0.0.1:8080` }),
            citations: [],
            isError: true,
        })),
    };
});

import { runLLMStream } from "../src/lib/chat/stream";

function fakeDb() {
    const db: any = {
        from() {
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, insert: () => b,
                single: async () => ({ data: null, error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
            };
            return b;
        },
    };
    return db;
}

describe("D-07 awaria konektora MCP w researchu", () => {
    it("uzytkownik dostaje jawny sygnal (event mcp_*) zamiast ciszy", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const sse: string[] = [];
        await runLLMStream({
            apiMessages: [
                { role: "system", content: "Jestes asystentem." },
                { role: "user", content: "Czy roszczenie o zachowek jest przedawnione? Sprawdz orzecznictwo." },
            ],
            docStore: new Map(),
            docIndex: {},
            userId: "u1",
            db: fakeDb(),
            write: (s: string) => { sse.push(s); },
            model: "ollama/qwen3:8b",
            projectId: null,
        });
        const types = sse
            .filter((s) => s.startsWith("data: {"))
            .map((s) => JSON.parse(s.slice(6)).type as string);
        expect(types).toContain("content_delta"); // sanity: odpowiedz doszla
        const mcpSignals = types.filter((t) => t.startsWith("mcp"));
        expect(mcpSignals.length, `eventy SSE: ${types.join(",")}`).toBeGreaterThan(0);
    });
});
