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

    // R-CC-06: nazwa pliku pisma (czesto nazwisko klienta i rodzaj sprawy) ani
    // storage_path tez nie trafiaja do logu - odczyt identyfikuje docLabel/document_id.
    it("log nie zawiera nazwy pliku ani storage_path; zawiera docLabel i document_id", async () => {
        const NAZWA = "Pozew_Kowalski_Testowy_rozwod.pdf";
        const SCIEZKA = "documents/u1/d1/Pozew_Kowalski_Testowy_rozwod.pdf";
        const docStore: DocStore = new Map([
            ["doc-3", { storage_path: SCIEZKA, file_type: "pdf", filename: NAZWA }],
        ]);
        const docIndex = {
            "doc-3": { document_id: "d1", filename: NAZWA, version_id: null, version_number: null },
        };
        const tekst = await getDocumentTextForGrounding("doc-3", docStore, docIndex);
        expect(tekst).toContain(WARTOWNIK);
        const log = zapisane.join("\n");
        expect(log).not.toContain("Kowalski_Testowy");
        expect(log).not.toContain("documents/u1/d1");
        expect(log).toContain('docLabel="doc-3"');
        expect(log).toContain("document_id=d1");
    });
});
