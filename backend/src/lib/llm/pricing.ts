// Statyczna tabela cen LLM dla panelu zuzycia i kosztow (ADR-0076).
//
// Realizuje czesc rezerwacji z ADR-0067 ("statyczna tabela cen"). Sluzy WYLACZNIE
// do estymacji kosztu, gdy dostawca nie zwrocil realnego kosztu (`cost_usd` w
// zdarzeniu llm_route jest `null` - np. Gemini / Claude / OpenAI bezposrednio,
// w odroznieniu od OpenRouter ktory podaje `usage.cost`).
//
// ZRODLO STAWKI IDZIE ZA SCIEZKA ROZLICZENIA. Tabela odpala sie przede wszystkim
// tam, gdzie mecenas placi dostawcy z WLASNEGO klucza, wiec stawka musi byc
// cennikiem TEGO dostawcy, nie posrednika. Stad dwie rodziny kluczy:
//   - id natywne ("claude-opus-5", "gpt-5.5")    -> cennik first-party dostawcy,
//   - id OpenRoutera ("openrouter/vendor/model") -> katalog OpenRoutera.
// Klucz OpenRoutera musi byc PELNY, bo jego slug ma kropki ("claude-opus-4.8"),
// a id natywne myslniki ("claude-opus-4-8") - dopasowanie po koncowym segmencie
// nigdy nie trafialo w te modele i wpadaly jako `unpriced` (naprawione 2026-08-26).
// Model spoza tabeli probuje jeszcze fallbacku po koncowym segmencie; brak
// trafienia = `unpriced`, czyli pokazujemy same tokeny, nigdy zmyslona kwote.
// Model lokalny (Ollama, np. Bielik) nie ma wpisu - `isLocalModel` daje koszt 0.
//
// Cennik sie starzeje - kazda pozycja niesie `source` + `asOf`, a koszt z tej
// tabeli jest ZAWSZE oznaczony jako szacowany (`estimated: true`). Realny koszt
// rozliczeniowy bierze sie z `cost_usd` zwroconego przez dostawce (OpenRouter).
// Aktualizacja (per-token * 1e6 = per-Mtok):
//   Claude     -> platform.claude.com/docs/en/about-claude/models/overview
//   Gemini     -> ai.google.dev/gemini-api/docs/pricing
//   GPT        -> developers.openai.com/api/docs/pricing
//   OpenRouter -> openrouter.ai/api/v1/models

import { OPENROUTER_PREFIX } from "./models";

const OLLAMA_PREFIXES = ["ollama/", "ollama:"];

export interface ModelPrice {
    /** USD za 1 mln tokenow wejsciowych (prompt). */
    inputPerMtokUsd: number;
    /** USD za 1 mln tokenow wyjsciowych (completion). */
    outputPerMtokUsd: number;
    /** Skad stawka (nazwa cennika / URL). */
    source: string;
    /** Data waznosci stawki (YYYY-MM-DD) - cennik sie starzeje. */
    asOf: string;
}

const ANTHROPIC = "platform.claude.com (cennik first-party)";
const GOOGLE = "ai.google.dev/gemini-api/docs/pricing";
const OPENAI = "developers.openai.com/api/docs/pricing";
const OR = "openrouter.ai/api/v1/models";
const AS_OF = "2026-08-26";

/**
 * Cennik per model (USD za 1 mln tokenow). Klucze to PELNE id modelu - zarowno
 * natywne z `models.ts`, jak i te z prefiksem `openrouter/` z pickera we
 * froncie. Tabela jest fallbackiem dla wywolan bez realnego `cost_usd`.
 */
