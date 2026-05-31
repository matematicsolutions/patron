import { describe, it, expect } from "vitest";
import {
    buildWuManber,
    searchWuManber,
    findAllPatterns,
    type WuManberHit,
} from "./wuManber";
import {
    buildDictionary,
    bootstrapAnnotate,
    LEGAL_FORMS,
    type DictionaryEntry,
} from "./bootstrapAnnotate";
import { COURTS } from "./gazetteers";

/**
 * Naiwna referencja: dla kazdego wzorca skanuj indexOf po code-pointach.
 * Zwraca trafienia w tej samej konwencji co WuManber (offsety = indeksy
 * punktow kodowych). Wyrocznia inwariantu "brak false-negative".
 */
function naiveSearch(
    text: string,
    patterns: ReadonlyArray<string>,
    caseInsensitive = false,
): WuManberHit[] {
    const hay = caseInsensitive ? text.toLowerCase() : text;
    const cp = Array.from(hay);
    const hits: WuManberHit[] = [];
    for (let pi = 0; pi < patterns.length; pi++) {
        const pat = Array.from(caseInsensitive ? patterns[pi]!.toLowerCase() : patterns[pi]!);
        if (pat.length === 0) continue;
        for (let i = 0; i + pat.length <= cp.length; i++) {
            let ok = true;
            for (let k = 0; k < pat.length; k++) {
                if (cp[i + k] !== pat[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) hits.push({ start: i, end: i + pat.length, patternIndex: pi });
        }
    }
    hits.sort((x, y) => {
        if (x.start !== y.start) return x.start - y.start;
        if (x.end !== y.end) return y.end - x.end;
        return x.patternIndex - y.patternIndex;
    });
    return hits;
}

describe("WuManber - poprawnosc podstawowa", () => {
    it("znajduje pojedyncze wystapienie wzorca", () => {
        const hits = findAllPatterns("Sad Okregowy w Warszawie", ["Okregowy"]);
        expect(hits).toEqual([{ start: 4, end: 12, patternIndex: 0 }]);
    });

    it("znajduje wszystkie wystapienia tego samego wzorca", () => {
        const hits = findAllPatterns("ab ab ab", ["ab"]);
        expect(hits.map((h) => h.start)).toEqual([0, 3, 6]);
    });

    it("pusty slownik nic nie zwraca", () => {
        expect(findAllPatterns("cokolwiek", [])).toEqual([]);
    });

    it("puste wzorce sa ignorowane bez wysypania maszyny", () => {
        const hits = findAllPatterns("abc", ["", "bc"]);
        expect(hits).toEqual([{ start: 1, end: 3, patternIndex: 1 }]);
    });

    it("wzorzec nieobecny w tekscie daje zero trafien", () => {
        expect(findAllPatterns("Sad Najwyzszy", ["Trybunal"])).toEqual([]);
    });

    it("wzorzec dluzszy niz tekst nie trafia", () => {
        expect(findAllPatterns("ab", ["abcdef"])).toEqual([]);
    });
});

describe("WuManber - overlapping i rozne dlugosci", () => {
    it("raportuje nakladajace sie wzorce niezaleznie", () => {
        const hits = findAllPatterns("Sad Okregowy", ["Sad Okregowy", "Okregowy"]);
        expect(hits).toContainEqual({ start: 0, end: 12, patternIndex: 0 });
        expect(hits).toContainEqual({ start: 4, end: 12, patternIndex: 1 });
    });

    it("krotki wzorzec wewnatrz dluzszego nie ginie", () => {
        const hits = findAllPatterns("aaaa", ["aa", "aaa"]);
        const aa = hits.filter((h) => h.patternIndex === 0).map((h) => h.start);
        const aaa = hits.filter((h) => h.patternIndex === 1).map((h) => h.start);
        expect(aa).toEqual([0, 1, 2]);
        expect(aaa).toEqual([0, 1]);
    });

    it("wzorce roznej dlugosci - shift wg min length, brak false-negative", () => {
        const patterns = ["a", "abcdef", "cd"];
        const text = "xxabcdefxxcdxxa";
        expect(searchWuManber(buildWuManber(patterns), text)).toEqual(
            naiveSearch(text, patterns),
        );
    });

    it("wzorzec jednoznakowy (blockSize=1) dziala", () => {
        const hits = findAllPatterns("aXbXc", ["X"]);
        expect(hits.map((h) => h.start)).toEqual([1, 3]);
    });
});

describe("WuManber - separator bloku i kolizje", () => {
    it("blok ze spacja w srodku nie koliduje z blokiem dwoch liter", () => {
        // Wzorce: "a b" (litera-spacja-litera) i "xy". Gdyby separator klucza
        // byl spacja, blok ["a"," "] kolidowalby z blokiem dwoch znakow.
        // Z separatorem NUL kazdy blok jest jednoznaczny.
        const patterns = ["a b", "xy"];
        const text = "a b oraz xy oraz a b";
        const got = searchWuManber(buildWuManber(patterns), text);
        expect(got).toEqual(naiveSearch(text, patterns));
        // Sanity: oba wzorce trafione.
        expect(got.some((h) => h.patternIndex === 0)).toBe(true);
        expect(got.some((h) => h.patternIndex === 1)).toBe(true);
    });

    it("wzorce ze spacjami (nazwy sadow) zgadzaja sie z naiwnym skanem", () => {
        const patterns = ["Sad Okregowy", "Sad Rejonowy", "Okregowy", "Sad"];
        const text = "Sad Okregowy oraz Sad Rejonowy i znowu Sad Okregowy";
        expect(searchWuManber(buildWuManber(patterns), text)).toEqual(
            naiveSearch(text, patterns),
        );
    });
});

describe("WuManber - case-insensitive i diakrytyki", () => {
    it("dopasowuje niezaleznie od wielkosci liter gdy wlaczone", () => {
        const hits = findAllPatterns("SAD i sad i Sad", ["sad"], { caseInsensitive: true });
        expect(hits.map((h) => h.start)).toEqual([0, 6, 12]);
    });

    it("offsety wskazuja na oryginalny tekst (nie zlowercasowany)", () => {
        const text = "AAA sad BBB";
        const hits = findAllPatterns(text, ["SAD"], { caseInsensitive: true });
        expect(hits).toEqual([{ start: 4, end: 7, patternIndex: 0 }]);
        expect(Array.from(text).slice(4, 7).join("")).toBe("sad");
    });

    it("case-insensitive na realnej polskiej literze z diakrytykiem (SĄD/sąd)", () => {
        // toLowerCase("SĄD") = "sąd" - kazda litera to jeden punkt kodowy BMP,
        // wiec liczba punktow kodowych sie nie zmienia (zalozenie ADR-0085).
        const text = "Sprawe rozpoznal SĄD w skladzie.";
        const hits = findAllPatterns(text, ["sąd"], { caseInsensitive: true });
        expect(hits.length).toBe(1);
        const h = hits[0]!;
        expect(Array.from(text).slice(h.start, h.end).join("")).toBe("SĄD");
    });

    it("case-insensitive na Ł/ł i pelnym slowie z diakrytykami (ŻÓŁĆ/żółć)", () => {
        const text = "kolor ŻÓŁĆ oraz Łoboda";
        const zolc = findAllPatterns(text, ["żółć"], { caseInsensitive: true });
        expect(zolc.length).toBe(1);
        expect(Array.from(text).slice(zolc[0]!.start, zolc[0]!.end).join("")).toBe("ŻÓŁĆ");
        const lob = findAllPatterns(text, ["ŁOBODA"], { caseInsensitive: true });
        expect(lob.length).toBe(1);
        expect(Array.from(text).slice(lob[0]!.start, lob[0]!.end).join("")).toBe("Łoboda");
    });

    it("polskie diakrytyki liczone jako pojedyncze znaki", () => {
        const text = "Sad Okregowy zazolc gesla jazn";
        const hits = findAllPatterns(text, ["zazolc"]);
        expect(hits.length).toBe(1);
        const h = hits[0]!;
        expect(Array.from(text).slice(h.start, h.end).join("")).toBe("zazolc");
    });

    it("obsluguje pary zastepcze (emoji) bez przesuniecia offsetow", () => {
        // Emoji to 1 punkt kodowy w Array.from, 2 jednostki UTF-16.
        const text = "x\u{1F600}y abc";
        const hits = findAllPatterns(text, ["abc"]);
        expect(hits.length).toBe(1);
        const h = hits[0]!;
        expect(Array.from(text).slice(h.start, h.end).join("")).toBe("abc");
    });
});

describe("WuManber - inwariant brak false-negative vs naiwny skan", () => {
    // Deterministyczny PRNG (mulberry32) - test reprodukowalny.
    function rng(seed: number): () => number {
        let a = seed >>> 0;
        return () => {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const alphabet = "abcdeząćółśżń ";

    function randStr(r: () => number, maxLen: number): string {
        const len = 1 + Math.floor(r() * maxLen);
        let s = "";
        for (let i = 0; i < len; i++) {
            s += alphabet[Math.floor(r() * alphabet.length)];
        }
        return s;
    }

    it("zgadza sie z naiwnym skanem na 200 losowych przypadkach", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const r = rng(seed);
            const numPatterns = 1 + Math.floor(r() * 8);
            const patterns: string[] = [];
            for (let i = 0; i < numPatterns; i++) patterns.push(randStr(r, 6));
            const text = randStr(r, 120);
            const got = searchWuManber(buildWuManber(patterns), text);
            const want = naiveSearch(text, patterns);
            expect(got).toEqual(want);
        }
    });

    it("zgadza sie z naiwnym skanem w trybie case-insensitive", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const r = rng(seed + 1000);
            const numPatterns = 1 + Math.floor(r() * 6);
            const patterns: string[] = [];
            for (let i = 0; i < numPatterns; i++) {
                const s = randStr(r, 5);
                patterns.push(r() > 0.5 ? s.toUpperCase() : s);
            }
            const text = randStr(r, 100);
            const got = searchWuManber(buildWuManber(patterns, { caseInsensitive: true }), text);
            const want = naiveSearch(text, patterns, true);
            expect(got).toEqual(want);
        }
    });
});

