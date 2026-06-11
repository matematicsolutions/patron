// RODO art. 17 - endpoint "zapomnij sprawe" (ADR-0061).
// Dostepny tylko w trybie desktop (single-user owns all). W trybie chmurowym
// kasacja idzie przez kontrolowany skrypt operatora (rodo-delete) z weryfikacja
// wlasnosci - endpoint bez ownership-check bylby grozny.

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { forgetCase, type ForgetReport } from "../lib/rodo/forget";
import { appendAuditEvent } from "../lib/audit";

/**
 * Buduje payload audytowy dla zdarzenia rodo.delete. Czysta funkcja (testowalna
 * bez Express/Supabase - wzorzec security.ts buildStatusPayload). Bez PII:
 * wylacznie project_id + liczniki z raportu kasacji.
 */
export function buildRodoDeleteAuditPayload(
  projectId: string,
  report: ForgetReport,
): Record<string, unknown> {
  return {
    project_id: projectId,
    documents: report.documents,
    chats: report.chats,
    tabular_reviews: report.tabularReviews,
    rag_cleared: report.ragCleared,
    storage_files_deleted: report.storageFilesDeleted,
    brain_cleared: report.brainCleared,
  };
}

export const rodoRouter = Router();

// POST /rodo/forget-case  { project_id, confirm: true }
rodoRouter.post("/forget-case", requireAuth, async (req, res) => {
  if (!isSqliteBackend()) {
    return void res
      .status(404)
      .json({ detail: "Dostepne tylko w trybie desktop." });
  }
  const { project_id, confirm } = req.body as {
    project_id?: string;
    confirm?: boolean;
  };
  if (!project_id || typeof project_id !== "string") {
    return void res.status(400).json({ detail: "project_id is required" });
  }
  if (confirm !== true) {
    return void res.status(400).json({
      detail:
        "Operacja nieodwracalna (RODO art. 17). Wymagane confirm: true.",
    });
  }
  const db = createServerSupabase();
  const userId = res.locals.userId as string;
  try {
    const report = await forgetCase(project_id, db);
    // Slad nieodwracalnej kasacji RODO art. 17 w hash-chain (AI Act art. 12).
    // forget.ts celowo NIE tyka audit_log (naglowek modulu); tu dopisujemy
    // wpis o samej kasacji. Payload bez PII - tylko project_id + liczniki z raportu.
    await appendAuditEvent(db, {
      event_type: "rodo.delete",
      actor_user_id: userId,
      payload: buildRodoDeleteAuditPayload(project_id, report),
    });
    res.json(report);
  } catch (e) {
    res.status(500).json({ detail: `Forget failed: ${String(e)}` });
  }
});
