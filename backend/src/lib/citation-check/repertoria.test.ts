// R-CC-01 (ADR-0157): biala lista repertoriow sadowych i sygnatura wlasnej
// sprawy. Zasada: lepiej nie wyslac niz wyslac cos, co nie jest sygnatura.
// Dane syntetyczne; sygnatury to publiczne ksztalty identyfikatorow.
import { describe, expect, it } from "vitest";
import { jestSygnaturaSadu, rozbierz, sygnaturyWlasnejSprawy } from "./repertoria";

describe("jestSygnaturaSadu - przechodza sygnatury sadow", () => {
    it.each([
        "II CSKP 1/24", // SN, Izba Cywilna
        "III CZP 6/21",
        "IV KK 168/22", // SN, Izba Karna
        "I KZP 12/20",
        "II PSKP 3/22", // SN, Izba Pracy
        "I NSNc 12/20", // SN, Izba Kontroli Nadzwyczajnej
        "I NSNC 12/20", // ... wersalikami, jak w korpusie
        "V ACa 908/13", // sad apelacyjny
        "V ACA 908/13",
        "I C 1234/25", // sad rejonowy
        "XXV C 12/2020",
        "II Ca 77/24",
        "VIII GC 5/23",
        "III AUa 12/21",
        "II AKa 3/19",
        "IV Kp 15/22",
        "I OSK 590/26", // NSA
        "II GSK 1/20",
        "I FZ 104/26",
        "III SA/Wa 2809/25", // WSA
        "II SAB/Kr 4/21",
        "I SA/Łd 7/20",
        "KIO 3088/24", // KIO - bez numeru rzymskiego
        "SNO 12/15",
        "II CSK P 1644/22", // rozbite przez PDF, sklejone jak w ekstraktorze
    ])("%s", (s) => {
        expect(jestSygnaturaSadu(s)).toBe(true);
    });

    it("literowka w symbolu z listy (przestawione sasiednie litery) wychodzi - wykrycie jej to sedno sprawdzenia", () => {
        expect(jestSygnaturaSadu("II CKSP 820/23")).toBe(true);
    });

    it("TK bez numeru rzymskiego tylko z TK/Trybunalem w poblizu", () => {
        expect(jestSygnaturaSadu("K 1/20")).toBe(false);
        expect(jestSygnaturaSadu("K 1/20", "wyrok TK z dnia 22 pazdziernika 2020 r., ")).toBe(true);
        expect(jestSygnaturaSadu("SK 3/21", "Trybunal Konstytucyjny w sprawie ")).toBe(true);
        expect(jestSygnaturaSadu("P 7/20", "Trybunał w wyroku ")).toBe(true);
    });
});

describe("jestSygnaturaSadu - NIE przechodzi to, co tylko wyglada jak sygnatura", () => {
    it.each([
        ["Polna 12/24", "adres"],
        ["KRD 4471/2019", "numer umowy"],
        ["FV 123/2024", "faktura"],
        ["A 5678/2021", "repertorium notarialne (Rep. A)"],
        ["KAN 45/2025", "sygnatura wewnetrzna kancelarii"],
        ["C 1234/25", "symbol sadu bez numeru wydzialu"],
        ["I KAN 45/25", "numer rzymski nie czyni symbolu sadowym"],
        ["II Aca 908/13", "pisownia ani kanoniczna, ani wersalikami"],
        ["i C 12/24", "numer rzymski malymi literami"],
        ["III SA/Xx 1/20", "WSA z nieznana siedziba"],
        ["II AC 12/24", "dwuliterowe przestawienie nie jest literowka"],
        ["U 2/20", "TK bez kontekstu Trybunalu"],
    ])("%s (%s)", (s) => {
        expect(jestSygnaturaSadu(s, "Powod zamieszkuje pod adresem")).toBe(false);
    });
});

describe("rozbierz", () => {
    it("zachowuje pisownie z pisma i skleja symbol rozbity przez PDF", () => {
        expect(rozbierz("V ACa 908/13")).toEqual({ rzymski: "V", symbol: "ACa" });
        expect(rozbierz("II CSK P 1644/22")).toEqual({ rzymski: "II", symbol: "CSKP" });
        expect(rozbierz("III SA / Wa 2809/25")).toEqual({ rzymski: "III", symbol: "SA/Wa" });
        expect(rozbierz("KIO 3088/24")).toEqual({ rzymski: null, symbol: "KIO" });
        expect(rozbierz("art. 5")).toBeNull();
    });
});

describe("sygnaturyWlasnejSprawy - naglowek pisma", () => {
    it("Sygn. akt / Sygnatura akt / sygn. w naglowku, rok czterocyfrowy jak w ekstraktorze", () => {
        const t = [
            "Warszawa, dnia 1 pazdziernika 2026 r.",
            "Sad Rejonowy, I Wydzial Cywilny",
            "Sygn. akt I C 1234/25",
            "Sygnatura akt: II Ca 77/2024",
            "dot. sygn. V ACa 908/13",
        ].join("\n");
        expect([...sygnaturyWlasnejSprawy(t)].sort()).toEqual([
            "I C 1234/25",
            "II CA 77/24",
            "V ACA 908/13",
        ]);
    });

    it("sygnatura daleko za naglowkiem nie jest uznana za wlasna sprawe", () => {
        const t = `Pozew.\n${"Uzasadnienie bez powolan. ".repeat(80)}\nZob. sygn. akt II CSKP 1/24.`;
        expect(sygnaturyWlasnejSprawy(t).size).toBe(0);
    });

    it("znacznik bez sygnatury zaraz po nim nic nie daje", () => {
        expect(sygnaturyWlasnejSprawy("Sygn. akt zostanie nadana. II CSKP 1/24").size).toBe(0);
    });
});
