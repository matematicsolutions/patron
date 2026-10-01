// Router Prometheus metrics endpoint (ADR-0037).
//
// GET /metrics zwraca text/plain w Prometheus exposition format. Chroniony
// IP whitelist (env METRICS_ALLOWED_IPS). Brak env = endpoint disabled
// (404, ukryty).
//
// Wpiety w startup mount: backend/src/index.ts -> app.use("/metrics",
// metricsRouter).

import { Router, type Request, type Response } from "express";
import { requireMetricsAllowed } from "../middleware/metrics-allow";
import { createServerSupabase } from "../lib/supabase";
import { renderPrometheus, type MetricsSnapshot } from "../lib/metrics-render";
import { recordAdminAccess } from "../lib/audit-admin-access";
// Liczniki per event_type z kanonicznej listy (audit.ts) - lokalna kopia
// zdryfowala do 7/21; parytet pilnuje event-type-parity.test.ts.
import { EVENT_TYPES } from "../lib/audit";
import { countAuditLogByEventType } from "../lib/db/audit-log-counts";

export const metricsRouter = Router();

const BACKEND_START_TIME = Date.now();

metricsRouter.get(
    "/",
    requireMetricsAllowed,
    async (req: Request, res: Response): Promise<void> => {
        // ADR-0043: log admin access (IP whitelist scrape do audit_log)
        try {
            const dbForLog = createServerSupabase();
            void recordAdminAccess({
                db: dbForLog,
                event_type: "admin.access.metrics",
                actor_user_id: null,
                actor_email: null,
                method: req.method,
                path: req.originalUrl,
                remote_ip: req.ip ?? req.socket?.remoteAddress,
            });
        } catch {
            /* graceful per ADR-0043 */
        }

        const uptime_seconds = Math.floor(
            (Date.now() - BACKEND_START_TIME) / 1000,
        );

        // Snapshot samych zer. `degraded` jest ARGUMENTEM, nie domyslna
        // wartoscia pola: te same zera znacza cos zupelnie innego na swiezej
        // instalacji (pusty dziennik - pomiar prawdziwy) niz przy zepsutym
        // odczycie (placeholder udajacy pomiar). Do 2026-09-02 obie sciezki
        // renderowaly identyczna odpowiedz z HTTP 200 i bez sladu w logu, wiec
        // awaria konczyla sie sukcesem.
        const pustySnapshot = (degraded: boolean): MetricsSnapshot => ({
            degraded,
            audit_log_by_event_type: Object.fromEntries(
                EVENT_TYPES.map((et) => [et, 0]),
            ),
            merkle_root_count: 0,
            merkle_last_anchor_seconds: null,
            mcp_security_by_action: { audit: 0, human_review: 0, denied: 0 },
            uptime_seconds,
        });

        // Celowo NIE nie-200: przy 5xx Prometheus oznacza caly target jako down
        // i traci takze `patron_uptime_seconds`, a przyczyna nadal nie ma gdzie
        // wyladowac. Trojstan niesie wiec sama odpowiedz: 200 + degraded=0 z
        // danymi, 200 + degraded=0 z zerami (swieza instalacja), 200 +
        // degraded=1 (odczyt padl) - plus przyczyna w logu operatora.
        let supabase: ReturnType<typeof createServerSupabase>;
        try {
            supabase = createServerSupabase();
        } catch (err) {
            console.error(
                "[metrics] nie udalo sie utworzyc klienta bazy - snapshot zdegradowany:",
                err,
            );
            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(pustySnapshot(true)));
            return;
        }

        try {
            // Liczniki per event_type JEDNYM agregatem (warstwa db). Petla po
            // EVENT_TYPES kosztowala tyle sekwencyjnych COUNT-ow, ile typow -
            // po naprawie parytetu listy (7 -> 21) trzykrotnie wiecej na KAZDY
            // scrape. SQL mieszka w lib/db/audit-log-counts.ts, nie tutaj.
            const auditCounts = await countAuditLogByEventType(
                supabase,
                EVENT_TYPES,
            );

            // Merkle root count + last anchor age
            const { count: merkleCount } = await supabase
                .from("audit_merkle_roots")
                .select("id", { count: "exact", head: true });
            const { data: lastAnchorRows } = await supabase
                .from("audit_merkle_roots")
                .select("created_at")
                .order("created_at", { ascending: false })
                .limit(1);
            let merkleLastAnchorSeconds: number | null = null;
            const lastAnchorRow = lastAnchorRows?.[0];
            if (lastAnchorRow?.created_at) {
                merkleLastAnchorSeconds = Math.floor(
                    (Date.now() - new Date(lastAnchorRow.created_at).getTime()) /
                        1000,
                );
            }

            // MCP security decisions per action
            const mcpCounts = { audit: 0, human_review: 0, denied: 0 };
            const { data: mcpRows } = await supabase
                .from("audit_log")
                .select("payload")
                .eq("event_type", "mcp_security.gateway");
            for (const row of mcpRows ?? []) {
                const action = (row.payload as { action?: string } | null)?.action;
                if (action === "audit") mcpCounts.audit += 1;
                else if (action === "human_review") mcpCounts.human_review += 1;
                else if (action === "denied") mcpCounts.denied += 1;
            }

            const snapshot: MetricsSnapshot = {
                degraded: false,
                audit_log_by_event_type: auditCounts,
                merkle_root_count: merkleCount ?? 0,
                merkle_last_anchor_seconds: merkleLastAnchorSeconds,
                mcp_security_by_action: mcpCounts,
                uptime_seconds,
            };

            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(snapshot));
        } catch (err) {
            console.error(
                "[metrics] odczyt zrodel metryk padl - snapshot zdegradowany:",
                err,
            );
            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(pustySnapshot(true)));
        }
    },
);
