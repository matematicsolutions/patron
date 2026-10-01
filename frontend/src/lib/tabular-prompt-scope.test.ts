// Bramka na regresje, ktorej NIC we froncie dotad nie pilnowalo: cichy powrot
// do egressu bez sprawy.
//
// `generateTabularColumnPrompt` wysyla tytul kolumny (a przy formacie "tag"
// takze tagi) do modelu, domyslnie chmurowego. Kontekst sprawy niesie tam
// wylacznie `reviewId`: bez niego backend rozwiazywal klasyfikacje przez
// resolveClassification(null), czyli po JEDYNEJ galezi straznika, ktora nie
// jest fail-closed ("internal" - backend/src/lib/routing/guard.ts). Kolumna
// tabeli sprawy objetej tajemnica zawodowa wychodzila wiec do chmury po
// najslabszej klasyfikacji.
//
// Backend domknal to bramka wejscia (lib/tabular/prompt-scope.ts: brak sprawy
// musi byc NAZWANY zakresem "workflow_template", inaczej 400), a typ
// ZakresPromptuKolumny zmusza kazde wywolanie do podania zakresu. Tego jednak
// za malo: { scope: "workflow_template" } jest dla kompilatora tak samo
// poprawne w edytorze kolumny sprawy, jak w edytorze szablonu. Nastepny
// refaktor moze wiec cofnac klasyfikacje i wszystko zostanie zielone.
//
// Dlatego lista plikow, ktorym wolno wolac BEZ sprawy, jest NAZWANA i
// jednoelementowa - wzorzec ZNANE_MARTWE z no-relative-api.test.ts. I tak samo
// jak tam: najpierw kontrola pozytywna wlasnego MIANOWNIKA, bo zle zawezony
// skan swieci na zielono niezaleznie od tego, co jest w kodzie.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Skan calego drzewa zrodel to sekundy pracy I/O, a domyslny limit testu w
// vitest to 5 s. Pod rownoleglym obciazeniem maszyny (druga sesja, build, dev
// server) bramki skanujace padaly TIMEOUTEM - czyli swiecily na czerwono
// z powodu, ktory nie ma nic wspolnego z tym, co mierza. Bramka, ktora bywa
// czerwona bez powodu, uczy ignorowac swoj kolor; limit jest tu na tyle duzy,
// zeby o kolorze decydowala TRESC skanu, a nie obciazenie maszyny.
vi.setConfig({ testTimeout: 60_000 });

const SRC_DIR = join(__dirname, "..");
const FUNKCJA = "generateTabularColumnPrompt";

/** Plik, w ktorym funkcja MIESZKA - jego wywolanie to definicja, nie call-site. */
const DEFINICJA = "app/lib/patronApi.ts";

/**
 * JEDYNE pliki, ktorym wolno zadeklarowac zakres BEZ sprawy. Oba sa edytorem
 * SZABLONU workflow, ktory z definicji sprawy nie ma - do modelu idzie sam
 * tytul kolumny szablonu, bez dokumentu i bez danych sprawy:
 *
 *  - `app/(pages)/workflows/[id]/page.tsx` - strona szablonu; deklaruje zakres
 *    dla wspoldzielonego `AddColumnModal`, ktorego drugim rodzicem jest
 *    `TabularReviewView` (kontekst sprawy). Modal kontekstu NIE ZGADUJE - do
 *    2026-08-31 mial `reviewId?: string`, wiec pominiecie propa przez rodzica
 *    wygladalo identycznie jak swiadomy brak sprawy;
 *  - `app/components/workflows/WFEditColumnModal.tsx` - edytor kolumny szablonu.
 *
 * Kazdy dopisany tu wpis to zgoda na egress po klasyfikacji "internal". Zanim
 * dopiszesz: sprawdz, czy powierzchnia NAPRAWDE nie ma sprawy, czy tylko akurat
 * nie ma jej pod reka.
 */
