// Privilege ring policy dla wywolan narzedzi MCP - decyzja runtime (per call)
// czy konkretne wywolanie powinno przejsc. Implementacja ADR-0027.
//
// 3 ringi w Patronie (adaptacja modelu 4-ring Microsoft Agent Governance Toolkit
// do skali kancelarii - patrz ADR-0024):
//   Ring 0 - System (skrypty wewnetrzne Patrona, audit, healthcheck).
//            Obecnie BRAK call-sites w kodzie - rezerwacja dokumentacyjna.
//   Ring 1 - Trusted MCP (6 konektorow Patrona w APPROVED_PATRON_CONNECTORS).
//            Action: allow + audit.
//   Ring 2 - Untrusted (jakikolwiek konektor poza Ring 1, w tym 3rd-party MCP).
//            Default action: deny (fail-closed).
//            Explicit allow tylko gdy Operator wpisal operatorApproved=true
//            w mcp-servers.json.
//
// Komplementarne do MCP Security Gateway (ADR-0025/0028) ktore jest gate
// load-time (rejestracja konektora). Ring-policy jest gate runtime (per call).
// Razem - defense-in-depth.
//
// Funkcja decideRing jest PURE - zero side effects, zero IO, latwo testowalna
// w izolacji. Patrz ADR-0027 sekcja "Dlaczego decideRing jest pure function".

import { APPROVED_PATRON_CONNECTORS } from "../mcp-security";

export type RingNumber = 0 | 1 | 2;
export type RingAction = "allow" | "deny";

/**
 * Powod decyzji ring-policy. Wartosci enum (string union), wlasciwie czytane
 * przez audytora w polu payload.reason zdarzenia audit_log z event_type
 * "ring_policy.decision".
 */
export type RingReason =
    | "trusted-patron-connector"     // Ring 1 allow - nazwa w canonical list 6
    | "operator-approved-3rd-party"  // Ring 2 allow - operatorApproved=true
    | "no-operator-approval";        // Ring 2 deny - default fail-closed

export interface RingDecision {
    ring: RingNumber;
    action: RingAction;
    reason: RingReason;
}

/**
 * Czyta z konfiguracji konektora (subset McpServerConfig) tylko te pola, ktore
 * sa istotne dla decyzji ring-policy. Wszystkie opcjonalne - brak pola = default.
 */
export interface RingPolicyConfigInput {
    /** Deklarowany poziom zaufania. Pole informacyjne; decyzja nadal wymaga operatorApproved dla Ring 2. */
    trustLevel?: "trusted" | "untrusted";
    /** Wymagane dla Ring 2 allow. Brak / false = deny. */
    operatorApproved?: boolean;
    // Pola approvedAt / approvedBy istnieja w McpServerConfig dla audytora,
    // ale decideRing ich NIE czyta (nie wplywaja na decyzje). Patrz ADR-0027.
}

/**
 * Decyzja ring-policy dla wywolania narzedzia MCP. Pure function.
 *
 * @param serverName - nazwa serwera MCP (cz przed `__` w prefixowanej nazwie toola)
 * @param config - opcjonalna konfiguracja konektora z mcp-servers.json
 * @returns RingDecision do uzycia przez runMcpTool i propagacji do audit_log
 */
export function decideRing(
    serverName: string,
    config?: RingPolicyConfigInput,
): RingDecision {
    // Ring 1: nazwa w canonical list 6 konektorow Patrona (MateMatic-utrzymywana).
    // Operator NIE moze podniesc konektora do Ring 1 przez konfig - to wymaga
    // modyfikacji kodu (APPROVED_PATRON_CONNECTORS).
    if (APPROVED_PATRON_CONNECTORS.includes(serverName)) {
        return {
            ring: 1,
            action: "allow",
            reason: "trusted-patron-connector",
        };
    }

    // Ring 2 explicit allow: Operator wpisal operatorApproved=true.
    // Pole trustLevel jest informacyjne (audytor widzi w git diff) ale samo
    // w sobie nie wystarczy - wymagamy operatorApproved.
    if (config?.operatorApproved === true) {
        return {
            ring: 2,
            action: "allow",
            reason: "operator-approved-3rd-party",
        };
    }

    // Ring 2 default: fail-closed. Nieznany konektor + brak explicit approval.
    return {
        ring: 2,
        action: "deny",
        reason: "no-operator-approval",
    };
}
