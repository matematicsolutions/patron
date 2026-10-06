// A-04: /draft/refine (runDefensePipeline, lib/pipeline/defense.ts:275) maskuje draft przez
// wrapInto BEZ plEntityDetector - osoby, spolki i adresy ida do modelu chmurowego jawnie
// (punkt otwarty z audytu 2026-06, nadal otwarty). Dodatkowo pole `context` od uzytkownika
// jest doklejane do promptu (withContext, defense.ts:133-139) bez zadnego maskowania,
// wiec nawet PESEL w kontekscie wychodzi jawnie.
// Oczekiwane: prompt wysylany do modelu chmurowego nie zawiera osoby po kotwicy, spolki
// z forma prawna, adresu ani PESEL-u - ani z draftu, ani z pola context.
import { describe, it, expect, afterEach } from "vitest";
import { runDefensePipeline } from "../src/lib/pipeline/defense";

const PESEL = "85071202931"; // syntetyczny, poprawna suma kontrolna

function capturingLlm() {
    const prompts: string[] = [];
    const llm = async (p: { systemPrompt?: string; user: string }) => {
        prompts.push(`${p.systemPrompt ?? ""}\n${p.user}`);
        return "Poprawiony draft.";
    };
    return { prompts, llm };
}

describe("A-04 /draft/refine: maskowanie niepelne", () => {
    const backup = process.env.PATRON_PSEUDONIM_EGRESS;
    afterEach(() => {
        if (backup === undefined) delete process.env.PATRON_PSEUDONIM_EGRESS;
        else process.env.PATRON_PSEUDONIM_EGRESS = backup;
    });

    it("osoba po kotwicy, spolka z forma prawna i adres z draftu nie wychodza do chmury", async () => {
        delete process.env.PATRON_PSEUDONIM_EGRESS;
        const { prompts, llm } = capturingLlm();
        await runDefensePipeline(
            "Powod Pan Jan Testowy, zam. ul. Kwiatowa 5, 00-950 Warszawa, wnosi o zasadzenie od Testbud Probny sp. z o.o. kwoty 10 000 zl.",
            { model: "openrouter/google/gemini-3-flash-preview", stages: ["recenzent"] as never },
            llm as never,
        );
        expect(prompts.length).toBeGreaterThan(0);
        const sent = prompts.join("\n");
        // Parytet z czatem (plEntityDetector). Spolka "Testbud Probny sp. z o.o." po "od"
        // nie jest lapana takze w czacie - to recall detektora (A-02), nie luka draftu;
        // sprawdzane w A-02, nie tutaj (korekta 2026-10-02 po naprawie A-04).
        expect(sent).not.toContain("Jan Testowy");
        expect(sent).not.toContain("Kwiatowa 5");
    });

    it("PESEL podany w polu context nie wychodzi do chmury", async () => {
        delete process.env.PATRON_PSEUDONIM_EGRESS;
        const { prompts, llm } = capturingLlm();
        await runDefensePipeline(
            "Wnosze o oddalenie powodztwa.",
            {
                model: "openrouter/google/gemini-3-flash-preview",
                stages: ["recenzent"] as never,
                context: `Klient: PESEL ${PESEL}`,
            },
            llm as never,
        );
        expect(prompts.join("\n")).not.toContain(PESEL);
    });
});
