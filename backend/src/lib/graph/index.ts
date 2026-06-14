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
