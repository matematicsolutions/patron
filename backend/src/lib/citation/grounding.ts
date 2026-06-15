// ADR-0005: Mechaniczna weryfikacja cytatow (citation grounding).
//
// Warstwa DETERMINISTYCZNA (zero LLM, zero kosztu, offline) sprawdzajaca PRZED
// zwrotem odpowiedzi, czy kazdy cytat z bloku <CITATIONS> faktycznie wystepuje
// w tekscie zrodlowym. Wzorzec architektoniczny: AnttiHero/lavern (Apache 2.0,
// preflight mechanical verifier) - implementacja MateMatic od zera, polonizacja
// zrodel (dokumenty klienta / SAOS / ISAP / EUR-Lex przez wstrzykiwany resolver).
//
// Algorytm walidowany na eval harness (LEDGAR/lex_glue, 351 przypadkow) - patrz
// Projects/legal-eval-harness/. Logika string-match przeniesiona z wewnetrznego
// skilla citation-grounding-pl (kod MateMatic; w powloce Patrona dziedziczy AGPL-3.0).

import type { ParsedCitation } from "../chat/types";

const QUOTE_CHARS = /[„”“»«’‘'`]/g;
const DASHES = /[—–]/g;

/** Status mechaniczny pojedynczego cytatu (lustro skilla citation-grounding-pl). */
export type GroundingStatus =
    | "ZWERYFIKOWANY" // cytat wystepuje doslownie w zrodle
    | "ZMODYFIKOWANY" // drobne roznice (interpunkcja / uciecie) - prawnik sprawdza
    | "NIEZWERYFIKOWANY" // brak trafienia - potencjalna halucynacja
    | "BRAK_ZRODLA"; // nie dostarczono tekstu zrodlowego dla doc_id

/** Decyzja UI/audit wg ADR-0005 wariant C (3-stopniowy signal). */
export type GroundingDecision = "verified" | "unverified" | "blocked";

export type GroundingResult = {
    ref: number;
    doc_id: string;
    status: GroundingStatus;
    decision: GroundingDecision;
    /** Najgorszy stosunek edit-distance/dlugosc po segmentach (0 = idealne). */
    worstRatio: number;
    /** Offset pierwszego segmentu w znormalizowanym zrodle (-1 gdy brak). */
    offset: number;
    note?: string;
};

export type GroundingReport = {
    summary: {
        total: number;
        zweryfikowane: number;
        zmodyfikowane: number;
        niezweryfikowane: number;
        brak_zrodla: number;
    };
    /** True gdy ktorykolwiek cytat jest NIEZWERYFIKOWANY lub BRAK_ZRODLA. */
    blokada: boolean;
    results: GroundingResult[];
};

/**
 * Resolver tekstu zrodlowego dla danego identyfikatora dokumentu/orzeczenia.
 * Pozwala obsluzyc 3 poziomy ADR-0005 jednym mechanizmem:
 *  - dokumenty klienta: lookup w DocStore / parsed index (offline, Desktop)
 *  - orzeczenia: mcp-saos fetchOrzeczeniePelne(sygnatura)
 *  - przepisy: mcp-isap / eu-sparql fetchArtykul(eli)
 * Zwraca null gdy zrodla nie da sie pobrac (brak w bazie, API down).
 */
export type SourceResolver = (doc_id: string) => string | null;

/** Prog stosunku edit-distance ponizej ktorego cytat to ZMODYFIKOWANY (nie halucynacja). */
export const MODIFIED_RATIO_THRESHOLD = 0.15;

export function normalize(s: string | null | undefined): string {
    if (s == null) return "";
    return String(s)
        .replace(/-\s*\n\s*/g, "") // myslnik przenoszenia na koncu wiersza
        .replace(QUOTE_CHARS, '"') // ujednolicenie cudzyslowow
        .replace(DASHES, "-") // ujednolicenie myslnikow
        .toLowerCase()
        .replace(/\s+/g, " ") // zwiniecie bialych znakow
        .trim();
}

// Cytat moze zawierac luki [...] lub ... oznaczajace pominiety fragment.
function splitGaps(normQuote: string): string[] {
    return normQuote
        .split(/\s*(?:\[\s*\.\.\.\s*\]|\.\.\.)\s*/)
        .map((seg) => seg.trim())
        .filter((seg) => seg.length > 0);
}

// Levenshtein na krotkich stringach - tylko do oceny ZMODYFIKOWANY.
function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > 40) return Math.max(m, n);
    const dp: number[] = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
        let prev = dp[0];
        dp[0] = j;
        for (let i = 1; i <= m; i++) {
            const tmp = dp[i];
            dp[i] = Math.min(
                dp[i] + 1,
                dp[i - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            prev = tmp;
        }
    }
    return dp[m];
}

