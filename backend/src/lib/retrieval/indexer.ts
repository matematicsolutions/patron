// Indexer korpusu (ADR-0054). Przy zapisie tekstu dokumentu:
//   1. chunkuje tekst (akapitowo, ~maxChars)
//   2. liczy embeddingi (passage) i zapisuje do doc_chunks + vec_chunks + FTS5
//   3. ekstrahuje encje + krawedzie grafu (extractEntitiesAndEdges, ADR-0008,
//      zero LLM) i zapisuje do extracted_entities + citation_graph
//
// Idempotentny: re-index tego samego docId usuwa poprzednie chunki/encje/
// krawedzie. Uzywa polaczenia SQLite bezposrednio (nie shim) - to wewnetrzna
// warstwa infrastruktury, nie sciezka kontraktu supabase-js.
//
// Audit event "entities.extracted" = REZERWACJA (poza whitelist event_type
// ADR-0035). Wpiecie loga wymaga migracji + bumpu EVENT_TYPES - odlozone,
// zeby nie lamac bramki governance. Patrz ADR-0054 "Co NIE jest".

import crypto from "crypto";
import { getDb, isVecEnabled } from "../db/sqlite-connection";
import { extractEntitiesAndEdges } from "../graph";
import { buildRoleHits, buildEventFrames } from "./events";
import { embed, EMBED_MODEL } from "./embeddings";
import { chunkLegalText } from "./legalChunker";

export interface ChunkPiece {
  index: number;
  content: string;
}

export interface IndexResult {
  docId: string;
  chunks: number;
  embedded: number;
  entities: number;
  edges: number;
  events: number;
  durationMs: number;
}

const DEFAULT_MAX_CHARS = 900;
const DEFAULT_MIN_CHARS = 200;

/**
 * Dzieli tekst na fragmenty akapitowo. Akapity laczone zachlannie do
 * maxChars; akapit dluzszy od maxChars ciety twardo. Zwraca fragmenty z
 * indeksem porzadkowym. Deterministyczne (Konstytucja Art. 3).
 */
export function chunkText(
  text: string,
  maxChars = DEFAULT_MAX_CHARS,
  minChars = DEFAULT_MIN_CHARS,
): ChunkPiece[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) pieces.push(t);
    buf = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        pieces.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (buf.length + para.length + 1 > maxChars) flush();
    buf = buf ? `${buf} ${para}` : para;
    if (buf.length >= minChars && buf.length >= maxChars * 0.8) flush();
  }
  flush();

  return pieces.map((content, index) => ({ index, content }));
}

/** Usuwa wszystkie artefakty indeksu dla dokumentu (re-index idempotentny). */
export function clearDocumentIndex(docId: string): void {
  const db = getDb();
  const chunkIds = db
    .prepare("select id from doc_chunks where document_id = ?")
    .all(docId) as { id: number }[];
  const tx = db.transaction(() => {
    for (const { id } of chunkIds) {
      db.prepare("delete from doc_chunks_fts where rowid = ?").run(id);
      if (isVecEnabled()) {
        db.prepare("delete from vec_chunks where rowid = ?").run(BigInt(id));
      }
    }
    db.prepare("delete from doc_chunks where document_id = ?").run(docId);
    db.prepare("delete from extracted_entities where document_id = ?").run(docId);
    db.prepare("delete from citation_graph where from_doc_id = ?").run(docId);
    // Zdarzenia (ADR-0089): event_roles przez FK cascade, ale kasujemy jawnie
    // (foreign_keys PRAGMA moze byc off) - najpierw role, potem wezly.
    db.prepare(
      "delete from event_roles where event_id in (select id from events where document_id = ?)",
    ).run(docId);
    db.prepare("delete from events where document_id = ?").run(docId);
  });
  tx();
}

/**
 * Indeksuje dokument do hybrid retrieval + grafu cytowan. Zwraca podsumowanie.
 */
