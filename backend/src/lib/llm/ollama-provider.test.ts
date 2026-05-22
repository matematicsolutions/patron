// Testy OllamaProvider (ADR-0014 T2b).
//
// Cele:
// 1. Pure helpery (stripOllamaPrefix / toOllamaMessages / buildOptions /
//    estimateTokensIn) - czysta logika bez fetch.
// 2. doChat - mock fetch, happy path + 429 retry + 5xx retry + fatal 4xx.
// 3. doStream - mock fetch z ReadableStream + JSON-lines parsing.
// 4. Capabilities default + override.
// 5. estimateCost - tokens estymowane, costPln zawsze 0 (lokalna inferencja).
// 6. Egress flag = no-egress (kluczowe dla attorney_client_privileged).

import { describe, expect, it } from "vitest";

import {
    OllamaProvider,
    buildOptions,
    estimateTokensIn,
    stripOllamaPrefix,
    toOllamaMessages,
} from "./ollama-provider";
import type { ChatChunk, ChatRequest } from "./provider";

describe("stripOllamaPrefix", () => {
    it("usuwa prefix 'ollama/'", () => {
        expect(stripOllamaPrefix("ollama/llama3.3:70b")).toBe("llama3.3:70b");
    });

    it("zostawia model bez prefixu", () => {
        expect(stripOllamaPrefix("llama3.3:70b")).toBe("llama3.3:70b");
    });

    it("nie myli prefixu w srodku nazwy", () => {
        expect(stripOllamaPrefix("custom-ollama/x")).toBe("custom-ollama/x");
    });
});

describe("toOllamaMessages", () => {
    it("dodaje system prompt na poczatku gdy podany", () => {
        const req: ChatRequest = {
            model: "llama3.3:70b",
            systemPrompt: "Jestes asystentem prawniczym.",
            messages: [{ role: "user", content: "halo" }],
        };
        expect(toOllamaMessages(req)).toEqual([
            { role: "system", content: "Jestes asystentem prawniczym." },
            { role: "user", content: "halo" },
        ]);
    });

    it("pomija system prompt gdy brak", () => {
        const req: ChatRequest = {
            model: "llama3.3:70b",
            messages: [{ role: "user", content: "halo" }],
        };
        expect(toOllamaMessages(req)).toEqual([
            { role: "user", content: "halo" },
        ]);
    });

    it("zachowuje role 'tool'", () => {
        const req: ChatRequest = {
            model: "llama3.3:70b",
            messages: [
                { role: "user", content: "halo" },
                { role: "assistant", content: "wywoluje" },
                { role: "tool", content: '{"r":"ok"}', toolCallId: "c_1" },
            ],
        };
        const msgs = toOllamaMessages(req);
        expect(msgs[2]).toEqual({ role: "tool", content: '{"r":"ok"}' });
    });
});

describe("buildOptions", () => {
    it("mapuje maxTokens na num_predict", () => {
        const req: ChatRequest = {
            model: "x",
            messages: [{ role: "user", content: "a" }],
            maxTokens: 512,
        };
        expect(buildOptions(req)).toEqual({ num_predict: 512 });
    });

    it("mapuje temperature 1:1", () => {
        const req: ChatRequest = {
            model: "x",
            messages: [{ role: "user", content: "a" }],
            temperature: 0.3,
        };
        expect(buildOptions(req)).toEqual({ temperature: 0.3 });
    });

    it("pusty obiekt gdy brak opcji", () => {
        const req: ChatRequest = {
            model: "x",
            messages: [{ role: "user", content: "a" }],
        };
        expect(buildOptions(req)).toEqual({});
    });
});

