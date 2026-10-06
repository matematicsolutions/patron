// Polaczenie "Sprawdz powolania" (ADR-0157) z konektorem MCP.
//
// Repertorium jest serwisem ZDALNYM (HTTP), wiec NIE ma go na liscie zaufanych
// konektorow Patrona (APPROVED_PATRON_CONNECTORS = konektory bundlowane w
// instalatorze). Operator dopisuje go w nakladce ~/.patron/mcp-servers.operator.json
// (ADR-0166 - plik instalatora ginie przy aktualizacji) jako Ring 2 z
// `operatorApproved: true` - ta sama sciezka co kazdy konektor 3rd-party:
// brama bezpieczenstwa przy starcie (ADR-0028) i ring-policy przy kazdym
// wywolaniu (ADR-0027, zdarzenie `ring_policy.decision` w lancuchu audytu).
// Brama daje Repertorium `human_review` (konektor spoza zaufanego zestawu -
// B-08, decyzja 2026-10-06; wczesniej falszywe alarmy o polach wyniku), wiec
// Operator po przegladzie wpisuje `gatewayApproval` (hash + origin, ADR-0158).
// To jedno zatwierdzenie wystarcza - dopuszcza tez wywolania Ring 2; zanim je
// wpisze, trasa zwraca jawny stan `gateway_pending` (verifierPendingApproval).
// Adres konektora z kluczem dostepu zyje wylacznie w lokalnej nakladce Operatora.
//
// R-CC-07: narzedzia serwera weryfikatora NIE sa narzedziami czatu (lib/mcp
// ukrywa je przed modelem i odmawia im w runMcpTool). Ta trasa wola je jedynym
// wejsciem `runCitationVerifier`, ktore przepuszcza tylko tryb listy.

import {
    getGatewayState,
    getMcpTools,
    hasCitationVerifier,
    isAwaitingOperatorApproval,
    runCitationVerifier,
} from "../mcp";
import { verifierServerName } from "../mcp/verifier";
import type { VerifyToolCall } from "./index";

export { verifierServerName, VERIFY_TOOL } from "../mcp/verifier";

/**
 * Zwraca funkcje wywolania `verify_citations` albo null, gdy konektor nie jest
 * skonfigurowany, nie wstal albo zostal zablokowany przez brame bezpieczenstwa.
 */
export async function resolveVerifyToolCall(): Promise<VerifyToolCall | null> {
    try {
        await getMcpTools();
    } catch {
        return null;
    }
    if (!hasCitationVerifier()) return null;
    return async (args) => {
        const r = await runCitationVerifier(args);
        return { text: r.text, structured: r.structured, isError: r.isError };
    };
}

/**
 * Konektor weryfikatora czeka na zatwierdzenie Operatora (B-08 / ADR-0158):
 * skonfigurowany, wstal, ale brama dala `human_review` bez zgodnego
 * `gatewayApproval`. Zwraca wartosci do wpisania w nakladce Operatora (skroty
 * SHA-256 - bez adresu i klucza). Czytac PO resolveVerifyToolCall (stan bramy
 * powstaje w getMcpTools). null = nie czeka (brak konektora, zablokowany
 * `denied`, nie wstal albo zarejestrowany).
 */
export interface VerifierPendingApproval {
    server: string;
    hash: string;
    origin: string;
    /** missing = brak zatwierdzenia; hash_mismatch = zatwierdzono inna definicje. */
    reason: "missing" | "hash_mismatch";
}

export function verifierPendingApproval(): VerifierPendingApproval | null {
    const server = verifierServerName();
    const state = getGatewayState(server);
    if (!state || !isAwaitingOperatorApproval(state)) return null;
    return {
        server,
        hash: state.approvalHash,
        origin: state.approvalOrigin,
        reason: state.approval === "hash_mismatch" ? "hash_mismatch" : "missing",
    };
}
