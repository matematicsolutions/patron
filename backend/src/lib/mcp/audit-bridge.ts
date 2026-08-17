// Bridge miedzy MCP Security Gateway (lib/mcp-security) a audit hash-chain
// (lib/audit). Implementuje ADR-0033 - propagacja decyzji Gateway'a (audit /
// human_review / denied) do tabeli audit_log z event_type = "mcp_security.gateway".
//
// Modul dziala w trybie wyslij-i-zapomnij: porazka audit_log NIE blokuje
// rejestracji toolow MCP (Konstytucja Art. 8 stalosc kontraktow). Brak env SUPABASE_URL /
// SUPABASE_SECRET_KEY = graceful no-op (analogicznie do loadConfig w
// lib/mcp/index.ts, ktore no-op gdy mcp-servers.json nie istnieje).
//
// Payload zawiera WYLACZNIE metadata skanu (server_name, action, risk_score,
// findings_count, findings[detector,severity,message]). Pole `sample` z
// McpFinding jest POMINIETE - patrz ADR-0033 sekcja "Co NIE jest w payload".

import { appendAuditEvent } from "../audit";
import { createServerSupabase } from "../supabase";
import type { McpAction, McpFinding } from "../mcp-security";
import type { RingDecision } from "./ring-policy";

export const MCP_SECURITY_EVENT_TYPE = "mcp_security.gateway" as const;
export const RING_POLICY_EVENT_TYPE = "ring_policy.decision" as const;

export interface RecordMcpSecurityEventArgs {
    serverName: string;
    action: McpAction;
    riskScore: number;
    findings: ReadonlyArray<McpFinding>;
}

export interface RecordMcpSecurityEventResult {
    ok: boolean;
    reason?: "env_missing" | "audit_failed";
}

/**
 * Dependency injection seam dla testow: pozwala wstrzyknac mock zamiast
 * realnego createServerSupabase. Test podaje swoja fabryke; produkcja uzywa
 * domyslnej, ktora wpada w try/catch przy brakujacym env.
 */
export type SupabaseFactory = () => ReturnType<typeof createServerSupabase>;

function defaultSupabaseFactory(): ReturnType<typeof createServerSupabase> {
    return createServerSupabase();
}

/**
 * Zapisuje decyzje MCP Security Gateway do audit_log z hash-chain
 * (event_type = "mcp_security.gateway"). Nigdy nie rzuca - bledy zwracane
 * w polu `reason`. Patrz ADR-0033.
 */
export async function recordMcpSecurityEvent(
    args: RecordMcpSecurityEventArgs,
    factory: SupabaseFactory = defaultSupabaseFactory,
): Promise<RecordMcpSecurityEventResult> {
    let db: ReturnType<typeof createServerSupabase>;
    try {
        db = factory();
    } catch {
        // Brak SUPABASE_URL / SUPABASE_SECRET_KEY - graceful no-op,
        // analogicznie do loadConfig w lib/mcp/index.ts.
        return { ok: false, reason: "env_missing" };
    }

    // Minimalizacja danych (Konstytucja Art. 7): bez `sample`, tylko 3 pola
    // na finding. Patrz ADR-0033 sekcja "Co NIE jest w payload".
    const findingsForAudit = args.findings.map((f) => ({
        detector: f.detector,
        severity: f.severity,
        message: f.message,
    }));

    const result = await appendAuditEvent(db, {
        event_type: MCP_SECURITY_EVENT_TYPE,
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload: {
            server_name: args.serverName,
            action: args.action,
            risk_score: args.riskScore,
            findings_count: args.findings.length,
            findings: findingsForAudit,
        },
    });

    return result.ok ? { ok: true } : { ok: false, reason: "audit_failed" };
}

// ---------------------------------------------------------------------------
// Connector toggle event (ADR-0133)
// ---------------------------------------------------------------------------

export const CONNECTOR_TOGGLE_EVENT_TYPE = "connector.toggle" as const;

export interface RecordConnectorToggleArgs {
    /** Nazwa konektora MCP (np. "saos", "de-eli"). */
    serverName: string;
    /** Nowy stan po przelaczeniu. */
    enabled: boolean;
    /** Ring konektora (1 = zaufany; picker zmienia tylko Ring 1). */
    ring: number;
}

/**
 * Zapisuje zmiane stanu konektora (picker) do audit_log z hash-chain
 * (event_type = "connector.toggle"). Zmiana powierzchni narzedzi dostepnych
 * agentowi jest istotna dla AI Act art. 12. Nigdy nie rzuca - bledy w `reason`.
 * Patrz ADR-0133.
 */
export async function recordConnectorToggleEvent(
    args: RecordConnectorToggleArgs,
    factory: SupabaseFactory = defaultSupabaseFactory,
): Promise<RecordMcpSecurityEventResult> {
    let db: ReturnType<typeof createServerSupabase>;
    try {
        db = factory();
    } catch {
        return { ok: false, reason: "env_missing" };
    }

    const result = await appendAuditEvent(db, {
        event_type: CONNECTOR_TOGGLE_EVENT_TYPE,
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload: {
            server_name: args.serverName,
            enabled: args.enabled,
            ring: args.ring,
        },
    });

    return result.ok ? { ok: true } : { ok: false, reason: "audit_failed" };
}

// ---------------------------------------------------------------------------
// Ring policy event propagation (ADR-0027)
// ---------------------------------------------------------------------------

export interface RecordRingPolicyEventArgs {
    /** Pelna prefixowana nazwa toola, np. "saos__search". */
    toolName: string;
    /** Nazwa serwera MCP (segment przed `__`). */
    serverName: string;
    /** Decyzja ring-policy (ring + action + reason). */
    decision: RingDecision;
}

/**
 * Zapisuje decyzje ring-policy (per tool call) do audit_log z hash-chain
 * (event_type = "ring_policy.decision"). Nigdy nie rzuca - bledy zwracane
 * w polu `reason`. Patrz ADR-0027.
 *
 * Logujemy ZAROWNO allow jak i deny - daje pelen rejestr runtime autoryzacji
 * komplementarny do load-time mcp_security.gateway (ADR-0033).
 */
export async function recordRingPolicyEvent(
    args: RecordRingPolicyEventArgs,
    factory: SupabaseFactory = defaultSupabaseFactory,
): Promise<RecordMcpSecurityEventResult> {
    let db: ReturnType<typeof createServerSupabase>;
    try {
        db = factory();
    } catch {
        return { ok: false, reason: "env_missing" };
    }

    // Minimalizacja danych (Konstytucja Art. 7): bez argumentow toola,
    // bez wynikow, bez approvedAt/approvedBy (audytor widzi je w
    // mcp-servers.json pod git review). Patrz ADR-0027 sekcja "Co NIE jest
    // w payload".
    const result = await appendAuditEvent(db, {
        event_type: RING_POLICY_EVENT_TYPE,
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload: {
            tool_name: args.toolName,
            server_name: args.serverName,
            ring: args.decision.ring,
            action: args.decision.action,
            reason: args.decision.reason,
        },
    });

    return result.ok ? { ok: true } : { ok: false, reason: "audit_failed" };
}
