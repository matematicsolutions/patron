// Testy RODO forgetCase (ADR-0061). Pelny scenariusz w sqlite: sprawa z
// dokumentem (zaindeksowanym), czatem, pamiecia Bibliotekarza + wpis audytowy.
// forgetCase purguje wszystko poza audit_log.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let conn: typeof import("../db/sqlite-connection");
let forget: typeof import("./forget");
let indexer: typeof import("../retrieval/indexer");
let brain: typeof import("../brain/store");
let audit: typeof import("../audit");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
const tmpDb = path.join(os.tmpdir(), `patron-rodo-test-${Date.now()}.db`);
const tmpBrain = path.join(os.tmpdir(), `patron-rodo-brain-${Date.now()}`);

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_BRAIN_DIR = tmpBrain;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  const supa = await import("../supabase");
  db = supa.createServerSupabase();
  forget = await import("./forget");
  indexer = await import("../retrieval/indexer");
  brain = await import("../brain/store");
  audit = await import("../audit");
});

afterAll(() => {
  conn.closeDb();
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(tmpBrain, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("RODO forgetCase - purga wszystkich magazynow", () => {
  it("kasuje dokumenty, RAG-index, graf, czaty, brain; audit_log zostaje", async () => {
    // --- setup sprawy ---
    const proj = await db
      .from("projects")
      .insert({ user_id: "u1", name: "Sprawa Kowalski" })
      .select("id")
      .single();
    const projectId = proj.data.id as string;

    const doc = await db
      .from("documents")
      .insert({
        project_id: projectId,
        user_id: "u1",
        filename: "pozew.docx",
        file_type: "docx",
        status: "ready",
      })
      .select("id")
      .single();
    const docId = doc.data.id as string;

    await indexer.indexDocument(
      docId,
      "Pozew o zachowek. Sad powolal uchwale Sygn. akt III CZP 11/13.",
    );
    await db
      .from("chats")
      .insert({ project_id: projectId, user_id: "u1", title: "Czat sprawy" });
    brain.saveMemory({
      scope: projectId,
      slug: "fakt",
      type: "fakt-sprawy",
      title: "WPS",
      body: "50000 zl",
    });
    // wpis audytowy - ma PRZETRWAC kasacje
    await audit.appendAuditEvent(db, {
      event_type: "chat.message.user",
      actor_user_id: "u1",
      payload: { case: projectId },
    });

    const raw = conn.getDb();
    const count = (sql: string, ...p: unknown[]) =>
      (raw.prepare(sql).get(...p) as { c: number }).c;

    // --- pre-assert ---
    expect(count("select count(*) c from documents where project_id = ?", projectId)).toBe(1);
    expect(count("select count(*) c from doc_chunks where document_id = ?", docId)).toBeGreaterThan(0);
    expect(count("select count(*) c from extracted_entities where document_id = ?", docId)).toBeGreaterThan(0);
    expect(count("select count(*) c from citation_graph where from_doc_id = ?", docId)).toBeGreaterThan(0);
    expect(brain.listMemories(projectId).length).toBe(1);
    const auditBefore = count("select count(*) c from audit_log");
    expect(auditBefore).toBeGreaterThan(0);

    // --- forget ---
    const report = await forget.forgetCase(projectId, db);
    expect(report.documents).toBe(1);
    expect(report.chats).toBe(1);
    expect(report.ragCleared).toBe(1);
    expect(report.brainCleared).toBe(true);

    // --- post-assert: wszystko puste poza audit ---
    expect(count("select count(*) c from documents where project_id = ?", projectId)).toBe(0);
    expect(count("select count(*) c from doc_chunks where document_id = ?", docId)).toBe(0);
    expect(count("select count(*) c from doc_chunks_fts")).toBe(0);
    expect(count("select count(*) c from extracted_entities where document_id = ?", docId)).toBe(0);
    expect(count("select count(*) c from citation_graph where from_doc_id = ?", docId)).toBe(0);
    expect(count("select count(*) c from chats where project_id = ?", projectId)).toBe(0);
    expect(count("select count(*) c from projects where id = ?", projectId)).toBe(0);
    expect(brain.listMemories(projectId).length).toBe(0);
    // audit_log NIETKNIETY (AI Act art. 12)
    expect(count("select count(*) c from audit_log")).toBe(auditBefore);
  });
});
