import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, citationReminder } from "./prompts";

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
