// Publiczny API klasyfikatora high-stakes (ADR-0004 Faza 5).
//
// Status: skeleton, niewpiety w streamChatWithTools. Wpiecie z flaga
// `.env DEBATE_ENABLED` planowane w T3 ADR-0004 po decyzji Wieslawa.

export type {
    DocumentType,
    ClassificationInput,
    ClassificationResult,
    ClassifierConfig,
} from "./types";

export {
    DEFAULT_CONFIG,
    classifyHighStakes,
    configFromEnv,
    isInputSufficient,
} from "./classifier";
