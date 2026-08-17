// Hybrid retrieval (ADR-0007, adaptacja SQLite w ADR-0054).
//
//   zapytanie -> [wektor: sqlite-vec]  -> top-k_v + rank
//             -> [BM25: FTS5 bm25()]   -> top-k_b + rank
//             -> [graf: backlink centrality na kandydatach] -> rank
//             -> reciprocal rank fusion (k=RRF_K) -> top-k chunkow
//
// Wektor lapie podobienstwo semantyczne; BM25 lapie dokladne terminy ktore
// embedding myli (sygnatury "III CZP 11/13", NIP, daty DzU); graf wzmacnia
// dokumenty ktorych orzeczenia sa cytowane przez inne dokumenty kancelarii
// ("wlasna praca" jako sygnal). opts pozwala wylaczyc dowolny silnik (A/B).

import { getDb, isVecEnabled } from "../db/sqlite-connection";
import {
  dualSimilarityRank,
  loadStructuralProfile,
  unionProfiles,
  type StructuralProfile,
} from "./dualSimilarity";
import {
  eventSimilarityRank,
  loadEventFrames,
  type EventFrame,
} from "./events";
import { embedOne } from "./embeddings";

export const RRF_K = Number(process.env.PATRON_RRF_K) || 60;

/**
 * Waga tresci w re-rankingu dual-similarity (ADR-0087). Z env PATRON_DUAL_ALPHA,
 * default 0.6 (najlepszy punkt nDCG bez porzucania sygnalu tresci wg ewaluacji
 * dualSimilarity.eval.test.ts). Number.isFinite respektuje jawne 0. Wartosci
 * spoza [0,1] przycina dualSimilarityRank.
 */
const DUAL_ALPHA_RAW = Number(process.env.PATRON_DUAL_ALPHA);
export const DUAL_ALPHA = Number.isFinite(DUAL_ALPHA_RAW) ? DUAL_ALPHA_RAW : 0.6;

/** Liczba czolowych spraw budujacych profil referencyjny (ADR-0087: top-1). */
const DUAL_REFERENCE_TOP_N = 1;

/**
 * Waga tresci w re-rankingu event-centric (ADR-0089 US3). Z env
 * PATRON_EVENT_ALPHA, default 0.6 (spojnie z dual-similarity). combined =
 * alpha*tresc + (1-alpha)*podobienstwo zdarzeniowe. Number.isFinite respektuje
 * jawne 0. Wartosci spoza [0,1] przycina eventSimilarityRank.
 */
const EVENT_ALPHA_RAW = Number(process.env.PATRON_EVENT_ALPHA);
export const EVENT_ALPHA = Number.isFinite(EVENT_ALPHA_RAW) ? EVENT_ALPHA_RAW : 0.6;

/** Liczba czolowych spraw budujacych ramki referencyjne zdarzen (ADR-0089: top-1). */
const EVENT_REFERENCE_TOP_N = 1;

export interface RetrieveOptions {
  vec?: boolean;
  bm25?: boolean;
  graph?: boolean;
  /** Limit kandydatow per silnik przed fuzja (default k*3). */
  perEngine?: number;
  /**
   * Scope: tylko fragmenty z tych dokumentow (np. dokumenty projektu).
   * Pusta tablica = brak trafien. undefined = caly korpus usera.
   * Filtr aplikowany po stronie aplikacji (vec0 KNN nie laczy sie z JOIN),
   * wiec silniki dobieraja perEngine*FILTER_OVERFETCH kandydatow.
   */
  documentIds?: string[];
  /**
   * Re-ranking dual-similarity po RRF (ADR-0087). Domyslnie wlaczone; no-op gdy
   * profil referencyjny pusty (graf pusty -> kolejnosc tresci, bez regresji).
   * false pomija etap i odczyty profilu z DB - dokladnie dotychczasowa sciezka.
   */
  dualSimilarity?: boolean;
  /**
   * Re-ranking event-centric (subgraph matching, ADR-0089 US3) jako kolejny etap
   * PO dual-similarity. Domyslnie wlaczone; no-op gdy sprawa-kotwica nie ma ramek
   * zdarzen (degraduje do kolejnosci poprzedniego etapu, bez regresji). false
   * pomija etap i odczyty ramek z DB.
   */
  event?: boolean;
}

