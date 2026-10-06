// C-08 (warstwa UI): inbox kart zatwierdzen pokazuje komunikat tylko gdy executed=false
// (src/app/(pages)/account/approval-cards/page.tsx:61) i ignoruje pole `result`
// odpowiedzi approve, w ktorym backend oddaje errors[] pominietych zmian. Zatwierdzenie
// 2 zmian, z ktorych weszla 1, wyglada dla mecenasa jak pelny sukces (karta znika).
// Oczekiwane: czesciowe wykonanie (result.errors niepuste) jest widoczne w UI.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../src/i18n";

const { listApprovalCards, approveCard, rejectCard } = vi.hoisted(() => ({
    listApprovalCards: vi.fn(),
    approveCard: vi.fn(),
    rejectCard: vi.fn(),
}));
vi.mock("@/app/lib/patronApi", () => ({ listApprovalCards, approveCard, rejectCard }));

import ApprovalCardsPage from "../src/app/(pages)/account/approval-cards/page";

const card = {
    id: "card-1",
    user_id: "u1",
    chat_id: null,
    document_id: "doc-1",
    tool_name: "edit_document",
    tool_payload: { filename: "umowa.docx", edits: [{}, {}] },
    status: "pending",
    staged_at: "2026-09-20T10:00:00Z",
    staged_by: "u1",
    approved_at: null,
    approved_by: null,
    rejection_reason: null,
    executed_at: null,
    execution_error: null,
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
};

describe("C-08 UI: czesciowe wykonanie zatwierdzonej karty", () => {
    it("1 z 2 zmian nie weszla -> UI pokazuje, ze wykonanie bylo czesciowe", async () => {
        listApprovalCards.mockResolvedValue([card]);
        approveCard.mockResolvedValue({
            approval: { ...card, status: "approved", executed_at: "2026-09-20T10:01:00Z" },
            executed: true,
            execution_error: null,
            result: {
                document_id: "doc-1",
                applied: 1,
                errors: [{ index: 1, reason: "Nie znaleziono fragmentu do zmiany." }],
            },
        });
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.approve"));
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.approve")));
        });
        // Sanity: decyzja zaszla, karta zniknela z inboxa.
        await screen.findByText(t("approvals.empty"));
        // ZADANE: informacja o pominietej zmianie jest widoczna.
        expect(screen.queryByText(/Nie znaleziono fragmentu do zmiany/)).not.toBeNull();
    });
});
