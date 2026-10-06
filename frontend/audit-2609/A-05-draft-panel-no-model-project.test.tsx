// A-05: Panel "Draft odpowiedzi" (DraftRefinePanel.tsx:131-136) wysyla /draft/refine bez
// `model` i bez `project_id`. Backend (backend/src/routes/draft.ts:109,118-125) bierze wtedy
// DEFAULT_MAIN_MODEL (chmurowy openrouter/google/gemini-3-flash-preview), a straznik egress
// klasyfikuje tresc jako "internal" (backend/src/lib/routing/guard.ts:51 - brak sprawy), nie jako sprawe objeta
// tajemnica. Odpowiedz z czatu prowadzonego lokalnym modelem w sprawie objetej tajemnica
// trafia wiec do chmury, a klasyfikacja sprawy nie jest w ogole sprawdzana.
// Oczekiwane: zadanie refine niesie model wybrany przez Operatora i identyfikator sprawy,
// z ktorej pochodzi tekst (backend moze wtedy zastosowac wlasciwa klasyfikacje).
// (Weryfikacja 2026-09-24: test przekazuje panelowi model i sprawe biezacej rozmowy jako
// propsy - dzis panel ich nie przyjmuje ani nie przekazuje; po poprawce test ma przejsc.)
import type React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { refineDraft } = vi.hoisted(() => ({
    refineDraft: vi.fn(async (_p: Record<string, unknown>) => ({ final: "ok", stages: [] })),
}));
vi.mock("@/app/lib/patronApi", () => ({ refineDraft }));

import { DraftRefinePanel } from "../src/app/components/assistant/DraftRefinePanel";
import { t } from "../src/i18n";

describe("A-05 panel draftu nie przekazuje modelu ani sprawy", () => {
    it("refine wysyla model i project_id", async () => {
        // Kontekst rozmowy: lokalny model Operatora + sprawa objeta tajemnica.
        const Panel = DraftRefinePanel as unknown as (p: Record<string, unknown>) => React.ReactElement;
        const { getByText } = render(
            <Panel
                open
                onClose={() => {}}
                initialText="Pan Jan Testowy wnosi o oddalenie powodztwa."
                model="ollama/llama3.3:70b"
                projectId="p-tajemnica-1"
            />,
        );
        fireEvent.click(getByText(t("draft.refine")));
        await waitFor(() => expect(refineDraft).toHaveBeenCalled());
        const payload = refineDraft.mock.calls[0]![0] as Record<string, unknown>;
        expect(payload.model).toBe("ollama/llama3.3:70b");
        expect(payload.project_id).toBe("p-tajemnica-1");
    });
});
