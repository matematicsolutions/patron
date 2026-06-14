import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ciezkiego tool-dispatch - testujemy TYLKO warstwe wpiecia (prefetch +
// dedup + koercja + mapowanie po ref), nie realny odczyt PDF/DOCX.
const getText = vi.fn<(docLabel: string) => Promise<string | null>>();
vi.mock("./tool-dispatch", () => ({
    getDocumentTextForGrounding: (docLabel: string) => getText(docLabel),
}));

import { groundCitationsByRef } from "./ground-citations";
import type { DocStore } from "./types";

const SRC =
    "Odpowiedzialnosc odszkodowawcza powstaje wtedy, gdy ziszcza sie ustawowe " +
    "przeslanki winy, szkody oraz zwiazku przyczynowego.";

const docStore: DocStore = new Map();

beforeEach(() => {
    getText.mockReset();
});

describe("groundCitationsByRef", () => {
    it("zwraca pusty wynik dla braku cytatow (bez I/O)", async () => {
        const out = await groundCitationsByRef([], docStore);
        expect(out).toEqual({});
        expect(getText).not.toHaveBeenCalled();
    });

    it("mapuje werdykt po ref: verified vs blocked", async () => {
        getText.mockResolvedValue(SRC);
        const out = await groundCitationsByRef(
            [
                { ref: 1, doc_id: "doc-0", quote: "ustawowe przeslanki winy" },
                { ref: 2, doc_id: "doc-0", quote: "powod zadal 50000 zl tytulem" },
            ],
            docStore,
        );
        expect(out[1].decision).toBe("verified");
        expect(out[2].decision).toBe("blocked");
        expect(out[2].status).toBe("NIEZWERYFIKOWANY");
    });

    it("prefetch raz na unikalny doc_id (dedup I/O)", async () => {
        getText.mockResolvedValue(SRC);
        await groundCitationsByRef(
            [
                { ref: 1, doc_id: "doc-0", quote: "przeslanki winy" },
                { ref: 2, doc_id: "doc-0", quote: "szkody oraz zwiazku" },
                { ref: 3, doc_id: "doc-1", quote: "cokolwiek" },
            ],
            docStore,
        );
        expect(getText).toHaveBeenCalledTimes(2); // doc-0 i doc-1, nie 3x
    });

    it("brak zrodla (resolver null) -> BRAK_ZRODLA/blocked", async () => {
        getText.mockResolvedValue(null);
        const out = await groundCitationsByRef(
            [{ ref: 1, doc_id: "doc-x", quote: "x" }],
            docStore,
        );
        expect(out[1].status).toBe("BRAK_ZRODLA");
        expect(out[1].decision).toBe("blocked");
    });

    it("blad odczytu jednego dokumentu izoluje sie, nie wywraca calosci", async () => {
        getText.mockImplementation(async (id: string) => {
            if (id === "doc-bad") throw new Error("read fail");
            return SRC;
        });
        const out = await groundCitationsByRef(
            [
                { ref: 1, doc_id: "doc-0", quote: "ustawowe przeslanki winy" },
                { ref: 2, doc_id: "doc-bad", quote: "cokolwiek" },
            ],
            docStore,
        );
        expect(out[1].decision).toBe("verified");
        expect(out[2].decision).toBe("blocked"); // BRAK_ZRODLA po wyjatku
    });

    it("pomija wadliwe rekordy cytatow (zla koercja), nie rzuca", async () => {
        getText.mockResolvedValue(SRC);
        const out = await groundCitationsByRef(
            [
                { ref: 1, doc_id: "doc-0", quote: "przeslanki winy" },
                { ref: "zle", doc_id: 123 }, // niepoprawny rekord
                null,
            ],
            docStore,
        );
        expect(Object.keys(out)).toEqual(["1"]);
    });

    it("dolacza trwaly lokator do cytatu verbatim, null gdy nie-verbatim", async () => {
        getText.mockResolvedValue(SRC);
        const out = await groundCitationsByRef(
            [
                { ref: 1, doc_id: "doc-0", quote: "ustawowe przeslanki winy" },
                { ref: 2, doc_id: "doc-0", quote: "powod zadal 50000 zl tytulem" },
            ],
            docStore,
        );
        expect(out[1].decision).toBe("verified");
        expect(out[1].locator).not.toBeNull();
        expect(out[1].locator!.rawText).toBe("ustawowe przeslanki winy");
        const s = out[1].locator!.startHint!;
        expect(SRC.slice(s, s + out[1].locator!.rawText.length)).toBe(
            "ustawowe przeslanki winy",
        );
        // blocked / nie-verbatim -> brak lokatora (fail-closed)
        expect(out[2].locator).toBeNull();
    });

    it("brak zrodla -> locator null", async () => {
        getText.mockResolvedValue(null);
        const out = await groundCitationsByRef(
            [{ ref: 1, doc_id: "doc-x", quote: "x" }],
            docStore,
        );
        expect(out[1].locator).toBeNull();
    });

    it("fallback whitespace: lokator gdy cytat rozni sie tylko bialymi znakami", async () => {
        // zrodlo z nowa linia i podwojna spacja - exact by sie nie udal
        getText.mockResolvedValue("Sad uznal, ze\npowodztwo  jest zasadne.");
        const out = await groundCitationsByRef(
            [{ ref: 1, doc_id: "doc-0", quote: "powodztwo jest zasadne" }],
            docStore,
        );
        expect(out[1].decision).toBe("verified");
        expect(out[1].locator).not.toBeNull();
        expect(out[1].locator!.rawText.replace(/\s+/g, " ")).toBe(
            "powodztwo jest zasadne",
        );
    });
});
