// Router REST API dla warstwy audit (ADR-0036).
//
// Obecnie jeden endpoint: GET /api/audit/merkle/verify/:eventId zwraca
// samowystarczalny ProofBundle ktory audytor moze zweryfikowac offline
// przez `audit-merkle-verifier.ts` bez dalszego dostepu do bazy kancelarii.
//
// Autoryzacja: middleware `requireAuth` (ten sam wzorzec co inne routery
// Patrona, np. workflows). Ustawia `res.locals.userId`, rzuca 401 gdy
// brak/zly token. Twarda RBAC admin-only = rezerwacja ADR-0034 (rola
// admin + drugi middleware `requireAdmin` przed `requireAuth` bez zmiany
// kontraktu API).
//
// UI viewer dla audytora (frontend Next.js admin panel) = rezerwacja ADR-0040
// (blocked-by ADR-0034 RBAC).

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { fetchProofForEvent } from "../lib/audit-merkle-roots";
import { maskPayload } from "../lib/audit-pii-mask";
import {
    buildResponseEvents,
    computeNextCursor,
    parseAuditLogQuery,
    type AuditLogRow,
} from "../lib/audit-log-query";
import { recordAdminAccess } from "../lib/audit-admin-access";

export const auditRouter = Router();

/**
 * GET /merkle/verify/:eventId
 *
 * Zwraca ProofBundle dla konkretnego eventu z audit_log. Bundle jest
 * samowystarczalny - audytor uzywa `verifyMerkleProof` offline.
 *
 * Status codes:
 *   200 - ProofBundle JSON (event_id, event_hash, proof, merkle_root_id,
 *         merkle_root, chain_block_start, chain_block_end)
 *   400 - eventId nie jest liczba calkowita > 0
 *   401 - brak/niepoprawny JWT (z requireAuth middleware)
 *   403 - user zalogowany ale nie admin (z requireAdmin middleware, ADR-0034)
 *   404 - event nie istnieje lub brak Merkle root pokrywajacego event
 *   500 - blad DB lub nieoczekiwany wyjatek
 */
auditRouter.get(
    "/merkle/verify/:eventId",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        const eventIdRaw = req.params.eventId;
        const eventId = Number.parseInt(eventIdRaw, 10);
        if (!Number.isFinite(eventId) || eventId <= 0 || `${eventId}` !== eventIdRaw) {
            res.status(400).json({
                error: "invalid_event_id",
                detail: "eventId musi byc liczba calkowita > 0",
            });
            return;
        }

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        const result = await fetchProofForEvent(db, eventId);
        if (!result.ok) {
            const error = result.error ?? "unknown_error";
            if (error.includes("nie istnieje") || error.includes("brak Merkle root")) {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            res.status(500).json({ error: "fetch_failed", detail: error });
            return;
        }

        res.status(200).json(result.bundle);
    },
);

/**
 * GET /api/audit/log
 *
 * Endpoint listy audit_log dla audytora (ADR-0040 faza 1). Paginacja cursor-
 * based, filtrowanie po event_type/actor/since/until, maskowanie PII server-
 * side.
 *
 * Query params (patrz parseAuditLogQuery): event_type, actor_user_id, since,
 * until, limit (1-200, default 50), cursor.
 *
 * Status codes:
 *   200 - { events, next_cursor }
 *   400 - invalid query param
 *   401 - brak/niepoprawny JWT
 *   403 - non-admin
 *   500 - blad DB
 */
auditRouter.get(
    "/log",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        // ADR-0043: log admin access do audit_log (meta-audit AI Act art. 12)
        try {
            const db = createServerSupabase();
            void recordAdminAccess({
                db,
                event_type: "admin.access.audit_viewer",
                actor_user_id: (res.locals.userId as string | null) ?? null,
                actor_email: (res.locals.userEmail as string | null) ?? null,
                method: req.method,
                path: req.originalUrl,
                query: req.query as Record<string, unknown>,
            });
        } catch {
            /* graceful per ADR-0043 - audit_log fail nie blokuje endpointu */
        }

        const parsed = parseAuditLogQuery(req.query as Record<string, unknown>);
        if (!parsed.ok || !parsed.filter) {
            res.status(400).json({
                error: "invalid_query",
                detail: parsed.error ?? "unknown parse error",
            });
            return;
        }
        const filter = parsed.filter;

        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "supabase_unavailable", detail: msg });
            return;
        }

        try {
            let q = db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .gte("ts", filter.since)
                .lte("ts", filter.until)
                .order("id", { ascending: false })
                .limit(filter.limit);

            if (filter.event_type !== null) {
                q = q.eq("event_type", filter.event_type);
            }
            if (filter.actor_user_id !== null) {
                q = q.eq("actor_user_id", filter.actor_user_id);
            }
            if (filter.cursor !== null) {
                q = q.lt("id", filter.cursor);
            }

            const { data, error } = await q;
            if (error) {
                res.status(500).json({
                    error: "audit_log_query_failed",
                    detail: error.message,
                });
                return;
            }

            const rows = (data ?? []) as AuditLogRow[];
            const events = buildResponseEvents(rows, maskPayload);
            const next_cursor = computeNextCursor(rows, filter.limit);

            res.status(200).json({ events, next_cursor });
        } catch (err) {
            res.status(500).json({
                error: "internal_error",
                detail: err instanceof Error ? err.message : "unknown",
            });
        }
    },
);
