// Bramka kompletnosci obowiazku llm_route (Mirrors #12 w AGENTS.md).
//
// Obowiazek: KAZDA powierzchnia wolajaca model LLM przechodzi przez
// enforceEgressGuard/guardEgress i zostawia zdarzenie llm_route w audit hash
// chain (AI Act art. 12 + tajemnica zawodowa). Do 2026-08-31 obowiazek trzymaly
// TYLKO komentarze "parytet z czatem" - nowa powierzchnia dodana bez straznika
// nie zapalala zadnego testu. Pierwszy przebieg tej bramki znalazl DWIE zywe
// luki w routes/tabular.ts: generator promptu kolumny (POST /prompt) i tytul
// czatu tabular egressowaly bez straznika i bez sladu audytowego.
//
// Mechanika (wzorzec: event-type-parity.test.ts = parytet list,
// no-relative-api.test.ts = najpierw kontrola wlasnego MIANOWNIKA skanu):
//  1. skan CALEGO backend/src (poza sama warstwa lib/llm/) wykrywa pliki
//     importujace funkcje egress warstwy LLM (streamChatWithTools/completeText
//     oraz funkcje providerow) - import, nie wywolanie, bo sciezki wstrzykiwane
//     (judge.ts, defense.ts) przekazuja REFERENCJE bez nawiasu;
//  2. kazdy wykryty plik musi byc w REJESTRZE powierzchni z dokladnym
//     licznikiem referencji i wskazaniem, gdzie mieszka straznik;
//  3. liczniki sa DOKLADNE (nie ">=1"): plik moze miec straznika i mimo to
//     dostac nowe, niestrzezone wywolanie obok - dokladnie tak wygladaly obie
//     luki w tabular.ts. Nowa referencja = swiadoma aktualizacja rejestru.
//
// Liczniki obejmuja takze komentarze (\b...\b po calym zrodle) - celowo: zero
// parsowania AST, deterministycznie; wzmianka w komentarzu tez wymusza rzut
// oka czlowieka na rejestr.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..", "..");

/** Funkcje warstwy LLM, ktorych referencja poza lib/llm/ = egress do modelu. */
const EGRESS_FUNKCJE: readonly string[] = [
    // wejscia kanoniczne (lib/llm/index.ts)
    "streamChatWithTools",
    "completeText",
    // funkcje providerow - obejscie wejscia kanonicznego tez ma byc widoczne
    "streamClaude",
    "completeClaudeText",
    "streamGemini",
    "completeGeminiText",
    "streamOpenAI",
    "completeOpenAIText",
    "streamOpenRouter",
    "completeOpenRouterText",
    "streamOllama",
    "completeOllamaText",
];

