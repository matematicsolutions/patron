// ADR-0118: Typed search feed (search->read->cite) z best-effort lokatorem.
//
// Czysty shaper (zero IO, zero LLM) nadajacy wynikowi retrieve() typowana
// koperte: dyskryminator passage, ranking, i best-effort kotwica cytatu
// (CitationLocator z ADR-0116) dolaczana TYLKO gdy tresc fragmentu wystepuje
// doslownie w zrodle. Honesty: anchor "exact"|"none" + note jawnie mowia, czy
// i dlaczego nie zbudowano trwalej kotwicy.
//
// Wzorzec: Open-Source-Legal/OpenContracts (MIT), narzedzie `search_corpus`
// jako typowany feed. Patrz THIRD_PARTY_INSPIRATIONS.md. WZORZEC, nie kod.
//
// Tresc chunka jest znormalizowana whitespace w indekserze, wiec w v1
// wiekszosc passage'y dostanie anchor "none" - uczciwy stan przejsciowy;
// dokladne kotwiczenie czeka na offsety w doc_chunks (rezerwacja Route B).

import type { RetrievedChunk } from "../retrieval/retrieval";
import { type CitationLocator, findOccurrences, locatorFor } from "./locator";

// ADR-0124 (Route B 9c): gdy chunk niesie surowy span (source_offset_*),
// budujemy EXACT lokator wprost ze spanu - bez fuzzy findOccurrences na
// znormalizowanej tresci (ktore w v1 dawalo anchor "none" dla wiekszosci).

/** Ziarnistosc feedu. v1 emituje wylacznie "passage"; "block" = rezerwacja. */
export type FeedGranularity = "passage" | "block" | "both";

/** Czy zbudowano trwala kotwice (lokator) dla hita. */
export type AnchorKind = "exact" | "none";

/** Pojedynczy hit feedu na poziomie fragmentu (chunk). */
export interface FeedPassageHit {
    type: "passage";
    documentId: string;
    chunkIndex: number;
    score: number;
    /** Tresc fragmentu (jak zwrocona przez retrieve). */
    text: string;
    /** Trwala kotwica cytatu (ADR-0116) albo null gdy nie da sie verbatim. */
    locator: CitationLocator | null;
    /** Honesty: czy zbudowano trwala kotwice. */
    anchor: AnchorKind;
    /** Powod braku/zastrzezenia kotwicy (brak zrodla / normalizacja / wieloznacznosc). */
    anchorNote?: string;
}

export type FeedHit = FeedPassageHit;

/** Typowana koperta wyniku search->read->cite. */
export interface SearchFeed {
    query: string;
    granularity: FeedGranularity;
    total: number;
    results: FeedHit[];
    /** Honesty przy pustym/zdegradowanym wyniku. */
    note?: string;
}

/** Resolver surowego tekstu zrodlowego dla dokumentu (offline, jak w ADR-0005). */
export type FeedSourceResolver = (documentId: string) => string | null;

export interface BuildFeedOptions {
    granularity?: FeedGranularity;
}

const EMPTY_NOTE = "Brak trafien w korpusie dla tego zapytania.";
const NO_SOURCE_NOTE = "brak tekstu zrodlowego dla dokumentu";
const NORMALIZED_NOTE =
    "tresc fragmentu nie wystepuje doslownie w zrodle (normalizacja chunka) - dokladne kotwiczenie wymaga offsetow chunka (rezerwacja Route B)";
const AMBIGUOUS_NOTE =
    "fragment wystepuje wielokrotnie - zakotwiczono pierwsze wystapienie (retrieval nie dostarcza offsetu)";

/**
 * Buduje typowany feed z hitow retrieve(). Best-effort kotwica: lokator
 * powstaje tylko gdy `hit.content` wystepuje doslownie w tekscie zrodlowym
 * (niezmiennik ADR-0116). Deterministyczny, czysty.
 */
export function buildSearchFeed(
    query: string,
    hits: readonly RetrievedChunk[],
    resolveSource: FeedSourceResolver,
    options: BuildFeedOptions = {},
): SearchFeed {
    const granularity = options.granularity ?? "passage";
    const results: FeedHit[] = hits.map((hit) =>
        anchorPassage(hit, resolveSource),
    );
    const feed: SearchFeed = {
        query,
        granularity,
        total: results.length,
        results,
    };
    if (results.length === 0) {
        feed.note = EMPTY_NOTE;
    }
    return feed;
}

/** Kotwiczy pojedynczy hit best-effort, z uczciwym sygnalem anchor/note. */
function anchorPassage(
    hit: RetrievedChunk,
    resolveSource: FeedSourceResolver,
): FeedPassageHit {
    const base = {
        type: "passage" as const,
        documentId: hit.documentId,
        chunkIndex: hit.chunkIndex,
        score: hit.score,
        text: hit.content,
    };

    const source = resolveSource(hit.documentId);
    if (source == null) {
        return { ...base, locator: null, anchor: "none", anchorNote: NO_SOURCE_NOTE };
    }

    // Route B (ADR-0124): exact lokator ze stored span, gdy obecny i poprawny
    // wzgledem biezacego zrodla. Stale/poza zakresem (re-ekstrakcja) -> null ->
    // spadamy do best-effort ponizej (bez regresji).
    if (hit.sourceOffsetStart != null && hit.sourceOffsetEnd != null) {
        const spanLocator = locatorFor(source, {
            start: hit.sourceOffsetStart,
            end: hit.sourceOffsetEnd,
        });
        if (spanLocator != null) {
            return { ...base, locator: spanLocator, anchor: "exact" };
        }
    }

    const starts = findOccurrences(hit.content, source);
    if (starts.length === 0) {
        return { ...base, locator: null, anchor: "none", anchorNote: NORMALIZED_NOTE };
    }

    const start = starts[0]!;
    const locator: CitationLocator | null = locatorFor(source, {
        start,
        end: start + hit.content.length,
    });
    if (locator == null) {
        // Defensywnie: pierwsze wystapienie jest startem nienakladajacego
        // wystapienia, wiec locatorFor nie powinno zwrocic null. Gdyby jednak -
        // uczciwie zglos brak kotwicy zamiast falszywej.
        return { ...base, locator: null, anchor: "none", anchorNote: NORMALIZED_NOTE };
    }

    const hit_: FeedPassageHit = { ...base, locator, anchor: "exact" };
    if (starts.length > 1) {
        hit_.anchorNote = AMBIGUOUS_NOTE;
    }
    return hit_;
}
