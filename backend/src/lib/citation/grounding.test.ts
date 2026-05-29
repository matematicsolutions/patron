import { describe, expect, it } from "vitest";
import type { ParsedCitation } from "../chat/types";
import {
    MODIFIED_RATIO_THRESHOLD,
    normalize,
    verifyCitations,
    verifyOne,
} from "./grounding";

const SRC =
    "Sad Najwyzszy w wyroku z dnia 12 marca 2013 r., III CZP 11/13, orzekl, " +
    "ze odpowiedzialnosc odszkodowawcza powstaje wtedy, gdy ziszcza sie " +
    "ustawowe przeslanki winy, szkody oraz zwiazku przyczynowego miedzy " +
    "zachowaniem sprawcy a powstala szkoda majatkowa poszkodowanego.";

function cite(quote: string, doc_id = "doc-1", ref = 1): ParsedCitation {
    return { ref, doc_id, page: 1, quote };
}

describe("normalize", () => {
    it("ujednolica cudzyslowy, myslniki i biale znaki", () => {
        expect(normalize("  „Ala”   ma\n kota  ")).toBe('"ala" ma kota');
        expect(normalize("test—z–myslnikami")).toBe("test-z-myslnikami");
    });
    it("skleja myslnik przenoszenia z konca wiersza", () => {
        expect(normalize("odpowie-\ndzialnosc")).toBe("odpowiedzialnosc");
    });
});

describe("verifyOne - trzy osie (lustro eval harness)", () => {
    it("TRUE: cytat doslowny -> ZWERYFIKOWANY/verified", () => {
        const r = verifyOne(
            cite("odpowiedzialnosc odszkodowawcza powstaje wtedy"),
            SRC,
        );
        expect(r.status).toBe("ZWERYFIKOWANY");
        expect(r.decision).toBe("verified");
        expect(r.offset).toBeGreaterThanOrEqual(0);
        expect(r.worstRatio).toBe(0);
    });

    it("MODIFIED: drobna zmiana w dlugim cytacie -> ZMODYFIKOWANY/unverified", () => {
        // jeden znak zmieniony w dlugim fragmencie -> ratio << 0.15
        const r = verifyOne(
            cite("odpowiedzialnosc odszkodowawcza powstaze wtedy, gdy ziszcza sie"),
            SRC,
        );
        expect(r.status).toBe("ZMODYFIKOWANY");
        expect(r.decision).toBe("unverified");
    });

    it("HALLUCINATED: cytat nieobecny w zrodle -> NIEZWERYFIKOWANY/blocked", () => {
        const r = verifyOne(
            cite("powod wniosl o zasadzenie zadoscuczynienia w kwocie 50000 zl"),
            SRC,
        );
        expect(r.status).toBe("NIEZWERYFIKOWANY");
        expect(r.decision).toBe("blocked");
    });

    it("BRAK_ZRODLA: brak tekstu zrodlowego -> blocked", () => {
        const r = verifyOne(cite("cokolwiek"), null);
        expect(r.status).toBe("BRAK_ZRODLA");
        expect(r.decision).toBe("blocked");
    });
});

describe("verifyOne - przypadki adwersarialne (brakowaly w pierwszym eval)", () => {
    it("cytat z luka [...] dopasowany segmentami w kolejnosci", () => {
        const r = verifyOne(
            cite("odpowiedzialnosc odszkodowawcza powstaje [...] zwiazku przyczynowego"),
            SRC,
        );
        expect(r.status).toBe("ZWERYFIKOWANY");
    });

    it("segmenty luki w ODWROTNEJ kolejnosci -> nie ZWERYFIKOWANY", () => {
        const r = verifyOne(
            cite("zwiazku przyczynowego ... odpowiedzialnosc odszkodowawcza powstaje"),
            SRC,
        );
        expect(r.status).not.toBe("ZWERYFIKOWANY");
    });

    it("rozne cudzyslowy/myslniki nie psuja dopasowania (normalizacja)", () => {
        const r = verifyOne(cite("12 marca 2013 r., III CZP 11/13"), SRC);
        expect(r.status).toBe("ZWERYFIKOWANY");
    });

    it("granica progu: literowka (2 znaki/41) = ZMODYFIKOWANY, podmiana slowa = NIEZWERYFIKOWANY", () => {
        const base = "ustawowe przeslanki winy, szkody oraz zwi"; // 41 zn, doslownie w SRC
        // sanity: baza istnieje doslownie -> ZWERYFIKOWANY
        expect(verifyOne(cite(base), SRC).status).toBe("ZWERYFIKOWANY");
        // 2 literowki / 41 znakow -> ratio ~0.05 < 0.15 -> ZMODYFIKOWANY
        const typo = "ustewowe przeslanki winy, szkudy oraz zwi";
        const rTypo = verifyOne(cite(typo), SRC);
        expect(rTypo.status).toBe("ZMODYFIKOWANY");
        expect(rTypo.worstRatio).toBeLessThanOrEqual(MODIFIED_RATIO_THRESHOLD);
        // podmiana calego slowa (przeslanki->xxxxx) -> ratio > 0.15 -> halucynacja
        const swapped = "ustawowe xxxxx winy, szkody oraz zwi";
        expect(verifyOne(cite(swapped), SRC).status).toBe("NIEZWERYFIKOWANY");
    });

    it("cytat dluzszy niz zrodlo -> NIEZWERYFIKOWANY, nie crash", () => {
        const r = verifyOne(cite(SRC + " " + SRC), "krotki tekst");
        expect(r.status).toBe("NIEZWERYFIKOWANY");
    });
});

describe("verifyCitations - raport zbiorczy + blokada", () => {
    const resolver = (id: string) => (id === "doc-1" ? SRC : null);

    it("liczy summary i ustawia blokade gdy jest halucynacja", () => {
        const report = verifyCitations(
            [
                cite("odpowiedzialnosc odszkodowawcza powstaje wtedy", "doc-1", 1),
                cite("powod wniosl o zasadzenie 50000 zl", "doc-1", 2),
            ],
            resolver,
        );
        expect(report.summary.total).toBe(2);
        expect(report.summary.zweryfikowane).toBe(1);
        expect(report.summary.niezweryfikowane).toBe(1);
        expect(report.blokada).toBe(true);
    });

    it("blokada gdy zrodlo nie istnieje (doc_id nieznany)", () => {
        const report = verifyCitations(
            [cite("cokolwiek", "doc-nieistnieje", 1)],
            resolver,
        );
        expect(report.summary.brak_zrodla).toBe(1);
        expect(report.blokada).toBe(true);
    });

    it("brak blokady gdy wszystkie verified", () => {
        const report = verifyCitations(
            [
                cite("12 marca 2013 r., III CZP 11/13", "doc-1", 1),
                cite("zwiazku przyczynowego miedzy zachowaniem sprawcy", "doc-1", 2),
            ],
            resolver,
        );
        expect(report.blokada).toBe(false);
        expect(report.summary.zweryfikowane).toBe(2);
    });

    it("resolver wolany dokladnie raz na cytat", () => {
        const calls: string[] = [];
        verifyCitations([cite("x", "a"), cite("y", "b")], (id) => {
            calls.push(id);
            return null;
        });
        expect(calls).toEqual(["a", "b"]);
    });
});
