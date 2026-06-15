// RODO art. 17 - endpoint "zapomnij sprawe" (ADR-0061).
// Dostepny tylko w trybie desktop (single-user owns all). W trybie chmurowym
// kasacja idzie przez kontrolowany skrypt operatora (rodo-delete) z weryfikacja
// wlasnosci. Ten endpoint tez egzekwuje ownership-check (defense-in-depth,
// parytet z DELETE /projects/:id) i DOPISUJE slad usuniecia do audit_log.

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { forgetCase } from "../lib/rodo/forget";
import { appendAuditEvent } from "../lib/audit";

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
  const userId = res.locals.userId as string;
  const db = createServerSupabase();

  // Defense-in-depth: tylko wlasciciel kasuje sprawe (parytet z DELETE
  // /projects/:id). 404 zamiast 403 - nie ujawniamy istnienia cudzej sprawy.
  const { data: project } = await db
    .from("projects")
    .select("id, user_id")
    .eq("id", project_id)
    .single();
  if (!project || project.user_id !== userId) {
    return void res.status(404).json({ detail: "Project not found" });
  }

  try {
    const report = await forgetCase(project_id, db);
    // Slad nieodwracalnego usuniecia (RODO art. 17 + AI Act art. 12) - same
    // liczniki z raportu, bez tresci/PII.
    await appendAuditEvent(db, {
      event_type: "rodo.delete",
      actor_user_id: userId,
      payload: { project_id, report },
    });
    res.json(report);
  } catch (e) {
    res.status(500).json({ detail: `Forget failed: ${String(e)}` });
  }
});
