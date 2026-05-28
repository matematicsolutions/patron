// Folder Sprawy (ADR-0056) - import dokumentow z lokalnego katalogu.
//
// Endpoint dostepny TYLKO w trybie desktop (PATRON_DB_BACKEND=sqlite). Czyta
// lokalny dysk maszyny - w trybie chmurowym (multi-tenant) czytanie dowolnej
// sciezki serwera byloby grozne, wiec jest tam zablokowany (404).

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { ingestFolder } from "../lib/documentIngest";

export const foldersRouter = Router();

// POST /folders/ingest  { path: string, project_id?: string | null }
foldersRouter.post("/ingest", requireAuth, async (req, res) => {
  if (!isSqliteBackend()) {
    return void res
      .status(404)
      .json({ detail: "Folder ingest dostepny tylko w trybie desktop." });
  }
  const userId = res.locals.userId as string;
  const { path: folderPath, project_id } = req.body as {
    path?: string;
    project_id?: string | null;
  };
  if (!folderPath || typeof folderPath !== "string") {
    return void res.status(400).json({ detail: "path is required" });
  }
  const db = createServerSupabase();
  try {
    const results = await ingestFolder(
      folderPath,
      userId,
      project_id ?? null,
      db,
    );
    const indexed = results.filter((r) => r.httpStatus < 300).length;
    res.json({
      folder: folderPath,
      total: results.length,
      indexed,
      results,
    });
  } catch (e) {
    res.status(500).json({ detail: `Folder ingest failed: ${String(e)}` });
  }
});
