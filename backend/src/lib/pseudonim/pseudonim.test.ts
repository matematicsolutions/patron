import { describe, expect, it } from "vitest";
import {
    InMemoryPseudonimStore,
    addPseudonim,
    createPseudonimMap,
    detectRegex,
    isValidNip,
    isValidPesel,
    parseDetectionResponse,
    resolveToken,
    unwrap,
    wrap,
} from "./index";

describe("isValidPesel", () => {
    it("zatwierdza poprawny PESEL z checksumem (44051401359 = data 1944-05-14, checksum 9)", () => {
        expect(isValidPesel("44051401359")).toBe(true);
    });

    it("zatwierdza drugi PESEL kontrolny (02070803628)", () => {
        expect(isValidPesel("02070803628")).toBe(true);
    });

    it("odrzuca PESEL z bledna checksuma", () => {
        expect(isValidPesel("44051401358")).toBe(false);
    });

    it("odrzuca ciagi inne niz 11 cyfr", () => {
        expect(isValidPesel("123")).toBe(false);
        expect(isValidPesel("4405140135X")).toBe(false);
        expect(isValidPesel("440514013590")).toBe(false);
    });
});

describe("isValidNip", () => {
    it("zatwierdza NIP z dokumentacji MF (526-000-12-46 - Ministerstwo Finansow)", () => {
        expect(isValidNip("5260001246")).toBe(true);
        expect(isValidNip("526-000-12-46")).toBe(true);
        expect(isValidNip("526 000 12 46")).toBe(true);
    });

    it("odrzuca NIP z bledna checksuma", () => {
        expect(isValidNip("5260001247")).toBe(false);
    });
});

describe("detectRegex", () => {
    it("wykrywa PESEL w prozie", () => {
        const text = "Powod Jan Kowalski PESEL 44051401359 wnosi o zasadzenie";
        const hits = detectRegex(text);
        const peselHit = hits.find((h) => h.category === "PESEL");
        expect(peselHit?.span).toBe("44051401359");
    });

    it("odrzuca 11-cyfrowy ciag z bledna checksuma jako PESEL", () => {
        const text = "Numer 12345678901 nie jest PESEL-em";
        const hits = detectRegex(text);
        expect(hits.find((h) => h.category === "PESEL")).toBeUndefined();
    });

    it("wykrywa NIP w prozie", () => {
        const text = "ABC sp. z o.o., NIP 526-000-12-46, z siedziba w Warszawie";
        const hits = detectRegex(text);
        const nipHit = hits.find((h) => h.category === "NIP");
        expect(nipHit?.span).toBe("526-000-12-46");
    });

    it("wykrywa email", () => {
        const text = "Kontakt: jan.kowalski@kancelaria.pl";
        const hits = detectRegex(text);
        const emailHit = hits.find((h) => h.category === "EMAIL");
        expect(emailHit?.span).toBe("jan.kowalski@kancelaria.pl");
    });
});

describe("addPseudonim - deduplikacja", () => {
    it("drugie wystapienie tego samego originalu zwraca ten sam token", () => {
        const map = createPseudonimMap();
        const t1 = addPseudonim(map, "PERSON", "Jan Kowalski");
        const t2 = addPseudonim(map, "PERSON", "Jan Kowalski");
        expect(t1.token).toBe(t2.token);
        expect(map.tokens.length).toBe(1);
    });

    it("rozne osoby dostaja rozne tokeny z indeksami narastajacymi", () => {
        const map = createPseudonimMap();
        const t1 = addPseudonim(map, "PERSON", "Jan Kowalski");
        const t2 = addPseudonim(map, "PERSON", "Anna Nowak");
        expect(t1.token).toBe("[PERSON_1]");
        expect(t2.token).toBe("[PERSON_2]");
    });

    it("rozne kategorie maja niezalezne liczniki", () => {
        const map = createPseudonimMap();
        const p = addPseudonim(map, "PERSON", "Jan Kowalski");
        const n = addPseudonim(map, "PESEL", "44051401358");
        expect(p.token).toBe("[PERSON_1]");
        expect(n.token).toBe("[PESEL_1]");
    });
});

describe("resolveToken", () => {
    it("zwraca oryginal dla istniejacego tokenu", () => {
        const map = createPseudonimMap();
        addPseudonim(map, "PERSON", "Jan Kowalski");
        expect(resolveToken(map, "[PERSON_1]")).toBe("Jan Kowalski");
    });

    it("zwraca undefined dla nieznanego tokenu", () => {
        const map = createPseudonimMap();
        expect(resolveToken(map, "[PERSON_99]")).toBeUndefined();
    });
});

