// Typy warstwy skanu bezpieczenstwa dokumentu wejsciowego (input document
// security pipeline). Skan dzieje sie LOKALNIE, deterministycznie, zero-LLM,
// ZANIM tresc trafi do modelu lub indeksu RAG.
//
// Zobacz governance/adr/0019-input-document-security-pipeline-pl.md:
// skeleton dziedziczy AGPL-3.0 po patron; cherry-pick WZORCA architektonicznego
// z jdai-ca/atticus (Apache-2.0, snapshot 2026-05-22) - detektory napisane od
// zera pod jezyk polski. NIE wpiety w upload.ts/RAG/streamChatWithTools (to
// osobna decyzja, przyszly ADR-0020).

/**
 * Kategoria zagrozenia wykrytego w dokumencie wejsciowym.
 * - adversarial: proba manipulacji modelem (prompt-injection, jailbreak, context-stuffing)
 * - steganography: ukryta tresc (zero-width chars, ukryte warstwy/akcje PDF)
 * - obfuscation: zaciemnianie (lancuchy enkodowania, homoglify mieszanego pisma)
 * - evasion: techniki omijania detekcji (token-splitting, znaki sterujace bidi/tag)
 */
export type ThreatCategory =
    | "adversarial"
    | "steganography"
    | "obfuscation"
    | "evasion";

/**
 * Waga pojedynczego znaleziska. Mapuje sie na wklad do `riskScore` w `scorer.ts`.
 * `critical` zarezerwowane dla sygnalow jednoznacznych (np. ukryta akcja
 * `/OpenAction` w PDF) - tylko one moga prowadzic do autonomicznego `blocked`.
 * Reszta kieruje do `human_review` (Konstytucja Art. 6 - human in the loop).
 */
export type Severity = "low" | "medium" | "high" | "critical";

/**
 * Pojedyncze znalezisko detektora. `evidence` jest skrocone i bezpieczne do
 * zalogowania (nie zawiera calego dokumentu). `decoded` wystepuje tylko dla
 * obfuscation, gdy udalo sie odkodowac warstwe.
 */
export interface SecurityFinding {
    category: ThreatCategory;
    /** Identyfikator techniki, np. "prompt-injection-pl", "zero-width-chars". */
    technique: string;
    severity: Severity;
    /** Pewnosc detektora 0-100 (heurystyczna - patrz ADR-0019, sekcja "Co piszemy od zera"). */
    confidence: number;
    /** Krotki, bezpieczny do logu dowod (max ~120 znakow). */
    evidence: string;
    /** Wplyw na model/sprawe - dla raportu i decyzji Inspektora. */
    impact: string;
    /** Odkodowana tresc warstwy obfuscation, jezeli dotyczy (skrocona). */
    decoded?: string;
}

/**
 * Akcja zalecana po skanie. Mapuje sie na role governance w ADR wpiecia:
 * - allowed: tresc moze przejsc do modelu
 * - quarantined: przed dalszym przetwarzaniem zastosuj redakcje / odrzuc warstwe
 * - human_review: ciezsze znaleziska - decyzje podejmuje czlowiek (Art. 6)
 * - blocked: tylko sygnaly jednoznaczne (malicious magic-byte, akcja PDF)
 */
export type SecurityAction =
    | "allowed"
    | "quarantined"
    | "human_review"
    | "blocked";

export type ThreatLevel = "low" | "medium" | "high" | "critical";

/**
 * Wejscie do pipeline. Skeleton operuje na JUZ WYEKSTRAHOWANYM tekscie -
 * ekstrakcje z PDF/docx robi istniejacy `convert.ts` (NIE wprowadzamy nowego
 * parsera, patrz ADR-0019 Konsekwencje). `buffer` opcjonalny, uzywany tylko
 * przez detektory binarne (np. surowy skan PDF pod katem ukrytych akcji).
 */
export interface SecurityScanInput {
    /** Wyekstrahowany tekst dokumentu. */
    text: string;
    /** Nazwa pliku (do raportu). */
    fileName?: string;
    /** Zadeklarowany MIME/typ (np. "application/pdf"). */
    declaredType?: string;
    /** Surowy bufor pliku - opcjonalny, dla detektorow binarnych. */
    buffer?: Uint8Array;
}

/**
 * Wynik skanu. Trafia do hash-chain audit logu (ADR-0001) jako zdarzenie
 * `input_security_scan` i do audit bundle (ADR-0006).
 */
export interface SecurityScanResult {
    /** Identyfikator raportu (do korelacji z audit logiem). */
    reportId: string;
    timestamp: string;
    fileName?: string;
    threatLevel: ThreatLevel;
    action: SecurityAction;
    /** Wynik 0-100. */
    riskScore: number;
    findings: SecurityFinding[];
    /** Czytelne dla czlowieka uzasadnienie decyzji (PL). */
    summary: string;
    /** Zalecenia operacyjne dla roli governance. */
    recommendations: string[];
}

/**
 * Wspolny ksztalt detektora. Kazdy detektor jest czysta funkcja
 * deterministyczna - bez sieci, bez LLM, bez stanu (Konstytucja Art. 1, Art. 8;
 * spojnie z zero-LLM ADR-0008).
 */
export interface Detector {
    /** Identyfikator (do telemetrii). */
    id: string;
    category: ThreatCategory;
    run(input: SecurityScanInput): SecurityFinding[];
}