const FILTER_OVERFETCH = 4;

export interface RetrievedChunk {
  chunkId: number;
  documentId: string;
  chunkIndex: number;
  /** Numer strony zrodla (audyt P2 #10) lub null (zrodlo bez stron / stary index). */
  pageNo: number | null;
  content: string;
  score: number;
  /**
   * ADR-0124 (Route B): surowy span chunka w zrodle (UTF-16, end exclusive).
   * Pozwala feedowi zbudowac EXACT lokator bez fuzzy matchingu znormalizowanej
   * tresci. null/undefined dla chunkow sprzed Route B (re-index uzupelnia) -
   * feed robi wtedy fallback best-effort.
   */
  sourceOffsetStart?: number | null;
  sourceOffsetEnd?: number | null;
}

/**
 * Reciprocal rank fusion. Wejscie: listy id uszeregowane best-first.
 * score(id) = suma po listach 1/(k + rank), rank 1-based. Pure, testowalne.
 */
export function reciprocalRankFusion(
  lists: number[][],
  k = RRF_K,
): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/** Buduje bezpieczne zapytanie FTS5 MATCH z tokenow (OR). null jezeli brak. */
/**
 * Lekki rdzen morfologiczny PL dla prefix-matchu FTS (audyt P3 #15). Polska
 * fleksja jest sufiksalna, wiec formy odmienione dziela rdzen prefiksowy:
 * "oskarzonego"/"oskarzonemu"/"oskarzony" -> "oskarzon". Obcinamy do 3 znakow
 * z konca, z podloga 5 znakow rdzenia (krotszy prefix = za duzo false-positive).
 * Bez slownika sufiksow - jednolita truncacja jest stabilna i deterministyczna.
 */
function ftsStem(token: string): string {
  const strip = Math.min(3, token.length - 5);
  return strip > 0 ? token.slice(0, token.length - strip) : token;
}

/**
 * Buduje wyrazenie FTS5 MATCH z zapytania. Tokeny czysto literowe dlugosci >=7
 * dostaja prefix-match rdzenia (`rdzen*`) - lapie formy odmienione (recall PL,
 * audyt P3 #15). Krotkie tokeny, liczby i sygnatury (czp/iii/11) zostaja exact
 * (prefix krotki = za duzo false-positive). Term laczone przez OR.
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens
    .map((t) => {
      if (/^\p{L}+$/u.test(t) && t.length >= 7) {
        // prefix term FTS5 (bez cudzyslowu, z gwiazdka)
        return `${ftsStem(t)}*`;
      }
      return `"${t.replace(/"/g, '""')}"`;
    })
    .join(" OR ");
}

/** Wektorowy MATCH (sqlite-vec). Zwraca chunk id best-first (distance asc). */
function vecSearch(queryVec: Float32Array, limit: number): number[] {
  if (!isVecEnabled()) return [];
  const db = getDb();
  const rows = db
    .prepare(
      "select rowid from vec_chunks where embedding match ? order by distance limit ?",
    )
    .all(
      Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength),
      limit,
    ) as { rowid: number }[];
  return rows.map((r) => r.rowid);
}

/** BM25 (FTS5). Zwraca chunk id best-first (bm25 asc = lepsze dopasowanie). */
function bm25Search(query: string, limit: number): number[] {
  const match = buildFtsMatch(query);
  if (!match) return [];
  const db = getDb();
  const rows = db
    .prepare(
      "select rowid from doc_chunks_fts where doc_chunks_fts match ? order by bm25(doc_chunks_fts) limit ?",
    )
    .all(match, limit) as { rowid: number }[];
  return rows.map((r) => r.rowid);
}

/**
 * Graf: szereguje KANDYDATOW (chunki z vec+bm25) wg centralnosci backlink ich
 * dokumentu. Centralnosc encji = liczba roznych dokumentow cytujacych ta sama
 * encje (value_normalized). Score dokumentu = suma centralnosci jego encji.
 * Zwraca chunk id posortowane malejaco po score dokumentu (query-relevant -
 * tylko kandydaci). Pusty graf => zachowuje kolejnosc wejsciowa (score 0).
 */
