// "Sprawdź powołania" (ADR-0157) - widok na atrapie odpowiedzi backendu (kształt
// wyniku wg kontraktu `verify_citations` Repertorium). Sprawdzamy: nic nie idzie
// bez kliknięcia, podświetlenie siedzi na offsetach, nota "brak w korpusie to
// nie dowód" jest na ekranie, a lista wysłanych pozycji daje się podejrzeć.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import type { CitationCheckResponse } from "@/lib/citationCheck";

const checkDocumentCitations = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    checkDocumentCitations: (...a: unknown[]) => checkDocumentCitations(...a),
}));

import { CitationCheckView } from "./CitationCheckView";

const TEKST = "Pozew. Podstawa: art. 471 k.c.\nPor. wyrok SN II CKSP 1/24.";

const ODP: CitationCheckResponse = {
    status: "ok",
    filename: "pozew.docx",
    verifier: "repertorium",
    text: TEKST,
    citations: [
        {
            ref: "c1",
            kind: "provision",
            offset: TEKST.indexOf("art. 471"),
            length: "art. 471 k.c.".length,
            excerpt: "art. 471 k.c.",
            occurrences: 1,
            act_id: "eli:DU/1964/93",
            act_name: "Kodeks cywilny",
            article: "471",
            status: "no_known_changes_after_date",
            details: { act_title: "Kodeks cywilny" },
        },
        {
            ref: "c2",
            kind: "signature",
            offset: TEKST.indexOf("II CKSP"),
            length: "II CKSP 1/24".length,
            excerpt: "II CKSP 1/24",
            occurrences: 1,
            signature: "II CKSP 1/24",
            status: "not_in_corpus",
            details: { possible_typo_of: { signature: "II CSKP 1/24" } },
        },
    ],
    withoutAct: 0,
    windows: 1,
    sent: [
        [
            { type: "provision", act_id: "eli:DU/1964/93", article: "471", ref: "c1" },
            { type: "signature", signature: "II CKSP 1/24", ref: "c2" },
        ],
    ],
    notSent: 0,
    asOf: null,
    checkedOn: "2026-09-30",
    snapshot: "pl-test",
    serverNotes: [],
    failedCalls: 0,
};

describe("CitationCheckView", () => {
    beforeEach(() => {
        checkDocumentCitations.mockReset();
        checkDocumentCitations.mockResolvedValue(ODP);
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("nic nie wychodzi bez kliknięcia Sprawdź", () => {
        render(<CitationCheckView documentId="d1" onBack={() => {}} />);
        expect(checkDocumentCitations).not.toHaveBeenCalled();
    });

    it("podświetla powołania na offsetach i pokazuje stan oraz podpowiedź literówki", async () => {
        const { container } = render(<CitationCheckView documentId="d1" onBack={() => {}} />);
        fireEvent.click(screen.getByText(t("citationCheck.run")));
        await waitFor(() => expect(container.querySelectorAll("mark")).toHaveLength(2));
        expect(checkDocumentCitations).toHaveBeenCalledWith("d1", null);
        const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
        expect(marks).toEqual(["art. 471 k.c.", "II CKSP 1/24"]);
        expect(screen.getAllByText(t("citationCheck.status.not_in_corpus")).length).toBeGreaterThan(0);
        expect(screen.getByText(/II CSKP 1\/24/)).toBeTruthy();
        // Nota: brak w korpusie to nie dowód nieistnienia.
        expect(screen.getByText(t("citationCheck.notInCorpusNote"))).toBeTruthy();
    });

    it("pokazuje dokładnie to, co wysłano - bez tekstu pisma", async () => {
        render(<CitationCheckView documentId="d1" onBack={() => {}} />);
        fireEvent.click(screen.getByText(t("citationCheck.run")));
        await waitFor(() => screen.getByText(t("citationCheck.privacyShowSent")));
        fireEvent.click(screen.getByText(t("citationCheck.privacyShowSent")));
        const pre = screen.getByTestId("citation-check-sent");
        expect(pre.textContent).toContain("eli:DU/1964/93");
        expect(pre.textContent).not.toContain("Pozew");
    });

    it("data stanu prawnego trafia do wywołania tylko, gdy ją podano", async () => {
        const { container } = render(<CitationCheckView documentId="d1" onBack={() => {}} />);
        fireEvent.change(container.querySelector('input[type="date"]')!, {
            target: { value: "2024-01-15" },
        });
        fireEvent.click(screen.getByText(t("citationCheck.run")));
        await waitFor(() => expect(checkDocumentCitations).toHaveBeenCalledWith("d1", "2024-01-15"));
    });

    it("bez konektora: nota wprost, że powołań NIE sprawdzono", async () => {
        checkDocumentCitations.mockResolvedValue({ ...ODP, status: "not_configured", sent: [] });
        render(<CitationCheckView documentId="d1" onBack={() => {}} />);
        fireEvent.click(screen.getByText(t("citationCheck.run")));
        await waitFor(() => screen.getByText(t("citationCheck.statusNotConfigured")));
        expect(screen.queryByText(t("citationCheck.privacyShowSent"))).toBeNull();
    });
});
