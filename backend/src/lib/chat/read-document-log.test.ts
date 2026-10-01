// Tresc pisma nie trafia do logow backendu (ADR-0157, Konstytucja Art. 1/5).
//
// Wspolna sciezka odczytu (`readDocumentContent`, przez `getDocumentTextForGrounding`)
// wypisywala do logu pierwsze 120 znakow tekstu kazdego czytanego pisma - przy czacie,
// groundingu i "Sprawdz powolania". Log jest lokalny, ale fragment pisma w pliku logu
// to dokladnie to, czego obiecujemy nie robic.
//
// Test idzie PRAWDZIWA sciezka odczytu; atrapy dotycza tylko magazynu plikow i
// ekstraktora PDF. Caly `console` jest przechwycony.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wartownik: zdanie, ktore pojawia sie wylacznie w tresci pisma.
const WARTOWNIK = "Powod Galeria Polnocna Testowa zada zaplaty kwoty 48 213,55 zl";
const TEKST = `${WARTOWNIK}. Dalszy tekst uzasadnienia pozwu.`;

vi.mock("../storage", () => ({
    downloadFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 atrapa").buffer),
    storageKey: vi.fn(),
    uploadFile: vi.fn(),
}));
vi.mock("./pdf", () => ({ extractPdfText: vi.fn(async () => TEKST) }));

import { getDocumentTextForGrounding } from "./tool-dispatch";
import type { DocStore } from "./types";

const METODY = ["log", "info", "warn", "error", "debug"] as const;
let zapisane: string[] = [];

beforeEach(() => {
    zapisane = [];
    for (const m of METODY)
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
            zapisane.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        });
});
afterEach(() => vi.restoreAllMocks());

describe("odczyt pisma nie wypisuje jego tresci do logu", () => {
    it("tekst wraca do wolajacego, ale zaden log nie zawiera fragmentu pisma", async () => {
        const docStore: DocStore = new Map([
            ["doc-0", { storage_path: "sprawy/x/pozew.pdf", file_type: "pdf", filename: "pozew.pdf" }],
        ]);
        const tekst = await getDocumentTextForGrounding("doc-0", docStore);

        // Kontrola pozytywna: odczyt naprawde sie odbyl i logi naprawde przechwycono.
        expect(tekst).toContain(WARTOWNIK);
        expect(zapisane.length).toBeGreaterThan(0);

        const log = zapisane.join("\n");
        // Kazdy 12-znakowy kawalek wartownika - nie tylko cale zdanie.
        for (let i = 0; i + 12 <= WARTOWNIK.length; i += 6)
            expect(log).not.toContain(WARTOWNIK.slice(i, i + 12));
        // Dlugosc tekstu to metadana, ktora zostaje w logu (diagnostyka).
        expect(log).toContain(`finalTextLength=${TEKST.length}`);
    });
});
