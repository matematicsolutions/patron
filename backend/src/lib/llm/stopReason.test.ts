// Powod konca petli modelu (StopReason). Klasa awarii, ktorej pilnujemy:
// odpowiedz przerwana limitem iteracji albo dlugosci wracala jako zwykle
// `{ fullText }` - mecenas i audyt (AI Act art. 12) widzieli ja jak pelna.
// Test na OpenRouterze, bo jego transport (fetch + SSE) da sie zamockowac bez
// SDK; pozostali dostawcy stosuja ta sama regule w tym samym miejscu petli.
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenRouter } from "./openrouter";

function sse(chunks: unknown[]): Response {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(new ReadableStream({
        start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(body));
            ctrl.close();
        },
    }), { status: 200 });
}

const narzedzie = {
    choices: [{
        delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "szukaj", arguments: "{}" } }] },
        finish_reason: "tool_calls",
    }],
};
const tekst = (finish: string) => ({ choices: [{ delta: { content: "Odpowiedz." }, finish_reason: finish }] });

const params = {
    model: "openrouter/x/y",
    systemPrompt: "s",
    messages: [{ role: "user" as const, content: "pytanie" }],
    apiKeys: { openrouter: "test-key" },
    tools: [{ type: "function" as const, function: { name: "szukaj", description: "d", parameters: {} } }],
    runTools: async (calls: { id: string }[]) => calls.map((c) => ({ tool_use_id: c.id, content: "wynik" })),
    maxIterations: 3,
};

afterEach(() => vi.unstubAllGlobals());

describe("StopReason w petli OpenRouter", () => {
    it("model sam konczy ture -> complete", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => sse([tekst("stop")])));
        const r = await streamOpenRouter(params as never);
        expect(r.stopReason).toBe("complete");
    });

    it("model chce narzedzi w kazdej iteracji -> max_iterations, nie complete", async () => {
        const fetchMock = vi.fn(async () => sse([narzedzie]));
        vi.stubGlobal("fetch", fetchMock);
        const r = await streamOpenRouter(params as never);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(r.stopReason).toBe("max_iterations");
    });

    it("odpowiedz ucieta limitem dlugosci -> max_tokens", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => sse([tekst("length")])));
        const r = await streamOpenRouter(params as never);
        expect(r.stopReason).toBe("max_tokens");
    });
});
