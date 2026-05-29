// Rejestr egress per model - mapuje id modelu na flage `EgressFlag` (ADR-0014).
//
// To jest "rejestr residency" z ADR-alpha (warstwa governance routingu),
// zrealizowany w slowniku ADR-0014: gdzie fizycznie ladzie request HTTP.
//
// Zasada FAIL-CLOSED: model o nieznanym pochodzeniu jest traktowany jak
// `us-with-dpa` (najgorszy egress), zeby straznik `decideRoute` zablokowal
// dane wrazliwe zamiast przepuscic je w ciemno. Nowy model dozwolonej strefy
// dodaje sie tutaj jawnie - brak wpisu = brak zaufania.
//
// Stan na 2026-05-29 (pilotaz):
//   - Ollama lokalny ("ollama/...")            -> no-egress (ruch nie opuszcza maszyny).
//   - Anthropic / OpenAI / Google / OpenRouter -> us-with-dpa (chmura, transfer
//     poza EOG wymaga DPA + DPF + decyzji Administratora, patrz ALLOW_US_PROVIDERS).
//   - eu-only jest ZAREZERWOWANE - dodamy konkretne modele dopiero gdy region UE
//     jest kontraktowo potwierdzony (FAZA 1). Nie zgadujemy "EU" z nazwy modelu.

import { OPENROUTER_PREFIX } from "../llm/models";
import type { EgressFlag } from "../llm/provider";

/** Prefiks modeli Ollama (lokalny, no-egress). Patrz lib/llm/ollama-provider.ts. */
export const OLLAMA_PREFIX = "ollama/";

/**
 * Zwraca flage egress dla danego id modelu. Czysta funkcja, bez IO.
 *
 * Tylko model lokalny (`ollama/...`) jest `no-egress`. Wszystko inne -
 * lacznie z modelami pozornie "europejskimi" lub "polskimi" routowanymi
 * przez OpenRouter (US infra) - jest `us-with-dpa`, bo request fizycznie
 * opuszcza maszyne do dostawcy spoza dozwolonej strefy. Nieznany model -
 * tez `us-with-dpa` (fail-closed).
 */
export function egressForModel(model: string): EgressFlag {
    if (model.startsWith(OLLAMA_PREFIX)) return "no-egress";
    // OpenRouter, Anthropic, OpenAI, Google i kazdy inny model chmurowy.
    // Bielik/Llama przez OpenRouter tez wychodza do US infra OpenRoutera -
    // dlatego prefiks openrouter/ NIE jest no-egress.
    if (model.startsWith(OPENROUTER_PREFIX)) return "us-with-dpa";
    if (model.startsWith("claude")) return "us-with-dpa";
    if (model.startsWith("gpt-")) return "us-with-dpa";
    if (model.startsWith("gemini")) return "us-with-dpa";
    // Fail-closed: model spoza znanej listy traktujemy jak najgorszy egress.
    return "us-with-dpa";
}

/** Czy model jest lokalny (no-egress). Skrot czytelnosciowy. */
export function isLocalModel(model: string): boolean {
    return egressForModel(model) === "no-egress";
}
