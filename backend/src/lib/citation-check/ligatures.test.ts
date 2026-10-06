// R-CC-05 (przeglad 2026-10-02): ligatury z ekstrakcji PDF ("ﬁ", "ﬂ"), "ß" i inne
// znaki, ktorych zmiana wielkosci liter zmienia dlugosc, przesuwaly offset kazdej
// sygnatury i przepisu za nimi - "Sprawdz powolania" podswietlal inny fragment
// pisma, a raport (`excerpt`) cytowal cos innego niz sygnatura. Ekstraktor
// (`cytaty_pl.ts`) ma przypiety sha, wiec poprawka siedzi w index.ts: ekstraktor
// czyta tekst o stalej dlugosci, excerpt i offsety biora sie z oryginalu.
// Dane syntetyczne.
import { describe, expect, it } from "vitest";
import { extractLocalCitations, tekstDlaEkstraktora } from "./index";

const PRZED = "Zgodnie z deﬁnicją oraz ﬁrmą i ﬂotą, ﬁnalnie Straße, İzmir: ";

describe("R-CC-05 tekst dla ekstraktora", () => {
    it("ta sama dlugosc UTF-16, kazdy znak o stalej dlugosci przy zmianie wielkosci liter", () => {
        const txt = PRZED + "ąęłńóśźż ΐ ŉ 𝔄 \u{10428} koniec";
        const scan = tekstDlaEkstraktora(txt);
        expect(scan.length).toBe(txt.length);
        expect(scan.toUpperCase().length).toBe(scan.length);
        expect(scan.toLowerCase().length).toBe(scan.length);
        // Polskie litery zostaja bez zmian (warunek ich nie dotyczy).
        expect(scan).toContain("ąęłńóśźż");
    });

    it("zastepnik zachowuje litere: granice slow jak w oryginale", () => {
        expect(tekstDlaEkstraktora("deﬁnicja")).toBe("defnicja");
        expect(tekstDlaEkstraktora("Straße")).toBe("Strase");
        expect(tekstDlaEkstraktora("İ")).toBe("i");
    });

    it("tekst ASCII i bez problematycznych znakow wraca bez zmian", () => {
        const a = "wyrok SN z dnia 12 marca 2024 r., II CSKP 1/24";
        expect(tekstDlaEkstraktora(a)).toBe(a);
        const b = "Sąd Najwyższy, art. 481 § 1 k.c.";
        expect(tekstDlaEkstraktora(b)).toBe(b);
    });
});

describe("R-CC-05 offsety i excerpt z oryginalu", () => {
    it("sygnatura za ligaturami: excerpt == sygnatura, offset == indexOf", () => {
        const txt = PRZED + "wyrok SN z dnia 12 marca 2024 r., II CSKP 1/24, potwierdza to.";
        const [c] = extractLocalCitations(txt).citations.filter((x) => x.kind === "signature");
        expect(c!.signature).toBe("II CSKP 1/24");
        expect(c!.excerpt).toBe("II CSKP 1/24");
        expect(c!.offset).toBe(txt.indexOf("II CSKP 1/24"));
        expect(c!.date_in_text).toBeTruthy();
    });

    it("przepis za ligaturami: excerpt zaczyna sie od 'art.' i jest wycinkiem oryginalu", () => {
        const txt = PRZED + "ﬁrma narusza art. 481 § 1 k.c., co potwierdza orzecznictwo.";
        const p = extractLocalCitations(txt).citations.find((x) => x.kind === "provision");
        expect(p).toBeDefined();
        expect(p!.offset).toBe(txt.indexOf("art. 481"));
        expect(p!.excerpt).toBe("art. 481 § 1 k.c.");
        expect(txt.slice(p!.offset, p!.offset + p!.length)).toBe(p!.excerpt);
    });

    it("ligatura WEWNATRZ podswietlenia zostaje w excerpcie (oryginal, nie zastepnik)", () => {
        const txt = PRZED + "art. 5 ustawy o ﬁnansach; dalej wyrok II CSKP 2/24.";
        const all = extractLocalCitations(txt).citations;
        for (const c of all) expect(txt.slice(c.offset, c.offset + c.length)).toBe(c.excerpt);
        const s = all.find((x) => x.kind === "signature");
        expect(s!.excerpt).toBe("II CSKP 2/24");
    });

    it("kontrola: bez ligatur wynik identyczny jak przed poprawka (offset == indexOf)", () => {
        const txt = "Zgodnie z definicją oraz firmą: wyrok SN z dnia 12 marca 2024 r., II CSKP 1/24.";
        const [c] = extractLocalCitations(txt).citations;
        expect(c!.offset).toBe(txt.indexOf("II CSKP 1/24"));
        expect(c!.excerpt).toBe("II CSKP 1/24");
    });
});
