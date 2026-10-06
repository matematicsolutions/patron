// A-11: Adapter OpenAI (lib/llm/openai.ts:107-135) wola Responses API bez `store: false`.
// Domyslnie Responses API zapisuje obiekt odpowiedzi (wejscie z trescia akt, wyniki narzedzi,
// wyjscie) po stronie dostawcy i udostepnia go w logach organizacji; petla narzedzi wrecz
// zalezy od tego zapisu (previous_response_id, openai.ts:131,166,201). Tresc sprawy jest wiec
// utrwalana u dostawcy ponad przetwarzanie potrzebne do odpowiedzi (RODO art. 5 ust. 1 lit. c,
// art. 25) - bez decyzji Operatora i bez sladu tego faktu w audycie.
// Oczekiwane: kazde zadanie do Responses API niesie jawne `store: false`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { completeOpenAIText } from "../src/lib/llm/openai";

describe("A-11 OpenAI Responses API: tresc akt utrwalana u dostawcy", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it("zadanie do /v1/responses ma store: false", async () => {
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
            bodies.push(JSON.parse(init?.body ?? "{}"));
            return new Response(JSON.stringify({ output_text: "ok" }), { status: 200 });
        }) as never;
        await completeOpenAIText({
            model: "gpt-5-mini",
            user: "Streszcz: Pan Jan Testowy zawarl umowe najmu.",
            apiKeys: { openai: "sk-test-syntetyczny" },
        });
        expect(bodies.length).toBe(1);
        expect(bodies[0]!.store).toBe(false);
    });
});
