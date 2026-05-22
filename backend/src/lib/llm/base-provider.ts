// Abstrakcyjna baza dla wszystkich providerow LLM (ADR-0014 T2).
//
// Implementuje obligatoryjne wzorce per provider z planu T2:
// - Rate limiter (token bucket per API key)
// - Request timeout (requestTimeoutMs z .env)
// - Retry-with-backoff (3 proby, exp 1s/4s/16s, retry tylko 429/503/timeout)
// - Circuit breaker (5 kolejnych fail / 60s = oznaczony "down", router pomija)
//
// Konkretne implementacje (AnthropicProvider/GeminiProvider/OllamaProvider/
// OpenAIProvider) dziedzicza z BaseProvider i implementuja `doChat`/`doStream`
// (low-level wywolanie API). Wszystkie wzorce odporu (retry/backoff/circuit)
// dzialaja w klasie bazowej - konkretny provider rzuca standardowymi bledami
// i baza obsluguje retry.
//
// Status: T2 w toku - klasa bazowa + 1 konkretna implementacja (Ollama).
// Pozostale 3 (Anthropic/Gemini/OpenAI) jako porty z claude.ts/gemini.ts/
// openai.ts w osobnych komitach (T2c1/c2/c3).

import type {
    Capabilities,
    ChatChunk,
    ChatRequest,
    ChatResponse,
    CostEstimate,
    LLMProvider,
    ProviderId,
} from "./provider";

/**
 * Klasa bledu rzucana gdy circuit breaker open (provider niedostepny).
 */
export class CircuitOpenError extends Error {
    readonly providerId: ProviderId;
    constructor(providerId: ProviderId) {
        super(`Provider ${providerId} circuit breaker open`);
        this.providerId = providerId;
        this.name = "CircuitOpenError";
    }
}

/**
 * Klasa bledu rzucana gdy rate limit przekroczony lokalnie (przed wywolaniem
 * API - wczesny sygnal zeby router wybral inny provider).
 */
export class RateLimitExceededError extends Error {
    readonly providerId: ProviderId;
    readonly retryAfterMs: number;
    constructor(providerId: ProviderId, retryAfterMs: number) {
        super(`Provider ${providerId} local rate limit, retry after ${retryAfterMs}ms`);
        this.providerId = providerId;
        this.retryAfterMs = retryAfterMs;
        this.name = "RateLimitExceededError";
    }
}

/**
 * Klasa bledu rzucana gdy provider zwrocil status retryowalny po wyczerpaniu
 * prob (3x). Router moze przejsc do fallback.
 */
export class ProviderTransientError extends Error {
    readonly providerId: ProviderId;
    readonly cause: unknown;
    constructor(providerId: ProviderId, message: string, cause: unknown) {
        super(`Provider ${providerId} transient error: ${message}`);
        this.providerId = providerId;
        this.cause = cause;
        this.name = "ProviderTransientError";
    }
}

/**
 * Konfiguracja klasy bazowej. Wszystkie pola obligatoryjne - bez defaultow,
 * konkretny provider deklaruje co go obowiazuje.
 */
export type BaseProviderConfig = {
    readonly id: ProviderId;
    readonly capabilities: Capabilities;
    /** Maksymalna liczba requestow w `rateWindowMs` (token bucket capacity). */
    readonly rateMaxRequests: number;
    readonly rateWindowMs: number;
    /** Hard timeout per request (ms). Po nim ProviderTransientError z reason=timeout. */
    readonly requestTimeoutMs: number;
    /** Liczba kolejnych fail po ktorych breaker open (default 5). */
    readonly circuitFailureThreshold: number;
    /** Czas trwania breaker open (ms, default 60_000). */
    readonly circuitOpenDurationMs: number;
};

type CircuitState =
    | { readonly type: "closed"; readonly consecutiveFailures: number }
    | { readonly type: "open"; readonly openedAt: number };

type TokenBucket = {
    tokens: number;
    lastRefillAt: number;
};

/**
 * Klasa bazowa wszystkich providerow LLM. Konkretne implementacje dziedzicza
 * i implementuja `doChat`/`doStream`/`estimateCost`.
 *
 * Wzorzec: konkretny provider rzuca:
 * - `ProviderTransientError` na 429/503/network error - baza obsluguje retry
 * - dowolny inny error - baza traktuje jako fatal, nie retry
 *
 * Wszystkie metody publiczne (`chat`/`stream`) sa final - baza wraps logike
 * konkretnego providera odpornoscia (rate / circuit / retry / timeout).
 */
export abstract class BaseProvider implements LLMProvider {
    readonly id: ProviderId;
    readonly capabilities: Capabilities;
    protected readonly config: BaseProviderConfig;

    private bucket: TokenBucket;
    private circuit: CircuitState = { type: "closed", consecutiveFailures: 0 };

    constructor(config: BaseProviderConfig) {
        this.id = config.id;
        this.capabilities = config.capabilities;
        this.config = config;
        this.bucket = {
            tokens: config.rateMaxRequests,
            lastRefillAt: Date.now(),
        };
    }