describe("WuManber - determinizm", () => {
    it("ten sam slownik i tekst zwraca identyczny wynik", () => {
        const patterns = ["Sad", "Okregowy", "Sad Okregowy"];
        const text = "Sad Okregowy i Sad Rejonowy oraz Okregowy";
        const a = searchWuManber(buildWuManber(patterns), text);
        const b = searchWuManber(buildWuManber(patterns), text);
        expect(a).toEqual(b);
    });

    it("maszyna jest reuzywalna miedzy dokumentami (brak stanu)", () => {
        const m = buildWuManber(["ab"]);
        expect(searchWuManber(m, "ab").length).toBe(1);
        expect(searchWuManber(m, "xx ab ab").length).toBe(2);
        expect(searchWuManber(m, "ab").length).toBe(1);
    });
});

describe("bootstrapAnnotate - slownik z gazetteera", () => {
    it("buduje slownik z COURTS / prefiksow / form prawnych", () => {
        const dict = buildDictionary();
        expect(dict.length).toBeGreaterThan(0);
        expect(dict.some((e) => e.label === "SAD")).toBe(true);
        expect(dict.some((e) => e.label === "SYGNATURA_PREFIX")).toBe(true);
        expect(dict.some((e) => e.label === "FORMA_PRAWNA")).toBe(true);
        expect(dict.every((e) => e.term.trim().length > 0)).toBe(true);
    });

    it("splaszcza name ORAZ aliasy COURTS do osobnych wpisow SAD", () => {
        const dict = buildDictionary();
        const sadTerms = new Set(dict.filter((e) => e.label === "SAD").map((e) => e.term));
        // Dla kazdego sadu: jego name i kazdy alias musza byc osobnym termem.
        for (const court of COURTS) {
            expect(sadTerms.has(court.name)).toBe(true);
            for (const alias of court.aliases) {
                if (alias.trim().length > 0) {
                    expect(sadTerms.has(alias)).toBe(true);
                }
            }
        }
    });

    it("krotki alias sadu (np. SN) wchodzi do slownika jako osobny wpis", () => {
        // Znajdz dowolny sad z krotkim aliasem 2-3 znaki i sprawdz, ze alias
        // jest osobnym termem (nie tylko pelna nazwa).
        const courtWithShortAlias = COURTS.find((c) =>
            c.aliases.some((a) => a.trim().length >= 2 && a.trim().length <= 3),
        );
        expect(courtWithShortAlias).toBeDefined();
        const shortAlias = courtWithShortAlias!.aliases.find(
            (a) => a.trim().length >= 2 && a.trim().length <= 3,
        )!;
        const dict = buildDictionary();
        expect(dict).toContainEqual(
            expect.objectContaining({ term: shortAlias, label: "SAD" }),
        );
    });

    it("formy prawne z LEGAL_FORMS sa w slowniku jako FORMA_PRAWNA", () => {
        const dict = buildDictionary();
        const formy = new Set(dict.filter((e) => e.label === "FORMA_PRAWNA").map((e) => e.term));
        for (const f of LEGAL_FORMS) {
            expect(formy.has(f)).toBe(true);
        }
    });

    it("prefiksy sygnatur sa case-sensitive w slowniku", () => {
        const dict = buildDictionary();
        const prefixEntries = dict.filter((e) => e.label === "SYGNATURA_PREFIX");
        expect(prefixEntries.length).toBeGreaterThan(0);
        expect(prefixEntries.every((e) => e.caseSensitive === true)).toBe(true);
    });

    it("dolacza slownik dostarczony przez wywolujacego", () => {
        const extra: DictionaryEntry[] = [{ term: "Koziatek", label: "KLIENT" }];
        const dict = buildDictionary(extra);
        expect(dict).toContainEqual({ term: "Koziatek", label: "KLIENT" });
    });
});

