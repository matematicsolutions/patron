// Eval rankingowy dual-similarity (ADR-0086 wpiecie, Faza B).
//
// Cel: zmierzyc, czy re-ranking dual-similarity poprawia trafnosc retrievalu
// dla wyszukiwania spraw ANALOGICZNYCH (dzielacych wzorzec cytowan i przepisow
// z zapytaniem), zanim wepniemy go w retrieve() na slepo (ADR-0086 odlozyl
// wpiecie wlasnie po to). Mierzymy te sama logike, ktora wprowadza wpiecie:
// baseline = retrieve() z dualSimilarity:false (czysta tresc RRF), wariant =
// baseline + unionProfiles + dualSimilarityRank, czyli to co robi etap re-rankingu
// wpiety w retrieve() (ADR-0087). Harness jest tez strazem regresji tej logiki.
//
// Relewancja gold = analogia strukturalna (sprawa cytujaca ten sam precedens i
// te same przepisy co zapytanie), czyli dokladnie sygnal, ktory ten feature
// celuje. Na korpusie, gdzie relewancja bylaby czysto leksykalna, dual-similarity
// jest neutralny przy alpha=1 / pustym grafie (osobne inwarianty ponizej).
//
// Offline, deterministyczny: PATRON_DISABLE_VEC=1 (BM25 + graf + RRF, zero LLM,
// zero zegara w metryce). Vitest drukuje tabele sweep (alpha x referenceTopN).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  dualSimilarityRank,
  unionProfiles,
  type StructuralProfile,
} from "./dualSimilarity";

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let dual: typeof import("./dualSimilarity");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-dual-eval-${Date.now()}.db`);

// Korpus: dwa klastry spraw analogicznych + tematyczne dystraktory + szum.
// Dystraktory celowo maja wysokie pokrycie leksykalne z zapytaniem (te same
// slowa: zachowek/darowizna, rekojmia/wada), ale CYTUJA INNE precedensy i
// przepisy -> wysoko w BM25, nisko w strukturze. Sprawy analogiczne cytuja
// ten sam precedens + przepis co zapytanie, ale innym jezykiem.
// Warunek, ktory feature celuje (ADR-0086): zapytanie opisuje SYTUACJE
// naturalnym jezykiem (bez sygnatury). Sprawa analogiczna dzieli wzorzec
// cytowan z kotwica (ten sam precedens + przepis), ale opisuje rzecz INNYM
// slownictwem -> NIZSZY wynik leksykalny niz tematyczny dystraktor, ktory
// powtarza slowa zapytania, lecz cytuje INNY precedens. Czysta tresc (BM25)
// stawia dystraktor nad sprawe analogiczna; sygnal strukturalny to odwraca.
const CORPUS: { id: string; text: string }[] = [
  // Klaster ALFA: precedens III CZP 11/13 + art. 991 KC.
  // alfa-kotwica: bogate slownictwo sytuacji + precedens (kandydat na top tresci).
  {
    id: "alfa-kotwica",
    text:
      "Sprawa o obliczenie zachowku. Przy doliczeniu darowizny do substratu " +
      "spadkowego uprawniony domaga sie rozliczenia darowizny. Sad oparl " +
      "rozstrzygniecie na uchwale sygn. akt III CZP 11/13 oraz na art. 991 KC.",
  },
  // alfa-analog-1/2: ten sam precedens + przepis, INNE slownictwo (malo slow zapytania).
  {
    id: "alfa-analog-1",
    text:
      "Kierunek wykladni wyznacza uchwala III CZP 11/13 oraz art. 991 KC co do " +
      "charakteru przysporzenia miedzy stronami i sposobu jego ujecia.",
  },
  {
    id: "alfa-analog-2",
    text:
      "Naleznosc pieniezna opiera sie na art. 991 KC; wiazaca pozostaje uchwala " +
      "III CZP 11/13 dotyczaca traktowania przysporzen przy ustalaniu udzialu.",
  },
  // dystraktor: powtarza slowa zapytania (wysoka tresc), INNY precedens + przepis.
  {
    id: "alfa-dystraktor",
    text:
      "Obliczenie zachowku, doliczenie darowizny do substratu spadkowego, " +
      "uprawniony i rozliczenie darowizny przy zachowku, substrat i darowizna. " +
      "Rozstrzygniecie oparto na uchwale III CZP 99/20 oraz na art. 1000 KC.",
  },
  // Klaster BETA: precedens II CSK 200/15 + art. 556 KC.
  {
    id: "beta-kotwica",
    text:
      "Sprawa o rekojmie za wade fizyczna rzeczy sprzedanej. Kupujacy podnosi, ze " +
      "wada zmniejsza uzytecznosc rzeczy. Sad powolal wyrok II CSK 200/15 oraz " +
      "art. 556 KC przy ocenie odpowiedzialnosci sprzedawcy.",
  },
  {
    id: "beta-analog-1",
    text:
      "Standard oceny wyznacza wyrok II CSK 200/15 oraz art. 556 KC w zakresie " +
      "przeslanek odpowiedzialnosci miedzy stronami umowy.",
  },
  {
    id: "beta-analog-2",
    text:
      "Podstawa pozostaje art. 556 KC, a kierunek interpretacji okresla wyrok " +
      "II CSK 200/15 co do zakresu obowiazkow strony zobowiazanej.",
  },
  {
    id: "beta-dystraktor",
    text:
      "Rekojmia za wade fizyczna rzeczy sprzedanej, wada zmniejszajaca uzytecznosc " +
      "rzeczy, kupujacy i sprzedawca, wada rzeczy i rekojmia sprzedawcy. " +
      "Rozstrzygnieto wyrokiem I CSK 5/18 oraz art. 560 KC.",
  },
  // Szum: inny temat, inne encje.
  {
    id: "szum-rodo",
    text:
      "Administrator danych osobowych realizuje obowiazek informacyjny zgodnie z " +
      "art. 13 rozporzadzenia ogolnego o ochronie danych osobowych.",
  },
];

interface GoldQuery {
  query: string;
  relevant: Set<string>; // docId sprawy analogicznej
}

// Zapytania opisuja SYTUACJE bez sygnatury - analogia musi przyjsc ze struktury.
const QUERIES: GoldQuery[] = [
  {
    query:
      "obliczenie zachowku przy doliczeniu darowizny do substratu spadkowego uprawniony rozliczenie",
    relevant: new Set(["alfa-kotwica", "alfa-analog-1", "alfa-analog-2"]),
  },
  {
    query:
      "rekojmia za wade fizyczna rzeczy sprzedanej wada zmniejsza uzytecznosc kupujacy sprzedawca",
    relevant: new Set(["beta-kotwica", "beta-analog-1", "beta-analog-2"]),
  },
];

const K = 5; // odciecie metryki
const REF_TOP_N = [1, 3];
const ALPHAS = [0.0, 0.3, 0.6, 0.8, 1.0];

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

/** recall@k = trafione gold w top-k / wszystkie gold. */
function recallAtK(rankedDocs: string[], relevant: Set<string>, k: number): number {
  const r = new Set(rankedDocs.slice(0, k));
  let hit = 0;
  for (const g of relevant) if (r.has(g)) hit++;
  return relevant.size === 0 ? 0 : hit / relevant.size;
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

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DISABLE_VEC = "1";
  process.env.PATRON_DB_PATH = tmp;
  conn = await import("../db/sqlite-connection");
  conn.getDb();
  indexer = await import("./indexer");
  retrieval = await import("./retrieval");
  dual = await import("./dualSimilarity");
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

/**
 * Liczy sredni nDCG@K / recall@K po QUERIES dla danej konfiguracji re-rankingu.
 * referenceTopN=null oznacza BASELINE (czysta kolejnosc tresci, bez re-rankingu).
 */
async function evaluate(
  referenceTopN: number | null,
  alpha: number,
): Promise<{ ndcg: number; recall: number }> {
  let ndcgSum = 0;
  let recallSum = 0;
  for (const gq of QUERIES) {
    // Pelna lista fused (k duze = caly korpus), czysta tresc (baseline).
    const base = await retrieval.retrieve(gq.query, 50, { vec: false, dualSimilarity: false });

    let rankedDocs: string[];
    if (referenceTopN === null) {
      rankedDocs = distinctDocs(base);
    } else {
      // Profil per DISTINCT dokument, w kolejnosci tresci.
      const orderedDocs = distinctDocs(base);
      const profByDoc = new Map<string, StructuralProfile>();
      for (const d of orderedDocs) {
        profByDoc.set(d, dual.loadStructuralProfile(d));
      }
      const reference = unionProfiles(
        orderedDocs.map((d) => profByDoc.get(d)!),
        referenceTopN,
      );
      const candidates = base.map((c) => ({
        id: c.chunkId,
        contentScore: c.score,
        profile: profByDoc.get(c.documentId)!,
      }));
      const ranked = dualSimilarityRank(candidates, reference, { alpha });
      const chunkDoc = new Map(base.map((c) => [c.chunkId, c.documentId]));
      rankedDocs = distinctDocs(
        ranked.map((r) => ({ documentId: chunkDoc.get(r.id as number)! })),
      );
    }

    ndcgSum += ndcgAtK(rankedDocs, gq.relevant, K);
    recallSum += recallAtK(rankedDocs, gq.relevant, K);
  }
  return { ndcg: ndcgSum / QUERIES.length, recall: recallSum / QUERIES.length };
}

describe("eval rankingowy dual-similarity (analogia strukturalna)", () => {
  it("sweep alpha x referenceTopN vs baseline - dual poprawia nDCG@k", async () => {
    const baseline = await evaluate(null, 1);
    const rows: string[] = [];
    rows.push(
      `baseline (czysta tresc):            nDCG@${K}=${baseline.ndcg.toFixed(4)}  recall@${K}=${baseline.recall.toFixed(4)}`,
    );

    let best = { ndcg: baseline.ndcg, recall: baseline.recall, topN: 0, alpha: 1 };
    for (const topN of REF_TOP_N) {
      for (const alpha of ALPHAS) {
        const r = await evaluate(topN, alpha);
        rows.push(
          `dual topN=${topN} alpha=${alpha.toFixed(1)}:           nDCG@${K}=${r.ndcg.toFixed(4)}  recall@${K}=${r.recall.toFixed(4)}`,
        );
        if (r.ndcg > best.ndcg + 1e-9) {
          best = { ndcg: r.ndcg, recall: r.recall, topN, alpha };
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log("\n=== EVAL dual-similarity (ADR-0086 wpiecie) ===\n" + rows.join("\n") + "\n");
    // eslint-disable-next-line no-console
    console.log(
      `NAJLEPSZY: topN=${best.topN} alpha=${best.alpha} nDCG@${K}=${best.ndcg.toFixed(4)} (baseline ${baseline.ndcg.toFixed(4)})\n`,
    );

    // Najlepsza konfiguracja dual-similarity bije baseline na analogii.
    expect(best.ndcg).toBeGreaterThan(baseline.ndcg);

    // Strazenie KONFIGURACJI PRODUKCYJNEJ (topN=1, alpha=0.6): musi bic baseline.
    const prod = await evaluate(1, 0.6);
    expect(prod.ndcg).toBeGreaterThan(baseline.ndcg);
  });

  it("alpha=1 odtwarza baseline (brak regresji przy czystej tresci)", async () => {
    const baseline = await evaluate(null, 1);
    for (const topN of REF_TOP_N) {
      const r = await evaluate(topN, 1.0);
      expect(r.ndcg).toBeCloseTo(baseline.ndcg, 6);
      expect(r.recall).toBeCloseTo(baseline.recall, 6);
    }
  });

  it("pusty profil referencyjny odtwarza baseline (brak regresji przy pustym grafie)", async () => {
    const baseline = await evaluate(null, 1);
    // Reczne wymuszenie pustej referencji przy alpha 0.6: structuralScore=0 dla
    // wszystkich -> kolejnosc tresci.
    let ndcgSum = 0;
    for (const gq of QUERIES) {
      const base = await retrieval.retrieve(gq.query, 50, { vec: false, dualSimilarity: false });
      const candidates = base.map((c) => ({
        id: c.chunkId,
        contentScore: c.score,
        profile: new Set<string>(),
      }));
      const ranked = dualSimilarityRank(candidates, new Set<string>(), { alpha: 0.6 });
      const chunkDoc = new Map(base.map((c) => [c.chunkId, c.documentId]));
      const rankedDocs = distinctDocs(
        ranked.map((r) => ({ documentId: chunkDoc.get(r.id as number)! })),
      );
      ndcgSum += ndcgAtK(rankedDocs, gq.relevant, K);
    }
    expect(ndcgSum / QUERIES.length).toBeCloseTo(baseline.ndcg, 6);
  });
});
