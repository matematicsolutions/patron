import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/patronApi";

export type ModelProvider = "claude" | "gemini" | "openai" | "openrouter";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return modelGroupToProvider(model.group);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
): boolean {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return false;
    // Lokalny (Ollama) = lokalnie; OpenRouter = jeden klucz env Operatora.
    // Nie bramkujemy ich statusem per-provider (claude/gemini/openai).
    if (model.group === "Lokalny" || model.group === "OpenRouter") return true;
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    // OpenRouter (ADR-0092): klucz jest w env backendu (OPENROUTER_API_KEY), nie
    // per-user w DB jak claude/gemini/openai. Front nie zna stanu env, wiec w v1
    // traktujemy modele OpenRouter jako wybieralne; faktyczna autoryzacja i
    // data-residency (egress=us-with-dpa, blok danych uprzywilejowanych) egzekwuje
    // backend przez decideRoute. Brak klucza env -> czytelny blad po stronie serwera.
    if (provider === "openrouter") return true;
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    if (provider === "openrouter") return "OpenRouter";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    if (group === "OpenRouter") return "openrouter";
    return "gemini";
}
