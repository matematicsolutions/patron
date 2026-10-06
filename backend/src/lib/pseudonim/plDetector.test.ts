import { describe, it, expect } from "vitest";
import { plEntityDetector } from "./plDetector";
import { wrapInto, unwrap } from "./wrap";
import { createPseudonimMap } from "./map";

async function detect(text: string) {
    return plEntityDetector.detect(text);
}

function cats(hits: Array<{ span: string; category: string }>, cat: string) {
    return hits.filter((h) => h.category === cat).map((h) => h.span);
}

describe("plEntityDetector - PERSON (zakotwiczony na markerze)", () => {
    it("lapie nazwisko po honoryfikatorze (Pan/Pani)", async () => {
        const h = await detect("Wczoraj Pan Jan Kowalski zlozyl wniosek.");
        expect(cats(h, "PERSON")).toContain("Jan Kowalski");
    });

    it("lapie nazwisko po tytule zawodowym (adw./mec.)", async () => {
        const h = await detect("Pismo sporzadzil adw. Anna Nowak-Kowalska.");
        expect(cats(h, "PERSON")).toContain("Anna Nowak-Kowalska");
    });

    it("lapie nazwisko po roli procesowej (oskarzony/swiadek)", async () => {
        const h = await detect("Zeznania złożył świadek Piotr Zięba.");
        expect(cats(h, "PERSON")).toContain("Piotr Zięba");
    });

    it("NIE maskuje terminow prawnych bez kotwicy osobowej (Sad Najwyzszy, Kodeks Karny)", async () => {
        const h = await detect(
            "Sad Najwyzszy w wyroku powolal Kodeks Karny oraz Konstytucje.",
        );
        expect(cats(h, "PERSON")).toEqual([]);
    });

    it("marker nie jest czescia maskowanego spanu (maskujemy tylko nazwe)", async () => {
        const h = await detect("Pani Maria Wisniewska wniosla apelacje.");
        const persons = cats(h, "PERSON");
        expect(persons).toContain("Maria Wisniewska");
        expect(persons.some((p) => p.startsWith("Pani"))).toBe(false);
    });
});

describe("plEntityDetector - ORG (reuse pl-entities, forma prawna)", () => {
    it("lapie nazwe spolki z forma prawna", async () => {
        const h = await detect("Stroną umowy jest Acme Sp. z o.o. z Poznania.");
        expect(cats(h, "ORG").some((s) => s.includes("Sp. z o.o."))).toBe(true);
    });

    it("nie wymysla ORG dla zwyklego rzeczownika bez formy prawnej", async () => {
        const h = await detect("Spotkanie odbylo sie w biurze.");
        expect(cats(h, "ORG")).toEqual([]);
    });

    // ADR-0110 - to jest szew EGRESS do chmury. Zapis mala litera
    // ("sp. z o.o.") jest dominujacy w KRS i pismach; dopoki regex go nie
    // lapal, nazwa podmiotu klienta wychodzila do modelu otwartym tekstem.
    it.each([
        "Acme sp. z o.o.",
        "Acme Sp. z o.o.",
        "Acme s.a.",
        "Acme S.A.",
        "Acme sp.k.",
        "Acme spolka cywilna",
    ])("maskuje ORG niezaleznie od wielkosci liter formy: %s", async (nazwa) => {
        const h = await detect(`Stroną umowy jest ${nazwa} z Poznania.`);
        expect(cats(h, "ORG").some((s) => s.includes(nazwa))).toBe(true);
    });
});

describe("plEntityDetector - ADDRESS", () => {
    it("lapie kod pocztowy", async () => {
        const h = await detect("Adres: 00-950 Warszawa.");
        expect(cats(h, "ADDRESS")).toContain("00-950");
    });

    it("lapie ulice z numerem", async () => {
        const h = await detect("Siedziba przy ul. Marszalkowska 12/5 w stolicy.");
        expect(cats(h, "ADDRESS").some((s) => /Marszalkowska\s+12/.test(s))).toBe(
            true,
        );
    });
});

describe("plEntityDetector - integracja z wrap/unwrap (round-trip)", () => {
    it("maskuje nazwisko do tokenu, unwrap przywraca oryginal", async () => {
        const map = createPseudonimMap();
        const masked = await wrapInto(map, "Pan Jan Kowalski przyszedl.", {
            llmDetector: plEntityDetector,
        });
        expect(masked).not.toContain("Jan Kowalski");
        expect(masked).toMatch(/\[PERSON_\d+\]/);
        // marker zostaje, tylko nazwa zamaskowana
        expect(masked).toContain("Pan ");
        const restored = unwrap(masked, map);
        expect(restored).toContain("Jan Kowalski");
    });

    it("to samo nazwisko dostaje ten sam token w calej konwersacji", async () => {
        const map = createPseudonimMap();
        const a = await wrapInto(map, "Pan Jan Kowalski zeznal.", {
            llmDetector: plEntityDetector,
        });
        const b = await wrapInto(map, "Pani sedzia wezwala Pana Jana ponownie.", {
            llmDetector: plEntityDetector,
        });
        const tokenA = a.match(/\[PERSON_\d+\]/)?.[0];
        expect(tokenA).toBeTruthy();
        // "Jan Kowalski" konsekwentnie ten sam token; druga wiadomosc nie wycieka
        expect(a).not.toContain("Jan Kowalski");
        expect(b).not.toContain("Jan Kowalski");
    });

    it("pusty tekst -> brak trafien", async () => {
        expect(await detect("")).toEqual([]);
    });
});

