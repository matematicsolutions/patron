// Detektor typosquat dla MCP Security Gateway.
//
// Wykrywa nazwy konektorow MCP, ktore mylia sie z nazwami zatwierdzonych
// konektorow Patrona (atak namespace phishing). Wzorzec cherry-picked z
// Microsoft AGT (ADR-0024/0025). Algorytm: Levenshtein distance vs lista
// approvedNames przekazana w kontekscie.
//
// Decyzja per znalezisko:
//   dist = 0                    -> zatwierdzony (zaden finding, allowed)
//   0 < dist <= 2               -> typosquat critical (denied)
//   2 < dist <= 4               -> typosquat suspect (human_review)
//   dist > 4                    -> nieznany 3rd-party (human_review, finding low)

import type { McpDetector, McpFinding, McpScanContext, McpServerDefinition } from "../types";

/** Klasyczny Levenshtein O(n*m), wystarczajacy dla nazw < 50 znakow. */
export function levenshtein(a: string, b: string): number {
    const A = a.toLowerCase();
    const B = b.toLowerCase();
    const n = A.length;
    const m = B.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 0; i <= n; i += 1) dp[i][0] = i;
    for (let j = 0; j <= m; j += 1) dp[0][j] = j;
    for (let i = 1; i <= n; i += 1) {
        for (let j = 1; j <= m; j += 1) {
            const cost = A[i - 1] === B[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            );
        }
    }
    return dp[n][m];
}

export const typosquatDetector: McpDetector = {
    name: "typosquat",
    run(server: McpServerDefinition, context: McpScanContext): McpFinding[] {
        const approved = [...context.approvedNames];
        if (approved.length === 0) return [];

        let minDist = Number.POSITIVE_INFINITY;
        let nearest = "";
        for (const name of approved) {
            const d = levenshtein(server.name, name);
            if (d < minDist) {
                minDist = d;
                nearest = name;
            }
        }

        if (minDist === 0) {
            return [];
        }

        if (minDist <= 2) {
            return [{
                detector: "typosquat",
                category: "typosquat",
                severity: "critical",
                serverName: server.name,
                message: `Nazwa konektora '${server.name}' rozni sie tylko o ${minDist} znak(i) od zatwierdzonego '${nearest}'. Mozliwy atak namespace phishing.`,
                sample: `nearest=${nearest} dist=${minDist}`,
            }];
        }

        if (minDist <= 4) {
            return [{
                detector: "typosquat",
                category: "typosquat",
                severity: "high",
                serverName: server.name,
                message: `Nazwa konektora '${server.name}' jest podobna do zatwierdzonego '${nearest}' (dist=${minDist}). Wymaga decyzji Operatora.`,
                sample: `nearest=${nearest} dist=${minDist}`,
            }];
        }

        return [{
            detector: "typosquat",
            category: "typosquat",
            severity: "low",
            serverName: server.name,
            message: `Konektor '${server.name}' nie znajduje sie na liscie zatwierdzonych (najblizszy: '${nearest}', dist=${minDist}). 3rd-party - wymaga zatwierdzenia Operatora.`,
            sample: `nearest=${nearest} dist=${minDist}`,
        }];
    },
};
