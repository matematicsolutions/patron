// Karty zatwierdzenia mutacji (ADR-0137) - endpoint REST. Inbox human-in-the-loop.
//
//   GET  /mutation-approvals          -> { approvals[] }  karty `pending` usera
//   GET  /mutation-approvals/:id      -> { approval }      pojedyncza karta
//   POST /mutation-approvals/:id/approve  -> wykonuje narzedzie + audit
//   POST /mutation-approvals/:id/reject   -> { reason? }    zamyka + audit
//
// Zatwierdza/odrzuca TYLKO czlowiek (`requireAuth`, fail-closed). Scoping
// user_id (karta cudzego usera = 404). Kazda decyzja idzie w audit hash-chain
// (mutation.approval.decision, AI Act art. 12 + 14).

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
    approveMutationApproval,
    getApprovalById,
    getPendingApprovals,
    rejectMutationApproval,
} from "../lib/mutation-approval";
import { executeStagedTool } from "../lib/chat/mutation-approval-executor";

export const approvalsRouter = Router();

// GET /mutation-approvals - lista kart `pending` usera.
approvalsRouter.get("/", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    try {
        const db = createServerSupabase();
        const approvals = await getPendingApprovals(db, userId);
        res.json({ approvals });
    } catch (e) {
        res.status(500).json({
            detail: `Nie udalo sie wczytac kart: ${String(e)}`,
        });
    }
});

// GET /mutation-approvals/:id - pojedyncza karta (scoped do usera).
approvalsRouter.get("/:id", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    try {
        const db = createServerSupabase();
        const approval = await getApprovalById(db, userId, req.params.id);
        if (!approval) {
            return void res.status(404).json({ detail: "Karta nie istnieje." });
        }
        res.json({ approval });
    } catch (e) {
        res.status(500).json({ detail: `Blad: ${String(e)}` });
    }
});

// POST /mutation-approvals/:id/approve - zatwierdza i WYKONUJE narzedzie.
approvalsRouter.post("/:id/approve", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    try {
        const db = createServerSupabase();
        const result = await approveMutationApproval(
            db,
            { id: req.params.id, userId, actorId: userId },
            (card) => executeStagedTool(card, userId, db),
        );
        if (!result.ok) {
            return void res
                .status(result.status ?? 400)
                .json({ detail: result.error });
        }
        // Wykonanie po zatwierdzeniu moglo sie nie powiesc (np. dokument
        // zmieniony) - karta jest `approved`, ale niesie execution_error.
        res.json({
            approval: result.card,
            executed: result.execution?.ok ?? false,
            execution_error: result.card?.execution_error ?? null,
            result: result.execution?.result ?? null,
        });
    } catch (e) {
        res.status(500).json({ detail: `Blad zatwierdzenia: ${String(e)}` });
    }
});

// POST /mutation-approvals/:id/reject  { reason?: string }
approvalsRouter.post("/:id/reject", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const reason = (req.body as { reason?: string } | undefined)?.reason;
    try {
        const db = createServerSupabase();
        const result = await rejectMutationApproval(db, {
            id: req.params.id,
            userId,
            actorId: userId,
            reason,
        });
        if (!result.ok) {
            return void res
                .status(result.status ?? 400)
                .json({ detail: result.error });
        }
        res.json({ approval: result.card });
    } catch (e) {
        res.status(500).json({ detail: `Blad odrzucenia: ${String(e)}` });
    }
});
