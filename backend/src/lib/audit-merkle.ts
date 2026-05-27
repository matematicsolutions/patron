// Merkle tree nad audit_log (ADR-0026). Warstwa NAD hash-chain (ADR-0001),
// nie zamiast niego.
//
// Lisce drzewa: audit_log.hash (juz SHA-256 hex z hash-chain).
// Wezly wewnetrzne: SHA-256(left_hex || right_hex) - konkatenacja hex stringow.
// Nieparzysta liczba lisci: duplicate last (konwencja RFC 6962 Certificate Transparency).
//
// Atrybucja:
// Pattern inspirowany przez microsoft/agent-governance-toolkit (MIT, 2026)
// per ADR-0024. Algorytm: RFC 6962 (Laurie/Langley/Kasper, 2013).
//
// Pure functions - bez side effects, testowalne bez mockow ani bazy.

import crypto from "crypto";

const HASH_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Hash dwoch wezlow Merkle - SHA-256 konkatenacji hex.
 * Internal helper - nie eksportujemy poza modul.
 */
function hashPair(left: string, right: string): string {
    if (!HASH_HEX_RE.test(left) || !HASH_HEX_RE.test(right)) {
        throw new Error(
            "audit-merkle: leaf or node hash nie pasuje do formatu ^[0-9a-f]{64}$",
        );
    }
    return crypto
        .createHash("sha256")
        .update(left + right, "utf8")
        .digest("hex");
}

/**
 * Buduje drzewo Merkle z listy hashy lisci (audit_log.hash).
 * Zwraca root jako SHA-256 hex.
 *
 * Pusta lista -> wyjatek (root undefined nie ma sensu dla pustego loga;
 * Patron startuje z genesis = nigdy nie wywolujemy compute dla 0 events).
 *
 * 1 lisc -> root = ten lisc (drzewo wysokosci 0).
 * Nieparzysta liczba lisci na poziomie -> duplicate last (RFC 6962).
 */
export function buildMerkleRoot(leaves: string[]): string {
    if (leaves.length === 0) {
        throw new Error("audit-merkle: pusta lista lisci - brak roota");
    }
    for (const leaf of leaves) {
        if (!HASH_HEX_RE.test(leaf)) {
            throw new Error(
                `audit-merkle: lisc nie pasuje do formatu ^[0-9a-f]{64}$: ${leaf.slice(0, 16)}...`,
            );
        }
    }
    if (leaves.length === 1) {
        return leaves[0];
    }
    let level = [...leaves];
    while (level.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate last
            next.push(hashPair(left, right));
        }
        level = next;
    }
    return level[0];
}

/**
 * Krok proof - kierunek (sibling jest po LEWEJ czy po PRAWEJ stronie naszego biezacego hash'a),
 * plus hash sibling'a do hash'owania razem z naszym.
 *
 * Format zgodny z RFC 6962 / open Merkle proof spec.
 */
export interface MerkleProofStep {
    position: "left" | "right";
    hash: string;
}

/**
 * Buduje proof-of-inclusion dla konkretnego liscia.
 *
 * Zwraca pelna sciezke od liscia do roota: tablica MerkleProofStep
 * o dlugosci ceil(log2(leaves.length)). Dla 1 leaf = pusta tablica.
 *
 * Algorytm: odtworz kazdy poziom drzewa, na kazdym zapisz sibling biezacego indeksu,
 * potem przejdz indeks na poziom wyzej (i = floor(i/2)).
 *
 * Throws gdy targetLeaf nie ma w liscach.
 */
export function buildMerkleProof(
    targetLeaf: string,
    leaves: string[],
): MerkleProofStep[] {
    if (leaves.length === 0) {
        throw new Error("audit-merkle: pusta lista lisci");
    }
    let idx = leaves.indexOf(targetLeaf);
    if (idx === -1) {
        throw new Error(
            `audit-merkle: targetLeaf nie znaleziony w liscach: ${targetLeaf.slice(0, 16)}...`,
        );
    }
    if (leaves.length === 1) {
        return [];
    }

    const proof: MerkleProofStep[] = [];
    let level = [...leaves];
    while (level.length > 1) {
        const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
        const siblingHash =
            siblingIdx < level.length ? level[siblingIdx] : level[idx]; // duplicate last
        proof.push({
            position: idx % 2 === 0 ? "right" : "left",
            hash: siblingHash,
        });

        const next: string[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = i + 1 < level.length ? level[i + 1] : level[i];
            next.push(hashPair(left, right));
        }
        level = next;
        idx = Math.floor(idx / 2);
    }
    return proof;
}

/**
 * Offline weryfikacja proof-of-inclusion.
 * Audytor podaje: hash konkretnego eventu + proof + root z `audit_merkle_roots`,
 * funkcja odtwarza sciezke do roota i porownuje.
 *
 * Pure function - audytor moze uruchamiac standalone bez backendu Patrona
 * (np. w przyszlym ADR-0036 jako CLI `scripts/verify-audit-merkle.ts`).
 *
 * Zwraca true gdy proof odtwarza root, false w przeciwnym razie.
 * Throws gdy hash, proof step lub root nie pasuja do formatu.
 */
export function verifyMerkleProof(
    targetHash: string,
    proof: MerkleProofStep[],
    expectedRoot: string,
): boolean {
    if (!HASH_HEX_RE.test(targetHash)) {
        throw new Error("audit-merkle: targetHash nie pasuje do formatu hex64");
    }
    if (!HASH_HEX_RE.test(expectedRoot)) {
        throw new Error("audit-merkle: expectedRoot nie pasuje do formatu hex64");
    }
    let current = targetHash;
    for (const step of proof) {
        if (!HASH_HEX_RE.test(step.hash)) {
            throw new Error(
                "audit-merkle: proof step hash nie pasuje do formatu hex64",
            );
        }
        if (step.position === "left") {
            current = hashPair(step.hash, current);
        } else {
            current = hashPair(current, step.hash);
        }
    }
    return current === expectedRoot;
}