describe("plEntityDetector - PERSON bez kotwicy i dalsze wystapienia nazwiska", () => {
    it("imie ze slownika + nazwisko w srodku zdania, bez markera roli", async () => {
        const h = await detect("Umowe podpisal Jan Kowalski w obecnosci notariusza.");
        expect(cats(h, "PERSON")).toContain("Jan Kowalski");
    });

    it("imie w odmianie rozpoznaje osobe (powodki Anny, pozwanemu Janowi)", async () => {
        const h = await detect("W imieniu powodki Anny Zielińskiej. Pozwanemu Janowi Nowakowi doręczono odpis.");
        const p = cats(h, "PERSON");
        expect(p).toContain("Anny Zielińskiej");
        expect(p).toContain("Janowi Nowakowi");
    });

    it("dalsze wystapienia nazwiska: odmiana, wersaliki, OCR bez ogonkow", async () => {
        const h = await detect(
            "Pani Anna Zielińska wniosła pozew. Zdaniem Zielińskiej umowa wygasła. ZIELIŃSKA podpisała. Po OCR: Zielinska.",
        );
        const p = cats(h, "PERSON");
        for (const f of ["Zielińskiej", "ZIELIŃSKA", "Zielinska"]) expect(p).toContain(f);
    });

    it("kontrola negatywna: sady, kodeksy i slowa o innym rdzeniu bez maskowania", async () => {
        const h = await detect(
            "Anna Zielińska, sygn. I C 123/24, art. 415 k.c. Sad Okregowy w Zielonej Gorze. Kodeks Cywilny.",
        );
        // Samo "Zielinska" z wnetrza pelnego spanu jest dopuszczalne (wrap bierze
        // dluzszy span w tym miejscu); zadna inna "osoba" pojawic sie nie moze.
        expect(new Set(cats(h, "PERSON"))).toEqual(new Set(["Anna Zielińska", "Zielińska"]));
    });

    it("wrap maskuje wszystkie formy, a unwrap odtwarza tekst co do znaku", async () => {
        const map = createPseudonimMap();
        const tekst = "Powod Jan Kowalski. Kowalskiego reprezentuje adwokat. KOWALSKI podpisal.";
        const masked = await wrapInto(map, tekst, { llmDetector: plEntityDetector });
        for (const f of ["Kowalski", "Kowalskiego", "KOWALSKI"]) expect(masked).not.toContain(f);
        expect(unwrap(masked, map)).toBe(tekst);
    });
});

describe("plEntityDetector - komparycje, tabele i dwa imiona", () => {
    it("wersaliki z komparycji i 'Nazwisko Imie' w tabeli", async () => {
        const p = cats(await detect("JAN KOWALCZYK, zamieszkaly w Lodzi.\nLp. 1 | Nowak Anna | ul. Polna 5"), "PERSON");
        expect(p).toContain("JAN KOWALCZYK");
        expect(p).toContain("Nowak Anna");
    });

    it("dwa imiona: nazwisko po nich nie przecieka", async () => {
        const p = cats(await detect("Stawila sie Anna Maria Nowak, legitymujaca sie dowodem."), "PERSON");
        expect(p).toContain("Anna Maria Nowak");
    });

    it("kontrola negatywna: rola + imie w zdaniu i tytuly wersalikami to nie osoby", async () => {
        const h = await detect("Pozwany Jan zeznal, ze nie pamieta. UMOWA SPRZEDAZY. PROTOKOL ZGROMADZENIA.");
        expect(cats(h, "PERSON")).toEqual([]);
    });
});

describe("plEntityDetector - ORG: dalsze wystapienia nazwy i organizacje", () => {
    it("nazwa spolki bez formy, w odmianie i wersalikami", async () => {
        const o = cats(await detect("Termika Wschód sp. z o.o. wezwała dłużnika. Termika żąda zapłaty, pełnomocnik Termiki odpowie. TERMIKA WSCHÓD też."), "ORG");
        for (const x of ["Termika", "Termiki", "TERMIKA WSCHÓD"]) expect(o).toContain(x);
    });
    it("fundacja i stowarzyszenie z nazwa; rzeczownik ogolny nie jest propagowany", async () => {
        const o = cats(await detect("Członkiem jest Stowarzyszenie Kupców Rynku Jeżyckiego. Umowę zawarło Centrum Logistyczne Wola sp. z o.o. Centrum miasta jest zakorkowane."), "ORG");
        expect(o).toContain("Stowarzyszenie Kupców Rynku Jeżyckiego");
        expect(o).not.toContain("Centrum");
    });
});
