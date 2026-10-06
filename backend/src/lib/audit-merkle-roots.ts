// Storage layer dla Merkle roots (ADR-0026 + ADR-0036).
// Komplementarny do `audit.ts` (hash-chain). Ten modul nie pisze do audit_log -
// czyta hash'e z bloku eventow i zapisuje root do `audit_merkle_roots`.
//
// Manualny trigger LIVE od ADR-0026. Hybrid auto-trigger LIVE od ADR-0036
// (count >= N events OR interval >= T godzin) - patrz `runAutoCompute`
// + pure decision w `audit-merkle-scheduler.ts`.

import type { createServerSupabase } from "./supabase";
import {
    buildMerkleProof,
    buildMerkleRoot,
    verifyMerkleProof,
    type MerkleProofStep,
} from "./audit-merkle";
import {
    shouldComputeNextRoot,
    type SchedulerDecision,
} from "./audit-merkle-scheduler";

export interface MerkleRootRow {
    id: number;
    chain_block_start: number;
    chain_block_end: number;
    merkle_root: string;
    event_count: number;
    computed_at: string;
    computed_by: string;
}

export interface ComputeRootResult {
    ok: boolean;
    root?: MerkleRootRow;
    error?: string;
}

/**
 * Pobiera hash'e wszystkich eventow z bloku [blockStart, blockEnd] (inclusive),
 * sortowanych po `id` rosnaco. Zwraca tablice hashy gotowa dla `buildMerkleRoot`.
 *
 * Internal helper - kontrolowany przez computeAndStoreRoot.
 */
async function fetchHashesInBlock(
    db: ReturnType<typeof createServerSupabase>,
    blockStart: number,
    blockEnd: number,
): Promise<string[]> {
    const { data, error } = await db
        .from("audit_log")
        .select("hash")
        .gte("id", blockStart)
        .lte("id", blockEnd)
        .order("id", { ascending: true });
    if (error) {
        throw new Error(
            `audit-merkle-roots: nie udalo sie pobrac hashy dla bloku [${blockStart}, ${blockEnd}]: ${error.message}`,
        );
    }
    return (data ?? []).map((r) => (r as { hash: string }).hash);
}

/**
 * Liczy Merkle root dla bloku eventow [blockStart, blockEnd] i zapisuje
 * do `audit_merkle_roots`.
 *
 * Nie modyfikuje `audit_log` - operacja read-only nad lancuchem audit.
 *
 * UWAGA - brak ON CONFLICT: tabela `audit_merkle_roots` nie ma unique
 * constraint na zakres bloku. Wywolanie dwa razy dla tego samego
 * (blockStart, blockEnd) zapisze dwa wiersze z tym samym `merkle_root`
 * (deterministyczny algorytm RFC 6962). To NIE jest idempotentne. Manual
 * trigger - administrator kancelarii odpowiada za jednokrotnosc wywolania.
 * Auto-trigger (ADR-0036, `runAutoCompute` ponizej) robi idempotency check
 * przed wywolaniem tej funkcji przez `shouldComputeNextRoot`.
 *
 * `computedBy`: "service" gdy wywolane przez system (przyszly hook ADR-0036),
 * lub user_id (jako string) gdy administrator kancelarii odpalil manualnie.
 *
 * Nigdy nie rzuca - bledy zwracane jako `{ ok: false, error }`. Audit jest
 * druga warstwa weryfikacji, nie moze blokowac sciezki produktowej.
 */
