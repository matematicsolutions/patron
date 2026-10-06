// R-CC-04 (skutek w przegladarce): backend przepuszcza `coverage_note` serwera bez
// sprawdzenia typu (backend/src/lib/citation-check/index.ts). Nota-obiekt w
// `serverNotes` wywraca raport (buildReportHtml -> esc(n) -> n.replace is not a
// function) i caly widok (CitationCheckView: `<p>{n}</p>`, React odrzuca obiekt
// jako dziecko). Typ `serverNotes: string[]` w lib/citationCheck.ts jest deklaracja,
// nie walidacja odpowiedzi.
import { Component, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { buildReportHtml, type CheckedResponse } from "@/lib/citationCheck";

const checkDocumentCitations = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    checkDocumentCitations: (...a: unknown[]) => checkDocumentCitations(...a),
}));

import { CitationCheckView } from "@/app/components/shared/CitationCheckView";

let zlapany: unknown = null;
class Granica extends Component<{ children: ReactNode }, { padl: boolean }> {
    state = { padl: false };
    static getDerivedStateFromError() {
        return { padl: true };
    }
    componentDidCatch(e: unknown) {
        zlapany = e;
    }
    render() {
        return this.state.padl ? null : this.props.children;
    }
}

const ODP = {
    status: "ok",
    filename: "pismo.docx",
    verifier: "repertorium",
    text: "Podstawa: art. 471 k.c.",
    citations: [],
    withoutAct: 0,
    windows: 1,
    sent: [],
    notSent: 0,
    asOf: null,
    checkedOn: null,
    snapshot: null,
    serverNotes: [{ html: "<b>x</b>" } as unknown as string],
    failedCalls: 0,
} satisfies CheckedResponse;

describe("R-CC-04 nota serwera-obiekt wywraca raport i widok", () => {
    it("raport HTML powstaje", () => {
        let blad: unknown = null;
        try {
            buildReportHtml(ODP, new Date("2026-10-02T00:00:00Z"));
        } catch (e) {
            blad = e;
        }
        expect(blad).toBeNull();
    });

    it("widok renderuje sie po odpowiedzi", async () => {
        checkDocumentCitations.mockResolvedValue(ODP);
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        render(
            <Granica>
                <CitationCheckView documentId="d1" onBack={() => {}} />
            </Granica>,
        );
        fireEvent.click(screen.getByText(t("citationCheck.run")));
        await waitFor(() => expect(checkDocumentCitations).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 50));
        errSpy.mockRestore();
        expect(zlapany).toBeNull();
        expect(screen.queryByText(t("citationCheck.notInCorpusNote"))).not.toBeNull();
    });
});
