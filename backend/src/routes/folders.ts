// Folder Sprawy (ADR-0056) - import dokumentow z lokalnego katalogu.
//
// Endpoint dostepny TYLKO w trybie desktop (PATRON_DB_BACKEND=sqlite). Czyta
// lokalny dysk maszyny - w trybie chmurowym (multi-tenant) czytanie dowolnej
// sciezki serwera byloby grozne, wiec jest tam zablokowany (404).

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { ingestFolder } from "../lib/documentIngest";
import { promises as fs } from "node:fs";
import path from "node:path";

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
  // Walidacja sciezki: czytelny blad 400 zamiast nieczytelnego 500 (naprawia
  // znany bug "import folderu nie dziala w buildzie" - zla sciezka leciala jako
  // wyjatek -> 500). Ochrona przed zdalnym odczytem dowolnego katalogu zapewnia
  // bind loopback w trybie desktop (index.ts); tu single-user czyta wlasny dysk.
  const resolvedPath = path.resolve(folderPath);
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    return void res
      .status(400)
      .json({ detail: `Katalog nie istnieje lub brak dostepu: ${folderPath}` });
  }
  if (!stat.isDirectory()) {
    return void res
      .status(400)
      .json({ detail: `Sciezka nie jest katalogiem: ${folderPath}` });
  }
  const db = createServerSupabase();
  try {
    const results = await ingestFolder(
      resolvedPath,
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
