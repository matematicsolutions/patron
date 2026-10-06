// Pomocnicze funkcje tabular (audyt 2026-09). D-12: model lokalny w tabular review nie moze rzucac wyjatku
// poza try w async handlerze Express 4 - to konczylo caly proces backendu.
import { describe, expect, it } from "vitest";
import { missingModelApiKey } from "./tabular";

describe("missingModelApiKey", () => {
    it("model lokalny (ollama/*) nie wymaga klucza i nie rzuca", () => {
        expect(() => missingModelApiKey("ollama/bielik:11b", {})).not.toThrow();
        expect(missingModelApiKey("ollama/bielik:11b", {})).toBeNull();
    });

    it("model chmurowy bez klucza nadal zwraca brak klucza", () => {
        const r = missingModelApiKey("gemini-2.5-flash", {});
        expect(r?.provider).toBe("gemini");
    });
});

import { coverageFor, documentTextWithOcrFallback } from "./tabular";

// D-15: obciecie dokumentu jest jawne w wyniku komorki.
describe("coverageFor", () => {
    it("krotki dokument: brak znacznika", () => {
        expect(coverageFor("a".repeat(1000))).toBeUndefined();
    });
    it("dokument ponad limit: jawny mianownik", () => {
        expect(coverageFor("a".repeat(130_000))).toEqual({ truncated: true, chars_sent: 120_000, chars_total: 130_000 });
    });
});

// D-11: skan bez warstwy tekstu bierze tekst z OCR zapisany przez ingest.
describe("documentTextWithOcrFallback", () => {
    function db(rows: { content: string }[], fail = false) {
        const b: any = {
            select: () => b, eq: () => b, order: () => b,
            then: (res: any, rej: any) =>
                (fail ? Promise.reject(new Error("x")) : Promise.resolve({ data: rows, error: null })).then(res, rej),
        };
        return { from: () => b } as any;
    }
    it("ekstrakcja z tekstem: bez zmian", async () => {
        expect(await documentTextWithOcrFallback(db([{ content: "ocr" }]), "d", "plik")).toBe("plik");
    });
    it("pusta ekstrakcja: tekst z doc_chunks", async () => {
        expect(await documentTextWithOcrFallback(db([{ content: "A" }, { content: "B" }]), "d", "  ")).toBe("A\nB");
    });
    it("brak OCR albo blad odczytu: pusty tekst (wywolujacy oznacza blad)", async () => {
        expect(await documentTextWithOcrFallback(db([]), "d", "")).toBe("");
        expect(await documentTextWithOcrFallback(db([], true), "d", "")).toBe("");
    });
});

import { maskTabularEgress } from "./tabular";

// A-07: tresc dokumentu do modelu chmurowego tabular idzie zamaskowana.
describe("maskTabularEgress", () => {
    const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna
    const DOC = `Najemca: Pan Jan Testowy, PESEL ${PESEL}, e-mail jan.testowy@example.com.`;
    it("model chmurowy: PESEL, e-mail i nazwisko nie wychodza; unmask przywraca oryginal", async () => {
        const e = await maskTabularEgress("openrouter/google/gemini-3-flash-preview", "umowa-jan-testowy.docx", DOC);
        expect(e.text).not.toContain(PESEL);
        expect(e.text).not.toContain("jan.testowy@example.com");
        expect(e.text).not.toContain("Jan Testowy");
        expect(e.unmask(e.text)).toBe(DOC);
    });
    it("model lokalny: bez zmian", async () => {
        const e = await maskTabularEgress("ollama/bielik:11b", "umowa.docx", DOC);
        expect(e.text).toBe(DOC);
        expect(e.filename).toBe("umowa.docx");
    });
});
