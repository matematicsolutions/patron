// Pure helpers dla auto-trigger Merkle audit root (ADR-0036).
//
// Storage layer (IO z Supabase) w `audit-merkle-roots.ts` (`runAutoCompute`).
// Tu trzymamy tylko deterministyczna funkcje decyzji - czy compute, dlaczego,
// dla jakiego bloku. Pozwala testowac scenariusze bez DB.
//
// Hybrid trigger: compute gdy count_threshold (liczba nowych eventow >= N)
// LUB interval_threshold (od ostatniego roota >= T) - whichever first.
// Idempotency check przez sprawdzenie `lastCoveredEventId` z ostatniego roota
// vs `maxEventId` z audit_log.

/** Stan systemu na chwile podejmowania decyzji o compute. */
export interface SchedulerState {
    /** chain_block_end z ostatniego roota lub 0 gdy tabela `audit_merkle_roots` pusta. */
    lastCoveredEventId: number;
    /** max(id) z audit_log lub 0 gdy tabela pusta. */
    maxEventId: number;
    /** computed_at ostatniego roota jako epoch ms, lub 0 gdy nigdy nie liczone. */
    lastRootComputedAt: number;
    /** Aktualny czas jako epoch ms (Date.now() w produkcji, fixture w testach). */
    now: number;
    /** Prog liczby nowych eventow ktory wymusza compute (env PATRON_MERKLE_AUTO_COUNT_THRESHOLD). */
    countThreshold: number;
    /** Maksymalny wiek ostatniego roota w ms (env PATRON_MERKLE_AUTO_INTERVAL_HOURS * 3600_000). */
    intervalMs: number;
}

/** Powod decyzji - pomaga w obserwowalnosci (logi, audit downstream). */
export type SchedulerDecisionReason =
    | "no_new_events"
    | "below_thresholds"
    | "count_threshold"
    | "interval_threshold"
    | "initial_root";

export interface SchedulerDecision {
    /** Czy nalezy uruchomic compute Merkle root. */
    compute: boolean;
    /** Dlaczego taka decyzja - do logow i testow. */
    reason: SchedulerDecisionReason;
    /** Zakres bloku do compute (tylko gdy compute=true). */
    blockStart?: number;
    /** Zakres bloku do compute (tylko gdy compute=true). */
    blockEnd?: number;
}

/**
 * Pure function decyzji o auto-compute Merkle root. Zero IO.
 *
 * Logika:
 * 1. Brak nowych eventow (maxEventId <= lastCoveredEventId) -> skip.
 * 2. Brak ostatniego roota (lastCoveredEventId == 0) i sa nowe eventy -> compute (initial_root).
 * 3. Nowych eventow >= countThreshold -> compute (count_threshold).
 * 4. Wiek ostatniego roota >= intervalMs -> compute (interval_threshold).
 * 5. W przeciwnym razie -> skip (below_thresholds).
 *
 * Gdy compute=true, blockStart = lastCoveredEventId + 1, blockEnd = maxEventId.
 */
export function shouldComputeNextRoot(state: SchedulerState): SchedulerDecision {
    const newEvents = state.maxEventId - state.lastCoveredEventId;
    if (newEvents <= 0) {
        return { compute: false, reason: "no_new_events" };
    }

    const blockStart = state.lastCoveredEventId + 1;
    const blockEnd = state.maxEventId;

    if (state.lastCoveredEventId === 0) {
        return { compute: true, reason: "initial_root", blockStart, blockEnd };
    }
    if (newEvents >= state.countThreshold) {
        return { compute: true, reason: "count_threshold", blockStart, blockEnd };
    }
    const ageMs = state.now - state.lastRootComputedAt;
    if (ageMs >= state.intervalMs) {
        return { compute: true, reason: "interval_threshold", blockStart, blockEnd };
    }
    return { compute: false, reason: "below_thresholds" };
}

/**
 * Parsuje env var w godzinach do ms. Zwraca defaultMs gdy parsing zawiedzie
 * lub wartosc <= 0 (defensywnie - nie chcemy intervalMs == 0 ktore tickowaloby
 * bez przerwy).
 */
export function parseIntervalHours(envValue: string | undefined, defaultMs: number): number {
    if (!envValue) return defaultMs;
    const hours = Number.parseFloat(envValue);
    if (!Number.isFinite(hours) || hours <= 0) return defaultMs;
    return Math.floor(hours * 3600 * 1000);
}

/**
 * Parsuje env var jako pozytywna liczba calkowita. Zwraca defaultValue gdy
 * parsing zawiedzie lub wartosc <= 0.
 */
export function parsePositiveInt(envValue: string | undefined, defaultValue: number): number {
    if (!envValue) return defaultValue;
    const n = Number.parseInt(envValue, 10);
    if (!Number.isFinite(n) || n <= 0) return defaultValue;
    return n;
}
