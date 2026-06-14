// Testy ADR-0116: trwaly lokator cytatu (re-anchoring rawText + hint).

import { describe, it, expect } from "vitest";
import {
    type CitationLocator,
    findOccurrences,
    locateChunkSpans,
    locatorFor,
    locatorFromCollapsedQuote,
    locatorFromQuote,
    reanchor,
} from "./locator";

// Zrodlo z trzema wystapieniami tej samej frazy w roznych miejscach.
const SRC_WIELOKROTNY =
    "Strona zobowiazuje sie do zaplaty. " + // 0..
    "Strona zobowiazuje sie do dostawy. " +
    "Na koniec Strona zobowiazuje sie do milczenia.";

describe("reanchor - niezmiennik verbatim", () => {
    it("dla wyniku != null zachodzi slice(start,end) === rawText", () => {
        const src = "Sad orzekl, ze powodztwo jest zasadne w calosci.";
        const loc: CitationLocator = { rawText: "powodztwo jest zasadne" };
        const anchor = reanchor(loc, src);
        expect(anchor).not.toBeNull();
        expect(src.slice(anchor!.start, anchor!.end)).toBe(loc.rawText);
    });
});

describe("reanchor - fail-closed", () => {
    it("zwraca null gdy rawText nie wystepuje w zrodle", () => {
        const src = "Tresc dokumentu bez cytowanej frazy.";
        expect(reanchor({ rawText: "fraza ktorej nie ma" }, src)).toBeNull();
    });

    it("zwraca null dla pustego rawText", () => {
        expect(reanchor({ rawText: "" }, "cokolwiek")).toBeNull();
    });

    it("zwraca null dla pustego zrodla", () => {
        expect(reanchor({ rawText: "fraza" }, "")).toBeNull();
    });
});

describe("reanchor - wybor wystapienia", () => {
    const frag = "Strona zobowiazuje sie";

    it("bez hintu degraduje do pierwszego wystapienia", () => {
        const a = reanchor({ rawText: frag }, SRC_WIELOKROTNY);
        expect(a).not.toBeNull();
        expect(a!.occurrence).toBe(0);
        expect(a!.start).toBe(SRC_WIELOKROTNY.indexOf(frag));
        expect(a!.total).toBe(3);
        expect(a!.ambiguous).toBe(true);
    });

    it("startHint wybiera wystapienie najblizsze ostatniej pozycji", () => {
        const wszystkie = findOccurrences(frag, SRC_WIELOKROTNY);
        expect(wszystkie).toHaveLength(3);
        // Hint blisko trzeciego wystapienia -> wybiera trzecie.
        const a = reanchor(
            { rawText: frag, startHint: wszystkie[2]! - 2 },
            SRC_WIELOKROTNY,
        );
        expect(a!.occurrence).toBe(2);
        expect(a!.start).toBe(wszystkie[2]);
    });

    it("startHint blisko drugiego wystapienia wybiera drugie", () => {
        const wszystkie = findOccurrences(frag, SRC_WIELOKROTNY);
        const a = reanchor(
            { rawText: frag, startHint: wszystkie[1]! + 1 },
            SRC_WIELOKROTNY,
        );
        expect(a!.occurrence).toBe(1);
    });

    it("occurrenceHint ma pierwszenstwo i kotwiczy wskazany indeks", () => {
        const a = reanchor(
            { rawText: frag, occurrenceHint: 1, startHint: 0 },
            SRC_WIELOKROTNY,
        );
        // occurrenceHint=1 wygrywa mimo startHint=0 (ktory wskazywalby 0).
        expect(a!.occurrence).toBe(1);
    });

    it("occurrenceHint poza zakresem degraduje do startHint", () => {
        const wszystkie = findOccurrences(frag, SRC_WIELOKROTNY);
        const a = reanchor(
            { rawText: frag, occurrenceHint: 99, startHint: wszystkie[2]! },
            SRC_WIELOKROTNY,
        );
        expect(a!.occurrence).toBe(2);
    });

    it("remis odleglosci -> wczesniejsze wystapienie (deterministycznie)", () => {
        // Dwa wystapienia "ab" w "ab__ab", hint dokladnie w srodku.
        const src = "ab__ab";
        const occ = findOccurrences("ab", src); // [0, 4]
        const srodek = (occ[0]! + occ[1]!) / 2; // 2, rownoodlegly
        const a = reanchor({ rawText: "ab", startHint: srodek }, src);
        expect(a!.occurrence).toBe(0);
    });
});

describe("reanchor - jednoznaczny cytat", () => {
    it("total=1, ambiguous=false", () => {
        const src = "Jedyna fraza unikalna w tekscie.";
        const a = reanchor({ rawText: "fraza unikalna" }, src);
        expect(a!.total).toBe(1);
        expect(a!.ambiguous).toBe(false);
        expect(a!.occurrence).toBe(0);
    });
});

