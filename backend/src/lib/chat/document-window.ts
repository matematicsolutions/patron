// ADR-0117: Bounded document text (stronicowany odczyt dokumentu).
//
// Czysty rdzen stronicowania (zero IO, zero LLM) - przyszle narzedzie agenta
// `get_document_text` opakuje go wokol readDocumentContent. Chroni przed
// zalaniem kontekstu i mnozeniem kosztu przy duzych aktach: agent czyta
// dokument oknami, kontynuujac tylko gdy potrzebuje (kanal `nextOffset`).
//
// Wzorzec: Open-Source-Legal/OpenContracts (MIT), narzedzie MCP
// `get_document_text(char_offset, max_chars)` z jawnym next_offset/truncated.
// Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy WZORZEC (kontrakt okna), nie kod.
//
// Offsety UTF-16 - spojnie z ADR-0116 (locator), copySpan i ExtractedEntity.

/** Domyslny limit znakow okna, gdy wywolujacy nie poda maxChars. */
export const DEFAULT_MAX_CHARS = 50_000;

/** Twardy gorny limit znakow okna - zacinamy maxChars do tej wartosci. */
export const HARD_MAX_CHARS = 200_000;

/** Okno tekstu dokumentu zwracane przez boundedDocumentText. */
export interface DocumentWindow {
    /** Tekst okna: fullText.slice(charOffset, end). */
    text: string;
    /** Faktyczny (zaciety do [0, totalChars]) offset poczatku, UTF-16. */
    charOffset: number;
    /** Faktyczny (zaciety do [1, HARD_MAX_CHARS]) zastosowany limit. */
    maxChars: number;
    /** Pelna dlugosc dokumentu (UTF-16). */
    totalChars: number;
    /** Offset kontynuacji (end) gdy zostalo wiecej; null gdy okno siega konca. */
    nextOffset: number | null;
    /** True gdy zwrocone okno nie jest calym dokumentem. */
    truncated: boolean;
}

/**
 * Zacina liczbe calkowita do [min, max]. Nie-liczby (NaN) traktujemy jak min -
 * jawnie, audytowalnie (Art. 3), zamiast propagowac NaN do slice.
 */
function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    const n = Math.trunc(value);
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

/**
 * Zwraca ograniczone okno tekstu dokumentu z jawnym sygnalem kontynuacji.
 *
 * Zacinanie wejscia jest jawne: `charOffset` do [0, totalChars], `maxChars`
 * do [1, HARD_MAX_CHARS]. `nextOffset` to jedyny kanal kontynuacji - iterujac
 * `charOffset := nextOffset` az do null wywolujacy odtwarza caly dokument.
 *
 * @param fullText pelny tekst dokumentu
 * @param charOffset offset poczatku okna (domyslnie 0)
 * @param maxChars maksymalna liczba znakow okna (domyslnie DEFAULT_MAX_CHARS)
 */
export function boundedDocumentText(
    fullText: string,
    charOffset: number = 0,
    maxChars: number = DEFAULT_MAX_CHARS,
): DocumentWindow {
    const totalChars = fullText.length;
    const start = clampInt(charOffset, 0, totalChars);
    const limit = clampInt(maxChars, 1, HARD_MAX_CHARS);
    const end = Math.min(start + limit, totalChars);
    const text = fullText.slice(start, end);
    const nextOffset = end < totalChars ? end : null;
    // truncated = okno != caly dokument (uciete z przodu LUB z tylu).
    const truncated = start > 0 || end < totalChars;
    return { text, charOffset: start, maxChars: limit, totalChars, nextOffset, truncated };
}
