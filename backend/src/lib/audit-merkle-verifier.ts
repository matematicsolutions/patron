// Offline verifier dla Merkle proof bundle (ADR-0026).
//
// Cel: audytor (UODO, rewident kancelarii, biegly w postepowaniu) dostaje
// `ProofBundle` (event_hash + proof + merkle_root + zakres bloku) i moze
// niezaleznie zweryfikowac integralnosc konkretnego eventu bez dostepu do
// bazy Patrona ani innych eventow z loga.
//
// Pure function - eksportowany do `scripts/verify-audit-merkle.ts` w ADR-0036
// jako CLI dla audytora. Tu trzymamy logike biznesowa weryfikacji + walidacje
// schematu bundla.

import { verifyMerkleProof } from "./audit-merkle";
import type { ProofBundle } from "./audit-merkle-roots";

export interface VerificationResult {
    ok: boolean;
    event_id?: number;
    error?: string;
}

/**
 * Weryfikuje pelen ProofBundle offline.
 * Sprawdza:
 *   1. Schemat bundla (wszystkie pola obowiazkowe).
 *   2. event_id miesci sie w [chain_block_start, chain_block_end].
 *   3. proof odtwarza merkle_root z event_hash.
 *
 * Nigdy nie sprzega sie z baza - audytor moze uruchamiac z izolowanej maszyny.
 */
export function verifyProofBundle(bundle: ProofBundle): VerificationResult {
    // 1. Walidacja schematu
    if (
        typeof bundle.event_id !== "number" ||
        typeof bundle.event_hash !== "string" ||
        !Array.isArray(bundle.proof) ||
        typeof bundle.merkle_root_id !== "number" ||
        typeof bundle.merkle_root !== "string" ||
        typeof bundle.chain_block_start !== "number" ||
        typeof bundle.chain_block_end !== "number"
    ) {
        return {
            ok: false,
            error: "audit-merkle-verifier: bundle ma niepelny lub nieprawidlowy schemat",
        };
    }

    // 2. event_id w zakresie bloku
    if (
        bundle.event_id < bundle.chain_block_start ||
        bundle.event_id > bundle.chain_block_end
    ) {
        return {
            ok: false,
            event_id: bundle.event_id,
            error: `audit-merkle-verifier: event_id ${bundle.event_id} poza zakresem bloku [${bundle.chain_block_start}, ${bundle.chain_block_end}]`,
        };
    }

    // 3. Weryfikacja proof
    try {
        const valid = verifyMerkleProof(
            bundle.event_hash,
            bundle.proof,
            bundle.merkle_root,
        );
        if (!valid) {
            return {
                ok: false,
                event_id: bundle.event_id,
                error: "audit-merkle-verifier: proof nie odtwarza Merkle root - bundle uszkodzony lub log naruszony",
            };
        }
        return { ok: true, event_id: bundle.event_id };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, event_id: bundle.event_id, error: msg };
    }
}
