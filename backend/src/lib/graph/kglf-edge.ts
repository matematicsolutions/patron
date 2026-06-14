// ADR-0125 (T2.1): warstwa governance krawedzi grafu KGLF nad auto-ekstrakcja
// (ADR-0008). Wzorzec Open-Source-Legal/OpenContracts Relationship (MIT) -
// WZORZEC, nie kod (patrz THIRD_PARTY_INSPIRATIONS.md):
//   1. typ krawedzi jako DANE (string label), nie enum -> kancelaria rozwija
//      ontologie bez migracji/zmiany kodu;
//   2. ratyfikacja = AKT LUDZKI (Konstytucja governance: agent PROPONUJE,
//      prawnik PROMUJE) - krawedz auto-wykryta jest tylko propozycja;
//   3. run-privacy: krawedz `proposed` jest prywatna do RUNU ktory ja
//      zaproponowal, dopoki czlowiek jej nie ratyfikuje (wtedy firm-public).
//
// Czysta warstwa (zero IO, zero LLM, deterministyczna - Konstytucja Art. 1, 3).
// Persystencja (kolumny status/origin/run_id/ratified_* w citation_graph) i
// wpiecie (extractor -> propose, API ratyfikacji) = rezerwacja ADR-0125.

export type KglfEdgeStatus = "proposed" | "ratified";

/** Pochodzenie krawedzi: auto-ekstrakcja (ADR-0008) albo recznie przez czlowieka. */
export type KglfEdgeOrigin = "analysis" | "human";

/**
 * Krawedz grafu KGLF z warstwa governance. Tozsamosc dziedziczy po
 * `CitationEdge` (ADR-0008), ale `relationLabel` jest DANA (string), nie
 * zamknietym enumem `CitationRelation` - kancelaria moze dodawac wlasne typy
 * relacji bez zmiany kodu/migracji.
 */
export interface KglfEdge {
    fromDocId: string;
    toDocId: string | null;
    toEntityId: string | null;
    /** Typ relacji jako DANE (label). Walidowany ksztaltem, nie zamknieta lista. */
    relationLabel: string;
    confidence: number;
    sourceEntityId?: string;
    /** Stan governance: `proposed` (do ratyfikacji) lub `ratified` (firm-public). */
    status: KglfEdgeStatus;
    /** Kto utworzyl krawedz (auto vs czlowiek). Ratyfikacja NIE zmienia origin. */
    origin: KglfEdgeOrigin;
    /**
     * Run, do ktorego krawedz `proposed` jest prywatna. `null` dla `ratified`
     * (firm-public, widoczna we wszystkich runach).
     */
    runId: string | null;
    /** actorId prawnika ktory ratyfikowal (tylko gdy `ratified`). */
    ratifiedBy?: string;
    /** Timestamp ratyfikacji ISO (tylko gdy `ratified`). */
    ratifiedAt?: string;
}

/**
 * Ontologia jako dane: waliduje KSZTALT etykiety relacji (lowercase, snake,
 * 1..64 znakow, zaczyna sie litera), nie zamknieta liste. Dzieki temu znane
 * etykiety PL (cytuje_orzeczenie, ...) i rozszerzenia kancelarii przechodza
 * tym samym sitem, a smieci/puste/injection sa odrzucane (fail-closed).
 */
const RELATION_LABEL_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidRelationLabel(label: string): boolean {
    return RELATION_LABEL_RE.test(label);
}

/** Minimalny ksztalt auto-wykrytej krawedzi (z ADR-0008 extractor). */
export interface ProposableEdge {
    fromDocId: string;
    toDocId: string | null;
    toEntityId: string | null;
    relation: string;
    confidence: number;
    sourceEntityId?: string;
}

/**
 * Owija auto-wykryta krawedz jako PROPOZYCJE prywatna do `runId`. Pochodzenie
 * `analysis`. Fail-closed: nieprawidlowa etykieta albo pusty `runId` -> null
 * (nie tworzymy krawedzi ktorej nie da sie zakotwiczyc w runie/ontologii).
 */
export function proposeEdge(edge: ProposableEdge, runId: string): KglfEdge | null {
    if (!runId) return null;
    if (!isValidRelationLabel(edge.relation)) return null;
    return {
        fromDocId: edge.fromDocId,
        toDocId: edge.toDocId,
        toEntityId: edge.toEntityId,
        relationLabel: edge.relation,
        confidence: edge.confidence,
        sourceEntityId: edge.sourceEntityId,
        status: "proposed",
        origin: "analysis",
        runId,
    };
}

/**
 * RATYFIKACJA = akt ludzki (governance: agent proponuje, prawnik promuje).
 * `proposed` -> `ratified` (firm-public, `runId` = null), z zapisem kto i kiedy.
 * `origin` pozostaje bez zmian (krawedz nadal byla auto-wykryta - ratyfikacja
 * to akceptacja, nie autorstwo).
 *
 * Fail-closed:
 *   - tylko `proposed` mozna ratyfikowac (idempotencja: ratified -> null),
 *   - `actorId` musi byc czlowiekiem (nie pusty, nie "analysis"/"system") -
 *     zapobiega "auto-ratyfikacji" omijajacej akt ludzki.
 */
export function ratifyEdge(
    edge: KglfEdge,
    actorId: string,
    at: string,
): KglfEdge | null {
    if (edge.status !== "proposed") return null;
    if (!actorId || actorId === "analysis" || actorId === "system") return null;
    return {
        ...edge,
        status: "ratified",
        runId: null,
        ratifiedBy: actorId,
        ratifiedAt: at,
    };
}

/**
 * Widocznosc wg run-privacy: `ratified` widoczna zawsze (firm-public);
 * `proposed` widoczna TYLKO w runie ktory ja zaproponowal. Chroni przed
 * wyciekiem niezatwierdzonych hipotez analizy do innych spraw/runow.
 */
export function isEdgeVisible(edge: KglfEdge, queryRunId: string | null): boolean {
    if (edge.status === "ratified") return true;
    return edge.runId !== null && edge.runId === queryRunId;
}
