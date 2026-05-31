// Dual-similarity case ranking (ADR-0086).
//
// Wzorzec: Ping An US12001466B2 (rodzina CN+US, brak czlonu EP -> wolne do
// stosowania w EU; patent zywy w US). Bierzemy wzorzec, nie kod - reimplementacja
// od zera, deterministyczna, offline, zero-LLM (Konstytucja Art. 1/3/7). Patrz
// ADR-0086 i THIRD_PARTY_INSPIRATIONS.md.
//
// Problem: hybrid retrieval (retrieval.ts, ADR-0054/0007) szereguje kandydatow
// przez podobienstwo tresci (wektor + BM25) oraz globalna centralnosc backlink
// dokumentu (graphRankCandidates - wazne dokumenty w ogole, niezaleznie od
// zapytania). Brakuje sygnalu strukturalnego: sprawa, ktora dzieli z zapytaniem
// wzorzec cytowan i encji (te same przepisy, te same precedensy, ta sama
// konstrukcja podstawa-roszczenie-dowod) jest analogiczna, nie tylko tematycznie
// podobna. Ten modul liczy podobienstwo strukturalne i laczy je z trescia.
//
// Reprezentacja strukturalna v1: sasiedztwo dokumentu w citation_graph oraz
// extracted_entities = zbior value_normalized encji, do ktorych dokument sie
// odwoluje (przepisy, sygnatury, kwoty-kotwice, strony). Podobienstwo = Jaccard
// dwoch zbiorow. Wielohopowy graph-walk z typowaniem rol (podstawa/roszczenie/
// dowod) to rezerwacja (nakladka na Faza C event-centric KG).
//
// GRANICA: biblioteka. Funkcje czyste (jaccard, structuralSimilarity,
// dualSimilarityRank) sa w pelni testowalne bez bazy; loadStructuralProfile jest
// cienka warstwa DB. Wpiecie w retrieve() jest rezerwacja ADR-0086 (jak
// ADR-0084/0085 - dostarczamy silnik, nie zmieniamy request-path).
//
// DETERMINIZM: zero losowosci, zero zegara, stabilne sortowanie z jawnym
// tie-breakiem. Te same wejscie daje ten sam ranking (Konstytucja Art. 3).

import { getDb } from "../db/sqlite-connection";

/** Sasiedztwo strukturalne dokumentu: zbior value_normalized encji/cytowan. */
export type StructuralProfile = ReadonlySet<string>;

export interface DualSimilarityCandidate {
  /** Identyfikator kandydata (np. chunkId albo documentId). */
  id: number | string;
  /**
   * Wynik tresci z warstwy retrievalu (RRF / wektor / BM25). Wieksze znaczy
   * lepsze. Dowolna skala - jest min-max normalizowany w obrebie zestawu
   * kandydatow przed laczeniem.
   */
  contentScore: number;
  /** Profil strukturalny kandydata. */
  profile: StructuralProfile;
}

export interface DualSimilarityOptions {
  /**
   * Waga tresci w [0,1]. combined = alpha*content + (1-alpha)*struktura.
   * alpha=1 daje czyste content (kolejnosc identyczna z wejsciowym rankingiem
   * tresci, brak regresji). alpha=0 daje czysta strukture. Default 0.6 (lekko
   * w strone tresci). Wartosci spoza [0,1] sa przycinane do [0,1].
   */
  alpha?: number;
}

export interface RankedCandidate {
  id: number | string;
  /** Wynik laczony w [0,1]. */
  score: number;
  /** Znormalizowany wynik tresci w [0,1]. */
  contentNorm: number;
  /** Podobienstwo strukturalne do referencji w [0,1]. */
  structuralScore: number;
}

const DEFAULT_ALPHA = 0.6;

/**
 * Jaccard dwoch zbiorow: rozmiar przeciecia podzielony przez rozmiar sumy.
 * Oba zbiory puste daje 0 (brak sygnalu, nie sztuczna jedynka). Symetryczny,
 * w [0,1], deterministyczny.
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  // Iteruj po mniejszym zbiorze (taniej, wynik identyczny).
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Podobienstwo strukturalne dwoch dokumentow w v1 = Jaccard ich sasiedztw w
 * grafie. Symetryczne, w [0,1]. Wyzsze warianty (wazenie centralnoscia,
 * wielohopowy walk) to rezerwacja ADR-0086.
 */
export function structuralSimilarity(
  a: StructuralProfile,
  b: StructuralProfile,
): number {
  return jaccard(a, b);
}

