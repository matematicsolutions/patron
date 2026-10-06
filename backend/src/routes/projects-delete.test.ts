// DELETE /projects/:id (jedyna sciezka kasacji sprawy w UI) - audyt D-03/D-04:
// porazka czesciowa i nieudany zapis sladu w audit_log nie sa juz 204 bez slowa.

import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auditFails: false }));

vi.mock("../lib/audit", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/audit")>();
  return {
    ...orig,
    appendAuditEvent: vi.fn((...args: Parameters<typeof orig.appendAuditEvent>) =>
      h.auditFails
        ? Promise.resolve({ ok: false as const, error: "synthetic" })
        : orig.appendAuditEvent(...args),
    ),
  };
});

const tmpDb = path.join(os.tmpdir(), `patron-projdel-${process.pid}-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-projdel-store-"));
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-projdel-brain-"));
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
  process.env.PATRON_BRAIN_DIR = brainDir;
  conn = await import("../lib/db/sqlite-connection");
  conn.getDb();
  storage = await import("../lib/storage");
  db = (await import("../lib/supabase")).createServerSupabase();
  USER = (await import("../lib/db/supabase-shim")).LOCAL_USER_ID;
  const express = (await import("express")).default;
  const { projectsRouter } = await import("./projects");
  const app = express();
  app.use(express.json());
  app.use("/projects", projectsRouter);
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
  fs.rmSync(brainDir, { recursive: true, force: true });
});

async function mkCase(): Promise<{ pid: string; file: string }> {
  const pid = (await db.from("projects").insert({ user_id: USER, name: "Sprawa" }).select("id").single()).data.id;
  const docId = (
    await db
      .from("documents")
      .insert({ project_id: pid, user_id: USER, filename: "a.docx", file_type: "docx", status: "ready" })
      .select("id")
      .single()
  ).data.id;
  const key = storage.storageKey(USER, docId, "a.docx");
  await storage.uploadFile(key, new ArrayBuffer(3), "application/octet-stream");
  await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 });
  return { pid, file: path.join(storeDir, key) };
}

const projectRows = (id: string) =>
  (conn.getDb().prepare("select count(*) c from projects where id = ?").get(id) as { c: number }).c;

describe("DELETE /projects/:id", () => {
  it("pelny sukces -> 204", async () => {
    const c = await mkCase();
    const res = await fetch(`${base}/projects/${c.pid}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(projectRows(c.pid)).toBe(0);
    expect(fs.existsSync(c.file)).toBe(false);
  });

  it("plik zablokowany -> 500 z raportem i lista niepowodzen, sprawa zostaje", async () => {
    const c = await mkCase();
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementationOnce(async () => {
      const e: NodeJS.ErrnoException = new Error("EBUSY");
      e.code = "EBUSY";
      throw e;
    });
    const res = await fetch(`${base}/projects/${c.pid}`, { method: "DELETE" });
    spy.mockRestore();
    const body = (await res.json()) as { detail: string; complete: boolean; storageFilesDeleted: number; failures: { step: string }[] };
    expect(res.status).toBe(500);
    expect(body.detail).toContain("niekompletna");
    expect(body.complete).toBe(false);
    expect(body.storageFilesDeleted).toBe(0);
    expect(body.failures.map((f) => f.step)).toEqual(["storage"]);
    expect(projectRows(c.pid)).toBe(1);
  });

  it("kasacja udana, ale slad w audit_log sie nie zapisal -> 500, nie cisza", async () => {
    const c = await mkCase();
    h.auditFails = true;
    try {
      const res = await fetch(`${base}/projects/${c.pid}`, { method: "DELETE" });
      const body = (await res.json()) as { detail: string; audit_recorded: boolean; complete: boolean };
      expect(res.status).toBe(500);
      expect(body.complete).toBe(true);
      expect(body.audit_recorded).toBe(false);
      expect(body.detail).toContain("audytow");
    } finally {
      h.auditFails = false;
    }
  });
});