describe("bootstrapAnnotate - emisja slabych etykiet", () => {
    it("emituje span z etykieta i doslownym termem z dokumentu", () => {
        const dict: DictionaryEntry[] = [{ term: "Sad Okregowy", label: "SAD" }];
        const text = "Pozew zlozono w Sad Okregowy w Lodzi.";
        const spans = bootstrapAnnotate(text, dict);
        expect(spans.length).toBe(1);
        const s = spans[0]!;
        expect(s.label).toBe("SAD");
        expect(s.term).toBe("Sad Okregowy");
        expect(Array.from(text).slice(s.start, s.end).join("")).toBe("Sad Okregowy");
    });

    it("inwariant: term === slice(start, end) dla kazdego spanu", () => {
        const dict: DictionaryEntry[] = [
            { term: "SAD OKREGOWY", label: "SAD" },
            { term: "Rejonowy", label: "TYP" },
            { term: "CZP", label: "SYGNATURA_PREFIX", caseSensitive: true },
        ];
        const text = "w SĄD OKREGOWY oraz Sad Rejonowy, sygn. III CZP 11/13";
        const spans = bootstrapAnnotate(text, dict, { caseInsensitiveDefault: true });
        for (const s of spans) {
            expect(s.term).toBe(Array.from(text).slice(s.start, s.end).join(""));
        }
    });

    it("re-derywuje term z offsetow zachowujac wielkosc liter dokumentu", () => {
        const dict: DictionaryEntry[] = [{ term: "SAD OKREGOWY", label: "SAD" }];
        const text = "w Sad Okregowy dnia";
        const spans = bootstrapAnnotate(text, dict, { caseInsensitiveDefault: true });
        expect(spans.length).toBe(1);
        expect(spans[0]!.term).toBe("Sad Okregowy");
    });

    it("emituje wszystkie wystapienia i nakladania bez deduplikacji", () => {
        const dict: DictionaryEntry[] = [
            { term: "Sad Okregowy", label: "SAD" },
            { term: "Okregowy", label: "PRZYMIOTNIK" },
        ];
        const text = "Sad Okregowy oraz Sad Okregowy";
        const spans = bootstrapAnnotate(text, dict);
        const sad = spans.filter((s) => s.label === "SAD");
        const przym = spans.filter((s) => s.label === "PRZYMIOTNIK");
        expect(sad.length).toBe(2);
        expect(przym.length).toBe(2);
    });

    it("wpisy case-sensitive nie lapia innej wielkosci liter", () => {
        const dict: DictionaryEntry[] = [
            { term: "CZP", label: "SYGNATURA_PREFIX", caseSensitive: true },
        ];
        const text = "III CZP 11/13 oraz czp";
        const spans = bootstrapAnnotate(text, dict);
        expect(spans.length).toBe(1);
        expect(Array.from(text).slice(spans[0]!.start, spans[0]!.end).join("")).toBe("CZP");
    });

    it("wpisy case-insensitive (domyslnie) lapia rozna wielkosc liter", () => {
        const dict: DictionaryEntry[] = [{ term: "Sad", label: "SAD" }];
        const text = "SAD i sad i Sad";
        const spans = bootstrapAnnotate(text, dict);
        expect(spans.length).toBe(3);
    });

    it("brak trafien gdy slownik pusty albo termy nieobecne", () => {
        expect(bootstrapAnnotate("dowolny tekst", [])).toEqual([]);
        expect(bootstrapAnnotate("dowolny tekst", [{ term: "Trybunal", label: "SAD" }])).toEqual([]);
    });

    it("spany posortowane rosnaco po start", () => {
        const dict: DictionaryEntry[] = [
            { term: "Sad", label: "SAD" },
            { term: "Rejonowy", label: "TYP" },
        ];
        const spans = bootstrapAnnotate("Sad Rejonowy Sad Rejonowy", dict);
        for (let i = 1; i < spans.length; i++) {
            expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.start);
        }
    });

    it("anotuje realna nazwa sadu z gazetteera (nazwa pelna)", () => {
        const dict = buildDictionary();
        // Wez realna pelna nazwe pierwszego sadu i sprawdz, ze jest anotowana
        // etykieta SAD na termie rownym tej nazwie (izolacja od case-folding).
        const court = COURTS[0]!;
        const text = `Sprawe rozpoznal ${court.name} w skladzie trzech sedziow.`;
        const spans = bootstrapAnnotate(text, dict);
        const sadOnName = spans.filter(
            (s) => s.label === "SAD" && s.term === court.name,
        );
        expect(sadOnName.length).toBeGreaterThanOrEqual(1);
    });
});
