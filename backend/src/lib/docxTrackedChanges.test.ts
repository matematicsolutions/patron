// Testy niezmiennika edycji DOCX (audyt 2026-09, D-09): edycja ze sledzeniem
// zmian NIGDY nie usuwa po cichu niczego, czego nie obejmuje w:del.
//
// Elementy przebiegu niebedace tekstem (w:tab, w:br, w:cr, w:noBreakHyphen,
// w:sym, w:footnoteReference, w:fldChar/w:instrText ...) i elementy akapitu
// (zakladki, pre-istniejace w:ins/w:del) maja zostac na swoich pozycjach.
// Dopasowanie, ktore przecina element, ktorego w:del nie przeniesie bezpiecznie
// (przypis, pole, ...), jest ODRZUCANE jawnym bledem, a dokument zostaje
// nietkniety. Proste elementy ukladu (tab, br) przecinane przez edycje
// wchodza do w:del - widac je w sledzeniu zmian, "Odrzuc" je przywraca.
//
// Kazdy wynik jest walidowany jako XML (fast-xml-parser XMLValidator), a
// tresc porownywana w dwoch widokach: "odrzucony" (wszystkie w:ins precz,
// w:del jako tekst) musi byc identyczny z oryginalem - to jest dowod, ze nic
// nie zniknelo poza sledzeniem zmian.

