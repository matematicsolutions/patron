// R-CC-06 (kontekst A-10): poprawka 8b9da0a usunela z logu `firstChars` (120 znakow
// tresci), ale wspolna sciezka odczytu (readDocumentContent, lib/chat/tool-dispatch.ts:63, 131, 138, 145,
// 149, 157, 162, 170, 176, 192, 202) nadal wypisuje nazwe pliku pisma
// przy KAZDYM odczycie - takze w "Sprawdz powolania". Opis A-10 wymienial wprost
// "oraz nazwy plikow"; test A-10 sprawdza tylko PESEL i nazwisko w TRESCI, z nazwa
// pliku "pozew.pdf", wiec tej czesci nie widzi. W kancelarii nazwa pliku to czesto
// nazwisko klienta i rodzaj sprawy.
// Oczekiwane: log operacyjny nie zawiera nazwy pliku pisma (co najwyzej id/dlugosc).
import { describe, it, expect, vi } from "vitest";

const NAZWA = "Pozew_Testowy_Jan_rozwod.pdf"; // syntetyczne
vi.mock("../src/lib/storage", () => ({
    downloadFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4\n%synthetic\n").buffer),
    uploadFile: vi.fn(),
    storageKey: vi.fn(() => "k"),
}));
vi.mock("../src/lib/chat/pdf", () => ({ extractPdfText: vi.fn(async () => "Tresc pisma. art. 471 k.c.") }));

import { getDocumentTextForGrounding } from "../src/lib/chat/tool-dispatch";

describe("R-CC-06 sciezka odczytu loguje nazwe pliku pisma", () => {
    it("console.log nie dostaje nazwy pliku", async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
            lines.push(a.map(String).join(" "));
        });
        const text = await getDocumentTextForGrounding(
            "doc-0",
            new Map([["doc-0", { storage_path: "s/doc0.pdf", file_type: "pdf", filename: NAZWA }]]),
        );
        spy.mockRestore();
        expect(text).toContain("art. 471"); // sanity: odczyt przeszedl
        expect(lines.join("\n")).not.toContain("Testowy_Jan");
    });
});
