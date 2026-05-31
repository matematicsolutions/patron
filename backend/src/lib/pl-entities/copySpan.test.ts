import { describe, it, expect } from "vitest";
import {
    constrainToSource,
    constrainAllToSource,
    extractCopySpans,
} from "./copySpan";

describe("constrainToSource (guard copy-mechanism)", () => {
    it("zwraca offsety dla wartosci doslownej w zrodle", () => {
        const src = "Zaplata wyniosla 1 234,56 zl w terminie.";
        const span = constrainToSource("1 234,56 zl", src);
        expect(span).not.toBeNull();
        expect(src.slice(span!.start, span!.end)).toBe("1 234,56 zl");
    });

    it("odrzuca (null) wartosc ktorej nie ma w zrodle verbatim", () => {
        const src = "W umowie kwota to 1 254,56 zl.";
        // LLM podal liczbe z bledem - guard musi odrzucic, nie poprawic.
        expect(constrainToSource("1 234,56 zl", src)).toBeNull();
    });

    it("odrzuca pusta wartosc i puste zrodlo", () => {
        expect(constrainToSource("", "cos")).toBeNull();
        expect(constrainToSource("cos", "")).toBeNull();
    });

    it("kotwiczy od offsetu `from`", () => {
        const src = "kwota 500 zl oraz druga kwota 500 zl";
        const first = constrainToSource("500 zl", src);
        expect(first).not.toBeNull();
        const second = constrainToSource("500 zl", src, {
            from: first!.end,
        });
        expect(second).not.toBeNull();
        expect(second!.start).toBeGreaterThan(first!.start);
        expect(src.slice(second!.start, second!.end)).toBe("500 zl");
    });

    it("kotwiczy ostatnie wystapienie przy occurrence=last", () => {
        const src = "data 2024-01-01 i potem 2024-12-31";
        const span = constrainToSource("2024-01-01", src, {
            occurrence: "last",
        });
        // jedno wystapienie - last == first
        expect(span).not.toBeNull();
        expect(src.slice(span!.start, span!.end)).toBe("2024-01-01");
    });

    it("inwariant: slice(start,end) === value gdy wynik != null", () => {
        const src = "Faktura na 12.000,00 PLN platna do 12.03.2024.";
        for (const v of ["12.000,00 PLN", "12.03.2024"]) {
            const span = constrainToSource(v, src);
            expect(span).not.toBeNull();
            expect(src.slice(span!.start, span!.end)).toBe(v);
        }
    });
});

describe("constrainAllToSource (wielokrotne wystapienia)", () => {
    it("zwraca wszystkie nienakladajace sie wystapienia", () => {
        const src = "1 000,00 zl, potem 1 000,00 zl i jeszcze 1 000,00 zl";
        const spans = constrainAllToSource("1 000,00 zl", src);
        expect(spans).toHaveLength(3);
        for (const s of spans) {
            expect(src.slice(s.start, s.end)).toBe("1 000,00 zl");
        }
        // nienakladajace sie
        expect(spans[0]!.end).toBeLessThanOrEqual(spans[1]!.start);
        expect(spans[1]!.end).toBeLessThanOrEqual(spans[2]!.start);
    });

    it("pusta lista gdy wartosci nie ma", () => {
        expect(constrainAllToSource("99 EUR", "nic tu nie ma")).toEqual([]);
    });
});

describe("extractCopySpans - inwariant verbatim", () => {
    it("kazdy emitowany byt spelnia slice(start,end) === value", () => {
        const src =
            "Zaplata 1 234,56 zl w dniu 12 marca 2024 r., faktura " +
            "12.000,00 PLN z 2024-03-12, oraz 500 zl do 12.03.2024.";
        const ents = extractCopySpans(src);
        expect(ents.length).toBeGreaterThan(0);
        for (const e of ents) {
            expect(src.slice(e.sourceOffsetStart, e.sourceOffsetEnd)).toBe(
                e.value,
            );
        }
    });

    it("nie emituje nic gdy zrodlo puste", () => {
        expect(extractCopySpans("")).toEqual([]);
    });
});

