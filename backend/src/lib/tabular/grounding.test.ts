// ADR-0080: testy groundingu komorek tabular review.

import { describe, expect, it } from "vitest";
import { groundCellText, parseInlineCitations } from "./grounding";

const DOC = [
    "## Page 1",
    "Najemca zaplaci czynsz w wysokosci 5.000 PLN miesiecznie z gory do 10. dnia kazdego miesiaca.",
    "Umowa podlega prawu polskiemu, a sadem wlasciwym jest sad w Krakowie.",
    "Okres wypowiedzenia wynosi trzy miesiace ze skutkiem na koniec miesiaca kalendarzowego.",
].join("\n");

describe("parseInlineCitations", () => {
    it("wyciaga cytat z prefiksem quote:", () => {
        const out = parseInlineCitations(
            'Czynsz 5.000 PLN [[page:1||quote:czynsz w wysokosci 5.000 PLN miesiecznie]].',
        );
        expect(out).toEqual([
            { page: 1, quote: "czynsz w wysokosci 5.000 PLN miesiecznie" },
        ]);
    });

    it("akceptuje wariant bez prefiksu quote:", () => {
        const out = parseInlineCitations("[[page:3||prawu polskiemu]]");
        expect(out).toEqual([{ page: 3, quote: "prawu polskiemu" }]);
    });

    it("zbiera wiele cytatow w kolejnosci", () => {
        const out = parseInlineCitations(
            "a [[page:1||quote:foo]] b [[page:2||quote:bar]]",
        );
        expect(out.map((c) => c.quote)).toEqual(["foo", "bar"]);
        expect(out.map((c) => c.page)).toEqual([1, 2]);
    });

    it("pomija pusty cytat i zwraca [] dla pustego wejscia", () => {
        expect(parseInlineCitations("")).toEqual([]);
        expect(parseInlineCitations(null)).toEqual([]);
        expect(parseInlineCitations("[[page:1||quote:   ]]")).toEqual([]);
    });
});

describe("groundCellText", () => {
    it("brak cytatow -> undefined (nie krzyczymy bez powodu)", () => {
        expect(groundCellText("Nie dotyczy", "", DOC)).toBeUndefined();
    });

    it("brak tekstu zrodlowego -> undefined (nie da sie zweryfikowac)", () => {
        expect(
            groundCellText("[[page:1||quote:czynsz]]", "", ""),
        ).toBeUndefined();
    });

    it("cytat obecny doslownie -> verified", () => {
        const g = groundCellText(
            "Czynsz [[page:1||quote:czynsz w wysokosci 5.000 PLN miesiecznie]].",
            "",
            DOC,
        );
        expect(g).toBeDefined();
        expect(g!.status).toBe("verified");
        expect(g!.verified).toBe(1);
        expect(g!.unverified).toBe(0);
    });

    it("drobna roznica interpunkcyjna -> modified", () => {
        const g = groundCellText(
            "[[page:1||quote:czynsz w wysokosci 5000 PLN miesiecznie]]",
            "",
            DOC,
        );
        expect(g).toBeDefined();
        expect(g!.status).toBe("modified");
    });

    it("cytat nieobecny -> unverified (potencjalna halucynacja)", () => {
        const g = groundCellText(
            "[[page:1||quote:czynsz w wysokosci 99.999 EUR tygodniowo]]",
            "",
            DOC,
        );
        expect(g).toBeDefined();
        expect(g!.status).toBe("unverified");
        expect(g!.unverified).toBe(1);
    });

    it("rollup bierze najgorszy stan i liczy cytaty z summary + reasoning", () => {
        const g = groundCellText(
            "[[page:2||quote:prawu polskiemu]]",
            "Uzasadnienie: [[page:1||quote:zaplaci stomilionow dolarow]]",
            DOC,
        );
        expect(g).toBeDefined();
        expect(g!.total).toBe(2);
        expect(g!.verified).toBe(1);
        expect(g!.unverified).toBe(1);
        expect(g!.status).toBe("unverified");
    });
});

describe("groundCellText - stan needs_review (ADR-0102 B, flaga cellStates)", () => {
    const CIT = "[[page:1||quote:czynsz]]";

    it("cytaty bez zrodla + cellStates -> needs_review (nie milcz, 'pusta komorka ukrywa informacje')", () => {
        const g = groundCellText(CIT, "", "", { cellStates: true });
        expect(g).toBeDefined();
        expect(g!.status).toBe("needs_review");
        expect(g!.needs_review).toBe(1);
        expect(g!.verified).toBe(0);
        expect(g!.unverified).toBe(0);
        expect(g!.total).toBe(1);
    });

    it("cytaty bez zrodla BEZ flagi -> undefined (zachowanie ADR-0080, zero zmiany)", () => {
        expect(groundCellText(CIT, "", "", { cellStates: false })).toBeUndefined();
        expect(groundCellText(CIT, "", "")).toBeUndefined();
    });

    it("brak cytatow + cellStates -> undefined (nie ma czego gruntowac)", () => {
        expect(
            groundCellText("Nie dotyczy", "", "", { cellStates: true }),
        ).toBeUndefined();
    });

    it("zrodlo obecne + cellStates -> normalna weryfikacja (bez needs_review)", () => {
        const g = groundCellText(
            "[[page:1||quote:czynsz w wysokosci 5.000 PLN miesiecznie]]",
            "",
            DOC,
            { cellStates: true },
        );
        expect(g).toBeDefined();
        expect(g!.status).toBe("verified");
        expect(g!.needs_review).toBeUndefined();
    });
});
