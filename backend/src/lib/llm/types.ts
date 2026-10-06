// Shared types for the LLM provider adapter.
// Callers always speak OpenAI-style tools + { role, content } messages; each
// provider translates internally.

export type Provider = "claude" | "gemini" | "openai" | "openrouter";

export type OpenAIToolSchema = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type LlmMessage = {
    role: "user" | "assistant";
    content: string;
};

export type NormalizedToolCall = {
    id: string;
    name: string;
    input: Record<string, unknown>;
    /**
     * Model podal argumenty, ktore nie sa obiektem JSON. `input` jest wtedy
     * pusty, a narzedzia NIE wolno uruchomic z `{}` - petla czatu oddaje
     * modelowi blad, zeby poprawil wywolanie.
     */
    argumentsInvalid?: boolean;
};

export type NormalizedToolResult = {
    tool_use_id: string;
    content: string;
};

export type StreamCallbacks = {
    onReasoningDelta?: (text: string) => void;
    onReasoningBlockEnd?: () => void;
    onContentDelta?: (text: string) => void;
    onToolCallStart?: (call: NormalizedToolCall) => void;
};

export type UserApiKeys = {
    claude?: string | null;
    gemini?: string | null;
    openai?: string | null;
    openrouter?: string | null;
};

export type StreamChatParams = {
    model: string;
    systemPrompt: string;
    messages: LlmMessage[];
    tools?: OpenAIToolSchema[];
    maxIterations?: number;
    callbacks?: StreamCallbacks;
    runTools?: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>;
    apiKeys?: UserApiKeys;
    /**
     * Enable provider-side reasoning/thinking. Off by default — should only
     * be turned on for interactive chat surfaces where the user actually
     * benefits from seeing the thought stream. Bulk extraction jobs and
     * one-shot completions should leave this off to save tokens and latency.
     */
    enableThinking?: boolean;
};

/**
 * Dlaczego petla modelu sie skonczyla. `complete` = model sam zakonczyl ture.
 * `max_iterations` = wyczerpany limit petli narzedziowej (model chcial dalej).
 * `max_tokens` = odpowiedz ucieta limitem dlugosci. Oba ostatnie znacza, ze
 * odpowiedz jest NIEPELNA - nie wolno jej pokazac ani zaudytowac jak pelnej.
 */
export type StopReason = "complete" | "max_iterations" | "max_tokens";

export type StreamChatResult = {
    fullText: string;
    /** undefined = dostawca nie raportuje powodu (Ollama) - stan nieznany, nie "complete". */
    stopReason?: StopReason;
    /**
     * Realne zuzycie zwrocone przez dostawce, gdy dostepne. OpenRouter zwraca
     * tokeny + realny koszt (usage.cost). Pozostali dostawcy zwykle nie podaja
     * kosztu - wtedy pole jest undefined i audyt oznacza koszt jako szacunkowy
     * (ADR-0067). Patrz lib/routing/auditLlmRoute.ts.
     */
    usage?: {
        promptTokens?: number | null;
        completionTokens?: number | null;
        /** Realny koszt w USD z odpowiedzi dostawcy. */
        costUsd?: number | null;
    };
};