function graphRankCandidates(candidateChunkIds: number[]): number[] {
  if (candidateChunkIds.length === 0) return [];
  const db = getDb();
  const placeholders = candidateChunkIds.map(() => "?").join(",");
  const chunkDocs = db
    .prepare(
      `select id, document_id from doc_chunks where id in (${placeholders})`,
    )
    .all(...candidateChunkIds) as { id: number; document_id: string }[];

  // Centralnosc per value_normalized: ile roznych from_doc_id cytuje encje.
  const centralityRows = db
    .prepare(
      `select e.value_normalized as vn, count(distinct cg.from_doc_id) as c
       from citation_graph cg
       join extracted_entities e on e.id = cg.to_entity_id
       group by e.value_normalized`,
    )
    .all() as { vn: string; c: number }[];
  const centrality = new Map<string, number>();
  for (const r of centralityRows) centrality.set(r.vn, r.c);

  // Score dokumentu = suma centralnosci jego encji (encje bedace celami krawedzi).
  const docScore = new Map<string, number>();
  const docIds = [...new Set(chunkDocs.map((c) => c.document_id))];
  if (docIds.length > 0 && centrality.size > 0) {
    const ph = docIds.map(() => "?").join(",");
    const entRows = db
      .prepare(
        `select distinct document_id, value_normalized
         from extracted_entities where document_id in (${ph})`,
      )
      .all(...docIds) as { document_id: string; value_normalized: string }[];
    for (const r of entRows) {
      const c = centrality.get(r.value_normalized) ?? 0;
      if (c > 0) {
        docScore.set(r.document_id, (docScore.get(r.document_id) ?? 0) + c);
      }
    }
  }

  // Stabilne sortowanie kandydatow: score dokumentu desc, kolejnosc wejsciowa.
  const inputOrder = new Map<number, number>();
  candidateChunkIds.forEach((id, i) => inputOrder.set(id, i));
  return [...chunkDocs]
    .sort((a, b) => {
      const sa = docScore.get(a.document_id) ?? 0;
      const sb = docScore.get(b.document_id) ?? 0;
      if (sb !== sa) return sb - sa;
      return (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0);
    })
    .map((c) => c.id);
}

/**
 * Etap re-rankingu dual-similarity (ADR-0087). Wejscie: pelna lista kandydatow
 * RRF (best-first, przed odcieciem do k). Profil referencyjny = sasiedztwo
 * strukturalne sprawy-kotwicy (top-1 wg tresci, ADR-0087 sek. A). Laczy
 * znormalizowany wynik tresci z podobienstwem strukturalnym (dualSimilarityRank,
 * alpha=DUAL_ALPHA). loadStructuralProfile wolane raz per rozny dokument
 * (cache w mapie). Pusty profil referencyjny (graf pusty/dokument bez encji)
 * zwraca liste niezmieniona - brak regresji, zero zbednych odczytow kandydatow.
 */
function dualReRank(
  fused: { id: number; score: number }[],
): { id: number; score: number }[] {
  const docByChunk = chunkDocMap(fused.map((f) => f.id));

  // Distinct dokumenty w kolejnosci tresci (pierwsze wystapienie).
  const seen = new Set<string>();
  const orderedDocs: string[] = [];
  for (const f of fused) {
    const doc = docByChunk.get(f.id);
    if (doc && !seen.has(doc)) {
      seen.add(doc);
      orderedDocs.push(doc);
    }
  }

  const profByDoc = new Map<string, StructuralProfile>();
  for (const doc of orderedDocs) {
    profByDoc.set(doc, loadStructuralProfile(doc));
  }
  const reference = unionProfiles(
    orderedDocs.map((d) => profByDoc.get(d)!),
    DUAL_REFERENCE_TOP_N,
  );
  // Brak sygnalu strukturalnego -> kolejnosc tresci bez zmian (ADR-0086 brzeg).
  if (reference.size === 0) return fused;

  const empty: StructuralProfile = new Set<string>();
  const candidates = fused.map((f) => ({
    id: f.id,
    contentScore: f.score,
    profile: profByDoc.get(docByChunk.get(f.id) ?? "") ?? empty,
  }));
  const ranked = dualSimilarityRank(candidates, reference, { alpha: DUAL_ALPHA });
  return ranked.map((r) => ({ id: r.id as number, score: r.score }));
}

