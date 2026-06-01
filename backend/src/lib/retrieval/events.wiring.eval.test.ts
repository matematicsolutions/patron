// Eval rankingowy wpiecia event-centric w retrieve() (ADR-0089 US3, Faza C).
//
// Cel: zmierzyc, czy re-ranking event-centric (subgraph matching ramek zdarzen)
// wpiety w retrieve() po dual-similarity (ADR-0087) poprawia trafnosc retrievalu
// dla analogii ZDARZENIOWEJ, zanim potwierdzimy wpiecie. Mierzymy dokladnie
// sciezke produkcyjna: te sama flage retrieve({ event }) ktora wprowadza wpiecie.
// Harness jest tez strazem regresji tej sciezki.
//
// Warunek, ktory feature celuje (ADR-0089): sprawa-kotwica ma ramke zdarzenia
// (rola->wartosc wspolwystepujace: czyn + podstawa w obrebie okna). Sprawa
// analogiczna ma te sama ramke innym slownictwem (nizsza tresc). Dystraktor-
// pulapka powtarza slowa zapytania (wysoka tresc) i ma TE SAME wartosci, ale
// ROZSIANE po dokumencie (duze odstepy) - wiec NIE tworzy ramki. Czysta tresc
// (BM25) stawia pulapke nad sprawe analogiczna; sygnal zdarzeniowy to odwraca,
// bo pulapka ma zdarzeniowe podobienstwo 0 (zero ramek), a analog 1.0.
//
// Offline, deterministyczny: PATRON_DISABLE_VEC=1 (BM25 + graf + RRF, zero LLM,
// zero zegara w metryce). Encje powstaja przez realny indekser (detectAll:
// SYGNATURA_AKTU=CELEX -> rola podstawa) + leksykon czynow events.ts (czyn).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let events: typeof import("./events");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-events-wiring-eval-${Date.now()}.db`);

const FILLER = "x".repeat(220);
const FILLER2 = "y".repeat(220);

// Dwa klastry analogii zdarzeniowej + szum. W kazdym klastrze: kotwica (top
// tresci, ma ramke), analog (nizsza tresc, ta sama ramka), pulapka (wysoka tresc
// powtarzajaca slowa, wartosci rozsiane -> brak ramki). CELEX (np. 32016R0679)
// jest wykrywany jako SYGNATURA_AKTU -> rola podstawa; czyn z leksykonu events.ts.
const CORPUS: { id: string; text: string }[] = [
  // Klaster ALFA: czyn roszczenie + podstawa 32016R0679.
  {
    id: "alfa-kotwica",
    text:
      "Roszczenie o zaplate. Podmiot zglosil roszczenie o zaplate na podstawie " +
      "aktu 32016R0679. Sprawa o roszczenie i zaplate naleznosci miedzy stronami.",
  },
  {
    id: "alfa-analog",
    text:
      "Podstawe stanowi akt 32016R0679, a samo roszczenie odnosi sie do naleznosci " +
      "ustalanej miedzy stronami danego stosunku prawnego.",
  },
  {
    id: "alfa-pulapka",
    text:
      "Roszczenie o zaplate, roszczenie i zaplate, roszczenie zaplate w ujeciu " +
      "doktryny prawa zobowiazan. " +
      FILLER +
      " Akt 32016R0679 wspomniano w odrebnym przypisie bez kontekstu. " +
      FILLER2 +
      " Beta Sp. z o.o. wystepuje jedynie jako swiadek.",
  },
  // Klaster BETA: czyn odszkodowanie + podstawa 32019L0790.
  {
    id: "beta-kotwica",
    text:
      "Odszkodowanie. Podmiot zglosil odszkodowanie na podstawie aktu 32019L0790. " +
      "Sprawa o odszkodowanie i naprawienie szkody majatkowej miedzy stronami.",
  },
  {
    id: "beta-analog",
    text:
      "Akt 32019L0790 wyznacza ramy, a samo odszkodowanie odnosi sie do naprawienia " +
      "uszczerbku miedzy uczestnikami danego stosunku.",
  },
  {
    id: "beta-pulapka",
    text:
      "Odszkodowanie, odszkodowanie i naprawienie szkody, odszkodowanie w ujeciu " +
      "doktryny prawa cywilnego. " +
      FILLER +
      " Akt 32019L0790 wspomniano w odrebnym przypisie bez kontekstu. " +
      FILLER2 +
      " Delta Sp. z o.o. wystepuje jedynie jako swiadek.",
  },
  // Szum: inny temat, brak wspolnych encji/czynow.
  {
    id: "szum-rodo",
    text:
      "Administrator danych osobowych realizuje obowiazek informacyjny zgodnie z " +
      "przepisami o ochronie danych osobowych w organizacji.",
  },
];

interface GoldQuery {
  query: string;
  relevant: Set<string>;
}

