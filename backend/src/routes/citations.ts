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
  // Kontrakt endpointu mowi `doc_id`, ale magazyn tekstu jest kluczowany
  // POZYCYJNIE (`doc-0`, `doc-1`... - patrz buildProjectDocContext). Wolajacy,
  // ktory poda prawdziwy identyfikator dokumentu albo nazwe pliku, dostawal
  // wiec 100% BRAK_ZRODLA (zmierzone 2026-08-21). Normalizujemy wejscie do
  // etykiety magazynu; etykieta podana wprost dziala jak dotad.
  const naEtykiete = new Map<string, string>();
  for (const [label, info] of Object.entries(docIndex)) {
    naEtykiete.set(label, label);
    if (info.document_id) naEtykiete.set(String(info.document_id), label);
    if (info.filename) naEtykiete.set(String(info.filename), label);
  }
  const znormalizowane = body.citations.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const cyt = { ...(raw as Record<string, unknown>) };
    // `ref` musi byc liczba - string byl po cichu odrzucany, a odpowiedz
    // brzmiala "brak blokady" przy ZEROWEJ weryfikacji.
    if (typeof cyt.ref === "string" && cyt.ref.trim() !== "") {
      const n = Number(cyt.ref);
      if (Number.isFinite(n)) cyt.ref = n;
    }
    if (typeof cyt.doc_id === "string") {
      const label = naEtykiete.get(cyt.doc_id);
      if (label) cyt.doc_id = label;
    }
    return cyt;
  });

  const byRef = await groundCitationsByRef(
    znormalizowane,
    docStore,
    docIndex,
    db,
  );
  const summary = groundingSummary(byRef);
  const blokada = Object.values(byRef).some((r) => r.decision === "blocked");

  res.json({ results: byRef, summary, blokada });
});