// Najlepsze przyblizone dopasowanie segmentu w zrodle (przesuwane okno).
function bestApprox(
    segment: string,
    source: string,
): { dist: number; at: number } {
    const L = segment.length;
    if (L === 0 || source.length < L) return { dist: L, at: -1 };
    let best = { dist: Infinity, at: -1 };
    const step = L > 200 ? 5 : 1;
    for (let i = 0; i + L <= source.length; i += step) {
        const window = source.slice(i, i + L);
        const d = editDistance(segment, window);
        if (d < best.dist) best = { dist: d, at: i };
        if (d === 0) break;
    }
    return best;
}

function decisionFor(status: GroundingStatus): GroundingDecision {
    switch (status) {
        case "ZWERYFIKOWANY":
            return "verified";
        case "ZMODYFIKOWANY":
            return "unverified";
        case "NIEZWERYFIKOWANY":
        case "BRAK_ZRODLA":
            return "blocked";
    }
}

/** Weryfikuje pojedynczy cytat wzgledem dostarczonego tekstu zrodlowego. */
export function verifyOne(
    citation: ParsedCitation,
    sourceText: string | null,
): GroundingResult {
    const base = { ref: citation.ref, doc_id: citation.doc_id };
    if (sourceText == null || normalize(sourceText).length === 0) {
        return {
            ...base,
            status: "BRAK_ZRODLA",
            decision: "blocked",
            worstRatio: 1,
            offset: -1,
            note: "nie dostarczono tekstu zrodlowego",
        };
    }
    const src = normalize(sourceText);
    const segments = splitGaps(normalize(citation.quote));
    if (segments.length === 0) {
        return {
            ...base,
            status: "BRAK_ZRODLA",
            decision: "blocked",
            worstRatio: 1,
            offset: -1,
            note: "pusty cytat",
        };
    }

    // 1) proba dokladna - wszystkie segmenty w kolejnosci
    let cursor = 0;
    let firstOffset = -1;
    let exact = true;
    for (const seg of segments) {
        const idx = src.indexOf(seg, cursor);
        if (idx === -1) {
            exact = false;
            break;
        }
        if (firstOffset === -1) firstOffset = idx;
        cursor = idx + seg.length;
    }
    if (exact) {
        return {
            ...base,
            status: "ZWERYFIKOWANY",
            decision: "verified",
            worstRatio: 0,
            offset: firstOffset,
        };
    }

    // 2) proba przyblizona - sygnal ZMODYFIKOWANY vs NIEZWERYFIKOWANY
    let worstRatio = 0;
    let firstApproxOffset = -1;
    for (const seg of segments) {
        const { dist, at } = bestApprox(seg, src);
        const ratio = seg.length > 0 ? dist / seg.length : 1;
        worstRatio = Math.max(worstRatio, ratio);
        if (firstApproxOffset === -1) firstApproxOffset = at;
    }
    const status: GroundingStatus =
        worstRatio <= MODIFIED_RATIO_THRESHOLD
            ? "ZMODYFIKOWANY"
            : "NIEZWERYFIKOWANY";
    return {
        ...base,
        status,
        decision: decisionFor(status),
        worstRatio,
        offset: firstApproxOffset,
        note:
            status === "ZMODYFIKOWANY"
                ? "drobne roznice (interpunkcja/uciecie)"
                : "brak trafienia - potencjalna halucynacja",
    };
}

/**
 * Weryfikuje wszystkie cytaty z odpowiedzi LLM wzgledem zrodel dostarczanych
 * przez resolver. Deterministyczne, bez wywolan LLM. Zwraca raport z decyzja
 * blokady (>=1 cytat NIEZWERYFIKOWANY lub BRAK_ZRODLA) zgodnie z ADR-0005.
 */
export function verifyCitations(
    citations: ParsedCitation[],
    resolveSource: SourceResolver,
): GroundingReport {
    const results = citations.map((c) => verifyOne(c, resolveSource(c.doc_id)));
    const summary = {
        total: results.length,
        zweryfikowane: results.filter((r) => r.status === "ZWERYFIKOWANY").length,
        zmodyfikowane: results.filter((r) => r.status === "ZMODYFIKOWANY").length,
        niezweryfikowane: results.filter((r) => r.status === "NIEZWERYFIKOWANY")
            .length,
        brak_zrodla: results.filter((r) => r.status === "BRAK_ZRODLA").length,
    };
    const blokada = summary.niezweryfikowane > 0 || summary.brak_zrodla > 0;
    return { summary, blokada, results };
}