/** SDK providerow - import poza lib/llm/ = obejscie calej warstwy routingu. */
const SDK_PROVIDERA_RE =
    /(?:from\s*["']|require\(\s*["'])(@anthropic-ai\/sdk|@google\/genai)/;

/**
 * REJESTR powierzchni LLM - jedyne miejsca, ktorym wolno referowac funkcje
 * egress warstwy LLM. `strażnik` wskazuje plik z wywolaniem
 * enforceEgressGuard(/guardEgress( pokrywajacym te referencje (dla sciezek
 * wstrzykiwanych straznik mieszka u WOLAJACEGO) oraz DOKLADNY licznik jego
 * wywolan tamze.
 *
 * Nowe wywolanie LLM? Kolejnosc jest czescia obowiazku:
 *  1. postaw enforceEgressGuard PRZED wywolaniem (wzorzec: routes/chat.ts
 *     generate-title; koszt/latencje po allow audytuje wolajacy - patrz
 *     [Coupling] przy enforceEgressGuard w AGENTS.md),
 *  2. dopiero potem zaktualizuj liczniki tutaj,
 *  3. i wiersz #12 sekcji Mirrors w AGENTS.md.
 */
const REJESTR: Array<{
    plik: string;
    refy: Record<string, number>;
    straznik: { plik: string; wywolania: number };
    /**
     * DOKLADNA liczba `appendLlmRouteEvent(` w pliku straznika. Straznik
     * zapisuje audyt TYLKO przy blokadzie (kontrakt w naglowku
     * enforceEgress.ts), wiec sciezke dozwolona audytuje wolajacy - powierzchnia
     * z samym straznikiem jest zrobiona w POLOWIE. `wyjatek` = uzasadnienie dla
     * zera (jedyny dopuszczalny powod: nic nie opuszcza maszyny).
     */
    audyt: { wywolania: number; wyjatek?: string };
    dlaczego: string;
}> = [
    {
        plik: "lib/chat/stream.ts",
        refy: { streamChatWithTools: 2 },
        straznik: { plik: "lib/chat/stream.ts", wywolania: 1 },
        audyt: { wywolania: 1 },
        dlaczego: "czat glowny - straznik przed streamChatWithTools (ADR-0067)",
    },
    {
        plik: "routes/chat.ts",
        refy: { completeText: 2 },
        straznik: { plik: "routes/chat.ts", wywolania: 1 },
        audyt: { wywolania: 1 },
        dlaczego: "tytul czatu (generate-title) - straznik przed completeText",
    },
    {
        plik: "routes/tabular.ts",
        refy: { completeText: 4, streamChatWithTools: 2 },
        straznik: { plik: "routes/tabular.ts", wywolania: 4 },
        audyt: { wywolania: 4 },
        dlaczego:
            "tabular: generate + regenerate-cell + generator promptu kolumny " +
            "+ tytul czatu tabular (dwie ostatnie strzezone od 2026-08-31; " +
            "czat tabular idzie przez runLLMStream -> lib/chat/stream.ts)",
    },
    {
        plik: "lib/citation/judge.ts",
        refy: { completeText: 5 },
        straznik: { plik: "lib/citation/judge.ts", wywolania: 1 },
        audyt: {
            wywolania: 0,
            wyjatek:
                "sedzia jest LOKALNY-ONLY: makeJudge zwraca null dla modelu " +
                "nielokalnego (isLocalModel), wiec nic nie opuszcza maszyny - " +
                "nie ma egresu do zapisania. Straznik jest drugim zabezpieczeniem.",
        },
        dlaczego:
            "sedzia cytatow - guardEgress fail-closed przed wstrzykiwanym " +
            "completeText (ADR-0095)",
    },
    {
        plik: "lib/pipeline/defense.ts",
        refy: { completeText: 3 },
        straznik: { plik: "routes/draft.ts", wywolania: 1 },
        audyt: { wywolania: 1 },
        dlaczego:
            "pipeline obrony - completeText wstrzykiwany jako default; " +
            "straznik u wolajacego: routes/draft.ts przed runDefensePipeline " +
            "(ADR-0067)",
    },
];

/** Sciezka z separatorami "/" niezaleznie od systemu. */
const naSlashe = (p: string): string => p.split(sep).join("/");

/** Sciezka wzgledem backend/src. */
const wzgledna = (p: string): string =>
    naSlashe(p).split("/src/")[1] ?? naSlashe(p);

function zrodla(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) zrodla(full, acc);
        else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
            acc.push(full);
        }
    }
    return acc;
}

/** Skan = caly backend/src POZA sama warstwa lib/llm/ (tam te nazwy mieszkaja). */
function plikiDoSkanu(): string[] {
    return zrodla(SRC_DIR).filter((f) => !wzgledna(f).startsWith("lib/llm/"));
}

const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** Specyfikator modulu wskazujacy na warstwe LLM (lib/llm lub jej pliki). */
function czyModulLlm(spec: string): boolean {
    return /(^|\/)llm(\/|$)/.test(spec);
}

/**
 * Importy funkcji egress z warstwy LLM: mapa alias-lokalny -> nazwa oryginalna.
 * `import type {...}` i specyfikatory `type X` pomijane (typ nie egresuje).
 */
