// RODO art. 17 - "zapomnij sprawe X" (ADR-0061). Purga WSZYSTKICH magazynow
// danych sprawy (projektu), w tym nowych warstw z tej sesji: RAG (doc_chunks /
// vec_chunks / FTS), graf cytowan (extracted_entities / citation_graph) oraz
// pamiec Bibliotekarza (brain). Stary rodo-delete.ts nie znal tych magazynow -
// ten modul domyka luke.
//
// Co ZOSTAJE (compliance > prawo do usuniecia): audit_log. Append-only,
// pod drzewem Merkle (AI Act art. 12 record-keeping + RODO art. 17 ust. 3 lit. b -
// przetwarzanie konieczne do obowiazku prawnego). Identyfikatory dokumentow/czatow
// w audit_log moga zostac jako historyczne referencje (payload to skroty, nie tresc).

import { createServerSupabase, isSqliteBackend } from "../supabase";
import { clearDocumentIndex } from "../retrieval/indexer";
import { forgetScope } from "../brain/store";

export interface ForgetReport {
  projectId: string;
  documents: number;
  chats: number;
  tabularReviews: number;
  ragCleared: number;
  brainCleared: boolean;
}

function idsOf(rows: unknown): string[] {
  return ((rows ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Kasuje wszystkie dane sprawy (projektu) ze wszystkich magazynow. Idempotentne.
 * RAG-index i brain czyszczone tylko w trybie sqlite (tam istnieja). Zwraca raport
 * (transparency). audit_log nietkniety (patrz naglowek modulu).
 */
export async function forgetCase(
  projectId: string,
  db: ReturnType<typeof createServerSupabase> = createServerSupabase(),
): Promise<ForgetReport> {
  const { data: docs } = await db
    .from("documents")
    .select("id")
    .eq("project_id", projectId);
  const docIds = idsOf(docs);

  const { data: chats } = await db
    .from("chats")
    .select("id")
    .eq("project_id", projectId);
  const chatIds = idsOf(chats);

  // 1. RAG-index per dokument (chunks/vec/FTS + extracted_entities + citation_graph).
  let ragCleared = 0;
  if (isSqliteBackend()) {
    for (const id of docIds) {
      clearDocumentIndex(id);
      ragCleared++;
    }
  }

  // 2. Czaty + wiadomosci.
  if (chatIds.length) {
    await db.from("chat_messages").delete().in("chat_id", chatIds);
  }
  await db.from("chats").delete().eq("project_id", projectId);

  // 3. Tabular reviews + komorki + czaty review.
  const { data: reviews } = await db
    .from("tabular_reviews")
    .select("id")
    .eq("project_id", projectId);
  const reviewIds = idsOf(reviews);
  if (reviewIds.length) {
    await db.from("tabular_cells").delete().in("review_id", reviewIds);
    const { data: trChats } = await db
      .from("tabular_review_chats")
      .select("id")
      .in("review_id", reviewIds);
    const trChatIds = idsOf(trChats);
    if (trChatIds.length) {
      await db
        .from("tabular_review_chat_messages")
        .delete()
        .in("chat_id", trChatIds);
    }
    await db.from("tabular_review_chats").delete().in("review_id", reviewIds);
  }
  await db.from("tabular_reviews").delete().eq("project_id", projectId);

  // 4. Dokumenty: edits -> versions -> documents.
  if (docIds.length) {
    await db.from("document_edits").delete().in("document_id", docIds);
    await db.from("document_versions").delete().in("document_id", docIds);
    await db.from("documents").delete().eq("project_id", projectId);
  }

  // 5. Podfoldery sprawy.
  await db.from("project_subfolders").delete().eq("project_id", projectId);

  // 6. Pamiec Bibliotekarza dla sprawy.
  let brainCleared = false;
  if (isSqliteBackend()) brainCleared = forgetScope(projectId);

  // 7. Sam projekt.
  await db.from("projects").delete().eq("id", projectId);

  return {
    projectId,
    documents: docIds.length,
    chats: chatIds.length,
    tabularReviews: reviewIds.length,
    ragCleared,
    brainCleared,
  };
}
