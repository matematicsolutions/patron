// Bridge miedzy MCP Security Gateway (lib/mcp-security) a audit hash-chain
// (lib/audit). Implementuje ADR-0033 - propagacja decyzji Gateway'a (audit /
// human_review / denied) do tabeli audit_log z event_type = "mcp_security.gateway".
//
// Modul jest fire-and-forget: porazka audit_log NIE blokuje rejestracji toolow
// MCP (Konstytucja Art. 8 stalosc kontraktow). Brak env SUPABASE_URL /
// SUPABASE_SECRET_KEY = graceful no-op (analogicznie do loadConfig w
// lib/mcp/index.ts, ktore no-op gdy mcp-servers.json nie istnieje).
//
// Payload zawiera WYLACZNIE metadata skanu (server_name, action, risk_score,
// findings_count, findings[detector,severity,message]). Pole `sample` z
// McpFinding jest POMINIETE - patrz ADR-0033 sekcja "Co NIE jest w payload".

import { appendAuditEvent } from "../audit";
import { createServerSupabase } from "../supabase";
import type { McpAction, McpFinding } from "../mcp-security";

export const MCP_SECURITY_EVENT_TYPE = "mcp_security.gateway";

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
