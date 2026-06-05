// Kontrakt wpiecia skanu w ingest dokumentow (ADR-0020). Czyste, testowalne
// funkcje - mapowanie wyniku skanu na zachowanie ingestu oraz payload audytu.
// Sama integracja w handleDocumentUpload uzywa tych funkcji (routes/documents.ts).

import type { SecurityAction, SecurityScanResult } from "./types";

/**
 * Tryb EGZEKWOWANIA input-security (ADR-0105). Domyslnie OFF = "open mode":
 * detekcja DALEJ dziala (skan + audit_log + securityStatus -> badge w UI), ale
 * NIC nie jest ukrywane - kazdy dokument ingestuje sie jako ready+indeksowalny,
 * a odczyt read-time nie jest wstrzymywany. Powod: PATRON to desktop single-user,
 * gdzie Operator (adwokat) JEST czlowiekiem w petli i wciaga WLASNE akta; ostre
 * gardlowanie kwarantannowalo zeskanowane akta papierowe (false-positive HIGH na
 * szumie OCR) -> produkt "nie czytal dokumentow" (pilot Beata). Filozofia: najpierw
 * otwarte i uzyteczne, rygor pozniej na wniosek praktykow. Hardened/serwerowy
 * deployment wlacza egzekwowanie: PATRON_INPUT_SECURITY_ENFORCE=1.
 */
export function inputSecurityEnforce(): boolean {
    const v = process.env.PATRON_INPUT_SECURITY_ENFORCE?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
}

/**
 * Zachowanie ingestu dla danej akcji skanu.
 * - enforce=false (OPEN, domyslne): kazda akcja -> 201 ready, persist+index;
 *   securityStatus niesie wykryta akcje (badge/audyt zachowane).
 * - enforce=true (ADR-0020, hardened): allowed -> 201 ready index; quarantined ->
 *   201 ready bez indeksu; human_review -> 202 review bez indeksu; blocked -> 422.
 */
export interface IngestOutcome {
    /** Kod HTTP odpowiedzi ingestu. */
    httpStatus: 201 | 202 | 422;
    /** Wartosc kolumny documents.status. */
    documentStatus: "ready" | "review" | "error";
    /** Wartosc kolumny documents.security_status. */
    securityStatus: SecurityAction;
    /** Czy utrwalac bajty pliku w storage. blocked = false. */
    persist: boolean;
    /** Czy dokument moze trafic do indeksu RAG. */
    allowIndex: boolean;
}

export function resolveIngestOutcome(
    result: SecurityScanResult,
    enforce: boolean = false,
): IngestOutcome {
    // OPEN mode (domyslne): utrwal i indeksuj zawsze; securityStatus = wykryta
    // akcja (badge w UI + audit_log nietkniete). Operator widzi ostrzezenie, ale
    // jego wlasne akta sa zawsze dostepne w wyszukiwaniu (ADR-0105).
    if (!enforce) {
        return {
            httpStatus: 201,
            documentStatus: "ready",
            securityStatus: result.action,
            persist: true,
            allowIndex: true,
        };
    }
    switch (result.action) {
        case "blocked":
            return {
                httpStatus: 422,
                documentStatus: "error",
                securityStatus: "blocked",
                persist: false,
                allowIndex: false,
            };
        case "human_review":
            return {
                httpStatus: 202,
                documentStatus: "review",
                securityStatus: "human_review",
                persist: true,
                allowIndex: false,
            };
        case "quarantined":
            return {
                httpStatus: 201,
                documentStatus: "ready",
                securityStatus: "quarantined",
                persist: true,
                allowIndex: false,
            };
        case "allowed":
        default:
            return {
                httpStatus: 201,
                documentStatus: "ready",
                securityStatus: "allowed",
                persist: true,
                allowIndex: true,
            };
    }
}

/**
 * Payload do audit_log (zdarzenie `input_security_scan`, ADR-0001). Bez
 * surowego `evidence` (moze zawierac fragment wrogiej tresci) - logujemy tylko
 * metadane potrzebne audytorowi (AI Act art. 12): co wykryto, jak ciezkie,
 * jaka decyzja. Skrot pliku dokladany po stronie wywolujacego (zna bajty).
 */
export function toAuditPayload(result: SecurityScanResult): Record<string, unknown> {
    return {
        report_id: result.reportId,
        action: result.action,
        threat_level: result.threatLevel,
        risk_score: result.riskScore,
        file_name: result.fileName ?? null,
        findings: result.findings.map((f) => ({
            category: f.category,
            technique: f.technique,
            severity: f.severity,
            confidence: f.confidence,
        })),
    };
}

export const INPUT_SECURITY_AUDIT_EVENT = "input_security_scan" as const;

/**
 * Twardy sygnal manipulacji - kwalifikuje do wstrzymania na sciezce read-time
 * (ADR-0020 W4, obrona w glab).
 * - enforce=false (OPEN, domyslne): NIGDY nie wstrzymuje - skan i tak sie wykonal
 *   (log/badge), ale tresc trafia do modelu (ADR-0105). Operator decyduje.
 * - enforce=true (hardened): `blocked` (critical) i `human_review` (high) blokuja
 *   odczyt; `quarantined`/`allowed` nie (zbyt agresywne).
 */
export function isHardThreat(
    result: SecurityScanResult,
    enforce: boolean = false,
): boolean {
    if (!enforce) return false;
    return result.action === "blocked" || result.action === "human_review";
}
