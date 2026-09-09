// Bramka ADR-0156: JEDEN ingest = JEDNO otwarcie PDF-a przez pdfjs.
//
// Mierzalna jest przyczyna, nie skutek. Progu czasowego tu nie ma swiadomie -
// czas w CI zalezy od obciazenia maszyny, a test flaky w bramce jakosci uczy
// ignorowac czerwone (ta sama zasada co w ADR-0153). Deterministyczne i tanie
// jest to, ile razy ingest wola `getDocument()` na tym samym buforze: przed
// ADR-0156 trzy razy (tekst -> drzewo struktury -> liczba stron), po nim raz.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PAGES = 12; // > 5, zeby drzewo struktury w ogole powstalo

const spy = vi.hoisted(() => ({ getDocumentCalls: 0 }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    spy.getDocumentCalls++;
    return {
      promise: Promise.resolve({
        numPages: PAGES,
        getPage: async (n: number) => ({
          getTextContent: async () => ({
            items: [
              {
                str: `Strona ${n}: pozew o zaplate kwoty tytulem zachowku, art. 991 KC.`,
              },
            ],
          }),
        }),
        getOutline: async () => null,
      }),
    };
  },
}));

let ingest: typeof import("./documentIngest");
let queue: typeof import("./retrieval/index-queue");
let conn: typeof import("./db/sqlite-connection");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
const tmpDb = path.join(os.tmpdir(), `patron-pdfjs-test-${Date.now()}.db`);
const tmpStore = path.join(os.tmpdir(), `patron-pdfjs-store-${Date.now()}`);

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE_DIR = tmpStore;
  conn = await import("./db/sqlite-connection");
  conn.getDb();
  ingest = await import("./documentIngest");
  queue = await import("./retrieval/index-queue");
  const supa = await import("./supabase");
  db = supa.createServerSupabase();
}, 60_000);

afterAll(async () => {
  // Indeksacja jest teraz w szeregu (ADR-0156) - bez tego zamknelibysmy SQLite
  // pod trwajacym zadaniem.
  await queue.flushIndexQueue();
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

describe("ingest PDF - liczba przebiegow pdfjs (ADR-0156)", () => {
  it("otwiera dokument dokladnie RAZ, a tekst, strony i drzewo bierze z tego jednego otwarcia", async () => {
    spy.getDocumentCalls = 0;

    const r = await ingest.ingestDocument({
      content: Buffer.from("%PDF-1.4\n% atrapa - pdfjs jest zamockowany\n"),
      filename: "akta-sprawy.pdf",
      userId: "u-pdfjs",
      projectId: null,
      db,
    });
    expect(r.httpStatus).toBe(201);

    // Sedno bramki: przed ADR-0156 bylo 3 (convertToMarkdown, extractStructureTree,
    // countPdfPages), kazde z pelnym parsowaniem tego samego bufora.
    expect(spy.getDocumentCalls).toBe(1);

    const d = conn.getDb();
    const row = d
      .prepare("select page_count, structure_tree from documents where id = ?")
      .get(r.documentId) as { page_count: number; structure_tree: string };

    // Metadane nadal na miejscu - jedno otwarcie ma je oddac w komplecie.
    expect(row.page_count).toBe(PAGES);
    const tree = JSON.parse(row.structure_tree) as { page_number: number }[];
    expect(tree).toHaveLength(PAGES);
    expect(tree[0].page_number).toBe(1);
    expect(tree[PAGES - 1].page_number).toBe(PAGES);
  }, 30_000);
});

describe("buildStructureTree (czysta funkcja)", () => {
  it("PDF do 5 stron nie dostaje drzewa", () => {
    expect(
      ingest.buildStructureTree("pdf", { text: "x", pageCount: 5, outline: null }, ""),
    ).toBeNull();
  });

  it("PDF z zakladkami: drzewo z zakladek, nie z listy stron", () => {
    const tree = ingest.buildStructureTree(
      "pdf",
      {
        text: "x",
        pageCount: 40,
        outline: [{ title: "Uzasadnienie" }, { title: "Sentencja" }],
      },
      "",
    ) as { title: string }[];
    expect(tree.map((n) => n.title)).toEqual(["Uzasadnienie", "Sentencja"]);
  });

  it("PDF, ktorego nie udalo sie otworzyc: brak drzewa zamiast wybuchu", () => {
    expect(ingest.buildStructureTree("pdf", null, "")).toBeNull();
  });

  it("obraz/skan: brak drzewa, tak jak przed zmiana", () => {
    expect(
      ingest.buildStructureTree("jpg", null, "Tresc rozpoznana z kserowki"),
    ).toBeNull();
  });

  it("DOCX: pierwsze 30 niepustych linii juz wyekstrahowanego tekstu", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Punkt ${i + 1}`).join("\n");
    const tree = ingest.buildStructureTree("docx", null, text) as {
      title: string;
    }[];
    expect(tree).toHaveLength(30);
    expect(tree[0].title).toBe("Punkt 1");
  });
});
