// documentIngest: tekst binarnego .doc przez LibreOffice (R-TI-03) i podglad
// PDF renderowany W TLE vs usuniecie dokumentu (R-TI-04). LibreOffice
// zamockowany - test nie zalezy od tego, co jest zainstalowane na maszynie.

import { Document, Packer, Paragraph } from "docx";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  indexed: [] as { docId: string; text: string }[],
  docToDocx: null as null | ((b: Buffer) => Promise<Buffer>),
  pdfGate: null as null | Promise<void>,
}));

vi.mock("./convert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./convert")>();
  return {
    ...orig,
    isLibreOfficeAvailable: () => true,
    docToDocx: vi.fn(async (b: Buffer) => {
      if (!h.docToDocx) throw new Error("brak LibreOffice Writer");
      return h.docToDocx(b);
    }),
    docxToPdf: vi.fn(async () => {
      if (h.pdfGate) await h.pdfGate;
      return Buffer.from("%PDF-1.4\n%%EOF\n");
    }),
  };
});
vi.mock("./retrieval/indexer", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./retrieval/indexer")>();
  return {
    ...orig,
    indexDocument: vi.fn(async (docId: string, text: string) => {
      h.indexed.push({ docId, text });
    }),
  };
});

const tmpDb = path.join(os.tmpdir(), `patron-ingest-docprev-${process.pid}-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-ingest-docprev-store-"));
let ingest: typeof import("./documentIngest");
let conn: typeof import("./db/sqlite-connection");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE_DIR = storeDir;
  conn = await import("./db/sqlite-connection");
  conn.getDb();
  ingest = await import("./documentIngest");
  db = (await import("./supabase")).createServerSupabase();
}, 60_000);

beforeEach(() => {
  h.indexed.length = 0;
  h.docToDocx = null;
  h.pdfGate = null;
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
  fs.rmSync(storeDir, { recursive: true, force: true });
});

const makeDocx = (text: string) =>
  Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));

/** Naglowek OLE/CFB binarnego Worda 97-2003 + wypelnienie. */
const oleDoc = () =>
  Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048, 0)]);

const statusOf = (id: string) =>
  (conn.getDb().prepare("select status from documents where id = ?").get(id) as { status: string } | undefined)?.status;

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full));
    else out.push(path.relative(storeDir, full).split(path.sep).join("/"));
  }
  return out;
}

const settle = () => new Promise((r) => setTimeout(r, 100));

// Limit wiekszy niz domyslne 5 s (wzor 5beae93): w izolacji blok trwa ~2 s, w pelnej
// suicie na Windows pierwszy test przekroczyl 5 s, a jego niedokonczony ogon zapisal
// bajty do storage i wywrocil tez nastepny test - zmierzone 2026-10-06.
describe("R-TI-03 .doc - tekst przez LibreOffice, nigdy ready bez tekstu", { timeout: 30_000 }, () => {
  it("konwersja .doc -> .docx daje tekst: ready i zindeksowany", async () => {
    const docx = await makeDocx("Pozew o zaplate 12 000 zl.");
    h.docToDocx = async () => docx;
    const r = await ingest.ingestDocument({ content: oleDoc(), filename: "pozew.doc", userId: "u1", projectId: null, db });
    expect(r.httpStatus).toBe(201);
    await settle();
    expect(statusOf(r.documentId!)).toBe("ready");
    expect(h.indexed.find((i) => i.docId === r.documentId)?.text).toContain("Pozew o zaplate");
  });

  it("konwersja pada: 422 z komunikatem, status error, bajty nie trafiaja do storage", async () => {
    const before = new Set(filesUnder(storeDir));
    const r = await ingest.ingestDocument({ content: oleDoc(), filename: "stary.doc", userId: "u1", projectId: null, db });
    expect(r.httpStatus).toBe(422);
    expect(String((r.body as { detail: string }).detail)).toContain(".doc");
    const row = conn.getDb().prepare("select status from documents where filename = 'stary.doc'").get() as { status: string };
    expect(row.status).toBe("error");
    await settle();
    expect(h.indexed).toEqual([]);
    expect(filesUnder(storeDir).filter((f) => !before.has(f))).toEqual([]);
  });

  it("konwersja daje pusty tekst: tez blad, nie ready", async () => {
    const empty = await makeDocx("");
    h.docToDocx = async () => empty;
    const r = await ingest.ingestDocument({ content: oleDoc(), filename: "pusty.doc", userId: "u1", projectId: null, db });
    expect(r.httpStatus).toBe(422);
  });
});

describe("R-TI-04 podglad PDF w tle", () => {
  it("dokument istnieje po konwersji: plik zapisany i podpiety pod wersje", async () => {
    const r = await ingest.ingestDocument({ content: await makeDocx("Umowa."), filename: "umowa.docx", userId: "u1", projectId: null, db });
    expect(r.httpStatus).toBe(201);
    await settle();
    const key = `converted-pdfs/u1/${r.documentId}.pdf`;
    expect(fs.existsSync(path.join(storeDir, key))).toBe(true);
    const v = conn.getDb().prepare("select pdf_storage_path p from document_versions where document_id = ?").get(r.documentId) as { p: string };
    expect(v.p).toBe(key);
  });

  it("dokument usuniety w trakcie konwersji: plik nie zostaje na dysku", async () => {
    let release!: () => void;
    h.pdfGate = new Promise<void>((res) => {
      release = res;
    });
    const r = await ingest.ingestDocument({ content: await makeDocx("Pismo."), filename: "pismo.docx", userId: "u1", projectId: null, db });
    expect(r.httpStatus).toBe(201);
    // Kasacja w oknie konwersji (jak DELETE dokumentu / forget-case).
    await db.from("documents").delete().eq("id", r.documentId);
    release();
    await settle();
    expect(filesUnder(storeDir).filter((f) => f.startsWith("converted-pdfs/") && f.includes(r.documentId!))).toEqual([]);
  });

  it("kasacja wyprzedza UPDATE wersji (miedzy sprawdzeniem a zapisem): konwersja sprzata swoj plik", async () => {
    let release!: () => void;
    h.pdfGate = new Promise<void>((res) => {
      release = res;
    });
    const r = await ingest.ingestDocument({ content: await makeDocx("Wezwanie."), filename: "wezwanie.docx", userId: "u1", projectId: null, db });
    const docId = r.documentId!;
    // Kasacja tuz PO sprawdzeniu istnienia wersji, a PRZED UPDATE: podpinamy sie
    // pod zapis pliku podgladu na dysk.
    const realWrite = fs.promises.writeFile;
    const spy = vi
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (...args: Parameters<typeof fs.promises.writeFile>) => {
        await realWrite(...args);
        if (String(args[0]).includes("converted-pdfs")) {
          conn.getDb().prepare("delete from documents where id = ?").run(docId);
        }
      });
    release();
    await settle();
    spy.mockRestore();
    expect(statusOf(docId)).toBeUndefined();
    expect(filesUnder(storeDir).filter((f) => f.startsWith("converted-pdfs/") && f.includes(docId))).toEqual([]);
  });
});