import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { applyDocxComments } from "./docxComments";
import { applyTrackedEdits, resolveTrackedChange, type EditInput } from "./docxTrackedChanges";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function docx(bodyXml: string): Promise<Buffer> {
    const z = new JSZip();
    z.file(
        "[Content_Types].xml",
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    z.file(
        "_rels/.rels",
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    z.file(
        "word/document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    );
    return Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
}

async function documentXml(bytes: Buffer): Promise<string> {
    return (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
}

type N = Record<string, unknown>;
const nameOf = (n: N): string | null => Object.keys(n).find((k) => k !== ":@" && k !== "#text") ?? null;
const kidsOf = (n: N): N[] => {
    const k = nameOf(n);
    return k && Array.isArray(n[k]) ? (n[k] as N[]) : [];
};

/**
 * Sekwencja tresci akapitow w danym widoku. Tekst doslownie, kazdy inny
 * element jako [nazwa]. "accepted": w:ins jako tresc, w:del pomijany;
 * "rejected": w:ins pomijany, w:del jako tresc (w:delText = tekst).
 */
function view(xml: string, mode: "accepted" | "rejected"): string {
    const tree = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        trimValues: false,
        parseTagValue: false,
    }).parse(xml) as N[];
    const out: string[] = [];
    const walkRunChildren = (run: N) => {
        for (const c of kidsOf(run)) {
            const n = nameOf(c);
            if (!n || n === "w:rPr") continue;
            if (n === "w:t" || n === "w:delText") {
                out.push(kidsOf(c).map((t) => String(t["#text"] ?? "")).join(""));
            } else {
                out.push(`[${n}]`);
            }
        }
    };
    const walkInline = (nodes: N[]) => {
        for (const c of nodes) {
            const n = nameOf(c);
            if (!n || n === "w:pPr") continue;
            if (n === "w:r") walkRunChildren(c);
            else if (n === "w:ins") {
                if (mode === "accepted") walkInline(kidsOf(c));
            } else if (n === "w:del") {
                if (mode === "rejected") walkInline(kidsOf(c));
            } else out.push(`[${n}]`);
        }
    };
    const walk = (nodes: N[]) => {
        for (const c of nodes) {
            const n = nameOf(c);
            if (n === "w:p") {
                walkInline(kidsOf(c));
                out.push("¶");
            } else walk(kidsOf(c));
        }
    };
    walk(tree);
    return out.join("");
}

function expectValidXml(xml: string): void {
    const v = XMLValidator.validate(xml);
    expect(v, JSON.stringify(v)).toBe(true);
}

async function run(body: string, edits: EditInput[]) {
    const src = await docx(body);
    const before = await documentXml(src);
    const r = await applyTrackedEdits(src, edits);
    const xml = await documentXml(r.bytes);
    expectValidXml(xml);
    return { r, xml, before };
}

const e = (find: string, replace: string, context_before = "", context_after = ""): EditInput => ({
    find,
    replace,
    context_before,
    context_after,
});

describe("D-09: elementy przebiegu obok edycji zostaja na swoich miejscach", () => {
    it("tabulator przed edycja w tym samym przebiegu", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>§ 1</w:t><w:tab/><w:t>Kara umowna wynosi 1000 zl.</w:t></w:r></w:p>`,
            [e("1000 zl", "2000 zl", "wynosi ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(r.changes).toHaveLength(1);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("§ 1[w:tab]Kara umowna wynosi 2000 zl.¶");
    });

    it("podzial linii (w:br) i w:cr po edycji w tym samym przebiegu", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Kara 1000 zl.</w:t><w:br/><w:t>ul. Testowa 1</w:t><w:cr/><w:t>00-001 Miasto</w:t></w:r></w:p>`,
            [e("1000 zl", "2000 zl", "Kara ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Kara 2000 zl.[w:br]ul. Testowa 1[w:cr]00-001 Miasto¶");
    });

    it("odwolanie do przypisu w tym samym przebiegu", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Zgodnie z art. 483 kc</w:t><w:footnoteReference w:id="1"/><w:t> kara wynosi 1000 zl.</w:t></w:r></w:p>`,
            [e("1000 zl", "2000 zl", "wynosi ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(xml).toContain(`<w:footnoteReference w:id="1"`);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Zgodnie z art. 483 kc[w:footnoteReference] kara wynosi 2000 zl.¶");
    });

    it("pole (w:fldChar + w:instrText) w tym samym przebiegu co edytowany tekst", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Data: </w:t><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> DATE </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>2026-01-01</w:t><w:fldChar w:fldCharType="end"/><w:t>, kwota 1000 zl.</w:t></w:r></w:p>`,
            [e("1000 zl", "2000 zl", "kwota ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe(
            "Data: [w:fldChar][w:instrText][w:fldChar]2026-01-01[w:fldChar], kwota 2000 zl.¶",
        );
        expect(xml).toContain(`w:fldCharType="begin"`);
        expect(xml).toContain(`w:fldCharType="separate"`);
        expect(xml).toContain(`w:fldCharType="end"`);
    });

    it("edycja wyniku pola (miedzy separate i end) zostaje wewnatrz pola", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Data: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2026-01-01</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>.</w:t></w:r></w:p>`,
            [e("2026-01-01", "2026-02-02", "Data: ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Data: [w:fldChar][w:instrText][w:fldChar]2026-02-02[w:fldChar].¶");
    });

    it("znak specjalny (w:sym) i twardy lacznik (w:noBreakHyphen) obok edycji", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Cena</w:t><w:sym w:font="Symbol" w:char="F0B7"/><w:t>1000 zl, art. 5</w:t><w:noBreakHyphen/><w:t>7</w:t></w:r></w:p>`,
            [e("1000 zl", "2000 zl", "", ", art")],
        );
        expect(r.errors).toEqual([]);
        expect(xml).toContain(`w:char="F0B7"`);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Cena[w:sym]2000 zl, art. 5[w:noBreakHyphen]7¶");
    });

    it("przebieg bez tekstu (sam przypis) miedzy dwiema edycjami w jednym akapicie zostaje", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Kara 1000</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r><w:r><w:t> zl brutto.</w:t></w:r></w:p>`,
            [e("1000", "2000", "Kara ", ""), e("brutto", "netto", "zl ", ".")],
        );
        expect(r.errors).toEqual([]);
        expect(r.changes).toHaveLength(2);
        expect(xml).toContain(`<w:footnoteReference w:id="2"`);
        expect(xml).toContain(`w:val="superscript"`);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Kara 2000[w:footnoteReference] zl netto.¶");
    });
});

describe("D-09: edycja przecinajaca element niebedacy tekstem", () => {
    it("przypis wewnatrz zakresu -> jawny blad, dokument nietkniety", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Zgodnie z art. 483 kc</w:t><w:footnoteReference w:id="1"/><w:t> kara wynosi 1000 zl.</w:t></w:r></w:p>`,
            // Minimalna roznica "3 kc k" -> "4 kc. K" obejmuje pozycje przypisu.
            [e("483 kc kara", "484 kc. Kara", "art. ", "")],
        );
        expect(r.changes).toEqual([]);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].reason).toMatch(/w:footnoteReference/);
        expect(xml).not.toContain("<w:del ");
        expect(view(xml, "accepted")).toBe(view(before, "accepted"));
    });

    it("pole wewnatrz zakresu -> jawny blad", async () => {
        const { r } = await run(
            `<w:p><w:r><w:t>Termin </w:t><w:fldChar w:fldCharType="begin"/><w:instrText> DATE </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>1 maja</w:t><w:fldChar w:fldCharType="end"/><w:t> roku</w:t></w:r></w:p>`,
            [e("Termin 1 maja roku", "Do 2 czerwca")],
        );
        expect(r.changes).toEqual([]);
        expect(r.errors[0].reason).toMatch(/w:fldChar/);
    });

    it("hiperlacze i pre-istniejace w:del wewnatrz zakresu -> jawny blad", async () => {
        const link = await run(
            `<w:p><w:r><w:t>Patrz </w:t></w:r><w:hyperlink w:anchor="x"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:t> oraz 1000 zl.</w:t></w:r></w:p>`,
            [e("Patrz  oraz", "Zob. tez")],
        );
        expect(link.r.changes).toEqual([]);
        expect(link.r.errors[0].reason).toMatch(/w:hyperlink/);

        const del = await run(
            `<w:p><w:r><w:t>Kara </w:t></w:r><w:del w:id="7" w:author="Inny" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>stara </w:delText></w:r></w:del><w:r><w:t>1000 zl.</w:t></w:r></w:p>`,
            [e("Kara 1000", "Grzywna 2000")],
        );
        expect(del.r.changes).toEqual([]);
        expect(del.r.errors[0].reason).toMatch(/w:del/);
        expect(del.xml).toContain(`w:author="Inny"`);
    });

    it("tabulator wewnatrz zakresu wchodzi do w:del (widoczny, odrzucenie go przywraca)", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>§ 1</w:t><w:tab/><w:t>Kara</w:t></w:r></w:p>`,
            [e("§ 1Kara", "Art. 1 Grzywna")],
        );
        expect(r.errors).toEqual([]);
        expect(xml).toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*<w:tab/);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        expect(view(xml, "accepted")).toBe("Art. 1 Grzywna¶");
        // Odrzucenie zmiany w:del przywraca tabulator.
        const ids = [r.changes[0].delId!, r.changes[0].insId!];
        const rejected = await resolveTrackedChange(r.bytes, ids, "reject");
        const rejectedXml = await documentXml(rejected.bytes);
        expectValidXml(rejectedXml);
        expect(view(rejectedXml, "accepted")).toBe(view(before, "accepted"));
    });

    it("zakladka wewnatrz zakresu wchodzi do w:del i przetrwa akceptacje", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:r><w:t>Kara </w:t></w:r><w:bookmarkStart w:id="0" w:name="kara"/><w:r><w:t>1000 zl</w:t></w:r><w:bookmarkEnd w:id="0"/><w:r><w:t>.</w:t></w:r></w:p>`,
            [e("Kara 1000 zl", "Grzywna 2000 zl")],
        );
        expect(r.errors).toEqual([]);
        expect(view(xml, "rejected")).toBe(view(before, "rejected"));
        const ids = r.changes.flatMap((c) => [c.delId, c.insId].filter((x): x is string => !!x));
        const accepted = await resolveTrackedChange(r.bytes, ids, "accept");
        const acceptedXml = await documentXml(accepted.bytes);
        expectValidXml(acceptedXml);
        expect(acceptedXml).toContain(`w:name="kara"`);
        expect(acceptedXml).toContain(`<w:bookmarkEnd w:id="0"`);
    });
});

