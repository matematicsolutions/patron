// Typy grafu cytowan Patrona (ADR-0007 hybrid retrieval + ADR-0008 entity
// extraction).
//
// Status: Faza 6 (ADR-0008) - skeleton, niewpiety produkcyjnie. Schema
// SQL `extracted_entities` + `citation_graph` z ADR-0008 implementowany
// w T2 planu migracji (osobny commit).

import type { ExtractedEntity } from "../pl-entities/types";

/**
 * Typ relacji w grafie cytowan. Ontologia legal PL (NIE VC dealflow -
 * patrz THIRD_PARTY_INSPIRATIONS.md sekcja garrytan/gbrain). Krawedzie
 * dwukierunkowe nie sa modelowane - wszystkie relacje sa directed.
 */
export type CitationRelation =
    | "cytuje_orzeczenie"      // dokument X cytuje orzeczenie Y
    | "cytuje_przepis"         // dokument X cytuje art./CELEX/ELI
    | "strona_postepowania"    // dokument X dotyczy strony S
    | "reprezentuje"           // pelnomocnik P reprezentuje strone S
    | "wzorzec_aneksowany"     // dokument X jest aneksem do wzoru Y
    | "derywat_pisma"          // dokument X powstal na podstawie Y (kopia + mod)
    | "przed_sadem"            // dokument X dotyczy postepowania przed sadem S
    | "wspomina_firme"         // dokument X wymienia firme F (kontekst neutralny)
    | "wspomina_osobe"         // dokument X wymienia osobe O (kontekst neutralny)
    ;

/**
 * Pojedyncza krawedz grafu cytowan. Skladowana w tabeli `citation_graph`
 * z ADR-0007 schema SQL.
 */
export interface CitationEdge {
    /** ID dokumentu zrodlowego (z tabeli `documents`). */
    fromDocId: string;
    /**
     * ID dokumentu docelowego (jezeli orzeczenie/przepis trafia do
     * korpusu) lub `null` jezeli to "external entity" (sad, osoba,
     * firma ktora nie ma swojego dokumentu w korpusie - reprezentowana
     * jako encja w tabeli `extracted_entities`).
     */
    toDocId: string | null;
    /**
     * ID encji docelowej (z tabeli `extracted_entities`) jezeli to
     * krawedz do encji nie-dokumentu (sad, osoba, firma, sygnatura
     * orzeczenia spoza korpusu).
     */
    toEntityId: string | null;
    /** Typ relacji - jeden z `CitationRelation`. */
    relation: CitationRelation;
    /** Confidence ekstrakcji 0.0-1.0 (z `ExtractedEntity`). */
    confidence: number;
    /** Timestamp wykrycia krawedzi (UTC). */
    extractedAt: Date;
    /** ID encji w dokumencie zrodlowym (offset start/end + value). */
    sourceEntityId?: string;
}

/**
 * Wynik graph extractora dla jednego dokumentu. Zwraca encje wykryte
 * + krawedzie grafu zaproponowane. Wywolujacy decyduje czy zapisac
 * (jezeli `confidence` >= treshold).
 */
export interface ExtractionResult {
    /** Identyfikator dokumentu zrodlowego (do audit log). */
    docId: string;
    /** Wszystkie encje wykryte w tekscie. */
    entities: ExtractedEntity[];
    /** Krawedzie grafu zaproponowane (dokument -> encje/dokumenty). */
    edges: Omit<CitationEdge, "fromDocId">[];
    /** Dlugosc tekstu zrodlowego (do audit log). */
    sourceTextLength: number;
    /** Czas trwania ekstrakcji w ms (do telemetrii). */
    durationMs: number;
}

/**
 * Opcje wywolania extractora.
 */
export interface ExtractorOptions {
    /**
     * Minimum confidence dla wpiecia encji do grafu. Encje ponizej
     * tylko zapisywane w `extracted_entities`, ale bez krawedzi w
     * `citation_graph`. Default 0.6 (czesc TK sygnatur i firm bez
     * formy prawnej ma niski confidence z reguly).
     */
    minEdgeConfidence?: number;
    /**
     * Jezeli `true`, extractor sprawdza kontekst wokol dopasowania
     * sygnatury (slowo "sygn.", "wyrok", "uchwala", "postanowienie"
     * w sasiedztwie) i podnosi confidence. Default `true`.
     */
    contextBoost?: boolean;
}
