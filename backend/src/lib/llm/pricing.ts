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
    /**
     * Cena progowa: gdy zapytanie ma WIECEJ tokenow wejsciowych niz `powyzejTokenowWejscia`,
     * cale wywolanie liczy sie po tych stawkach (tak rozlicza np. Claude Haiku 5.5).
     */
    prog?: { powyzejTokenowWejscia: number; inputPerMtokUsd: number; outputPerMtokUsd: number };
}

const OR = "openrouter.ai/api/v1/models";
const OR_TIER = "openrouter.ai (najblizszy tier)";
const AS_OF = "2026-05-30";
// 2026-10-08: rodzina Claude 5.5 z cennika Anthropic (stawki bazowe, NIE tryb "fast")
// i korekty z katalogu OpenRouter z tego dnia.
const ANTHROPIC = "platform.claude.com/docs/en/about-claude/pricing";
const AS_OF_1008 = "2026-10-08";
const HAIKU_55: ModelPrice = {
    inputPerMtokUsd: 0.1, outputPerMtokUsd: 0.5, source: ANTHROPIC, asOf: AS_OF_1008,
    prog: { powyzejTokenowWejscia: 100_000, inputPerMtokUsd: 0.5, outputPerMtokUsd: 2.5 },
};

/**
 * Cennik per model (USD za 1 mln tokenow). Klucze to pelne id modelu z
 * `models.ts`. Stawki z katalogu OpenRouter (per-token * 1e6). Tabela jest
 * fallbackiem dla wywolan bez realnego `cost_usd` od dostawcy.
 */
export const PRICING: Readonly<Record<string, ModelPrice>> = {
    // Claude 5.5 - id natywne (myslniki) i ogon sluga OpenRoutera (kropki): pricingKey
    // nie normalizuje kropek do myslnikow (to psuloby "gpt-5.5"), wiec oba klucze.
    "claude-opus-5-5": { inputPerMtokUsd: 4, outputPerMtokUsd: 20, source: ANTHROPIC, asOf: AS_OF_1008 },
    "claude-opus-5.5": { inputPerMtokUsd: 4, outputPerMtokUsd: 20, source: OR, asOf: AS_OF_1008 },
    "claude-sonnet-5-5": { inputPerMtokUsd: 2, outputPerMtokUsd: 10, source: ANTHROPIC, asOf: AS_OF_1008 },
    "claude-sonnet-5.5": { inputPerMtokUsd: 2, outputPerMtokUsd: 10, source: OR, asOf: AS_OF_1008 },
    "claude-haiku-5-5": HAIKU_55,
    "claude-haiku-5.5": { ...HAIKU_55, source: OR },
    // Starsze slugi OpenRoutera - historia zuzycia sprzed odswiezenia listy.
    "claude-opus-4.8": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF_1008 },
    "claude-sonnet-4.6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15, source: OR, asOf: AS_OF_1008 },
    "gemini-3.1-pro-preview": { inputPerMtokUsd: 2, outputPerMtokUsd: 12, source: OR, asOf: AS_OF_1008 },
    // Dokladne dopasowanie id w katalogu OpenRouter.
    "claude-opus-4-8": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "claude-opus-4-7": { inputPerMtokUsd: 5, outputPerMtokUsd: 25, source: OR, asOf: AS_OF },
    "gpt-5.5": { inputPerMtokUsd: 5, outputPerMtokUsd: 30, source: OR, asOf: AS_OF },
    "gpt-5.4-mini": { inputPerMtokUsd: 0.75, outputPerMtokUsd: 4.5, source: OR, asOf: AS_OF },
    "gpt-5.4-nano": { inputPerMtokUsd: 0.2, outputPerMtokUsd: 1.25, source: OR, asOf: AS_OF },
    "gemini-3.1-flash-lite-preview": { inputPerMtokUsd: 0.25, outputPerMtokUsd: 1.5, source: OR, asOf: AS_OF },
    // 2026-10-08: te id sa juz w katalogu dokladnie (wczesniej "najblizszy tier").
    // gemini-3-flash-preview mial 1,5/9 z tieru - realnie 0,50/3, panel zawyzal ~3x.
    "claude-sonnet-4-6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15, source: OR, asOf: AS_OF_1008 },
    "claude-haiku-4-5": { inputPerMtokUsd: 1, outputPerMtokUsd: 5, source: OR, asOf: AS_OF_1008 },
    "gemini-3-flash-preview": { inputPerMtokUsd: 0.5, outputPerMtokUsd: 3, source: OR, asOf: AS_OF_1008 },
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
    const stawka = price.prog && inTok > price.prog.powyzejTokenowWejscia ? price.prog : price;
    const costUsd =
        (inTok / 1_000_000) * stawka.inputPerMtokUsd +
        (outTok / 1_000_000) * stawka.outputPerMtokUsd;
    return { costUsd, estimated: true, unpriced: false };
}