describe("D-09: struktury akapitu w zakresie przepisywania", () => {
    it("pre-istniejacy w:ins: niedotkniete przebiegi wewnatrz nie znikaja", async () => {
        const { r, xml, before } = await run(
            `<w:p><w:ins w:id="5" w:author="Inny" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Alfa </w:t></w:r><w:r><w:t>kara 1000 zl</w:t></w:r><w:r><w:t> Omega.</w:t></w:r></w:ins></w:p>`,
            [e("1000", "2000", "kara ", " zl")],
        );
        expect(r.errors).toEqual([]);
        // Wstawka "Inny" jest przyjeta (udokumentowane), ale jej tresc zostaje.
        expect(view(xml, "accepted")).toBe("Alfa kara 2000 zl Omega.¶");
        expect(view(before, "accepted")).toBe("Alfa kara 1000 zl Omega.¶");
    });

    it("pre-istniejacy w:del miedzy dwiema edycjami zostaje nietkniety na swoim miejscu", async () => {
        const { r, xml } = await run(
            `<w:p><w:r><w:t>Kara 1000 zl </w:t></w:r><w:del w:id="7" w:author="Inny" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>brutto </w:delText></w:r></w:del><w:r><w:t>w 14 dni.</w:t></w:r></w:p>`,
            [e("1000", "2000", "Kara ", ""), e("14", "7", "w ", " dni")],
        );
        expect(r.errors).toEqual([]);
        expect(xml).toContain(`w:author="Inny"`);
        expect(view(xml, "rejected")).toBe("Kara 1000 zl brutto w 14 dni.¶");
        expect(view(xml, "accepted")).toBe("Kara 2000 zl w 7 dni.¶");
    });

    it("czysta wstawka: strona kotwicy decyduje, po ktorej stronie tabulatora", async () => {
        const body = `<w:p><w:r><w:t>§ 1</w:t><w:tab/><w:t>Kara</w:t></w:r></w:p>`;
        const left = await run(body, [e("§ 1", "§ 1a")]);
        expect(left.r.errors).toEqual([]);
        expect(view(left.xml, "accepted")).toBe("§ 1a[w:tab]Kara¶");
        const right = await run(body, [e("Kara", "Nowa Kara")]);
        expect(right.r.errors).toEqual([]);
        expect(view(right.xml, "accepted")).toBe("§ 1[w:tab]Nowa Kara¶");
    });
});

