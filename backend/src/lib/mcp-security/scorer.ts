// Scorer dla MCP Security Gateway. Sumuje findings per konektor, decyduje akcje.
// Wzorzec zgodny z input-security/scorer.ts (ADR-0019).

import type { McpAction, McpFinding, McpSeverity } from "./types";

/** Wklad pojedynczego findingu do risk score. */
const WEIGHTS: Record<McpSeverity, number> = {
    low: 1,
    medium: 4,
    high: 10,
    critical: 30,
};

export function calculateRiskScore(findings: ReadonlyArray<McpFinding>): number {
    return findings.reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
}

/** Najgorsza waga z findings - definiuje overall threat level konektora. */
export function toThreatLevel(findings: ReadonlyArray<McpFinding>): McpSeverity {
    let worst: McpSeverity = "low";
    const order: McpSeverity[] = ["low", "medium", "high", "critical"];
    for (const f of findings) {
        if (order.indexOf(f.severity) > order.indexOf(worst)) {
            worst = f.severity;
        }
    }
    return worst;
}

/**
 * Decyzja per konektor. Mapowanie threat level -> action.
 * - 0 findings: allowed
 * - tylko low (np. informational pierwszy load): audit
 * - medium: human_review
 * - high: human_review
 * - critical: denied
 */
export function decideAction(findings: ReadonlyArray<McpFinding>): McpAction {
    if (findings.length === 0) return "allowed";
    const level = toThreatLevel(findings);
    switch (level) {
        case "low":
            return "audit";
        case "medium":
            return "human_review";
        case "high":
            return "human_review";
        case "critical":
            return "denied";
    }
}

/** Wybiera najgorsza akcje sposrod listy (dla overall report). */
export function worstAction(actions: ReadonlyArray<McpAction>): McpAction {
    const order: McpAction[] = ["allowed", "audit", "human_review", "denied"];
    let worst: McpAction = "allowed";
    for (const a of actions) {
        if (order.indexOf(a) > order.indexOf(worst)) {
            worst = a;
        }
    }
    return worst;
}
