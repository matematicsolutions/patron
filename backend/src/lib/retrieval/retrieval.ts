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
import { embedOne } from "./embeddings";

export const RRF_K = Number(process.env.PATRON_RRF_K) || 60;

export interface RetrieveOptions {
  vec?: boolean;
  bm25?: boolean;
  graph?: boolean;
  /** Limit kandydatow per silnik przed fuzja (default k*3). */
  perEngine?: number;
}

export interface RetrievedChunk {
  chunkId: number;
  documentId: string;
  chunkIndex: number;
  content: string;
  score: number;
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
export function buildFtsMatch(query: string): string | null {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
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
  const perEngine = opts.perEngine ?? k * 3;

  const lists: number[][] = [];
  let vecIds: number[] = [];
  let bmIds: number[] = [];

  if (useVec) {
    try {
      const qv = await embedOne(query, "query");
      vecIds = vecSearch(qv, perEngine);
      if (vecIds.length) lists.push(vecIds);
    } catch (e) {
      console.warn(
        "[retrieval] vec search skipped:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  if (useBm25) {
    bmIds = bm25Search(query, perEngine);
    if (bmIds.length) lists.push(bmIds);
  }
  if (useGraph) {
    const candidates = [...new Set([...vecIds, ...bmIds])];
    const graphIds = graphRankCandidates(candidates);
    if (graphIds.length) lists.push(graphIds);
  }

  const fused = reciprocalRankFusion(lists, RRF_K).slice(0, k);
  if (fused.length === 0) return [];

  const db = getDb();
  const byId = new Map(fused.map((f) => [f.id, f.score]));
  const placeholders = fused.map(() => "?").join(",");
  const rows = db
    .prepare(
      `select id, document_id, chunk_index, content from doc_chunks where id in (${placeholders})`,
    )
    .all(...fused.map((f) => f.id)) as {
    id: number;
    document_id: string;
    chunk_index: number;
    content: string;
  }[];

  return rows
    .map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: byId.get(r.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
}