const ZNANE_BEZ_SPRAWY: string[] = [
    "app/(pages)/workflows/[id]/page.tsx",
    "app/components/workflows/WFEditColumnModal.tsx",
];

/** Literal deklarujacy brak sprawy - gdziekolwiek we froncie, nie tylko w wywolaniu. */
const BEZ_SPRAWY = '"workflow_template"';

/** Sciezka z separatorami "/" niezaleznie od systemu. */
const naSlashe = (p: string): string => p.split(sep).join("/");

/** Sciezka wzgledem frontend/src. */
const wzgledna = (p: string): string =>
    naSlashe(p).split("/src/")[1] ?? naSlashe(p);

function zrodla(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) zrodla(full, acc);
        else if (
            (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
            !entry.endsWith(".test.ts") &&
            !entry.endsWith(".test.tsx")
        ) {
            acc.push(full);
        }
    }
    return acc;
}

/**
 * Drzewo czytane RAZ na plik testowy, nie raz na asercje.
 *
 * Kazdy test tutaj potrzebuje tej samej zawartosci calego `frontend/src`.
 * Pierwsza wersja skanowala dysk osobno w kazdym tescie (a jeden czytal jeszcze
 * pliki po raz drugi wewnatrz filtra), przez co pod rownoleglym obciazeniem
 * suite przekraczal domyslny limit 5 s i bramka padala TIMEOUTEM - czyli
 * wygladala na czerwona z powodu, ktory nie ma nic wspolnego z tym, co mierzy.
 * Bramka, ktora bywa czerwona bez powodu, uczy ignorowac swoj kolor.
 */
let cacheDrzewa: Array<{ pelna: string; krotka: string; src: string }> | null =
    null;

function drzewo(): Array<{ pelna: string; krotka: string; src: string }> {
    if (!cacheDrzewa) {
        cacheDrzewa = zrodla(SRC_DIR).map((pelna) => ({
            pelna,
            krotka: wzgledna(pelna),
            src: readFileSync(pelna, "utf8"),
        }));
    }
    return cacheDrzewa;
}

const plikiDoSkanu = (): string[] => drzewo().map((p) => p.pelna);

/**
 * Tresc argumentow kazdego wywolania funkcji w zrodle - po BALANSIE nawiasow,
 * nie po oknie N znakow: argumenty tego wywolania sa wieloliniowe i rosna.
 */
function wywolania(src: string, nazwa: string): string[] {
    const wynik: string[] = [];
    const igla = `${nazwa}(`;
    let od = 0;
    for (;;) {
        const i = src.indexOf(igla, od);
        if (i === -1) return wynik;
        let glebokosc = 0;
        let j = i + igla.length - 1;
        for (; j < src.length; j++) {
            if (src[j] === "(") glebokosc += 1;
            else if (src[j] === ")") {
                glebokosc -= 1;
                if (glebokosc === 0) break;
            }
        }
        wynik.push(src.slice(i + igla.length, j));
        od = j + 1;
    }
}

interface CallSite {
    plik: string;
    argumenty: string;
}

function callSites(): CallSite[] {
    const wynik: CallSite[] = [];
    for (const { krotka, src } of drzewo()) {
        if (krotka === DEFINICJA) continue;
        if (!src.includes(FUNKCJA)) continue;
        for (const argumenty of wywolania(src, FUNKCJA)) {
            wynik.push({ plik: krotka, argumenty });
        }
    }
    return wynik;
}

/** Zrodlo pliku z cache'u drzewa - bez ponownego czytania dysku. */
function zrodlo(krotka: string): string {
    const wpis = drzewo().find((p) => p.krotka === krotka);
    if (!wpis) throw new Error(`plik poza skanem: ${krotka}`);
    return wpis.src;
}

/** Deklaracja unii - JEDYNE miejsce w definicji, ktoremu wolno nazwac brak sprawy. */
const DEKLARACJA_TYPU = "export type ZakresPromptuKolumny";

