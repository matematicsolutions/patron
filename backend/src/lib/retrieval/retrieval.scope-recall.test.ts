// Zakres sprawy PRZED rankingiem, nie po nim (2026-10-06).
//
// Do tej zmiany `retrieve(..., { documentIds })` bral z CALEGO korpusu globalne
// top `k*3*4` fragmentow kazdego silnika i dopiero potem odrzucal te spoza
// sprawy. Gdy korpus mial wiecej mocniej pasujacych fragmentow z innych spraw
// niz miescilo sie w tym oknie, fragmenty sprawy wypadaly przed filtrem i
// retrieval zwracal [] - bez zadnego sygnalu, wiec model mowil "w aktach nic
// nie ma". Wzorzec z helixdb/helix-db (idea): przeszukiwanie zawezone do
// kandydatow, ktorych dopuszcza zakres - u nich skan dokladny dal recall 1,0
// tam, gdzie filtr po fakcie dawal 0,69.
//
// Offline: PATRON_DISABLE_VEC=1 (BM25 + graf, deterministycznie). Sciezka
// wektorowa ma ten sam ksztalt zapytania - patrz vecSearch.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-scope-recall-${Date.now()}.db`);

const DYSTRAKTOROW = 120;
const ZAPYTANIE = "wypowiedzenie umowy najmu lokalu";

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmp;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  indexer = await import("./indexer");
  retrieval = await import("./retrieval");

  // Inne sprawy: krotkie, gesto nasycone terminami zapytania -> wysoki BM25.
  for (let i = 0; i < DYSTRAKTOROW; i++) {
    await indexer.indexDocument(
      `inna-${i}`,
      "Wypowiedzenie umowy najmu lokalu. Wypowiedzenie umowy najmu lokalu uzytkowego.",
    );
  }
  // Sprawa: terminy zapytania raz, w dluzszym tekscie -> nizszy BM25.
  await indexer.indexDocument(
    "sprawa-1",
    "Notatka z narady zespolu procesowego o terminach w postepowaniu, kosztach " +
      "zastepstwa i harmonogramie przesluchan swiadkow. Klient rozwaza wypowiedzenie " +
      "umowy najmu, ale najpierw chce poznac skutki podatkowe i stan zaleglosci czynszu.",
  );
  await indexer.indexDocument(
    "sprawa-2",
    "Opinia o ochronie danych osobowych i obowiazku informacyjnym administratora.",
  );
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

describe("zakres sprawy przed rankingiem (documentIds)", () => {
  it("kontrola pozytywna: bez zakresu top-k zajmuja inne sprawy (scenariusz naprawde wypycha sprawe)", async () => {
    const res = await retrieval.retrieve(ZAPYTANIE, 8, { vec: false, graph: false });
    expect(res.length).toBe(8);
    expect(res.every((r) => r.documentId.startsWith("inna-"))).toBe(true);
  });

  it("zakres sprawy zwraca jej fragment mimo DYSTRAKTOROW mocniejszych trafien w korpusie", async () => {
    const res = await retrieval.retrieve(ZAPYTANIE, 8, {
      vec: false,
      documentIds: ["sprawa-1"],
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.documentId === "sprawa-1")).toBe(true);
  });

  it("zakres bez trafien w sprawie -> [] (nie cudze fragmenty)", async () => {
    const res = await retrieval.retrieve(ZAPYTANIE, 8, {
      vec: false,
      documentIds: ["sprawa-2"],
    });
    expect(res).toEqual([]);
  });

  it("zakres wielu dokumentow: tylko dozwolone, sprawa-1 obecna", async () => {
    const res = await retrieval.retrieve(ZAPYTANIE, 8, {
      vec: false,
      documentIds: ["sprawa-1", "sprawa-2", "inna-0"],
    });
    const docs = new Set(res.map((r) => r.documentId));
    expect([...docs].every((d) => ["sprawa-1", "sprawa-2", "inna-0"].includes(d))).toBe(true);
    expect(docs.has("sprawa-1")).toBe(true);
  });
});
