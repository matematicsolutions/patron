import { describe, it, expect } from "vitest";
import { BUILTIN_WORKFLOWS } from "./builtinWorkflows";

describe("BUILTIN_WORKFLOWS", () => {
    it("ma unikalne id i niepuste prompt_md", () => {
        const ids = BUILTIN_WORKFLOWS.map((w) => w.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const w of BUILTIN_WORKFLOWS) {
            expect(w.title.trim().length).toBeGreaterThan(0);
            expect(w.prompt_md.trim().length).toBeGreaterThan(0);
        }
    });

    it("zawiera workflow 'Analiza akt' (6-punktowy, karne) - audyt Propozycja #7", () => {
        const wf = BUILTIN_WORKFLOWS.find(
            (w) => w.id === "builtin-analiza-akt-karne",
        );
        expect(wf).toBeTruthy();
        const md = wf!.prompt_md;
        // 6 sekcji + dyscyplina cytatu + dostarczenie inline.
        for (const marker of [
            "1. **Zarzut**",
            "2. **Dowody**",
            "3. **Wyrok I instancji**",
            "4. **Apelacja**",
            "5. **Wyrok II instancji**",
            "6. **Wskazania",
        ]) {
            expect(md).toContain(marker);
        }
        expect(md).toMatch(/str\. N|strona/);
        expect(md).toMatch(/art\. 201|art\. 7|art\. 438/);
        // nie zmyslaj + draft do redakcji (governance).
        expect(md).toMatch(/brak w aktach/i);
    });
});
