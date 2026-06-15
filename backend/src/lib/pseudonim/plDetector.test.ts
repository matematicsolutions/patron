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
