// Testy detekcji regex-based encji prawa polskiego.
//
// Skupiamy sie na piecu top kategoriach sygnatur (SN, NSA, WSA, KIO, TK)
// + identyfikatory PII + CELEX/ELI + firmy z forma prawna.
//
// Test corpus to fragmenty stylizowane na realne opinie kancelarii
// (anonimizowane). Walidacja recall+precision na realnych dokumentach
// jest zaplanowana w T2 planu migracji ADR-0008.

import { describe, expect, it } from "vitest";
import { detectAll, PL_EXTRACTION_RULES } from "./regex";

describe("detectAll - identyfikatory PII", () => {
    it("wykrywa walidny PESEL", () => {
        const text = "Klient Jan Kowalski, PESEL 44051401458, zwrocil sie...";
        const matches = detectAll(text);
        const pesels = matches.filter((m) => m.type === "PESEL");
        expect(pesels).toHaveLength(1);
        expect(pesels[0]!.normalized).toBe("44051401458");
        expect(pesels[0]!.confidence).toBe(1.0);
    });

    it("nie wykrywa PESEL z bledna checksuma", () => {
        const text = "Numer 44051401459 nie jest PESELem.";
        const matches = detectAll(text);
        expect(matches.filter((m) => m.type === "PESEL")).toHaveLength(0);
    });

    it("wykrywa NIP z dash i normalizuje", () => {
        const text = "Spolka o NIP 525-228-70-09 zawarla umowe.";
        const matches = detectAll(text);
        const nips = matches.filter((m) => m.type === "NIP");
        expect(nips).toHaveLength(1);
        expect(nips[0]!.normalized).toBe("5252287009");
    });

    it("wykrywa REGON 9-cyfrowy i 14-cyfrowy", () => {
        const text = "REGON podstawowy: 123456785. REGON 14: 12345678500002.";
        const matches = detectAll(text);
        const regons = matches.filter((m) => m.type === "REGON");
        expect(regons).toHaveLength(2);
    });

    it("wykrywa KRS tylko z prefixem", () => {
        const text = "KRS: 0000123456, ale samo 1234567890 to nie KRS.";
        const matches = detectAll(text);
        const krs = matches.filter((m) => m.type === "KRS");
        expect(krs).toHaveLength(1);
        expect(krs[0]!.normalized).toBe("0000123456");
    });

    it("wykrywa email i normalizuje na lowercase", () => {
        const text = "Kontakt: Kancelaria@Example.PL.";
        const matches = detectAll(text);
        const emails = matches.filter((m) => m.type === "EMAIL");
        expect(emails).toHaveLength(1);
        expect(emails[0]!.normalized).toBe("kancelaria@example.pl");
    });

    it("wykrywa telefon polski z prefixem +48", () => {
        const text = "Tel: +48 123 456 789.";
        const matches = detectAll(text);
        const phones = matches.filter((m) => m.type === "PHONE");
        expect(phones).toHaveLength(1);
        expect(phones[0]!.normalized).toBe("+48123456789");
    });
});