/** Zrodlo bez komentarzy: literal w prozie opisuje regule, nie wykonuje jej. */
function bezKomentarzy(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ 	]*\/\/.*$/gm, "");
}

function zlicz(hay: string, igla: string): number {
    return hay.split(igla).length - 1;
}

/**
 * Deklaracja unii `ZakresPromptuKolumny` wycieta ze zrodla.
 *
 * Granica po LINIACH, nie po pierwszym `;`: srednik pada juz w srodku
 * `{ scope: "review"; reviewId: string }`, wiec ciecie po nim urwaloby unie
 * przed interesujacym nas czlonem i pomiar zglaszalby nadmiar tam, gdzie go
 * nie ma. Bierzemy linie deklaracji + kolejne zaczynajace sie od `|`.
 */
function uniaTypu(kod: string): string {
    const linie = kod.split("\n");
    const start = linie.findIndex((l) => l.includes(DEKLARACJA_TYPU));
    if (start === -1) return "";
    const zebrane = [linie[start]!];
    for (let k = start + 1; k < linie.length; k++) {
        if (!/^\s*\|/.test(linie[k]!)) break;
        zebrane.push(linie[k]!);
    }
    return zebrane.join("\n");
}

/**
 * Ile razy literal braku sprawy pada w KODZIE definicji poza unia typu.
 *
 * Sygnatura `zakres: ZakresPromptuKolumny,` mowi tylko, ze parametr jest
 * wymagany - nie mowi, ze CIALO funkcji go szanuje. Domyslna galaz w rodzaju
 * `zakres ?? { scope: "workflow_template" }` przechodzi obie asercje
 * sygnatury, a przywraca dokladnie ten egress po klasyfikacji "internal",
 * ktoremu ta bramka ma zapobiegac.
 */
function nadmiarowyBrakSprawy(src: string): number {
    const kod = bezKomentarzy(src);
    return zlicz(kod, BEZ_SPRAWY) - zlicz(uniaTypu(kod), BEZ_SPRAWY);
}

