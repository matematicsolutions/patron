// Testy emisji komentarzy DOCX (ADR-0077). Domyka petle zapis->odczyt:
// applyDocxComments (zapis) -> parseComments (odczyt, docxRoundtrip.ts).
// Plus asserty plumbingu OOXML (markery, [Content_Types].xml, rels) i bramki
// nakladania na istniejace tracked changes.

import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { applyDocxComments } from "./docxComments";
import { applyTrackedEdits } from "./docxTrackedChanges";
import { parseComments, parseDocxRoundtrip } from "./docxRoundtrip";

async function makeDocx(...paragraphs: string[]): Promise<Buffer> {
    const d = new Document({
        sections: [{ children: paragraphs.map((t) => new Paragraph(t)) }],
    });
    return Packer.toBuffer(d);
}

async function readEntry(buf: Buffer, path: string): Promise<string> {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file(path) ?? zip.file(path.replace(/\//g, "\\"));
    return f ? f.async("string") : "";
}

const ABUSIVE = "Sprzedawca moze jednostronnie zmienic cene w dowolnym czasie.";

describe("applyDocxComments - round-trip przez parseComments", () => {
    it("dokleja komentarz do zakotwiczonego fragmentu i odczytuje go z powrotem", async () => {
        const base = await makeDocx(`Par. 5. ${ABUSIVE} Pozostale postanowienia.`);
        const res = await applyDocxComments(
            base,
            [
                {
                    find: "jednostronnie zmienic cene",
                    context_before: "moze ",
                    context_after: " w dowolnym",
                    text: "Rozwaz czy ten zapis nie jest abuzywny (art. 385(3) pkt 20 KC).",
                },
            ],
            { author: "PATRON", initials: "PAT" },
        );

        expect(res.errors).toEqual([]);
        expect(res.comments.length).toBe(1);
        expect(res.comments[0].anchoredText).toBe("jednostronnie zmienic cene");

        const parsed = await parseComments(res.bytes);
        expect(parsed.length).toBe(1);
        expect(parsed[0].author).toBe("PATRON");
        expect(parsed[0].text).toContain("abuzywny");
    });

    it("emituje pelny plumbing OOXML (markery + content-type + rels)", async () => {
        const base = await makeDocx(`Tekst. ${ABUSIVE}`);
        const res = await applyDocxComments(base, [
            {
                find: "jednostronnie",
                context_before: "moze ",
                context_after: " zmienic",
                text: "Flaga recenzenta.",
            },
        ]);
        const doc = await readEntry(res.bytes, "word/document.xml");
        const ct = await readEntry(res.bytes, "[Content_Types].xml");
        const rels = await readEntry(res.bytes, "word/_rels/document.xml.rels");

        expect(doc).toContain("w:commentRangeStart");
        expect(doc).toContain("w:commentRangeEnd");
        expect(doc).toContain("w:commentReference");
        expect(ct).toContain("wordprocessingml.comments+xml");
        expect(rels).toContain("/officeDocument/2006/relationships/comments");
    });

    it("komentarz-instrukcja [PATRON: ...] domyka sie z detektorem instrukcji", async () => {
        const base = await makeDocx("Wstep pisma procesowego.");
        const res = await applyDocxComments(base, [
            {
                find: "Wstep",
                context_before: "",
                context_after: " pisma",
                text: "[PATRON: skroc wstep do dwoch zdan]",
            },
        ]);
        expect(res.comments.length).toBe(1);
        const r = await parseDocxRoundtrip(res.bytes);
        expect(r.instructions).toContain("skroc wstep do dwoch zdan");
    });

    it("zachowuje wieloliniowy tekst komentarza", async () => {
        const base = await makeDocx("Klauzula poufnosci.");
        const res = await applyDocxComments(base, [
            {
                find: "poufnosci",
                context_before: "Klauzula ",
                context_after: "",
                text: "Linia 1.\nLinia 2.",
            },
        ]);
        const parsed = await parseComments(res.bytes);
        expect(parsed[0].text).toContain("Linia 1.");
        expect(parsed[0].text).toContain("Linia 2.");
    });
});

describe("applyDocxComments - wiele komentarzy i unikalne id", () => {
    it("dokleja dwa komentarze z roznymi w:id", async () => {
        const base = await makeDocx(
            "Strony zawieraja umowe.",
            "Zaplata nastapi w terminie 7 dni.",
        );
        const res = await applyDocxComments(base, [
            { find: "umowe", context_before: "zawieraja ", context_after: "", text: "Jaka umowa?" },
            { find: "7 dni", context_before: "terminie ", context_after: "", text: "Za krotki termin." },
        ]);
        expect(res.errors).toEqual([]);
        expect(res.comments.length).toBe(2);
        const ids = new Set(res.comments.map((c) => c.id));
        expect(ids.size).toBe(2);
        expect((await parseComments(res.bytes)).length).toBe(2);
    });
});

describe("applyDocxComments - bledy kotwiczenia", () => {
    it("nieznaleziony fragment -> blad, bajty bez zmian", async () => {
        const base = await makeDocx("Krotki tekst.");
        const res = await applyDocxComments(base, [
            { find: "nieistniejaca fraza", context_before: "", context_after: "", text: "x" },
        ]);
        expect(res.comments.length).toBe(0);
        expect(res.errors.length).toBe(1);
        expect(res.bytes).toBe(base); // ten sam Buffer - nic nie zapisano
        expect((await parseComments(res.bytes)).length).toBe(0);
    });

    it("niejednoznaczna kotwica bez kontekstu -> blad; z kontekstem -> sukces", async () => {
        const base = await makeDocx("cena rosnie, cena spada, cena stoi.");
        const ambiguous = await applyDocxComments(base, [
            { find: "cena", context_before: "", context_after: "", text: "ktora?" },
        ]);
        expect(ambiguous.comments.length).toBe(0);
        expect(ambiguous.errors[0].reason.toLowerCase()).toContain("ambiguous");

        const ok = await applyDocxComments(base, [
            { find: "cena", context_before: "", context_after: " rosnie", text: "ta pierwsza" },
        ]);
        expect(ok.comments.length).toBe(1);
    });

    it("pusty komentarz -> blad", async () => {
        const base = await makeDocx("Tekst.");
        const res = await applyDocxComments(base, [
            { find: "Tekst", context_before: "", context_after: "", text: "   " },
        ]);
        expect(res.comments.length).toBe(0);
        expect(res.errors[0].reason).toContain("empty");
    });
});

describe("applyDocxComments - wspolistnienie z tracked changes", () => {
    it("komentarz na CZYSTYM fragmencie dokumentu, ktory ma tracked changes gdzie indziej", async () => {
        const base = await makeDocx(
            "Powodka zada kwoty 5000 zl.",
            "Pozwana wnosi o oddalenie.",
        );
        const edited = await applyTrackedEdits(
            base,
            [{ find: "5000", replace: "8000", context_before: "kwoty ", context_after: " zl" }],
            { author: "PATRON" },
        );
        const res = await applyDocxComments(edited.bytes, [
            { find: "oddalenie", context_before: "o ", context_after: "", text: "Brak uzasadnienia." },
        ]);
        expect(res.comments.length).toBe(1);
        // tracked change nadal obecny
        const doc = await readEntry(res.bytes, "word/document.xml");
        expect(doc).toContain("w:del");
        expect(doc).toContain("w:ins");
        expect(doc).toContain("w:commentRangeStart");
    });

    it("komentarz NACHODZACY na istniejacy tracked change -> pominiety z bledem", async () => {
        const base = await makeDocx("Powodka zada kwoty 5000 zl tytulem odszkodowania.");
        const edited = await applyTrackedEdits(
            base,
            [{ find: "5000", replace: "8000", context_before: "kwoty ", context_after: " zl" }],
            { author: "PATRON" },
        );
        // Widok zaakceptowany pokazuje "8000" (ins "8" + plain "000"); kotwica
        // na "8000" obejmuje wewnetrzny run w:ins -> bramka nakladania.
        const res = await applyDocxComments(edited.bytes, [
            { find: "8000", context_before: "kwoty ", context_after: " zl", text: "Sprawdz kwote." },
        ]);
        expect(res.comments.length).toBe(0);
        expect(res.errors.length).toBe(1);
        expect(res.errors[0].reason).toContain("overlaps");
    });
});

describe("applyDocxComments - rozszerzanie istniejacych komentarzy", () => {
    it("dokleja do dokumentu, ktory juz ma komentarz; id nie koliduja; plumbing nie dubluje", async () => {
        const base = await makeDocx(`Par. 1. ${ABUSIVE}`);
        const first = await applyDocxComments(base, [
            { find: "Par. 1.", context_before: "", context_after: "", text: "Pierwszy." },
        ]);
        const second = await applyDocxComments(first.bytes, [
            { find: "jednostronnie", context_before: "moze ", context_after: " zmienic", text: "Drugi." },
        ]);
        const parsed = await parseComments(second.bytes);
        expect(parsed.length).toBe(2);
        const ids = new Set(parsed.map((c) => c.id));
        expect(ids.size).toBe(2);

        // Content-type override i relationship wystepuja dokladnie raz.
        const ct = await readEntry(second.bytes, "[Content_Types].xml");
        const rels = await readEntry(second.bytes, "word/_rels/document.xml.rels");
        const ctCount = ct.split("wordprocessingml.comments+xml").length - 1;
        const relCount = rels.split("/officeDocument/2006/relationships/comments").length - 1;
        expect(ctCount).toBe(1);
        expect(relCount).toBe(1);
    });
});
