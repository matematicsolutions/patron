// Wpiecie pseudonimizacji na granicy EGRESS do chmury (ADR-0067 / blocker B1).
//
// Maskuje PII (PESEL/NIP/REGON/KRS/email/telefon - regex z detect.ts) PRZED
// wyslaniem konwersacji do modelu chmurowego, i odwraca tokeny w odpowiedzi.
// Cala konwersacja (system prompt + wiadomosci) uzywa JEDNEJ mapy, wiec ten sam
// identyfikator dostaje ten sam token wszedzie.
//
// Dziala defense-in-depth NAD straznikiem data-residency (decideRoute): tajemnica
// zawodowa i tak nie wychodzi do chmury (blok), a dla danych klienta nieobjetych
// tajemnica (client_general / internal) maskujemy ustrukturyzowane identyfikatory.
//
// OGRANICZENIE (FAZA 1): detektor imion/nazw firm jest LLM-based i wciaz no-op
// (detect.ts noopLlmDetector), wiec maskujemy tylko identyfikatory regexowe.
// Argumenty wywolan narzedzi nie sa odwracane - jezeli model wstawi token do
// argumentu toola, narzedzie dostanie token (rzadkie dla identyfikatorow).

import { createPseudonimMap } from "./map";
import { unwrap, wrapInto, type WrapOptions } from "./wrap";
import type { PseudonimMap } from "./types";
import type { LlmMessage } from "../llm/types";

export interface WrappedConversation {
    systemPrompt: string;
    messages: LlmMessage[];
    /** Mapa token->oryginal. Nie opuszcza serwera. Do unwrap odpowiedzi. */
    map: PseudonimMap;
}

/**
 * Maskuje PII w systemie + wszystkich wiadomosciach jedna wspolna mapa.
 * Zwraca zamaskowana konwersacje gotowa do wyslania do providera + mape do
 * odwrocenia odpowiedzi.
 */
export async function wrapConversation(
    systemPrompt: string,
    messages: LlmMessage[],
    opts: WrapOptions = {},
): Promise<WrappedConversation> {
    const map = createPseudonimMap();
    const wrappedSystem = await wrapInto(map, systemPrompt, opts);
    const wrappedMessages: LlmMessage[] = [];
    for (const m of messages) {
        wrappedMessages.push({
            role: m.role,
            content: await wrapInto(map, m.content, opts),
        });
    }
    return { systemPrompt: wrappedSystem, messages: wrappedMessages, map };
}

/**
 * Odwraca tokeny pseudonimow w STRUMIENIU odpowiedzi. Problem: token
 * `[PESEL_1]` moze przyjsc rozciety na granicy chunkow (`[PES` + `EL_1]`).
 * Rozwiazanie: trzymamy w buforze ogon zaczynajacy sie od ostatniego
 * niezamknietego `[` i emitujemy go dopiero, gdy token sie domknie (`]`)
 * albo na `flush()` na koniec strumienia. unwrap() podmienia tylko znane
 * tokeny - zwykly tekst w nawiasach (np. `[1]`) przechodzi bez zmian.
 */
export class PseudonimStreamUnwrapper {
    private buf = "";

    constructor(private readonly map: PseudonimMap) {}

    /** Dokłada delte, zwraca bezpieczny do emisji (odwrocony) prefiks. */
    push(delta: string): string {
        this.buf += delta;
        const lastOpen = this.buf.lastIndexOf("[");
        let holdFrom = this.buf.length;
        // Jezeli jest `[` bez `]` za nim - wstrzymaj od tego `[` (mozliwy
        // rozciety token). Wszystko wczesniej jest bezpieczne.
        if (lastOpen !== -1 && this.buf.indexOf("]", lastOpen) === -1) {
            holdFrom = lastOpen;
        }
        const emit = this.buf.slice(0, holdFrom);
        this.buf = this.buf.slice(holdFrom);
        return unwrap(emit, this.map);
    }

    /** Zwraca i czysci pozostaly bufor (koniec strumienia / granica tury). */
    flush(): string {
        if (!this.buf) return "";
        const out = unwrap(this.buf, this.map);
        this.buf = "";
        return out;
    }
}
