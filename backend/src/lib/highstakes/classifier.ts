// Klasyfikator high-stakes vs low-stakes dla bramki debate pipeline
// (ADR-0004 Faza 5).
//
// Strategia: reguly-based. Trzy bramki w kolejnosci:
// 1. explicitFlag = true -> eskaluj (manualny override prawnika)
// 2. documentType nalezy do alwaysHighStakesTypes -> eskaluj
// 3. documentType jest dyskretnie eskalowalny (umowa_handlowa /
//    pismo_procesowe) ORAZ projectCmValue >= threshold -> eskaluj
// W innych przypadkach low-stakes (single-pass).
//
// Decyzja klasyfikatora NIE wlacza sama debate w stack produkcyjny -
// to robi flag .env DEBATE_ENABLED + integracja w streamChatWithTools
// (planowany T3 ADR-0004). Klasyfikator zwraca wylacznie informacje
// "ten kontekst zasluguje na debate".

import type {
    ClassificationInput,
    ClassificationResult,
    ClassifierConfig,
    DocumentType,
} from "./types";

/**
 * Default konfiguracja - z ADR-0004 Wariant B. Wartosci robocze,
 * **do walidacji T2** na realnym ruchu kancelarii pilotazowej.
 *
 * - cmValueThreshold 100_000 PLN: orientacyjna wartosc projektu powyzej
 *   ktorej dodatkowy koszt debate (n-krotne tokeny, latency dziesiatek
 *   sekund) jest uzasadniony skala potencjalnej szkody w razie bledu.
 * - alwaysHighStakes: opinia + 3 typy umow ktore z definicji wymagaja
 *   najwiekszej staranności.
 */
export const DEFAULT_CONFIG: ClassifierConfig = {
    cmValueThreshold: 100_000,
    alwaysHighStakesTypes: new Set<DocumentType>([
        "opinia",
        "umowa_M&A",
        "umowa_DD",
        "umowa_finansowa",
    ]),
};

const ESCALATABLE_BY_VALUE: ReadonlySet<DocumentType> = new Set<DocumentType>([
    "umowa_handlowa",
    "pismo_procesowe",
]);

/**
 * Klasyfikator high-stakes. Pure function - deterministyczny dla danego
 * (input, config). Idempotentny.
 *
 * @param input kontekst projektu (typ dokumentu, cm_value, explicit_flag)
 * @param config opcjonalna konfiguracja - default DEFAULT_CONFIG
 */
export function classifyHighStakes(
    input: ClassificationInput,
    config: ClassifierConfig = DEFAULT_CONFIG,
): ClassificationResult {
    const reasons: string[] = [];

    // Bramka 1: manualny override prawnika
    if (input.explicitFlag === true) {
        reasons.push("explicitFlag=true");
    }

    // Bramka 2: typ dokumentu zawsze high-stakes
    if (
        input.documentType !== undefined &&
        config.alwaysHighStakesTypes.has(input.documentType)
    ) {
        reasons.push(`documentType=${input.documentType} (always high-stakes)`);
    }

    // Bramka 3: typ eskalowalny + wartosc projektu >= threshold
    if (
        input.documentType !== undefined &&
        ESCALATABLE_BY_VALUE.has(input.documentType) &&
        input.projectCmValue !== undefined &&
        input.projectCmValue >= config.cmValueThreshold
    ) {
        reasons.push(
            `documentType=${input.documentType}+projectCmValue=${input.projectCmValue}>=${config.cmValueThreshold}`,
        );
    }

    return {
        isHighStakes: reasons.length > 0,
        reasons,
        appliedThreshold: config.cmValueThreshold,
    };
}

/**
 * Czy klasyfikator jest **w pelni odpowiedzialny** za decyzje
 * uruchomienia debate. Jezeli `false` (brak danych: documentType +
 * cmValue oba undefined i brak explicitFlag), debate NIGDY sie
 * automatycznie nie wlaczy - prawnik musi zaznaczyc explicit flag.
 * Audit log szczegolny dla tych przypadkow (operator nie wie kontekstu).
 */
export function isInputSufficient(input: ClassificationInput): boolean {
    if (input.explicitFlag === true) return true;
    if (input.documentType !== undefined && input.documentType !== "inny") return true;
    return false;
}

/**
 * Zaladuj konfiguracje klasyfikatora ze zmiennych srodowiskowych.
 *
 * - HIGH_STAKES_CM_VALUE_THRESHOLD - liczba PLN (default 100_000)
 * - HIGH_STAKES_ALWAYS_TYPES - lista typow comma-separated (default
 *   "opinia,umowa_M&A,umowa_DD,umowa_finansowa")
 *
 * Funkcja czysta - bierze obiekt env, nie woła `process.env` sama. To
 * pozwala testowac bez mutacji globalnego stanu.
 */
export function configFromEnv(env: NodeJS.ProcessEnv): ClassifierConfig {
    const thresholdRaw = env.HIGH_STAKES_CM_VALUE_THRESHOLD;
    const cmValueThreshold =
        thresholdRaw && /^\d+$/.test(thresholdRaw)
            ? parseInt(thresholdRaw, 10)
            : DEFAULT_CONFIG.cmValueThreshold;

    const typesRaw = env.HIGH_STAKES_ALWAYS_TYPES;
    const alwaysHighStakesTypes = typesRaw
        ? new Set<DocumentType>(
              typesRaw
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0) as DocumentType[],
          )
        : DEFAULT_CONFIG.alwaysHighStakesTypes;

    return { cmValueThreshold, alwaysHighStakesTypes };
}
