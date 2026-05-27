// Pure helpers dla endpoint POST /api/audit/merkle/compute-now (ADR-0048).
//
// Cel: gdy audytor UODO klika "Pobierz audit pack" w UI viewera (ADR-0046,
// ADR-0047) i dostaje 404 "brak Merkle root pokrywajacego event",
// administrator kancelarii (lub sam audytor, jezeli ma role admin) wymusza
// compute next root bez czekania na auto-trigger ADR-0036 (count >= 1000
// LUB interval >= 24h).
//
// Endpoint REST orchestruje: pobiera Supabase, wywoluje runAutoCompute z
// thresholdami=1/0 (kazdy nowy event wymusza compute), maple wynik na
// response przez `buildComputeNowResponse`.
//
// Wszystkie funkcje pure - zero IO, deterministyczne, testowalne bez mockow.

import type {
    RunAutoComputeResult,
    MerkleRootRow,
} from "./audit-merkle-roots";

/** Threshold count "1" - kazdy nowy event wymusza compute (vs default 1000 z ADR-0036). */
export const FORCE_COUNT_THRESHOLD = 1;
/** Threshold interval "0" - bypass wymogu wieku ostatniego roota (vs default 24h z ADR-0036). */
export const FORCE_INTERVAL_MS = 0;
/** Limit dlugosci label `computed_by` zapisanego do tabeli `audit_merkle_roots`. */
const COMPUTED_BY_MAX_LEN = 100;

/**
 * Buduje bezpieczny label `computed_by` dla wymuszenia z UI. Wzorzec:
 *   "manual-ui:<email_admin_lub_user_id>"
 * Trimuje do `COMPUTED_BY_MAX_LEN` znakow, defaultuje na "manual-ui:unknown"
 * gdy brak identyfikatora. Anti-injection - usuwa znaki nowej linii i
 * znaki kontrolne, ktore moglyby zakloci logi downstream.
 */
export function parseComputerByLabel(
    actorEmail: string | null,
    actorUserId: string | null,
): string {
    const raw = actorEmail ?? actorUserId ?? "unknown";
    const sanitized = raw
        .replace(/[\r\n\t]/g, " ")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim();
    const safe = sanitized.length > 0 ? sanitized : "unknown";
    const label = `manual-ui:${safe}`;
    if (label.length <= COMPUTED_BY_MAX_LEN) return label;
    return label.slice(0, COMPUTED_BY_MAX_LEN);
}

/** Response body dla POST /api/audit/merkle/compute-now. */
export interface ComputeNowResponse {
    computed: boolean;
    /** Powod decyzji - lustro `SchedulerDecisionReason` (no_new_events / count_threshold / interval_threshold / initial_root / below_thresholds). */
    reason: string;
    /** Pola roota - obecne tylko gdy computed=true i insert udany. */
    root?: {
        id: number;
        chain_block_start: number;
        chain_block_end: number;
        merkle_root: string;
        event_count: number;
        computed_at: string;
        computed_by: string;
    };
    /** Komunikat bledu - obecny gdy decyzja byla compute ale insert/fetch sie nie udal. */
    error?: string;
}

/**
 * Pure transformacja RunAutoComputeResult na response endpointu. Caller
 * (route handler) wstrzykuje wynik z `runAutoCompute` - tutaj zero IO.
 *
 * Mapowanie:
 * - decision.compute=false                       -> { computed: false, reason }
 * - decision.compute=true + compute.ok           -> { computed: true, reason, root }
 * - decision.compute=true + compute.ok=false     -> { computed: false, reason, error }
 * - decision.compute=true + brak computeResult   -> { computed: false, reason, error="..." }
 */
export function buildComputeNowResponse(result: RunAutoComputeResult): ComputeNowResponse {
    const { decision, computeResult } = result;

    if (!decision.compute) {
        return { computed: false, reason: decision.reason };
    }

    if (!computeResult) {
        return {
            computed: false,
            reason: decision.reason,
            error: "audit-merkle-compute-now: decyzja compute=true ale brak computeResult (defensive)",
        };
    }

    if (!computeResult.ok || !computeResult.root) {
        return {
            computed: false,
            reason: decision.reason,
            error: computeResult.error ?? "audit-merkle-compute-now: unknown compute error",
        };
    }

    return {
        computed: true,
        reason: decision.reason,
        root: serializeRoot(computeResult.root),
    };
}

function serializeRoot(root: MerkleRootRow): ComputeNowResponse["root"] {
    return {
        id: root.id,
        chain_block_start: root.chain_block_start,
        chain_block_end: root.chain_block_end,
        merkle_root: root.merkle_root,
        event_count: root.event_count,
        computed_at: root.computed_at,
        computed_by: root.computed_by,
    };
}
