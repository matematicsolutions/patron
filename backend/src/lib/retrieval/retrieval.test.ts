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
    // Wiersze documents (standalone, project_id null) - w produkcji ingest je
    // tworzy. Po audycie P2 #5 search_corpus w czacie ogolnym skopuje sie do
    // dokumentow standalone, wiec fixture musi je miec (inaczej docFilter=[]).
    const { createServerSupabase } = await import("../supabase");
    const sdb = createServerSupabase();
    for (const id of ["doc-A", "doc-B", "doc-C"]) {
      await sdb.from("documents").insert({
        id,
        user_id: "u1",
        project_id: null,
        filename: `${id}.pdf`,
        file_type: "pdf",
        status: "ready",
      });
    }
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

describe("wpiecie dual-similarity w retrieve() (ADR-0087)", () => {
  // Korpus odtwarza warunek feature: zapytanie opisuje sytuacje bez sygnatury;
  // sprawa analogiczna (w87-analog) dzieli precedens III CZP 76/13 + art. 305 KC
  // z kotwica, ale innym slownictwem (nizsza tresc); dystraktor (w87-dystraktor)
  // powtarza slowa zapytania, lecz cytuje INNY precedens (III CZP 10/19, art. 49).
  const Q = "sluzebnosc przesylu wynagrodzenie korzystanie nieruchomosc wlasciciel";

  beforeAll(async () => {
    await indexer.indexDocument(
      "w87-kotwica",
      "Sprawa o ustanowienie sluzebnosci przesylu. Wlasciciel nieruchomosci " +
        "zada wynagrodzenia za korzystanie z nieruchomosci. Sad oparl ocene na " +
        "uchwale sygn. akt III CZP 76/13 oraz na art. 305 KC.",
    );
    await indexer.indexDocument(
      "w87-analog",
      "Wynagrodzenie za korzystanie z nieruchomosci ocenia sie wedlug uchwaly " +
        "III CZP 76/13 oraz art. 305 KC co do zasad ustalania naleznosci.",
    );
    await indexer.indexDocument(
      "w87-dystraktor",
      "Sluzebnosc przesylu, wynagrodzenie za sluzebnosc przesylu, korzystanie z " +
        "nieruchomosci, wlasciciel nieruchomosci i sluzebnosc przesylu na gruncie. " +
        "Rozstrzygnieto uchwala III CZP 10/19 oraz art. 49 KC.",
    );
    // Dwa dokumenty bez encji grafu (zadna sygnatura/przepis) - do testu pustego grafu.
    await indexer.indexDocument(
      "w87-plain-1",
      "Notatka o organizacji pracy biura oraz archiwizacji korespondencji przychodzacej.",
    );
    await indexer.indexDocument(
      "w87-plain-2",
      "Procedura obiegu dokumentow wewnetrznych i rejestracji pism w sekretariacie.",
    );
  });

  it("wynosi sprawe analogiczna nad tematyczny dystraktor (flaga on odwraca kolejnosc tresci)", async () => {
    const off = await retrieval.retrieve(Q, 8, {
      vec: false,
      dualSimilarity: false,
    });
    const on = await retrieval.retrieve(Q, 8, { vec: false });

    const docsOff = off.map((r) => r.documentId);
    const docsOn = on.map((r) => r.documentId);

    const idx = (docs: string[], d: string) => docs.indexOf(d);

    // Czysta tresc: dystraktor (powtarza slowa zapytania) nad sprawa analogiczna.
    expect(idx(docsOff, "w87-dystraktor")).toBeGreaterThanOrEqual(0);
    expect(idx(docsOff, "w87-analog")).toBeGreaterThan(idx(docsOff, "w87-dystraktor"));

    // Dual-similarity: sprawa analogiczna (dzieli precedens z kotwica) nad dystraktor.
    expect(idx(docsOn, "w87-analog")).toBeGreaterThanOrEqual(0);
    expect(idx(docsOn, "w87-analog")).toBeLessThan(idx(docsOn, "w87-dystraktor"));
  });

  it("flaga off zachowuje dotychczasowa sciezke (kolejnosc czystej tresci, bez re-rankingu)", async () => {
    const a = await retrieval.retrieve(Q, 8, { vec: false, dualSimilarity: false });
    const b = await retrieval.retrieve(Q, 8, { vec: false, dualSimilarity: false });
    // Determinizm sciezki off + brak wplywu re-rankingu.
    expect(a.map((r) => r.chunkId)).toEqual(b.map((r) => r.chunkId));
  });

  it("pusty graf: re-ranking jest no-op (identyczna kolejnosc on i off)", async () => {
    // Zapytanie trafia wylacznie dokumenty bez encji grafu -> profil referencyjny
    // pusty -> structuralScore 0 -> kolejnosc tresci bez zmian (ADR-0086 brzeg).
    const q = "organizacja pracy biura archiwizacja korespondencja sekretariat";
    const off = await retrieval.retrieve(q, 8, { vec: false, dualSimilarity: false });
    const on = await retrieval.retrieve(q, 8, { vec: false });
    expect(off.every((r) => r.documentId.startsWith("w87-plain"))).toBe(true);
    expect(on.map((r) => r.chunkId)).toEqual(off.map((r) => r.chunkId));
  });
});