export const PRICING: Readonly<Record<string, ModelPrice>> = {
    // --- Anthropic, wlasny klucz mecenasa (cennik first-party) ---
    "claude-opus-5": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: ANTHROPIC, asOf: AS_OF },
    "claude-sonnet-5": { inputPerMtokUsd: 2, outputPerMtokUsd: 10, source: ANTHROPIC, asOf: AS_OF },
    "claude-haiku-4-5": { inputPerMtokUsd: 1, outputPerMtokUsd: 5, source: ANTHROPIC, asOf: AS_OF },
    // Legacy - WYCOFANE Z PICKERA (ta sama stawka co 5.x za slabszy model), ale
    // wpis ZOSTAJE: panel kosztow wycenia takze stare zdarzenia llm_route, ktore
    // maja te id w bazie. Stawki z katalogu OpenRoutera (mirror first-party),
    // bo strona modeli Anthropic nie podaje juz stawek wycofywanych tierow.
    "claude-opus-4-8": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "claude-opus-4-7": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "claude-sonnet-4-6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15, source: OR, asOf: AS_OF },

    // --- Google, wlasny klucz mecenasa ---
    // Uwaga: stawka Pro dotyczy promptow <= 200k tokenow; powyzej Google liczy 4/18.
    "gemini-3.1-pro-preview": { inputPerMtokUsd: 2, outputPerMtokUsd: 12, source: GOOGLE, asOf: AS_OF },
    // UWAGA: 0.75/3.75 to cena promocyjna do 2026-12-31; od 2027-01-01 Google
    // podwaja ja do 1.5/7.5 - wtedy ten wiersz trzeba zaktualizowac.
    "gemini-3.7-flash": { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75, source: GOOGLE, asOf: AS_OF },
    "gemini-3-flash-preview": { inputPerMtokUsd: 0.5, outputPerMtokUsd: 3, source: GOOGLE, asOf: AS_OF },
    "gemini-3.1-flash-lite-preview": { inputPerMtokUsd: 0.25, outputPerMtokUsd: 1.5, source: GOOGLE, asOf: AS_OF },

    // --- OpenAI, wlasny klucz mecenasa ---
    "gpt-5.6-sol": { inputPerMtokUsd: 4, outputPerMtokUsd: 20, source: OPENAI, asOf: AS_OF },
    "gpt-5.6-terra": { inputPerMtokUsd: 2, outputPerMtokUsd: 12, source: OPENAI, asOf: AS_OF },
    "gpt-5.6-luna": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.2, source: OPENAI, asOf: AS_OF },
    // Legacy - wycofane z pickera (5.6 jest nowsze i tansze), wpisy zostaja dla
    // starych zdarzen llm_route. Stawka gpt-5.5 dotyczy kontekstu < 272k tokenow.
    "gpt-5.5": { inputPerMtokUsd: 5, outputPerMtokUsd: 30, source: OPENAI, asOf: AS_OF },
    "gpt-5.4-mini": { inputPerMtokUsd: 0.75, outputPerMtokUsd: 4.5, source: OPENAI, asOf: AS_OF },
    "gpt-5.4-nano": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.25, source: OPENAI, asOf: AS_OF },

    // --- OpenRouter (jeden klucz Operatora, slugi z kropkami) ---
    "openrouter/anthropic/claude-opus-5": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "openrouter/anthropic/claude-sonnet-5": { inputPerMtokUsd: 2, outputPerMtokUsd: 10, source: OR, asOf: AS_OF },
    "openrouter/anthropic/claude-opus-4.8": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "openrouter/anthropic/claude-opus-4.7": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "openrouter/anthropic/claude-sonnet-4.6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15, source: OR, asOf: AS_OF },
    "openrouter/anthropic/claude-haiku-4.5": { inputPerMtokUsd: 1, outputPerMtokUsd: 5, source: OR, asOf: AS_OF },
    "openrouter/google/gemini-3.1-pro-preview": { inputPerMtokUsd: 2, outputPerMtokUsd: 12, source: OR, asOf: AS_OF },
    "openrouter/google/gemini-3.7-flash": { inputPerMtokUsd: 0.375, outputPerMtokUsd: 1.875, source: OR, asOf: AS_OF },
    "openrouter/google/gemini-3-flash-preview": { inputPerMtokUsd: 0.5, outputPerMtokUsd: 3, source: OR, asOf: AS_OF },
    "openrouter/google/gemini-3.1-flash-lite-preview": { inputPerMtokUsd: 0.25, outputPerMtokUsd: 1.5, source: OR, asOf: AS_OF },
    // UWAGA: OpenRouter wycenia Sol na 2/10, a cennik OpenAI na 4/20 - roznica x2
    // miedzy sciezkami jest PRAWDZIWA, nie literowka. Nie "poprawiac" jednej do drugiej.
    "openrouter/openai/gpt-5.6-sol": { inputPerMtokUsd: 2, outputPerMtokUsd: 10, source: OR, asOf: AS_OF },
    "openrouter/openai/gpt-5.6-terra": { inputPerMtokUsd: 2, outputPerMtokUsd: 12, source: OR, asOf: AS_OF },
    "openrouter/openai/gpt-5.6-luna": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.2, source: OR, asOf: AS_OF },
    "openrouter/openai/gpt-5.5": { inputPerMtokUsd: 5, outputPerMtokUsd: 30, source: OR, asOf: AS_OF },
    "openrouter/openai/gpt-5.4-mini": { inputPerMtokUsd: 0.75, outputPerMtokUsd: 4.5, source: OR, asOf: AS_OF },
    "openrouter/openai/gpt-5.4-nano": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.25, source: OR, asOf: AS_OF },
    "openrouter/qwen/qwen3.6-flash": { inputPerMtokUsd: 0.1875, outputPerMtokUsd: 1.125, source: OR, asOf: AS_OF },
    "openrouter/mistralai/mistral-medium-3-5": { inputPerMtokUsd: 1.5, outputPerMtokUsd: 7.5, source: OR, asOf: AS_OF },
};

