// ADR-0122: occurrence-aware highlight - wybor ktorego wystapienia frazy
// podswietlic, gdy cytat niesie trwaly lokator (grounding[ref].locator z SSE,
// ADR-0116/0120). Czysta funkcja, zero DOM - dzielona przez highlightQuote
// (PDF) i highlightDocxQuote (DOCX). Operuje w tej samej przestrzeni co
// highlightery (string juz zestripowany do liter+cyfr).
//
// Granica soundness: locator.occurrenceHint liczony jest w surowym tekscie
// zrodlowym backendu. Frontend matchuje w innej ekstrakcji (pdf.js / docx-
// preview), wiec wybor wystapienia jest BEST-EFFORT. Stad twardy, bezpieczny
// fallback: brak `occurrence` / poza zakresem => indeks pierwszego wystapienia
// (zachowanie sprzed ADR-0122). Nigdy nie pogarsza dzialania highlightu.

/**
 * Indeks `occurrence`-tego (0-based) NIENAKLADAJACEGO sie wystapienia `needle`
 * w `haystack`.
 *
 *  - `needle` pusty => -1 (brak czego szukac).
 *  - brak wystapien => -1.
 *  - `occurrence` undefined / <= 0 => pierwsze wystapienie (= indexOf).
 *  - `occurrence` poza zakresem (za malo wystapien) => pierwsze wystapienie
 *    (bezpieczny fallback, nie -1 - lepiej podswietlic cokolwiek niz nic).
 */
export function nthOccurrenceIndex(
    haystack: string,
    needle: string,
    occurrence?: number,
): number {
    if (needle.length === 0) return -1;
    const first = haystack.indexOf(needle);
    if (first < 0) return -1;
    if (occurrence === undefined || occurrence < 1) return first;

    let idx = first;
    for (let count = 0; count < occurrence; count++) {
        const next = haystack.indexOf(needle, idx + needle.length);
        if (next < 0) return first; // poza zakresem -> fallback do pierwszego
        idx = next;
    }
    return idx;
}
