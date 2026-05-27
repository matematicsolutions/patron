import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
    buildMerkleProof,
    buildMerkleRoot,
} from "./audit-merkle";
import { verifyProofBundle } from "./audit-merkle-verifier";
import type { ProofBundle } from "./audit-merkle-roots";

function h(label: string): string {
    return crypto.createHash("sha256").update(label).digest("hex");
}

/** Pomocnik - buduje pelny ProofBundle z bloku eventow */
function makeBundle(
    leaves: string[],
    targetIdx: number,
    blockStart: number,
): ProofBundle {
    const root = buildMerkleRoot(leaves);
    const proof = buildMerkleProof(leaves[targetIdx], leaves);
    return {
        event_id: blockStart + targetIdx,
        event_hash: leaves[targetIdx],
        proof,
        merkle_root_id: 1,
        merkle_root: root,
        chain_block_start: blockStart,
        chain_block_end: blockStart + leaves.length - 1,
    };
}

describe("verifyProofBundle - happy path", () => {
    it("wazne bundle dla 1 eventu -> ok true", () => {
        const leaves = [h("event-1")];
        const bundle = makeBundle(leaves, 0, 100);
        const result = verifyProofBundle(bundle);
        expect(result.ok).toBe(true);
        expect(result.event_id).toBe(100);
    });

    it("wazne bundle dla 1024 eventow (typowy block size) -> ok true", () => {
        const leaves = Array.from({ length: 1024 }, (_, i) => h(`event-${i}`));
        const bundle = makeBundle(leaves, 567, 1000);
        const result = verifyProofBundle(bundle);
        expect(result.ok).toBe(true);
        expect(result.event_id).toBe(1567);
    });
});

describe("verifyProofBundle - walidacja schematu", () => {
    it("brakujace pola -> ok false", () => {
        // @ts-expect-error - test invalid input
        const bad: ProofBundle = { event_id: 1 };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/niepelny lub nieprawidlowy schemat/);
    });

    it("event_id jako string -> ok false", () => {
        const leaves = [h("e1"), h("e2")];
        const bundle = makeBundle(leaves, 0, 10);
        const bad = { ...bundle, event_id: "10" as unknown as number };
        const result = verifyProofBundle(bad as ProofBundle);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/schemat/);
    });
});

describe("verifyProofBundle - walidacja zakresu bloku", () => {
    it("event_id ponizej chain_block_start -> ok false", () => {
        const leaves = [h("e1"), h("e2")];
        const bundle = makeBundle(leaves, 0, 100);
        const bad: ProofBundle = { ...bundle, event_id: 99 };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/poza zakresem bloku/);
    });

    it("event_id powyzej chain_block_end -> ok false", () => {
        const leaves = [h("e1"), h("e2")];
        const bundle = makeBundle(leaves, 0, 100);
        const bad: ProofBundle = { ...bundle, event_id: 999 };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/poza zakresem bloku/);
    });
});

describe("verifyProofBundle - tamper detection", () => {
    it("zmieniony event_hash -> ok false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const bundle = makeBundle(leaves, 0, 100);
        const bad: ProofBundle = { ...bundle, event_hash: h("fake-event") };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/proof nie odtwarza Merkle root/);
    });

    it("zmieniony merkle_root -> ok false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const bundle = makeBundle(leaves, 0, 100);
        const bad: ProofBundle = { ...bundle, merkle_root: h("fake-root") };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/proof nie odtwarza Merkle root/);
    });

    it("naruszony proof step (sibling) -> ok false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const bundle = makeBundle(leaves, 0, 100);
        const tamperedProof = [
            { ...bundle.proof[0], hash: h("tampered") },
            ...bundle.proof.slice(1),
        ];
        const bad: ProofBundle = { ...bundle, proof: tamperedProof };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/proof nie odtwarza Merkle root/);
    });

    it("proof step z nieprawidlowym formatem hash -> ok false", () => {
        const leaves = [h("e1"), h("e2")];
        const bundle = makeBundle(leaves, 0, 100);
        const bad: ProofBundle = {
            ...bundle,
            proof: [{ position: "left", hash: "XXXX" }],
        };
        const result = verifyProofBundle(bad);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/formatu hex64/);
    });
});