    /**
     * Synchroniczne wywolanie chat. Obsluguje rate / circuit / retry / timeout.
     */
    async chat(req: ChatRequest): Promise<ChatResponse> {
        return this.withResilience(() => this.doChat(req));
    }

    /**
     * Streamowane wywolanie. Iterator powinien zwracac chunks `content` /
     * `reasoning` / `tool_call_start` i konczyc `done`.
     *
     * Uwaga: retry dla streamow jest skomplikowane (delta juz dostarczona) -
     * baza robi retry TYLKO na pre-flight fail (rate / timeout zanim
     * pierwszy chunk doszedl). Po dostarczeniu pierwszego chunk - bez retry.
     */
    async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
        this.checkCircuit();
        this.consumeToken();
        try {
            // Stream nie ma retry po pierwszym chunk. Pre-flight blad
            // (np. 429 zanim doszedl SSE) zaliczamy do circuit failure.
            yield* this.doStream(req);
            this.onSuccess();
        } catch (err) {
            this.onFailure(err);
            throw err;
        }
    }

    /**
     * Estymacja kosztu PRZED wywolaniem - nie robi API call, nie obciaza
     * rate / circuit. Konkretny provider implementuje na podstawie cennika.
     */
    abstract estimateCost(req: ChatRequest): CostEstimate;

    /**
     * Low-level wywolanie chat. Konkretny provider implementuje. Rzuca
     * `ProviderTransientError` dla retryowalnych (429/503/network), inne
     * errory baza traktuje jako fatal.
     */
    protected abstract doChat(req: ChatRequest): Promise<ChatResponse>;

    /**
     * Low-level streaming. Konkretny provider implementuje.
     */
    protected abstract doStream(req: ChatRequest): AsyncIterable<ChatChunk>;

    /**
     * Wraps logike konkretnego providera odpornoscia (rate / circuit / retry
     * / timeout).
     */
    private async withResilience<T>(call: () => Promise<T>): Promise<T> {
        this.checkCircuit();
        this.consumeToken();

        const backoffs = [1000, 4000, 16000];
        let lastErr: unknown = undefined;
        for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
            try {
                const result = await this.withTimeout(call());
                this.onSuccess();
                return result;
            } catch (err) {
                lastErr = err;
                if (!this.isRetryable(err) || attempt === backoffs.length - 1) {
                    this.onFailure(err);
                    throw err;
                }
                await this.sleep(backoffs[attempt]!);
            }
        }
        // unreachable - petla zawsze konczy sie return/throw
        throw lastErr;
    }

    private async withTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new ProviderTransientError(
                                    this.id,
                                    `timeout ${this.config.requestTimeoutMs}ms`,
                                    null,
                                ),
                            ),
                        this.config.requestTimeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    private isRetryable(err: unknown): boolean {
        return err instanceof ProviderTransientError;
    }

    private checkCircuit(): void {
        if (this.circuit.type !== "open") return;
        const elapsed = Date.now() - this.circuit.openedAt;
        if (elapsed >= this.config.circuitOpenDurationMs) {
            // half-open - kolejny call moze zamknac (success) lub otworzyc na
            // nowo (failure). Tu uproszczone: traktujemy jak closed po
            // wygasnieciu, kolejne fail otworzy.
            this.circuit = { type: "closed", consecutiveFailures: 0 };
            return;
        }
        throw new CircuitOpenError(this.id);
    }

    private consumeToken(): void {
        const now = Date.now();
        const elapsed = now - this.bucket.lastRefillAt;
        if (elapsed >= this.config.rateWindowMs) {
            this.bucket.tokens = this.config.rateMaxRequests;
            this.bucket.lastRefillAt = now;
        }
        if (this.bucket.tokens <= 0) {
            const retryAfterMs =
                this.config.rateWindowMs - elapsed;
            throw new RateLimitExceededError(this.id, Math.max(retryAfterMs, 0));
        }
        this.bucket.tokens -= 1;
    }

    private onSuccess(): void {
        this.circuit = { type: "closed", consecutiveFailures: 0 };
    }

    private onFailure(_err: unknown): void {
        if (this.circuit.type === "open") return;
        const next = this.circuit.consecutiveFailures + 1;
        if (next >= this.config.circuitFailureThreshold) {
            this.circuit = { type: "open", openedAt: Date.now() };
        } else {
            this.circuit = { type: "closed", consecutiveFailures: next };
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Helper do testow - reset stanu (rate / circuit). NIE uzywac w produkcji.
     */
    _resetStateForTests(): void {
        this.bucket = {
            tokens: this.config.rateMaxRequests,
            lastRefillAt: Date.now(),
        };
        this.circuit = { type: "closed", consecutiveFailures: 0 };
    }

    /**
     * Helper do testow - aktualny stan circuit (closed/open).
     */
    _circuitStateForTests(): "closed" | "open" {
        return this.circuit.type;
    }
}
