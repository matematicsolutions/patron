// Testy headless ingestu (ADR-0056) - ingestDocument + ingestFolder bez Express.
// Offline: PATRON_DISABLE_VEC=1 (bez modelu), storage fs do temp.

import { Document, Packer, Paragraph } from "docx";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let ingest: typeof import("./documentIngest");
let conn: typeof import("./db/sqlite-connection");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
const tmpDb = path.join(os.tmpdir(), `patron-ingest-test-${Date.now()}.db`);
const tmpStore = path.join(os.tmpdir(), `patron-ingest-store-${Date.now()}`);

async function makeDocx(text: string): Promise<Buffer> {
  const d = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return Packer.toBuffer(d);
}

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE_DIR = tmpStore;
  conn = await import("./db/sqlite-connection");
  conn.getDb();
  ingest = await import("./documentIngest");
  const supa = await import("./supabase");
  db = supa.createServerSupabase();
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
    fs.rmSync(tmpStore, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("ingestDocument (headless)", () => {
  it("docx -> 201, dokument ready + wersja V1", async () => {
    const buf = await makeDocx(
      "Opinia prawna w sprawie o zachowek. Sad powolal uchwale Sygn. akt III CZP 11/13.",
    );
    const r = await ingest.ingestDocument({
      content: buf,
      filename: "opinia.docx",
      userId: "u1",
      projectId: null,
      db,
    });
    expect(r.httpStatus).toBe(201);
    expect(typeof r.documentId).toBe("string");

    const d = conn.getDb();
    const docRow = d
      .prepare("select status, file_type, security_status from documents where id = ?")
      .get(r.documentId) as {
      status: string;
      file_type: string;
      security_status: string;
    };
    expect(docRow.status).toBe("ready");
    expect(docRow.file_type).toBe("docx");
    expect(docRow.security_status).toBe("allowed");
    const ver = d
      .prepare("select count(*) c from document_versions where document_id = ?")
      .get(r.documentId) as { c: number };
    expect(ver.c).toBe(1);
  }, 30000); // cold-start LibreOffice (docxToPdf) bywa >5s przy pierwszym docx

  it("niewspierany typ -> 400", async () => {
    const r = await ingest.ingestDocument({
      content: Buffer.from("plain text"),
      filename: "notatka.txt",
      userId: "u1",
      projectId: null,
      db,
    });
    expect(r.httpStatus).toBe(400);
    expect(r.documentId).toBeUndefined();
  });
});

describe("ingestFolder (headless)", () => {
  it("importuje wspierane pliki, pomija reszte", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-folder-"));
    fs.writeFileSync(
      path.join(dir, "a.docx"),
      await makeDocx("Pismo procesowe A o zachowek."),
    );
    fs.writeFileSync(
      path.join(dir, "b.docx"),
      await makeDocx("Pismo procesowe B, art. 991 KC."),
    );
    fs.writeFileSync(path.join(dir, "c.txt"), "nieobslugiwany");

    const results = await ingest.ingestFolder(dir, "u1", null, db);
    expect(results.length).toBe(2); // .txt pominiety
    expect(results.every((r) => r.httpStatus === 201)).toBe(true);
    expect(results.every((r) => !!r.documentId)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000); // 2x docxToPdf (LibreOffice) - cold start moze przekroczyc 5s

  it("przeszukuje podkatalogi rekurencyjnie, sciezka wzgledna w polu file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-folder-rec-"));
    const sub = path.join(dir, "Cz. 1");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "root.docx"),
      await makeDocx("Pismo w korzeniu."),
    );
    fs.writeFileSync(
      path.join(sub, "akt.docx"),
      await makeDocx("Akt oskarzenia w podfolderze."),
    );

    const results = await ingest.ingestFolder(dir, "u1", null, db);
    expect(results.length).toBe(2); // korzen + podfolder
    const files = results.map((r) => r.file).sort();
    expect(files).toEqual(["Cz. 1/akt.docx", "root.docx"]);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);
});
