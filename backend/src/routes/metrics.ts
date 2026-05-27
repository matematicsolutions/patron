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

export const metricsRouter = Router();

const BACKEND_START_TIME = Date.now();

const VALID_EVENT_TYPES = [
    "chat.message.user",
    "chat.message.assistant",
    "input_security_scan",
    "mcp_security.gateway",
    "ring_policy.decision",
    "rodo.delete",
    "rodo.export",
];

metricsRouter.get(
    "/",
    requireMetricsAllowed,
    async (_req: Request, res: Response): Promise<void> => {
        const uptime_seconds = Math.floor(
            (Date.now() - BACKEND_START_TIME) / 1000,
        );

        const emptySnapshot: MetricsSnapshot = {
            audit_log_by_event_type: Object.fromEntries(
                VALID_EVENT_TYPES.map((et) => [et, 0]),
            ),
            merkle_root_count: 0,
            merkle_last_anchor_seconds: null,
            mcp_security_by_action: { audit: 0, human_review: 0, denied: 0 },
            uptime_seconds,
        };

        let supabase: ReturnType<typeof createServerSupabase>;
        try {
            supabase = createServerSupabase();
        } catch {
            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(emptySnapshot));
            return;
        }

        try {
            // Count audit_log entries per event_type
            const auditCounts: Record<string, number> = Object.fromEntries(
                VALID_EVENT_TYPES.map((et) => [et, 0]),
            );

            for (const eventType of VALID_EVENT_TYPES) {
                const { count } = await supabase
                    .from("audit_log")
                    .select("id", { count: "exact", head: true })
                    .eq("event_type", eventType);
                auditCounts[eventType] = count ?? 0;
            }

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
                audit_log_by_event_type: auditCounts,
                merkle_root_count: merkleCount ?? 0,
                merkle_last_anchor_seconds: merkleLastAnchorSeconds,
                mcp_security_by_action: mcpCounts,
                uptime_seconds,
            };

            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(snapshot));
        } catch {
            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.status(200).send(renderPrometheus(emptySnapshot));
        }
    },
);
