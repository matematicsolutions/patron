// ADR-0082: testy propagacji werdyktu groundingu tabular do audit hash-chain.

import { describe, expect, it } from "vitest";
import {
    aggregateGrounding,
    appendTabularGroundingEvent,
    buildTabularGroundingEvent,
} from "./audit-grounding";
import type { TabularCellGrounding } from "./grounding";

const verified: TabularCellGrounding = {
    total: 2,
    verified: 2,
    modified: 0,
    unverified: 0,
    status: "verified",
};
const halucynacja: TabularCellGrounding = {
    total: 3,
    verified: 1,
    modified: 0,
    unverified: 2,
    status: "unverified",
};
const zmodyfikowany: TabularCellGrounding = {
    total: 1,
    verified: 0,
    modified: 1,
    unverified: 0,
    status: "modified",
};
const doPrzegladu: TabularCellGrounding = {
    total: 2,
    verified: 0,
    modified: 0,
    unverified: 0,
    needs_review: 2,
    status: "needs_review",
};

describe("aggregateGrounding", () => {
    it("pusta lista -> same zera", () => {
        expect(aggregateGrounding([])).toEqual({
            cells_grounded: 0,
            cells_unverified: 0,
            citations_total: 0,
            verified: 0,
            modified: 0,
            unverified: 0,
        });
    });

    it("undefined nie liczy sie jako ugruntowana komorka", () => {
        const agg = aggregateGrounding([undefined, undefined]);
        expect(agg.cells_grounded).toBe(0);
        expect(agg.citations_total).toBe(0);
    });

    it("sumuje liczby i liczy komorki z halucynacja", () => {
        const agg = aggregateGrounding([
            verified,
            halucynacja,
            zmodyfikowany,
            undefined,
        ]);
        expect(agg.cells_grounded).toBe(3);
        expect(agg.cells_unverified).toBe(1);
        expect(agg.citations_total).toBe(6);
        expect(agg.verified).toBe(3);
        expect(agg.modified).toBe(1);
        expect(agg.unverified).toBe(2);
    });

    it("ADR-0102 B: liczy needs_review tylko gdy wystapil (wstecznie kompatybilne)", () => {
        const agg = aggregateGrounding([verified, doPrzegladu, undefined]);
        expect(agg.cells_needs_review).toBe(1);
        expect(agg.needs_review).toBe(2);
        expect(agg.cells_grounded).toBe(2);
        expect(agg.citations_total).toBe(4);
        // bez needs_review w zbiorze - pola nieobecne (stary ksztalt rollupu)
        const agg2 = aggregateGrounding([verified]);
        expect(agg2.cells_needs_review).toBeUndefined();
        expect(agg2.needs_review).toBeUndefined();
    });
});

describe("buildTabularGroundingEvent", () => {
    it("buduje zdarzenie tabular.grounding bez tresci cytatu", () => {
        const ev = buildTabularGroundingEvent({
            actorUserId: "user-1",
            reviewId: "rev-1",
            documents: 4,
            aggregate: aggregateGrounding([verified, halucynacja]),
            trigger: "generate",
        });
        expect(ev.event_type).toBe("tabular.grounding");
        expect(ev.actor_user_id).toBe("user-1");
        expect(ev.payload).toEqual({
            review_id: "rev-1",
            trigger: "generate",
            documents: 4,
            cells_grounded: 2,
            cells_unverified: 1,
            citations_total: 5,
            verified: 3,
            modified: 0,
            unverified: 2,
        });
        // brak pola z trescia cytatu/dokumentu
        expect(JSON.stringify(ev.payload)).not.toMatch(/quote|summary|text/i);
    });

    it("ADR-0102 B: payload zawiera needs_review tylko gdy wystapil", () => {
        const ev = buildTabularGroundingEvent({
            actorUserId: "user-1",
            reviewId: "rev-1",
            documents: 1,
            aggregate: aggregateGrounding([doPrzegladu]),
            trigger: "generate",
        });
        expect(ev.payload).toMatchObject({
            cells_needs_review: 1,
            needs_review: 2,
        });
    });
});

describe("appendTabularGroundingEvent", () => {
    it("no-op gdy nie sprawdzono zadnego cytatu (nie dotyka DB)", async () => {
        const db = {
            from() {
                throw new Error("DB nie powinno byc dotkniete dla pustego rollupu");
            },
        } as never;
        await expect(
            appendTabularGroundingEvent(db, {
                actorUserId: "user-1",
                reviewId: "rev-1",
                documents: 1,
                aggregate: aggregateGrounding([undefined]),
                trigger: "regenerate_cell",
            }),
        ).resolves.toBeUndefined();
    });
});
