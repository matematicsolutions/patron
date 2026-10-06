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
//
// Tresc WYPROWADZONA z akt poza sama sprawa (audyt 2026-09):
//   - D-05: przeglad tabelaryczny tworzony z /tabular-reviews ma project_id null,
//     a moze obejmowac dokumenty sprawy. Przeglad zlozony WYLACZNIE z dokumentow
//     sprawy jest kasowany w calosci. Przeglad mieszany traci dokumenty sprawy
//     (document_ids + komorki) i WSZYSTKIE swoje czaty - wiadomosci czatu
//     przegladu nie da sie przypisac do jednego dokumentu, wiec nie da sie ich
//     "przyciac". Zostaje tytul, kolumny i komorki innych dokumentow (praca nad
//     innymi sprawami); raport liczy go osobno (tabularReviewsPruned).
//   - Czaty OGOLNE (bez sprawy), ktorych wiadomosci wskazuja dokumenty sprawy
//     (zalacznik files[] albo zdarzenie narzedzia z document_id) - kasowane w
//     calosci (linkedChats). Czaty INNYCH spraw z takim odniesieniem NIE sa
//     kasowane - to praca dla innego klienta; raport podaje ich liczbe
//     (linkedChatsOtherCases) do decyzji Operatora. Tylko tryb sqlite: w Postgresie
//     files/content to jsonb i wymagaja innego filtra (forget-case i tak jest
//     dostepny tylko w desktopie).
//   - D-06: karty zatwierdzen (mutation_approvals, ADR-0137) z tool_payload
//     zawierajacym tresc akt - kasowane PRZED czatami i dokumentami, bo FK maja
//     ON DELETE SET NULL i po kasacji karta traci powiazanie ze sprawa.
//
// Raport liczy tylko to, co FAKTYCZNIE usunieto (D-03/D-04). Kazdy blad zapisu
// bazy przerywa kasacje (kolejne kroki nie maja sensu, gdy baza jest
// zablokowana albo pelna) i trafia do `failures`. Plik akt, ktorego system nie
// dal usunac (EBUSY/EPERM), zostaje RAZEM ze swoim rekordem - inaczej bylby
// sierota bez sciezki w bazie - a sprawa nie jest kasowana, zeby mozna bylo
// ponowic. `complete === false` oznacza, ze wolajacy MUSI pokazac porazke.

import { createServerSupabase, isSqliteBackend } from "../supabase";
import { clearDocumentIndex } from "../retrieval/indexer";
import { forgetScope } from "../brain/store";
import { deleteFile, deleteFilesByPrefix, errorCode } from "../storage";
import { convertedPdfPrefix } from "../convert";

export interface ForgetFailure {
  /** Krok kasacji, ktory sie nie udal (np. "chats", "storage"). */
  step: string;
  /** Kod/komunikat bledu (EBUSY, SQLITE_BUSY, ...). Bez tresci akt. */
  error: string;
  /** Klucz storage pliku, ktorego nie udalo sie usunac (krok "storage"). */
  key?: string;
}

export interface ForgetReport {
  projectId: string;
  /** true = wszystko usuniete. false = porazka czesciowa, patrz `failures`. */
  complete: boolean;
  documents: number;
  chats: number;
  /** Czaty ogolne z trescia wyprowadzona z dokumentow sprawy - usuniete (sqlite). */
  linkedChats: number;
  /** Czaty INNYCH spraw wskazujace dokumenty sprawy - NIE usuniete, do decyzji Operatora. */
  linkedChatsOtherCases: number;
  /** Przeglady usuniete w calosci (sprawy + samodzielne tylko z jej dokumentow). */
  tabularReviews: number;
  /** Przeglady mieszane: usuniete dokumenty sprawy, ich komorki i czaty przegladu. */
  tabularReviewsPruned: number;
  /** Karty zatwierdzen (ADR-0137) z trescia akt sprawy. */
  approvalCards: number;
  ragCleared: number;
  storageFilesDeleted: number;
  brainCleared: boolean;
  failures: ForgetFailure[];
}

