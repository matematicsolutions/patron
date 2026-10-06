// Router "Zweryfikuj cytaty" (audyt Propozycja #8 / Raport CTO sek. F, ADR-0130).
//
// Wyeksponowanie istniejacej biblioteki citation (ADR-0005) jako AKCJI na gotowym
// pismie: bierze liste cytatow {ref, doc_id, quote} + sprawe i zwraca werdykt
// mechanicznej weryfikacji (ZWERYFIKOWANY/ZMODYFIKOWANY/NIEZWERYFIKOWANY/BRAK_ZRODLA)
// wzgledem tekstu akt sprawy. Deterministyczne, zero LLM, READ-ONLY. Reuzywa
// groundCitationsByRef (prefetch tekstu dokumentu + verifyCitations).

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { checkProjectAccess, ensureDocAccess } from "../lib/access";
import { buildProjectDocContext } from "../lib/chat/persistence";
import {
  groundCitationsByRef,
  groundingSummary,
} from "../lib/chat/ground-citations";
import { getDocumentTextForGrounding } from "../lib/chat/tool-dispatch";
import { attachActiveVersionPaths } from "../lib/documentVersions";
import type { DocIndex, DocStore } from "../lib/chat/types";
import { checkDocumentCitations } from "../lib/citation-check";
import {
  resolveVerifyToolCall,
  verifierPendingApproval,
  verifierServerName,
} from "../lib/citation-check/connector";

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

// POST /api/citations/check-document  body: { document_id, as_of? }
//
// "Sprawdz powolania" (ADR-0157): sygnatury i przepisy pisma sprawdzone w
// korpusie Repertorium. Tekst pisma czytamy TA SAMA sciezka co grounding
// (wersja biezaca, PDF/DOCX, bramka input-security, odwrot do OCR dla skanow),
// cytaty wyciagamy lokalnie, a do konektora idzie wylacznie ich lista.
// Tekst wraca do przegladarki na tym samym komputerze - offsety wyniku sa
// offsetami w NIM, wiec podswietlenie nie zgaduje. Ta trasa nie loguje tresci;
// wspolna sciezka odczytu (readDocumentContent) wypisuje do LOKALNEGO logu
// poczatek tekstu - to zachowanie czatu, do osobnej naprawy (ADR-0157).
//
// R-CC-03: Express 4 nie lapie odrzuconej obietnicy z async handlera, a backend
// nie ma `unhandledRejection` - wyjatek tutaj konczyl proces. Kazdy blad to
// jawne "failed" (500 + status), nigdy cisza ani upadek backendu. Do logu idzie
// tylko nazwa bledu: komunikat moze niesc sciezke pliku albo fragment danych.
citationsRouter.post("/check-document", requireAuth, async (req, res) => {
  try {
    await checkDocument(req, res);
  } catch (err) {
    console.error(
      `[citations] check-document nieudane: ${err instanceof Error ? err.name : typeof err}`,
    );
    if (!res.headersSent)
      res.status(500).json({ status: "failed", detail: "Citation check failed" });
  }
});

async function checkDocument(req: Request, res: Response): Promise<void> {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const body = (req.body ?? {}) as { document_id?: unknown; as_of?: unknown };

  if (typeof body.document_id !== "string" || !body.document_id)
    return void res.status(400).json({ detail: "document_id is required" });
  let asOf: string | null = null;
  if (body.as_of !== undefined && body.as_of !== null && body.as_of !== "") {
    if (
      typeof body.as_of !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.as_of) ||
      Number.isNaN(Date.parse(`${body.as_of}T00:00:00Z`)) ||
      // "2024-02-30" parsuje sie jako 1 marca - data musi wrocic taka sama.
      new Date(`${body.as_of}T00:00:00Z`).toISOString().slice(0, 10) !== body.as_of
    )
      return void res.status(400).json({ detail: "as_of must be YYYY-MM-DD" });
    asOf = body.as_of;
  }

  const db = createServerSupabase();
  const { data: doc } = await db
    .from("documents")
    .select("id, filename, file_type, current_version_id, user_id, project_id")
    .eq("id", body.document_id)
    .single();
  // Brak dostepu = 404, nie 403: istnienie cudzego pisma to tez informacja.
  if (!doc) return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(
    doc as { user_id: string; project_id: string | null },
    userId,
    userEmail,
    db,
  );
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const row = doc as {
    id: string;
    filename: string;
    file_type: string;
    current_version_id?: string | null;
    storage_path?: string | null;
  };
  await attachActiveVersionPaths(db, [row]);
  const docIndex: DocIndex = {
    "doc-0": {
      document_id: row.id,
      filename: row.filename,
      version_id: row.current_version_id ?? null,
    },
  };
  const docStore: DocStore = new Map();
  if (row.storage_path)
    docStore.set("doc-0", {
      storage_path: row.storage_path,
      file_type: row.file_type,
      filename: row.filename,
    });

  const text = await getDocumentTextForGrounding("doc-0", docStore, docIndex, db);
  if (!text || !text.trim())
    return void res.json({ status: "no_text", filename: row.filename });

  const callTool = await resolveVerifyToolCall();
  // B-08 (ADR-0158): konektor skonfigurowany, ale czeka na zatwierdzenie
  // Operatora - jawny stan `gateway_pending` z wartosciami do wpisania, nie
  // "nie podlaczony" i nie 500. Hash i odcisk to skroty SHA-256 (bez adresu i
  // klucza konektora).
  const pending = callTool ? null : verifierPendingApproval();
  const result = await checkDocumentCitations({
    text,
    callTool,
    asOf,
    pendingApproval: pending !== null,
  });
  res.json({
    ...result,
    filename: row.filename,
    verifier: verifierServerName(),
    ...(pending && {
      gatewayApproval: {
        server: pending.server,
        hash: pending.hash,
        origin: pending.origin,
        reason: pending.reason,
      },
    }),
    text,
  });
}
