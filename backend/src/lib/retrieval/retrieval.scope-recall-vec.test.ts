// Zakres sprawy przed rankingiem - sciezka WEKTOROWA na prawdziwym sqlite-vec
// (2026-10-06). Siostra retrieval.scope-recall.test.ts (BM25). Model embeddera
// zastapiony deterministycznym wektorem: dystraktory leza tuz przy zapytaniu,
// fragment sprawy dalej - wiec globalny KNN (stary filtr po fakcie) go gubi.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DIM = Number(process.env.PATRON_EMBED_DIM) || 384;

/** Znormalizowany wektor: kierunek bazowy + zaburzenie o sile `szum` w osi `os`. */
function wektor(szum: number, os: number): Float32Array {
  const v = new Float32Array(DIM);
  v[0] = 1;
  v[1 + (os % (DIM - 1))] = szum;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

vi.mock("./embeddings", async (importOriginal) => {
  const oryginal = await importOriginal<typeof import("./embeddings")>();
  const dlaTekstu = (t: string): Float32Array => {
    const m = /DYSTRAKTOR-(\d+)/.exec(t);
    if (m) return wektor(0.01, Number(m[1]));      // tuz przy zapytaniu
    if (t.includes("SPRAWA-WEKTOR")) return wektor(0.5, 7); // dalej, ale najblizej w zakresie
    if (t.includes("ODLEGLA")) return wektor(5, 11);
    return wektor(0, 0);                            // zapytanie
  };
  return {
    ...oryginal,
    embed: async (texts: string[]) => texts.map(dlaTekstu),
    embedOne: async (text: string) => dlaTekstu(text),
  };
});

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-scope-recall-vec-${Date.now()}.db`);
const DYSTRAKTOROW = 120;

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  delete process.env.PATRON_DISABLE_VEC;
  process.env.PATRON_DB_PATH = tmp;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  indexer = await import("./indexer");
  retrieval = await import("./retrieval");
  for (let i = 0; i < DYSTRAKTOROW; i++) {
    await indexer.indexDocument(`inna-${i}`, `Notatka DYSTRAKTOR-${i} z innej sprawy.`);
  }
  await indexer.indexDocument("sprawa-1", "Notatka SPRAWA-WEKTOR z akt tej sprawy.");
  await indexer.indexDocument("sprawa-2", "Notatka ODLEGLA o czyms innym.");
}, 120_000);

afterAll(() => {
  conn.closeDb();
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("zakres sprawy przed rankingiem - wektor (sqlite-vec)", () => {
  it("warstwa wektorowa jest WLACZONA (inaczej test niczego nie mierzy)", () => {
    expect(conn.isVecEnabled()).toBe(true);
  });

  it("kontrola pozytywna: bez zakresu top-k to dystraktory", async () => {
    const res = await retrieval.retrieve("zapytanie", 8, { bm25: false, graph: false });
    expect(res.length).toBe(8);
    expect(res.every((r) => r.documentId.startsWith("inna-"))).toBe(true);
  });

  it("zakres sprawy: wektor znajduje jej fragment mimo DYSTRAKTOROW blizszych", async () => {
    const res = await retrieval.retrieve("zapytanie", 8, {
      bm25: false,
      graph: false,
      documentIds: ["sprawa-1", "sprawa-2"],
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].documentId).toBe("sprawa-1");
    expect(res.every((r) => r.documentId.startsWith("sprawa-"))).toBe(true);
  });
});