type Db = ReturnType<typeof createServerSupabase>;
type QueryResult = { data: unknown; error: { message?: string; code?: string } | null };

/** Blad zapisu/odczytu bazy - przerywa kasacje. */
class ForgetAbort extends Error {
  constructor(
    readonly step: string,
    readonly detail: string,
  ) {
    super(`${step}: ${detail}`);
  }
}

function idsOf(rows: unknown): string[] {
  return ((rows ?? []) as { id: string }[]).map((r) => r.id);
}

/** Wynik zapytania albo ForgetAbort - shim SQLite i supabase-js NIE rzucaja. */
async function must<T = unknown>(
  step: string,
  q: PromiseLike<QueryResult>,
): Promise<T> {
  const { data, error } = await q;
  if (error) {
    throw new ForgetAbort(step, error.code || error.message || "db error");
  }
  return data as T;
}

/** Parsuje kolumne JSON (shim oddaje obiekt, Postgres jsonb tez; tekst na wszelki wypadek). */
function jsonOf(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function mentionsAny(value: unknown, needles: string[]): boolean {
  if (needles.length === 0 || value == null) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return needles.some((n) => text.includes(n));
}

/**
 * Kasuje wszystkie dane sprawy (projektu) ze wszystkich magazynow. Idempotentne:
 * po porazce czesciowej mozna wywolac ponownie. RAG-index, brain i czaty spoza
 * sprawy - tylko w trybie sqlite (tam istnieja / tam umiemy je znalezc).
 * Zwraca raport (transparency) z `complete` i `failures`. audit_log nietkniety.
 */
export async function forgetCase(
  projectId: string,
  db: Db = createServerSupabase(),
): Promise<ForgetReport> {
  const report: ForgetReport = {
    projectId,
    complete: false,
    documents: 0,
    chats: 0,
    linkedChats: 0,
    linkedChatsOtherCases: 0,
    tabularReviews: 0,
    tabularReviewsPruned: 0,
    approvalCards: 0,
    ragCleared: 0,
    storageFilesDeleted: 0,
    brainCleared: false,
    failures: [],
  };
  try {
    await purge(projectId, db, report);
  } catch (e) {
    if (e instanceof ForgetAbort) {
      report.failures.push({ step: e.step, error: e.detail });
    } else {
      report.failures.push({ step: "unexpected", error: errorCode(e) });
    }
  }
  report.complete = report.failures.length === 0;
  return report;
}

async function purge(
  projectId: string,
  db: Db,
  report: ForgetReport,
): Promise<void> {
  const docs = await must<{ id: string; user_id: string | null }[]>(
    "read.documents",
    db.from("documents").select("id, user_id").eq("project_id", projectId),
  );
  const docIds = idsOf(docs);
  const chatIds = idsOf(
    await must("read.chats", db.from("chats").select("id").eq("project_id", projectId)),
  );

  // 1. Karty zatwierdzen (D-06) - PRZED czatami i dokumentami (FK SET NULL).
  report.approvalCards = await purgeApprovalCards(db, projectId, docIds, chatIds);

  // 2. Czaty sprawy + wiadomosci.
  if (chatIds.length) {
    await must("chats", db.from("chat_messages").delete().in("chat_id", chatIds));
  }
  await must("chats", db.from("chats").delete().eq("project_id", projectId));
  report.chats = chatIds.length;

  // 3. Czaty spoza sprawy z trescia wyprowadzona z jej dokumentow.
  if (isSqliteBackend() && docIds.length) {
    const found = await findLinkedChats(db, docIds);
    const rows = found.length
      ? await must<{ id: string; project_id: string | null }[]>(
          "linked_chats",
          db.from("chats").select("id, project_id").in("id", found),
        )
      : [];
    const linked = (rows ?? []).filter((r) => !r.project_id).map((r) => r.id);
    if (linked.length) {
      await must("linked_chats", db.from("chat_messages").delete().in("chat_id", linked));
      await must("linked_chats", db.from("chats").delete().in("id", linked));
    }
    report.linkedChats = linked.length;
    report.linkedChatsOtherCases = (rows ?? []).filter((r) => !!r.project_id).length;
  }

  // 4. Przeglady tabelaryczne: sprawy + samodzielne/obce z dokumentami sprawy (D-05).
  await purgeTabular(db, projectId, docIds, report);

  // 5. Pliki akt: NAJPIERW storage (RODO art. 17 - dane musza zniknac fizycznie),
  //    potem rekordy. Plik, ktory zostal na dysku, zatrzymuje swoj dokument.
  const keptDocs = new Set<string>();
  if (docIds.length) {
    const versions = await must<
      { document_id: string; storage_path: string | null; pdf_storage_path: string | null }[]
    >(
      "read.document_versions",
      db
        .from("document_versions")
        .select("document_id, storage_path, pdf_storage_path")
        .in("document_id", docIds),
    );
    for (const v of versions ?? []) {
      for (const key of [v.storage_path, v.pdf_storage_path]) {
        if (!key) continue;
        try {
          if (await deleteFile(key)) report.storageFilesDeleted++;
        } catch (e) {
          keptDocs.add(v.document_id);
          report.failures.push({ step: "storage", error: errorCode(e), key });
        }
      }
    }
  }
  const removable = (docs ?? []).filter((d) => !keptDocs.has(d.id));
  const removableIds = removable.map((d) => d.id);

  // 6. RAG-index per dokument (chunks/vec/FTS + extracted_entities + citation_graph).
  if (isSqliteBackend()) {
    for (const id of removableIds) {
      try {
        clearDocumentIndex(id);
      } catch (e) {
        throw new ForgetAbort("rag", errorCode(e));
      }
      report.ragCleared++;
    }
  }

  // 7. Rekordy dokumentow (edits -> versions -> documents).
  if (removableIds.length) {
    await must("documents", db.from("document_edits").delete().in("document_id", removableIds));
    await must("documents", db.from("document_versions").delete().in("document_id", removableIds));
    await must("documents", db.from("documents").delete().in("id", removableIds));
    report.documents = removableIds.length;
  }

  // 8. R-TI-04: podglad PDF renderowany W TLE moze lezec na dysku bez sciezki w
  //    bazie. Sprzatanie po prefiksie PO usunieciu wierszy - konwersja, ktora
  //    skonczy sie pozniej, nie znajdzie wersji i usunie swoj plik sama.
  for (const d of removable) {
    if (!d.user_id) continue;
    try {
      const swept = await deleteFilesByPrefix(convertedPdfPrefix(d.user_id, d.id));
      report.storageFilesDeleted += swept.deleted;
      for (const f of swept.failures) {
        report.failures.push({ step: "storage", error: f.error, key: f.key });
      }
    } catch (e) {
      report.failures.push({ step: "storage", error: errorCode(e) });
    }
  }

  // 9. Pamiec Bibliotekarza dla sprawy.
  if (isSqliteBackend()) {
    try {
      report.brainCleared = forgetScope(projectId);
    } catch (e) {
      report.failures.push({ step: "brain", error: errorCode(e) });
    }
  }

  // 10. Podfoldery i sam projekt - tylko gdy NIC nie zostalo. Sprawa z plikiem,
  //     ktorego nie dalo sie usunac, zostaje widoczna, zeby mozna bylo ponowic
  //     (rekord dokumentu nadal wskazuje plik).
  if (report.failures.length) return;
  await must("project_subfolders", db.from("project_subfolders").delete().eq("project_id", projectId));
  await must("projects", db.from("projects").delete().eq("id", projectId));
}

/**
 * D-06: karty zatwierdzen powiazane ze sprawa - przez czat sprawy, dokument
 * sprawy albo tool_payload (generate_docx niesie projectId; karta, ktorej czat
 * lub dokument juz skasowano, ma FK = NULL, ale tresc akt w payloadzie).
 * Tabela moze nie istniec w starym wdrozeniu Postgres (42P01) - wtedy nie ma kart.
 */
async function purgeApprovalCards(
  db: Db,
  projectId: string,
  docIds: string[],
  chatIds: string[],
): Promise<number> {
  const ids = new Set<string>();
  const collect = async (q: PromiseLike<QueryResult>, filter?: boolean) => {
    const { data, error } = await q;
    if (error) {
      if (error.code === "42P01") return;
      throw new ForgetAbort("approval_cards", error.code || error.message || "db error");
    }
    for (const row of (data ?? []) as { id: string; tool_payload?: unknown }[]) {
      if (!filter || mentionsAny(jsonOf(row.tool_payload), [projectId, ...docIds])) {
        ids.add(row.id);
      }
    }
  };
  if (chatIds.length) {
    await collect(db.from("mutation_approvals").select("id").in("chat_id", chatIds));
  }
  if (docIds.length) {
    await collect(db.from("mutation_approvals").select("id").in("document_id", docIds));
  }
  // Karty bez dokumentu (generate_docx) albo z dokumentem/czatem juz skasowanym.
  await collect(
    db.from("mutation_approvals").select("id, tool_payload").is("document_id", null),
    true,
  );
  if (ids.size === 0) return 0;
  await must(
    "approval_cards",
    db.from("mutation_approvals").delete().in("id", [...ids]),
  );
  return ids.size;
}

/** Czaty (dowolnej sprawy albo ogolne), w ktorych wiadomosciach pada id dokumentu sprawy. */
async function findLinkedChats(db: Db, docIds: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const id of docIds) {
    for (const col of ["files", "content"]) {
      const rows = await must<{ chat_id: string }[]>(
        "linked_chats",
        db.from("chat_messages").select("chat_id").like(col, `%${id}%`),
      );
      for (const r of rows ?? []) found.add(r.chat_id);
    }
  }
  return [...found];
}

