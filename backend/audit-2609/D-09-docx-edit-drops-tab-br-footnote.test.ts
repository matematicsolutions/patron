// D-09: Edycja DOCX ze sledzeniem zmian (edit_document -> applyTrackedEdits) po cichu
// USUWA z dokumentu nie-tekstowe elementy przebiegu (w:tab, w:br, w:cr,
// w:noBreakHyphen, w:footnoteReference), jesli leza w tym samym w:r co edytowany tekst.
// lib/docxTrackedChanges.ts:208-245 (flattenParagraph) zapamietuje z przebiegu tylko
// w:rPr i w:t ("other run children ... are left alone" / "left in place via their
// surrounding w:r", :192-194), a reconstructParagraph (:327-506) odbudowuje dotkniete
// przebiegi WYLACZNIE z tekstu (buildRun) - wiec tabulator/podzial linii/odwolanie do
// przypisu znikaja. Zmiana NIE jest zapisana jako w:del: mecenas nie widzi jej w
// sledzeniu zmian, "Odrzuc wszystko" jej nie cofa. Word wstawia w:tab/w:br w tym samym
// przebiegu co tekst bardzo czesto (numeracja "§ 1<TAB>", adresy z Shift+Enter).
// Wynik "changes=1, errors=[]" - cichy sukces.
// Oczekiwane: poza sledzona zmiana tresc dokumentu (w tym w:tab/w:br/w:footnoteReference)
// pozostaje nienaruszona.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { applyTrackedEdits } from "../src/lib/docxTrackedChanges";

async function docx(bodyXml: string): Promise<Buffer> {
    const z = new JSZip();
    z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
    return Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
}

async function edit(body: string): Promise<{ xml: string; changes: number; errors: unknown[] }> {
    const r = await applyTrackedEdits(await docx(body), [
        { find: "1000 zl", replace: "2000 zl", context_before: "", context_after: "." },
    ]);
    const xml = await (await JSZip.loadAsync(r.bytes)).file("word/document.xml")!.async("string");
    return { xml, changes: r.changes.length, errors: r.errors };
}

describe("D-09 edycja DOCX nie niszczy elementow spoza sledzonej zmiany", () => {
    it("tabulator w tym samym przebiegu zostaje", async () => {
        const r = await edit(`<w:p><w:r><w:t>§ 1</w:t><w:tab/><w:t>Kara umowna wynosi 1000 zl.</w:t></w:r></w:p>`);
        expect(r.changes).toBe(1);
        expect(r.xml, r.xml).toContain("<w:tab");
    });
    it("podzial linii (Shift+Enter) w tym samym przebiegu zostaje", async () => {
        const r = await edit(`<w:p><w:r><w:t>Jan Testowy</w:t><w:br/><w:t>ul. Testowa 1, kara 1000 zl.</w:t></w:r></w:p>`);
        expect(r.changes).toBe(1);
        expect(r.xml, r.xml).toContain("<w:br");
    });
    it("odwolanie do przypisu w tym samym przebiegu zostaje", async () => {
        const r = await edit(`<w:p><w:r><w:t>Zgodnie z art. 483 kc</w:t><w:footnoteReference w:id="1"/><w:t> kara wynosi 1000 zl.</w:t></w:r></w:p>`);
        expect(r.changes).toBe(1);
        expect(r.xml, r.xml).toContain("footnoteReference");
    });
});
