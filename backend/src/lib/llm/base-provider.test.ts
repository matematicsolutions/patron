// Testy klasy bazowej BaseProvider (ADR-0014 T2).
//
// Cele:
// 1. Token bucket rate limiter - capacity + refresh window.
// 2. Circuit breaker - 5 fail = open, czas open = blokuje, expire = closed.
// 3. Retry-with-backoff - 3 proby, tylko ProviderTransientError.
// 4. Timeout - po requestTimeoutMs rzuca ProviderTransientError.
// 5. Stream - rate/circuit dziala ale BEZ retry po pierwszym chunk.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
    BaseProvider,
    CircuitOpenError,
    ProviderTransientError,
    RateLimitExceededError,
    type BaseProviderConfig,
} from "./base-provider";
import type {
    ChatChunk,
    ChatRequest,
    ChatResponse,
    CostEstimate,
} from "./provider";

const CAPS = {
    egress: "no-egress" as const,
    toolCalling: false,
    vision: false,
    contextWindow: 1024,
    structuredOutput: false,
    streaming: true,
    reasoning: false,
};

const CONFIG_TEMPLATE: BaseProviderConfig = {
    id: "ollama",
    capabilities: CAPS,
    rateMaxRequests: 3,
    rateWindowMs: 1000,
    requestTimeoutMs: 500,
    circuitFailureThreshold: 2,
    circuitOpenDurationMs: 1000,
};

class StubProvider extends BaseProvider {
    public chatCalls = 0;
    public scriptedChat: (() => Promise<ChatResponse>) | null = null;
    public scriptedStream: (() => AsyncIterable<ChatChunk>) | null = null;

    constructor(config?: Partial<BaseProviderConfig>) {
        super({ ...CONFIG_TEMPLATE, ...config });
    }

    estimateCost(_req: ChatRequest): CostEstimate {
        return {
            providerId: this.id,
            model: "stub",
            tokensInEstimate: 100,
            tokensOutEstimate: 400,
            costPlnEstimate: 0,
            outputMultiplier: 4,
        };
    }

    protected async doChat(_req: ChatRequest): Promise<ChatResponse> {
        this.chatCalls += 1;
        if (this.scriptedChat) return this.scriptedChat();
        return {
            providerId: this.id,
            model: "stub",
            content: "ok",
            toolCalls: [],
            tokensIn: 10,
            tokensOut: 5,
            latencyMs: 1,
            costPln: 0,
        };
    }

    protected async *doStream(_req: ChatRequest): AsyncIterable<ChatChunk> {
        if (this.scriptedStream) {
            yield* this.scriptedStream();
            return;
        }
        yield { type: "content", delta: "ok" };
        yield {
            type: "done",
            response: {
                providerId: this.id,
                model: "stub",
                content: "ok",
                toolCalls: [],
                tokensIn: 0,
                tokensOut: 0,
                latencyMs: 1,
                costPln: 0,
            },
        };
    }
}