describe("detectAll - sygnatury orzeczen polskich", () => {
    it("wykrywa sygnature Sadu Najwyzszego", () => {
        const text = "Wyrok SN z 12.03.2024 r., sygn. III CZP 11/13.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.type === "SYGNATURA_ORZECZENIA" && m.ruleId === "signature-sn",
        );
        expect(sigs).toHaveLength(1);
        expect(sigs[0]!.normalized).toBe("III CZP 11/13");
    });

    it("wykrywa sygnature Naczelnego Sadu Administracyjnego", () => {
        const text = "Wyrok NSA z 5.05.2022 r., II FSK 1234/22.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.type === "SYGNATURA_ORZECZENIA" && m.ruleId === "signature-nsa",
        );
        expect(sigs).toHaveLength(1);
        expect(sigs[0]!.normalized).toBe("II FSK 1234/22");
    });

    it("wykrywa sygnature WSA z miastem", () => {
        const text = "WSA w Warszawie, II SA/Wa 1234/24.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.type === "SYGNATURA_ORZECZENIA" && m.ruleId === "signature-wsa",
        );
        expect(sigs).toHaveLength(1);
        expect(sigs[0]!.normalized).toBe("II SA/Wa 1234/24");
    });

    it("wykrywa sygnature KIO z i bez prefiksu UZP", () => {
        const text = "Wyrok KIO 1234/24 z poprzedniego tygodnia, takze KIO/UZP 56/23.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.type === "SYGNATURA_ORZECZENIA" && m.ruleId === "signature-kio",
        );
        expect(sigs).toHaveLength(2);
    });

    it("wykrywa sygnature Trybunalu Konstytucyjnego z niskim confidence", () => {
        const text = "TK rozpatrzyl K 12/19 oraz SK 5/22.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.type === "SYGNATURA_ORZECZENIA" && m.ruleId === "signature-tk",
        );
        expect(sigs.length).toBeGreaterThanOrEqual(2);
        for (const s of sigs) {
            expect(s.confidence).toBeLessThanOrEqual(0.7); // niski - duze false-positive ryzyko
        }
    });

    it("wykrywa sygnature sadu powszechnego z kodem jednoliterowym (I C 100/26)", () => {
        const text = "Sygn. akt I C 100/26 - pozew o zaplate.";
        const matches = detectAll(text);
        const sigs = matches.filter(
            (m) => m.ruleId === "signature-sad-powszechny",
        );
        expect(sigs).toHaveLength(1);
        expect(sigs[0]!.normalized).toBe("I C 100/26");
    });

    it.each([
        ["I Ns 50/25", "I Ns 50/25"], // nieprocesowy - kod mieszany
        ["II K 200/24", "II K 200/24"], // karny - kod jednoliterowy
        ["II Ca 300/25", "II Ca 300/25"], // cywilny odwolawczy - kod mieszany
        ["XXV C 1500/23", "XXV C 1500/23"], // wysoki numer wydzialu (duzy sad)
        ["I ACa 1234/23", "I ACa 1234/23"], // sad apelacyjny - kod mieszany
    ])("wykrywa sygnature sadu powszechnego/apelacyjnego: %s", (input, expected) => {
        const matches = detectAll(`Wyrok ${input} z 2026 r.`);
        const sigs = matches.filter((m) => m.ruleId === "signature-sad-powszechny");
        expect(sigs).toHaveLength(1);
        expect(sigs[0]!.normalized).toBe(expected);
    });

    it("zachowuje wielkosc liter kodu wydzialu (Ns != NS)", () => {
        const matches = detectAll("I Ns 50/25");
        const sig = matches.find((m) => m.ruleId === "signature-sad-powszechny");
        expect(sig!.normalized).toBe("I Ns 50/25");
    });

    it("nie duplikuje sygnatury SN (III CZP) regula sadu powszechnego", () => {
        const matches = detectAll("sygn. III CZP 11/13");
        const sn = matches.filter((m) => m.ruleId === "signature-sn");
        const powszechny = matches.filter((m) => m.ruleId === "signature-sad-powszechny");
        expect(sn).toHaveLength(1);
        expect(powszechny).toHaveLength(0); // kod 2-4 wielkich liter = teren SN, nie powszechny
    });

    it("kody w pelni wielkoliterowe (RC, GC) pozostaja w gestii signature-sn (partycja bez duplikatu)", () => {
        // "II GC 100/26" (gospodarczy) ma kod 2 wielkich liter - lapany przez
        // generyczna regule signature-sn (rzymska + [A-Z]{2,4}), NIE powszechny.
        const matches = detectAll("Wyrok II GC 100/26");
        const sn = matches.filter((m) => m.ruleId === "signature-sn");
        const powszechny = matches.filter((m) => m.ruleId === "signature-sad-powszechny");
        expect(sn).toHaveLength(1);
        expect(powszechny).toHaveLength(0);
    });

    it("nie lapie sygnatury WSA (II SA/Wa) regula sadu powszechnego", () => {
        const matches = detectAll("Wyrok II SA/Wa 1234/24");
        const powszechny = matches.filter((m) => m.ruleId === "signature-sad-powszechny");
        expect(powszechny).toHaveLength(0);
    });
});

describe("detectAll - sygnatury aktow prawnych", () => {
    it("wykrywa CELEX dla aktow UE", () => {
        const text =
            "Zgodnie z Regulation 2024/1689 (CELEX 32024R1689), AI Act art. 12...";
        const matches = detectAll(text);
        const celex = matches.filter((m) => m.ruleId === "celex-eu-act");
        expect(celex).toHaveLength(1);
        expect(celex[0]!.normalized).toBe("32024R1689");
    });

    it("wykrywa ELI fragment dla aktow PL", () => {
        const text = "Konstytucja: /eli/sejm/konst/1997/483";
        const matches = detectAll(text);
        const eli = matches.filter((m) => m.ruleId === "eli-pl-act");
        expect(eli.length).toBeGreaterThanOrEqual(1);
    });
});

describe("detectAll - firmy z forma prawna", () => {
    it("wykrywa Sp. z o.o. i S.A.", () => {
        const text =
            "Acme Sp. z o.o. zawarla umowe z PKN Orlen S.A. w marcu 2024.";
        const matches = detectAll(text);
        const firmy = matches.filter((m) => m.type === "FIRMA");
        expect(firmy.length).toBeGreaterThanOrEqual(2);
    });

    it("nie wykrywa nazw bez formy prawnej (do LLM-fallback)", () => {
        const text = "Klient Acme zglosil reklamacje.";
        const matches = detectAll(text);
        const firmy = matches.filter((m) => m.type === "FIRMA");
        expect(firmy).toHaveLength(0);
    });
});

describe("detectAll - integracja", () => {
    it("zwraca wszystkie dopasowania posortowane wg offsetu", () => {
        const text =
            "NIP 525-228-70-09, PESEL 44051401458, sygn. III CZP 11/13, KRS: 0000123456.";
        const matches = detectAll(text);
        expect(matches.length).toBeGreaterThanOrEqual(4);
        // sortowanie po offsecie rosnaco
        for (let i = 1; i < matches.length; i++) {
            expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.start);
        }
    });

    it("dziala idempotentnie - wielokrotne wywolania zwracaja te same wyniki", () => {
        const text = "PESEL 44051401458 i NIP 5252287009.";
        const m1 = detectAll(text);
        const m2 = detectAll(text);
        const m3 = detectAll(text);
        expect(m1).toEqual(m2);
        expect(m2).toEqual(m3);
    });

    it("PL_EXTRACTION_RULES nie zawiera duplikatow id", () => {
        const ids = PL_EXTRACTION_RULES.map((r) => r.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });
});
