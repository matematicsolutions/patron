// Testy ADR-0117: bounded document text (stronicowany odczyt).

import { describe, it, expect } from "vitest";
import {
    boundedDocumentText,
    DEFAULT_MAX_CHARS,
    HARD_MAX_CHARS,
} from "./document-window";

describe("boundedDocumentText - cala zawartosc miesci sie", () => {
    it("maxChars > total: zwraca calosc, nextOffset null, truncated false", () => {
        const src = "Krotki dokument.";
        const w = boundedDocumentText(src, 0, 1000);
        expect(w.text).toBe(src);
        expect(w.charOffset).toBe(0);
        expect(w.totalChars).toBe(src.length);
        expect(w.nextOffset).toBeNull();
        expect(w.truncated).toBe(false);
    });

    it("pusty tekst: puste okno, nextOffset null, truncated false", () => {
        const w = boundedDocumentText("", 0, 100);
        expect(w.text).toBe("");
        expect(w.totalChars).toBe(0);
        expect(w.nextOffset).toBeNull();
        expect(w.truncated).toBe(false);
    });
});

describe("boundedDocumentText - okna", () => {
    const src = "0123456789"; // 10 znakow

    it("pierwsze okno: nextOffset wskazuje dalej, truncated true", () => {
        const w = boundedDocumentText(src, 0, 4);
        expect(w.text).toBe("0123");
        expect(w.nextOffset).toBe(4);
        expect(w.truncated).toBe(true);
    });

    it("srodkowe okno", () => {
        const w = boundedDocumentText(src, 4, 3);
        expect(w.text).toBe("456");
        expect(w.charOffset).toBe(4);
        expect(w.nextOffset).toBe(7);
        expect(w.truncated).toBe(true);
    });

    it("ostatnie okno: nextOffset null, ale truncated true (start>0)", () => {
        const w = boundedDocumentText(src, 7, 100);
        expect(w.text).toBe("789");
        expect(w.nextOffset).toBeNull();
        expect(w.truncated).toBe(true);
    });

    it("dokladne dociecie do konca: nextOffset null", () => {
        const w = boundedDocumentText(src, 0, 10);
        expect(w.text).toBe(src);
        expect(w.nextOffset).toBeNull();
        expect(w.truncated).toBe(false);
    });
});

describe("boundedDocumentText - zacinanie wejscia", () => {
    const src = "abcdef"; // 6

    it("charOffset poza zakresem -> puste okno na koncu, truncated true", () => {
        const w = boundedDocumentText(src, 999, 10);
        expect(w.text).toBe("");
        expect(w.charOffset).toBe(6);
        expect(w.nextOffset).toBeNull();
        expect(w.truncated).toBe(true);
    });

    it("charOffset ujemny -> 0", () => {
        const w = boundedDocumentText(src, -5, 3);
        expect(w.charOffset).toBe(0);
        expect(w.text).toBe("abc");
    });

    it("maxChars <= 0 -> zaciety do 1", () => {
        const w = boundedDocumentText(src, 0, 0);
        expect(w.maxChars).toBe(1);
        expect(w.text).toBe("a");
    });

    it("maxChars powyzej twardego limitu -> zaciety do HARD_MAX_CHARS", () => {
        const w = boundedDocumentText(src, 0, HARD_MAX_CHARS + 5000);
        expect(w.maxChars).toBe(HARD_MAX_CHARS);
    });

    it("NaN offset/maxChars -> bezpieczne wartosci min (0 / 1)", () => {
        const w = boundedDocumentText(src, Number.NaN, Number.NaN);
        expect(w.charOffset).toBe(0);
        expect(w.maxChars).toBe(1);
        expect(w.text).toBe("a");
    });

    it("domyslny maxChars to DEFAULT_MAX_CHARS", () => {
        const w = boundedDocumentText("x".repeat(DEFAULT_MAX_CHARS + 10));
        expect(w.maxChars).toBe(DEFAULT_MAX_CHARS);
        expect(w.text.length).toBe(DEFAULT_MAX_CHARS);
        expect(w.nextOffset).toBe(DEFAULT_MAX_CHARS);
        expect(w.truncated).toBe(true);
    });
});

describe("boundedDocumentText - round-trip po nextOffset", () => {
    it("iteracja oknami odtwarza caly dokument", () => {
        const src = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
        const windowSize = 7;
        let offset: number | null = 0;
        let rebuilt = "";
        let guard = 0;
        while (offset !== null && guard++ < 1000) {
            const w = boundedDocumentText(src, offset, windowSize);
            rebuilt += w.text;
            offset = w.nextOffset;
        }
        expect(rebuilt).toBe(src);
    });
});