describe("estimateTokensIn", () => {
    it("dla pustego promptu zwraca 0", () => {
        const req: ChatRequest = {
            model: "x",
            messages: [{ role: "user", content: "" }],
        };
        expect(estimateTokensIn(req)).toBe(0);
    });

    it("zlicza system + messages + tools (z dzielnikiem 3 znaki/token)", () => {
        const req: ChatRequest = {
            model: "x",
            systemPrompt: "abc",
            messages: [{ role: "user", content: "def" }],
            tools: [
                {
                    name: "ghi",
                    description: "jkl",
                    parameters: {},
                },
            ],
        };
        // 3 + 3 + 3 + 3 + 2 (`{}`) = 14 znakow, 14/3 = 5 (ceil)
        expect(estimateTokensIn(req)).toBe(5);
    });
});

describe("OllamaProvider capabilities", () => {
    it("default capabilities = no-egress + streaming + no tools", () => {
        const p = new OllamaProvider();
        expect(p.capabilities.egress).toBe("no-egress");
        expect(p.capabilities.streaming).toBe(true);
        expect(p.capabilities.toolCalling).toBe(false);
        expect(p.capabilities.vision).toBe(false);
    });

    it("capabilitiesOverride pozwala wlaczyc tool calling", () => {
        const p = new OllamaProvider({
            capabilitiesOverride: { toolCalling: true, contextWindow: 128_000 },
        });
        expect(p.capabilities.toolCalling).toBe(true);
        expect(p.capabilities.contextWindow).toBe(128_000);
        expect(p.capabilities.egress).toBe("no-egress"); // niezmienione
    });
});

describe("OllamaProvider.estimateCost", () => {
    it("costPln zawsze 0 (lokalna inferencja)", () => {
        const p = new OllamaProvider();
        const est = p.estimateCost({
            model: "ollama/llama3.3:70b",
            messages: [{ role: "user", content: "x".repeat(300) }],
        });
        expect(est.costPlnEstimate).toBe(0);
        expect(est.tokensInEstimate).toBeGreaterThan(0);
        expect(est.outputMultiplier).toBe(4);
        expect(est.providerId).toBe("ollama");
    });
});

// ---------------------------------------------------------------------------
// doChat - mock fetch
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown): typeof fetch {
    return (async () =>
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
}

function mockFetchStatus(status: number, body = ""): typeof fetch {
    return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("OllamaProvider.chat (mock fetch)", () => {
    it("happy path zwraca ChatResponse z prompt_eval_count i eval_count", async () => {
        const p = new OllamaProvider({
            fetchImpl: mockFetchOk({
                model: "llama3.3:70b",
                message: { role: "assistant", content: "odp" },
                done: true,
                prompt_eval_count: 12,
                eval_count: 7,
            }),
        });
        const resp = await p.chat({
            model: "ollama/llama3.3:70b",
            messages: [{ role: "user", content: "halo" }],
        });
        expect(resp.content).toBe("odp");
        expect(resp.tokensIn).toBe(12);
        expect(resp.tokensOut).toBe(7);
        expect(resp.costPln).toBe(0);
        expect(resp.providerId).toBe("ollama");
    });

    it("rzuca fatal error na HTTP 401 (NIE retry)", async () => {
        let calls = 0;
        const p = new OllamaProvider({
            fetchImpl: (async () => {
                calls += 1;
                return new Response("unauthorized", { status: 401 });
            }) as unknown as typeof fetch,
        });
        await expect(
            p.chat({
                model: "ollama/llama3.3:70b",
                messages: [{ role: "user", content: "halo" }],
            }),
        ).rejects.toThrow(/401/);
        expect(calls).toBe(1);
    });

    it("rozpoznaje 429 jako retryowalny (przechodzi przez BaseProvider retry)", async () => {
        let calls = 0;
        const p = new OllamaProvider({
            // szybkie testy - skrocony timeout do nie-blokowania
            requestTimeoutMs: 5000,
            fetchImpl: (async () => {
                calls += 1;
                if (calls < 3) return new Response("rate", { status: 429 });
                return new Response(
                    JSON.stringify({
                        model: "x",
                        message: { role: "assistant", content: "ok-retry" },
                        done: true,
                        prompt_eval_count: 1,
                        eval_count: 1,
                    }),
                    { status: 200 },
                );
            }) as unknown as typeof fetch,
        });
        const resp = await p.chat({
            model: "ollama/x",
            messages: [{ role: "user", content: "halo" }],
        });
        expect(resp.content).toBe("ok-retry");
        expect(calls).toBe(3);
    }, 30_000);

    it("rozpoznaje 503 jako retryowalny", async () => {
        let calls = 0;
        const p = new OllamaProvider({
            requestTimeoutMs: 5000,
            fetchImpl: (async () => {
                calls += 1;
                if (calls < 2) return new Response("down", { status: 503 });
                return new Response(
                    JSON.stringify({
                        model: "x",
                        message: { role: "assistant", content: "ok" },
                        done: true,
                    }),
                    { status: 200 },
                );
            }) as unknown as typeof fetch,
        });
        const resp = await p.chat({
            model: "ollama/x",
            messages: [{ role: "user", content: "halo" }],
        });
        expect(resp.content).toBe("ok");
        expect(calls).toBe(2);
    }, 30_000);

    it("network error -> ProviderTransientError -> retry", async () => {
        let calls = 0;
        const p = new OllamaProvider({
            requestTimeoutMs: 5000,
            fetchImpl: (async () => {
                calls += 1;
                if (calls < 2) throw new Error("ECONNREFUSED");
                return new Response(
                    JSON.stringify({
                        model: "x",
                        message: { role: "assistant", content: "ok" },
                        done: true,
                    }),
                    { status: 200 },
                );
            }) as unknown as typeof fetch,
        });
        const resp = await p.chat({
            model: "ollama/x",
            messages: [{ role: "user", content: "halo" }],
        });
        expect(resp.content).toBe("ok");
        expect(calls).toBe(2);
    }, 30_000);
});

// ---------------------------------------------------------------------------
// doStream - mock fetch z ReadableStream + JSON-lines
// ---------------------------------------------------------------------------

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i >= lines.length) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(lines[i] + "\n"));
            i += 1;
        },
    });
}

