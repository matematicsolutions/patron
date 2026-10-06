// Straznik parytetu: wbudowane workflow asystenta backendu <-> lista w UI.
//
// Audyt 2026-09, D-13: backend (backend/src/lib/builtinWorkflows.ts) seeduje
// wbudowane workflow do WorkflowStore czatu, ale UI buduje wybor z WLASNEJ kopii
// (BUILT_IN_WORKFLOWS - AssistantWorkflowModal, WorkflowList, strona workflow).
// GET /workflows zwraca tylko workflow z bazy. "Analiza akt (6-punktowa, karne)"
// istniala wiec tylko w backendzie: test backendu byl zielony, a mecenas nie mial
// jak jej wybrac. Kopia zostaje (lista UI niesie tez workflow tabelaryczne, ktorych
// backend nie zna), wiec pilnujemy pelnej relacji, nie samej obecnosci:
//   - kazdy wbudowany workflow backendu jest w UI jako "assistant",
//   - tytul i prompt_md sa identyczne (UI pokazuje prompt, ktory backend WYKONA -
//     czat wysyla tylko id, tresc bierze backend),
//   - kazdy wbudowany workflow asystenta w UI istnieje w backendzie (inaczej
//     wybor w UI daje id, ktorego model nie znajdzie w WorkflowStore).
import { describe, expect, it } from "vitest";
import { BUILT_IN_WORKFLOWS } from "./builtinWorkflows";
import { BUILTIN_WORKFLOWS as BACKEND_BUILTINS } from "../../../../../backend/src/lib/builtinWorkflows";

const uiAssistant = BUILT_IN_WORKFLOWS.filter((w) => w.type === "assistant");

describe("wbudowane workflow: backend <-> UI", () => {
    it("mianownik: obie listy niepuste, backend zawiera workflow karny (ADR-0130)", () => {
        expect(BACKEND_BUILTINS.length).toBeGreaterThan(0);
        expect(uiAssistant.length).toBeGreaterThan(0);
        expect(BACKEND_BUILTINS.map((w) => w.id)).toContain("builtin-analiza-akt-karne");
    });

    it("kazdy wbudowany workflow backendu da sie wybrac w UI jako workflow asystenta", () => {
        const uiIds = new Set(uiAssistant.map((w) => w.id));
        const missing = BACKEND_BUILTINS.map((w) => w.id).filter((id) => !uiIds.has(id));
        expect(missing).toEqual([]);
    });

    it("kazdy wbudowany workflow asystenta w UI istnieje w backendzie", () => {
        const backendIds = new Set(BACKEND_BUILTINS.map((w) => w.id));
        const orphans = uiAssistant.map((w) => w.id).filter((id) => !backendIds.has(id));
        expect(orphans).toEqual([]);
    });

    it("tytul i prompt_md w UI == backend (UI pokazuje to, co zostanie wykonane)", () => {
        const drift = BACKEND_BUILTINS.flatMap((b) => {
            const ui = uiAssistant.find((w) => w.id === b.id);
            if (!ui) return [];
            const out: string[] = [];
            if (ui.title !== b.title) out.push(`${b.id}: title`);
            if (ui.prompt_md !== b.prompt_md) out.push(`${b.id}: prompt_md`);
            return out;
        });
        expect(drift).toEqual([]);
    });

    it("identyfikatory w liscie UI sa unikalne", () => {
        const ids = BUILT_IN_WORKFLOWS.map((w) => w.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
