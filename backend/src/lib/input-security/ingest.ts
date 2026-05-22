// Kontrakt wpiecia skanu w ingest dokumentow (ADR-0020). Czyste, testowalne
// funkcje - mapowanie wyniku skanu na zachowanie ingestu oraz payload audytu.
// Sama integracja w handleDocumentUpload uzywa tych funkcji (routes/documents.ts).

import type { SecurityAction, SecurityScanResult } from "./types";

/**
 * Zachowanie ingestu dla danej akcji skanu. Mapowanie wg ADR-0020:
 * - allowed: utrwal i indeksuj normalnie (201, status ready, secutiy allowed)
 * - quarantined: utrwal, ale oznacz - RAG ma pominac do redakcji (201)
 * - human_review: utrwal (zeby Operator/Inspektor zobaczyl), status review,
 *   NIE ready, NIE indeksuj (202 Accepted)
 * - blocked: NIE utrwalaj bajtow, odrzuc (422)
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

export function resolveIngestOutcome(result: SecurityScanResult): IngestOutcome {
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

export const INPUT_SECURITY_AUDIT_EVENT = "input_security_scan";
