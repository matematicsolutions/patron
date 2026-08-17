// ADR-0102 (decyzja A): tagi proweniencji cytatu - DETERMINISTYCZNE z metadanych
// zrodla (ktory konektor / dokument), NIE z wywolania LLM. Tag opisuje POCHODZENIE
// twierdzenia, nie pewnosc. Wzorzec: anthropics/claude-for-legal (Apache-2.0,
// clean-room - idea nie kod). Patrz THIRD_PARTY_INSPIRATIONS.md.
//
// OS ORTOGONALNA do verdict (ADR-0097):
//   verdict     = "jak bardzo zrodlo wspiera teze" (judge LLM, lokalny, niedeterm.)
//   provenance  = "skad pochodzi twierdzenie"      (z metadanych zrodla, determ.)
// Oba to enumy - oba bezpieczne do UI i audytu (zero PII, w odroznieniu od
// judgeReason). decision (ADR-0005, blokada) pozostaje nietknieta - provenance to
// warstwa znakowania, nie zmienia blokady.
//
// REGULY TWARDE:
//   1. DEFAULT = model. Nie pobrano zrodla -> wiedza modelu, niezaleznie od pewnosci.
//   2. Pinpoint (numer art./ust./par./CELEX) ZAWSZE wymaga weryfikacji - polskie
//      nowelizacje przenumerowuja jednostki redakcyjne; artykuly AI Act drgaly przy
//      konsolidacji. Pinpoint + zrodlo pobrane = nadal flaga "zweryfikuj".
//
// Wyprowadzenie jest CZYSTE (string/enum) - bez I/O, bez LLM, bez egressu. sourceKind
// podaje wywolujacy z kontekstu retrievalu (dzis poziom 1 ADR-0005 = dokument klienta;
// poziom 2/3 SAOS/ISAP/EUR-Lex dopina sourceKind przy wpieciu resolverow).

/** Skad pobrano zrodlo cytatu - podawane przez warstwe retrievalu. */
export type SourceKind = "saos" | "isap" | "eurlex" | "client-doc" | "none";

/** Tag proweniencji - POCHODZENIE twierdzenia (nie pewnosc). Enum bezpieczny do UI/audytu. */
export type ProvenanceTag = "saos" | "isap" | "eurlex" | "uzytkownik" | "model";

export interface Provenance {
    /** Skad pochodzi twierdzenie. */
    tag: ProvenanceTag;
    /**
     * Pinpoint (numer jednostki redakcyjnej) ZAWSZE wymaga weryfikacji - nawet gdy
     * zrodlo pobrane. Wyprowadzone deterministycznie z tekstu cytatu.
     */
    pinpoint: boolean;
}

/** Mapowanie rodzaju zrodla na tag. 'none' (brak retrievalu) -> model (DEFAULT). */
const SOURCE_KIND_TO_TAG: Record<SourceKind, ProvenanceTag> = {
    saos: "saos",
    isap: "isap",
    eurlex: "eurlex",
    "client-doc": "uzytkownik",
    none: "model",
};

/**
 * Wykrywa cytat pinpoint (numer jednostki redakcyjnej / identyfikator pinpoint) -
 * deterministycznie, regex, bez LLM. Pinpoint => zawsze flaga weryfikacji (regula A).
 * Celowo waski wzorzec (art./ust./par./pkt + CELEX), by ograniczyc falszywe trafienia.
 */
const PINPOINT_RE =
    /\bart\.?\s*\d|\bust\.?\s*\d|§\s*\d|\bpkt\s*\d|\bCELEX/i;

export function detectPinpoint(text: string | null | undefined): boolean {
    if (!text) return false;
    return PINPOINT_RE.test(text);
}

/**
 * Wyprowadza proweniencje DETERMINISTYCZNIE z rodzaju zrodla + tekstu cytatu.
 * Brak/nieznane zrodlo -> { tag: "model" } (regula twarda: default = wiedza modelu).
 */
export function deriveProvenance(
    sourceKind: SourceKind,
    citationText?: string | null,
): Provenance {
    return {
        tag: SOURCE_KIND_TO_TAG[sourceKind],
        pinpoint: detectPinpoint(citationText),
    };
}

/** Bazowa etykieta tagu (UI bierze enum + i18n; to tylko log/debug). Zero PII. */
const TAG_LABEL: Record<ProvenanceTag, string> = {
    saos: "SAOS",
    isap: "ISAP/ELI",
    eurlex: "EUR-Lex",
    uzytkownik: "uzytkownik",
    model: "model - zweryfikuj",
};

/**
 * Etykieta do logu/debugu. 'model' niesie juz "zweryfikuj"; tag pobrany + pinpoint
 * dostaje przyrostek "- zweryfikuj" (regula: pinpoint zawsze weryfikuj).
 */
export function provenanceLabel(p: Provenance): string {
    const base = TAG_LABEL[p.tag];
    if (p.tag === "model") return base;
    return p.pinpoint ? `${base} - zweryfikuj` : base;
}
