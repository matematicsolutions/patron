// Testy kontrolki human-review w panelu bocznym (spec 012 US1, ADR-0126 12c):
// czy klik wysyla WLASCIWA akcje do onReview i czy "Popraw" wymaga niepustej
// tresci. DocView/DocxView mockowane (pdfjs/docx-preview nie wstaja w jsdom,
// a nie ich tu testujemy).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import type {
    ColumnConfig,
    PATRONDocument,
    TabularCell,
} from "../shared/types";
import { TRSidePanel } from "./TRSidePanel";

vi.mock("../shared/DocView", () => ({ DocView: () => null }));
vi.mock("../shared/DocxView", () => ({ DocxView: () => null }));

const column: ColumnConfig = {
    index: 0,
    name: "Kara umowna",
} as ColumnConfig;

const doc = {
    id: "d1",
    filename: "umowa-rumpole.pdf",
} as PATRONDocument;

function makeCell(over: Partial<TabularCell> = {}): TabularCell {
    return {
        id: "c1",
        review_id: "r1",
        document_id: "d1",
        column_index: 0,
        content: { summary: "Kara 5000 PLN za dzien zwloki" },
        status: "done",
        created_at: "2026-07-04T00:00:00Z",
        ...over,
    };
}

function renderPanel(
    cell: TabularCell,
    onReview = vi.fn().mockResolvedValue(undefined),
) {
    render(
        <TRSidePanel
            cell={cell}
            document={doc}
            column={column}
            columns={[column]}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onReview={onReview}
        />,
    );
    return onReview;
}

describe("TRSidePanel - kontrolka human-review", () => {
    it("renderuje sekcje weryfikacji z trzema akcjami", () => {
        renderPanel(makeCell());
        expect(screen.getByText(t("tabular.reviewHeading"))).toBeTruthy();
        expect(screen.getByText(t("tabular.reviewApprove"))).toBeTruthy();
        expect(screen.getByText(t("tabular.reviewReject"))).toBeTruthy();
        expect(screen.getByText(t("tabular.reviewCorrect"))).toBeTruthy();
    });

    it("Zatwierdz wola onReview('approved')", async () => {
        const onReview = renderPanel(makeCell());
        fireEvent.click(screen.getByText(t("tabular.reviewApprove")));
        await waitFor(() =>
            expect(onReview).toHaveBeenCalledWith("approved", undefined),
        );
    });

    it("Odrzuc wola onReview('rejected')", async () => {
        const onReview = renderPanel(makeCell());
        fireEvent.click(screen.getByText(t("tabular.reviewReject")));
        await waitFor(() =>
            expect(onReview).toHaveBeenCalledWith("rejected", undefined),
        );
    });

    it("Popraw: textarea prefill z wygenerowanej tresci, zapis wysyla korekte", async () => {
        const onReview = renderPanel(makeCell());
        fireEvent.click(screen.getByText(t("tabular.reviewCorrect")));
        const textarea = screen.getByPlaceholderText(
            t("tabular.reviewCorrectPlaceholder"),
        ) as HTMLTextAreaElement;
        expect(textarea.value).toBe("Kara 5000 PLN za dzien zwloki");
        fireEvent.change(textarea, {
            target: { value: "Kara 500 PLN za dzien zwloki" },
        });
        fireEvent.click(screen.getByText(t("tabular.reviewSaveCorrection")));
        await waitFor(() =>
            expect(onReview).toHaveBeenCalledWith(
                "corrected",
                "Kara 500 PLN za dzien zwloki",
            ),
        );
    });

    it("Popraw: pusta tresc blokuje zapis (fail-closed jak backend)", () => {
        const onReview = renderPanel(makeCell());
        fireEvent.click(screen.getByText(t("tabular.reviewCorrect")));
        const textarea = screen.getByPlaceholderText(
            t("tabular.reviewCorrectPlaceholder"),
        );
        fireEvent.change(textarea, { target: { value: "   " } });
        const save = screen
            .getByText(t("tabular.reviewSaveCorrection"))
            .closest("button") as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        expect(onReview).not.toHaveBeenCalled();
    });

    it("pokazuje stan review istniejacej decyzji (re-review mozliwe)", () => {
        renderPanel(
            makeCell({
                review_action: "approved",
                reviewed_at: "2026-07-04T10:00:00Z",
            }),
        );
        expect(
            screen.getAllByText((content) =>
                content.startsWith(t("tabular.reviewStatusApproved")),
            ).length,
        ).toBeGreaterThan(0);
        // akcje nadal dostepne - re-review nadpisuje (ADR-0126)
        expect(screen.getByText(t("tabular.reviewApprove"))).toBeTruthy();
    });
});
