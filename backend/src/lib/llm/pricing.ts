// Statyczna tabela cen LLM dla panelu zuzycia i kosztow (ADR-0076).
//
// Realizuje czesc rezerwacji z ADR-0067 ("statyczna tabela cen"). Sluzy WYLACZNIE
// do estymacji kosztu, gdy dostawca nie zwrocil realnego kosztu (`cost_usd` w
// zdarzeniu llm_route jest `null` - np. Gemini / Claude / OpenAI bezposrednio,
// w odroznieniu od OpenRouter ktory podaje `usage.cost`).
//
// Stawki pochodza z publicznego katalogu OpenRouter (/api/v1/models) z dnia
// `asOf` - dane publiczne, bez danych klienta. Dla modeli bez dokladnego id w
// katalogu uzyto najblizszego tieru (oznaczone w `source`). Cennik sie starzeje -
// kazda pozycja niesie `source` + `asOf`, a koszt z tej tabeli jest ZAWSZE
// oznaczony jako szacowany (`estimated: true`). Realny koszt rozliczeniowy bierze
// sie z `cost_usd` zwroconego przez dostawce (OpenRouter) - tabela to fallback.
// Aktualizacja: pobierz /api/v1/models i przelicz per-token * 1e6 = per-Mtok.

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

const OR = "openrouter.ai/api/v1/models";
const OR_TIER = "openrouter.ai (najblizszy tier)";
const AS_OF = "2026-05-30";

/**
 * Cennik per model (USD za 1 mln tokenow). Klucze to pelne id modelu z
 * `models.ts`. Stawki z katalogu OpenRouter (per-token * 1e6). Tabela jest
 * fallbackiem dla wywolan bez realnego `cost_usd` od dostawcy.
 */
export const PRICING: Readonly<Record<string, ModelPrice>> = {
    // Dokladne dopasowanie id w katalogu OpenRouter.
    "claude-opus-4-8": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "claude-opus-4-7": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "gpt-5.5": { inputPerMtokUsd: 5, outputPerMtokUsd: 30, source: OR, asOf: AS_OF },
    "gpt-5.4-mini": { inputPerMtokUsd: 0.75, outputPerMtokUsd: 4.5, source: OR, asOf: AS_OF },
    "gpt-5.4-nano": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.25, source: OR, asOf: AS_OF },
    "gemini-3.1-flash-lite-preview": { inputPerMtokUsd: 0.25, outputPerMtokUsd: 1.5, source: OR, asOf: AS_OF },
    // Brak dokladnego id - najblizszy tier dostawcy (przyblizenie).
    "claude-sonnet-4-6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15, source: OR_TIER, asOf: AS_OF },
    "claude-haiku-4-5": { inputPerMtokUsd: 1, outputPerMtokUsd: 5, source: OR_TIER, asOf: AS_OF },
    "gemini-3-flash-preview": { inputPerMtokUsd: 1.5, outputPerMtokUsd: 9, source: OR_TIER, asOf: AS_OF },
};

/** Czy model dziala lokalnie (Ollama) - koszt API = 0, brak egress. */
export function isLocalModel(model: string): boolean {
    return OLLAMA_PREFIXES.some((p) => model.startsWith(p));
}

/**
 * Normalizuje id modelu do klucza cennika. OpenRouter routuje pod prefiksem
 * (np. "openrouter/anthropic/claude-sonnet-4-6") - dla fallbacku probujemy
 * dopasowac koncowy segment do tabeli.
 */
function pricingKey(model: string): string {
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
    const inTok = promptTokens ?? 0;
    const outTok = completionTokens ?? 0;
    const costUsd =
        (inTok / 1_000_000) * price.inputPerMtokUsd +
        (outTok / 1_000_000) * price.outputPerMtokUsd;
    return { costUsd, estimated: true, unpriced: false };
}
