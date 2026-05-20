// Typy warstwy pseudonimizacji PII przed wywolaniem LLM.
//
// Zobacz governance/adr/0003-pseudonimizacja-pii-pre-llm.md (wariant C):
// skeleton dziedziczy AGPL-3.0 po patron; cherry-pick wzorca z
// sure-scale/hey-jude (idea, NIE kod). Faza 4.5 roadmapy.

/**
 * Kategoria wykrytego PII. Tokeny generujemy w formacie
 * `[<KATEGORIA>_<N>]`, gdzie N jest sekwencyjnym indeksem w obrebie
 * jednego wywolania `wrap()`.
 */
export type PiiCategory =
    | "PERSON"
    | "ORG"
    | "PESEL"
    | "NIP"
    | "REGON"
    | "KRS"
    | "ADDRESS"
    | "EMAIL"
    | "PHONE";

/**
 * Token zastepczy + oryginalny tekst. Mapa token->oryginal nigdy nie
 * opuszcza serwera kancelarii. Trzymamy ja w `PseudonimStore` -
 * domyslnie in-memory dla skeletonu, docelowo Postgres `pseudonim_map`.
 */
export interface PseudonimToken {
    /** Postac `[PERSON_1]`, `[PESEL_3]`. Deterministyczna w obrebie jednej mapy. */
    token: string;
    /** Kategoria PII - jedna z `PiiCategory`. */
    category: PiiCategory;
    /** Oryginalny ciag z dokumentu. Wraca przy `unwrap()`. */
    original: string;
}

/**
 * Mapa pseudonimow zawiazana na jedno wywolanie (jeden chat-turn lub
 * jedno zadanie bulk). Same kolekcje, bez logiki - logika w `map.ts`.
 */
export interface PseudonimMap {
    /** Wszystkie tokeny w kolejnosci wprowadzenia. */
    tokens: PseudonimToken[];
    /** Lookup token -> PseudonimToken (do `unwrap()`). */
    byToken: Map<string, PseudonimToken>;
    /** Lookup original -> token (do deduplikacji - drugie wystapienie tej samej osoby nie generuje nowego tokenu). */
    byOriginal: Map<string, string>;
}

/**
 * Pojedyncza reguly detekcji - regex + kategoria. Wspolny interfejs
 * dla detektorow regex-based.
 */
export interface DetectionRule {
    /** Identyfikator reguly (do telemetrii i debugowania). */
    id: string;
    /** Kategoria PII generowana przez ta regulę. */
    category: PiiCategory;
    /** Regex z grupa zawierajaca dopasowanie do podmiany. */
    pattern: RegExp;
    /** Opcjonalny walidator (np. checksuma PESEL/NIP). Zwraca true jezeli dopasowanie jest prawdziwe. */
    validate?: (match: string) => boolean;
}

/**
 * Wynik wrap() - tekst po podmianie i mapa do unwrap. Wywolujacy
 * przekazuje `prompt` do LLM, dostaje odpowiedz, woła `unwrap(answer, map)`.
 */
export interface WrapResult {
    /** Tekst po podmianie PII na tokeny (idzie do LLM). */
    prompt: string;
    /** Mapa pseudonimow do odwrocenia po otrzymaniu odpowiedzi. */
    map: PseudonimMap;
}

/**
 * Adapter persystencji mapy. Domyslna implementacja in-memory; docelowo
 * Postgres adapter pisujacy do tabeli `pseudonim_map` z TTL.
 *
 * UWAGA: implementacje persistent MUSZA byc objete tym samym cyklem
 * RODO art. 17 co audit_log (kasowanie na zadanie uzytkownika) - patrz
 * ADR-0003 plan migracji tydzien 5.
 */
export interface PseudonimStore {
    save(mapId: string, map: PseudonimMap): Promise<void>;
    load(mapId: string): Promise<PseudonimMap | null>;
    delete(mapId: string): Promise<void>;
}

/**
 * Interfejs detektora LLM-based (fallback dla zlozonych przypadkow,
 * fleksja imion, nietypowe nazwy firm). W skeletonie no-op, docelowo
 * Ollama qwen3.5:4b albo mistral-pl - patrz `prompts.pl.ts`.
 */
export interface LlmDetector {
    detect(text: string): Promise<Array<{ span: string; category: PiiCategory }>>;
}