describe("wrap + unwrap - okraglosc", () => {
    it("happy path: PESEL + imie -> tokeny -> z powrotem", async () => {
        const input = "Powod Jan Kowalski PESEL 44051401359 wnosi o zasadzenie";
        const { prompt, map } = await wrap(input, {
            llmDetector: {
                async detect() {
                    return [{ span: "Jan Kowalski", category: "PERSON" }];
                },
            },
        });

        // Sprawdzenie ze prompt ma tokeny zamiast oryginalow
        expect(prompt).toContain("[PERSON_1]");
        expect(prompt).toContain("[PESEL_1]");
        expect(prompt).not.toContain("Jan Kowalski");
        expect(prompt).not.toContain("44051401359");

        // Symulacja odpowiedzi LLM ktora uzywa tokenow zwrotnie
        const llmAnswer =
            "Powod [PERSON_1] (PESEL [PESEL_1]) ma prawo do zasadzenia roszczenia.";
        const final = unwrap(llmAnswer, map);

        expect(final).toContain("Jan Kowalski");
        expect(final).toContain("44051401359");
        expect(final).not.toContain("[PERSON_1]");
        expect(final).not.toContain("[PESEL_1]");
    });

    it("nieznany token zostaje w outputcie (bezpieczne, niezeskanowane)", async () => {
        const map = createPseudonimMap();
        addPseudonim(map, "PERSON", "Jan Kowalski");
        const out = unwrap("Tekst z [PERSON_1] i [PERSON_99] obok", map);
        expect(out).toBe("Tekst z Jan Kowalski i [PERSON_99] obok");
    });

    it("idempotencja: dwa wystapienia tego samego oryginalu daja ten sam token", async () => {
        const input =
            "Jan Kowalski PESEL 44051401359 - Jan Kowalski reprezentuje siebie";
        const { prompt, map } = await wrap(input, {
            llmDetector: {
                async detect() {
                    // LLM zwraca pojedyncze rozpoznanie - wrap.ts znajdzie WSZYSTKIE
                    // wystapienia tego spanu w tekscie samodzielnie.
                    return [{ span: "Jan Kowalski", category: "PERSON" }];
                },
            },
        });
        // "Jan Kowalski" wystepuje 2 razy w tekscie - oba wystapienia
        // dostaja TEN SAM token [PERSON_1]
        const matches = prompt.match(/\[PERSON_1\]/g);
        expect(matches?.length).toBe(2);
        expect(map.tokens.filter((t) => t.category === "PERSON").length).toBe(1);
    });
});

describe("InMemoryPseudonimStore", () => {
    it("save + load = wlasnie zapisana mapa", async () => {
        const store = new InMemoryPseudonimStore();
        const map = createPseudonimMap();
        addPseudonim(map, "PERSON", "Jan Kowalski");

        await store.save("map-001", map);
        const loaded = await store.load("map-001");

        expect(loaded).not.toBeNull();
        expect(loaded?.tokens.length).toBe(1);
        expect(loaded?.byOriginal.get("Jan Kowalski")).toBe("[PERSON_1]");
    });

    it("delete usuwa - kolejny load zwraca null (RODO art. 17)", async () => {
        const store = new InMemoryPseudonimStore();
        const map = createPseudonimMap();
        addPseudonim(map, "PERSON", "Jan Kowalski");

        await store.save("map-001", map);
        await store.delete("map-001");
        expect(await store.load("map-001")).toBeNull();
    });
});

describe("parseDetectionResponse", () => {
    it("parsuje JSON tablice z poprawnymi kategoriami", () => {
        const raw = '[{"span": "Jan Kowalski", "category": "PERSON"}]';
        const out = parseDetectionResponse(raw);
        expect(out.length).toBe(1);
        expect(out[0]?.span).toBe("Jan Kowalski");
    });

    it("toleruje markdown backticks (```json ... ```)", () => {
        const raw = '```json\n[{"span": "ABC sp. z o.o.", "category": "ORG"}]\n```';
        const out = parseDetectionResponse(raw);
        expect(out.length).toBe(1);
        expect(out[0]?.category).toBe("ORG");
    });

    it("filtruje nieznane kategorie (np. literowka)", () => {
        const raw = '[{"span": "x", "category": "OOPS"}]';
        const out = parseDetectionResponse(raw);
        expect(out.length).toBe(0);
    });

    it("zwraca [] przy zlym JSON", () => {
        expect(parseDetectionResponse("not json")).toEqual([]);
        expect(parseDetectionResponse("{}")).toEqual([]);
    });
});
