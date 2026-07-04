// Testy komorki tabular (spec 012 US1): badge human-review (ADR-0126) i
// effective content - corrected pokazuje tresc poprawiona przez prawnika,
// rejected wygasza wynik. To jest siatka na regresje ficzera governance,
// ktorego kompilator nie pilnuje.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import type { TabularCell as TCell } from "../shared/types";
import { TabularCell } from "./TabularCell";

function makeCell(over: Partial<TCell> = {}): TCell {
    return {
        id: "c1",
        review_id: "r1",
        document_id: "d1",
        column_index: 0,
        content: { summary: "Wartosc oryginalna" },
        status: "done",
        created_at: "2026-07-04T00:00:00Z",
        ...over,
    };
}

function renderCell(cell: TCell) {
    return render(<TabularCell cell={cell} onExpand={vi.fn()} />);
}

describe("TabularCell - human-review (ADR-0126)", () => {
    it("bez review: brak badge (zero szumu)", () => {
        renderCell(makeCell());
        expect(screen.getByText("Wartosc oryginalna")).toBeTruthy();
        for (const key of [
            "tabular.reviewStatusApproved",
            "tabular.reviewStatusRejected",
            "tabular.reviewStatusCorrected",
        ] as const) {
            expect(screen.queryByTitle(t(key))).toBeNull();
        }
    });

    it("approved: zielony badge z tytulem statusu", () => {
        renderCell(makeCell({ review_action: "approved" }));
        expect(
            screen.getByTitle(t("tabular.reviewStatusApproved")),
        ).toBeTruthy();
    });

    it("corrected: pokazuje tresc poprawiona zamiast wygenerowanej", () => {
        renderCell(
            makeCell({
                review_action: "corrected",
                corrected_content: "Tresc poprawiona przez prawnika",
            }),
        );
        expect(
            screen.getByText("Tresc poprawiona przez prawnika"),
        ).toBeTruthy();
        expect(screen.queryByText("Wartosc oryginalna")).toBeNull();
        expect(
            screen.getByTitle(t("tabular.reviewStatusCorrected")),
        ).toBeTruthy();
    });

    it("rejected: tresc wygaszona (line-through) + badge", () => {
        renderCell(makeCell({ review_action: "rejected" }));
        expect(
            screen.getByTitle(t("tabular.reviewStatusRejected")),
        ).toBeTruthy();
        const text = screen.getByText("Wartosc oryginalna");
        expect(text.closest(".line-through")).not.toBeNull();
    });
});
