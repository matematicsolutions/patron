// Bramka ADR-0154 na SZWIE: import Folderu Sprawy (ADR-0056) nie wypuszcza
// tylu indekserow, ile jest plikow w katalogu.
//
// Osobny plik od documentIngest.test.ts, bo mockuje indekser - reszta testow
// ingestu ma go widziec prawdziwego. Bramka mierzy LICZBE ROWNOCZESNIE
// PRACUJACYCH INDEKSEROW (przyczyne), nie pamiec (skutek) - uzasadnienie w
// ADR-0153, "Alternatywy odrzucone".
//
// Bez kolejki ten test jest czerwony: `void indexDocument(...)` w ingestDocument
// dawal szczyt rownoleglosci rowny liczbie plikow.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// --- instrumentacja indeksera: liczy, ilu pracuje naraz -----------------------
const stan = vi.hoisted(() => ({ biezaca: 0, szczyt: 0, zrobione: [] as string[] }));
const indexDocumentMock = vi.hoisted(() => vi.fn());
vi.mock("./retrieval/indexer", () => ({ indexDocument: indexDocumentMock }));

const tmpDb = path.join(os.tmpdir(), `patron-kolejka-test-${Date.now()}.db`);
const tmpStore = path.join(os.tmpdir(), `patron-kolejka-store-${Date.now()}`);
let ingest: typeof import("./documentIngest");
let kolejka: typeof import("./retrieval/index-queue");
let conn: typeof import("./db/sqlite-connection");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

/** Minimalny PDF z warstwa tekstowa - pdfjs go czyta, LibreOffice niepotrzebny. */
function minimalnyPdf(tekst: string): Buffer {
  const bs = String.fromCharCode(92);
  const esc = (s: string) =>
    s.split(bs).join(bs + bs).split("(").join(bs + "(").split(")").join(bs + ")");
  const stream = `BT\n/F1 12 Tf\n56 780 Td\n(${esc(tekst)}) Tj\nET\n`;
  const obiekty = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [4 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsety: number[] = [0];
  obiekty.forEach((o, i) => {
    offsety.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${obiekty.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= obiekty.length; i++)
    out += `${String(offsety[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${obiekty.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_STORAGE = "fs";
  process.env.PATRON_DB_PATH = tmpDb;
  process.env.PATRON_STORAGE_DIR = tmpStore;
  delete process.env.PATRON_INDEX_CONCURRENCY; // bramka mierzy DOMYSLNY limit

  indexDocumentMock.mockImplementation(async (docId: string) => {
    stan.biezaca++;
    if (stan.biezaca > stan.szczyt) stan.szczyt = stan.biezaca;
    // Indeksacja trwa DUZO dluzej niz konwersja kolejnego pliku (rzad wielkosci),
    // inaczej test bywalby zielony przypadkiem: na wolnej maszynie konwersja
    // zdazylaby wyprzedzic indeksacje i nic by sie nie nakladalo nawet bez
    // kolejki. Przy 150 ms wszystkie 12 plikow jest skonwertowanych, zanim
    // pierwsza indeksacja dobiegnie konca - bez kolejki szczyt = 12.
    await new Promise((r) => setTimeout(r, 150));
    stan.zrobione.push(docId);
    stan.biezaca--;
  });

  conn = await import("./db/sqlite-connection");
  conn.getDb();
  ingest = await import("./documentIngest");
  kolejka = await import("./retrieval/index-queue");
  const supa = await import("./supabase");
  db = supa.createServerSupabase();
}, 60_000);

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

describe("import folderu a rownoleglosc indeksacji (ADR-0154)", () => {
  it("12 plikow w folderze != 12 indekserow naraz", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-kolejka-"));
    const ILE = 12;
    for (let i = 1; i <= ILE; i++) {
      fs.writeFileSync(
        path.join(dir, `akta-${i}.pdf`),
        minimalnyPdf(`Pismo procesowe numer ${i} w sprawie o zachowek.`),
      );
    }

    const wyniki = await ingest.ingestFolder(dir, "u1", null, db);
    expect(wyniki.length).toBe(ILE);
    expect(wyniki.every((r) => r.httpStatus === 201)).toBe(true);

    // Odpowiedz wrocila - indeksacja moze jeszcze trwac (kontrakt ADR-0056).
    // Czekamy az KAZDY dokument przejdzie przez indekser, zeby czerwien tego
    // testu mowila o rownoleglosci, a nie o tym, ze pomiar sie urwal za wczesnie.
    await kolejka.awaitIndexQueueIdle();
    for (let i = 0; i < 200 && stan.zrobione.length < ILE; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(stan.zrobione.length).toBe(ILE); // zaden dokument nie wypadl z indeksu
    // Sedno bramki: szczyt rownoleglosci wyznacza LIMIT, nie liczba plikow.
    expect(stan.szczyt).toBe(kolejka.INDEX_CONCURRENCY);
    expect(stan.szczyt).toBe(2); // domyslny limit (ADR-0154)
    expect(kolejka.indexQueueStats()).toEqual({ running: 0, pending: 0 });

    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
