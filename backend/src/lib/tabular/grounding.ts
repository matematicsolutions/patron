// ADR-0080: Grounding cytatow w komorkach tabular review.
//
// Ekstrakcja tabular (routes/tabular.ts) kaze modelowi opatrywac kazdy fakt w
// polu "summary"/"reasoning" inline-cytatem [[page:N||quote:doslowny fragment]].
// Do tej pory NIKT tych cytatow nie weryfikowal - model moglby zhalucynowac
// cytat, a macierz Due Diligence wygladalaby na ugruntowana. To bezposrednio
// uderza w moat Patrona (anty-halucynacja, AI Act art. 12).
//
// Ta warstwa jest DETERMINISTYCZNA (zero LLM, zero kosztu, offline): parsuje
// cytaty inline z tekstu komorki i sprawdza string-matchem (z tolerancja na
// interpunkcje/uciecie) wzgledem markdownu dokumentu, ktory i tak jest juz w
// pamieci podczas ekstrakcji. Reuzywa czystego weryfikatora ADR-0005
// (lib/citation/grounding.ts) - tu tylko adapter formatu inline -> ParsedCitation.

import type { ParsedCitation } from "../chat/types";
import { verifyOne } from "../citation/grounding";

// Lustro frontowego PAGE_CITATION_RE (citation-utils.ts). Inline-cytat ma postac
// [[page:N||quote:tekst]] lub [[page:N||tekst]]; tekst moze zawierac zagniezdzone
// [...] (luki w cytacie), wiec dopuszczamy [^\[\]] albo cale [ ... ].
const INLINE_CITATION_RE =
    /\[\[page:(\d+)\|\|(?:quote:)?((?:[^\[\]]|\[[^\]]*\])+)\]\]/gi;

/** Pojedynczy cytat inline wyciagniety z tekstu komorki. */
export interface InlineCitation {
    page: number;
    quote: string;
}

/** Zwiezly werdykt groundingu komorki - persystowany w cell.content.grounding. */
export interface TabularCellGrounding {
    /** Liczba cytatow inline znalezionych w komorce. */
    total: number;
    /** Cytaty trafione doslownie w dokumencie. */
    verified: number;
    /** Cytaty z drobnymi roznicami (interpunkcja/uciecie) - prawnik sprawdza. */
    modified: number;
    /** Cytaty bez trafienia - potencjalna halucynacja. */
    unverified: number;
    /**
     * ADR-0102 (B): cytaty SA, ale nie dalo sie ich zweryfikowac verbatim (brak /
     * nieczytelne zrodlo). Opcjonalne (wstecznie kompatybilne) - obecne tylko gdy
     * stan needs_review wystapil (flaga PATRON_TABULAR_CELL_STATES).
     */
    needs_review?: number;
    /** Najgorszy stan po wszystkich cytatach (rollup do badge'a w UI). */
    status: "verified" | "modified" | "unverified" | "needs_review";
}

/**
 * Wyciaga cytaty inline [[page:N||quote:...]] z tekstu komorki. Deterministyczne,
 * bez LLM. Kolejnosc zachowana. Puste/zdegenerowane cytaty pomijane.
 */
export function parseInlineCitations(text: string | null | undefined): InlineCitation[] {
    if (!text) return [];
    const out: InlineCitation[] = [];
    INLINE_CITATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_CITATION_RE.exec(text)) !== null) {
        const page = parseInt(m[1], 10);
        const quote = m[2].trim();
        if (quote) out.push({ page: Number.isFinite(page) ? page : 1, quote });
    }
    return out;
}

/**
 * Weryfikuje cytaty inline komorki wzgledem markdownu dokumentu i zwraca rollup.
 *
 * Zwraca `undefined` gdy:
 *  - komorka nie ma zadnych cytatow inline (np. kolumna free-text, "Not Found"),
 *  - nie ma tekstu zrodlowego (np. ekstrakcja PDF/skanu zwrocila pusty markdown).
 * W obu wypadkach brak sygnalu jest uczciwszy niz falszywy alarm - nie krzyczymy
 * "halucynacja" gdy po prostu nie ma czego/czym weryfikowac.
 */
export function groundCellText(
    summary: string | null | undefined,
    reasoning: string | null | undefined,
    documentText: string | null | undefined,
    opts?: { cellStates?: boolean },
): TabularCellGrounding | undefined {
    const citations = [
        ...parseInlineCitations(summary),
        ...parseInlineCitations(reasoning),
    ];
    // Brak cytatow = nie ma czego gruntowac (kolumna free-text / "Not Found") -> undefined.
    if (citations.length === 0) return undefined;
    if (!documentText || !documentText.trim()) {
        // ADR-0102 (B): cytaty SA, ale nie da sie ich zweryfikowac verbatim (brak /
        // nieczytelne zrodlo). Zasada "pusta komorka ukrywa informacje" - zamiast
        // milczec (undefined, ADR-0080), oznacz needs_review: cytat bez mozliwosci
        // re-odczytu zrodla NIE jest dowodem ugruntowania ani halucynacji - jest do
        // przegladu przez prawnika. Za flaga PATRON_TABULAR_CELL_STATES (default OFF).
        if (opts?.cellStates) {
            return {
                total: citations.length,
                verified: 0,
                modified: 0,
                unverified: 0,
                needs_review: citations.length,
                status: "needs_review",
            };
        }
        return undefined;
    }

    let verified = 0;
    let modified = 0;
    let unverified = 0;
    citations.forEach((c, i) => {
        const parsed: ParsedCitation = {
            ref: i,
            doc_id: "self",
            page: c.page,
            quote: c.quote,
        };
        const r = verifyOne(parsed, documentText);
        if (r.status === "ZWERYFIKOWANY") verified++;
        else if (r.status === "ZMODYFIKOWANY") modified++;
        else unverified++; // NIEZWERYFIKOWANY / BRAK_ZRODLA (zrodlo jest, wiec realnie tylko NIEZWERYFIKOWANY)
    });

    const status: TabularCellGrounding["status"] =
        unverified > 0 ? "unverified" : modified > 0 ? "modified" : "verified";

    return { total: citations.length, verified, modified, unverified, status };
}
