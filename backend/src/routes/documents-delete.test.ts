// DELETE /single-documents/:id - plik zablokowany nie znika po cichu (parytet
// z D-03) i podglad PDF bez sciezki w bazie jest sprzatany po prefiksie (R-TI-04).

import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmpDb = path.join(os.tmpdir(), `patron-docdel-${process.pid}-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-docdel-store-"));
let server: http.Server;
let base = "";
let conn: typeof import("../lib/db/sqlite-connection");
let storage: typeof import("../lib/storage");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let USER = "";

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE_DIR = storeDir;
  conn = await import("../lib/db/sqlite-connection");
  conn.getDb();
  storage = await import("../lib/storage");
  db = (await import("../lib/supabase")).createServerSupabase();
  USER = (await import("../lib/db/supabase-shim")).LOCAL_USER_ID;
  const express = (await import("express")).default;
  const { documentsRouter } = await import("./documents");
  const app = express();
  app.use(express.json());
  app.use("/single-documents", documentsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => {
  vi.restoreAllMocks();
  server?.close();
  conn.closeDb();
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(storeDir, { recursive: true, force: true });
});

async function mkDoc(): Promise<{ id: string; file: string }> {
  const id = (
    await db
      .from("documents")
      .insert({ project_id: null, user_id: USER, filename: "pismo.docx", file_type: "docx", status: "ready" })
      .select("id")
      .single()
  ).data.id;
  const key = storage.storageKey(USER, id, "pismo.docx");
  await storage.uploadFile(key, new ArrayBuffer(3), "application/octet-stream");
  await db.from("document_versions").insert({ document_id: id, storage_path: key, source: "upload", version_number: 1 });
  return { id, file: path.join(storeDir, key) };
}

const rows = (id: string) =>
  (conn.getDb().prepare("select count(*) c from documents where id = ?").get(id) as { c: number }).c;

describe("DELETE /single-documents/:id", () => {
  it("podglad PDF spoza document_versions (converted-pdfs/<u>/<doc>*) znika razem z dokumentem", async () => {
    const d = await mkDoc();
    await storage.uploadFile(`converted-pdfs/${USER}/${d.id}.pdf`, new ArrayBuffer(3), "application/pdf");
    await storage.uploadFile(`converted-pdfs/${USER}/${d.id}/v2.pdf`, new ArrayBuffer(3), "application/pdf");
    const res = await fetch(`${base}/single-documents/${d.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(rows(d.id)).toBe(0);
    expect(fs.existsSync(d.file)).toBe(false);
    expect(fs.existsSync(path.join(storeDir, "converted-pdfs", USER, `${d.id}.pdf`))).toBe(false);
    expect(fs.existsSync(path.join(storeDir, "converted-pdfs", USER, d.id))).toBe(false);
  });

  it("plik zablokowany: 500 z komunikatem, rekord zostaje (mozna ponowic)", async () => {
    const d = await mkDoc();
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementationOnce(async () => {
      const e: NodeJS.ErrnoException = new Error("EBUSY");
      e.code = "EBUSY";
      throw e;
    });
    const res = await fetch(`${base}/single-documents/${d.id}`, { method: "DELETE" });
    spy.mockRestore();
    const body = (await res.json()) as { detail: string; failures: unknown[] };
    expect(res.status).toBe(500);
    expect(body.detail).toContain("Dokument pozostaje");
    expect(body.failures).toEqual([{ step: "storage", error: "EBUSY" }]);
    expect(rows(d.id)).toBe(1);
    expect(fs.existsSync(d.file)).toBe(true);
    const retry = await fetch(`${base}/single-documents/${d.id}`, { method: "DELETE" });
    expect(retry.status).toBe(204);
    expect(rows(d.id)).toBe(0);
  });
});
