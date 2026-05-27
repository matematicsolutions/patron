// Router REST API dla warstwy MCP Security (ADR-0042 UI banner).
//
// Obecnie jeden endpoint: GET /api/security/mcp-status zwraca samowystarczalny
// stan MCP Security Gateway (tryb pracy + ostatni skan startup + 24h podsumowanie
// decyzji z audit_log). Endpoint jest read-only fasada nad istniejacymi danymi
// gatewaya (ADR-0025 / ADR-0028 / ADR-0033) - nie zmienia ich zachowania.
//
// Autoryzacja: requireAuth + requireAdmin (ADR-0034). Endpoint chroniony
// admin-only - operator kancelarii (whitelist email env) widzi banner w UI,
// zwykli prawnicy nie maja dostepu (disclosure incydentow security poza krag
// osob uprawnionych).
//
// Wpiety w startup mount: backend/src/index.ts -> app.use("/api/security",
// securityRouter).

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { recordAdminAccess } from "../lib/audit-admin-access";

export const securityRouter = Router();

const VALID_MODES = ["enforce", "audit", "off"] as const;
export type GatewayMode = (typeof VALID_MODES)[number];

/**
 * Czyta env MCP_SECURITY_GATEWAY_MODE i zwraca jeden z trzech valid modes.
 * Brak env / nieznana wartosc = "off" (fail-safe per ADR-0042).
 * Pure function - czyta process.env, testowalna z env mock.
 */
export function readGatewayMode(): GatewayMode {
    const raw = (process.env.MCP_SECURITY_GATEWAY_MODE ?? "off").trim().toLowerCase();
    return (VALID_MODES as ReadonlyArray<string>).includes(raw)
        ? (raw as GatewayMode)
        : "off";
}

export interface AuditCounts {
    audit: number;
    human_review: number;
    denied: number;
}

export interface McpStatusPayload {
    gateway: {
        mode: GatewayMode;
        active: boolean;
        last_startup_scan: {
            timestamp: string;
            overall_action: string;
            servers_scanned: number;
            findings_count: number;
        } | null;
    };
    audit_summary_24h: {
        decisions_total: number;
        by_action: AuditCounts;
    };
}

/**
 * Agreguje liczbe decyzji per akcja z surowych wierszy audit_log.
 * Pure function - testowalna z mockiem danych. Ignoruje wiersze z nieznanym
 * action (np. "allowed-clean" nie liczy sie do podsumowania, banner pokazuje
 * tylko akcje niealgorytmiczne).
 */
export function countAuditActions(
    rows: ReadonlyArray<{ payload: unknown }>,
): AuditCounts {
    const counts: AuditCounts = { audit: 0, human_review: 0, denied: 0 };
    for (const row of rows) {
        const action = (row.payload as { action?: string } | null)?.action;
        if (action === "audit") counts.audit += 1;
        else if (action === "human_review") counts.human_review += 1;
        else if (action === "denied") counts.denied += 1;
    }
    return counts;
}

/**
 * Sklada McpStatusPayload z czystych wejsc. Pure function - bez IO.
 * Uzywana przez handler endpointu i przez testy.
 */
export function buildStatusPayload(
    mode: GatewayMode,
    counts: AuditCounts,
): McpStatusPayload {
    return {
        gateway: {
            mode,
            active: mode !== "off",
            last_startup_scan: null,
        },
        audit_summary_24h: {
            decisions_total: counts.audit + counts.human_review + counts.denied,
            by_action: counts,
        },
    };
}

/**
 * GET /api/security/mcp-status
 *
 * Status codes:
 *   200 - McpStatusPayload JSON
 *   401 - brak/niepoprawny JWT (z requireAuth middleware)
 *   403 - user zalogowany ale nie admin (z requireAdmin middleware, ADR-0034)
 *   500 - blad DB
 *
 * Graceful: brak env SUPABASE_URL / SUPABASE_SECRET_KEY = pusty
 * audit_summary_24h (zera) zamiast 500 - operator widzi mode z env nawet bez
 * DB (Konstytucja Art. 1 lokalnosc - banner dziala offline).
 */
securityRouter.get(
    "/mcp-status",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        // ADR-0043: log admin access (meta-audit AI Act art. 12)
        try {
            const dbForLog = createServerSupabase();
            void recordAdminAccess({
                db: dbForLog,
                event_type: "admin.access.security_banner",
                actor_user_id: (res.locals.userId as string | null) ?? null,
                actor_email: (res.locals.userEmail as string | null) ?? null,
                method: req.method,
                path: req.originalUrl,
            });
        } catch {
            /* graceful per ADR-0043 */
        }

        const mode = readGatewayMode();
        const emptyCounts: AuditCounts = { audit: 0, human_review: 0, denied: 0 };

        let supabase: ReturnType<typeof createServerSupabase>;
        try {
            supabase = createServerSupabase();
        } catch {
            res.status(200).json(buildStatusPayload(mode, emptyCounts));
            return;
        }

        try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from("audit_log")
                .select("payload, created_at")
                .eq("event_type", "mcp_security.gateway")
                .gte("created_at", since);

            if (error) {
                res.status(500).json({
                    error: "audit_log_query_failed",
                    detail: error.message,
                });
                return;
            }

            const counts = countAuditActions(data ?? []);
            res.status(200).json(buildStatusPayload(mode, counts));
        } catch (err) {
            res.status(500).json({
                error: "internal_error",
                detail: err instanceof Error ? err.message : "unknown",
            });
        }
    },
);
