import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/patronApi";

export type ModelProvider = "claude" | "gemini" | "openai";

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
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    return "gemini";
}
