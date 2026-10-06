// Argumenty wywolania narzedzia, ktore nie sa obiektem JSON, byly po cichu
// zamieniane na `{}` i narzedzie ruszalo z pustymi argumentami - wynik
// wygladal na udany, a model nie wiedzial, ze pomylil format. Teraz dostawca
// oznacza takie wywolanie (`argumentsInvalid`), a petla czatu go nie uruchamia.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedToolCall } from "./types";
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

const wywolanie = (args: string) => ({
    choices: [{
        delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "szukaj", arguments: args } }] },
        finish_reason: "tool_calls",
    }],
});
const koniec = { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };

afterEach(() => vi.unstubAllGlobals());

async function przechwycWywolanie(args: string): Promise<NormalizedToolCall> {
    const odpowiedzi = [sse([wywolanie(args)]), sse([koniec])];
    vi.stubGlobal("fetch", vi.fn(async () => odpowiedzi.shift()!));
    let zlapane: NormalizedToolCall | undefined;
    await streamOpenRouter({
        model: "openrouter/x/y",
        systemPrompt: "s",
        messages: [{ role: "user", content: "p" }],
        apiKeys: { openrouter: "k" },
        tools: [{ type: "function", function: { name: "szukaj", description: "d", parameters: {} } }],
        runTools: async (calls: NormalizedToolCall[]) => {
            zlapane = calls[0];
            return calls.map((c) => ({ tool_use_id: c.id, content: "x" }));
        },
    } as never);
    return zlapane!;
}

describe("argumenty narzedzia spoza JSON", () => {
    it("zepsuty JSON -> argumentsInvalid, nie ciche {}", async () => {
        const c = await przechwycWywolanie('{"q": "art. 5');
        expect(c.argumentsInvalid).toBe(true);
    });

    it("JSON, ale nie obiekt -> argumentsInvalid", async () => {
        const c = await przechwycWywolanie('["a"]');
        expect(c.argumentsInvalid).toBe(true);
    });

    it("poprawny obiekt -> bez flagi", async () => {
        const c = await przechwycWywolanie('{"q": "art. 5"}');
        expect(c.argumentsInvalid).toBeUndefined();
        expect(c.input).toEqual({ q: "art. 5" });
    });
});
