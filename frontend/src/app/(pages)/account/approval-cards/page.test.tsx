// Testy inboxa kart zatwierdzenia mutacji (ADR-0137, human-in-the-loop write
// staging) - powierzchnia demo "czlowiek zatwierdza zapis agenta". Siatka na
// regresje governance: approve/reject ida do API z ID karty (reject z powodem, gdy
// wpisany), karta znika po decyzji, blad WYKONANIA po zatwierdzeniu nie jest cichy
// (decyzja zaszla - komunikat), blad API decyzji zostawia karte w inboxie.
// patronApi zamockowane - zero sieci.
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { t } from "@/i18n";
import type { ApprovalCard } from "@/app/lib/patronApi";

const listApprovalCards = vi.fn();
const approveCard = vi.fn();
const rejectCard = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    listApprovalCards: (...a: unknown[]) => listApprovalCards(...a),
    approveCard: (...a: unknown[]) => approveCard(...a),
    rejectCard: (...a: unknown[]) => rejectCard(...a),
}));

import ApprovalCardsPage from "./page";

function card(over: Partial<ApprovalCard> = {}): ApprovalCard {
    return {
        id: "card-1",
        user_id: "u1",
        chat_id: "chat-1",
        document_id: "doc-1",
        tool_name: "edit_document",
        tool_payload: { filename: "umowa-najmu.docx", edits: [] },
        status: "pending",
        staged_at: "2026-08-18T10:00:00Z",
        staged_by: "agent",
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
        executed_at: null,
        execution_error: null,
        ...over,
    } as ApprovalCard;
}

beforeEach(() => {
    listApprovalCards.mockReset();
    approveCard.mockReset();
    rejectCard.mockReset();
});

describe("ApprovalCardsPage - inbox zatwierdzen (ADR-0137)", () => {
    it("renderuje karte: etykieta narzedzia, nazwa dokumentu, przyciski approve/reject", async () => {
        listApprovalCards.mockResolvedValue([card()]);
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.toolEditDocument"));
        expect(screen.getByText("umowa-najmu.docx")).toBeTruthy();
        expect(screen.getByText(t("approvals.approve"))).toBeTruthy();
        expect(screen.getByText(t("approvals.reject"))).toBeTruthy();
    });

    it("approve: wola API z id karty, karta znika, brak komunikatu bledu", async () => {
        listApprovalCards.mockResolvedValue([card({ id: "c-approve" })]);
        approveCard.mockResolvedValue({ approval: card({ id: "c-approve", status: "approved" }), executed: true });
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.approve"));
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.approve")));
        });
        expect(approveCard).toHaveBeenCalledWith("c-approve");
        await screen.findByText(t("approvals.empty"));
        expect(screen.queryByText(t("approvals.executionErrorNote"), { exact: false })).toBeNull();
    });

    it("approve z bledem WYKONANIA: karta znika (decyzja zaszla), ale komunikat NIE jest cichy", async () => {
        listApprovalCards.mockResolvedValue([card()]);
        approveCard.mockResolvedValue({
            approval: card({ status: "approved" }),
            executed: false,
            execution_error: "docx locked by another process",
        });
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.approve"));
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.approve")));
        });
        await screen.findByText(t("approvals.empty"));
        expect(screen.getByText(/docx locked by another process/)).toBeTruthy();
    });

    it("reject: wpisany powod idzie do API; pusty powod = undefined", async () => {
        listApprovalCards.mockResolvedValue([card({ id: "c-r1" })]);
        rejectCard.mockResolvedValue({ approval: card({ id: "c-r1", status: "rejected" }) });
        const { unmount } = render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.reject"));
        fireEvent.change(screen.getByPlaceholderText(t("approvals.rejectReasonPlaceholder")), {
            target: { value: "  za szeroka zmiana  " },
        });
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.reject")));
        });
        expect(rejectCard).toHaveBeenCalledWith("c-r1", "za szeroka zmiana");
        await screen.findByText(t("approvals.empty"));
        unmount();

        listApprovalCards.mockResolvedValue([card({ id: "c-r2" })]);
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.reject"));
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.reject")));
        });
        expect(rejectCard).toHaveBeenLastCalledWith("c-r2", undefined);
    });

    it("blad API decyzji: komunikat, karta ZOSTAJE w inboxie", async () => {
        listApprovalCards.mockResolvedValue([card()]);
        approveCard.mockRejectedValue(new Error("500"));
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.approve"));
        await act(async () => {
            fireEvent.click(screen.getByText(t("approvals.approve")));
        });
        await screen.findByText(t("approvals.actionError"));
        await waitFor(() => expect(screen.getByText("umowa-najmu.docx")).toBeTruthy());
    });

    it("blad ladowania -> loadError; pusta lista -> empty", async () => {
        listApprovalCards.mockRejectedValueOnce(new Error("down"));
        const { unmount } = render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.loadError"));
        unmount();
        listApprovalCards.mockResolvedValueOnce([]);
        render(<ApprovalCardsPage />);
        await screen.findByText(t("approvals.empty"));
    });
});
