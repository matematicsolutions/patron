// Publiczny API biblioteki pl-entities/ - kanoniczne miejsce dla
// rozpoznawania polskich identyfikatorow, sygnatury orzeczen i nazw
// podmiotow prawa polskiego.
//
// Status: Faza 6 (ADR-0008) - skeleton, niewpiety produkcyjnie w
// streamChatWithTools ani w graf cytowan ADR-0007. Pseudonim PII
// (ADR-0003) refactor do uzycia tej biblioteki - planowany T1
// ADR-0008 plan migracji.

export type { EntityType, ExtractedEntity, ExtractionRule } from "./types";

export {
    isValidPesel,
    isValidNip,
    isValidRegon,
    isValidRegon9,
    isValidRegon14,
    isValidKrsFormat,
} from "./checksums";

export {
    PL_EXTRACTION_RULES,
    detectAll,
    type RegexMatch,
} from "./regex";

export {
    COURTS,
    SIGNATURE_PREFIXES,
    findCourtById,
    findCourtByAlias,
    findWsaBySigPrefix,
    findSignaturePrefix,
    parseSignaturePrefix,
    type Court,
    type CourtType,
    type SignaturePrefix,
} from "./gazetteers";