/** Czy model dziala lokalnie (Ollama) - koszt API = 0, brak egress. */
export function isLocalModel(model: string): boolean {
    return OLLAMA_PREFIXES.some((p) => model.startsWith(p));
}

/**
 * Normalizuje id modelu do klucza cennika. Najpierw dokladne trafienie w pelne
 * id (obie rodziny kluczy - natywna i `openrouter/...`), a dopiero potem, dla
 * modelu OpenRoutera spoza tabeli, fallback po koncowym segmencie sluga.
 */
function pricingKey(model: string): string {
    if (PRICING[model]) return model;
    if (model.startsWith(OPENROUTER_PREFIX)) {
        const tail = model.slice(OPENROUTER_PREFIX.length);
        const seg = tail.includes("/") ? tail.slice(tail.lastIndexOf("/") + 1) : tail;
        return seg;
    }
    return model;
}

export interface CostResolution {
    /** Koszt w USD albo `null` gdy nieznany (model bez ceny). */
    costUsd: number | null;
    /** `true` gdy koszt policzony z tabeli cen, `false` gdy realny z dostawcy. */
    estimated: boolean;
    /** `true` gdy model spoza cennika i bez realnego kosztu (pokazujemy same tokeny). */
    unpriced: boolean;
}

/**
 * Rozstrzyga koszt wywolania wg reguly z ADR-0076 sekcja B:
 *   1. realny `cost_usd` z dostawcy istnieje -> REALNY (estimated=false).
 *   2. model lokalny (Ollama) -> 0 (brak oplaty API).
 *   3. model w cenniku -> SZACOWANY z tokenow.
 *   4. inaczej -> null, unpriced (same tokeny).
 */
export function resolveCost(
    model: string,
    promptTokens: number | null | undefined,
    completionTokens: number | null | undefined,
    realCostUsd: number | null | undefined,
): CostResolution {
    if (realCostUsd !== null && realCostUsd !== undefined) {
        return { costUsd: realCostUsd, estimated: false, unpriced: false };
    }
    if (isLocalModel(model)) {
        return { costUsd: 0, estimated: true, unpriced: false };
    }
    const price = PRICING[pricingKey(model)];
    if (!price) {
        return { costUsd: null, estimated: true, unpriced: true };
    }
    // "Brak pomiaru" to NIE jest "zero tokenow". Bez tego rozroznienia model
    // z cennika liczyl 0 x cena = 0,00 USD i ustawial unpriced=false, wiec licznik
    // nierozliczonych - istniejacy dokladnie po to - pokazywal 0 (zmierzone
    // 2026-08-21: 5 realnych wywolan Gemini, panel kosztu "0,00 USD, 0 nierozliczonych").
    if (
        (promptTokens === null || promptTokens === undefined) &&
        (completionTokens === null || completionTokens === undefined)
    ) {
        return { costUsd: null, estimated: true, unpriced: true };
    }
    const inTok = promptTokens ?? 0;
    const outTok = completionTokens ?? 0;
    const costUsd =
        (inTok / 1_000_000) * price.inputPerMtokUsd +
        (outTok / 1_000_000) * price.outputPerMtokUsd;
    return { costUsd, estimated: true, unpriced: false };
}
