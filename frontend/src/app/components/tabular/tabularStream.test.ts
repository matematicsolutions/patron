// Konsument SSE tabular generate: cell_update z `reason` (audyt D-11)
// i document_truncated (audyt D-15) - ksztalty jak w backend routes/tabular.ts.
import { describe, expect, it } from "vitest";
import type { TabularCell } from "../shared/types";
import {
    applyTabularStreamEvent,
    cellCoverage,
    parseCoverage,
    regenerateErrorReason,
} from "./tabularStream";

function cell(docId: string, col: number, over: Partial<TabularCell> = {}): TabularCell {
    return {
        id: `${docId}-${col}`,
        review_id: "r1",
        document_id: docId,
        column_index: col,
        content: null,
        status: "generating",
        created_at: "2026-10-01T00:00:00Z",
        ...over,
    };
}

describe("applyTabularStreamEvent", () => {
    const cells = [cell("d1", 0), cell("d1", 1), cell("d2", 0)];

    it("cell_update done: tresc i status tylko dla wskazanej komorki", () => {
        const out = applyTabularStreamEvent(cells, {
            type: "cell_update",
            document_id: "d1",
            column_index: 1,
            content: { summary: "Wynik", flag: "green" },
            status: "done",
        });
        expect(out[1]).toMatchObject({ status: "done", content: { summary: "Wynik" } });
        expect(out[1].error_reason).toBeUndefined();
        expect(out[0]).toBe(cells[0]);
        expect(out[2]).toBe(cells[2]);
    });

    it("cell_update error + reason document_no_text: powod zapisany w komorce", () => {
        const out = applyTabularStreamEvent(cells, {
            type: "cell_update",
            document_id: "d2",
            column_index: 0,
            content: null,
            status: "error",
            reason: "document_no_text",
        });
        expect(out[2]).toMatchObject({ status: "error", error_reason: "document_no_text" });
    });

    it("cell_update error z nieznanym powodem: bez error_reason", () => {
        const out = applyTabularStreamEvent(cells, {
            type: "cell_update",
            document_id: "d2",
            column_index: 0,
            content: null,
            status: "error",
            reason: "<script>",
        });
        expect(out[2].error_reason).toBeUndefined();
    });

    it("nowy cell_update kasuje stary powod bledu", () => {
        const errored = [cell("d1", 0, { status: "error", error_reason: "document_no_text" })];
        const out = applyTabularStreamEvent(errored, {
            type: "cell_update",
            document_id: "d1",
            column_index: 0,
            content: null,
            status: "generating",
        });
        expect(out[0].error_reason).toBeUndefined();
    });

    it("document_truncated: pokrycie trafia do wszystkich komorek dokumentu", () => {
        const out = applyTabularStreamEvent(cells, {
            type: "document_truncated",
            document_id: "d1",
            truncated: true,
            chars_sent: 120000,
            chars_total: 300000,
        });
        const expected = { truncated: true, chars_sent: 120000, chars_total: 300000 };
        expect(out[0].document_coverage).toEqual(expected);
        expect(out[1].document_coverage).toEqual(expected);
        expect(out[2].document_coverage).toBeUndefined();
        // Pokrycie przezywa nastepny cell_update tej komorki.
        const after = applyTabularStreamEvent(out, {
            type: "cell_update",
            document_id: "d1",
            column_index: 0,
            content: { summary: "Not Found" },
            status: "done",
        });
        expect(cellCoverage(after[0])).toEqual(expected);
    });

    it("document_truncated o zlym ksztalcie i nieznane zdarzenia: bez zmian", () => {
        expect(
            applyTabularStreamEvent(cells, {
                type: "document_truncated",
                document_id: "d1",
                truncated: true,
                chars_sent: "duzo",
                chars_total: 1,
            }),
        ).toBe(cells);
        expect(applyTabularStreamEvent(cells, { type: "done" })).toBe(cells);
        expect(applyTabularStreamEvent(cells, null)).toBe(cells);
    });
});

describe("parseCoverage / cellCoverage", () => {
    it("content.coverage ma pierwszenstwo, zly ksztalt nie udaje obciecia", () => {
        expect(parseCoverage({ truncated: false, chars_sent: 1, chars_total: 2 })).toBeUndefined();
        const c = cell("d1", 0, {
            status: "done",
            content: {
                summary: "x",
                coverage: { truncated: true, chars_sent: 5, chars_total: 9 },
            },
            document_coverage: { truncated: true, chars_sent: 1, chars_total: 2 },
        });
        expect(cellCoverage(c)).toEqual({ truncated: true, chars_sent: 5, chars_total: 9 });
    });
});

describe("regenerateErrorReason", () => {
    it("czyta code z tresci 422 rzuconej przez apiRequest", () => {
        const err = new Error(
            JSON.stringify({ code: "document_no_text", detail: "Dokument nie ma warstwy tekstowej" }),
        );
        expect(regenerateErrorReason(err)).toBe("document_no_text");
    });

    it("inne bledy: brak powodu", () => {
        expect(regenerateErrorReason(new Error("API error: 500"))).toBeUndefined();
        expect(regenerateErrorReason(new Error('{"code":"inny"}'))).toBeUndefined();
        expect(regenerateErrorReason("tekst")).toBeUndefined();
    });
});
