// Testy hybrid retrieval (ADR-0054). Offline: PATRON_DISABLE_VEC=1 wylacza
// warstwe wektorowa (model/sqlite-vec) - testujemy deterministyczne BM25 +
// graf + ekstrakcje encji + czysta fuzje RRF. Warstwa wektorowa: smoke.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-retrieval-test-${Date.now()}.db`);

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmp;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  indexer = await import("./indexer");
  retrieval = await import("./retrieval");
});

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

describe("reciprocalRankFusion (pure)", () => {
  it("nagradza pozycje wspolne dla wielu list", () => {
    const fused = retrieval.reciprocalRankFusion([
      [1, 2, 3],
      [2, 3, 4],
    ]);
    expect(fused[0].id).toBe(2); // w obu listach wysoko
    expect(fused.map((f) => f.id)).toContain(4);
  });

  it("pusta lista list -> pusty wynik", () => {
    expect(retrieval.reciprocalRankFusion([])).toEqual([]);
  });
});

describe("buildFtsMatch", () => {
  it("tokenizuje sygnature na OR", () => {
    const m = retrieval.buildFtsMatch("III CZP 11/13");
    expect(m).toContain('"iii"');
    expect(m).toContain('"czp"');
    expect(m).toContain(" OR ");
  });
  it("pusty/niealfanumeryczny -> null", () => {
    expect(retrieval.buildFtsMatch("   ")).toBeNull();
  });
});

describe("indexDocument + retrieve (BM25 + graf + encje)", () => {
  beforeAll(async () => {
    await indexer.indexDocument(
      "doc-A",
      "Opinia w sprawie zachowku. Sad odwolal sie do uchwaly Sygn. akt III CZP 11/13, " +
        "ktora rozstrzyga kwestie doliczania darowizn do substratu zachowku.",
    );
    await indexer.indexDocument(
      "doc-B",
      "Pismo procesowe. Powolujemy sie na wyrok III CZP 11/13 oraz na art. 991 KC " +
        "w kontekscie roszczenia o zachowek po spadkodawcy.",
    );
    await indexer.indexDocument(
      "doc-C",
      "Notatka o RODO. Administrator danych osobowych realizuje obowiazek informacyjny " +
        "zgodnie z art. 13 rozporzadzenia ogolnego o ochronie danych.",
    );
  });

  it("ekstrahuje sygnature orzeczenia jako encje grafu", () => {
    const db = conn.getDb();
    const rows = db
      .prepare(
        "select value, value_normalized from extracted_entities where entity_type = 'SYGNATURA_ORZECZENIA'",
      )
      .all() as { value: string; value_normalized: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2); // doc-A i doc-B
    expect(rows.some((r) => /CZP/i.test(r.value))).toBe(true);
  });

  it("tworzy krawedzie citation_graph (cytuje_orzeczenie)", () => {
    const db = conn.getDb();
    const edges = db
      .prepare(
        "select count(*) as c from citation_graph where relation = 'cytuje_orzeczenie'",
      )
      .get() as { c: number };
    expect(edges.c).toBeGreaterThanOrEqual(2);
  });

  it("BM25 szereguje pelna sygnature (doc-A/doc-B) nad slabe dopasowanie (doc-C dzieli tylko token '13')", async () => {
    const res = await retrieval.retrieve("III CZP 11/13", 5, { vec: false });
    expect(res.length).toBeGreaterThan(0);
    const topDocs = res.map((r) => r.documentId);
    expect(topDocs[0] === "doc-A" || topDocs[0] === "doc-B").toBe(true);
    // doc-C trafia jako slaby hit (token "13" z "art. 13"), ale ma byc nizej
    // niz oba dokumenty z pelna sygnatura.
    const idxC = topDocs.indexOf("doc-C");
    if (idxC !== -1) {
      expect(idxC).toBeGreaterThan(topDocs.indexOf("doc-A"));
      expect(idxC).toBeGreaterThan(topDocs.indexOf("doc-B"));
    }
  });

  it("documentIds scope: zwraca tylko fragmenty z dozwolonych dokumentow", async () => {
    const res = await retrieval.retrieve("III CZP 11/13", 5, {
      vec: false,
      documentIds: ["doc-A"],
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.documentId === "doc-A")).toBe(true);
  });

  it("documentIds puste -> brak trafien", async () => {
    const res = await retrieval.retrieve("III CZP 11/13", 5, {
      vec: false,
      documentIds: [],
    });
    expect(res).toEqual([]);
  });

  it("re-index jest idempotentny (brak duplikatow chunkow)", async () => {
    const db = conn.getDb();
    await indexer.indexDocument("doc-C", "Nowa tresc notatki o RODO i art. 13.");
    const cnt = db
      .prepare("select count(*) as c from doc_chunks where document_id = 'doc-C'")
      .get() as { c: number };
    expect(cnt.c).toBeGreaterThan(0);
    const fts = db
      .prepare("select count(*) as c from doc_chunks_fts")
      .get() as { c: number };
    const chunks = db
      .prepare("select count(*) as c from doc_chunks")
      .get() as { c: number };
    expect(fts.c).toBe(chunks.c); // FTS w sync z doc_chunks po re-index
  });
});

describe("narzedzie search_corpus (dispatch, bez LLM)", () => {
  it("zwraca fragmenty z korpusu w tool_result", async () => {
    const { runToolCalls } = await import("../chat/tool-dispatch");
    const { createServerSupabase } = await import("../supabase");
    const db = createServerSupabase();
    const out = await runToolCalls(
      [
        {
          id: "tc-1",
          function: {
            name: "search_corpus",
            arguments: JSON.stringify({ query: "III CZP 11/13" }),
          },
        },
      ],
      new Map(),
      "u1",
      db,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    );
    const tr = out.toolResults[0] as { content: string };
    const parsed = JSON.parse(tr.content) as {
      results: { document_id: string; text: string }[];
    };
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(
      parsed.results.some(
        (r) => r.document_id === "doc-A" || /CZP/i.test(r.text),
      ),
    ).toBe(true);
  });
});