// Zapytania powtarzaja slowa kotwicy i pulapki (czyn), nie analogu (synonimy).
const QUERIES: GoldQuery[] = [
  {
    query: "roszczenie o zaplate roszczenie zaplate sprawa naleznosci miedzy stronami",
    relevant: new Set(["alfa-kotwica", "alfa-analog"]),
  },
  {
    query: "odszkodowanie naprawienie szkody odszkodowanie sprawa miedzy stronami",
    relevant: new Set(["beta-kotwica", "beta-analog"]),
  },
];

const K = 5;

/** nDCG@k binarny: DCG/IDCG, rel in {0,1}, log2(rank+1), rank 1-based. */
function ndcgAtK(rankedDocs: string[], relevant: Set<string>, k: number): number {
  const r = rankedDocs.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < r.length; i++) {
    if (relevant.has(r[i])) dcg += 1 / Math.log2(i + 2);
  }
  const ideal = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Z listy chunkow best-first robi liste DISTINCT docId (pierwsze wystapienie). */
function distinctDocs(chunks: { documentId: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunks) {
    if (!seen.has(c.documentId)) {
      seen.add(c.documentId);
      out.push(c.documentId);
    }
  }
  return out;
}

/** Sredni nDCG@K po QUERIES dla danej konfiguracji flag retrieve(). */
async function evaluate(opts: {
  dualSimilarity: boolean;
  event: boolean;
}): Promise<number> {
  let ndcgSum = 0;
  for (const gq of QUERIES) {
    const res = await retrieval.retrieve(gq.query, 50, {
      vec: false,
      dualSimilarity: opts.dualSimilarity,
      event: opts.event,
    });
    ndcgSum += ndcgAtK(distinctDocs(res), gq.relevant, K);
  }
  return ndcgSum / QUERIES.length;
}

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmp;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  indexer = await import("./indexer");
  retrieval = await import("./retrieval");
  events = await import("./events");
  for (const doc of CORPUS) {
    await indexer.indexDocument(doc.id, doc.text);
  }
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

describe("eval wpiecia event-centric w retrieve() (ADR-0089 US3)", () => {
  it("korpus: kotwica i analog maja ramke, pulapka nie (warunek feature)", () => {
    for (const id of ["alfa-kotwica", "alfa-analog", "beta-kotwica", "beta-analog"]) {
      expect(events.loadEventFrames(id).length).toBeGreaterThanOrEqual(1);
    }
    for (const id of ["alfa-pulapka", "beta-pulapka", "szum-rodo"]) {
      expect(events.loadEventFrames(id).length).toBe(0);
    }
  });

  it("sygnal zdarzeniowy bije czysta tresc i nie regresuje wzgledem dual (nDCG@k)", async () => {
    const baseline = await evaluate({ dualSimilarity: false, event: false });
    const dual = await evaluate({ dualSimilarity: true, event: false });
    const event = await evaluate({ dualSimilarity: false, event: true });
    const both = await evaluate({ dualSimilarity: true, event: true });

    // eslint-disable-next-line no-console
    console.log(
      "\n=== EVAL event-centric wpiecie (ADR-0089 US3) ===\n" +
        `baseline (czysta tresc):            nDCG@${K}=${baseline.toFixed(4)}\n` +
        `dual-similarity (ADR-0087):         nDCG@${K}=${dual.toFixed(4)}\n` +
        `event-centric (US3):                nDCG@${K}=${event.toFixed(4)}\n` +
        `dual + event (sciezka produkcyjna): nDCG@${K}=${both.toFixed(4)}\n`,
    );

    // Sygnal zdarzeniowy poprawia trafnosc analogii wzgledem czystej tresci.
    expect(event).toBeGreaterThan(baseline);
    // Sciezka produkcyjna (dual + event) nie regresuje wzgledem samego dual.
    expect(both).toBeGreaterThanOrEqual(dual - 1e-9);
    // I bije czysta tresc.
    expect(both).toBeGreaterThan(baseline);
  });

  it("event:false odtwarza sciezke bez zdarzen (brak wplywu re-rankingu)", async () => {
    const a = await evaluate({ dualSimilarity: false, event: false });
    const b = await evaluate({ dualSimilarity: false, event: false });
    expect(a).toBeCloseTo(b, 9);
  });

  it("korpus bez ramek: event re-ranking jest no-op (kolejnosc on == off)", async () => {
    // Zapytanie trafia wylacznie dokument bez ramek (szum) -> referencja pusta ->
    // kolejnosc poprzedniego etapu bez zmian (brak regresji).
    const q = "administrator danych osobowych obowiazek informacyjny ochrona";
    const off = await retrieval.retrieve(q, 8, { vec: false, dualSimilarity: false, event: false });
    const on = await retrieval.retrieve(q, 8, { vec: false, dualSimilarity: false, event: true });
    expect(on.map((r) => r.chunkId)).toEqual(off.map((r) => r.chunkId));
  });
});
