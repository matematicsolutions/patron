// forgetCase (ADR-0061) - tresc wyprowadzona z akt POZA sama sprawa i jawnosc
// porazki (audyt 2026-09: D-03, D-04, D-05, D-06, R-TI-04). Pelny scenariusz
// w sqlite + storage fs w katalogu tymczasowym. Dane syntetyczne.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmpDb = path.join(os.tmpdir(), `patron-forget-derived-${process.pid}-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-forget-derived-store-"));
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-forget-derived-brain-"));

let conn: typeof import("../db/sqlite-connection");
let forget: typeof import("./forget");
let withAudit: typeof import("./forgetWithAudit");
let storage: typeof import("../storage");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

const U = "u-forget";

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_STORAGE_DIR = storeDir;
  process.env.PATRON_BRAIN_DIR = brainDir;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  db = (await import("../supabase")).createServerSupabase();
  forget = await import("./forget");
  withAudit = await import("./forgetWithAudit");
  storage = await import("../storage");
}, 60_000);

afterAll(() => {
  vi.restoreAllMocks();
  conn.closeDb();
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(storeDir, { recursive: true, force: true });
  fs.rmSync(brainDir, { recursive: true, force: true });
});

async function mkProject(name: string): Promise<string> {
  return (await db.from("projects").insert({ user_id: U, name }).select("id").single()).data.id;
}

async function mkDoc(projectId: string | null, filename = "umowa.docx"): Promise<string> {
  return (
    await db
      .from("documents")
      .insert({ project_id: projectId, user_id: U, filename, file_type: "docx", status: "ready" })
      .select("id")
      .single()
  ).data.id;
}

async function mkStoredDoc(projectId: string): Promise<{ docId: string; file: string; key: string }> {
  const docId = await mkDoc(projectId);
  const key = storage.storageKey(U, docId, "umowa.docx");
  await storage.uploadFile(key, new TextEncoder().encode("tresc akt").buffer as ArrayBuffer, "application/octet-stream");
  await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 });
  return { docId, key, file: path.join(storeDir, key) };
}

async function mkReview(docIds: string[], projectId: string | null, chatText: string): Promise<string> {
  const reviewId = (
    await db
      .from("tabular_reviews")
      .insert({
        user_id: U,
        title: "Przeglad umow",
        columns_config: [{ index: 0, name: "Kara", prompt: "Jaka kara?" }],
        document_ids: docIds,
        project_id: projectId,
      })
      .select("id")
      .single()
  ).data.id;
  for (const d of docIds) {
    await db.from("tabular_cells").insert({ review_id: reviewId, document_id: d, column_index: 0, status: "done", content: { summary: "x" } });
  }
  const chatId = (await db.from("tabular_review_chats").insert({ review_id: reviewId, user_id: U, title: "c" }).select("id").single()).data.id;
  await db.from("tabular_review_chat_messages").insert({ chat_id: chatId, role: "assistant", content: [{ type: "content", text: chatText }] });
  return reviewId;
}

const count = (sql: string, ...p: unknown[]) =>
  (conn.getDb().prepare(sql).get(...p) as { c: number }).c;

describe("D-05 przeglady tabelaryczne spoza sprawy", () => {
  it("przeglad samodzielny tylko z dokumentow sprawy - usuniety w calosci", async () => {
    const pid = await mkProject("Sprawa A");
    const doc = await mkDoc(pid);
    const reviewId = await mkReview([doc], null, "Kara 10 000 zl (umowa, par. 7).");
    const report = await forget.forgetCase(pid, db);
    expect(report.complete).toBe(true);
    expect(report.tabularReviews).toBe(1);
    expect(count("select count(*) c from tabular_reviews where id = ?", reviewId)).toBe(0);
    expect(count("select count(*) c from tabular_review_chats where review_id = ?", reviewId)).toBe(0);
    expect(count("select count(*) c from tabular_review_chat_messages")).toBe(0);
  });

  it("przeglad mieszany - traci dokumenty sprawy, ich komorki i czaty; reszta zostaje", async () => {
    const pid = await mkProject("Sprawa B");
    const other = await mkProject("Sprawa inna");
    const doc = await mkDoc(pid);
    const foreignDoc = await mkDoc(other);
    const reviewId = await mkReview([doc, foreignDoc], null, "Porownanie kar z obu umow.");
    const report = await forget.forgetCase(pid, db);
    expect(report.complete).toBe(true);
    expect(report.tabularReviews).toBe(0);
    expect(report.tabularReviewsPruned).toBe(1);
    const row = conn.getDb().prepare("select document_ids from tabular_reviews where id = ?").get(reviewId) as { document_ids: string };
    expect(JSON.parse(row.document_ids)).toEqual([foreignDoc]);
    expect(count("select count(*) c from tabular_cells where review_id = ? and document_id = ?", reviewId, foreignDoc)).toBe(1);
    expect(count("select count(*) c from tabular_review_chats where review_id = ?", reviewId)).toBe(0);
    // dokument innej sprawy nietkniety
    expect(count("select count(*) c from documents where id = ?", foreignDoc)).toBe(1);
  });

  it("przeglad bez dokumentow sprawy - nietkniety", async () => {
    const pid = await mkProject("Sprawa C");
    await mkDoc(pid);
    const other = await mkProject("Sprawa D");
    const foreignDoc = await mkDoc(other);
    const reviewId = await mkReview([foreignDoc], null, "Inna sprawa.");
    await forget.forgetCase(pid, db);
    expect(count("select count(*) c from tabular_review_chats where review_id = ?", reviewId)).toBe(1);
  });
});

