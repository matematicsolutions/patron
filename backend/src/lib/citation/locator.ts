// ADR-0116: Trwaly lokator cytatu (re-anchoring rawText + hint).
//
// Warstwa DETERMINISTYCZNA (zero LLM, zero kosztu, offline) odpowiadajaca na
// pytanie: GDZIE DOKLADNIE w surowym dokumencie jest TEN cytat, gdy dokument
// przeparsowano (inny parser, ponowny OCR, nowa wersja z tracked-changes).
//
// Wzorzec architektoniczny: Open-Source-Legal/OpenContracts (MIT), funkcja
// `_anchor_text` (utils/annotation_anchoring.py) - "rawText = zrodlo prawdy,
// offset = samonaprawiajacy hint". Implementacja MateMatic od zera w TypeScript,
// budujaca na istniejacym `constrainAllToSource` z pl-entities (ADR-0084). Patrz
// THIRD_PARTY_INSPIRATIONS.md. Bierzemy WZORZEC (algorytm), nie kod (Python).
//
// Relacja do ADR-0005 (grounding cytatow): 0005 weryfikuje ISTNIENIE/TRESC na
// tekscie ZNORMALIZOWANYM (lowercase, zwiniete biale znaki) i zwraca ulotny
// offset pierwszego segmentu. 0116 kotwiczy tier FRAGMENT na tekscie SUROWYM -
// offsety gotowe do slice/highlightu, z niezmiennikiem verbatim. Dwie warstwy
// tego samego gradientu, nie duplikat.

import { constrainAllToSource } from "../pl-entities/copySpan";

/**
 * Trwaly lokator cytatu. `rawText` jest jedynym kanonem - przezywa
 * przeparsowanie dokumentu. `startHint`/`occurrenceHint` to wskazowki do
 * rozstrzygania wieloznacznosci (gdy `rawText` pada w dokumencie wielokrotnie);
 * wolno je zgubic bez utraty mozliwosci zakotwiczenia (degradacja do pierwszego
 * wystapienia).
 */
export interface CitationLocator {
    /** ZRODLO PRAWDY - doslowny cytowany fragment. */
    rawText: string;
    /** Ostatni znany offset poczatku (samonaprawiajacy hint, UTF-16). */
    startHint?: number;
    /** Alternatywa: indeks wystapienia 0-based wsrod wystapien rawText. */
    occurrenceHint?: number;
}

/**
 * Wynik re-kotwiczenia. Offsety w surowym tekscie zrodlowym (UTF-16),
 * `end` exclusive. Niezmiennik dziedziczony po constrainAllToSource:
 *   sourceText.slice(start, end) === locator.rawText
 */
export interface ResolvedAnchor {
    /** Offset poczatkowy w surowym zrodle. */
    start: number;
    /** Offset koncowy w surowym zrodle (exclusive). */
    end: number;
    /** Ktore wystapienie rawText zakotwiczono (0-based). */
    occurrence: number;
    /** Ile wystapien rawText jest w zrodle. */
    total: number;
    /** True gdy total > 1 - sygnal dla UI/audytu (cytat wieloznaczny). */
    ambiguous: boolean;
}

/**
 * Wszystkie nienakladajace sie wystapienia `rawText` w `sourceText` jako
 * offsety poczatku. Cienka nakladka na constrainAllToSource (ADR-0084) -
 * zwraca same starty, do logiki wyboru wystapienia i sygnalu wieloznacznosci.
 */
export function findOccurrences(rawText: string, sourceText: string): number[] {
    return constrainAllToSource(rawText, sourceText).map((span) => span.start);
}

/**
 * Re-kotwiczy lokator wzgledem (byc moze przeparsowanego) tekstu zrodlowego.
 *
 * Algorytm (lustro OpenContracts `_anchor_text`):
 *  1. Zbierz wszystkie nienakladajace sie wystapienia `rawText`.
 *  2. Brak wystapien => null (FAIL-CLOSED, Konstytucja Art. 7 - nie zgadujemy).
 *  3. `occurrenceHint` w zakresie => wybierz to wystapienie.
 *  4. inaczej `startHint` podany => wystapienie o najmniejszym |start - startHint|
 *     (remis: wczesniejsze - deterministycznie, bez stanu).
 *  5. inaczej => pierwsze wystapienie.
 *
 * @returns ResolvedAnchor (z niezmiennikiem verbatim) albo null.
 */
export function reanchor(
    locator: CitationLocator,
    sourceText: string,
): ResolvedAnchor | null {
    const occurrences = constrainAllToSource(locator.rawText, sourceText);
    if (occurrences.length === 0) {
        return null;
    }

    let idx: number;
    const { occurrenceHint, startHint } = locator;

    if (
        occurrenceHint !== undefined &&
        occurrenceHint >= 0 &&
        occurrenceHint < occurrences.length
    ) {
        idx = occurrenceHint;
    } else if (startHint !== undefined) {
        // Najblizsze wystapienie do ostatnio znanej pozycji. Petla z ostrym
        // `<` zachowuje wczesniejsze przy remisie odleglosci (stabilnie).
        idx = 0;
        let bestDist = Math.abs(occurrences[0]!.start - startHint);
        for (let i = 1; i < occurrences.length; i++) {
            const dist = Math.abs(occurrences[i]!.start - startHint);
            if (dist < bestDist) {
                bestDist = dist;
                idx = i;
            }
        }
    } else {
        idx = 0;
    }

    const span = occurrences[idx]!;
    return {
        start: span.start,
        end: span.end,
        occurrence: idx,
        total: occurrences.length,
        ambiguous: occurrences.length > 1,
    };
}

/**
 * Buduje trwaly CitationLocator z biezacego spanu `{start, end}` w `sourceText`,
 * do zapisu (audit bundle, komentarz, edycja). Domyka round-trip: zapisany
 * lokator zakotwiczy sie z powrotem na tym samym fragmencie.
 *
 * `occurrenceHint` to indeks tego spanu wsrod wystapien jego tresci - czyni
 * lokator odpornym na lokalne edycje ZA cytatem. `startHint` ratuje przy
 * zmianie liczby wystapien przed cytatem. Razem z `rawText` (kanon) daja
 * trojstopniowa redundancje.
 *
 * @returns CitationLocator, albo null gdy span jest pusty/poza zakresem albo
 *          (skrajnie) jego tresc nie odnajduje sie we wlasnym zrodle.
 */
export function locatorFor(
    sourceText: string,
    span: { start: number; end: number },
): CitationLocator | null {
    if (
        span.start < 0 ||
        span.end > sourceText.length ||
        span.end <= span.start
    ) {
        return null;
    }
    const rawText = sourceText.slice(span.start, span.end);
    const occurrences = constrainAllToSource(rawText, sourceText);
    const occurrenceHint = occurrences.findIndex((o) => o.start === span.start);
    if (occurrenceHint < 0) {
        // Span nie pokrywa sie z zadnym nienakladajacym wystapieniem wlasnej
        // tresci (np. start w srodku innego wystapienia). Nie da sie zbudowac
        // wiarygodnego occurrenceHint - zwroc lokator z samym startHint.
        return { rawText, startHint: span.start };
    }
    return { rawText, startHint: span.start, occurrenceHint };
}
