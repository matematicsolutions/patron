// Builder raportu calego skanu rejestru MCP. Spojny z input-security/report.ts.

import type { McpScanReport, McpServerScanResult } from "./types";
import { worstAction } from "./scorer";

export function buildReport(perServer: ReadonlyArray<McpServerScanResult>): McpScanReport {
    let allowed = 0;
    let audit = 0;
    let humanReview = 0;
    let denied = 0;
    for (const r of perServer) {
        switch (r.action) {
            case "allowed":
                allowed += 1;
                break;
            case "audit":
                audit += 1;
                break;
            case "human_review":
                humanReview += 1;
                break;
            case "denied":
                denied += 1;
                break;
        }
    }
    const overall = worstAction(perServer.map((r) => r.action));
    return {
        timestamp: new Date().toISOString(),
        totalServers: perServer.length,
        allowed,
        audit,
        humanReview,
        denied,
        perServer: [...perServer],
        overallAction: overall,
    };
}