describe("czaty spoza sprawy z zalacznikiem z akt sprawy", () => {
  it("czat ogolny z files[] wskazujacym dokument sprawy - usuniety; czat bez odniesienia zostaje", async () => {
    const pid = await mkProject("Sprawa E");
    const doc = await mkDoc(pid);
    const linked = (await db.from("chats").insert({ project_id: null, user_id: U, title: "Pytanie" }).select("id").single()).data.id;
    await db.from("chat_messages").insert({ chat_id: linked, role: "user", content: "Streszcz umowe", files: [{ document_id: doc, filename: "umowa.docx" }] });
    const unrelated = (await db.from("chats").insert({ project_id: null, user_id: U, title: "Inne" }).select("id").single()).data.id;
    await db.from("chat_messages").insert({ chat_id: unrelated, role: "user", content: "Co to jest zachowek?" });
    const report = await forget.forgetCase(pid, db);
    expect(report.linkedChats).toBe(1);
    expect(count("select count(*) c from chats where id = ?", linked)).toBe(0);
    expect(count("select count(*) c from chat_messages where chat_id = ?", linked)).toBe(0);
    expect(count("select count(*) c from chats where id = ?", unrelated)).toBe(1);
  });

  it("czat INNEJ sprawy z odniesieniem do dokumentu sprawy - zostaje, raport go liczy", async () => {
    const pid = await mkProject("Sprawa F");
    const doc = await mkDoc(pid);
    const inna = await mkProject("Sprawa G");
    const cudzy = (await db.from("chats").insert({ project_id: inna, user_id: U, title: "Praca G" }).select("id").single()).data.id;
    await db.from("chat_messages").insert({ chat_id: cudzy, role: "user", content: "Porownaj", files: [{ document_id: doc, filename: "umowa.docx" }] });
    const report = await forget.forgetCase(pid, db);
    expect(report.linkedChats).toBe(0);
    expect(report.linkedChatsOtherCases).toBe(1);
    expect(count("select count(*) c from chats where id = ?", cudzy)).toBe(1);
  });
});

describe("D-06 karty zatwierdzen", () => {
  it("karty po czacie, dokumencie i projectId w payloadzie znikaja; obca karta zostaje", async () => {
    const { stageMutationApproval } = await import("../mutation-approval");
    const pid = await mkProject("Sprawa F");
    const doc = await mkDoc(pid);
    const chatId = (await db.from("chats").insert({ project_id: pid, user_id: U, title: "x" }).select("id").single()).data.id;
    await stageMutationApproval(db, { userId: U, chatId, documentId: doc, toolName: "edit_document", toolPayload: { document_id: doc, edits: [{ find: "a", replace: "b" }] } });
    // Karta generate_docx, ktorej czat juz skasowano (FK SET NULL) - zostaje tylko projectId.
    await stageMutationApproval(db, { userId: U, chatId: null, documentId: null, toolName: "generate_docx", toolPayload: { title: "Pismo", sections: [], projectId: pid } });
    const otherPid = await mkProject("Sprawa G");
    await stageMutationApproval(db, { userId: U, chatId: null, documentId: null, toolName: "generate_docx", toolPayload: { title: "Inne", sections: [], projectId: otherPid } });
    const report = await forget.forgetCase(pid, db);
    expect(report.approvalCards).toBe(2);
    const left = conn.getDb().prepare("select tool_payload from mutation_approvals").all() as { tool_payload: string }[];
    expect(left.some((r) => r.tool_payload.includes(pid))).toBe(false);
    expect(left.some((r) => r.tool_payload.includes(otherPid))).toBe(true);
  });
});