async function purgeTabular(
  db: Db,
  projectId: string,
  docIds: string[],
  report: ForgetReport,
): Promise<void> {
  const own = idsOf(
    await must(
      "tabular",
      db.from("tabular_reviews").select("id").eq("project_id", projectId),
    ),
  );
  const toDelete = new Set<string>(own);
  const toPrune: { id: string; keep: string[] }[] = [];

  if (docIds.length) {
    const caseDocs = new Set(docIds);
    const foreign = [
      ...((await must<{ id: string; document_ids: unknown }[]>(
        "tabular",
        db.from("tabular_reviews").select("id, document_ids").is("project_id", null),
      )) ?? []),
      ...((await must<{ id: string; document_ids: unknown }[]>(
        "tabular",
        db.from("tabular_reviews").select("id, document_ids").neq("project_id", projectId),
      )) ?? []),
    ];
    for (const r of foreign) {
      const ids = jsonOf(r.document_ids);
      const list = Array.isArray(ids) ? ids.map(String) : [];
      if (!list.some((d) => caseDocs.has(d))) continue;
      const keep = list.filter((d) => !caseDocs.has(d));
      if (keep.length === 0) toDelete.add(r.id);
      else toPrune.push({ id: r.id, keep });
    }
  }

  const deleteReviewChats = async (reviewIds: string[]) => {
    const trChatIds = idsOf(
      await must(
        "tabular",
        db.from("tabular_review_chats").select("id").in("review_id", reviewIds),
      ),
    );
    if (trChatIds.length) {
      await must(
        "tabular",
        db.from("tabular_review_chat_messages").delete().in("chat_id", trChatIds),
      );
    }
    await must("tabular", db.from("tabular_review_chats").delete().in("review_id", reviewIds));
  };

  const del = [...toDelete];
  if (del.length) {
    await must("tabular", db.from("tabular_cells").delete().in("review_id", del));
    await deleteReviewChats(del);
    await must("tabular", db.from("tabular_reviews").delete().in("id", del));
  }
  report.tabularReviews = del.length;

  for (const p of toPrune) {
    await must(
      "tabular",
      db.from("tabular_cells").delete().eq("review_id", p.id).in("document_id", docIds),
    );
    await deleteReviewChats([p.id]);
    await must(
      "tabular",
      db.from("tabular_reviews").update({ document_ids: p.keep }).eq("id", p.id),
    );
    report.tabularReviewsPruned++;
  }
}
