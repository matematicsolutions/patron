// Barrel exportu warstwy pseudonimizacji PII.
//
// WPIETE w egress: `plEntityDetector` jest podawany do `wrapConversation`
// w `streamChatWithTools` (ADR-0110). Wyjscie publiczne dla testow i sciezki
// produkcyjnej. (Scaffolding LLM-detektora `prompts.pl.ts` pozostaje rezerwacja
// pod przyszla integracje - ADR-0003.)

export * from "./types";
export {
    POLISH_PII_RULES,
    detectRegex,
    isValidNip,
    isValidPesel,
    noopLlmDetector,
} from "./detect";
export type { DetectionMatch } from "./detect";
export {
    InMemoryPseudonimStore,
    addPseudonim,
    createPseudonimMap,
    resolveToken,
} from "./map";
export { unwrap, wrap, wrapInto } from "./wrap";
export type { WrapOptions } from "./wrap";
export {
    wrapConversation,
    PseudonimStreamUnwrapper,
    type WrappedConversation,
} from "./egress";
export { plEntityDetector } from "./plDetector";
export {
    LLM_CATEGORIES,
    POLISH_DETECTION_PROMPT,
    parseDetectionResponse,
} from "./prompts.pl";