const minimalRequest: ChatRequest = {
    model: "stub",
    messages: [{ role: "user", content: "halo" }],
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T10:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("BaseProvider rate limiter (token bucket)", () => {
    it("zezwala na rateMaxRequests requestow w oknie", async () => {
        const p = new StubProvider();
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        expect(p.chatCalls).toBe(3);
    });

    it("odrzuca 4. request w tym samym oknie", async () => {
        const p = new StubProvider();
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        await expect(p.chat(minimalRequest)).rejects.toBeInstanceOf(
            RateLimitExceededError,
        );
    });

    it("refilluje tokens po wygasnieciu okna", async () => {
        const p = new StubProvider();
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        await p.chat(minimalRequest);
        vi.advanceTimersByTime(1001);
        await p.chat(minimalRequest);
        expect(p.chatCalls).toBe(4);
    });
});

describe("BaseProvider circuit breaker", () => {
    it("otwiera circuit po 2 kolejnych fatalnych bledach (threshold=2)", async () => {
        const p = new StubProvider();
        p.scriptedChat = () => {
            throw new Error("fatal");
        };
        await expect(p.chat(minimalRequest)).rejects.toThrow("fatal");
        await expect(p.chat(minimalRequest)).rejects.toThrow("fatal");
        // Circuit open - kolejny request odrzucany bez wywolania doChat
        await expect(p.chat(minimalRequest)).rejects.toBeInstanceOf(
            CircuitOpenError,
        );
        expect(p._circuitStateForTests()).toBe("open");
    });

    it("zamyka circuit po wygasnieciu okna open", async () => {
        const p = new StubProvider();
        p.scriptedChat = () => {
            throw new Error("fatal");
        };
        await expect(p.chat(minimalRequest)).rejects.toThrow();
        await expect(p.chat(minimalRequest)).rejects.toThrow();
        expect(p._circuitStateForTests()).toBe("open");
        vi.advanceTimersByTime(1001);
        // refresh bucket tez
        p.scriptedChat = null;
        const resp = await p.chat(minimalRequest);
        expect(resp.content).toBe("ok");
        expect(p._circuitStateForTests()).toBe("closed");
    });

    it("zerow licznik fail po sukcesie", async () => {
        const p = new StubProvider();
        let count = 0;
        p.scriptedChat = async () => {
            count += 1;
            if (count === 1) throw new Error("fatal");
            return {
                providerId: p.id,
                model: "stub",
                content: "ok",
                toolCalls: [],
                tokensIn: 1,
                tokensOut: 1,
                latencyMs: 1,
                costPln: 0,
            };
        };
        await expect(p.chat(minimalRequest)).rejects.toThrow();
        await p.chat(minimalRequest); // sukces - licznik reset
        p.scriptedChat = () => {
            throw new Error("fatal");
        };
        await expect(p.chat(minimalRequest)).rejects.toThrow();
        // Po 1 fail po reset nie powinien byc open jeszcze
        expect(p._circuitStateForTests()).toBe("closed");
    });
});

describe("BaseProvider retry-with-backoff", () => {
    it("retry 3x na ProviderTransientError, sukces na 3", async () => {
        const p = new StubProvider();
        let count = 0;
        p.scriptedChat = async () => {
            count += 1;
            if (count < 3) {
                throw new ProviderTransientError("ollama", "429", null);
            }
            return {
                providerId: p.id,
                model: "stub",
                content: "ok-after-retry",
                toolCalls: [],
                tokensIn: 1,
                tokensOut: 1,
                latencyMs: 1,
                costPln: 0,
            };
        };
        const promise = p.chat(minimalRequest);
        // Backoff: 1000ms + 4000ms
        await vi.advanceTimersByTimeAsync(5500);
        const resp = await promise;
        expect(resp.content).toBe("ok-after-retry");
        expect(count).toBe(3);
    });

    it("rzuca po wyczerpaniu 3 prob", async () => {
        const p = new StubProvider();
        let count = 0;
        p.scriptedChat = async () => {
            count += 1;
            throw new ProviderTransientError("ollama", "always-503", null);
        };
        const promise = p.chat(minimalRequest);
        // Podpinamy asercje (handler odrzucenia) PRZED przewinieciem timerow -
        // inaczej promise odrzuca sie w trakcie advanceTimers, gdy nikt jeszcze
        // nie slucha, i Vitest raportuje chwilowy "unhandled rejection".
        const assertion = expect(promise).rejects.toBeInstanceOf(ProviderTransientError);
        await vi.advanceTimersByTimeAsync(25_000);
        await assertion;
        expect(count).toBe(3);
    });

    it("NIE retryuje fatalnych errors (non-transient)", async () => {
        const p = new StubProvider();
        let count = 0;
        p.scriptedChat = async () => {
            count += 1;
            throw new Error("fatal-401");
        };
        await expect(p.chat(minimalRequest)).rejects.toThrow("fatal-401");
        expect(count).toBe(1);
    });
});

describe("BaseProvider timeout", () => {
    it("rzuca ProviderTransientError po requestTimeoutMs", async () => {
        const p = new StubProvider();
        p.scriptedChat = () => new Promise(() => {
            // never resolves
        });
        const promise = p.chat(minimalRequest);
        // Asercja PRZED przewinieciem timerow (patrz test "rzuca po wyczerpaniu
        // 3 prob") - promise odrzuca sie w trakcie advanceTimers.
        const assertion = expect(promise).rejects.toBeInstanceOf(ProviderTransientError);
        await vi.advanceTimersByTimeAsync(600);
        // Timeout = transient, idzie do retry (sleep 1s) + drugi timeout +
        // (sleep 4s) + trzeci timeout = lacznie 500+1000+500+4000+500 = 6500ms
        await vi.advanceTimersByTimeAsync(7000);
        await assertion;
    });
});

describe("BaseProvider stream", () => {
    it("yielduje chunks z konkretnego providera", async () => {
        const p = new StubProvider();
        const chunks: ChatChunk[] = [];
        for await (const c of p.stream(minimalRequest)) {
            chunks.push(c);
        }
        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.type).toBe("content");
        expect(chunks[1]?.type).toBe("done");
    });

    it("rate limit dziala na stream tak samo", async () => {
        const p = new StubProvider();
        for (let i = 0; i < 3; i += 1) {
            const chunks: ChatChunk[] = [];
            for await (const c of p.stream(minimalRequest)) chunks.push(c);
        }
        const iter = p.stream(minimalRequest);
        await expect(iter[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            RateLimitExceededError,
        );
    });

    it("NIE retryuje stream po failure (pierwszy chunk juz moglu pojsc)", async () => {
        const p = new StubProvider();
        let attempts = 0;
        p.scriptedStream = async function* () {
            attempts += 1;
            throw new ProviderTransientError("ollama", "stream-503", null);
        };
        const iter = p.stream(minimalRequest);
        await expect(iter[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            ProviderTransientError,
        );
        expect(attempts).toBe(1);
    });
});