describe("generator promptu kolumny nie traci kontekstu sprawy", () => {
    it("skan obejmuje CALY front - kontrola pozytywna MIANOWNIKA", () => {
        const pliki = plikiDoSkanu().map(wzgledna);
        expect(pliki.length).toBeGreaterThan(50);
        for (const katalog of ["app/components/", "app/lib/", "lib/"]) {
            expect(
                pliki.some((f) => f.startsWith(katalog)),
                `${katalog} poza skanem - dokladnie tak umiera bramka`,
            ).toBe(true);
        }
        expect(
            pliki.includes(DEFINICJA),
            `${DEFINICJA} poza skanem - wylaczenie definicji stracilo przedmiot`,
        ).toBe(true);
    });

    it("detektor zapala sie na znanym-zlym (bramka gotowa dopiero po czerwonym)", () => {
        const znanyZly =
            `const { prompt } = await ${FUNKCJA}(title, {\n` +
            `    format: col.format,\n` +
            `    tags: col.tags,\n` +
            `});\n`;
        const args = wywolania(znanyZly, FUNKCJA);
        expect(args).toHaveLength(1);
        expect(args[0]!.includes("scope:")).toBe(false);

        // Kontrola pozytywna: wywolanie z zagniezdzonymi nawiasami czyta sie w
        // calosci, a dwa wywolania w jednym pliku nie zlewaja sie w jedno.
        const dobry =
            `${FUNKCJA}(name.trim(), { scope: "review", reviewId }, { format });\n` +
            `${FUNKCJA}(t, { scope: "workflow_template" }, { format });\n`;
        const dwa = wywolania(dobry, FUNKCJA);
        expect(dwa).toHaveLength(2);
        expect(dwa[0]).toContain('scope: "review"');
        expect(dwa[0]).toContain("reviewId");
        expect(dwa[1]).toContain('scope: "workflow_template"');
        expect(dwa[1]).not.toContain("reviewId");
    });

    it("skan widzi wszystkie trzy call-site'y", () => {
        const znalezione = callSites();
        expect(znalezione.length).toBeGreaterThanOrEqual(3);
        expect(
            new Set(znalezione.map((c) => c.plik)).size,
        ).toBeGreaterThanOrEqual(3);
    });

    it("kazde wywolanie deklaruje zakres albo przekazuje go dalej TYPEM", () => {
        // Wywolanie moze nazwac zakres wprost (`{ scope: ... }`) albo przekazac
        // wartosc, ktorej typ ZakresPromptuKolumny wymusil rodzic - trzeciej
        // drogi nie ma, bo parametr jest wymagany (test na koncu pliku).
        const bezZakresu = callSites()
            .filter((c) => {
                if (c.argumenty.includes("scope:")) return false;
                return !zrodlo(c.plik).includes(": ZakresPromptuKolumny");
            })
            .map((c) => c.plik);
        expect(
            bezZakresu,
            "Wywolanie bez zadeklarowanego zakresu: backend odrzuci je 400-tka, " +
                'a w kodzie wyglada jak dzialajace. Podaj { scope: "review", ' +
                "reviewId }, albo przyjmij zakres od rodzica propem typu " +
                "ZakresPromptuKolumny (wzorzec: AddColumnModal).",
        ).toEqual([]);
    });

    it("BEZ sprawy wolno zadeklarowac tylko plikom z nazwanej listy", () => {
        // Skan po CALYM froncie, nie po samych wywolaniach: zakres deklaruje
        // dzis takze rodzic w propie JSX (workflows/[id]/page.tsx), ktory
        // generatora w ogole nie wola. Gdyby bramka patrzyla wylacznie na
        // wywolania, ta deklaracja bylaby poza jej mianownikiem.
        const bezSprawy = drzewo()
            .filter((p) => p.krotka !== DEFINICJA && p.src.includes(BEZ_SPRAWY))
            .map((p) => p.krotka);

        const nadmiarowe = bezSprawy.filter(
            (p) => !ZNANE_BEZ_SPRAWY.includes(p),
        );
        expect(
            nadmiarowe,
            "Nowa powierzchnia deklaruje zakres BEZ sprawy - tresc kolumny " +
                'egresuje wtedy po klasyfikacji "internal" (jedyna galaz ' +
                "straznika, ktora nie jest fail-closed). Jesli sprawa istnieje, " +
                'przekaz { scope: "review", reviewId }; jesli naprawde jej nie ' +
                "ma, dopisz plik do ZNANE_BEZ_SPRAWY z powodem obok.",
        ).toEqual([]);

        // Lista wyjatkow nie moze zgnic: wpis bez realnej deklaracji to
        // pozwolenie wystawione w prozni.
        const martwe = ZNANE_BEZ_SPRAWY.filter((p) => !bezSprawy.includes(p));
        expect(
            martwe,
            "Wpis w ZNANE_BEZ_SPRAWY bez odpowiadajacej deklaracji - usun go, " +
                "albo bedzie oslanial przyszly plik o tej samej sciezce.",
        ).toEqual([]);
    });

    it("kazda deklaracja kontekstu sprawy niesie reviewId", () => {
        const OBIEKT_REVIEW = /scope:\s*"review"[^}]*\}/g;
        const winne: string[] = [];
        let deklaracji = 0;
        for (const { krotka, src } of drzewo()) {
            if (krotka === DEFINICJA) continue;
            for (const m of src.match(OBIEKT_REVIEW) ?? []) {
                deklaracji += 1;
                if (!/\breviewId\b/.test(m)) winne.push(krotka);
            }
        }
        expect(
            winne,
            'Deklaracja { scope: "review" } bez reviewId: kolumna sprawy ' +
                "objetej tajemnica pojdzie do modelu po klasyfikacji " +
                '"internal" zamiast po klasyfikacji sprawy.',
        ).toEqual([]);
        // Kontrola pozytywna: wzorzec, ktorego nic nie spelnia, jest zielony
        // z tego samego powodu co bramka bez przedmiotu.
        expect(
            deklaracji,
            "Zero deklaracji { scope: \"review\" } we froncie - wzorzec " +
                "przestal lapac albo kontekst sprawy zniknal.",
        ).toBeGreaterThanOrEqual(2);
    });

    it("zakres jest w sygnaturze WYMAGANY - nie opcjonalny", () => {
        // Gdyby parametr stal sie opcjonalny, wszystkie call-site'y dalej by sie
        // kompilowaly, a bramka wyzej sprawdzalaby tresc, ktorej juz nie ma.
        const src = zrodlo(DEFINICJA);
        expect(src).toContain("zakres: ZakresPromptuKolumny,");
        expect(src).not.toContain("zakres?:");
    });

    it("detektor domyslnej galezi zapala sie na znanym-zlym", () => {
        // Kontrola pozytywna PRZED asercja na prawdziwym pliku: bramka jest
        // gotowa dopiero po czerwonym. Znany-zly to ksztalt, ktory przechodzi
        // przez obie asercje sygnatury powyzej.
        const znanyZly = [
            "export type ZakresPromptuKolumny =",
            '    | { scope: "review"; reviewId: string }',
            '    | { scope: "workflow_template" };',
            "export async function generateTabularColumnPrompt(",
            "    title: string,",
            "    zakres: ZakresPromptuKolumny,",
            ") {",
            '    const z = zakres ?? { scope: "workflow_template" };',
            "}",
        ].join("\n");
        expect(nadmiarowyBrakSprawy(znanyZly)).toBe(1);

        const dobry = znanyZly.replace(
            '    const z = zakres ?? { scope: "workflow_template" };',
            "    const z = zakres;",
        );
        expect(nadmiarowyBrakSprawy(dobry)).toBe(0);

        // Sam pomiar tez ma mianownik: unia znanego-zlego musi nazywac brak
        // sprawy DOKLADNIE raz, inaczej odejmowanie idzie od zera.
        expect(zlicz(uniaTypu(dobry), BEZ_SPRAWY)).toBe(1);

        // Literal w KOMENTARZU nie jest galezia - inaczej bramka blokowalaby
        // opisanie wlasnej reguly i skusila do usuniecia dokumentacji.
        const zKomentarzem = dobry.replace(
            "export type",
            '/** Kto wola z "workflow_template" - patrz bramka. */\nexport type',
        );
        expect(nadmiarowyBrakSprawy(zKomentarzem)).toBe(0);
    });

    it('brak sprawy nazywa WYLACZNIE unia typu - zero domyslnych galezi', () => {
        const src = readFileSync(join(SRC_DIR, ...DEFINICJA.split("/")), "utf8");
        expect(
            bezKomentarzy(src).includes(DEKLARACJA_TYPU),
            `${DEFINICJA} bez ${DEKLARACJA_TYPU} - pomiar stracil przedmiot ` +
                "i odjalby zero, swiecac na zielono niezaleznie od kodu",
        ).toBe(true);
        expect(
            zlicz(uniaTypu(bezKomentarzy(src)), BEZ_SPRAWY),
            "unia typu nie nazywa juz braku sprawy - pomiar odejmowalby zero " +
                "od zera i nie mial czego oslaniac",
        ).toBe(1);
        expect(
            nadmiarowyBrakSprawy(src),
            `${DEFINICJA} nazywa brak sprawy POZA unia typu. Typ wymusza ` +
                "podanie zakresu, ale domyslna galaz w ciele funkcji " +
                '(np. `zakres ?? { scope: "workflow_template" }`) omija go po ' +
                'cichu i przywraca egress po klasyfikacji "internal" - jedynej ' +
                "galezi straznika, ktora nie jest fail-closed.",
        ).toBe(0);
    });
});
