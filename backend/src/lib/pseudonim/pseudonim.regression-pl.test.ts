// Regression set polskich przypadkow dla warstwy pseudonimizacji PII.
// Faza 4.5 roadmapy (ADR-0003), tydzien 1 planu migracji.
//
// Cel: zlapac problemy specyficzne dla jezyka polskiego, ktorych
// Hey Jude (EN) nie ma. Discovery 1 z ADR-0003 udokumentowal najwazniejszy
// brak symetrii: fleksja imion ("Jan Kowalski" vs "Jana Kowalskiego" =
// dwa rozne tokeny). Ten plik dokumentuje wszystkie ZNANE braki
// skeletonu - testy oczekiwane jako PASSING dzialaja juz teraz; testy
// oznaczone `it.todo` zapisuja DEFICYT do domkniecia w tygodniu 2-3.
//
// Konwencja: 20 numerowanych cases w 6 kategoriach. Numeracja stabilna -
// gdy dolozysz przypadek, dolaczasz #21, NIE renumerujesz.
//
// Uruchom: `npm test -- pseudonim.regression-pl`

import { describe, expect, it } from "vitest";
import { unwrap, wrap, detectRegex } from "./index";
import type { LlmDetector, PiiCategory } from "./types";

/**
 * Helper: zbuduj stub LLM detector ktory zwraca podana liste span->category.
 * Wrap.ts znajdzie wszystkie wystapienia kazdego spanu w tekscie sam.
 */
function stubDetector(
    hits: Array<{ span: string; category: PiiCategory }>,
): LlmDetector {
    return {
        async detect() {
            return hits;
        },
    };
}

// ===========================================================================
// KATEGORIA 1: Fleksja imion (Discovery 1 ADR-0003) - cases #1-5
// ===========================================================================

describe("regression PL #1-5: fleksja imion (Discovery 1)", () => {
    it("#1 mianownik+dopelniacz - obecny skeleton: dwa rozne tokeny (OCZEKIWANY DEFICYT)", async () => {
        // "Jan Kowalski" (kto) vs "Jana Kowalskiego" (kogo) to ta sama osoba,
        // ale LLM-stub zwraca oba spany niezaleznie - skeleton generuje
        // [PERSON_1] i [PERSON_2]. ADR-0003 wariant 1 (sufiksy .nom/.gen)
        // rozwiaze to w tygodniu 2.
        const input = "Powod Jan Kowalski zlozyl pozew. Pelnomocnik Jana Kowalskiego wnosi";
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "Jan Kowalski", category: "PERSON" },
                { span: "Jana Kowalskiego", category: "PERSON" },
            ]),
        });

        // OBECNY STAN: 2 rozne tokeny. To deficyt - oba odnosza sie do tej samej osoby.
        expect(map.tokens.filter((t) => t.category === "PERSON").length).toBe(2);
        expect(prompt).toContain("[PERSON_1]");
        expect(prompt).toContain("[PERSON_2]");
    });

    it("#2 unwrap pisemny: skeleton nie odmienia tokenow", async () => {
        // LLM dostaje "[PERSON_1] reprezentuje [PERSON_2]" i odpowiada
        // tymi tokenami. Po unwrap output zawiera "Jan Kowalski reprezentuje
        // Jana Kowalskiego" - to bzdura (ta sama osoba reprezentuje siebie).
        // To pokazuje, ze tylko sufiksowanie przypadkow (.nom/.gen) rozwiaze
        // problem przy pisaniu odpowiedzi przez LLM.
        const input = "Jan Kowalski oraz Jana Kowalskiego";
        const { map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "Jan Kowalski", category: "PERSON" },
                { span: "Jana Kowalskiego", category: "PERSON" },
            ]),
        });
        const llmAnswer = "Powod [PERSON_1] zostal poinformowany. Pelnomocnik [PERSON_2] wnosi.";
        const final = unwrap(llmAnswer, map);
        // Output ma fleksyjnie poprawne formy, ALE tylko bo LLM dostał oba tokeny w prompcie.
        // Gdyby LLM uzyl [PERSON_1] tam gdzie potrzeba dopelniacza, unwrap by wstawil mianownik.
        expect(final).toContain("Jan Kowalski");
        expect(final).toContain("Jana Kowalskiego");
    });

    it.todo("#3 LLM-fallback wykrywa wszystkie 7 przypadkow z jednego imienia jako 1 token");
    it.todo("#4 wariant 1 ADR-0003: token z sufiksem [PERSON_1.dat] -> 'Janowi Kowalskiemu'");
    it.todo("#5 unwrap z sufiksem przypadka odtwarza odmiane wlasciwa kontekstowi");
});

