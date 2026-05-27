// Storage layer dla Merkle roots (ADR-0026).
// Komplementarny do `audit.ts` (hash-chain). Ten modul nie pisze do audit_log -
// czyta hash'e z bloku eventow i zapisuje root do `audit_merkle_roots`.
//
// Manualny trigger w ADR-0026. Automatyzacja (hook on N events) = ADR-0036.

import type { createServerSupabase } from "./supabase";
import {
    buildMerkleProof,
    buildMerkleRoot,
    type MerkleProofStep,
} from "./audit-merkle";

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
 * (deterministyczny algorytm RFC 6962). To NIE jest idempotentne; auto-trigger
 * po N events (ADR-0036) bedzie musial sprawdzic przed compute czy root juz
 * istnieje dla zakresu. W tej iteracji manual trigger - administrator
 * kancelarii odpowiada za jednokrotnosc wywolania.
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

export interface ProofBundle {
    event_id: number;
    event_hash: string;
    proof: MerkleProofStep[];
    merkle_root_id: number;
    merkle_root: string;
    chain_block_start: number;
    chain_block_end: number;
}

/**
 * Buduje proof-of-inclusion dla konkretnego eventu z audit_log.
 *
 * Workflow:
 * 1. Znajdz najnowszy root pokrywajacy event (block_start <= event_id <= block_end).
 * 2. Pobierz hash'e wszystkich eventow z tego bloku.
 * 3. Zbuduj proof do roota i zapakuj w bundle.
 *
 * Bundle jest samowystarczalny: audytor moze offline zweryfikowac
 * przez `verifyMerkleProof(bundle.event_hash, bundle.proof, bundle.merkle_root)`.
 */
export async function fetchProofForEvent(
    db: ReturnType<typeof createServerSupabase>,
    eventId: number,
): Promise<{ ok: boolean; bundle?: ProofBundle; error?: string }> {
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
                error: `audit-merkle-roots: event ${eventId} nie istnieje`,
            };
        }
        const event = evRes.data as { id: number; hash: string };

        // 2. Znajdz root pokrywajacy event_id
        const rootRes = await db
            .from("audit_merkle_roots")
            .select("*")
            .lte("chain_block_start", eventId)
            .gte("chain_block_end", eventId)
            .order("computed_at", { ascending: false })
            .limit(1)
            .single();
        if (rootRes.error || !rootRes.data) {
            return {
                ok: false,
                error: `audit-merkle-roots: brak Merkle root pokrywajacego event ${eventId} (nie zostal jeszcze policzony)`,
            };
        }
        const root = rootRes.data as MerkleRootRow;

        // 3. Pobierz hash'e bloku i zbuduj proof
        const hashes = await fetchHashesInBlock(
            db,
            root.chain_block_start,
            root.chain_block_end,
        );
        const proof = buildMerkleProof(event.hash, hashes);

        return {
            ok: true,
            bundle: {
                event_id: event.id,
                event_hash: event.hash,
                proof,
                merkle_root_id: root.id,
                merkle_root: root.merkle_root,
                chain_block_start: root.chain_block_start,
                chain_block_end: root.chain_block_end,
            },
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}
