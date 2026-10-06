// R-CC-01 (ADR-0157): "do weryfikatora idzie lista cytatow, nie pismo". Ekstraktor
// (cytaty_pl.ts WZOR_SYGNATURY: [litery]{1,6} + liczba/liczba) bierze za "sygnature
// orzeczenia" kazdy ciag "SLOWO 12/24": adres klienta ("ul. Polna 12/24"), numer umowy,
// fakture, repertorium notarialne, sygnature wewnetrzna kancelarii - a dataPrzySygnaturze
// dokleja najblizsza date sprzed (np. DATE URODZENIA klienta). buildVerifyItems wysyla to
// do zewnetrznego konektora jako `signature` + `date_in_text`, a ekran mowi: "Tresc pisma
// nie opuscila komputera". Test bajtowy w citation-check.test.ts tego nie widzi, bo
// wycinek uznany za cytat jest z definicji "dozwolony".
// Oczekiwane: do sieci nie idzie zaden identyfikator, ktory nie jest powolaniem.
// Dane syntetyczne.
import { describe, expect, it } from "vitest";
import { checkDocumentCitations, type VerifyItem } from "../src/lib/citation-check";

const PISMO = `Warszawa, dnia 1 października 2026 r.

Sąd Rejonowy dla Warszawy-Mokotowa, I Wydział Cywilny
Sygn. akt I C 1234/25

Powód: Jan Testowy, urodzony 12.03.1980, zam. ul. Polna 12/24, 00-001 Warszawa
Pozwany: Bank Testowy S.A.

Na podstawie umowy z dnia 5.05.2019, nr KRD 4471/2019, faktury FV 123/2024
i aktu notarialnego Rep. A 5678/2021 powód wnosi o zapłatę.
Sprawa prowadzona w kancelarii pod sygn. KAN 45/2025.
Zgodnie z art. 471 k.c. oraz wyrokiem SN z dnia 12 marca 2024 r., II CSKP 1/24.
`;

async function wyslane(): Promise<string> {
    const calls: VerifyItem[][] = [];
    await checkDocumentCitations({
        text: PISMO,
        callTool: async (args) => {
            calls.push(args.citations as VerifyItem[]);
            return { text: JSON.stringify({ result: { citations: [] } }) };
        },
    });
    return JSON.stringify(calls);
}

describe("R-CC-01 do weryfikatora wychodza identyfikatory, ktore nie sa powolaniami", () => {
    it("kontrola pozytywna: prawdziwe powolania wychodza", async () => {
        const s = await wyslane();
        expect(s).toContain("II CSKP 1/24");
        expect(s).toContain('"article":"471"');
    });

    it("adres klienta i data urodzenia nie wychodza", async () => {
        const s = await wyslane();
        expect(s).not.toMatch(/POLNA/i);
        expect(s).not.toContain("1980-03-12");
    });

    it("numer umowy, faktury, repertorium notarialne i sygnatura kancelarii nie wychodza", async () => {
        const s = await wyslane();
        expect(s).not.toContain("KRD 4471");
        expect(s).not.toContain("FV 123");
        expect(s).not.toContain("A 5678");
        expect(s).not.toContain("KAN 45");
    });

    it("sygnatura WLASNEJ sprawy z naglowka pisma (Sygn. akt) nie wychodzi bez decyzji prawnika", async () => {
        const s = await wyslane();
        expect(s).not.toContain("I C 1234/25");
    });
});
