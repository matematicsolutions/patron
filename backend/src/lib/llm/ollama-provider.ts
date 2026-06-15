// Ollama provider - lokalna inferencja LLM z `egress: no-egress` (ADR-0014 T2).
//
// Pierwsza konkretna implementacja LLMProvider. Lokalna z definicji - HTTP do
// `OLLAMA_HOST` (default `http://localhost:11434`). Cost zawsze 0 (energia
// elektryczna nie liczymy, infrastruktura sprzetowa = CapEx kancelarii).
//
// Kluczowy provider dla danych `attorney_client_privileged` - router dla tej
// klasyfikacji moze wybrac TYLKO providera z `egress: no-egress`, czyli
// Ollama. Bez Ollama Patron nie obsluguje tajemnicy zawodowej (Art. 5
// Konstytucji v1.1.1).
//
// Konwencja modeli: id Ollama zwykle "model:tag" (np. "llama3.3:70b",
// "qwen2.5:32b"). Patron normalizuje do prefix "ollama/" w ChatRequest.model
// (np. "ollama/llama3.3:70b") zeby router latwo rozroznial od cloud modeli.

import { BaseProvider, ProviderTransientError, type BaseProviderConfig } from "./base-provider";
import type {
    Capabilities,
    ChatChunk,
    ChatRequest,
    ChatResponse,
    CostEstimate,
    Message,
    ProviderId,
} from "./provider";

/**
 * Konfiguracja Ollama poza wspolnymi flagami `BaseProviderConfig`.
 */
export type OllamaProviderConfig = {
    /** Base URL serwera Ollama. Default `http://localhost:11434`. */
    readonly baseUrl?: string;
    /** Override capability flags (np. wlaczenie tool calling dla nowszych modeli). */
    readonly capabilitiesOverride?: Partial<Capabilities>;
    /** Override fetch dla testow. Default `globalThis.fetch`. */
    readonly fetchImpl?: typeof fetch;
    /** Funkcja czasu - dla deterministycznych testow latency. */
    readonly nowMs?: () => number;
    /** Maksymalna liczba requestow w `rateWindowMs`. Default 60. */
    readonly rateMaxRequests?: number;
    /** Default 60_000ms (1 minuta). */
    readonly rateWindowMs?: number;
    /** Default 120_000ms (2 minuty - Ollama lokalna moze byc wolna na duzych modelach). */
    readonly requestTimeoutMs?: number;
    /** Default 5 (failures przed circuit open). */
    readonly circuitFailureThreshold?: number;
    /** Default 60_000ms. */
    readonly circuitOpenDurationMs?: number;
};

const DEFAULT_CAPABILITIES: Capabilities = {
    egress: "no-egress",
    toolCalling: false,
    vision: false,
    contextWindow: 32_000,
    structuredOutput: false,
    streaming: true,
    reasoning: false,
};

const DEFAULT_BASE_URL = "http://localhost:11434";

const OLLAMA_PROVIDER_ID: ProviderId = "ollama";

/**
 * Response z `POST /api/chat` Ollama (non-stream).
 * https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request-no-streaming
 */
type OllamaChatResponse = {
    model: string;
    message: { role: string; content: string };
    done: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number; // nanoseconds
};

/**
 * Chunk SSE-like z streaming `/api/chat` Ollama.
 */
type OllamaStreamChunk = {
    model: string;
    message?: { role: string; content: string };
    done: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
};

export class OllamaProvider extends BaseProvider {
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly nowMs: () => number;

    constructor(config: OllamaProviderConfig = {}) {
        const capabilities: Capabilities = {
            ...DEFAULT_CAPABILITIES,
            ...config.capabilitiesOverride,
        };
        const base: BaseProviderConfig = {
            id: OLLAMA_PROVIDER_ID,
            capabilities,
            rateMaxRequests: config.rateMaxRequests ?? 60,
            rateWindowMs: config.rateWindowMs ?? 60_000,
            requestTimeoutMs: config.requestTimeoutMs ?? 120_000,
            circuitFailureThreshold: config.circuitFailureThreshold ?? 5,
            circuitOpenDurationMs: config.circuitOpenDurationMs ?? 60_000,
        };
        super(base);
        this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
        this.nowMs = config.nowMs ?? Date.now;
    }

    estimateCost(req: ChatRequest): CostEstimate {
        const tokensIn = estimateTokensIn(req);
        return {
            providerId: OLLAMA_PROVIDER_ID,
            model: req.model,
            tokensInEstimate: tokensIn,
            tokensOutEstimate: Math.round(tokensIn * 4),
            costPlnEstimate: 0,
            outputMultiplier: 4,
        };
    }

