// Wspolne typy biblioteki pl-entities/ - rozpoznawanie polskich identyfikatorow,
// sygnatury orzeczen i nazwy podmiotow prawa polskiego.
//
// Zobacz governance/adr/0008-entity-extraction-write-time-zero-llm.md
// (Faza 6 roadmapy). Modul kanoniczny dla:
// - graf cytowan (ADR-0007/0008) - zapisuje encje wykryte w dokumencie
// - warstwa pseudonim PII (ADR-0003) - po refactorze T1 ADR-0008 uzywa
//   tej biblioteki zamiast wlasnych regexow
// - audit bundle (ADR-0006) - zapisuje extracted_entities jako dowod
//   tego co Patron wykryl

/**
 * Typ encji prawnej rozpoznawanej w korpusie Patrona.
 *
 * Ontologia legal PL (nie VC dealflow - patrz THIRD_PARTY_INSPIRATIONS.md
 * sekcja garrytan/gbrain): identyfikatory osob fizycznych i prawnych,
 * sygnatury akt sadowych i administracyjnych, sygnatury aktow prawnych,
 * nazwy sadow i kancelarii.
 */
export type EntityType =
    // Identyfikatory PII (te same co PiiCategory w pseudonim/types.ts,
    // pseudonim po refactorze T1 ADR-0008 importuje stad)
    | "PESEL"
    | "NIP"
    | "REGON"
    | "KRS"
    | "EMAIL"
    | "PHONE"
    // Encje prawne i procesowe
    | "SYGNATURA_ORZECZENIA"    // np. "III CZP 11/13", "II SA/Wa 1234/24"
    | "SYGNATURA_AKTU"          // CELEX, ELI, Dziennik Ustaw
    | "SAD"                     // nazwa sadu z gazetteera
    | "OSOBA"                   // imie i nazwisko (regex + LLM-fallback)
    | "FIRMA"                   // nazwa firmy (regex form prawnych + KRS lookup)
    | "DATA_PUBLIKACJI"         // data w polskim formacie
    ;

/**
 * Pojedyncza wykryta encja w tekscie. Zwracana przez extractor i
 * skladowana w tabeli `extracted_entities` (ADR-0008 schema SQL).
 */
export interface ExtractedEntity {
    /** Typ encji - jedna z `EntityType`. */
    type: EntityType;
    /** Oryginalny ciag znakow z tekstu. */
    value: string;
    /**
     * Wartosc znormalizowana (dla porownan, deduplikacji w grafie). Np.
     * PESEL bez biaalych znakow, sygnatura w UPPERCASE bez nadmiernych spacji,
     * KRS z wiodacymi zerami uzupelnionymi do 10 znakow.
     */
    valueNormalized: string;
    /** Offset poczatkowy w tekscie zrodlowym (znaki, nie bajty). */
    sourceOffsetStart: number;
    /** Offset koncowy w tekscie zrodlowym (exclusive). */
    sourceOffsetEnd: number;
    /**
     * Confidence detekcji 0.0-1.0. Regex z checksuma = 1.0. Regex bez
     * checksumy + bez kontekstu = 0.6-0.8. Gazetteer match = 0.9.
     * LLM-fallback = score modelu. Dedup w grafie wymaga >= 0.8.
     */
    confidence: number;
    /** Identyfikator reguly ktora dopasowala (telemetria + debug). */
    ruleId: string;
    /**
     * Opcjonalne metadane domeny - dla sygnatury orzeczenia: typ sadu
     * (SN/NSA/WSA/SO/SR/TK/KIO), izba, dla SAD: nazwa wlasnoznaczna
     * z gazetteera, dla FIRMA: forma prawna (Sp. z o.o. / S.A. / itp.).
     */
    metadata?: Record<string, string | number | undefined>;
}

/**
 * Reguly regex-based ekstrakcji. Walidator opcjonalny (np. checksuma
 * PESEL/NIP/REGON).
 */
export interface ExtractionRule {
    /** Identyfikator reguly (telemetria, audit log). */
    id: string;
    /** Typ encji jaki produkuje. */
    type: EntityType;
    /** Regex z opcjonalna grupa do podmiany (jezeli brak - cale dopasowanie). */
    pattern: RegExp;
    /** Walidator (np. checksuma). Zwraca true jezeli dopasowanie jest prawdziwe. */
    validate?: (match: string) => boolean;
    /** Confidence bazowy dla tej reguly - moze byc modyfikowany przez kontekst. */
    baseConfidence: number;
    /** Funkcja normalizujaca wartosc (np. UPPERCASE, trim, padding zer). */
    normalize?: (match: string) => string;
}