describe("wpiecie event-centric w retrieve() (ADR-0089 US3)", () => {
  // Korpus odtwarza warunek feature: kotwica (e89-kotwica) ma ramke zdarzenia
  // (czyn roszczenie + podstawa 32016R0679 wspolwystepuja); analog (e89-analog)
  // ma te sama ramke innym slownictwem (nizsza tresc); pulapka (e89-pulapka)
  // powtarza slowa zapytania (wysoka tresc) ale ma wartosci ROZSIANE -> brak ramki.
  const Q = "roszczenie o zaplate roszczenie zaplate sprawa naleznosci miedzy stronami";
  const FILLER = "x".repeat(220);
  const FILLER2 = "y".repeat(220);

  beforeAll(async () => {
    await indexer.indexDocument(
      "e89-kotwica",
      "Roszczenie o zaplate. Podmiot zglosil roszczenie o zaplate na podstawie " +
        "aktu 32016R0679. Sprawa o roszczenie i zaplate naleznosci miedzy stronami.",
    );
    await indexer.indexDocument(
      "e89-analog",
      "Podstawe stanowi akt 32016R0679, a samo roszczenie odnosi sie do naleznosci " +
        "ustalanej miedzy stronami danego stosunku prawnego.",
    );
    await indexer.indexDocument(
      "e89-pulapka",
      "Roszczenie o zaplate, roszczenie i zaplate, roszczenie zaplate w ujeciu " +
        "doktryny prawa zobowiazan. " +
        FILLER +
        " Akt 32016R0679 wspomniano w odrebnym przypisie bez kontekstu. " +
        FILLER2 +
        " Beta Sp. z o.o. wystepuje jedynie jako swiadek.",
    );
  });

  it("wynosi sprawe analogiczna (ma ramke) nad pulapke (wartosci rozsiane, brak ramki)", async () => {
    const off = await retrieval.retrieve(Q, 8, {
      vec: false,
      dualSimilarity: false,
      event: false,
    });
    const on = await retrieval.retrieve(Q, 8, {
      vec: false,
      dualSimilarity: false,
      event: true,
    });

    const docsOff = off.map((r) => r.documentId);
    const docsOn = on.map((r) => r.documentId);
    const idx = (docs: string[], d: string) => docs.indexOf(d);

    // Czysta tresc: pulapka (powtarza slowa) nad sprawa analogiczna (synonimy).
    expect(idx(docsOff, "e89-pulapka")).toBeGreaterThanOrEqual(0);
    expect(idx(docsOff, "e89-analog")).toBeGreaterThan(idx(docsOff, "e89-pulapka"));

    // Event-centric: sprawa analogiczna (dzieli ramke z kotwica) nad pulapke.
    expect(idx(docsOn, "e89-analog")).toBeGreaterThanOrEqual(0);
    expect(idx(docsOn, "e89-analog")).toBeLessThan(idx(docsOn, "e89-pulapka"));
  });

  it("flaga event off pomija etap (identyczna kolejnosc dwoch przebiegow)", async () => {
    const a = await retrieval.retrieve(Q, 8, { vec: false, dualSimilarity: false, event: false });
    const b = await retrieval.retrieve(Q, 8, { vec: false, dualSimilarity: false, event: false });
    expect(a.map((r) => r.chunkId)).toEqual(b.map((r) => r.chunkId));
  });
});
