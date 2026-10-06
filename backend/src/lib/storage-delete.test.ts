// storage (tryb fs): deleteFile nie polyka bledow innych niz ENOENT (audyt D-03)
// i deleteFilesByPrefix sprzata pliki bez sciezki w bazie (R-TI-04).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-storage-delete-"));
let storage: typeof import("./storage");

beforeAll(async () => {
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_STORAGE_DIR = storeDir;
  storage = await import("./storage");
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(storeDir, { recursive: true, force: true });
});

const put = (key: string) => storage.uploadFile(key, new ArrayBuffer(3), "application/octet-stream");
const exists = (key: string) => fs.existsSync(path.join(storeDir, key));

describe("deleteFile", () => {
  it("usuniety -> true, juz nieistniejacy -> false (idempotentnie)", async () => {
    await put("documents/u1/d1/source.docx");
    expect(await storage.deleteFile("documents/u1/d1/source.docx")).toBe(true);
    expect(await storage.deleteFile("documents/u1/d1/source.docx")).toBe(false);
  });

  it("plik zablokowany (EBUSY) -> rzuca, plik zostaje", async () => {
    await put("documents/u1/d2/source.docx");
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementationOnce(async () => {
      const e: NodeJS.ErrnoException = new Error("EBUSY");
      e.code = "EBUSY";
      throw e;
    });
    await expect(storage.deleteFile("documents/u1/d2/source.docx")).rejects.toMatchObject({ code: "EBUSY" });
    spy.mockRestore();
    expect(exists("documents/u1/d2/source.docx")).toBe(true);
  });
});

describe("deleteFilesByPrefix", () => {
  it("kasuje plik <doc>.pdf i katalog <doc>/, nie dotyka innych dokumentow", async () => {
    await put("converted-pdfs/u1/doc-a.pdf");
    await put("converted-pdfs/u1/doc-a/v1.pdf");
    await put("converted-pdfs/u1/doc-b.pdf");
    const r = await storage.deleteFilesByPrefix("converted-pdfs/u1/doc-a");
    expect(r).toEqual({ deleted: 2, failures: [] });
    expect(exists("converted-pdfs/u1/doc-a.pdf")).toBe(false);
    expect(exists("converted-pdfs/u1/doc-a")).toBe(false);
    expect(exists("converted-pdfs/u1/doc-b.pdf")).toBe(true);
  });

  it("brak katalogu -> zero, bez bledu", async () => {
    expect(await storage.deleteFilesByPrefix("converted-pdfs/nikt/doc-x")).toEqual({ deleted: 0, failures: [] });
  });

  it("porazka pojedynczego pliku trafia do failures, nie rzuca", async () => {
    await put("converted-pdfs/u2/doc-c.pdf");
    const spy = vi.spyOn(fs.promises, "unlink").mockImplementationOnce(async () => {
      const e: NodeJS.ErrnoException = new Error("EPERM");
      e.code = "EPERM";
      throw e;
    });
    const r = await storage.deleteFilesByPrefix("converted-pdfs/u2/doc-c");
    spy.mockRestore();
    expect(r).toEqual({ deleted: 0, failures: [{ key: "converted-pdfs/u2/doc-c.pdf", error: "EPERM" }] });
  });

  it("zbyt szeroki prefiks albo traversal -> odmowa", async () => {
    await expect(storage.deleteFilesByPrefix("converted-pdfs/")).rejects.toThrow(/zbyt szeroki/);
    await expect(storage.deleteFilesByPrefix("converted-pdfs/u1")).rejects.toThrow(/zbyt szeroki/);
    await expect(storage.deleteFilesByPrefix("../../etc/passwd")).rejects.toThrow(/traversal/);
  });
});