function importyEgress(src: string): Map<string, string> {
    const wynik = new Map<string, string>();
    for (const m of src.matchAll(IMPORT_RE)) {
        const [, samTyp, srodek, spec] = m;
        if (samTyp || !czyModulLlm(spec)) continue;
        for (const surowy of srodek.split(",")) {
            const s = surowy.trim();
            if (!s || s.startsWith("type ")) continue;
            const [oryginal, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
            if (EGRESS_FUNKCJE.includes(oryginal)) {
                wynik.set(alias ?? oryginal, oryginal);
            }
        }
    }
    return wynik;
}

/** Wystapienia identyfikatora w zrodle (z komentarzami - patrz naglowek). */
function policzRefy(src: string, nazwa: string): number {
    return (src.match(new RegExp(`\\b${nazwa}\\b`, "g")) ?? []).length;
}

/**
 * WYWOLANIA straznika: nazwa + nawias BEZ spacji (styl prettier repo).
 * Celowo nie `\s*\(` - komentarz "przez guardEgress (tajemnica..." w
 * lib/chat/stream.ts liczylby sie jako wywolanie.
 */
function policzStraznikow(src: string): number {
    return (src.match(/\b(?:enforceEgressGuard|guardEgress)\(/g) ?? []).length;
}

/**
 * WYWOLANIA audytu allow (`appendLlmRouteEvent(`). Ten sam styl dopasowania co
 * policzStraznikow - nazwa + nawias bez spacji, zeby wzmianka w komentarzu nie
 * liczyla sie jako wywolanie.
 */
function policzAudytu(src: string): number {
    return (src.match(/\bappendLlmRouteEvent\(/g) ?? []).length;
}

/** Zmierzone referencje egress pliku: {oryginalnaNazwa: licznik}. */
function zmierzRefy(src: string): Record<string, number> {
    const refy: Record<string, number> = {};
    for (const [alias, oryginal] of importyEgress(src)) {
        refy[oryginal] = (refy[oryginal] ?? 0) + policzRefy(src, alias);
    }
    return refy;
}

const czytaj = (plik: string): string =>
    readFileSync(join(SRC_DIR, ...plik.split("/")), "utf8");

describe("egress-surface-parity - obowiazek llm_route (Mirrors #12)", () => {
    it("skan obejmuje CALY backend/src - kontrola pozytywna MIANOWNIKA", () => {
        // Lekcja no-relative-api.test.ts: kontrola pozytywna WZORCA nie wykryje
        // zle zawezonego mianownika - najpierw sprawdz, co skan w ogole objal.
        const pliki = plikiDoSkanu().map(wzgledna);
        expect(pliki.length).toBeGreaterThan(100);
        for (const katalog of [
            "routes/",
            "lib/chat/",
            "lib/citation/",
            "lib/pipeline/",
            "lib/routing/",
            "middleware/",
        ]) {
            expect(
                pliki.some((f) => f.startsWith(katalog)),
                `${katalog} poza skanem - dokladnie tak umiera bramka`,
            ).toBe(true);
        }
        // Wylaczona jest WYLACZNIE warstwa lib/llm/ - nic wiecej.
        expect(pliki.some((f) => f.startsWith("lib/llm/"))).toBe(false);
        expect(
            zrodla(SRC_DIR).some((f) => wzgledna(f).startsWith("lib/llm/")),
            "lib/llm/ zniknelo z drzewa - wylaczenie stracilo przedmiot",
        ).toBe(true);
    });

    it("detektor zapala sie na znanym-zlym (bramka gotowa dopiero po czerwonym)", () => {
        // Fixture'y znanego-zlego: tak wygladalyby luki, ktore bramka ma lapac.
        const goly = `import { completeText } from "../llm";\n` +
            `export const f = (t: string) => completeText({ model: "m", user: t });\n`;
        expect(zmierzRefy(goly)).toEqual({ completeText: 2 });
        expect(policzStraznikow(goly)).toBe(0);

        const aliasowany =
            `import { streamChatWithTools as sctw } from "../../lib/llm";\n` +
            `void sctw;\n`;
        expect(zmierzRefy(aliasowany)).toEqual({ streamChatWithTools: 2 });

        const obejscieProvidera =
            `import { streamClaude } from "../llm/claude";\nvoid streamClaude;\n`;
        expect(zmierzRefy(obejscieProvidera)).toEqual({ streamClaude: 2 });

        // Kontrola negatywna: import samego typu / nie-egress nie zapala.
        const niewinny =
            `import type { UserApiKeys } from "../llm";\n` +
            `import { resolveModel } from "../llm";\n`;
        expect(zmierzRefy(niewinny)).toEqual({});

        // Obejscie przez SDK providera.
        expect(
            SDK_PROVIDERA_RE.test(`import Anthropic from "@anthropic-ai/sdk";`),
        ).toBe(true);
        expect(
            SDK_PROVIDERA_RE.test(`import { GoogleGenAI } from "@google/genai";`),
        ).toBe(true);
    });

    it("zbior plikow referujacych warstwe LLM == REJESTR powierzchni", () => {
        const wykryte = plikiDoSkanu()
            .filter((f) => importyEgress(readFileSync(f, "utf8")).size > 0)
            .map(wzgledna)
            .sort();
        const zarejestrowane = REJESTR.map((r) => r.plik).sort();
        expect(
            wykryte,
            "Rozjazd z REJESTREM. Plik wykryty a niezarejestrowany = nowa " +
                "powierzchnia LLM BEZ obowiazku llm_route: postaw " +
                "enforceEgressGuard PRZED wywolaniem (wzorzec: routes/chat.ts " +
                "generate-title), dopisz wpis do REJESTRU w tym tescie i " +
                "zaktualizuj wiersz #12 Mirrors w AGENTS.md. Wpis " +
                "zarejestrowany a niewykryty = martwy wpis, usun go.",
        ).toEqual(zarejestrowane);
    });

    it("liczniki referencji egress zgodne z REJESTREM (dokladnie, nie >=)", () => {
        const rozjazdy: string[] = [];
        for (const wpis of REJESTR) {
            const zmierzone = zmierzRefy(czytaj(wpis.plik));
            if (JSON.stringify(zmierzone) !== JSON.stringify(wpis.refy)) {
                rozjazdy.push(
                    `${wpis.plik}: rejestr ${JSON.stringify(wpis.refy)}, ` +
                        `zmierzone ${JSON.stringify(zmierzone)}`,
                );
            }
        }
        expect(
            rozjazdy,
            "Liczba referencji egress zmienila sie. Jesli doszlo NOWE " +
                "wywolanie: najpierw enforceEgressGuard przed nim (i licznik " +
                "straznika w rejestrze rosnie RAZEM z licznikiem referencji), " +
                "dopiero potem aktualizacja liczników tutaj.",
        ).toEqual([]);
    });

    it("kazdy straznik z REJESTRU realnie wola enforceEgressGuard/guardEgress", () => {
        const rozjazdy: string[] = [];
        for (const wpis of REJESTR) {
            const n = policzStraznikow(czytaj(wpis.straznik.plik));
            if (n !== wpis.straznik.wywolania) {
                rozjazdy.push(
                    `${wpis.straznik.plik}: rejestr ${wpis.straznik.wywolania}, ` +
                        `zmierzone ${n} (powierzchnia: ${wpis.plik})`,
                );
            }
        }
        expect(
            rozjazdy,
            "Licznik wywolan straznika nie zgadza sie z REJESTREM. Spadek = " +
                "ktos zdjal straznika z powierzchni; wzrost bez aktualizacji " +
                "rejestru = nowa powierzchnia dopisana na dziko.",
        ).toEqual([]);
    });

    it("sciezka ALLOW zostawia slad llm_route - audyt, nie sam straznik", () => {
        // Straznik zapisuje audyt TYLKO przy blokadzie. Powierzchnia, ktora ma
        // straznika, ale nie audytuje allow, egresuje bez sladu - z lancucha nie
        // da sie odtworzyc, ze wywolanie w ogole bylo (AI Act art. 12).
        // Zmierzone 2026-08-31: pierwsza wersja tej bramki liczyla WYLACZNIE
        // straznikow, wiec przeszla nad ta luka w routes/tabular.ts, a wiersz
        // [Coupling] w AGENTS.md twierdzil wtedy, ze straznik audytuje sam.
        const rozjazdy: string[] = [];
        for (const wpis of REJESTR) {
            const zmierzone = policzAudytu(czytaj(wpis.straznik.plik));
            if (zmierzone !== wpis.audyt.wywolania) {
                rozjazdy.push(
                    `${wpis.straznik.plik}: appendLlmRouteEvent( ${zmierzone}, ` +
                        `rejestr ${wpis.audyt.wywolania}`,
                );
            }
            // Zero audytu wolno TYLKO z nazwanym uzasadnieniem.
            if (wpis.audyt.wywolania === 0 && !wpis.audyt.wyjatek) {
                rozjazdy.push(
                    `${wpis.plik}: audyt 0 bez nazwanego wyjatku - jedyny ` +
                        `dopuszczalny powod to "nic nie opuszcza maszyny"`,
                );
            }
        }
        expect(
            rozjazdy,
            "Rozjazd audytu allow. Nowe wywolanie LLM = straznik PRZED nim " +
                "ORAZ appendLlmRouteEvent(action: 'allow') po nim, z realna " +
                "latencja; potem podbij licznik w REJESTRZE.",
        ).toEqual([]);
    });

    it("zaden plik poza lib/llm/ nie importuje SDK providera", () => {
        const winne = plikiDoSkanu()
            .filter((f) => SDK_PROVIDERA_RE.test(readFileSync(f, "utf8")))
            .map(wzgledna);
        expect(
            winne,
            "Import SDK providera poza lib/llm/ omija cala warstwe routingu " +
                "(straznik, audit llm_route, pseudonimizacje). Nowy provider: " +
                "backend/src/lib/llm/base-provider.ts.",
        ).toEqual([]);
    });

    it("kanon powierzchni z AGENTS.md #12 jest w REJESTRZE (anty-dryf opisu)", () => {
        // Gdy ta lista przestaje pasowac, zaktualizuj AGENTS.md Mirrors #12
        // RAZEM z rejestrem - opis obowiazku ma nadazac za kodem.
        const zarejestrowane = new Set(REJESTR.map((r) => r.plik));
        for (const plik of [
            "lib/chat/stream.ts",
            "routes/chat.ts",
            "routes/tabular.ts",
            "lib/citation/judge.ts",
            "lib/pipeline/defense.ts",
        ]) {
            expect(zarejestrowane.has(plik), `${plik} wypadl z REJESTRU`).toBe(
                true,
            );
        }
    });
});