describe("findOccurrences", () => {
    it("zwraca starty wszystkich nienakladajacych wystapien", () => {
        const src = "aa aa aa";
        expect(findOccurrences("aa", src)).toEqual([0, 3, 6]);
    });

    it("pusta lista gdy brak trafienia", () => {
        expect(findOccurrences("xyz", "abc")).toEqual([]);
    });
});

describe("locatorFor + round-trip", () => {
    it("buduje lokator, ktory re-kotwiczy sie na tym samym spanie", () => {
        const frag = "Strona zobowiazuje sie";
        const wszystkie = findOccurrences(frag, SRC_WIELOKROTNY);
        const span = { start: wszystkie[2]!, end: wszystkie[2]! + frag.length };

        const loc = locatorFor(SRC_WIELOKROTNY, span);
        expect(loc).not.toBeNull();
        expect(loc!.rawText).toBe(frag);
        expect(loc!.occurrenceHint).toBe(2);
        expect(loc!.startHint).toBe(span.start);

        const a = reanchor(loc!, SRC_WIELOKROTNY);
        expect(a!.start).toBe(span.start);
        expect(a!.end).toBe(span.end);
        expect(a!.occurrence).toBe(2);
    });

    it("round-trip przezywa edycje ZA cytatem (occurrenceHint stabilny)", () => {
        const frag = "Strona zobowiazuje sie";
        const wszystkie = findOccurrences(frag, SRC_WIELOKROTNY);
        const span = { start: wszystkie[1]!, end: wszystkie[1]! + frag.length };
        const loc = locatorFor(SRC_WIELOKROTNY, span);

        // Symulacja reparse: doklejony tekst NA KONCU (za drugim wystapieniem),
        // pozycje wystapien 0 i 1 sie nie zmieniaja.
        const poEdycji = SRC_WIELOKROTNY + " Dodatkowy akapit na koncu.";
        const a = reanchor(loc!, poEdycji);
        expect(a!.occurrence).toBe(1);
        expect(poEdycji.slice(a!.start, a!.end)).toBe(frag);
    });

    it("zwraca null dla spanu poza zakresem albo pustego", () => {
        const src = "abcdef";
        expect(locatorFor(src, { start: -1, end: 3 })).toBeNull();
        expect(locatorFor(src, { start: 0, end: 99 })).toBeNull();
        expect(locatorFor(src, { start: 3, end: 3 })).toBeNull();
    });

    it("span w srodku innego wystapienia -> lokator z samym startHint", () => {
        // "abab": "ab" ma nienakladajace wystapienia [0, 2]. Span {1,3} = "ba"
        // - to inna tresc, jej jedyne wystapienie jest na 1, wiec occurrenceHint
        // sie znajdzie. Dobierzmy przypadek, gdzie start nie jest startem
        // zadnego nienakladajacego wystapienia wlasnej tresci:
        const src = "aaaa"; // "aa" nienakladajaco: [0, 2]
        const span = { start: 1, end: 3 }; // "aa", ale start=1 nie jest w [0,2]
        const loc = locatorFor(src, span);
        expect(loc).not.toBeNull();
        expect(loc!.rawText).toBe("aa");
        expect(loc!.startHint).toBe(1);
        expect(loc!.occurrenceHint).toBeUndefined();
        // mimo to re-kotwiczy verbatim (najblizej startHint=1 -> wystapienie 0 lub 1)
        const a = reanchor(loc!, src);
        expect(src.slice(a!.start, a!.end)).toBe("aa");
    });
});

describe("locatorFromQuote", () => {
    const SRC = "Sad uznal, ze powodztwo jest zasadne w calosci.";

    it("fragment verbatim -> lokator na pierwszym wystapieniu", () => {
        const loc = locatorFromQuote("powodztwo jest zasadne", SRC);
        expect(loc).not.toBeNull();
        expect(loc!.rawText).toBe("powodztwo jest zasadne");
        expect(loc!.startHint).toBe(SRC.indexOf("powodztwo jest zasadne"));
        // niezmiennik: re-kotwiczy verbatim
        const a = reanchor(loc!, SRC);
        expect(SRC.slice(a!.start, a!.end)).toBe("powodztwo jest zasadne");
    });

    it("fragment nie-verbatim -> null (fail-closed)", () => {
        expect(locatorFromQuote("fraza ktorej nie ma", SRC)).toBeNull();
        expect(locatorFromQuote("", SRC)).toBeNull();
        expect(locatorFromQuote("x", "")).toBeNull();
    });

    it("wielokrotny fragment -> kotwiczy pierwsze, occurrenceHint 0", () => {
        const src = "zgoda. zgoda. zgoda.";
        const loc = locatorFromQuote("zgoda", src);
        expect(loc!.startHint).toBe(0);
        expect(loc!.occurrenceHint).toBe(0);
    });
});

