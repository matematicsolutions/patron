// Klasyfikator high-stakes vs low-stakes dla bramki debate (ADR-0004
// Faza 5). Reguly-based - deterministyczny (ta sama umowa zawsze
// klasyfikowana tak samo, bez "model dzis uznal inaczej").

/**
 * Typ dokumentu w korpusie Patrona. Lista zamknieta - rozszerzenia
 * wymagaja decyzji Wieslawa + osobnego commit + aktualizacji
 * dokumentacji ADR-0004.
 *
 * `inny` zostawiamy jako default dla dokumentow bez wyraznego typu -
 * traktujemy jako low-stakes (debate sie nie wlacza domyslnie).
 */
export type DocumentType =
    | "opinia"              // opinia prawna - zawsze high-stakes
    | "umowa_M&A"           // merger & acquisition - zawsze high-stakes
    | "umowa_DD"            // due diligence - zawsze high-stakes
    | "umowa_finansowa"     // umowy kredytowe, faktoringowe, gwarancje - zawsze high-stakes
    | "umowa_handlowa"      // typowa umowa handlowa - high-stakes jezeli cm_value przekracza prog
    | "pismo_procesowe"     // pisma w toczacym sie postepowaniu - high-stakes jezeli cm_value przekracza prog
    | "notatka"             // notatka wewnetrzna - low-stakes
    | "research"            // research kazusu, "czat o brzmieniu art. 415 KC" - low-stakes
    | "inny";

/**
 * Wejscie klasyfikatora - kontekst projektowy dokumentu/zapytania.
 *
 * Wszystkie pola opcjonalne (brak danych = traktujemy jako low-stakes
 * z domysu - debate nie wlacza sie chyba ze explicitFlag).
 */
export interface ClassificationInput {
    /** Typ dokumentu z `DocumentType` - jezeli znany. */
    documentType?: DocumentType;
    /**
     * Wartosc projektu w PLN (cm_value w terminologii Patrona). Jezeli
     * znana - powyzej progu (`HIGH_STAKES_CM_VALUE_THRESHOLD` z .env,
     * default 100_000) wlacza debate dla typow umowa_handlowa /
     * pismo_procesowe.
     */
    projectCmValue?: number;
    /**
     * Manualny override przez prawnika - "to jest high-stakes,
     * uruchom debate niezaleznie od typu i wartosci". Pozwala
     * eskalowac sprawy o niskiej cm_value ale wysokim ryzyku
     * reputacyjnym (patrz ADR-0004 Wariant C).
     */
    explicitFlag?: boolean;
}

/**
 * Wynik klasyfikatora.
 */
export interface ClassificationResult {
    /** Czy zapytanie kwalifikuje sie do debate. */
    isHighStakes: boolean;
    /**
     * Lista powodow dla decyzji - audit-friendly. Np.
     * ["documentType=opinia", "projectCmValue=500000>=100000"].
     * Pusta dla low-stakes (brak powodu do eskalacji).
     */
    reasons: string[];
    /**
     * Aktualnie zastosowany prog cm_value (z .env lub default). Do
     * audit log + telemetrii (uchwycenie zmian progu w czasie).
     */
    appliedThreshold: number;
}

/**
 * Konfiguracja klasyfikatora - injected przez `.env` lub argumentem
 * w testach. Default wartosci zalozone w ADR-0004, **do walidacji T2**
 * na realnym ruchu kancelarii pilotazowej.
 */
export interface ClassifierConfig {
    /** Prog cm_value w PLN ktory wlacza debate dla typow handlowych i
     * pism procesowych. Default 100_000 PLN. */
    cmValueThreshold: number;
    /** Typy ktore SA high-stakes niezaleznie od cm_value. */
    alwaysHighStakesTypes: ReadonlySet<DocumentType>;
}
