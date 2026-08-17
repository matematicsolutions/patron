// Publiczny API biblioteki graph/ - extractor encji + krawedzi grafu
// cytowan na potrzeby ADR-0007 (hybrid retrieval) i ADR-0008 (entity
// extraction).

export type {
    CitationRelation,
    CitationEdge,
    ExtractionResult,
    ExtractorOptions,
} from "./types";

export { extractEntitiesAndEdges } from "./extractor";
export { resolveToDocLinks } from "./crossDocLinks";

// ADR-0125 (T2.1): warstwa governance krawedzi KGLF (typ-jako-dane, ratyfikacja
// czlowieka, run-privacy). Czysta - persystencja/wpiecie = rezerwacja.
export type { KglfEdge, KglfEdgeStatus, KglfEdgeOrigin, ProposableEdge } from "./kglf-edge";
export {
    isValidRelationLabel,
    proposeEdge,
    ratifyEdge,
    isEdgeVisible,
} from "./kglf-edge";
// Persystencja governance krawedzi (odczyt + ratyfikacja). SQLite (desktop).
export { getStoredEdge, ratifyStoredEdge } from "./kglf-edge-store";
