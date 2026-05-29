// Barrel warstwy governance routingu LLM (ADR-0067).
//
// Straznik data-residency (decideRoute) + rejestr egress (egressForModel) +
// per-call audit (buildLlmRouteEvent / appendLlmRouteEvent). Punkt egzekwowania:
// lib/chat/stream.ts (PRZED wyjsciem do providera).
//
// Slownik: DataClassification + EgressFlag z lib/llm/provider.ts (ADR-0014).

export { egressForModel, isLocalModel, OLLAMA_PREFIX } from "./egress";
export {
    decideRoute,
    type RouteAction,
    type RouteReason,
    type RouteDecision,
    type RouteDecisionInput,
} from "./decideRoute";
export {
    buildLlmRouteEvent,
    appendLlmRouteEvent,
    providerLabelForModel,
    type LlmRouteUsage,
    type LlmRouteAuditInput,
} from "./auditLlmRoute";
export {
    resolveClassification,
    allowUsProviders,
    defaultLocalModel,
    type EgressGuardResult,
    guardEgress,
} from "./guard";
