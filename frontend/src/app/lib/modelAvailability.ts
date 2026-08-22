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
    // Lokalny (Ollama) dziala bez klucza - model stoi na maszynie mecenasa.
    // OpenRouter JEST bramkowany jak kazdy inny dostawca (patrz nizej).
    if (model.group === "Lokalny") return true;
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    // OpenRouter (ADR-0092) byl tu do 2026-08-22 traktowany jako ZAWSZE dostepny,
    // bo "front nie zna stanu env". To juz nieprawda: `getUserApiKeyStatus`
    // raportuje openrouter razem ze zrodlem ("env" gdy klucz Operatora, "user"
    // gdy mecenas wkleil swoj). Stary wyjatek kosztowal najgorszy mozliwy
    // pierwszy kontakt z produktem: DOMYSLNYM modelem na czystej instalacji jest
    // model OpenRouter, wiec bez klucza aplikacja wygladala na gotowa, a pierwsze
    // pytanie konczylo sie techniczna angielska awaria z backendu zamiast
    // prosba o klucz. Bramkujemy jak kazdego innego dostawce - modal "Dodaj
    // klucz" z linkiem do ustawien zapala sie PRZED wyslaniem.
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