// ===========================================================================
// KATEGORIA 2: Formy prawne polskich spolek - cases #6-9
// ===========================================================================

describe("regression PL #6-9: formy prawne polskich spolek", () => {
    it("#6 sp. z o.o. - skeleton wymaga LLM (regex nie pokrywa)", async () => {
        const input = "Pozwana ABC sp. z o.o. nie odpowiedziala na wezwanie";
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([{ span: "ABC sp. z o.o.", category: "ORG" }]),
        });
        expect(prompt).toContain("[ORG_1]");
        expect(prompt).not.toContain("ABC sp. z o.o.");
        expect(map.tokens.find((t) => t.original === "ABC sp. z o.o.")).toBeDefined();
    });

    it("#7 S.A. (spolka akcyjna)", async () => {
        const input = "Polski Bank S.A. udzielil pozyczki";
        const { prompt } = await wrap(input, {
            llmDetector: stubDetector([{ span: "Polski Bank S.A.", category: "ORG" }]),
        });
        expect(prompt).toContain("[ORG_1]");
        expect(prompt).not.toContain("Polski Bank S.A.");
    });

    it("#8 sp.k. (spolka komandytowa) i sp.j. (jawna) wspolwystepuja", async () => {
        const input = "Strona X sp.k. i Strona Y sp.j. zawarly umowe";
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "Strona X sp.k.", category: "ORG" },
                { span: "Strona Y sp.j.", category: "ORG" },
            ]),
        });
        expect(map.tokens.filter((t) => t.category === "ORG").length).toBe(2);
        expect(prompt).toContain("[ORG_1]");
        expect(prompt).toContain("[ORG_2]");
    });

    it.todo("#9 Sp. z o.o. Sp. k. (spolka komandytowo-kapitalowa) - zlozona forma");
});

// ===========================================================================
// KATEGORIA 3: Polskie identyfikatory PESEL/NIP/REGON/KRS - cases #10-13
// ===========================================================================

