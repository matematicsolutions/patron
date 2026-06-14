import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ciezkiego tool-dispatch - testujemy TYLKO warstwe wpiecia (prefetch +
// dedup + koercja + mapowanie po ref), nie realny odczyt PDF/DOCX.
const getText = vi.fn<(docLabel: string) => Promise<string | null>>();
vi.mock("./tool-dispatch", () => ({
    getDocumentTextForGrounding: (docLabel: string) => getText(docLabel),
}));

import {
    groundCitationsByRef,
    extractClaim,
    groundingSummary,
} from "./ground-citations";
import type { JudgeFn } from "../citation/cascade";
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

describe("extractClaim", () => {
    it("wyciaga okno wokol znacznika [ref], ograniczone akapitem", () => {
        const answer =
            "Akapit pierwszy bez cytatu.\nSąd oddalił powództwo w całości [2] z uwagi na przedawnienie.\nKoszty obciążają powoda.";
        const claim = extractClaim(answer, 2);
        expect(claim).toContain("oddalił powództwo");
        expect(claim).not.toContain("Akapit pierwszy"); // inny akapit
        expect(claim).not.toContain("Koszty"); // inny akapit
    });

    it("NIE lamie sie na polskich skrotach (art./ust.) - okno znakowe, nie zdaniowe", () => {
        const answer =
            "Zgodnie z art. 6 ust. 1 ustawy tajemnica jest bezwzględna [1].";
        const claim = extractClaim(answer, 1);
        expect(claim).toContain("art. 6 ust. 1");
        expect(claim).toContain("tajemnica jest bezwzględna");
    });

    it("odcina blok <CITATIONS> - nie szuka [ref] w surowym JSON", () => {
        const answer =
            'Proza bez inline markera.\n<CITATIONS>[{"marker":"[1]","quote":"x"}]</CITATIONS>';
        expect(extractClaim(answer, 1)).toBe(""); // [1] tylko w JSON -> odciete
    });

    it("brak znacznika -> pusty string", () => {
        expect(extractClaim("Jakiś tekst bez markera.", 5)).toBe("");
    });

    it("brak answerText -> pusty string", () => {
        expect(extractClaim(undefined, 1)).toBe("");
    });
});

describe("groundCitationsByRef - etap semantyczny (judge wstrzykniety)", () => {
    it("z sedzia 'nie' degraduje verdict do red mimo dokladnego cytatu (decision verified zostaje)", async () => {
        getText.mockResolvedValue("Sąd oddalił powództwo w całości.");
        const judge: JudgeFn = async () => ({
            verdict: "nie",
            confidence: "wysoka",
            uzasadnienie: "Zrodlo mowi przeciwnie.",
        });
        const out = await groundCitationsByRef(
            [{ ref: 1, doc_id: "doc-0", quote: "oddalił powództwo" }],
            docStore,
            undefined,
            undefined,
            { answerText: "Sąd uwzględnił powództwo [1].", judge },
        );
        const r = out[1] as typeof out[1] & { verdict?: string; stage?: number };
        expect(r.decision).toBe("verified"); // deterministyczna nietknieta
        expect(r.verdict).toBe("red"); // werdykt doradczy zdegradowany
        expect(r.stage).toBe(3);
    });

    it("bez sedziego -> sciezka deterministyczna (brak pol verdict/stage z etapu 3)", async () => {
        getText.mockResolvedValue("Sąd oddalił powództwo w całości.");
        const out = await groundCitationsByRef(
            [{ ref: 1, doc_id: "doc-0", quote: "oddalił powództwo" }],
            docStore,
        );
        expect(out[1].decision).toBe("verified");
        expect((out[1] as { stage?: number }).stage).toBeUndefined();
    });
});

describe("groundingSummary - statystyka sedziego (AI Act art. 12)", () => {
    it("bez sedziego: brak pola judge (tylko liczby decyzji)", () => {
        const s = groundingSummary({
            1: {
                ref: 1,
                doc_id: "d",
                status: "ZWERYFIKOWANY",
                decision: "verified",
                worstRatio: 0,
                offset: 0,
            },
        });
        expect(s.judge).toBeUndefined();
        expect(s.verified).toBe(1);
    });

    it("z sedzia: liczy verdykty i DOWNGRADED (Stanford: verified->red)", () => {
        const s = groundingSummary({
            // judge zdegradowal tekstowo-verified do red (FALSE-UNDER-TRUE)
            1: {
                ref: 1,
                doc_id: "d",
                status: "ZWERYFIKOWANY",
                decision: "verified",
                worstRatio: 0,
                offset: 0,
                // pola CascadeResult (ADR-0097)
                verdict: "red",
                stage: 3,
            } as never,
            // judge potwierdzil
            2: {
                ref: 2,
                doc_id: "d",
                status: "ZWERYFIKOWANY",
                decision: "verified",
                worstRatio: 0,
                offset: 0,
                verdict: "green",
                stage: 3,
            } as never,
        });
        expect(s.judge).toBeDefined();
        expect(s.judge!.judged).toBe(2);
        expect(s.judge!.red).toBe(1);
        expect(s.judge!.green).toBe(1);
        expect(s.judge!.downgraded).toBe(1); // kluczowa metryka moatu
    });
});
