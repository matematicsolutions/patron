// Orchestrator wrap/unwrap dla LLM-callow.
//
// Flow:
//   1. wrap(input)   -> detekcja PII -> podmiana na tokeny -> WrapResult{prompt, map}
//   2. (wywolujacy)  -> LLM(prompt)
//   3. unwrap(answer, map) -> podmiana tokenow z powrotem na oryginaly
//
// Skeleton NIE wpina sie w `streamChatWithTools` - to osobny ADR i
// osobna sesja, patrz ADR-0003 tydzien 3 planu migracji.

import { detectRegex, noopLlmDetector } from "./detect";
import { addPseudonim, createPseudonimMap } from "./map";
import type {
    DetectionRule,
    LlmDetector,
    PseudonimMap,
    WrapResult,
} from "./types";

export interface WrapOptions {
    /** Reguly regex do uzycia. Default: POLISH_PII_RULES. */
    rules?: DetectionRule[];
    /** Detektor LLM-based fallback. Default: no-op (skeleton). */
    llmDetector?: LlmDetector;
}

/**
 * Podmienia PII w tekscie na tokeny zastepcze. Tworzy nowa mape
 * pseudonimow zwiazana z tym wywolaniem.
 *
 * Algorytm: detekcja regex + (TODO) LLM fallback -> deduplikacja
 * pokrywajacych sie spans (priorytet dluzszego dopasowania) ->
 * podmiana od konca tekstu (zachowuje offsety wczesniejszych spans).
 */
export async function wrap(input: string, opts: WrapOptions = {}): Promise<WrapResult> {
    const map = createPseudonimMap();
    const prompt = await wrapInto(map, input, opts);
    return { prompt, map };
}

/**
 * Jak `wrap`, ale podmienia PII do JUZ ISTNIEJACEJ mapy zamiast tworzyc nowa.
 * Pozwala objac wiele tekstow (system prompt + kolejne wiadomosci) jedna
 * mapa - to samo nazwisko dostaje ten sam token w calej konwersacji
 * (deduplikacja w `addPseudonim`). Zwraca sam tekst po podmianie.
 * Patrz ADR-0067 wpiecie egress (lib/pseudonim/egress.ts).
 */
export async function wrapInto(
    map: PseudonimMap,
    input: string,
    opts: WrapOptions = {},
): Promise<string> {
    const llm = opts.llmDetector ?? noopLlmDetector;

    const regexHits = detectRegex(input, opts.rules);
    const llmHits = await llm.detect(input);

    // Skeleton: LLM hits nie maja offsetow, wiec dla MVP przeszukujemy
    // tekst i dodajemy span. Faza tydzien 2 - LLM zwraca offsety.
    type Hit = { start: number; end: number; span: string; category: import("./types").PiiCategory };
    const hits: Hit[] = regexHits.map((h) => ({
        start: h.start,
        end: h.end,
        span: h.span,
        category: h.category,
    }));
    // Dla kazdego unikalnego LLM-spanu znajdz WSZYSTKIE jego wystapienia
    // w tekscie - LLM mowi "ten span jest PERSON", a my podmieniamy
    // wszystkie wystapienia (z deduplikacja tokenow w `addPseudonim`).
    const seenSpans = new Set<string>();
    for (const lh of llmHits) {
        const key = `${lh.category}:${lh.span}`;
        if (seenSpans.has(key)) continue;
        seenSpans.add(key);
        let from = 0;
        let idx = input.indexOf(lh.span, from);
        while (idx !== -1) {
            hits.push({
                start: idx,
                end: idx + lh.span.length,
                span: lh.span,
                category: lh.category,
            });
            from = idx + lh.span.length;
            idx = input.indexOf(lh.span, from);
        }
    }

    // Deduplikacja: posortuj wg start asc, end desc; pomin spany zawarte
    // wewnatrz wczesniejszego spanu.
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: Hit[] = [];
    let lastEnd = -1;
    for (const h of hits) {
        if (h.start < lastEnd) continue;
        kept.push(h);
        lastEnd = h.end;
    }

    // Podmiana od konca tekstu (offsety wczesniejszych spans nie zmieniaja sie)
    let prompt = input;
    for (let i = kept.length - 1; i >= 0; i--) {
        const h = kept[i]!;
        const entry = addPseudonim(map, h.category, h.span);
        prompt = prompt.slice(0, h.start) + entry.token + prompt.slice(h.end);
    }

    return prompt;
}

/**
 * Odwraca podmiane - tokeny `[PERSON_1]`, `[PESEL_3]` zastepowane
 * oryginalami z mapy. Tokeny nieznane (LLM wymyslil `[PERSON_99]`,
 * ktorego nie ma w mapie) zostaja w tekscie - bezpieczne (BEZ
 * ujawnienia oryginalu), choc czytelnie nieestetyczne. Strict mode
 * (rzucanie bledu) zostawiamy na faze tydzien 3.
 */
export function unwrap(answer: string, map: PseudonimMap): string {
    // Sortuj tokeny od najdluzszego - unikamy aliasingu `[PERSON_1]` vs
    // `[PERSON_10]` (gdzie podmiana `[PERSON_1]` zjadlaby prefiks tego drugiego).
    const tokens = [...map.byToken.keys()].sort((a, b) => b.length - a.length);
    let out = answer;
    for (const token of tokens) {
        const original = map.byToken.get(token)!.original;
        // Globalna podmiana, escapujemy regex-special chars w tokenie
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, "g"), original);
    }
    return out;
}