/**
 * Min-max normalizacja wynikow tresci do [0,1]. Gdy wszystkie rowne (albo jeden
 * kandydat) zwraca 1 dla kazdego: tresc nie roznicuje, decyzje przejmuje
 * struktura i kolejnosc wejsciowa.
 */
function normalizeContent(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = scores[0];
  let max = scores[0];
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const range = max - min;
  if (range === 0) return scores.map(() => 1);
  return scores.map((s) => (s - min) / range);
}

/**
 * Re-ranking dual-similarity. Laczy znormalizowany wynik tresci z podobienstwem
 * strukturalnym do profilu referencyjnego (sasiedztwo sprawy-kotwicy albo
 * agregat top dopasowan tresci). Zwraca kandydatow best-first.
 *
 * Pusty profil referencyjny daje structuralScore 0 dla wszystkich, wiec ranking
 * sprowadza sie do kolejnosci tresci (brak regresji, gdy brak sygnalu grafu).
 *
 * Tie-break (deterministyczny, stabilny): score malejaco, potem wyzszy
 * contentNorm, potem kolejnosc wejsciowa, na koncu porownanie id jako string.
 */
export function dualSimilarityRank(
  candidates: ReadonlyArray<DualSimilarityCandidate>,
  reference: StructuralProfile,
  opts: DualSimilarityOptions = {},
): RankedCandidate[] {
  const alpha = Math.min(1, Math.max(0, opts.alpha ?? DEFAULT_ALPHA));
  const contentNorms = normalizeContent(candidates.map((c) => c.contentScore));

  const scored = candidates.map((c, i) => {
    const structuralScore = structuralSimilarity(c.profile, reference);
    const score = alpha * contentNorms[i] + (1 - alpha) * structuralScore;
    return {
      id: c.id,
      score,
      contentNorm: contentNorms[i],
      structuralScore,
      inputIndex: i,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.contentNorm !== a.contentNorm) return b.contentNorm - a.contentNorm;
    if (a.inputIndex !== b.inputIndex) return a.inputIndex - b.inputIndex;
    const sa = String(a.id);
    const sb = String(b.id);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  return scored.map((s) => ({
    id: s.id,
    score: s.score,
    contentNorm: s.contentNorm,
    structuralScore: s.structuralScore,
  }));
}

/**
 * Buduje profil referencyjny jako sume (union) profili pierwszych topN
 * DISTINCT dokumentow w kolejnosci tresci. Wejscie: profile uporzadkowane
 * best-first po tresci, juz zdeduplikowane per dokument. topN=1 daje profil
 * sprawy-kotwicy (najmocniejsze dopasowanie tresci); topN>1 agreguje rdzen
 * strukturalny kilku czolowych spraw, co jest odporniejsze na pojedyncze
 * tematyczne dopasowanie z obca struktura. Pusty wejsciowy daje pusty profil
 * (degradacja do kolejnosci tresci, bez regresji). Czyste, deterministyczne.
 */
export function unionProfiles(
  orderedProfiles: ReadonlyArray<StructuralProfile>,
  topN: number,
): Set<string> {
  const ref = new Set<string>();
  const n = Math.max(1, Math.floor(topN));
  const limit = Math.min(n, orderedProfiles.length);
  for (let i = 0; i < limit; i++) {
    for (const v of orderedProfiles[i]) ref.add(v);
  }
  return ref;
}

/**
 * Wczytaj profil strukturalny dokumentu: zbior value_normalized encji, do
 * ktorych dokument sie odwoluje (cele krawedzi citation_graph wychodzacych z
 * dokumentu) wraz z wlasnymi encjami dokumentu. Cienka warstwa DB; cala logika
 * rankingu jest w funkcjach czystych powyzej. Zwraca pusty zbior, gdy brak
 * danych grafu (wtedy dualSimilarityRank degraduje do kolejnosci tresci).
 *
 * Spojne ze schematem uzywanym przez graphRankCandidates w retrieval.ts:
 * citation_graph(from_doc_id, to_entity_id), extracted_entities(id,
 * value_normalized, document_id).
 */
export function loadStructuralProfile(documentId: string): Set<string> {
  const db = getDb();
  const profile = new Set<string>();

  const cited = db
    .prepare(
      `select distinct e.value_normalized as vn
       from citation_graph cg
       join extracted_entities e on e.id = cg.to_entity_id
       where cg.from_doc_id = ?`,
    )
    .all(documentId) as { vn: string }[];
  for (const r of cited) if (r.vn) profile.add(r.vn);

  const own = db
    .prepare(
      `select distinct value_normalized as vn
       from extracted_entities where document_id = ?`,
    )
    .all(documentId) as { vn: string }[];
  for (const r of own) if (r.vn) profile.add(r.vn);

  return profile;
}