describe("locatorFromCollapsedQuote", () => {
    it("dopasowuje mimo roznic bialych znakow i odzyskuje surowy span", () => {
        // zrodlo z nowa linia i podwojnymi spacjami; cytat z pojedynczymi
        const src = "Klauzula  poufnosci\nobowiazuje obie strony umowy.";
        const quote = "Klauzula poufnosci obowiazuje obie strony";
        const loc = locatorFromCollapsedQuote(quote, src);
        expect(loc).not.toBeNull();
        // rawText jest DOSLOWNYM surowym fragmentem (z oryginalnymi bialymi znakami)
        const a = reanchor(loc!, src);
        expect(src.slice(a!.start, a!.end)).toBe(loc!.rawText);
        // i po zwinieciu == zapytanie
        expect(loc!.rawText.replace(/\s+/g, " ")).toBe(quote);
        // bez wiodacych/koncowych bialych znakow
        expect(loc!.rawText).toBe(loc!.rawText.trim());
    });

    it("exact-quote tez dziala (degeneracja do pojedynczych spacji)", () => {
        const src = "Sad orzekl, ze powodztwo jest zasadne.";
        const loc = locatorFromCollapsedQuote("powodztwo jest zasadne", src);
        expect(loc!.rawText).toBe("powodztwo jest zasadne");
    });

    it("rozne wielkosci liter NIE sa tolerowane (tylko whitespace)", () => {
        const src = "Tekst Wielka Litera.";
        expect(locatorFromCollapsedQuote("tekst wielka litera", src)).toBeNull();
    });

    it("brak dopasowania / puste -> null", () => {
        expect(locatorFromCollapsedQuote("nie ma tego", "inny tekst")).toBeNull();
        expect(locatorFromCollapsedQuote("", "abc")).toBeNull();
        expect(locatorFromCollapsedQuote("abc", "")).toBeNull();
    });

    it("tabulacje i mieszane biale znaki", () => {
        const src = "Pozycja\t1 000,00 zl netto";
        const loc = locatorFromCollapsedQuote("Pozycja 1 000,00 zl", src);
        expect(loc).not.toBeNull();
        expect(loc!.rawText.replace(/\s+/g, " ")).toBe("Pozycja 1 000,00 zl");
    });
});

describe("locateChunkSpans (ADR-0124, Route B)", () => {
    it("mapuje chunki collapsed na surowe spany; slice zwija sie do tresci", () => {
        const src = "Akapit  pierwszy\nz lamaniem.\n\nAkapit drugi tutaj.";
        const c1 = "Akapit pierwszy z lamaniem.";
        const c2 = "Akapit drugi tutaj.";
        const spans = locateChunkSpans(src, [c1, c2]);
        expect(spans).toHaveLength(2);
        expect(
            src.slice(spans[0]!.start, spans[0]!.end).replace(/\s+/g, " "),
        ).toBe(c1);
        expect(src.slice(spans[1]!.start, spans[1]!.end)).toBe("Akapit drugi tutaj.");
        expect(spans[1]!.start).toBeGreaterThan(spans[0]!.start);
    });

    it("forward-scan: dwa identyczne chunki dostaja KOLEJNE wystapienia", () => {
        const src = "Klauzula poufnosci.\n\nInny tekst.\n\nKlauzula poufnosci.";
        const spans = locateChunkSpans(src, [
            "Klauzula poufnosci.",
            "Klauzula poufnosci.",
        ]);
        expect(spans[0]).not.toBeNull();
        expect(spans[1]).not.toBeNull();
        expect(spans[1]!.start).toBeGreaterThan(spans[0]!.start);
        expect(src.slice(spans[0]!.start, spans[0]!.end)).toBe("Klauzula poufnosci.");
        expect(src.slice(spans[1]!.start, spans[1]!.end)).toBe("Klauzula poufnosci.");
    });

    it("chunk nieobecny w zrodle -> null (fail-closed), nie wywraca reszty", () => {
        const src = "Tylko ten akapit istnieje.";
        const spans = locateChunkSpans(src, [
            "Tylko ten akapit istnieje.",
            "Czego tu nie ma",
        ]);
        expect(spans[0]).not.toBeNull();
        expect(spans[1]).toBeNull();
    });

    it("puste zrodlo / pusty chunk -> null", () => {
        expect(locateChunkSpans("", ["cokolwiek"])).toEqual([null]);
        expect(locateChunkSpans("abc def", ["   "])).toEqual([null]);
    });

    it("span jest re-kotwiczalny (round-trip przez locatorFor)", () => {
        const src = "Sad  ustalil\nnastepujacy stan faktyczny sprawy.";
        const [span] = locateChunkSpans(src, [
            "Sad ustalil nastepujacy stan faktyczny sprawy.",
        ]);
        expect(span).not.toBeNull();
        const loc = locatorFor(src, span!);
        expect(loc).not.toBeNull();
        expect(src.slice(span!.start, span!.end)).toBe(loc!.rawText);
    });
});