export async function computeAndStoreRoot(
    db: ReturnType<typeof createServerSupabase>,
    blockStart: number,
    blockEnd: number,
    computedBy: string,
): Promise<ComputeRootResult> {
    if (blockStart > blockEnd) {
        return {
            ok: false,
            error: `audit-merkle-roots: blockStart ${blockStart} > blockEnd ${blockEnd}`,
        };
    }
    try {
        const hashes = await fetchHashesInBlock(db, blockStart, blockEnd);
        if (hashes.length === 0) {
            return {
                ok: false,
                error: `audit-merkle-roots: brak eventow w bloku [${blockStart}, ${blockEnd}]`,
            };
        }

        const root = buildMerkleRoot(hashes);

        const { data, error } = await db
            .from("audit_merkle_roots")
            .insert({
                chain_block_start: blockStart,
                chain_block_end: blockEnd,
                merkle_root: root,
                event_count: hashes.length,
                computed_by: computedBy,
                // Ustawiamy jawnie: w trybie desktop (SQLite) kolumna computed_at
                // jest NOT NULL bez DEFAULT now() (Postgres ma default) - bez tego
                // insert pierwszego rootu pada na NOT NULL constraint i cala warstwa
                // Merkle (proof-of-inclusion, ADR-0026) jest martwa. ISO 8601 UTC.
                computed_at: new Date().toISOString(),
            })
            .select()
            .single();
        if (error) {
            return {
                ok: false,
                error: `audit-merkle-roots: insert nie powiodl sie: ${error.message}`,
            };
        }
        return { ok: true, root: data as MerkleRootRow };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

// ---------------------------------------------------------------------------
// Auto-trigger wrapper (ADR-0036)
// ---------------------------------------------------------------------------

export interface RunAutoComputeResult {
    /** Decyzja schedulera (compute/skip + reason). */
    decision: SchedulerDecision;
    /** Wynik compute - obecny gdy decyzja byla compute=true. */
    computeResult?: ComputeRootResult;
}

/**
 * Pobiera aktualny stan systemu (max event id, ostatni root) i wola
 * `shouldComputeNextRoot` (pure decision). Jezeli decyzja = compute,
 * woła `computeAndStoreRoot` dla wybranego zakresu bloku.
 *
 * Wywolywane przez setInterval w `backend/src/index.ts` (default co 1h)
 * oraz manualny CLI `npm run merkle:trigger` (`scripts/trigger-merkle.ts`).
 *
 * Nigdy nie rzuca - bledy odczytu zwracane jako `decision.reason = "no_new_events"`
 * z polem error w computeResult. Audit jest druga warstwa weryfikacji,
 * scheduler nie moze blokowac sciezki produktowej ani crashowac procesu.
 *
 * Patrz ADR-0036.
 */
export async function runAutoCompute(
    db: ReturnType<typeof createServerSupabase>,
    options: {
        countThreshold: number;
        intervalMs: number;
        computedBy: string;
        now?: number;
    },
): Promise<RunAutoComputeResult> {
    // 1. max(id) z audit_log (lub 0 gdy pusta)
    let maxEventId = 0;
    try {
        const { data, error } = await db
            .from("audit_log")
            .select("id")
            .order("id", { ascending: false })
            .limit(1);
        if (!error && data && data.length > 0) {
            maxEventId = (data[0] as { id: number }).id;
        }
    } catch {
        // Bezpiecznie - traktujemy jako "brak eventow", scheduler zwroci skip.
    }

    // 2. ostatni root (chain_block_end + computed_at) - lub baseline 0 gdy brak
    let lastCoveredEventId = 0;
    let lastRootComputedAt = 0;
    try {
        const { data, error } = await db
            .from("audit_merkle_roots")
            .select("chain_block_end, computed_at")
            .order("chain_block_end", { ascending: false })
            .limit(1);
        if (!error && data && data.length > 0) {
            const row = data[0] as { chain_block_end: number; computed_at: string };
            lastCoveredEventId = row.chain_block_end;
            lastRootComputedAt = Date.parse(row.computed_at);
            if (!Number.isFinite(lastRootComputedAt)) {
                lastRootComputedAt = 0;
            }
        }
    } catch {
        // Bezpiecznie - traktujemy jako "brak roota", scheduler decyduje wg innych progow.
    }

    // 3. pure decision
    const decision = shouldComputeNextRoot({
        lastCoveredEventId,
        maxEventId,
        lastRootComputedAt,
        now: options.now ?? Date.now(),
        countThreshold: options.countThreshold,
        intervalMs: options.intervalMs,
    });

    if (!decision.compute || decision.blockStart === undefined || decision.blockEnd === undefined) {
        return { decision };
    }

    // 4. compute + store
    const computeResult = await computeAndStoreRoot(
        db,
        decision.blockStart,
        decision.blockEnd,
        options.computedBy,
    );
    return { decision, computeResult };
}

export interface ProofBundle {
    event_id: number;
    event_hash: string;
    proof: MerkleProofStep[];
    merkle_root_id: number;
    merkle_root: string;
    chain_block_start: number;
    chain_block_end: number;
}

export interface ProofForEventResult {
    ok: boolean;
    bundle?: ProofBundle;
    error?: string;
    /**
     * Rodzaj bledu dla routera: not_found (brak wpisu), no_root (zaden root nie
     * obejmuje wpisu), root_mismatch (dowod z biezacych hashy nie odtwarza
     * KTOREGOS z korzeni obejmujacych wpis), db_error.
     */
    code?: "not_found" | "no_root" | "root_mismatch" | "db_error";
    /** Id korzeni, ktorych dowod nie odtwarza (tylko przy root_mismatch). */
    mismatchedRootIds?: number[];
}

/**
 * Buduje proof-of-inclusion dla konkretnego eventu z audit_log.
 *
 * Workflow:
 * 1. Znajdz WSZYSTKIE roots pokrywajace event (block_start <= event_id <= block_end).
 * 2. Dla kazdego: pobierz hash'e bloku, zbuduj dowod i sprawdz, ze odtwarza
 *    zapisany korzen. Choc jeden niezgodny -> root_mismatch (bez bundla).
 * 3. Bundle buduje sie wobec NAJSTARSZEGO korzenia (najwczesniejsza pieczec).
 *
 * Dlaczego nie najnowszy (audyt 2026-09, uwaga do C-04): tabela nie ma unique na
 * zakres, a `computeAndStoreRoot` przyjmuje dowolny zakres. Kto zmienil wpis
 * (i przeliczyl hashe), mogl dopisac NOWY korzen nad tym samym blokiem zwykla
 * sciezka aplikacji - wybor najnowszego dawal wtedy zgodny dowod, a stary
 * korzen, ktory zmiane wykrywa, byl pomijany. Teraz kazdy korzen obejmujacy
 * wpis musi sie zgadzac, a pieczec wskazywana odbiorcy to najstarsza. Granica:
 * kto ma zapis do bazy, moze tez zmienic albo usunac sam wiersz korzenia - bez
 * kotwicy zewnetrznej (RFC 3161, ADR-0037) tego nie wykryjemy.
 *
 * Bundle jest samowystarczalny: audytor moze offline zweryfikowac
 * przez `verifyMerkleProof(bundle.event_hash, bundle.proof, bundle.merkle_root)`.
 */
export async function fetchProofForEvent(
    db: ReturnType<typeof createServerSupabase>,
    eventId: number,
): Promise<ProofForEventResult> {
    try {
        // 1. Znajdz event hash
        const evRes = await db
            .from("audit_log")
            .select("id, hash")
            .eq("id", eventId)
            .single();
        if (evRes.error || !evRes.data) {
            return {
                ok: false,
                code: "not_found",
                error: `audit-merkle-roots: event ${eventId} nie istnieje`,
            };
        }
        const event = evRes.data as { id: number; hash: string };

        // 2. Wszystkie roots pokrywajace event_id, od najstarszego
        const rootRes = await db
            .from("audit_merkle_roots")
            .select("*")
            .lte("chain_block_start", eventId)
            .gte("chain_block_end", eventId)
            .order("computed_at", { ascending: true })
            .order("id", { ascending: true });
        if (rootRes.error) {
            return {
                ok: false,
                code: "db_error",
                error: `audit-merkle-roots: odczyt korzeni nie powiodl sie: ${rootRes.error.message}`,
            };
        }
        const roots = (rootRes.data ?? []) as MerkleRootRow[];
        if (roots.length === 0) {
            return {
                ok: false,
                code: "no_root",
                error: `audit-merkle-roots: brak Merkle root pokrywajacego event ${eventId} (nie zostal jeszcze policzony)`,
            };
        }

        // 3. Dowod wobec kazdego korzenia; bundle z najstarszego
        let bundle: ProofBundle | undefined;
        const mismatched: number[] = [];
        for (const root of roots) {
            const hashes = await fetchHashesInBlock(
                db,
                root.chain_block_start,
                root.chain_block_end,
            );
            // Liczba lisci musi byc ta z chwili pieczeci - usuniety wiersz bloku
            // tez jest niezgodnoscia, nawet gdy dowod dla tego wpisu by sie domknal.
            let proof: MerkleProofStep[] | null = null;
            if (hashes.length === root.event_count && hashes.includes(event.hash)) {
                const p = buildMerkleProof(event.hash, hashes);
                if (verifyMerkleProof(event.hash, p, root.merkle_root)) proof = p;
            }
            if (!proof) {
                mismatched.push(root.id);
                continue;
            }
            if (!bundle) {
                bundle = {
                    event_id: event.id,
                    event_hash: event.hash,
                    proof,
                    merkle_root_id: root.id,
                    merkle_root: root.merkle_root,
                    chain_block_start: root.chain_block_start,
                    chain_block_end: root.chain_block_end,
                };
            }
        }
        if (mismatched.length > 0 || !bundle) {
            return {
                ok: false,
                code: "root_mismatch",
                mismatchedRootIds: mismatched,
                error:
                    `audit-merkle-roots: dowod dla eventu ${eventId} nie odtwarza korzeni ${mismatched.join(", ")} - ` +
                    "hash wpisu albo bloku zmieniono po zapieczetowaniu, albo dopisano korzen niezgodny z wczesniejszym",
            };
        }
        return { ok: true, bundle };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, code: "db_error", error: msg };
    }
}