describe("extractCopySpans - kwoty polskie", () => {
    it("lapie kwote z separatorem tysiecy spacja i przecinkiem", () => {
        const src = "Naleznosc 1 234,56 zl.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("1 234,56 zl");
        expect(ents[0]!.metadata?.waluta).toBe("zl");
    });

    it("lapie kwote z kropka jako separatorem tysiecy i PLN", () => {
        const src = "Suma 12.000,00 PLN razem.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("12.000,00 PLN");
    });

    it("lapie kwote bez czesci dziesietnej (500 zl)", () => {
        const src = "Oplata 500 zl pobrana.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("500 zl");
    });

    it("lapie milion z dwoma separatorami tysiecy (ASCII zlotych)", () => {
        const src = "Wartosc 1 000 000,00 zlotych netto.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("1 000 000,00 zlotych");
        expect(ents[0]!.metadata?.waluta).toBe("zlotych");
    });

    it("lapie kwote ze slowem zlotych z diakrytykiem", () => {
        const src = "Kara 100 złotych nalozona.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("100 złotych");
        expect(ents[0]!.metadata?.waluta).toBe("złotych");
    });

    it("NIE lapie golej liczby bez jednostki waluty (precyzja)", () => {
        const src = "Numer sprawy 1 234 oraz strona 56.";
        const ents = extractCopySpans(src).filter((e) => e.type === "KWOTA");
        expect(ents).toHaveLength(0);
    });

    it("normalizuje kwote do formy kanonicznej (dedup)", () => {
        const src = "Kwota 1 000,00 zl tutaj.";
        const ent = extractCopySpans(src).find((e) => e.type === "KWOTA");
        expect(ent).toBeDefined();
        // separatory tysiecy usuniete, jednostka przyklejona
        expect(ent!.valueNormalized).toBe("1000,00zl");
        // ale wartosc emitowana pozostaje doslowna
        expect(ent!.value).toBe("1 000,00 zl");
    });

    it("normalizuje milion zlotych do formy kanonicznej", () => {
        const src = "Razem 1 000 000,00 zlotych brutto.";
        const ent = extractCopySpans(src).find((e) => e.type === "KWOTA");
        expect(ent).toBeDefined();
        expect(ent!.valueNormalized).toBe("1000000,00zlotych");
        expect(ent!.value).toBe("1 000 000,00 zlotych");
    });
});

describe("extractCopySpans - daty polskie", () => {
    it("lapie date ISO", () => {
        const src = "Podpisano 2024-03-12 w Warszawie.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("2024-03-12");
        expect(ents[0]!.valueNormalized).toBe("2024-03-12");
        expect(ents[0]!.metadata?.format).toBe("iso");
    });

    it("lapie date kropkowa i normalizuje do ISO", () => {
        const src = "Termin do 12.03.2024 wlacznie.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("12.03.2024");
        expect(ents[0]!.valueNormalized).toBe("2024-03-12");
    });

    it("lapie date slowna z sufiksem r. i normalizuje do ISO", () => {
        const src = "Dnia 12 marca 2024 r. zawarto umowe.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("12 marca 2024 r.");
        expect(ents[0]!.valueNormalized).toBe("2024-03-12");
        expect(ents[0]!.metadata?.format).toBe("slowna");
    });

    it("lapie date slowna bez sufiksu (1 stycznia 2020)", () => {
        const src = "Od 1 stycznia 2020 obowiazuje.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("1 stycznia 2020");
        expect(ents[0]!.valueNormalized).toBe("2020-01-01");
    });

    it("normalizuje date slowna wrzesniowa z diakrytykiem do ISO", () => {
        const src = "Zawarto dnia 5 września 2023 r. w Krakowie.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("5 września 2023 r.");
        expect(ents[0]!.valueNormalized).toBe("2023-09-05");
    });

    it("normalizuje date slowna pazdziernikowa z diakrytykiem do ISO", () => {
        const src = "Od 3 października 2022 obowiazuje aneks.";
        const ents = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(ents).toHaveLength(1);
        expect(ents[0]!.value).toBe("3 października 2022");
        expect(ents[0]!.valueNormalized).toBe("2022-10-03");
    });

    it("normalizuje wariant ASCII wrzesnia do tego samego ISO co diakrytyk", () => {
        const diakr = extractCopySpans("dnia 5 września 2023")[0];
        const ascii = extractCopySpans("dnia 5 wrzesnia 2023")[0];
        expect(diakr?.valueNormalized).toBe("2023-09-05");
        expect(ascii?.valueNormalized).toBe("2023-09-05");
    });

    it("normalizuje rozne formaty tej samej daty do tej samej formy ISO", () => {
        const a = extractCopySpans("dnia 12.03.2024 r")[0];
        const b = extractCopySpans("dnia 12 marca 2024")[0];
        const c = extractCopySpans("dnia 2024-03-12 x")[0];
        expect(a?.valueNormalized).toBe("2024-03-12");
        expect(b?.valueNormalized).toBe("2024-03-12");
        expect(c?.valueNormalized).toBe("2024-03-12");
    });
});

describe("extractCopySpans - sortowanie i nakladanie", () => {
    it("zwraca byty posortowane po pozycji startu", () => {
        const src = "Do 12.03.2024 zaplacono 500 zl, potem 2024-06-01.";
        const ents = extractCopySpans(src);
        const starts = ents.map((e) => e.sourceOffsetStart);
        const sorted = [...starts].sort((x, y) => x - y);
        expect(starts).toEqual(sorted);
    });

    it("przy nakladaniu wybiera dluzszy span (specyficznosc)", () => {
        // "12.03.2024" zlapie sie jako data kropkowa; zaden inny span sie z
        // nim nie naklada, ale sprawdzamy ze nie ma duplikatu tego samego
        // zakresu z dwoch regul.
        const src = "Data 12.03.2024 koniec.";
        const dates = extractCopySpans(src).filter((e) => e.type === "DATA");
        expect(dates).toHaveLength(1);
    });

    it("rozne wartosci obok siebie nie sa scalane", () => {
        const src = "500 zl i 2024-01-01";
        const ents = extractCopySpans(src);
        expect(ents).toHaveLength(2);
        expect(ents.map((e) => e.type).sort()).toEqual(["DATA", "KWOTA"]);
    });
});
