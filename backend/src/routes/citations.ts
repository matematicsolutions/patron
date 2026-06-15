// Router "Zweryfikuj cytaty" (audyt Propozycja #8 / Raport CTO sek. F, ADR-0130).
//
// Wyeksponowanie istniejacej biblioteki citation (ADR-0005) jako AKCJI na gotowym
// pismie: bierze liste cytatow {ref, doc_id, quote} + sprawe i zwraca werdykt
// mechanicznej weryfikacji (ZWERYFIKOWANY/ZMODYFIKOWANY/NIEZWERYFIKOWANY/BRAK_ZRODLA)
// wzgledem tekstu akt sprawy. Deterministyczne, zero LLM, READ-ONLY. Reuzywa
// groundCitationsByRef (prefetch tekstu dokumentu + verifyCitations).

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { checkProjectAccess } from "../lib/access";
import { buildProjectDocContext } from "../lib/chat/persistence";
import {
  groundCitationsByRef,
  groundingSummary,
} from "../lib/chat/ground-citations";

export const citationsRouter = Router();

// POST /api/citations/verify  body: { project_id, citations: [{ref, doc_id, quote}] }
citationsRouter.post("/verify", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const body = req.body as {
    project_id?: string;
    citations?: unknown[];
  };

  if (!body.project_id)
    return void res.status(400).json({ detail: "project_id is required" });
  if (!Array.isArray(body.citations) || body.citations.length === 0)
    return void res.status(400).json({ detail: "citations is required" });

  const db = createServerSupabase();

  // Kontrola dostepu do sprawy (inaczej weryfikacja cytatu zdradzilaby tresc akt
  // innej kancelarii - cross-tenant). 404 dla cudzej sprawy.
  const access = await checkProjectAccess(body.project_id, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  // Tekst zrodlowy = akta sprawy (scope sprawy, jak RAG ADR-0111).
  const { docStore, docIndex } = await buildProjectDocContext(
    body.project_id,
    userId,
    db,
  );
  const byRef = await groundCitationsByRef(
    body.citations,
    docStore,
    docIndex,
    db,
  );
  const summary = groundingSummary(byRef);
  const blokada = Object.values(byRef).some((r) => r.decision === "blocked");

  res.json({ results: byRef, summary, blokada });
});