/**
 * Etap re-rankingu event-centric (subgraph matching, ADR-0089 US3) jako kolejny
 * wymiar strukturalny PO dual-similarity (ADR-0087). Wejscie: lista kandydatow
 * po poprzednim etapie (best-first). Ramki referencyjne = ramki zdarzen sprawy-
 * kotwicy (top-1 wg biezacej kolejnosci, jak ADR-0087 sek. A). Laczy znormalizowany
 * wynik poprzedniego etapu z podobienstwem subgrafowym ramek (eventSimilarityRank,
 * alpha=EVENT_ALPHA). loadEventFrames wolane raz per rozny dokument (cache w mapie).
 * Brak ramek referencyjnych (sprawa-kotwica bez zdarzen) zwraca liste niezmieniona
 * - brak regresji, gdy ekstrakcja nie zbudowala ramek (typowe dla tekstu bez
 * wspolwystepujacych rol). Dlaczego po dual a nie zamiast: event-centric lapie
 * wymiar (rola->wartosc w jednej ramce), ktorego plaski Jaccard encji (ADR-0087)
 * nie rozroznia (ADR-0089).
 */
function eventReRank(
  fused: { id: number; score: number }[],
): { id: number; score: number }[] {
  const docByChunk = chunkDocMap(fused.map((f) => f.id));

  // Distinct dokumenty w biezacej kolejnosci (pierwsze wystapienie).
  const seen = new Set<string>();
  const orderedDocs: string[] = [];
  for (const f of fused) {
    const doc = docByChunk.get(f.id);
    if (doc && !seen.has(doc)) {
      seen.add(doc);
      orderedDocs.push(doc);
    }
  }

  const framesByDoc = new Map<string, EventFrame[]>();
  for (const doc of orderedDocs) framesByDoc.set(doc, loadEventFrames(doc));

  const reference: EventFrame[] = orderedDocs
    .slice(0, EVENT_REFERENCE_TOP_N)
    .flatMap((d) => framesByDoc.get(d) ?? []);
  // Brak ramek referencyjnych -> kolejnosc poprzedniego etapu bez zmian.
  if (reference.length === 0) return fused;

  const candidates = fused.map((f) => ({
    id: f.id,
    contentScore: f.score,
    frames: framesByDoc.get(docByChunk.get(f.id) ?? "") ?? [],
  }));
  const ranked = eventSimilarityRank(candidates, reference, { alpha: EVENT_ALPHA });
  return ranked.map((r) => ({ id: r.id as number, score: r.score }));
}

/** Mapuje chunk id -> document_id (do scope filtering). */
function chunkDocMap(chunkIds: number[]): Map<number, string> {
  const map = new Map<number, string>();
  if (chunkIds.length === 0) return map;
  const db = getDb();
  const ph = chunkIds.map(() => "?").join(",");
  const rows = db
    .prepare(`select id, document_id from doc_chunks where id in (${ph})`)
    .all(...chunkIds) as { id: number; document_id: string }[];
  for (const r of rows) map.set(r.id, r.document_id);
  return map;
}

/**
 * Hybrid retrieve. Zwraca top-k fragmentow z wynikiem fuzji RRF.
 */
