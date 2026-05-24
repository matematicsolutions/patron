// Testy ADR-0033 - propagacja decyzji MCP Security Gateway do audit hash-chain.
//
// Sprawdzamy:
//  1) graceful no-op gdy factory rzuca (brak SUPABASE_* env),
//  2) sukces dla decyzji "audit" - event_type i payload pol,
//  3) sukces dla decyzji "denied" - takze tworzy event,
//  4) minimalizacja danych: findings NIE zawiera `sample`, ma tylko 3 pola,
//  5) failure cieżkiej audit (appendAuditEvent zwraca {ok:false}) -> reason.

import { describe, expect, it, vi } from "vitest";
import {
    MCP_SECURITY_EVENT_TYPE,
    recordMcpSecurityEvent,
    type SupabaseFactory,
} from "./audit-bridge";
import type { McpFinding } from "../mcp-security";

interface MockDbHandles {
    insertFn: ReturnType<typeof vi.fn>;
    fromFn: ReturnType<typeof vi.fn>;
}

function mockDb(opts: {
    lastHash?: string;
    insertError?: { code?: string; message?: string } | null;
} = {}): { db: unknown; handles: MockDbHandles } {
    const limitResult = {
        data: opts.lastHash ? [{ hash: opts.lastHash }] : [],
        error: null,
    };
    const limitFn = vi.fn().mockResolvedValue(limitResult);
    const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
    const selectFn = vi.fn().mockReturnValue({ order: orderFn });
    const insertFn = vi.fn().mockResolvedValue({
        error: opts.insertError ?? null,
    });
    const fromFn = vi.fn().mockReturnValue({
        select: selectFn,
        insert: insertFn,
    });
    const db = { from: fromFn };
    return { db, handles: { insertFn, fromFn } };
}

const sampleFinding: McpFinding = {
    detector: "drift-detector",
    category: "drift",
    severity: "low",
    serverName: "saos-orzeczenia",
    message: "Pierwszy load konektora - baseline ustalany.",
    sample: "fragment opisu konektora ktorego NIE chcemy w audit_log",
};

describe("recordMcpSecurityEvent", () => {
    it("graceful no-op gdy factory rzuca (brak SUPABASE_* env)", async () => {
        const factory: SupabaseFactory = () => {
            throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
        };

        const result = await recordMcpSecurityEvent(
            {
                serverName: "saos-orzeczenia",
                action: "audit",
                riskScore: 5,
                findings: [sampleFinding],
            },
            factory,
        );

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("env_missing");
    });

    it("decyzja 'audit' zapisuje event z event_type=mcp_security.gateway i poprawnym payloadem", async () => {
        const { db, handles } = mockDb();
        const result = await recordMcpSecurityEvent(
            {
                serverName: "saos-orzeczenia",
                action: "audit",
                riskScore: 25,
                findings: [sampleFinding],
            },
            () => db as ReturnType<SupabaseFactory>,
        );

        expect(result.ok).toBe(true);
        expect(handles.insertFn).toHaveBeenCalledTimes(1);
        const insertedRow = handles.insertFn.mock.calls[0]?.[0] as {
            event_type: string;
            actor_user_id: string | null;
            chat_id: string | null;
            document_id: string | null;
            payload: Record<string, unknown>;
        };

        expect(insertedRow.event_type).toBe(MCP_SECURITY_EVENT_TYPE);
        expect(insertedRow.event_type).toBe("mcp_security.gateway");
        expect(insertedRow.actor_user_id).toBeNull();
        expect(insertedRow.chat_id).toBeNull();
        expect(insertedRow.document_id).toBeNull();
        expect(insertedRow.payload).toMatchObject({
            server_name: "saos-orzeczenia",
            action: "audit",
            risk_score: 25,
            findings_count: 1,
        });
    });

    it("decyzja 'denied' tez tworzy event audit (path BLOCKED ADR-0028)", async () => {
        const { db, handles } = mockDb();
        const result = await recordMcpSecurityEvent(
            {
                serverName: "podejrzany-konektor",
                action: "denied",
                riskScore: 95,
                findings: [
                    { ...sampleFinding, detector: "typosquat-distance", category: "typosquat", severity: "critical" },
                ],
            },
            () => db as ReturnType<SupabaseFactory>,
        );

        expect(result.ok).toBe(true);
        const insertedRow = handles.insertFn.mock.calls[0]?.[0] as {
            payload: { action: string; risk_score: number };
        };
        expect(insertedRow.payload.action).toBe("denied");
        expect(insertedRow.payload.risk_score).toBe(95);
    });

    it("minimalizacja danych: findings w payload NIE zawiera 'sample' i ma tylko 3 pola (detector/severity/message)", async () => {
        const { db, handles } = mockDb();
        await recordMcpSecurityEvent(
            {
                serverName: "saos-orzeczenia",
                action: "human_review",
                riskScore: 60,
                findings: [sampleFinding],
            },
            () => db as ReturnType<SupabaseFactory>,
        );

        const insertedRow = handles.insertFn.mock.calls[0]?.[0] as {
            payload: { findings: Array<Record<string, unknown>> };
        };
        const findingInAudit = insertedRow.payload.findings[0];

        expect(findingInAudit).toBeDefined();
        if (!findingInAudit) return;

        // Twarda regresja: zaden klucz finding'u w audit_log nie moze wyciec sample.
        expect(Object.keys(findingInAudit).sort()).toEqual(["detector", "message", "severity"]);
        expect(findingInAudit).not.toHaveProperty("sample");
        expect(findingInAudit).not.toHaveProperty("category");
        expect(findingInAudit).not.toHaveProperty("serverName");
        expect(findingInAudit).not.toHaveProperty("toolName");
        // Tresc 3 pol musi byc zachowana.
        expect(findingInAudit.detector).toBe("drift-detector");
        expect(findingInAudit.severity).toBe("low");
        expect(findingInAudit.message).toBe("Pierwszy load konektora - baseline ustalany.");
    });

    it("zwraca reason 'audit_failed' gdy appendAuditEvent dostaje blad insert (i nie rzuca)", async () => {
        // 23505 to unique_violation - appendAuditEvent retry-uje raz, potem zwraca {ok:false}.
        // My mockujemy "twardy" blad insert (np. tabela nie istnieje) - od razu return ok:false.
        const { db } = mockDb({
            insertError: { code: "42P01", message: 'relation "audit_log" does not exist' },
        });

        const result = await recordMcpSecurityEvent(
            {
                serverName: "saos-orzeczenia",
                action: "audit",
                riskScore: 5,
                findings: [sampleFinding],
            },
            () => db as ReturnType<SupabaseFactory>,
        );

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("audit_failed");
    });
});
