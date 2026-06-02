// Funkcyjny adapter Ollama dla warstwy llm/index.ts (completeText / streamChatWithTools).
//
// Reuzywa OllamaProvider (klasa BaseProvider z ADR-0014 T2: retry/backoff,
// circuit breaker, timeout, rate limit), tlumaczac miedzy interfejsem funkcyjnym
// (StreamChat* / OpenAI-style, types.ts) a ChatRequest/ChatChunk (provider.ts).
//
// Bez tego adaptera modele ollama/* spadaja na providerForModel -> throw
// "Unknown model id"; wczesniej maskowal to resolveModel, przekierowujac je na
// DEFAULT_MAIN_MODEL (gemini, chmura US!) - czyli lokalna inferencja "no-egress"
// nie dzialala, a straznik egress blokowal /draft/refine mimo wyboru Ollamy.
// Patrz egress.ts (ollama/* = no-egress) i resolveModel (przepuszcza ollama/*).

import { OllamaProvider } from "./ollama-provider";
import type { ChatRequest, Message } from "./provider";
import type { StreamChatParams, StreamChatResult } from "./types";

// Hosty metadata chmury - klasyczny cel SSRF (kradziez kredencjali instancji).
// Blokujemy je twardo. NIE blokujemy RFC1918/loopback: zdalna Ollama w sieci
// LAN kancelarii to legalny scenariusz (patrz docstring ollamaProvider).
const SSRF_BLOCKED_HOSTS = new Set([
    "169.254.169.254", // AWS / Azure / GCP IMDS
    "169.254.170.2", // ECS task metadata
    "100.100.100.200", // Alibaba Cloud
    "metadata.google.internal",
    "metadata.goog",
]);

/**
 * Waliduje OLLAMA_HOST przed uzyciem. Fail-loud (rzuca) gdy: protokol inny niz
 * http(s), host = endpoint metadata chmury, lub zakres link-local 169.254/16.
 * Defense-in-depth wobec SSRF: gdyby atakujacy przejal env/konfiguracje, nie
 * przekieruje wywolan LLM (z trescia pisma) na endpoint metadata.
 */
export function validateOllamaHost(raw: string): string {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        throw new Error(
            `OLLAMA_HOST nieprawidlowy URL: ${raw}. Oczekiwano np. http://localhost:11434.`,
        );
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error(
            `OLLAMA_HOST: niedozwolony protokol ${u.protocol} (tylko http/https).`,
        );
    }
    const host = u.hostname.toLowerCase();
    if (SSRF_BLOCKED_HOSTS.has(host) || host.startsWith("169.254.")) {
        throw new Error(
            `OLLAMA_HOST: zablokowany adres metadata/link-local (${host}) - ochrona SSRF.`,
        );
    }
    return raw;
}

/**
 * Buduje providera Ollama. Host z OLLAMA_HOST (np. zdalna instancja w sieci
 * kancelarii); default localhost:11434 wewnatrz OllamaProvider.
 */
function ollamaProvider(): OllamaProvider {
    const raw = process.env.OLLAMA_HOST?.trim();
    const baseUrl = raw ? validateOllamaHost(raw) : undefined;
    return new OllamaProvider(baseUrl ? { baseUrl } : {});
}

/** Mapuje wiadomosci funkcyjne (user/assistant) na provider-agnostic Message. */
function toMessages(messages: StreamChatParams["messages"]): readonly Message[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Jednorazowe uzupelnienie (non-stream) - odpowiednik completeGeminiText itd.
 * Uzywane m.in. przez pipeline obrony (/draft/refine) i tytulowanie czatu.
 */
export async function completeOllamaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
}): Promise<string> {
    const provider = ollamaProvider();
    const req: ChatRequest = {
        model: params.model,
        systemPrompt: params.systemPrompt,
        messages: [{ role: "user", content: params.user }],
        maxTokens: params.maxTokens,
    };
    const res = await provider.chat(req);
    return res.content;
}

/**
 * Streamowany czat. Ollama (w tej implementacji) nie wspiera tool callingu
 * (capabilities.toolCalling = false) - `tools`/`runTools` sa ignorowane, model
 * lokalny odpowiada tekstem. To akceptowalna degradacja dla trybu no-egress.
 */
export async function streamOllama(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = ollamaProvider();
    const req: ChatRequest = {
        model: params.model,
        systemPrompt: params.systemPrompt,
        messages: toMessages(params.messages),
    };
    let fullText = "";
    let usage: StreamChatResult["usage"];
    for await (const chunk of provider.stream(req)) {
        if (chunk.type === "content") {
            fullText += chunk.delta;
            params.callbacks?.onContentDelta?.(chunk.delta);
        } else if (chunk.type === "done") {
            usage = {
                promptTokens: chunk.response.tokensIn,
                completionTokens: chunk.response.tokensOut,
            };
        }
    }
    return { fullText, usage };
}
