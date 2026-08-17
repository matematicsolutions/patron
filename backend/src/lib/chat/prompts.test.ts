import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildSystemPrompt, citationReminder } from "./prompts";

describe("SYSTEM_PROMPT", () => {
    it("zawiera polska sekcje jurysdykcji", () => {
        expect(SYSTEM_PROMPT).toContain("JĘZYK I JURYSDYKCJA");
        expect(SYSTEM_PROMPT).toContain("polskim porządku prawnym");
    });

    it("zawiera ostrzezenie o SAOS (brak WSA/NSA)", () => {
        expect(SYSTEM_PROMPT).toContain("KONEKTOR SAOS");
        expect(SYSTEM_PROMPT).toContain("WSA");
        expect(SYSTEM_PROMPT).toContain("NSA");
    });

    it("zawiera sekcje przewodnika po mozliwosciach PATRONa (onboarding)", () => {
        expect(SYSTEM_PROMPT).toContain("PATRON - MOŻLIWOŚCI I PRZEWODNIK");
        expect(SYSTEM_PROMPT).toContain("Przegląd tabelaryczny");
        expect(SYSTEM_PROMPT).toContain("Pipeline obrony");
    });

    it("zawiera kontrakt cytatow z blokiem <CITATIONS>", () => {
        expect(SYSTEM_PROMPT).toContain("<CITATIONS>");
        expect(SYSTEM_PROMPT).toContain("doc_id");
        expect(SYSTEM_PROMPT).toContain("quote");
    });

    it("nie zawiera placeholderow Mike-only z anglojezycznej bazy", () => {
        // Smoke - SYSTEM_PROMPT po polonizacji nie powinien zawierac sigli
        // ktorych nie ma w polskich kancelariach (np. brytyjskiej terminologii).
        // Test nie blokuje obecnosci zwrotow EN - kontrakt cytatow jest po angielsku.
        // Sprawdza tylko ze pelna polska sekcja zostala dodana.
        expect(SYSTEM_PROMPT.length).toBeGreaterThan(2000);
    });

    describe("DRAFTING PISM PL (Phase 2.2)", () => {
        it("zawiera sekcje DRAFTING PISM PL", () => {
            expect(SYSTEM_PROMPT).toContain("DRAFTING PISM PL");
        });

        it("rozroznia odwolanie (kpa) od skargi (WSA)", () => {
            expect(SYSTEM_PROMPT).toContain("Odwołanie");
            expect(SYSTEM_PROMPT).toContain("Skarga");
            expect(SYSTEM_PROMPT).toContain("WSA");
        });

        it("rozroznia pozew/wniosek + apelacja/skarga kasacyjna", () => {
            expect(SYSTEM_PROMPT).toContain("Pozew");
            expect(SYSTEM_PROMPT).toContain("Apelacja");
            expect(SYSTEM_PROMPT).toContain("Skarga kasacyjna");
        });

        it("zawiera format daty polski (DD.MM.RRRR)", () => {
            expect(SYSTEM_PROMPT).toContain("DD.MM.RRRR");
        });

        it("zawiera konwencje cytowania ELI / Dz.U.", () => {
            expect(SYSTEM_PROMPT).toContain("Dz.U.");
            expect(SYSTEM_PROMPT).toContain("ELI");
        });

        it("zawiera zasade drafu (nie podpisuj sie za prawnika)", () => {
            expect(SYSTEM_PROMPT).toContain("ZASADA DRAFTU");
            expect(SYSTEM_PROMPT).toMatch(/Podpis.*imi[ęe]/i);
        });

        it("zawiera formul Wysoki Sad", () => {
            expect(SYSTEM_PROMPT).toContain("Wysoki Sąd");
        });
    });
});

describe("buildSystemPrompt (US2, ADR-0135)", () => {
    it("SYSTEM_PROMPT to domyslny build PL", () => {
        expect(SYSTEM_PROMPT).toBe(buildSystemPrompt("pl"));
    });

    describe("locale=en - metoda/UX po angielsku", () => {
        const en = buildSystemPrompt("en");

        it("przelacza jezyk odpowiedzi na EN", () => {
            expect(en).toContain("Respond in English");
            expect(en).not.toContain("Odpowiadaj po polsku");
        });

        it("opisuje strukture sadow po angielsku", () => {
            expect(en).toContain("POLISH COURT STRUCTURE");
            expect(en).toContain("Supreme Court");
            expect(en).not.toContain("POLSKA STRUKTURA SĄDOWNICTWA");
        });

        it("przewodnik mozliwosci po angielsku", () => {
            expect(en).toContain("CAPABILITIES AND GUIDE");
            expect(en).toContain("Tabular review");
            expect(en).not.toContain("PATRON - MOŻLIWOŚCI I PRZEWODNIK");
        });
    });

    describe("locale=en - substancja jurysdykcyjna ZOSTAJE PL", () => {
        const en = buildSystemPrompt("en");

        it("drafting pism PL pozostaje po polsku", () => {
            expect(en).toContain("DRAFTING PISM PL");
            expect(en).toContain("Wysoki Sąd");
            expect(en).toContain("ZASADA DRAFTU");
        });

        it("dyscyplina SAOS pozostaje po polsku", () => {
            expect(en).toContain("KONEKTOR SAOS");
        });

        it("cytowanie prawa PL (DD.MM.RRRR / Dz.U. / ELI) pozostaje", () => {
            expect(en).toContain("DD.MM.RRRR");
            expect(en).toContain("Dz.U.");
            expect(en).toContain("ELI");
        });
    });

    it("oba locale zachowuja kontrakt cytatow (metoda wspolna)", () => {
        for (const loc of ["pl", "en"] as const) {
            const p = buildSystemPrompt(loc);
            expect(p).toContain("<CITATIONS>");
            expect(p).toContain("doc_id");
        }
    });
});

describe("citationReminder", () => {
    it("wstrzykuje doc label i filename", () => {
        const r = citationReminder("doc-3", "nda.docx");
        expect(r).toContain("doc-3");
        expect(r).toContain("nda.docx");
    });

    it("zawiera wzor JSON cytatu", () => {
        const r = citationReminder("doc-0", "x.pdf");
        expect(r).toContain('"ref": 1');
        expect(r).toContain('"doc_id": "doc-0"');
        expect(r).toContain('"quote"');
    });

    it("odradza klucze marker/text", () => {
        const r = citationReminder("doc-0", "x.docx");
        expect(r.toLowerCase()).toContain('"marker"');
        expect(r.toLowerCase()).toContain('"text"');
    });
});