export async function retrieve(
  query: string,
  k = 8,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const useVec = opts.vec !== false && isVecEnabled();
  const useBm25 = opts.bm25 !== false;
  const useGraph = opts.graph !== false;
  const scoped = opts.documentIds !== undefined;
  if (scoped && opts.documentIds!.length === 0) return [];
  const perEngine = (opts.perEngine ?? k * 3) * (scoped ? FILTER_OVERFETCH : 1);

  const lists: number[][] = [];
  let vecIds: number[] = [];
  let bmIds: number[] = [];

  if (useVec) {
    try {
      const qv = await embedOne(query, "query");
      vecIds = vecSearch(qv, perEngine);
    } catch (e) {
      console.warn(
        "[retrieval] vec search skipped:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  if (useBm25) {
    bmIds = bm25Search(query, perEngine);
  }

  // Scope: odfiltruj kandydatow spoza dozwolonych dokumentow.
  if (scoped) {
    const allowed = new Set(opts.documentIds);
    const docMap = chunkDocMap([...new Set([...vecIds, ...bmIds])]);
    vecIds = vecIds.filter((id) => allowed.has(docMap.get(id) ?? ""));
    bmIds = bmIds.filter((id) => allowed.has(docMap.get(id) ?? ""));
  }
  if (vecIds.length) lists.push(vecIds);
  if (bmIds.length) lists.push(bmIds);
  if (useGraph) {
    const candidates = [...new Set([...vecIds, ...bmIds])];
    const graphIds = graphRankCandidates(candidates);
    if (graphIds.length) lists.push(graphIds);
  }

  const fusedAll = reciprocalRankFusion(lists, RRF_K);
  if (fusedAll.length === 0) return [];

  const db = getDb();

  // Re-ranking strukturalny na pelnej liscie RRF przed odcieciem do k, by sprawa
  // analogiczna z pozycji za k mogla wejsc w top-k. Dwa etapy: dual-similarity
  // (ADR-0087, plaski Jaccard encji) i event-centric (ADR-0089 US3, subgraph
  // matching ramek zdarzen) - event PO dual, bo lapie wymiar rola->wartosc, ktorego
  // plaski Jaccard nie rozroznia. Obie flagi off = dokladnie dotychczasowa sciezka
  // (slice -> fetch -> sort po score).
  const useDual = opts.dualSimilarity !== false && fusedAll.length > 1;
  const useEvent = opts.event !== false && fusedAll.length > 1;

  if (!useDual && !useEvent) {
    const fused = fusedAll.slice(0, k);
    const byId = new Map(fused.map((f) => [f.id, f.score]));
    const placeholders = fused.map(() => "?").join(",");
    const rows = db
      .prepare(
        `select id, document_id, chunk_index, content, page_no, source_offset_start, source_offset_end from doc_chunks where id in (${placeholders})`,
      )
      .all(...fused.map((f) => f.id)) as {
      id: number;
      document_id: string;
      chunk_index: number;
      content: string;
      page_no: number | null;
      source_offset_start: number | null;
      source_offset_end: number | null;
    }[];

    return rows
      .map((r) => ({
        chunkId: r.id,
        documentId: r.document_id,
        chunkIndex: r.chunk_index,
        pageNo: r.page_no ?? null,
        content: r.content,
        score: byId.get(r.id) ?? 0,
        sourceOffsetStart: r.source_offset_start ?? null,
        sourceOffsetEnd: r.source_offset_end ?? null,
      }))
      .sort((a, b) => b.score - a.score);
  }

  let working = fusedAll;
  if (useDual) working = dualReRank(working);
  if (useEvent) working = eventReRank(working);

  const reranked = working.slice(0, k);
  const byId = new Map(reranked.map((f) => [f.id, f.score]));
  const orderIndex = new Map(reranked.map((f, i) => [f.id, i]));
  const placeholders = reranked.map(() => "?").join(",");
  const rows = db
    .prepare(
      `select id, document_id, chunk_index, content, page_no, source_offset_start, source_offset_end from doc_chunks where id in (${placeholders})`,
    )
    .all(...reranked.map((f) => f.id)) as {
    id: number;
    document_id: string;
    chunk_index: number;
    content: string;
    page_no: number | null;
    source_offset_start: number | null;
    source_offset_end: number | null;
  }[];

  // Zachowaj kolejnosc re-rankingu (z jego deterministycznym tie-breakiem),
  // nie sortuj po samym score - fetch z DB zwraca w kolejnosci dowolnej.
  return rows
    .map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      pageNo: r.page_no ?? null,
      content: r.content,
      score: byId.get(r.id) ?? 0,
      sourceOffsetStart: r.source_offset_start ?? null,
      sourceOffsetEnd: r.source_offset_end ?? null,
    }))
    .sort((a, b) => (orderIndex.get(a.chunkId)! - orderIndex.get(b.chunkId)!));
}
