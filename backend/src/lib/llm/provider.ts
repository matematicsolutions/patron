// Multi-provider LLM abstraction layer.
//
// Wprowadzony przez ADR-0014 (governance/adr/0014-multi-provider-abstraction-layer.md)
// jako operacjonalizacja Art. 4 Konstytucji v1.1.1 (Neutralnosc wobec dostawcow).
//
// T1: typy + interfejs + schema (ten plik + provider.schema.ts).
// T2-T6: implementacje providerow, router, integration audit, refactor call-sites.
//
// Status: koegzystuje z istniejacym `types.ts` (StreamChatParams etc.). Refactor
// istniejacych call-sites na nowy interfejs to T5 ADR-0014.
//
// Konwencje:
// - ProviderId uzywa "anthropic" (nazwa firmy), nie "claude" (nazwa modelu).
//   Mapping na istniejacy Provider type z types.ts robi router w T3.
// - Capability flags sa **read-only** - kazda implementacja providera deklaruje
//   capabilities raz przy konstrukcji, router czyta nie zmienia.
// - `Message` jest provider-agnostic - kazdy provider tlumaczy na natywny format
//   w swojej implementacji (anthropic content blocks vs gemini parts vs openai
//   messages vs ollama prompt).

/**
 * Identyfikator providera LLM. Stalo skonczony zbior - nowy provider wymaga
 * ADR + bumpa wersji typu (breaking change w router decision logic).
 */
export type ProviderId = "anthropic" | "gemini" | "ollama" | "openai";

/**
 * Klasyfikacja danych w request. Steruje decyzja routera czy provider o danym
 * egress flag moze obsluzyc request.
 *
 * - `public` - dane publiczne, brak ograniczenia egress
 * - `internal` - dane wewnetrzne kancelarii (nie-klientowe, np. szkolenia)
 * - `client_general` - dane klienta nie objete tajemnica zawodowa (np. dane
 *   kontaktowe, faktury)
 * - `attorney_client_privileged` - dane objete tajemnica zawodowa (Pr.Adw.
 *   art. 6, Pr.RP art. 3). Router zezwala TYLKO na provider z `egress:
 *   no-egress` (Ollama lokalny).
 */
export type DataClassification =
    | "public"
    | "internal"
    | "client_general"
    | "attorney_client_privileged";

/**
 * Egress flag providera - gdzie fizycznie ladzie request HTTP.
 *
 * - `no-egress` - ruch nie opuszcza serwera kancelarii (Ollama localhost)
 * - `eu-only` - provider gwarantuje EU region (Gemini Europe-region, DPF +
 *   DPA wymagane przed produkcja)
 * - `us-with-dpa` - provider US, wymagany DPA + DPF, kancelaria musi
 *   eksplicitnie zezwolic w `.env` (`ALLOW_US_PROVIDERS=true`)
 */
export type EgressFlag = "no-egress" | "eu-only" | "us-with-dpa";

/**
 * Capability flags providera. Router uzywa do filtrowania providerow
 * obslugujacych dany request.
 */
export type Capabilities = {
    readonly egress: EgressFlag;
    readonly toolCalling: boolean;
    readonly vision: boolean;
    readonly contextWindow: number;
    readonly structuredOutput: boolean;
    /** Czy provider wspiera streaming SSE/chunked response. */
    readonly streaming: boolean;
    /** Czy provider wspiera reasoning/thinking trace (np. Claude extended thinking). */
    readonly reasoning: boolean;
};

/**
 * Provider-agnostic message format. Kazdy provider tlumaczy na natywny format
 * w swojej implementacji.
 *
 * Pseudonim layer (ADR-0003) dziala PRZED routerem - `content` w momencie
 * dotarcia do providera musi byc juz zanonimizowane.
 */
export type Message = {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string;
    /** Dla `role: "tool"` - id wywolania tool z poprzedniej assistant message. */
    readonly toolCallId?: string;
};

/**
 * Definicja tool dostepnego dla LLM. Format kompatybilny z OpenAI function
 * calling, kazdy provider tlumaczy na natywny format.
 */
export type ToolDefinition = {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
};

/**
 * Zadanie wywolania tool zwrocone przez LLM.
 */
export type ToolCall = {
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
};

/**
 * Wymagane capabilities ktore router musi dopasowac.
 */
export type RequiredCapabilities = {
    readonly toolCalling?: boolean;
    readonly vision?: boolean;
    readonly structuredOutput?: boolean;
    readonly streaming?: boolean;
    readonly reasoning?: boolean;
    readonly minContextWindow?: number;
};

/**
 * Request do providera. Niezalezny od konkretnego providera.
 */
