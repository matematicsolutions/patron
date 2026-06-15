// Orchestrator skanu bezpieczenstwa dokumentu wejsciowego. 5-fazowy wzorzec
// cherry-picked z jdai-ca/atticus (Apache-2.0, snapshot 2026-05-22) - patrz
// ADR-0019. Detektory PL-aware, napisane od zera.
//
// SKELETON: czysta funkcja, zero-LLM, zero-cloud, bezstanowa. NIE wpieta w
// upload.ts/RAG/streamChatWithTools - to osobna decyzja (przyszly ADR-0020).

import type { Detector, SecurityScanInput, SecurityScanResult } from "./types";
import { adversarialDetector } from "./detectors/adversarial-pl";
import { steganographyDetector } from "./detectors/steganography";
import { obfuscationDetector } from "./detectors/obfuscation";
import { evasionDetector } from "./detectors/evasion";
import { calculateRiskScore, decideAction, toThreatLevel } from "./scorer";
import { buildResult } from "./report";

/** Domyslny zestaw detektorow. Kolejnosc bez znaczenia (sumuja sie). */
export const DEFAULT_DETECTORS: Detector[] = [
    adversarialDetector,
    steganographyDetector,
    obfuscationDetector,
    evasionDetector,
];

/**
 * Glowny pipeline. Operuje na JUZ wyekstrahowanym tekscie (ekstrakcje z
 * PDF/docx robi `convert.ts`). Zwraca raport z akcja allowed/quarantined/
 * human_review/blocked.
 */
export function analyzeInput(
    input: SecurityScanInput,
    detectors: Detector[] = DEFAULT_DETECTORS,
): SecurityScanResult {
    const findings = detectors.flatMap((d) => d.run(input));
    const riskScore = calculateRiskScore(findings);
    const threatLevel = toThreatLevel(riskScore, findings);
    const action = decideAction(threatLevel);
    return buildResult({
        fileName: input.fileName,
        findings,
        riskScore,
        threatLevel,
        action,
    });
}
