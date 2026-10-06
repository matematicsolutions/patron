// Privilege ring policy dla wywolan narzedzi MCP - decyzja runtime (per call)
// czy konkretne wywolanie powinno przejsc. Implementacja ADR-0027.
//
// 3 ringi w Patronie (adaptacja modelu 4-ring Microsoft Agent Governance Toolkit
// do skali kancelarii - patrz ADR-0024):
//   Ring 0 - System (skrypty wewnetrzne Patrona, audit, healthcheck).
//            Obecnie BRAK call-sites w kodzie - rezerwacja dokumentacyjna.
//   Ring 1 - Trusted MCP (konektory Patrona z APPROVED_PATRON_CONNECTORS,
//            WOZONE PRZEZ PLIK INSTALATORA - configSource "installer").
//            Action: allow + audit. Sama nazwa nie wystarcza (B-06 / R-MCP-01):
//            nakladka Operatora moze dodac wpis "de-eli" z dowolna komenda w
//            edycji, ktora go nie wozi - taki wpis jest Ring 2 (ADR-0166).
//   Ring 2 - Untrusted (jakikolwiek konektor poza Ring 1, w tym 3rd-party MCP).
//            Default action: deny (fail-closed).
//            Explicit allow gdy Operator zatwierdzil konektor: zgodne
//            `gatewayApproval` (hash definicji + odcisk pochodzenia, ADR-0158;
//            od B-08 / 2026-10-06 jeden krok wystarcza) albo operatorApproved=true
//            w nakladce Operatora (ADR-0166).
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
    | "operator-gateway-approval"    // Ring 2 allow - zgodne gatewayApproval (B-08, ADR-0158)
    | "trusted-name-outside-installer" // Ring 2 deny - nazwa z listy, ale wpis nie z pliku instalatora
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
    /**
     * Skad pochodzi wpis konektora (mergeOperatorOverlay, ADR-0166). Ring 1
     * wymaga "installer"; brak pola = nie z instalatora (fail-closed).
     */
    configSource?: "installer" | "operator-overlay";
    /**
     * B-08 (decyzja wlasciciela produktu 2026-10-06): brama przy starcie przyjela
     * zgodne `gatewayApproval` Operatora dla TEJ definicji i TEGO pochodzenia
     * (resolveOperatorApproval === "approved"). Ustawia WYLACZNIE lib/mcp po
     * skanie - nigdy z pliku konfiguracji. Zatwierdzenie przypiete do hasha jest
     * mocniejsze niz boolean operatorApproved, wiec wystarcza do Ring 2 allow:
     * jedno swiadome zatwierdzenie zamiast dwoch, z ktorych jedno samo w sobie
     * zostawialo stan "narzedzia u modelu, kazde wywolanie odrzucone".
     */
    gatewayApproved?: boolean;
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
    // Ring 1: nazwa w canonical list konektorow Patrona (MateMatic-utrzymywana)
    // ORAZ wpis z pliku instalatora. Operator NIE moze podniesc konektora do
    // Ring 1 przez konfig - nazwa wymaga zmiany kodu (APPROVED_PATRON_CONNECTORS),
    // a nakladka (ADR-0166) nie nadaje pochodzenia "installer".
    const trustedName = APPROVED_PATRON_CONNECTORS.includes(serverName);
    if (trustedName && config?.configSource === "installer") {
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

    // Ring 2 allow: brama przyjela zgodne zatwierdzenie Operatora (hash +
    // pochodzenie) dla tej definicji w tym procesie (B-08, ADR-0158).
    if (config?.gatewayApproved === true) {
        return {
            ring: 2,
            action: "allow",
            reason: "operator-gateway-approval",
        };
    }

    // Ring 2 default: fail-closed. Nieznany konektor (albo nazwa zaufana spoza
    // pliku instalatora) + brak explicit approval.
    return {
        ring: 2,
        action: "deny",
        reason: trustedName ? "trusted-name-outside-installer" : "no-operator-approval",
    };
}
