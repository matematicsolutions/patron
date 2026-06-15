// Graph extractor - orchestrator ekstrakcji encji z tekstu dokumentu
// na potrzeby grafu cytowan (ADR-0007) + tabeli extracted_entities
// (ADR-0008).
//
// Zero wywolan LLM (Konstytucja Art. 1 lokalnosc, Art. 3 audyt
// reprodukowalny). Reuse warstwy pseudonim/ (ADR-0003) dla imion i firm
// planowany w T4 ADR-0008 - na razie graph extractor uzywa wylacznie
// regex + gazetteery z pl-entities/.

import {
    detectAll,
    findSignaturePrefix,
    findWsaBySigPrefix,
    parseSignaturePrefix,
    type ExtractedEntity,
    type RegexMatch,
} from "../pl-entities";
import type {
    CitationRelation,
    CitationEdge,
    ExtractionResult,
    ExtractorOptions,
} from "./types";

// Slowa-trigger podnoszace confidence sygnatury orzeczenia jezeli wystepuja
// w sasiedztwie dopasowania (do 20 znakow przed).
const CONTEXT_TRIGGERS = [
    "sygn.",
    "sygn. akt",
    "sygnatura",
    "wyrok",
    "wyroku",
    "wyrokiem",
    "uchwala",
    "uchwałą",
    "postanowienie",
    "postanowienia",
    "postanowieniem",
    "wytyczne",
    "orzeczenie",
    "rozstrzygniecie",
] as const;

const CONTEXT_WINDOW = 30; // znakow wstecz od dopasowania

/**
 * Boost confidence sygnatury orzeczenia jezeli przed dopasowaniem
 * (w oknie CONTEXT_WINDOW) wystepuje slowo-trigger ("sygn.", "wyrok",
 * "uchwala"). Boost +0.2 maks 1.0.
 *
 * Drugi boost +0.1 jezeli prefix sygnatury (np. "III CZP", "II FSK")
 * jest znany w SIGNATURE_PREFIXES (gazetteer).
 */
function boostConfidence(text: string, match: RegexMatch): number {
    let boost = 0;

    if (match.type === "SYGNATURA_ORZECZENIA") {
        // 1. Slowo-trigger w sasiedztwie
        const windowStart = Math.max(0, match.start - CONTEXT_WINDOW);
        const before = text.substring(windowStart, match.start).toLowerCase();
        if (CONTEXT_TRIGGERS.some((t) => before.includes(t))) {
            boost += 0.2;
        }

        // 2. Prefix znany w gazetteerze
        const prefix = parseSignaturePrefix(match.raw);
        if (prefix && findSignaturePrefix(prefix)) {
            boost += 0.1;
        }
    }

    return Math.min(1.0, match.confidence + boost);
}

/**
 * Mapa typu encji + kontekstu (ruleId, metadata) na relacje grafu.
 * Sygnatura orzeczenia -> `cytuje_orzeczenie`. Sygnatura aktu prawnego
 * (CELEX, ELI) -> `cytuje_przepis`. Sad z gazetteera -> `przed_sadem`.
 * Firma z forma prawna -> `wspomina_firme`. Osoba -> `wspomina_osobe`.
 *
 * Identyfikatory PII (PESEL/NIP/REGON/KRS/EMAIL/PHONE) NIE generuja
 * krawedzi grafu - to dane do tabeli `extracted_entities` z osobnym
 * cyklem retencji (RODO art. 17), graf cytowan nie powinien ich
 * indeksowac.
 */
function relationForEntity(entity: ExtractedEntity): CitationRelation | null {
    switch (entity.type) {
        case "SYGNATURA_ORZECZENIA":
            return "cytuje_orzeczenie";
        case "SYGNATURA_AKTU":
            return "cytuje_przepis";
        case "SAD":
            return "przed_sadem";
        case "FIRMA":
            return "wspomina_firme";
        case "OSOBA":
            return "wspomina_osobe";
        case "PESEL":
        case "NIP":
        case "REGON":
        case "KRS":
        case "EMAIL":
        case "PHONE":
        case "DATA_PUBLIKACJI":
            return null;
        default:
            return null;
    }
}

/**
 * Wzbogac metadata encji sygnatury o pelne rozszyfrowanie prefixu z
 * gazetteera (court, department, caseType, plus WSA city jezeli SA/Wa).
 */
function enrichSignatureMetadata(raw: string): Record<string, string> | undefined {
    const prefix = parseSignaturePrefix(raw);
    if (!prefix) return undefined;
    const meta: Record<string, string> = { prefix };
    const sigInfo = findSignaturePrefix(prefix);
    if (sigInfo) {
        meta.court = sigInfo.court;
        meta.department = sigInfo.department;
        meta.caseType = sigInfo.caseType;
    }
    // WSA: rozszyfruj sigPrefix miasta z "II SA/Wa" -> "Wa" -> wsa-warszawa
    const wsaCityMatch = prefix.match(/SA\/([A-Z][a-z]{1,2})/);
    if (wsaCityMatch) {
        const wsaCourt = findWsaBySigPrefix(wsaCityMatch[1]!);
        if (wsaCourt) {
            meta.court = wsaCourt.id;
            meta.city = wsaCourt.city;
        }
    }
    return meta;
}

/**
 * Ekstrakcja encji z tekstu dokumentu + zaproponowanie krawedzi grafu
 * cytowan. Zero wywolan LLM, czas trwania liniowy z dlugoscia tekstu
 * i liczba regul w PL_EXTRACTION_RULES.
 *
 * Wywolujacy:
 * - Zapisuje wszystkie `result.entities` w tabeli `extracted_entities`
 *   z confidence-em (audit log + retencja RODO art. 17 osobny cykl)
 * - Zapisuje `result.edges` w `citation_graph` tylko dla edges
 *   `confidence >= minEdgeConfidence` (default 0.6)
 * - Audit log event_type `entities.extracted` z count per typ + duration
 */
export function extractEntitiesAndEdges(
    docId: string,
    text: string,
    options: ExtractorOptions = {},
): ExtractionResult {
    const minEdgeConfidence = options.minEdgeConfidence ?? 0.6;
    const contextBoost = options.contextBoost ?? true;
    const startTime = Date.now();

    const matches = detectAll(text);

    const entities: ExtractedEntity[] = [];
    const edges: Omit<CitationEdge, "fromDocId">[] = [];

    for (const m of matches) {
        const adjustedConfidence = contextBoost ? boostConfidence(text, m) : m.confidence;
        const metadata =
            m.type === "SYGNATURA_ORZECZENIA"
                ? enrichSignatureMetadata(m.raw)
                : undefined;

        const entity: ExtractedEntity = {
            type: m.type,
            value: m.raw,
            valueNormalized: m.normalized,
            sourceOffsetStart: m.start,
            sourceOffsetEnd: m.end,
            confidence: adjustedConfidence,
            ruleId: m.ruleId,
            metadata,
        };
        entities.push(entity);

        const relation = relationForEntity(entity);
        if (relation && adjustedConfidence >= minEdgeConfidence) {
            edges.push({
                toDocId: null, // nie wiemy jeszcze czy encja ma swoj dokument
                toEntityId: null, // pelny ID przydzielany przy zapisie do bazy
                relation,
                confidence: adjustedConfidence,
                extractedAt: new Date(),
                sourceEntityId: `${m.ruleId}:${m.start}:${m.end}`,
            });
        }
    }

    return {
        docId,
        entities,
        edges,
        sourceTextLength: text.length,
        durationMs: Date.now() - startTime,
    };
}
