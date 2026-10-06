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
import { awaitsOnlyThirdPartyApproval } from "../lib/mcp-security";

export const securityRouter = Router();

const VALID_MODES = ["enforce", "audit", "off"] as const;
export type GatewayMode = (typeof VALID_MODES)[number];

/**
 * Tryb, ktory brama FAKTYCZNIE egzekwuje (ADR-0160). `getMcpTools`
 * (lib/mcp/index.ts) skanuje kazdy konektor przy starcie i nie rejestruje
 * narzedzi przy `human_review` (bez zatwierdzenia Operatora, ADR-0158) ani
 * `denied` - zawsze, bez wzgledu na konfiguracje. Dlatego baner zawsze dostaje
 * "enforce".
 *
 * Dawniej czytane z env MCP_SECURITY_GATEWAY_MODE (domyslnie "off"): baner
 * mowil "wylaczony" albo "narzedzia NIE sa blokowane", gdy byly blokowane, i
 * zalecal ustawienie zmiennej, ktora niczego nie wlaczala. Zmienna jest
 * ignorowana; tryb mniej restrykcyjny niz "enforce" wymagalby osobnego ADR
 * (rezerwacja ADR-0045 z ADR-0042) i zmiany w getMcpTools, nie w banerze.
 */
export function readGatewayMode(): GatewayMode {
    return "enforce";
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
        /**
         * B-08: ile z `human_review` to nowy konektor spoza zaufanego zestawu,
         * ktory czeka na zatwierdzenie Operatora (bez zatwierdzenia i bez
         * podejrzanego sygnalu) - baner pokazuje je jako oczekiwanie, nie alarm.
         * Podzbior `by_action.human_review`.
         */
        awaiting_operator_approval: number;
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
 * B-08: decyzje `human_review`, ktore sa ZWYKLYM oczekiwaniem na zatwierdzenie
 * nowego konektora 3rd-party: brak zatwierdzenia (`operator_approval.status`
 * = "missing") i findings wylacznie "nieznany 3rd-party" + `low`
 * (awaitsOnlyThirdPartyApproval). Zatwierdzenie INNEJ definicji
 * (`hash_mismatch`), dryf, podobna nazwa czy ukryte instrukcje zostaja blokada.
 * Pure function.
 */
export function countAwaitingOperatorApproval(
    rows: ReadonlyArray<{ payload: unknown }>,
): number {
    let n = 0;
    for (const row of rows) {
        const p = row.payload as {
            action?: unknown;
            findings?: unknown;
            operator_approval?: { status?: unknown } | null;
        } | null;
        if (!p || p.action !== "human_review") continue;
        if (p.operator_approval?.status !== "missing") continue;
        if (!Array.isArray(p.findings)) continue;
        const findings = p.findings.filter(
            (f): f is { detector?: unknown; severity?: unknown } => !!f && typeof f === "object",
        );
        if (findings.length === p.findings.length && awaitsOnlyThirdPartyApproval(findings)) n += 1;
    }
    return n;
}

/**
 * Sklada McpStatusPayload z czystych wejsc. Pure function - bez IO.
 * Uzywana przez handler endpointu i przez testy.
 */
export function buildStatusPayload(
    mode: GatewayMode,
    counts: AuditCounts,
    awaitingOperatorApproval = 0,
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
            awaiting_operator_approval: Math.min(awaitingOperatorApproval, counts.human_review),
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
            // Tabela audit_log uzywa kolumny "ts" (nie created_at) - patrz
            // schema.sqlite.ts:253. Wczesniej zapytanie odwolywalo sie do
            // created_at -> SQLite "no such column" -> 500 przy kazdym otwarciu
            // banera MCP Security przez admina.
            const { data, error } = await supabase
                .from("audit_log")
                .select("payload, ts")
                .eq("event_type", "mcp_security.gateway")
                .gte("ts", since);

            if (error) {
                res.status(500).json({
                    error: "audit_log_query_failed",
                    detail: error.message,
                });
                return;
            }

            const counts = countAuditActions(data ?? []);
            res.status(200).json(
                buildStatusPayload(mode, counts, countAwaitingOperatorApproval(data ?? [])),
            );
        } catch (err) {
            res.status(500).json({
                error: "internal_error",
                detail: err instanceof Error ? err.message : "unknown",
            });
        }
    },
);
