import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
// Rodzina Claude 5.5 (2026-10-08): id i ceny sprawdzone u zrodla - strona modeli i
// cennik Anthropic oraz katalog OpenRouter /api/v1/models (DON'T #13).
export const CLAUDE_MAIN_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4-mini"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-5-5"] as const;
export const GEMINI_MID_MODELS = ["gemini-3-flash-preview"] as const;
export const OPENAI_MID_MODELS = ["gpt-5.4-mini"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-5-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const OPENAI_LOW_MODELS = ["gpt-5.4-nano"] as const;

// Domyslne modele dla WSZYSTKICH zadan pomocniczych (glowny fallback, generowanie
// tytulu czatu, przeglad tabelaryczny). Celowo OpenRouter, nie chmura-direct:
// jeden klucz OPENROUTER_API_KEY Operatora pokrywa je wszystkie, wiec gdy mecenas
// wybierze dowolny model, KAZDA funkcja dziala na tym samym kluczu. Wczesniej byly
// to modele Gemini-direct (wlasny klucz Google) - bez tego klucza tytuly i tabela
// cicho padaly, mimo ze czat na OpenRouterze dzialal ("wybieram model, a czesc
// rzeczy nie dziala"). OpenRouter Gemini Flash = tani i szybki do zadan pomocniczych.
export const DEFAULT_MAIN_MODEL = "openrouter/google/gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "openrouter/google/gemini-3-flash-preview";
export const DEFAULT_TABULAR_MODEL = "openrouter/google/gemini-3-flash-preview";

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

/**
 * Wycofane z listy id natywne -> nastepca U TEGO SAMEGO dostawcy. Bez tego zapisany
 * wybor mecenasa (np. tabular_model "claude-sonnet-4-6") spadal na fallback - czyli
 * po cichu na INNEGO dostawce (domyslny model to Gemini przez OpenRouter), z inna
 * rezydencja danych. Lustro: LEGACY_MODEL_ALIASES we frontendzie (ModelToggle.tsx),
 * zgodnosc pilnuje models-mirror.test.ts. Id OpenRoutera przechodza bez aliasu
 * (resolveModel je przepuszcza, a stare slugi dzialaja w katalogu).
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
    "claude-opus-4-8": "claude-opus-5-5",
    "claude-opus-4-7": "claude-opus-5-5",
    "claude-sonnet-4-6": "claude-sonnet-5-5",
    "claude-haiku-4-5": "claude-haiku-5-5",
};

export function resolveModel(id: string | null | undefined, fallback: string): string {
    const naNastepce = id ? LEGACY_MODEL_ALIASES[id] ?? id : id;
    if (naNastepce && (ALL_MODELS.has(naNastepce) || isOpenRouterModel(naNastepce) || isOllamaModel(naNastepce)))
        return naNastepce;
    return fallback;
}
