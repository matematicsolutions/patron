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
import {
    buildAuditPack,
    buildAuditPackFilename,
    type AuditPackEvent,
} from "../lib/audit-pack";

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

/**
 * GET /api/audit/export/:eventId
 *
 * Eksport samowystarczalnego audit pack JSON dla audytora zewnetrznego
 * (UODO, rewident kancelarii, biegly w postepowaniu). Pack zawiera:
 *   - event z audit_log (payload zamaskowany server-side per ADR-0040)
 *   - Merkle proof bundle (ADR-0026, ADR-0036) - audytor weryfikuje offline
 *   - SHA-256 integrity manifestu - wykrywa modyfikacje pliku po wyniesieniu
 *
 * Patrz ADR-0047. CLI weryfikator: `npx tsx scripts/verify-audit-pack.ts`.
 *
 * Loguje admin.access.audit_export do audit_log (ADR-0043 meta-audit).
 *
 * Status codes:
 *   200 - audit pack JSON, Content-Disposition: attachment z filename
 *   400 - eventId nie jest liczba calkowita > 0
 *   401 - brak/niepoprawny JWT
 *   403 - non-admin
 *   404 - event nie istnieje LUB brak Merkle root pokrywajacego event
 *         (audytor musi poczekac na auto-trigger ADR-0036 lub manualny
 *         compute root przez admina kancelarii)
 *   500 - blad DB
 */
auditRouter.get(
    "/export/:eventId",
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

        // ADR-0043: log dostepu admin (graceful, NIE blokuje eksportu)
        void recordAdminAccess({
            db,
            event_type: "admin.access.audit_export",
            actor_user_id: (res.locals.userId as string | null) ?? null,
            actor_email: (res.locals.userEmail as string | null) ?? null,
            method: req.method,
            path: req.originalUrl,
            query: { eventId: String(eventId) },
        });

        // 1. Pobierz event z audit_log (pelny rzad, do zbudowania AuditPackEvent)
        let eventRow: AuditLogRow;
        try {
            const evRes = await db
                .from("audit_log")
                .select(
                    "id, event_type, actor_user_id, chat_id, document_id, ts, hash, prev_hash, payload",
                )
                .eq("id", eventId)
                .single();
            if (evRes.error || !evRes.data) {
                res.status(404).json({
                    error: "not_found",
                    detail: `event ${eventId} nie istnieje`,
                });
                return;
            }
            eventRow = evRes.data as AuditLogRow;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: "fetch_failed", detail: msg });
            return;
        }

        // 2. Pobierz Merkle proof bundle (per ADR-0036)
        const proofResult = await fetchProofForEvent(db, eventId);
        if (!proofResult.ok || !proofResult.bundle) {
            const error = proofResult.error ?? "unknown_error";
            if (error.includes("nie istnieje") || error.includes("brak Merkle root")) {
                res.status(404).json({ error: "not_found", detail: error });
                return;
            }
            res.status(500).json({ error: "fetch_failed", detail: error });
            return;
        }

        // 3. Zbuduj AuditPackEvent (payload zamaskowany server-side)
        const packEvent: AuditPackEvent = {
            id: eventRow.id,
            event_type: eventRow.event_type,
            ts: eventRow.ts,
            actor_user_id: eventRow.actor_user_id,
            chat_id: eventRow.chat_id,
            document_id: eventRow.document_id,
            hash: eventRow.hash,
            prev_hash: eventRow.prev_hash,
            payload_masked: maskPayload(eventRow.payload),
        };

        // 4. Sklej pack z integrity SHA256
        const exportedAt = new Date().toISOString();
        const pack = buildAuditPack({
            exporter: {
                user_id: (res.locals.userId as string | null) ?? null,
                email: (res.locals.userEmail as string | null) ?? null,
            },
            event: packEvent,
            bundle: proofResult.bundle,
            exportedAt,
        });

        // 5. Zwroc jako downloadable JSON
        const filename = buildAuditPackFilename(eventId, exportedAt);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`,
        );
        res.status(200).send(JSON.stringify(pack, null, 2));
    },
);
