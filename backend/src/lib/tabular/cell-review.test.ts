// Testy ADR-0126 (T2.2): human-review komorki tabular review.

import { describe, it, expect } from "vitest";
import {
    type CellReview,
    effectiveCellContent,
    isCellReviewed,
    reviewCell,
} from "./cell-review";

describe("reviewCell - akt ludzki", () => {
    it("approved: rekord bez correctedContent", () => {
        const r = reviewCell("approved", "user-radca", "2026-06-14T10:00:00Z")!;
        expect(r.action).toBe("approved");
        expect(r.reviewedBy).toBe("user-radca");
        expect(r.reviewedAt).toBe("2026-06-14T10:00:00Z");
        expect(r.correctedContent).toBeUndefined();
    });

    it("rejected: rekord bez correctedContent (czyszczone nawet gdy podane)", () => {
        const r = reviewCell("rejected", "user-radca", "t", "ignorowane")!;
        expect(r.action).toBe("rejected");
        expect(r.correctedContent).toBeUndefined();
    });

    it("corrected: wymaga niepustej tresci, zachowuje ja", () => {
        const r = reviewCell("corrected", "user-radca", "t", "poprawiona wartosc")!;
        expect(r.action).toBe("corrected");
        expect(r.correctedContent).toBe("poprawiona wartosc");
    });

    it("fail-closed: corrected bez tresci / pusta -> null", () => {
        expect(reviewCell("corrected", "user-radca", "t")).toBeNull();
        expect(reviewCell("corrected", "user-radca", "t", "   ")).toBeNull();
    });

    it("fail-closed: nie-czlowiek (analysis/system/pusty) -> null", () => {
        expect(reviewCell("approved", "", "t")).toBeNull();
        expect(reviewCell("approved", "analysis", "t")).toBeNull();
        expect(reviewCell("approved", "system", "t")).toBeNull();
    });

    it("re-review dozwolone: najnowszy rekord nadpisuje", () => {
        const first = reviewCell("rejected", "user-a", "t1")!;
        const second = reviewCell("corrected", "user-b", "t2", "nowa")!;
        expect(first.action).toBe("rejected");
        expect(second.action).toBe("corrected");
        expect(second.reviewedBy).toBe("user-b");
    });
});

describe("effectiveCellContent", () => {
    const gen = "wygenerowana tresc";
    it("brak review -> tresc wygenerowana", () => {
        expect(effectiveCellContent(gen, null)).toBe(gen);
    });
    it("approved -> tresc wygenerowana", () => {
        const r = reviewCell("approved", "u", "t")!;
        expect(effectiveCellContent(gen, r)).toBe(gen);
    });
    it("corrected -> correctedContent", () => {
        const r = reviewCell("corrected", "u", "t", "poprawka")!;
        expect(effectiveCellContent(gen, r)).toBe("poprawka");
    });
    it("rejected -> null", () => {
        const r = reviewCell("rejected", "u", "t")!;
        expect(effectiveCellContent(gen, r)).toBeNull();
    });
});

describe("isCellReviewed", () => {
    it("null -> false, rekord -> true", () => {
        expect(isCellReviewed(null)).toBe(false);
        const r: CellReview = reviewCell("approved", "u", "t")!;
        expect(isCellReviewed(r)).toBe(true);
    });
});