export type ChatRequest = {
    /** Model id w notacji providera (np. "claude-opus-4-7", "gemini-2.5-pro"). */
    readonly model: string;
    /** Systemowy prompt - wydzielony z messages dla providerow ktore tak wymagaja. */
    readonly systemPrompt?: string;
    readonly messages: readonly Message[];
    readonly tools?: readonly ToolDefinition[];
    /** Klasyfikacja danych. Router wymaga - default `internal` jezeli nie podany. */
    readonly dataClassification?: DataClassification;
    /** Wymagane capabilities. Router filtruje providerow. */
    readonly requiredCapabilities?: RequiredCapabilities;
    readonly maxTokens?: number;
    readonly temperature?: number;
    /** Wlaczenie reasoning trace gdzie provider wspiera (Claude extended thinking). */
    readonly enableThinking?: boolean;
    /**
     * Id sprawy z bazy. Wymagane dla `attorney_client_privileged`.
     * Trafia do audit log (ADR-0001 hash-chain).
     */
    readonly caseId?: string;
    /**
     * Id sesji pseudonim (ADR-0003). Wymagane gdy data classification powyzej
     * `public`. Trafia do audit log.
     */
    readonly pseudonimSessionId?: string;
};

/**
 * Response z providera. Niezalezny od konkretnego providera.
 */
export type ChatResponse = {
    readonly providerId: ProviderId;
    readonly model: string;
    readonly content: string;
    readonly toolCalls: readonly ToolCall[];
    readonly tokensIn: number;
    readonly tokensOut: number;
    /** Latency od wyslania requestu do otrzymania pelnej response (ms). */
    readonly latencyMs: number;
    /** Koszt rzeczywisty (po API call) w PLN. Liczony z `models.ts` cennika. */
    readonly costPln: number;
    /** Id audit eventu z hash-chain (ADR-0001). Wypelniane przez router po logu. */
    readonly auditEventId?: string;
    /**
     * Reasoning trace gdy `enableThinking: true` i provider wspiera.
     * Trzymane osobno bo audit log moze odfiltrowac trace (treść poufna).
     */
    readonly reasoning?: string;
};

/**
 * Chunk streamowanej response.
 */
export type ChatChunk =
    | { readonly type: "content"; readonly delta: string }
    | { readonly type: "reasoning"; readonly delta: string }
    | { readonly type: "reasoning_end" }
    | { readonly type: "tool_call_start"; readonly call: ToolCall }
    | { readonly type: "done"; readonly response: ChatResponse };

/**
 * Estymacja kosztu PRZED wywolaniem - liczona z dlugosci promptu + cennika
 * w `models.ts`. Pozwala kancelarii ustawic limity i alert na drogie calle.
 */
export type CostEstimate = {
    readonly providerId: ProviderId;
    readonly model: string;
    readonly tokensInEstimate: number;
    readonly tokensOutEstimate: number;
    readonly costPlnEstimate: number;
    /**
     * Marza estymacji - tokensOut nie znamy do wywolania, mnoznik
     * (default 4x tokensIn dla chat, 0.2x dla extraction).
     */
    readonly outputMultiplier: number;
};

/**
 * Interfejs providera LLM. Kazdy provider (Anthropic/Gemini/Ollama/OpenAI)
 * dziedziczy z `BaseProvider` (T2 ADR-0014) i implementuje 3 metody.
 *
 * Router (T3 ADR-0014) wybiera providera per request na podstawie:
 * 1. `req.dataClassification` -> filter po `capabilities.egress`
 * 2. `req.requiredCapabilities` -> filter po `capabilities.*`
 * 3. `LLM_PROVIDER` z .env -> primary
 * 4. `LLM_FALLBACK_CHAIN` z .env -> fallback gdy primary odmawia/down
 */
export interface LLMProvider {
    readonly id: ProviderId;
    readonly capabilities: Capabilities;

    /**
     * Synchroniczne wywolanie chat. Zwraca pelna response po zakonczeniu.
     */
    chat(req: ChatRequest): Promise<ChatResponse>;

    /**
     * Streamowane wywolanie chat. Iterator zwraca chunks az do `done`.
     */
    stream(req: ChatRequest): AsyncIterable<ChatChunk>;

    /**
     * Estymacja kosztu PRZED wywolaniem. Nie robi API call.
     */
    estimateCost(req: ChatRequest): CostEstimate;
}

/**
 * Decyzja routera dla requestu - ktory provider obsluguje + jaki fallback chain.
 * Trafia do audit log (ADR-0001) jako event `llm.router.decision`.
 */
export type RouterDecision = {
    readonly primary: ProviderId;
    readonly fallbackChain: readonly ProviderId[];
    readonly rejectedProviders: readonly {
        readonly providerId: ProviderId;
        readonly reason:
            | "egress_classification_mismatch"
            | "missing_capability"
            | "circuit_breaker_open"
            | "rate_limit_exceeded"
            | "cost_limit_exceeded";
    }[];
    readonly decisionMs: number;
};