function mockFetchStream(lines: string[]): typeof fetch {
    return (async () =>
        new Response(streamFromLines(lines), {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
        })) as unknown as typeof fetch;
}

describe("OllamaProvider.stream (mock fetch)", () => {
    it("yielduje content chunks + done na koncu", async () => {
        const p = new OllamaProvider({
            fetchImpl: mockFetchStream([
                JSON.stringify({
                    model: "x",
                    message: { role: "assistant", content: "Czesc " },
                    done: false,
                }),
                JSON.stringify({
                    model: "x",
                    message: { role: "assistant", content: "swiecie" },
                    done: false,
                }),
                JSON.stringify({
                    model: "x",
                    message: { role: "assistant", content: "" },
                    done: true,
                    prompt_eval_count: 5,
                    eval_count: 8,
                }),
            ]),
        });
        const chunks: ChatChunk[] = [];
        for await (const c of p.stream({
            model: "ollama/x",
            messages: [{ role: "user", content: "halo" }],
        })) {
            chunks.push(c);
        }
        const contentChunks = chunks.filter((c) => c.type === "content");
        expect(contentChunks).toHaveLength(2);
        const doneChunk = chunks[chunks.length - 1];
        if (doneChunk?.type !== "done") {
            throw new Error("ostatni chunk powinien byc done");
        }
        expect(doneChunk.response.content).toBe("Czesc swiecie");
        expect(doneChunk.response.tokensIn).toBe(5);
        expect(doneChunk.response.tokensOut).toBe(8);
    });

    it("rzuca ProviderTransientError na 503", async () => {
        const p = new OllamaProvider({
            fetchImpl: mockFetchStatus(503, "down"),
        });
        const iter = p.stream({
            model: "ollama/x",
            messages: [{ role: "user", content: "halo" }],
        });
        await expect(iter[Symbol.asyncIterator]().next()).rejects.toThrow();
    });
});