describe("R-TI-04 podglad PDF bez sciezki w bazie", () => {
  it("converted-pdfs/<user>/<doc>* jest kasowany po prefiksie", async () => {
    const pid = await mkProject("Sprawa H");
    const { docId } = await mkStoredDoc(pid);
    await storage.uploadFile(`converted-pdfs/${U}/${docId}.pdf`, new ArrayBuffer(4), "application/pdf");
    await storage.uploadFile(`converted-pdfs/${U}/${docId}/v2.pdf`, new ArrayBuffer(4), "application/pdf");
    const report = await forget.forgetCase(pid, db);
    expect(report.complete).toBe(true);
    expect(fs.existsSync(path.join(storeDir, "converted-pdfs", U, `${docId}.pdf`))).toBe(false);
    expect(fs.existsSync(path.join(storeDir, "converted-pdfs", U, docId))).toBe(false);
    // zrodlo + 2 podglady
    expect(report.storageFilesDeleted).toBe(3);
  });
});

describe("D-03 plik akt zablokowany przez inny proces", () => {
  it("nie jest liczony, jego rekord i sprawa zostaja, raport niekompletny; ponowienie konczy kasacje", async () => {
    const pid = await mkProject("Sprawa I");
    const locked = await mkStoredDoc(pid);
    const free = await mkStoredDoc(pid);
    const realUnlink = fs.promises.unlink;
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementation(async (p) => {
      if (path.resolve(String(p)) === path.resolve(locked.file)) {
        const e: NodeJS.ErrnoException = new Error("EBUSY: resource busy or locked");
        e.code = "EBUSY";
        throw e;
      }
      return realUnlink(p);
    });
    try {
      const report = await forget.forgetCase(pid, db);
      expect(report.complete).toBe(false);
      expect(report.storageFilesDeleted).toBe(1);
      expect(report.documents).toBe(1);
      expect(report.failures).toEqual([{ step: "storage", error: "EBUSY", key: locked.key }]);
      expect(fs.existsSync(locked.file)).toBe(true);
      expect(fs.existsSync(free.file)).toBe(false);
      expect(count("select count(*) c from document_versions where storage_path = ?", locked.key)).toBe(1);
      expect(count("select count(*) c from projects where id = ?", pid)).toBe(1);
    } finally {
      spy.mockRestore();
    }
    const retry = await forget.forgetCase(pid, db);
    expect(retry.complete).toBe(true);
    expect(fs.existsSync(locked.file)).toBe(false);
    expect(count("select count(*) c from projects where id = ?", pid)).toBe(0);
  });

  it("forgetCaseWithAudit: porazka czesciowa = 500 z raportem, slad w audit_log z complete=false", async () => {
    const pid = await mkProject("Sprawa J");
    const locked = await mkStoredDoc(pid);
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementation(async () => {
      const e: NodeJS.ErrnoException = new Error("EPERM");
      e.code = "EPERM";
      throw e;
    });
    try {
      const out = await withAudit.forgetCaseWithAudit(db, pid, U);
      expect(out.status).toBe(500);
      expect(out.body.complete).toBe(false);
      expect(out.body.storageFilesDeleted).toBe(0);
      expect(String(out.body.detail)).toContain("niekompletna");
      const ev = conn
        .getDb()
        .prepare("select payload from audit_log where event_type = 'rodo.delete' order by rowid desc limit 1")
        .get() as { payload: string };
      const payload = JSON.parse(ev.payload);
      expect(payload.project_id).toBe(pid);
      expect(payload.complete).toBe(false);
      expect(payload.failed_steps).toBe("storage");
      expect(ev.payload).not.toContain(locked.key);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("D-04 blad zapisu bazy", () => {
  it("baza zablokowana przez inny proces: nic nie usunieto, raport niekompletny, nic nie policzone", async () => {
    const pid = await mkProject("Sprawa K");
    const chatId = (await db.from("chats").insert({ project_id: pid, user_id: U, title: "x" }).select("id").single()).data.id;
    await db.from("chat_messages").insert({ chat_id: chatId, role: "user", content: "tresc" });
    const raw = conn.getDb();
    const prevTimeout = raw.pragma("busy_timeout", { simple: true });
    raw.pragma("busy_timeout = 50");
    const Database = (await import("better-sqlite3")).default;
    const other = new Database(tmpDb);
    other.prepare("BEGIN IMMEDIATE").run();
    let report;
    try {
      report = await forget.forgetCase(pid, db);
    } finally {
      other.prepare("ROLLBACK").run();
      other.close();
      raw.pragma(`busy_timeout = ${Number(prevTimeout)}`);
    }
    expect(report.complete).toBe(false);
    expect(report.chats).toBe(0);
    expect(report.failures[0].step).toBe("chats");
    expect(count("select count(*) c from projects where id = ?", pid)).toBe(1);
    expect(count("select count(*) c from chat_messages where chat_id = ?", chatId)).toBe(1);
  });
});
