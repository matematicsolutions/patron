// D-13: Wbudowany workflow "Analiza akt" dla spraw karnych (builtin-analiza-akt-karne,
// backend/src/lib/builtinWorkflows.ts:80 - jedyny polskojezyczny workflow asystenta,
// "audyt Propozycja #7", pilnowany testem backend/src/lib/builtinWorkflows.test.ts)
// NIE istnieje w liscie, z ktorej UI buduje wybor workflow
// (frontend/src/app/components/workflows/builtinWorkflows.ts - uzywana przez
// AssistantWorkflowModal.tsx:51 i WorkflowList.tsx:129-132). GET /workflows
// (backend/src/routes/workflows.ts:123-175) zwraca tylko workflow z bazy, nie wbudowane.
// Uzytkownik nie ma jak go wybrac; dostepny jest tylko, jesli model sam wywola
// list_workflows. Test backendu przechodzi, funkcja jest dla mecenasa niewidoczna.
// Oczekiwane: kazdy wbudowany workflow asystenta z backendu jest na liscie UI.
import { describe, it, expect } from "vitest";
import { BUILT_IN_WORKFLOWS } from "../src/app/components/workflows/builtinWorkflows";
import { BUILTIN_WORKFLOWS as BACKEND_BUILTINS } from "../../backend/src/lib/builtinWorkflows";

describe("D-13 wbudowane workflow backendu vs lista w UI", () => {
    it("kazdy wbudowany workflow asystenta z backendu da sie wybrac w UI", () => {
        const uiIds = new Set(BUILT_IN_WORKFLOWS.filter((w) => w.type === "assistant").map((w) => w.id));
        const missing = BACKEND_BUILTINS.map((w) => w.id).filter((id) => !uiIds.has(id));
        expect(missing).toEqual([]);
    });
});
