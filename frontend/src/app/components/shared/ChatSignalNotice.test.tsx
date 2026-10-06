// ADR-0137 (aktualizacja 2026-10-06, audyt B-02): karty zatwierdzen sa
// domyslnie wlaczone, wiec akcja agenta o skutkach ubocznych czesto NIE wykonuje
// sie w turze. Czat ma to powiedziec wprost i wskazac skrzynke kart - bez tego
// uzytkownik nie dowie sie, ze cos czeka na jego decyzje.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { APPROVAL_INBOX_HREF, ChatSignalNotices, isChatSignalEvent } from "./ChatSignalNotice";
import type { AssistantEvent } from "./types";

describe("ChatSignalNotices: mutation_staged", () => {
    it("jest sygnalem czatu (renderowany poza zwijanym blokiem pracy)", () => {
        expect(isChatSignalEvent({ type: "mutation_staged", tool: "edit_document", approval_id: "a1" })).toBe(true);
    });

    it("mowi, ze akcja czeka na zatwierdzenie, i linkuje do skrzynki kart", () => {
        const events: AssistantEvent[] = [
            { type: "content", text: "Przygotowalem zmiane." },
            { type: "mutation_staged", tool: "edit_document", approval_id: "a1" },
        ];
        render(<ChatSignalNotices events={events} />);
        const notice = screen.getByTestId("chat-signal-notice");
        expect(notice.getAttribute("data-signal")).toBe("mutation_staged");
        expect(notice.textContent).toContain(t("approvals.toolEditDocument"));
        const link = screen.getByTestId("approval-inbox-link");
        expect(link.getAttribute("href")).toBe(APPROVAL_INBOX_HREF);
        expect(APPROVAL_INBOX_HREF).toBe("/account/approval-cards");
        expect(link.textContent).toBe(t("mutationStaged.openInbox"));
    });

    it("kazda wstrzymana akcja ma wlasna informacje (np. edycja + pamiec)", () => {
        render(
            <ChatSignalNotices
                events={[
                    { type: "mutation_staged", tool: "edit_document", approval_id: "a1" },
                    { type: "mutation_staged", tool: "remember", approval_id: "a2" },
                ]}
            />,
        );
        expect(screen.getAllByTestId("approval-inbox-link")).toHaveLength(2);
        expect(screen.getAllByTestId("chat-signal-notice")[1]!.textContent).toContain(
            t("approvals.toolRemember"),
        );
    });
});
