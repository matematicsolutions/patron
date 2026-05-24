// Orchestrator skanu rejestru konektorow MCP. 5-fazowy wzorzec spojny z
// input-security/pipeline.ts (ADR-0019). Pattern (4 detektory, scan przed
// zaladowaniem) cherry-picked z Microsoft AGT (ADR-0024/0025).
//
// SKELETON: czysta funkcja, zero-LLM, zero-cloud, bezstanowa. NIE wpieta
// w startup backendu - wpiecie to osobna decyzja (przyszly ADR-0028).

import type {
    McpDetector,
    McpScanContext,
    McpScanReport,
    McpServerDefinition,
    McpServerScanResult,
} from "./types";
import { typosquatDetector } from "./detectors/typosquat";
import { driftDetector, computeDefinitionHash } from "./detectors/drift";
import { hiddenInstructionsDetector } from "./detectors/hidden-instructions";
import { toolPoisoningDetector } from "./detectors/tool-poisoning";
import { calculateRiskScore, decideAction, toThreatLevel } from "./scorer";
import { buildReport } from "./report";

/** Domyslny zestaw detektorow. Kolejnosc nie ma znaczenia (sumuja sie). */
export const DEFAULT_DETECTORS: McpDetector[] = [
    typosquatDetector,
    driftDetector,
    hiddenInstructionsDetector,
    toolPoisoningDetector,
];

/**
 * Lista zatwierdzonych nazw konektorow Patrona (canonical) na 2026-05-24.
 * Aktualizowana razem z `mcp-servers.example.json` przy dodaniu nowego konektora.
 */
export const APPROVED_PATRON_CONNECTORS: ReadonlyArray<string> = [
    "saos",
    "eu-compliance",
    "krs",
    "isap",
    "sn-orzeczenia",
    "nsa-orzeczenia",
];

/** Skanuje pojedynczy konektor MCP. */
export function scanMcpServer(
    server: McpServerDefinition,
    context: McpScanContext,
    detectors: ReadonlyArray<McpDetector> = DEFAULT_DETECTORS,
): McpServerScanResult {
    const findings = detectors.flatMap((d) => d.run(server, context));
    const riskScore = calculateRiskScore(findings);
    const threatLevel = toThreatLevel(findings);
    const action = decideAction(findings);
    const currentHash = computeDefinitionHash(server);
    return {
        serverName: server.name,
        findings,
        riskScore,
        threatLevel,
        action,
        currentHash,
    };
}

/** Skanuje cala liste konektorow, zwraca agregowany raport. */
export function scanMcpRegistry(
    servers: ReadonlyArray<McpServerDefinition>,
    context: McpScanContext,
    detectors: ReadonlyArray<McpDetector> = DEFAULT_DETECTORS,
): McpScanReport {
    const perServer = servers.map((s) => scanMcpServer(s, context, detectors));
    return buildReport(perServer);
}

/**
 * Builder kontekstu z domyslnymi approved + przekazanym baseline.
 * Convenience helper dla wywolujacych z startup backendu.
 */
export function buildScanContext(
    driftBaseline: ReadonlyMap<string, string> = new Map(),
    approvedNames: ReadonlyArray<string> = APPROVED_PATRON_CONNECTORS,
): McpScanContext {
    return {
        approvedNames: new Set(approvedNames),
        driftBaseline,
    };
}