describe("D-09: tekst liczbowy w:t nie jest przepisywany", () => {
    it("w:t z samymi cyframi w NIETKNIETYM akapicie zostaje bajt w bajt", async () => {
        const { r, xml } = await run(
            `<w:p><w:r><w:t>0012</w:t></w:r><w:r><w:t>1.50</w:t></w:r><w:r><w:t>1e5</w:t></w:r></w:p><w:p><w:r><w:t>Kara 1000 zl.</w:t></w:r></w:p>`,
            [e("1000", "2000", "Kara ", " zl")],
        );
        expect(r.errors).toEqual([]);
        expect(xml).toContain("<w:t>0012</w:t>");
        expect(xml).toContain("<w:t>1.50</w:t>");
        expect(xml).toContain("<w:t>1e5</w:t>");
    });
});

describe("D-09: komentarze nie gubia elementow przebiegu", () => {
    it("komentarz na fragmencie przebiegu z tabulatorem i przypisem", async () => {
        const src = await docx(
            `<w:p><w:r><w:t>§ 1</w:t><w:tab/><w:t>Kara umowna</w:t><w:footnoteReference w:id="3"/><w:t> wynosi 1000 zl.</w:t></w:r></w:p>`,
        );
        const before = await documentXml(src);
        const res = await applyDocxComments(src, [
            { find: "Kara umowna", context_before: "", context_after: " wynosi", text: "Sprawdz wysokosc." },
        ]);
        expect(res.errors).toEqual([]);
        const xml = await documentXml(res.bytes);
        expectValidXml(xml);
        const strip = (s: string) =>
            s.replace(/\[w:commentRangeStart\]|\[w:commentRangeEnd\]|\[w:commentReference\]/g, "");
        expect(strip(view(xml, "accepted"))).toBe(view(before, "accepted"));
        expect(view(xml, "accepted")).toBe(
            "§ 1[w:tab][w:commentRangeStart]Kara umowna[w:commentRangeEnd][w:commentReference][w:footnoteReference] wynosi 1000 zl.¶",
        );
    });
});
