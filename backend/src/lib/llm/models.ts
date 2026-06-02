import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4-mini"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = ["gemini-3-flash-preview"] as const;
export const OPENAI_MID_MODELS = ["gpt-5.4-mini"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const OPENAI_LOW_MODELS = ["gpt-5.4-nano"] as const;

export const DEFAULT_MAIN_MODEL = "gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3-flash-preview";

const ALL_MODELS = new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...OPENAI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...OPENAI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
    ...OPENAI_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

// OpenRouter (ADR-0059): modele oznaczane prefiksem "openrouter/", po ktorym
// nastepuje natywny id OpenRoutera "vendor/model" (np.
// "openrouter/anthropic/claude-3.7-sonnet", "openrouter/speakleash/bielik-11b").
// Jeden klucz OPENROUTER_API_KEY -> wszystkie modele. Prefiks jednoznacznie
// odroznia je od kanonicznych modeli natywnych (te nie maja "/").
export const OPENROUTER_PREFIX = "openrouter/";

export function isOpenRouterModel(model: string): boolean {
    return model.startsWith(OPENROUTER_PREFIX);
}

/** Zdejmuje prefiks "openrouter/" -> natywny id OpenRoutera "vendor/model". */
export function openRouterModelId(model: string): string {
    return model.startsWith(OPENROUTER_PREFIX)
        ? model.slice(OPENROUTER_PREFIX.length)
        : model;
}

// Ollama (lokalna inferencja, ADR-0014 T2): modele oznaczane prefiksem
// "ollama/", po ktorym nastepuje natywny id Ollama "model:tag" (np.
// "ollama/llama3.3:70b"). Prefiks odroznia je od kanonicznych modeli chmurowych
// i jest jedynym sygnalem egress=no-egress (patrz routing/egress.ts). Jedno
// zrodlo prawdy tutaj - egress.ts re-eksportuje, analogicznie do OPENROUTER_PREFIX.
export const OLLAMA_PREFIX = "ollama/";

export function isOllamaModel(model: string): boolean {
    return model.startsWith(OLLAMA_PREFIX);
}

export function providerForModel(model: string): Provider {
    if (isOpenRouterModel(model)) return "openrouter";
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    // Ollama (no-egress) NIE jest w unii `Provider` warstwy funkcyjnej - jest
    // dispatchowany wczesniej w llm/index.ts (completeText/streamChatWithTools)
    // przez isOllamaModel. Jezeli ollama/* tu dotarl, to omieto ten guard.
    throw new Error(`Unknown model id: ${model}`);
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && (ALL_MODELS.has(id) || isOpenRouterModel(id) || isOllamaModel(id)))
        return id;
    return fallback;
}
