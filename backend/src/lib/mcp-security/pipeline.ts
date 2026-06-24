// Orchestrator skanu rejestru konektorow MCP. 5-fazowy wzorzec spojny z
// input-security/pipeline.ts (ADR-0019). Pattern (4 detektory, scan przed
// zaladowaniem) cherry-picked z Microsoft AGT (ADR-0024/0025).
//
// Czysta funkcja, zero-LLM, zero-cloud, bezstanowa. WPIETA w startup backendu
// przez `lib/mcp/index.ts` (scanMcpRegistry przed registracja toolow), ADR-0028.

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
 * Lista zatwierdzonych nazw konektorow Patrona (canonical) na 2026-06-03.
 * MUSI odpowiadac realnym nazwom z mcp-servers.json / mcp-servers.example.json
 * oraz bundlowanym w instalatorze (desktop/scripts/prepare-resources.cjs,
 * scripts/bundle-mcp.cjs). Nazwa spoza tej listy w odleglosci Levenshteina <=2
 * od ktorejkolwiek z nich = typosquat critical (denied). Stad rozjazd nazw
 * blokuje WLASNY konektor: np. realny 'nsa' przy stalej 'nsa-orzeczenia' byl
 * blokowany jako typosquat 'isap' (dist=2). Dodajac konektor - dopisz tu jego
 * dokladna nazwe.
 */
export const APPROVED_PATRON_CONNECTORS: ReadonlyArray<string> = [
    "saos",
    "nsa",
    "isap",
    "krs",
    "eu-sparql",
    "eu-compliance",
    // ADR-0133/0134: konektory krajowe UE (Python, runtime frozen-exe w bundlu
    // desktop; w dev/serwer uruchamiane przez uv). Dodane po REALNYM gateway-scan
    // 2026-06-24 - wszystkie 9: action=audit, threat=low, risk=2, ZERO
    // hidden-instructions/tool-poisoning (jedyne findingi: not-approved +
    // first-baseline, znikaja po dodaniu tutaj). Bundle PyInstaller = osobny krok.
    "de-eli",
    "at-eli",
    "es-eli",
    "fi-eli",
    "ie-eli",
    "nl-eli",
    "se-eli",
    "fr-eli",
    "lu-eli",
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