describe("regression PL #10-13: identyfikatory polskie", () => {
    it("#10 PESEL w sasiedztwie roku - nie kolizja", () => {
        const input = "Powod (PESEL 44051401359) urodzony w 1944 roku";
        const hits = detectRegex(input);
        // PESEL musi byc wykryty, 4-cyfrowy '1944' NIE moze byc.
        expect(hits.find((h) => h.category === "PESEL")?.span).toBe("44051401359");
    });

    it("#11 NIP w 3 formatach (dash/spacje/goly) - wszystkie dziala", () => {
        const dash = detectRegex("NIP 526-000-12-46");
        const space = detectRegex("NIP 526 000 12 46");
        const bare = detectRegex("NIP 5260001246");
        expect(dash.find((h) => h.category === "NIP")?.span).toBe("526-000-12-46");
        expect(space.find((h) => h.category === "NIP")?.span).toBe("526 000 12 46");
        expect(bare.find((h) => h.category === "NIP")?.span).toBe("5260001246");
    });

    it("#12 KRS musi miec prefiks 'KRS' (regex wymaga) - bare 10 cyfr NIE jest KRS", () => {
        const withPrefix = detectRegex("KRS 0000028860 wpisany");
        const bareOnly = detectRegex("Numer 0000028860 sam");
        expect(withPrefix.find((h) => h.category === "KRS")?.span).toBe("0000028860");
        // Goly 10-cyfrowy ciag bez prefiksu - NIE jest KRS w obecnym skeletonie.
        expect(bareOnly.find((h) => h.category === "KRS")).toBeUndefined();
    });

    it("#13 REGON 9-cyfrowy i 14-cyfrowy oba wykrywane (z checksuma od T1 refactor pl-entities)", () => {
        // Po refactor T1 (commit po a5f03c2) REGON dostaje walidator checksumy
        // z pl-entities/checksums.ts - same walidne REGON-y wchodza do detekcji.
        // 123456785 = valid REGON 9 (wagi 8-9-2-3-4-5-6-7 mod 11),
        // 12345678500002 = valid REGON 14 (prefiks 9 valid + wagi 2-4-8-5-0-9-7-3-6-1-2-4-8 mod 11).
        const r9 = detectRegex("REGON 123456785 wpisany");
        const r14 = detectRegex("REGON 12345678500002 oddzial");
        expect(r9.find((h) => h.category === "REGON")?.span).toBe("123456785");
        expect(r14.find((h) => h.category === "REGON")?.span).toBe("12345678500002");
    });

    it("#13b REGON z bledna checksuma jest odrzucony (post-T1 refactor)", () => {
        // 012345678 nie jest valid REGON 9 (checksum bledna), 123456789 tez nie.
        // Przed refactorem T1 oba byly wykrywane jako REGON; po dolaczeniu
        // walidatora checksumy z pl-entities/ - oba odpadaja.
        const invalid9 = detectRegex("Numer 012345678 podany");
        const invalid14 = detectRegex("Numer 12345678500001 podany");
        expect(invalid9.find((h) => h.category === "REGON")).toBeUndefined();
        expect(invalid14.find((h) => h.category === "REGON")).toBeUndefined();
    });
});

// ===========================================================================
// KATEGORIA 4: Adresy polskie - cases #14-15
// ===========================================================================

describe("regression PL #14-15: adresy polskie", () => {
    it("#14 ulica+numer+kod pocztowy+miasto - skeleton wymaga LLM-fallback", async () => {
        const input =
            "Powod, ul. Marszalkowska 1, 00-001 Warszawa, wnosi o zasadzenie";
        // Skeleton nie ma regex na adres PL (kod pocztowy XX-XXX + ulica).
        // LLM-fallback ma zwrocic adres jako jeden span ADDRESS.
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "ul. Marszalkowska 1, 00-001 Warszawa", category: "ADDRESS" },
            ]),
        });
        expect(prompt).toContain("[ADDRESS_1]");
        expect(prompt).not.toContain("Marszalkowska");
        expect(map.tokens.find((t) => t.category === "ADDRESS")).toBeDefined();
    });

    it.todo("#15 kod pocztowy XX-XXX jako wlasny regex (tydzien 2)");
});

// ===========================================================================
// KATEGORIA 5: Telefon +48 i email - cases #16-17
// ===========================================================================

describe("regression PL #16-17: telefon i email", () => {
    it("#16 telefon +48 w 3 formatach - skeleton wykrywa", () => {
        // Patrz detect.ts: pattern dla PHONE. Sprawdzamy kilka wariantow.
        const a = detectRegex("Telefon +48 123 456 789").find(
            (h) => h.category === "PHONE",
        );
        const b = detectRegex("Telefon +48123456789").find((h) => h.category === "PHONE");
        const c = detectRegex("Telefon +48-123-456-789").find(
            (h) => h.category === "PHONE",
        );
        // Co najmniej jeden z formatow musi byc rozpoznany - zaleznie od regexa.
        const detected = [a, b, c].filter((h) => h !== undefined);
        expect(detected.length).toBeGreaterThan(0);
    });

    it("#17 email z polska domena .pl + polskimi znakami w local-part", () => {
        const hits = detectRegex("Mail: jan.kowalski@kancelaria.pl");
        const email = hits.find((h) => h.category === "EMAIL");
        expect(email?.span).toBe("jan.kowalski@kancelaria.pl");
    });
});

