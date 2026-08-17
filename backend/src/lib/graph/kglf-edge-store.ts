// ADR-0125 (T2.1 KGLF 11c): persystencja warstwy governance krawedzi -
// odczyt + ratyfikacja. Operuje bezposrednio na SQLite (citation_graph) - to
// wewnetrzna warstwa infrastruktury (jak indexer.ts/retrieval.ts), nie sciezka
// kontraktu supabase-js. Ratyfikacja = AKT LUDZKI: walidacje (tylko czlowiek,
// tylko proposed) deleguje do modelu `ratifyEdge` (ADR-0125 11a), potem
// persystuje. Deterministyczne; timestamp wstrzykiwany (testowalnosc).
//
// Producent propozycji = indexer (auto-krawedzie 'proposed' globalne) oraz
// przyszly agent-proposer w czacie. Konsument (UI grafu + route ratyfikacji
// wolajacy ratifyStoredEdge z tozsamoscia prawnika) = osobna funkcja frontowa.

import { getDb } from "../db/sqlite-connection";
import { type KglfEdge, ratifyEdge } from "./kglf-edge";

interface CitationGraphRow {
    id: string;
    from_doc_id: string;
    to_doc_id: string | null;
    to_entity_id: string | null;
    relation: string;
    confidence: number;
    source_entity_id: string | null;
    status: string;
    origin: string;
    run_id: string | null;
    ratified_by: string | null;
    ratified_at: string | null;
}

const SELECT_COLS =
    "id, from_doc_id, to_doc_id, to_entity_id, relation, confidence, source_entity_id, status, origin, run_id, ratified_by, ratified_at";

/** Rekonstruuje KglfEdge z wiersza citation_graph (kanonizuje status/origin). */
function rowToKglfEdge(r: CitationGraphRow): KglfEdge {
    return {
        fromDocId: r.from_doc_id,
        toDocId: r.to_doc_id,
        toEntityId: r.to_entity_id,
        relationLabel: r.relation,
        confidence: r.confidence,
        sourceEntityId: r.source_entity_id ?? undefined,
        status: r.status === "ratified" ? "ratified" : "proposed",
        origin: r.origin === "human" ? "human" : "analysis",
        runId: r.run_id,
        ratifiedBy: r.ratified_by ?? undefined,
        ratifiedAt: r.ratified_at ?? undefined,
    };
}

/** Pojedyncza krawedz po id, jako KglfEdge; null gdy nie istnieje. */
export function getStoredEdge(edgeId: string): KglfEdge | null {
    const db = getDb();
    const row = db
        .prepare(`select ${SELECT_COLS} from citation_graph where id = ?`)
        .get(edgeId) as CitationGraphRow | undefined;
    return row ? rowToKglfEdge(row) : null;
}

/**
 * RATYFIKUJE zapisana krawedz (akt ludzki). Deleguje bramke do `ratifyEdge`:
 * tylko `proposed` mozna ratyfikowac, `actorId` musi byc czlowiekiem (nie
 * "analysis"/"system"/pusty). Po sukcesie persystuje status 'ratified',
 * run_id null (firm-public), ratified_by/at.
 *
 * Zwraca zaktualizowana KglfEdge albo null (nie istnieje / nie da sie
 * ratyfikowac) - fail-closed, bez zmiany w DB gdy null.
 */
export function ratifyStoredEdge(
    edgeId: string,
    actorId: string,
    at: string,
): KglfEdge | null {
    const edge = getStoredEdge(edgeId);
    if (edge === null) return null;
    const ratified = ratifyEdge(edge, actorId, at);
    if (ratified === null) return null;
    getDb()
        .prepare(
            "update citation_graph set status = 'ratified', run_id = null, ratified_by = ?, ratified_at = ? where id = ?",
        )
        .run(actorId, at, edgeId);
    return ratified;
}
