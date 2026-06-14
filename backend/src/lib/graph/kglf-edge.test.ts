// Testy ADR-0125 (T2.1): warstwa governance krawedzi KGLF.

import { describe, it, expect } from "vitest";
import {
    type KglfEdge,
    type ProposableEdge,
    isEdgeVisible,
    isValidRelationLabel,
    proposeEdge,
    ratifyEdge,
} from "./kglf-edge";

const AUTO: ProposableEdge = {
    fromDocId: "doc-A",
    toDocId: null,
    toEntityId: "ent-1",
    relation: "cytuje_orzeczenie",
    confidence: 0.9,
    sourceEntityId: "src-1",
};

describe("isValidRelationLabel (ontologia jako dane)", () => {
    it("akceptuje znane etykiety PL i rozszerzenia kancelarii (snake)", () => {
        expect(isValidRelationLabel("cytuje_orzeczenie")).toBe(true);
        expect(isValidRelationLabel("wlasna_relacja_kancelarii")).toBe(true);
        expect(isValidRelationLabel("a")).toBe(true);
    });
    it("odrzuca smieci / puste / wielkie litery / spacje / wiodaca cyfre / injection", () => {
        expect(isValidRelationLabel("")).toBe(false);
        expect(isValidRelationLabel("Cytuje")).toBe(false);
        expect(isValidRelationLabel("ma spacje")).toBe(false);
        expect(isValidRelationLabel("1relacja")).toBe(false);
        expect(isValidRelationLabel("drop;table")).toBe(false);
        expect(isValidRelationLabel("a".repeat(65))).toBe(false);
    });
});

describe("proposeEdge", () => {
    it("owija auto-krawedz jako proposed/analysis prywatna do runu", () => {
        const e = proposeEdge(AUTO, "run-1")!;
        expect(e.status).toBe("proposed");
        expect(e.origin).toBe("analysis");
        expect(e.runId).toBe("run-1");
        expect(e.relationLabel).toBe("cytuje_orzeczenie");
        expect(e.ratifiedBy).toBeUndefined();
    });
    it("fail-closed: pusty runId albo zla etykieta -> null", () => {
        expect(proposeEdge(AUTO, "")).toBeNull();
        expect(proposeEdge({ ...AUTO, relation: "ZLA ETYKIETA" }, "run-1")).toBeNull();
    });
});

describe("ratifyEdge (akt ludzki)", () => {
    it("proposed -> ratified: firm-public, zapis kto/kiedy, origin bez zmian", () => {
        const proposed = proposeEdge(AUTO, "run-1")!;
        const r = ratifyEdge(proposed, "user-radca", "2026-06-14T10:00:00Z")!;
        expect(r.status).toBe("ratified");
        expect(r.runId).toBeNull(); // firm-public
        expect(r.ratifiedBy).toBe("user-radca");
        expect(r.ratifiedAt).toBe("2026-06-14T10:00:00Z");
        expect(r.origin).toBe("analysis"); // ratyfikacja != autorstwo
    });
    it("fail-closed: tylko czlowiek ratyfikuje (nie analysis/system/pusty)", () => {
        const proposed = proposeEdge(AUTO, "run-1")!;
        expect(ratifyEdge(proposed, "", "t")).toBeNull();
        expect(ratifyEdge(proposed, "analysis", "t")).toBeNull();
        expect(ratifyEdge(proposed, "system", "t")).toBeNull();
    });
    it("fail-closed: nie mozna ratyfikowac juz ratyfikowanej (idempotencja)", () => {
        const proposed = proposeEdge(AUTO, "run-1")!;
        const r = ratifyEdge(proposed, "user-radca", "t")!;
        expect(ratifyEdge(r, "user-radca", "t2")).toBeNull();
    });
});

describe("isEdgeVisible (run-privacy)", () => {
    const proposed = proposeEdge(AUTO, "run-1")!;
    const ratified = ratifyEdge(proposed, "user-radca", "t")!;

    it("ratified jest firm-public (widoczna w kazdym runie i bez runu)", () => {
        expect(isEdgeVisible(ratified, "run-1")).toBe(true);
        expect(isEdgeVisible(ratified, "run-2")).toBe(true);
        expect(isEdgeVisible(ratified, null)).toBe(true);
    });
    it("proposed widoczna TYLKO w swoim runie", () => {
        expect(isEdgeVisible(proposed, "run-1")).toBe(true);
        expect(isEdgeVisible(proposed, "run-2")).toBe(false);
        expect(isEdgeVisible(proposed, null)).toBe(false);
    });
});
