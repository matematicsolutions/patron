// Bramka na LUSTRO sciezek LibreOffice i na klase defektu, ktory sie za nim krył.
//
// Pomiar 2026-09-09: `docxToPdf` (czyli `libreoffice-convert`, czyli osobny proces
// `soffice`) kosztowal 25-40 s NA DOKUMENT i stal na sciezce zadania ingestu.
// Import folderu z 50 pismami trwal ponad 20 minut. Tuz obok `indexDocument` bylo
// juz z tej sciezki zdjete, z komentarzem "embedding trwa kilka sekund, nie
// blokujemy odpowiedzi" - czyli ktos swiadomie odsunal etap kilkusekundowy,
// a czterdziestosekundowy zostawil.
//
// Drugi, gorszy skutek: LibreOffice NIE jedzie w instalatorze
// (`desktop/scripts/prepare-resources.cjs` stage'uje OCR, Pythona i model
// embeddingow - jego nie), a `docs/INSTALACJA.md` nazywa go wymogiem
// OPCJONALNYM. Bez niego stary, binarny `.doc` byl dla nas nieczytelny
// (`extractDocxBodyText` to parser ZIP-a, `.doc` to OLE), wiec plik ladowal
// w bazie jako "ready", bez tekstu, bez indeksu i bez podgladu - po cichu.
//
// `sofficeCandidates()` jest KOPIA listy z `libreoffice-convert`, bo biblioteka
// nie eksportuje ani listy, ani funkcji "czy jest", a jedyna alternatywa -
// probna konwersja - kosztuje te 25-40 s. Kopia bez bramki gnije przy pierwszym
// podbiciu wersji, wiec test ponizej czyta ZRODLO biblioteki z node_modules
// i porownuje. Wzorzec: zgodnosc formatu mierz cudzym czytnikiem.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isLibreOfficeAvailable, sofficeCandidates } from "./convert";

const ZRODLO_BIBLIOTEKI = path.resolve(
    __dirname,
    "..",
    "..",
    "node_modules",
    "libreoffice-convert",
    "index.js",
);

/**
 * Literaly sciezek do binarki w zrodle biblioteki.
 *
 * Wzorzec musi byc WASKI: pierwsza wersja lapala `'...'` z samym slowem
 * "soffice" i wciagnela fragment kodu (`args.push(tempdir.name)`), czyli
 * zglosila rozjazd, ktorego nie ma. Falszywy alarm w bramce jest tak samo
 * szkodliwy jak przeoczenie - uczy przechodzic obok czerwonego.
 */
function literalyBiblioteki(): string[] {
    const src = readFileSync(ZRODLO_BIBLIOTEKI, "utf8");
    return [...src.matchAll(/'([^'\n]+)'/g)]
        .map((m) => m[1]!)
        .filter(
            (s) =>
                /^[A-Za-z0-9 _.:~/\\-]+$/.test(s) &&
                (s.includes("/") || s.includes("\\")) &&
                /(soffice(\.exe)?|libreoffice)$/i.test(s),
        );
}

const naSlashe = (s: string) => s.replace(/\\/g, "/").toLowerCase();

describe("lustro sciezek LibreOffice", () => {
    it("ekstraktor widzi ZNANE sciezki - kontrola pozytywna mianownika", () => {
        // Bramka, ktora nie ma na czym zadzialac, przechodzi zawsze - a zle
        // zawezony ekstraktor jest wlasnie takim przypadkiem: milczy i swieci
        // na zielono. Dlatego sprawdzamy najpierw, czy w ogole cos widzi, i to
        // konkretnie te sciezki, o ktorych wiemy, ze tam sa.
        const literaly = literalyBiblioteki().map(naSlashe);
        expect(
            literaly.length,
            "brak literalow sciezek w libreoffice-convert - zmienil sie uklad zrodla, lustro stracilo przedmiot",
        ).toBeGreaterThan(5);
        for (const znana of [
            "/applications/libreoffice.app/contents/macos/soffice",
            "/usr/bin/libreoffice",
            "libreoffice/program/soffice.exe",
        ]) {
            expect(
                literaly.some((l) => l.endsWith(znana)),
                `ekstraktor nie widzi znanej sciezki ${znana} - zawezil sie i nie mierzy juz calosci`,
            ).toBe(true);
        }
        // Kontrola negatywna: fragment kodu nie jest sciezka. Pierwsza wersja
        // wzorca wciagnela `args.push(...)` i zglosila nieistniejacy rozjazd.
        expect(literaly.some((l) => l.includes("args.push"))).toBe(false);
    });

    it("kazda sciezka z biblioteki jest pokryta przez nasza liste", () => {
        const nasze = (["win32", "darwin", "linux"] as const)
            .flatMap((p) => sofficeCandidates(p))
            .map(naSlashe);

        const nieobjete = literalyBiblioteki()
            .map(naSlashe)
            .filter((lit) => !nasze.some((n) => n.endsWith(lit) || n === lit));

        expect(
            nieobjete,
            "libreoffice-convert szuka binarki pod sciezka, ktorej nasz `sofficeCandidates` " +
                "nie zna. Skutek: zglosimy 'brak LibreOffice' na maszynie, na ktorej ON JEST - " +
                "czyli odrzucimy .doc, ktory dalibysmy rade otworzyc. Dopisz sciezke do convert.ts.",
        ).toEqual([]);
    });

    it("zmienna LIBRE_OFFICE_EXE jest honorowana (to nasza jedyna furtka konfiguracyjna)", () => {
        const stara = process.env.LIBRE_OFFICE_EXE;
        try {
            process.env.LIBRE_OFFICE_EXE = "X:/wlasna/sciezka/soffice.exe";
            expect(sofficeCandidates("win32")).toContain(
                "X:/wlasna/sciezka/soffice.exe",
            );
        } finally {
            if (stara === undefined) delete process.env.LIBRE_OFFICE_EXE;
            else process.env.LIBRE_OFFICE_EXE = stara;
        }
    });

    it("puste wpisy nie robia z katalogu glownego binarki", () => {
        // `path.join('', 'LibreOffice/program/soffice.exe')` daje sciezke WZGLEDNA,
        // a pusty `LIBRE_OFFICE_EXE` daje pusty string. Ani jedno, ani drugie nie
        // moze przypadkiem trafic w istniejacy plik i udac, ze LibreOffice jest.
        const stara = process.env.LIBRE_OFFICE_EXE;
        try {
            process.env.LIBRE_OFFICE_EXE = "";
            expect(sofficeCandidates("win32")).not.toContain("");
        } finally {
            if (stara === undefined) delete process.env.LIBRE_OFFICE_EXE;
            else process.env.LIBRE_OFFICE_EXE = stara;
        }
    });

    it("isLibreOfficeAvailable zwraca boolean i nie rzuca", () => {
        // Wynik zalezy od maszyny (u WM LibreOffice JEST, w CI zwykle nie), wiec
        // asercja dotyczy kontraktu, nie wartosci. Wartosc sprawdza `typDozwolony`
        // w documentIngest.test.ts - na wstrzyknietych zdolnosciach.
        expect(typeof isLibreOfficeAvailable()).toBe("boolean");
    });
});
