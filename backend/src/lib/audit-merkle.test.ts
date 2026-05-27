import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
    buildMerkleProof,
    buildMerkleRoot,
    verifyMerkleProof,
} from "./audit-merkle";

// Helper - generuje deterministyczny SHA-256 hex z labela (do testow).
function h(label: string): string {
    return crypto.createHash("sha256").update(label).digest("hex");
}

describe("buildMerkleRoot", () => {
    it("rzuca dla pustej listy lisci", () => {
        expect(() => buildMerkleRoot([])).toThrow(/pusta lista lisci/);
    });

    it("dla 1 liscia zwraca ten lisc", () => {
        const leaf = h("event-1");
        expect(buildMerkleRoot([leaf])).toBe(leaf);
    });

    it("dla 2 lisci zwraca SHA-256(left_hex || right_hex)", () => {
        const a = h("event-1");
        const b = h("event-2");
        const expected = crypto
            .createHash("sha256")
            .update(a + b)
            .digest("hex");
        expect(buildMerkleRoot([a, b])).toBe(expected);
    });

    it("dla nieparzystej liczby duplikuje ostatni lisc (RFC 6962)", () => {
        // 3 lisce: L1, L2, L3 -> level 1: H(L1,L2), H(L3,L3) -> root: H(H(L1,L2), H(L3,L3))
        const l1 = h("event-1");
        const l2 = h("event-2");
        const l3 = h("event-3");
        const n12 = crypto.createHash("sha256").update(l1 + l2).digest("hex");
        const n33 = crypto.createHash("sha256").update(l3 + l3).digest("hex");
        const expected = crypto
            .createHash("sha256")
            .update(n12 + n33)
            .digest("hex");
        expect(buildMerkleRoot([l1, l2, l3])).toBe(expected);
    });

    it("deterministyczny - te same lisce daja ten sam root", () => {
        const leaves = [h("a"), h("b"), h("c"), h("d"), h("e")];
        expect(buildMerkleRoot(leaves)).toBe(buildMerkleRoot(leaves));
    });

    it("rzuca gdy lisc nie pasuje do hex64", () => {
        expect(() => buildMerkleRoot(["abc"])).toThrow(/nie pasuje do formatu/);
        expect(() => buildMerkleRoot([h("ok"), "XXXX"])).toThrow(
            /nie pasuje do formatu/,
        );
    });

    it("root rozni sie gdy kolejnosc lisci sie zmieni", () => {
        const leaves1 = [h("a"), h("b"), h("c")];
        const leaves2 = [h("c"), h("b"), h("a")];
        expect(buildMerkleRoot(leaves1)).not.toBe(buildMerkleRoot(leaves2));
    });
});

describe("buildMerkleProof + verifyMerkleProof - round-trip", () => {
    it("1 lisc - proof pusty, weryfikacja root === target", () => {
        const leaf = h("only-event");
        const proof = buildMerkleProof(leaf, [leaf]);
        expect(proof).toEqual([]);
        expect(verifyMerkleProof(leaf, proof, leaf)).toBe(true);
    });

    it("2 lisce - proof ma 1 krok, weryfikuje sie do roota", () => {
        const a = h("event-1");
        const b = h("event-2");
        const root = buildMerkleRoot([a, b]);
        const proofA = buildMerkleProof(a, [a, b]);
        const proofB = buildMerkleProof(b, [a, b]);
        expect(proofA).toHaveLength(1);
        expect(proofA[0].position).toBe("right");
        expect(proofA[0].hash).toBe(b);
        expect(verifyMerkleProof(a, proofA, root)).toBe(true);
        expect(verifyMerkleProof(b, proofB, root)).toBe(true);
    });

    it("8 lisci - kazdy event weryfikuje sie do roota (round-trip)", () => {
        const leaves = Array.from({ length: 8 }, (_, i) => h(`event-${i}`));
        const root = buildMerkleRoot(leaves);
        for (const leaf of leaves) {
            const proof = buildMerkleProof(leaf, leaves);
            expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
        }
    });

    it("7 lisci (nieparzysta) - kazdy event weryfikuje sie do roota", () => {
        const leaves = Array.from({ length: 7 }, (_, i) => h(`event-${i}`));
        const root = buildMerkleRoot(leaves);
        for (const leaf of leaves) {
            const proof = buildMerkleProof(leaf, leaves);
            expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
        }
    });

    it("1024 lisci (typowy block size) - proof ma 10 krokow, weryfikacja OK", () => {
        const leaves = Array.from({ length: 1024 }, (_, i) => h(`event-${i}`));
        const root = buildMerkleRoot(leaves);
        const target = leaves[567];
        const proof = buildMerkleProof(target, leaves);
        // ceil(log2(1024)) = 10
        expect(proof).toHaveLength(10);
        expect(verifyMerkleProof(target, proof, root)).toBe(true);
    });
});

describe("verifyMerkleProof - tamper detection", () => {
    it("modyfikacja eventu wykryta - weryfikacja false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const root = buildMerkleRoot(leaves);
        const target = leaves[0];
        const proof = buildMerkleProof(target, leaves);
        // Audytor probuje zweryfikowac sfalszowany event z prawdziwym proof + root
        const fakeEvent = h("event-FAKE");
        expect(verifyMerkleProof(fakeEvent, proof, root)).toBe(false);
    });

    it("modyfikacja proof step wykryta - weryfikacja false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const root = buildMerkleRoot(leaves);
        const target = leaves[0];
        const proof = buildMerkleProof(target, leaves);
        // Audytor probuje zweryfikowac z naruszonym proof
        const tamperedProof = [
            { ...proof[0], hash: h("event-tampered-sibling") },
            ...proof.slice(1),
        ];
        expect(verifyMerkleProof(target, tamperedProof, root)).toBe(false);
    });

    it("modyfikacja roota wykryta - weryfikacja false", () => {
        const leaves = Array.from({ length: 4 }, (_, i) => h(`event-${i}`));
        const target = leaves[0];
        const proof = buildMerkleProof(target, leaves);
        const fakeRoot = h("fake-root");
        expect(verifyMerkleProof(target, proof, fakeRoot)).toBe(false);
    });
});

describe("buildMerkleProof - bledy wejscia", () => {
    it("rzuca gdy targetLeaf nie ma w liscach", () => {
        const leaves = [h("a"), h("b"), h("c")];
        expect(() => buildMerkleProof(h("missing"), leaves)).toThrow(
            /nie znaleziony w liscach/,
        );
    });

    it("rzuca dla pustej listy lisci", () => {
        expect(() => buildMerkleProof(h("x"), [])).toThrow(/pusta lista lisci/);
    });
});

describe("verifyMerkleProof - walidacja formatu", () => {
    it("rzuca gdy targetHash nie hex64", () => {
        expect(() => verifyMerkleProof("xxx", [], h("ok"))).toThrow(
            /targetHash/,
        );
    });

    it("rzuca gdy expectedRoot nie hex64", () => {
        expect(() => verifyMerkleProof(h("ok"), [], "yyy")).toThrow(
            /expectedRoot/,
        );
    });

    it("rzuca gdy proof step hash nie hex64", () => {
        expect(() =>
            verifyMerkleProof(h("ok"), [{ position: "left", hash: "zz" }], h("ok")),
        ).toThrow(/proof step hash/);
    });
});
