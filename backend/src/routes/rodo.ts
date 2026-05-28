// RODO art. 17 - endpoint "zapomnij sprawe" (ADR-0061).
// Dostepny tylko w trybie desktop (single-user owns all). W trybie chmurowym
// kasacja idzie przez kontrolowany skrypt operatora (rodo-delete) z weryfikacja
// wlasnosci - endpoint bez ownership-check bylby grozny.

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { forgetCase } from "../lib/rodo/forget";

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
  try {
    const report = await forgetCase(project_id, db);
    res.json(report);
  } catch (e) {
    res.status(500).json({ detail: `Forget failed: ${String(e)}` });
  }
});
