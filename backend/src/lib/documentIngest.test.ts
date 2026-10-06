// Testy headless ingestu (ADR-0056) - ingestDocument + ingestFolder bez Express.
// Offline: PATRON_DISABLE_VEC=1 (bez modelu), storage fs do temp.

import { Document, Packer, Paragraph } from "docx";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  opisDozwolonychTypow,
  podpowiedzBrakujacegoSkladnika,
  typDozwolony,
} from "./documentIngest";

let ingest: typeof import("./documentIngest");
let queue: typeof import("./retrieval/index-queue");
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
  queue = await import("./retrieval/index-queue");
  const supa = await import("./supabase");
  db = supa.createServerSupabase();
  // Hook laduje SQLite, warstwe ingestu i klienta storage - pod pelnym biegiem
  // (109 plikow testowych rownolegle) domyslne 10 s bywa za krotkie i plik pada
  // TIMEOUTEM, nie asercja. W izolacji ten sam hook konczy sie w ok. 2 s.
  // Czerwone z powodu obciazenia maszyny uczy ignorowac czerwone.
}, 60_000);

afterAll(async () => {
  // ADR-0156: indeksacja idzie szeregiem PO odpowiedzi, wiec zamkniecie SQLite
  // bez opróznienia szeregu przerwaloby trwajace zadanie.
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
    // Limit wiekszy niz domyslne 5 s: w izolacji test trwa ~0,4 s (pierwszy, leniwy import
    // mammoth), ale w pelnej suicie (pool forks, rownolegle procesy) przekraczal 5 s - zmierzone
    // 2026-10-01. 30 s nadal lapie zawieszenie.
  }, 30_000);

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
  });

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

// Zdolnosci wstrzykiwane, nie odpytywane: `isLibreOfficeAvailable()` czyta system
// plikow, wiec na maszynie WM zwraca true, a w CI false - test oparty na niej
// mierzylby maszyne, nie regule.
describe("typDozwolony - zbior typow zalezy od zdolnosci srodowiska", () => {
  const BRAK = { libreoffice: false, ocr: false };
  const PELNE = { libreoffice: true, ocr: true };

  it("pdf i docx sa przyjmowane ZAWSZE - nie wymagaja niczego z zewnatrz", () => {
    for (const s of ["pdf", "docx"]) {
      expect(typDozwolony(s, BRAK), s).toBe(true);
      expect(typDozwolony(s, PELNE), s).toBe(true);
    }
  });

  it("stary .doc BEZ LibreOffice jest odrzucany, nie przyjmowany po cichu", () => {
    // Do 2026-09-09 przechodzil: `extractDocxBodyText` to parser ZIP-a, a .doc to
    // format OLE - ekstrakcja padala, tekst byl pusty, dokument nie wchodzil do
    // indeksu i nie dalo sie go wyswietlic. Plik ladowal w bazie jako "ready"
    // i znikal z zycia mecenasa. Czyste odrzucenie jest uczciwsze.
    expect(typDozwolony("doc", BRAK)).toBe(false);
    expect(typDozwolony("doc", PELNE)).toBe(true);
  });

  it("obrazy zaleza od OCR - istniejacy precedens, ten sam ksztalt", () => {
    expect(typDozwolony("png", BRAK)).toBe(false);
    expect(typDozwolony("png", { libreoffice: false, ocr: true })).toBe(true);
  });

  it("nieznany typ odpada niezaleznie od zdolnosci", () => {
    for (const z of [BRAK, PELNE]) expect(typDozwolony("txt", z)).toBe(false);
  });

  it("opis dozwolonych typow NIE klamie o tym, czego nie przyjmiemy", () => {
    // Lista w komunikacie 400 i regula wpuszczajaca maja jeden dom: kazdy typ
    // wymieniony w opisie musi realnie przechodzic przy tych samych zdolnosciach.
    for (const z of [BRAK, PELNE, { libreoffice: true, ocr: false }]) {
      const opis = opisDozwolonychTypow(z);
      expect(opis.includes("doc,") || opis.endsWith("doc")).toBe(z.libreoffice);
      for (const s of ["pdf", "docx", "doc", "png"]) {
        if (!typDozwolony(s, z)) {
          expect(
            opis.split(/[\s,]+/).includes(s),
            `opis wymienia ${s}, ktorego nie przyjmiemy`,
          ).toBe(false);
        }
      }
    }
  });

  it("komunikat nazywa BRAKUJACY skladnik, nie tylko liste dozwolonych", () => {
    const p = podpowiedzBrakujacegoSkladnika("doc", BRAK);
    expect(p).toContain("LibreOffice");
    expect(p).toContain(".docx");
    // Gdy skladnik jest, nie ma czego podpowiadac.
    expect(podpowiedzBrakujacegoSkladnika("doc", PELNE)).toBe("");
    expect(podpowiedzBrakujacegoSkladnika("pdf", BRAK)).toBe("");
  });
});