    protected async doChat(req: ChatRequest): Promise<ChatResponse> {
        const startedAt = this.nowMs();
        const url = `${this.baseUrl}/api/chat`;
        const body = {
            model: stripOllamaPrefix(req.model),
            messages: toOllamaMessages(req),
            stream: false,
            options: buildOptions(req),
        };

        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
        } catch (err) {
            throw new ProviderTransientError(
                OLLAMA_PROVIDER_ID,
                `network error: ${describeError(err)}`,
                err,
            );
        }

        if (!response.ok) {
            const txt = await safeReadText(response);
            if (isRetryableStatus(response.status)) {
                throw new ProviderTransientError(
                    OLLAMA_PROVIDER_ID,
                    `HTTP ${response.status} ${txt}`,
                    null,
                );
            }
            throw new Error(`Ollama HTTP ${response.status}: ${txt}`);
        }

        const data = (await response.json()) as OllamaChatResponse;
        const latencyMs = this.nowMs() - startedAt;
        return {
            providerId: OLLAMA_PROVIDER_ID,
            model: data.model,
            content: data.message?.content ?? "",
            toolCalls: [],
            tokensIn: data.prompt_eval_count ?? 0,
            tokensOut: data.eval_count ?? 0,
            latencyMs,
            costPln: 0,
        };
    }

    protected async *doStream(req: ChatRequest): AsyncIterable<ChatChunk> {
        const startedAt = this.nowMs();
        const url = `${this.baseUrl}/api/chat`;
        const body = {
            model: stripOllamaPrefix(req.model),
            messages: toOllamaMessages(req),
            stream: true,
            options: buildOptions(req),
        };

        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
        } catch (err) {
            throw new ProviderTransientError(
                OLLAMA_PROVIDER_ID,
                `network error: ${describeError(err)}`,
                err,
            );
        }

        if (!response.ok) {
            const txt = await safeReadText(response);
            if (isRetryableStatus(response.status)) {
                throw new ProviderTransientError(
                    OLLAMA_PROVIDER_ID,
                    `HTTP ${response.status} ${txt}`,
                    null,
                );
            }
            throw new Error(`Ollama HTTP ${response.status}: ${txt}`);
        }

        if (!response.body) {
            throw new Error("Ollama streaming response has no body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let totalContent = "";
        let tokensIn = 0;
        let tokensOut = 0;
        let modelEcho = stripOllamaPrefix(req.model);

        try {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const chunk = JSON.parse(line) as OllamaStreamChunk;
                    modelEcho = chunk.model || modelEcho;
                    if (chunk.message?.content) {
                        totalContent += chunk.message.content;
                        yield { type: "content", delta: chunk.message.content };
                    }
                    if (chunk.done) {
                        tokensIn = chunk.prompt_eval_count ?? tokensIn;
                        tokensOut = chunk.eval_count ?? tokensOut;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        const latencyMs = this.nowMs() - startedAt;
        const response_: ChatResponse = {
            providerId: OLLAMA_PROVIDER_ID,
            model: modelEcho,
            content: totalContent,
            toolCalls: [],
            tokensIn,
            tokensOut,
            latencyMs,
            costPln: 0,
        };
        yield { type: "done", response: response_ };
    }
}

// ---------------------------------------------------------------------------
// Pomocnicze (czyste funkcje, latwo testowalne)
// ---------------------------------------------------------------------------

export function stripOllamaPrefix(model: string): string {
    return model.startsWith("ollama/") ? model.slice("ollama/".length) : model;
}

export function toOllamaMessages(req: ChatRequest): readonly {
    role: string;
    content: string;
}[] {
    const messages: { role: string; content: string }[] = [];
    if (req.systemPrompt) {
        messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
        // Ollama (od v0.5) wspiera role "tool"; dla starszych downgrade do "user".
        const role = m.role === "tool" ? "tool" : m.role;
        messages.push({ role, content: m.content });
    }
    return messages;
}

export function buildOptions(req: ChatRequest): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) opts.num_predict = req.maxTokens;
    if (req.temperature !== undefined) opts.temperature = req.temperature;
    return opts;
}

/**
 * Bardzo zgrubna estymacja - 1 token ~ 4 znaki dla angielskiego, ~ 3 znaki dla
 * polskiego (wiecej diakrytykow). Patron uzywa konserwatywnie 3 znaki/token.
 * Ostateczne liczby z Ollama (`prompt_eval_count`) sa dokladne.
 */
export function estimateTokensIn(req: ChatRequest): number {
    const systemLen = req.systemPrompt?.length ?? 0;
    const messagesLen = req.messages.reduce(
        (acc, m) => acc + m.content.length,
        0,
    );
    const toolsLen = (req.tools ?? []).reduce(
        (acc, t) => acc + t.name.length + t.description.length + JSON.stringify(t.parameters).length,
        0,
    );
    return Math.ceil((systemLen + messagesLen + toolsLen) / 3);
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
}

async function safeReadText(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return "<unreadable body>";
    }
}

function describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

// Re-export typow do uzytku w testach.
export type { Message };