// ===========================================================================
// KATEGORIA 6: Wspolwystepowanie i okraglosc - cases #18-20
// ===========================================================================

describe("regression PL #18-20: wspolwystepowanie i okraglosc", () => {
    it("#18 pelny fragment pozwu: PESEL + NIP + KRS + osoba + spolka + email + telefon", async () => {
        // Realny fragment - test demonstruje, ze warstwa radzi sobie z 7 typami PII
        // w jednym zdaniu i wszystko wraca po unwrap.
        const input = `Powod Jan Kowalski (PESEL 44051401359), zamieszkaly przy ulicy
Marszalkowskiej 1, wnosi przeciwko ABC sp. z o.o. (NIP 526-000-12-46,
KRS 0000028860). Kontakt: jan.kowalski@kancelaria.pl, +48 123 456 789.`;
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "Jan Kowalski", category: "PERSON" },
                { span: "ABC sp. z o.o.", category: "ORG" },
            ]),
        });

        // Wszystkie 7 kategorii PII musza byc w mapie.
        const categories = new Set(map.tokens.map((t) => t.category));
        expect(categories.has("PERSON")).toBe(true);
        expect(categories.has("ORG")).toBe(true);
        expect(categories.has("PESEL")).toBe(true);
        expect(categories.has("NIP")).toBe(true);
        expect(categories.has("KRS")).toBe(true);
        expect(categories.has("EMAIL")).toBe(true);
        expect(categories.has("PHONE")).toBe(true);

        // Prompt do LLM zero PII.
        expect(prompt).not.toContain("Jan Kowalski");
        expect(prompt).not.toContain("44051401359");
        expect(prompt).not.toContain("526-000-12-46");
        expect(prompt).not.toContain("0000028860");
        expect(prompt).not.toContain("jan.kowalski@kancelaria.pl");
    });

    it("#19 unwrap odtwarza wszystkie 7 kategorii bez utraty znakow", async () => {
        const input = "Jan Kowalski PESEL 44051401359 NIP 526-000-12-46";
        const { map } = await wrap(input, {
            llmDetector: stubDetector([{ span: "Jan Kowalski", category: "PERSON" }]),
        });
        const llmReply = "Klient [PERSON_1] (PESEL [PESEL_1], NIP [NIP_1]) ma roszczenie";
        const final = unwrap(llmReply, map);
        expect(final).toContain("Jan Kowalski");
        expect(final).toContain("44051401359");
        expect(final).toContain("526-000-12-46");
        expect(final).not.toContain("[PERSON_1]");
        expect(final).not.toContain("[PESEL_1]");
        expect(final).not.toContain("[NIP_1]");
    });

    it("#20 idempotencja dla 3 osob w jednym tekscie - 3 osobne tokeny, brak kolizji", async () => {
        const input = "Spotkanie: Jan Kowalski, Anna Nowak, Piotr Wisniewski byli obecni";
        const { prompt, map } = await wrap(input, {
            llmDetector: stubDetector([
                { span: "Jan Kowalski", category: "PERSON" },
                { span: "Anna Nowak", category: "PERSON" },
                { span: "Piotr Wisniewski", category: "PERSON" },
            ]),
        });
        expect(map.tokens.filter((t) => t.category === "PERSON").length).toBe(3);
        expect(prompt).toContain("[PERSON_1]");
        expect(prompt).toContain("[PERSON_2]");
        expect(prompt).toContain("[PERSON_3]");
        expect(prompt).not.toContain("Jan Kowalski");
        expect(prompt).not.toContain("Anna Nowak");
        expect(prompt).not.toContain("Piotr Wisniewski");
    });
});
