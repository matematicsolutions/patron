// Scoring ryzyka i mapowanie na akcje. Heurystyczny - patrz ADR-0019:
// ciezsze znaleziska kieruja do `human_review` (Konstytucja Art. 6), a NIE do
// autonomicznego `blocked`. `blocked` zarezerwowane wylacznie dla znalezisk
// `critical` (np. PDF z akcja automatyczna).

import type {
    SecurityAction,
    SecurityFinding,
    Severity,
    ThreatLevel,
} from "./types";

const SEVERITY_WEIGHT: Record<Severity, number> = {
    low: 8,
    medium: 20,
    high: 40,
    critical: 100,
};

/**
 * Sumuje wagi znalezisk wazone pewnoscia, przycina do 0-100.
 */
export function calculateRiskScore(findings: SecurityFinding[]): number {
    if (findings.length === 0) return 0;
    let score = 0;
    for (const f of findings) {
        score += SEVERITY_WEIGHT[f.severity] * (f.confidence / 100);
    }
    return Math.min(Math.round(score), 100);
}

export function toThreatLevel(score: number, findings: SecurityFinding[]): ThreatLevel {
    if (findings.some((f) => f.severity === "critical")) return "critical";
    if (score >= 60) return "high";
    if (score >= 25) return "medium";
    return "low";
}

/**
 * Mapowanie na akcje. Reguly:
 * - critical finding -> blocked (jednoznaczne, np. /OpenAction w PDF)
 * - high threat (bez critical) -> human_review (Art. 6 - czlowiek decyduje)
 * - medium -> quarantined (redakcja/odrzucenie warstwy przed dalszym ciagiem)
 * - low / brak -> allowed
 */
export function decideAction(level: ThreatLevel): SecurityAction {
    switch (level) {
        case "critical":
            return "blocked";
        case "high":
            return "human_review";
        case "medium":
            return "quarantined";
        case "low":
        default:
            return "allowed";
    }
}