export async function indexDocument(
  docId: string,
  text: string,
): Promise<IndexResult> {
  const start = Date.now();
  const db = getDb();
  clearDocumentIndex(docId);

  // ADR-0083: ciecie po granicach sekcji wyroku i jednostek redakcyjnych.
  // Tryb prawniczy aktywuje sie tylko przy markerze mocnym albo jednostce
  // redakcyjnej; dla dokumentow bez tej struktury deleguje do chunkText
  // (akapitowego) - identyczny wynik jak dotad, zero regresji.
  const pieces = chunkLegalText(text);

  // Embeddingi passage (jezeli warstwa wektorowa dostepna). Brak embeddera /
  // sqlite-vec => indeksujemy tylko BM25 + graf (Faza 1 wg ADR-0007).
  let vectors: Float32Array[] = [];
  let embedded = 0;
  if (isVecEnabled() && pieces.length > 0) {
    try {
      vectors = await embed(
        pieces.map((p) => p.content),
        "passage",
      );
      embedded = vectors.length;
    } catch (e) {
      console.warn(
        "[indexer] embedding failed - tylko BM25+graf:",
        e instanceof Error ? e.message : String(e),
      );
      vectors = [];
      embedded = 0;
    }
  }

  const nowIso = new Date().toISOString();
  const insertChunk = db.prepare(
    "insert into doc_chunks (document_id, chunk_index, content, embedding_model, created_at) values (?, ?, ?, ?, ?)",
  );
  const insertFts = db.prepare(
    "insert into doc_chunks_fts (rowid, content) values (?, ?)",
  );
  const insertVec = isVecEnabled()
    ? db.prepare("insert into vec_chunks (rowid, embedding) values (?, ?)")
    : null;

  const writeChunks = db.transaction(() => {
    for (let i = 0; i < pieces.length; i++) {
      const vec = vectors[i];
      const info = insertChunk.run(
        docId,
        pieces[i].index,
        pieces[i].content,
        vec ? EMBED_MODEL : null,
        nowIso,
      );
      const rowid = Number(info.lastInsertRowid);
      insertFts.run(rowid, pieces[i].content);
      if (insertVec && vec) {
        // vec0 wymaga rowid jako integer-bind => BigInt (zwykly number jest
        // bindowany jako REAL i odrzucany przez sqlite-vec).
        insertVec.run(
          BigInt(rowid),
          Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        );
      }
    }
  });
  writeChunks();

  // Graf cytowan + encje (deterministyczne, zero LLM - ADR-0008).
  const extraction = extractEntitiesAndEdges(docId, text);
  const entityIdByLocator = new Map<string, string>();

  const insertEntity = db.prepare(
    `insert into extracted_entities
      (id, document_id, entity_type, value, value_normalized, confidence,
       source_offset_start, source_offset_end, rule_id, metadata, source, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?)`,
  );
  const insertEdge = db.prepare(
    `insert into citation_graph
      (id, from_doc_id, to_doc_id, to_entity_id, relation, confidence, source_entity_id, extracted_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const writeGraph = db.transaction(() => {
    for (const ent of extraction.entities) {
      const id = crypto.randomUUID();
      const locator = `${ent.ruleId}:${ent.sourceOffsetStart}:${ent.sourceOffsetEnd}`;
      entityIdByLocator.set(locator, id);
      insertEntity.run(
        id,
        docId,
        ent.type,
        ent.value,
        ent.valueNormalized,
        ent.confidence,
        ent.sourceOffsetStart,
        ent.sourceOffsetEnd,
        ent.ruleId,
        ent.metadata ? JSON.stringify(ent.metadata) : null,
        nowIso,
      );
    }
    for (const edge of extraction.edges) {
      const toEntityId = edge.sourceEntityId
        ? (entityIdByLocator.get(edge.sourceEntityId) ?? null)
        : null;
      insertEdge.run(
        crypto.randomUUID(),
        docId,
        edge.toDocId ?? null,
        toEntityId,
        edge.relation,
        edge.confidence,
        edge.sourceEntityId ?? null,
        edge.extractedAt.toISOString(),
      );
    }
  });
  writeGraph();

  // Zdarzenia (ADR-0089, Faza C / US1): ramki rol z encji (ADR-0008) + bliskosci
  // w tekscie, deterministyczne, zero LLM. Wezel = events, krawedzie = event_roles.
  const frames = buildEventFrames(buildRoleHits(extraction.entities, text));
  const insertEvent = db.prepare(
    "insert into events (document_id, frame_index, span_start, span_end, created_at) values (?, ?, ?, ?, ?)",
  );
  const insertRole = db.prepare(
    "insert into event_roles (event_id, role, value_normalized, created_at) values (?, ?, ?, ?)",
  );
  const writeEvents = db.transaction(() => {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const info = insertEvent.run(docId, i, f.span[0], f.span[1], nowIso);
      const eventId = Number(info.lastInsertRowid);
      for (const role of f.roles.keys()) {
        for (const value of f.roles.get(role)!) {
          insertRole.run(eventId, role, value, nowIso);
        }
      }
    }
  });
  writeEvents();

  return {
    docId,
    chunks: pieces.length,
    embedded,
    entities: extraction.entities.length,
    edges: extraction.edges.length,
    events: frames.length,
    durationMs: Date.now() - start,
  };
}
