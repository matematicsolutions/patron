// Barrel exportu warstwy MCP Security Gateway.
//
// Skeleton (ADR-0025) - NIE wpiety w startup backendu.
// Wpiecie w kontrakt MCP to osobny ADR-0028.

export * from "./types";
export {
    scanMcpServer,
    scanMcpRegistry,
    buildScanContext,
    DEFAULT_DETECTORS,
    APPROVED_PATRON_CONNECTORS,
} from "./pipeline";
export { calculateRiskScore, decideAction, toThreatLevel, worstAction } from "./scorer";
export { buildReport } from "./report";
export {
    typosquatDetector,
    levenshtein,
    isUnknownThirdPartyFinding,
    awaitsOnlyThirdPartyApproval,
    UNKNOWN_THIRD_PARTY_SEVERITY,
} from "./detectors/typosquat";
export {
    driftDetector,
    computeDefinitionHash,
    computeLegacyDefinitionHash,
    computeOriginFingerprint,
    isOriginDriftFinding,
    formatBaselineEntry,
    parseBaselineEntry,
    DRIFT_BASELINE_VERSION,
    type ParsedBaselineEntry,
} from "./detectors/drift";
export { hiddenInstructionsDetector } from "./detectors/hidden-instructions";
export { toolPoisoningDetector } from "./detectors/tool-poisoning";
export {
    computeApprovalHash,
    resolveOperatorApproval,
    type GatewayApproval,
    type OperatorApprovalDecision,
    type OperatorApprovalStatus,
    type ResolveApprovalOptions,
} from "./operator-approval";
