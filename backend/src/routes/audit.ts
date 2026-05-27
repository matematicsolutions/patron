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
