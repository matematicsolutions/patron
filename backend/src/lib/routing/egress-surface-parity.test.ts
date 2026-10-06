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
// Wersja 2 (przeglad 2026-10-02, R-TI-01). Wersja 1 liczyla TEKSTOWO, per
// PLIK, i przepuszczala trzy ksztalty niestrzezonego egressu:
//   (a) nowa trasa przez ISTNIEJACY lokalny wrapper (queryTabularCell,
//       queryTabularAllColumns, generateChatTitle) - liczone byly tylko
//       referencje do funkcji z lib/llm, a nie wywolania wrapperow;
//   (b) zakomentowany straznik - `enforceEgressGuard(` w komentarzu liczyl sie
//       jak wywolanie;
//   (c) import namespace (`import * as llm`) i dynamiczny (`await import()`,
//       `require()`) - IMPORT_RE znal tylko `import { ... } from`.
// Do tego liczba wywolan egress nie byla wiazana z liczba straznikow: plik z
// czterema straznikami mogl miec piate, niestrzezone wywolanie.
//
// Mechanika wersji 2 - AST TypeScriptu (ts.createSourceFile, bez
// typecheckingu; deterministycznie, komentarze i napisy nie sa kodem):
//  1. MIANOWNIK: skan CALEGO backend/src poza warstwa lib/llm/ (najpierw
//     kontrola, co skan objal - lekcja no-relative-api.test.ts).
//  2. MIEJSCA EGRESSU: kazde odwolanie do funkcji egress - przez import
//     nazwany (takze z aliasem), namespace (`llm.completeText`,
//     `llm["completeText"]`), destrukturyzacje `await import()`/`require()`,
//     re-eksport - takze bez nawiasu (sciezki wstrzykiwane: judge.ts,
//     defense.ts przekazuja REFERENCJE).
//  3. DOMINACJA STRAZNIKA: miejsce jest strzezone, gdy w tej samej funkcji albo
//     w funkcji ja obejmujacej stoi WYWOLANIE enforceEgressGuard/guardEgress
//     PRZED nim (tekstowo). Ta funkcja-zakres musi tez zawierac
//     appendLlmRouteEvent (audyt allow - straznik zapisuje tylko blokade).
//  4. WRAPPERY: niestrzezone miejsce wewnatrz NAZWANEJ funkcji czyni ja
//     wrapperem - wtedy kazde jej wywolanie w pliku jest miejscem egressu
//     (punkt 3, rekurencyjnie). Wrapper eksportowany albo uzyty jako wartosc
//     (np. przekazany do router.post) "ucieka" z pliku: rejestr musi nazwac
//     plik wolajacego, a wolajacy jest sprawdzany tak samo (w kazdym pliku,
//     ktory importuje modul definiujacy wrapper - import nazwany, namespace,
//     import(), require()).
//  5. REJESTR: zbior plikow == rejestr; liczniki DOKLADNE (referencje,
//     wywolania straznika i audytu, wejscia, lista wrapperow) - plik moze miec
//     straznika i mimo to dostac nowe, niestrzezone wywolanie obok.
//
// Granice (swiadome): dominacja jest tekstowa (straznik w galezi `if` przed
// wywolaniem liczy sie jak straznik); wynik straznika nie jest sprawdzany;
// import modulu przez alias sciezki (nie wzgledny) nie jest rozwiazywany;
// `import(zmienna)` z niedoslownym specyfikatorem nie jest widoczny.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";
import * as ts from "typescript";
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

const STRAZNICY = new Set(["enforceEgressGuard", "guardEgress"]);
const AUDYT = "appendLlmRouteEvent";

/** SDK providerow - import poza lib/llm/ = obejscie calej warstwy routingu. */
const SDK_PROVIDERA_RE =
    /(?:from\s*["']|require\(\s*["'])(@anthropic-ai\/sdk|@google\/genai)/;

/**
 * REJESTR powierzchni LLM - jedyne pliki, w ktorych wolno odwolywac sie do
 * funkcji egress warstwy LLM (albo do wrappera, ktory z nich ucieka).
 *
 * Nowe wywolanie LLM? Kolejnosc jest czescia obowiazku:
 *  1. postaw enforceEgressGuard PRZED wywolaniem (wzorzec: routes/chat.ts
 *     generate-title) i appendLlmRouteEvent(action: "allow") w tym samym
 *     zakresie (koszt/latencje po allow audytuje wolajacy - [Coupling] przy
 *     enforceEgressGuard w AGENTS.md),
 *  2. dopiero potem zaktualizuj liczniki tutaj,
 *  3. i wiersz #12 sekcji Mirrors w AGENTS.md.
 */
interface WpisRejestru {
    plik: string;
    /** Odwolania do funkcji egress (i cudzych wrapperow), bez deklaracji importu. */
    refy: Record<string, number>;
    /** Wywolania enforceEgressGuard/guardEgress w pliku. */
    straznicy: number;
    /** Wywolania appendLlmRouteEvent w pliku. */
    audyty: number;
    /** Miejsca egressu poza wnetrzem wrapperow - kazde musi byc strzezone. */
    wejscia: number;
    /** Lokalne wrappery egress (niestrzezone wewnatrz, wolane tylko wprost). */
    wrappery: string[];
    /** Wrapper uciekajacy z pliku -> plik wolajacego, gdzie stoi straznik. */
    eksportuje?: Record<string, string>;
    /**
     * Uzasadnienie zera audytu allow. Jedyny dopuszczalny powod: nic nie
     * opuszcza maszyny.
     */
    bezAudytu?: string;
    dlaczego: string;
}

const REJESTR: WpisRejestru[] = [
    {
        plik: "lib/chat/stream.ts",
        refy: { streamChatWithTools: 1 },
        straznicy: 1,
        // 2: tura udana i tura zakonczona bledem providera (audyt 2026-09, C-03).
        audyty: 2,
        wejscia: 1,
        wrappery: [],
        dlaczego: "czat glowny - straznik przed streamChatWithTools (ADR-0067)",
    },
    {
        plik: "routes/chat.ts",
        refy: { completeText: 1 },
        straznicy: 1,
        audyty: 1,
        wejscia: 1,
        wrappery: [],
        dlaczego: "tytul czatu (generate-title) - straznik przed completeText",
    },
    {
        plik: "routes/tabular.ts",
        refy: { completeText: 3, streamChatWithTools: 1 },
        straznicy: 4,
        audyty: 4,
        // /prompt (completeText wprost), regenerate-cell (queryTabularCell),
        // generate (queryTabularAllColumns), tytul czatu (generateChatTitle).
        wejscia: 4,
        wrappery: ["generateChatTitle", "queryTabularAllColumns", "queryTabularCell"],
        dlaczego:
            "tabular: generate + regenerate-cell + generator promptu kolumny " +
            "+ tytul czatu tabular (dwie ostatnie strzezone od 2026-08-31; " +
            "czat tabular idzie przez runLLMStream -> lib/chat/stream.ts)",
    },
    {
        plik: "lib/citation/judge.ts",
        refy: { completeText: 1 },
        straznicy: 1,
        audyty: 0,
        wejscia: 1,
        wrappery: [],
        bezAudytu:
            "sedzia jest LOKALNY-ONLY: makeJudge zwraca null dla modelu " +
            "nielokalnego (isLocalModel), wiec nic nie opuszcza maszyny - " +
            "nie ma egresu do zapisania. Straznik jest drugim zabezpieczeniem.",
        dlaczego:
            "sedzia cytatow - guardEgress fail-closed przed wstrzykiwanym " +
            "completeText (ADR-0095)",
    },
    {
        plik: "lib/pipeline/defense.ts",
        refy: { completeText: 1 },
        straznicy: 0,
        audyty: 0,
        wejscia: 0,
        wrappery: [],
        eksportuje: { runDefensePipeline: "routes/draft.ts" },
        dlaczego:
            "pipeline obrony - completeText wstrzykiwany jako default; " +
            "straznik u wolajacego (routes/draft.ts, ADR-0067)",
    },
    {
        plik: "routes/draft.ts",
        refy: { runDefensePipeline: 1 },
        straznicy: 1,
        audyty: 1,
        wejscia: 1,
        wrappery: [],
        dlaczego:
            "draft/refine - straznik i audyt allow przed runDefensePipeline " +
            "(wrapper z lib/pipeline/defense.ts)",
    },
];

// --------------------------------------------------------------------------
// Skan plikow
// --------------------------------------------------------------------------

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

/** Specyfikator modulu wskazujacy na warstwe LLM (lib/llm lub jej pliki). */
function czyModulLlm(spec: string): boolean {
    return /(^|\/)llm(\/|$)/.test(spec);
}

// --------------------------------------------------------------------------
// Analiza jednego pliku (AST)
// --------------------------------------------------------------------------

interface Miejsce {
    nazwa: string;
    linia: number;
    strzezony: boolean;
    audytowany: boolean;
}

interface Analiza {
    /** Import warstwy LLM w ksztalcie, ktory moze egresowac. */
    importujeLlm: boolean;
    refy: Record<string, number>;
    straznicy: number;
    audyty: number;
    /** Miejsca egressu poza wnetrzem wrapperow lokalnych. */
    wejscia: Miejsce[];
    wrappery: string[];
    uciekajace: string[];
}

function parsuj(src: string, plik = "fixture.ts"): ts.SourceFile {
    return ts.createSourceFile(plik, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function odwiedz(n: ts.Node, f: (n: ts.Node) => void): void {
    f(n);
    ts.forEachChild(n, (c) => odwiedz(c, f));
}

const czyFunkcja = (n: ts.Node): boolean =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n);

const maEksport = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) &&
    (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

function wPozycjiTypu(n: ts.Node): boolean {
    for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
        if (ts.isTypeNode(a)) return true;
    }
    return false;
}

/**
 * Czy identyfikator jest ODWOLANIEM do wartosci (a nie deklaracja, importem,
 * kluczem obiektu albo typem). `x.nazwa` i `{ nazwa }` to odwolania.
 */
function jestOdwolaniem(id: ts.Identifier): boolean {
    const p = id.parent;
    if (
        ts.isImportSpecifier(p) ||
        ts.isImportClause(p) ||
        ts.isNamespaceImport(p) ||
        ts.isImportEqualsDeclaration(p)
    ) {
        return false;
    }
    if (ts.isBindingElement(p)) return p.initializer === id;
    if (ts.isPropertyAccessExpression(p)) return true;
    if (ts.isShorthandPropertyAssignment(p) || ts.isExportSpecifier(p)) return true;
    if ((p as ts.NamedDeclaration).name === id) return false;
    if (ts.isQualifiedName(p)) return false;
    return !wPozycjiTypu(id);
}

const nazwaWywolania = (c: ts.CallExpression): string | null =>
    ts.isIdentifier(c.expression)
        ? c.expression.text
        : ts.isPropertyAccessExpression(c.expression)
          ? c.expression.name.text
          : null;

/** Wrappery, ktore uciekly z plikow: plik definiujacy (wzgl. src) -> nazwy. */
type Zewnetrzne = ReadonlyMap<string, readonly string[]>;

/**
 * Plik (wzgl. backend/src) wskazany przez wzgledny specyfikator importu albo
 * null (pakiet, alias). Rozwiazanie jak w TS: `x` -> `x.ts` | `x/index.ts`.
 */
function rozwiazModul(plik: string, spec: string, znane: Zewnetrzne): string | null {
    if (!spec.startsWith(".")) return null;
    const baza = posix
        .normalize(posix.join(posix.dirname(plik), spec))
        .replace(/\.(js|ts)$/, "");
    for (const kandydat of [`${baza}.ts`, `${baza}/index.ts`]) {
        if (znane.has(kandydat)) return kandydat;
    }
    return null;
}

/**
 * Analiza pliku `plik` (sciezka wzgl. backend/src). `zewn` = wrappery egress,
 * ktore uciekly z innych plikow - sledzone tylko tam, gdzie plik importuje
 * modul, ktory je definiuje (nazwany, namespace, dynamiczny, require).
 */
function analizuj(
    sf: ts.SourceFile,
    plik = "routes/fixture.ts",
    zewn: Zewnetrzne = new Map(),
): Analiza {
    const linia = (n: ts.Node): number =>
        sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    // 1a. Importy: warstwa LLM oraz moduly z wrapperami uciekajacymi.
    let importujeLlm = false;
    const aliasy = new Map<string, string>();
    for (const n of EGRESS_FUNKCJE) aliasy.set(n, n);
    // Nazwy sledzone jako CZLONEK modulu (`ns.x`, `ns["x"]`, `{ x } = await import()`).
    const czlonkowie = new Set<string>(EGRESS_FUNKCJE);
    const modulZewn = (spec: string): readonly string[] => {
        const d = rozwiazModul(plik, spec, zewn);
        return d ? (zewn.get(d) ?? []) : [];
    };
    odwiedz(sf, (n) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
            const spec = n.moduleSpecifier.text;
            const llm = czyModulLlm(spec);
            const obce = modulZewn(spec);
            const ic = n.importClause;
            if (!ic || ic.isTypeOnly) return;
            const nb = ic.namedBindings;
            if (llm && ic.name) importujeLlm = true; // import domyslny
            if (nb && ts.isNamespaceImport(nb)) {
                if (llm) importujeLlm = true;
                for (const w of obce) czlonkowie.add(w);
            }
            if (nb && ts.isNamedImports(nb)) {
                for (const el of nb.elements) {
                    if (el.isTypeOnly) continue;
                    const oryginal = (el.propertyName ?? el.name).text;
                    if (EGRESS_FUNKCJE.includes(oryginal) || obce.includes(oryginal)) {
                        aliasy.set(el.name.text, oryginal);
                        if (llm) importujeLlm = true;
                    }
                }
            }
        } else if (
            ts.isExportDeclaration(n) &&
            !n.isTypeOnly &&
            n.moduleSpecifier &&
            ts.isStringLiteral(n.moduleSpecifier) &&
            czyModulLlm(n.moduleSpecifier.text)
        ) {
            importujeLlm = true; // re-eksport warstwy LLM
        } else if (
            ts.isImportEqualsDeclaration(n) &&
            ts.isExternalModuleReference(n.moduleReference) &&
            ts.isStringLiteralLike(n.moduleReference.expression)
        ) {
            const spec = n.moduleReference.expression.text;
            if (czyModulLlm(spec)) importujeLlm = true;
            for (const w of modulZewn(spec)) czlonkowie.add(w);
        } else if (ts.isCallExpression(n)) {
            const dynamiczny =
                n.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(n.expression) && n.expression.text === "require");
            const a = n.arguments[0];
            if (dynamiczny && a && ts.isStringLiteralLike(a)) {
                if (czyModulLlm(a.text)) importujeLlm = true;
                for (const w of modulZewn(a.text)) czlonkowie.add(w);
            }
        }
    });

    // 1b. Destrukturyzacja (`const { completeText: ct } = await import(...)`),
    // wywolania straznika i audytu.
    const straznicy: ts.CallExpression[] = [];
    const audyty: ts.CallExpression[] = [];
    odwiedz(sf, (n) => {
        if (ts.isCallExpression(n)) {
            const nazwa = nazwaWywolania(n);
            if (nazwa && STRAZNICY.has(nazwa)) straznicy.push(n);
            if (nazwa === AUDYT) audyty.push(n);
        } else if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
            const klucz =
                n.propertyName && ts.isIdentifier(n.propertyName)
                    ? n.propertyName.text
                    : n.name.text;
            if (czlonkowie.has(klucz)) aliasy.set(n.name.text, klucz);
        }
    });

    // 2. Bezposrednie miejsca egressu.
    const refy: Record<string, number> = {};
    const kolejka: Array<{ wezel: ts.Node; nazwa: string }> = [];
    const dodaj = (wezel: ts.Node, nazwa: string, liczRef = true): void => {
        if (liczRef) refy[nazwa] = (refy[nazwa] ?? 0) + 1;
        kolejka.push({ wezel, nazwa });
    };
    odwiedz(sf, (n) => {
        if (ts.isIdentifier(n)) {
            const p = n.parent;
            if (ts.isPropertyAccessExpression(p) && p.name === n) {
                if (czlonkowie.has(n.text)) dodaj(p, n.text); // llm.completeText
                return;
            }
            const oryginal = aliasy.get(n.text);
            if (oryginal && jestOdwolaniem(n)) dodaj(n, oryginal);
        } else if (
            ts.isElementAccessExpression(n) &&
            ts.isStringLiteralLike(n.argumentExpression) &&
            czlonkowie.has(n.argumentExpression.text)
        ) {
            dodaj(n, n.argumentExpression.text); // llm["completeText"]
        }
    });

    // 3. Dominacja straznika i audyt w jego zakresie.
    const najblizszaFunkcja = (n: ts.Node): ts.Node => {
        for (let a = n.parent; a; a = a.parent) if (czyFunkcja(a)) return a;
        return sf;
    };
    const zawiera = (zakres: ts.Node, n: ts.Node): boolean =>
        n.getStart(sf) >= zakres.getStart(sf) && n.end <= zakres.end;
    const zakresStraznika = (s: ts.Node): ts.Node | null => {
        const start = s.getStart(sf);
        for (let a: ts.Node | undefined = s.parent; a; a = a.parent) {
            if (!czyFunkcja(a) && !ts.isSourceFile(a)) continue;
            const zakres = a;
            if (
                straznicy.some(
                    (g) => najblizszaFunkcja(g) === zakres && g.getStart(sf) < start,
                )
            ) {
                return zakres;
            }
        }
        return null;
    };

    // 4. Wrappery: najblizsza NAZWANA funkcja wokol niestrzezonego miejsca.
    const nazwanaFunkcja = (
        s: ts.Node,
    ): { nazwa: string; deklaracja: ts.Node; eksport: boolean } | null => {
        for (let a = s.parent; a; a = a.parent) {
            if (ts.isFunctionDeclaration(a) && a.name) {
                return { nazwa: a.name.text, deklaracja: a.name, eksport: maEksport(a) };
            }
            if (
                (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) &&
                ts.isVariableDeclaration(a.parent) &&
                ts.isIdentifier(a.parent.name)
            ) {
                const stmt = a.parent.parent.parent;
                return {
                    nazwa: a.parent.name.text,
                    deklaracja: a.parent.name,
                    eksport: ts.isVariableStatement(stmt) && maEksport(stmt),
                };
            }
            if (ts.isMethodDeclaration(a) && ts.isIdentifier(a.name)) {
                // this.metoda() nie jest sledzone - metoda zawsze "ucieka".
                return { nazwa: a.name.text, deklaracja: a.name, eksport: true };
            }
        }
        return null;
    };
    const odwolaniaDo = (nazwa: string, deklaracja: ts.Node): ts.Identifier[] => {
        const wynik: ts.Identifier[] = [];
        odwiedz(sf, (n) => {
            if (ts.isIdentifier(n) && n !== deklaracja && n.text === nazwa) {
                const p = n.parent;
                if (ts.isPropertyAccessExpression(p) && p.name === n) return;
                if (jestOdwolaniem(n)) wynik.push(n);
            }
        });
        return wynik;
    };

    const wejscia: Miejsce[] = [];
    const wrappery = new Set<string>();
    const uciekajace = new Set<string>();
    const odwiedzone = new Set<string>();
    while (kolejka.length > 0) {
        const { wezel, nazwa } = kolejka.shift()!;
        const zakres = zakresStraznika(wezel);
        if (zakres) {
            wejscia.push({
                nazwa,
                linia: linia(wezel),
                strzezony: true,
                audytowany: audyty.some((a) => zawiera(zakres, a)),
            });
            continue;
        }
        const w = nazwanaFunkcja(wezel);
        if (!w) {
            wejscia.push({ nazwa, linia: linia(wezel), strzezony: false, audytowany: false });
            continue;
        }
        if (odwiedzone.has(w.nazwa)) continue;
        odwiedzone.add(w.nazwa);
        const odw = odwolaniaDo(w.nazwa, w.deklaracja);
        const tylkoWywolania = odw.every(
            (r) => ts.isCallExpression(r.parent) && r.parent.expression === r,
        );
        if (w.eksport || !tylkoWywolania) {
            uciekajace.add(w.nazwa);
            continue;
        }
        wrappery.add(w.nazwa);
        for (const r of odw) dodaj(r, w.nazwa, false);
    }

    return {
        importujeLlm,
        refy,
        straznicy: straznicy.length,
        audyty: audyty.length,
        wejscia,
        wrappery: [...wrappery].sort(),
        uciekajace: [...uciekajace].sort(),
    };
}

/** Analiza fixture'u (zrodla w napisie) - do kontroli pozytywnych/negatywnych. */
const analizujZrodlo = (src: string, plik?: string, zewn?: Zewnetrzne): Analiza =>
    analizuj(parsuj(src), plik, zewn);

const jestPowierzchnia = (a: Analiza): boolean =>
    a.importujeLlm || Object.keys(a.refy).length > 0 || a.uciekajace.length > 0;

/**
 * Analiza calego drzewa. Wrappery uciekajace z pliku sa sledzone w plikach
 * importujacych modul, ktory je definiuje, az zbior przestanie rosnac (wolajacy wrappera z defense.ts jest
 * sprawdzany tak samo jak wolajacy completeText).
 */
function analizujDrzewo(): Map<string, Analiza> {
    const pliki = plikiDoSkanu().map((f) => ({
        rel: wzgledna(f),
        sf: parsuj(readFileSync(f, "utf8"), f),
    }));
    let zewn = new Map<string, readonly string[]>();
    for (let i = 0; i < 6; i++) {
        const wyniki = new Map<string, Analiza>();
        for (const p of pliki) wyniki.set(p.rel, analizuj(p.sf, p.rel, zewn));
        const nastepne = new Map<string, readonly string[]>();
        for (const [rel, a] of wyniki) {
            if (a.uciekajace.length > 0) nastepne.set(rel, a.uciekajace);
        }
        if (JSON.stringify([...nastepne].sort()) === JSON.stringify([...zewn].sort())) {
            return wyniki;
        }
        zewn = nastepne;
    }
    throw new Error("analizujDrzewo: zbior wrapperow uciekajacych nie zbiega");
}

let drzewo: Map<string, Analiza> | null = null;
const analizaDrzewa = (): Map<string, Analiza> => (drzewo ??= analizujDrzewo());

/** Rozjazdy jednej powierzchni z wpisem rejestru (puste = zgodna). */
function rozjazdyWpisu(wpis: WpisRejestru, a: Analiza): string[] {
    const r: string[] = [];
    const p = wpis.plik;
    const sortuj = (o: Record<string, number>): string =>
        JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
    if (sortuj(a.refy) !== sortuj(wpis.refy)) {
        r.push(`${p}: refy rejestr ${sortuj(wpis.refy)}, zmierzone ${sortuj(a.refy)}`);
    }
    if (a.straznicy !== wpis.straznicy) {
        r.push(`${p}: wywolania straznika rejestr ${wpis.straznicy}, zmierzone ${a.straznicy}`);
    }
    if (a.audyty !== wpis.audyty) {
        r.push(`${p}: ${AUDYT}( rejestr ${wpis.audyty}, zmierzone ${a.audyty}`);
    }
    if (a.wejscia.length !== wpis.wejscia) {
        r.push(`${p}: wejscia egress rejestr ${wpis.wejscia}, zmierzone ${a.wejscia.length}`);
    }
    if (JSON.stringify(a.wrappery) !== JSON.stringify([...wpis.wrappery].sort())) {
        r.push(`${p}: wrappery rejestr ${wpis.wrappery}, zmierzone ${a.wrappery}`);
    }
    const eksp = Object.keys(wpis.eksportuje ?? {}).sort();
    if (JSON.stringify(a.uciekajace) !== JSON.stringify(eksp)) {
        r.push(`${p}: wrappery uciekajace z pliku rejestr [${eksp}], zmierzone [${a.uciekajace}]`);
    }
    for (const m of a.wejscia) {
        if (!m.strzezony) {
            r.push(
                `${p}:${m.linia}: ${m.nazwa} BEZ straznika (brak wywolania ` +
                    `enforceEgressGuard/guardEgress przed nim w tej funkcji ani w funkcji ja obejmujacej)`,
            );
        } else if (!m.audytowany && !wpis.bezAudytu) {
            r.push(
                `${p}:${m.linia}: ${m.nazwa} strzezony, ale zakres straznika nie ma ` +
                    `${AUDYT}(action: "allow") - egress bez sladu llm_route`,
            );
        }
    }
    if (wpis.wejscia > 0 && wpis.audyty === 0 && !wpis.bezAudytu) {
        r.push(`${p}: audyt 0 bez nazwanego wyjatku - jedyny dopuszczalny powod to "nic nie opuszcza maszyny"`);
    }
    return r;
}

const nieStrzezone = (a: Analiza): Miejsce[] => a.wejscia.filter((m) => !m.strzezony);

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
        // Kazdy plik daje sie sparsowac - plik, ktorego parser nie zrozumial,
        // bylby po cichu pusty dla bramki.
        const zle = plikiDoSkanu().filter(
            (f) =>
                (ts.transpileModule(readFileSync(f, "utf8"), {
                    fileName: f,
                    reportDiagnostics: true,
                }).diagnostics ?? []).length > 0,
        );
        expect(zle.map(wzgledna)).toEqual([]);
        // Limit wiekszy niz domyslne 5 s: test parsuje AST calego backend/src (pierwszy,
        // nie-cache'owany przebieg). W izolacji ~3,8-4,9 s, w pelnej suicie pod obciazeniem
        // przekraczal 5 s - zmierzone 2026-10-06. 30 s nadal lapie zawieszenie.
    }, 30_000);

    it("detektor zapala sie na znanym-zlym i milczy na znanym-dobrym (bramka gotowa dopiero po czerwonym)", () => {
        // --- znane-zle ---
        // Gole wywolanie bez straznika.
        const goly = analizujZrodlo(
            `import { completeText } from "../llm";\n` +
                `export const f = (t: string) => completeText({ model: "m", user: t });\n`,
        );
        expect(goly.refy).toEqual({ completeText: 1 });
        expect(goly.uciekajace).toEqual(["f"]);

        // Alias importu.
        const alias = analizujZrodlo(
            `import { streamChatWithTools as sctw } from "../../lib/llm";\n` +
                `router.post("/x", async () => { await sctw({}); });\n`,
        );
        expect(alias.refy).toEqual({ streamChatWithTools: 1 });
        expect(nieStrzezone(alias)).toHaveLength(1);

        // Obejscie wejscia kanonicznego przez funkcje providera.
        const provider = analizujZrodlo(
            `import { streamClaude } from "../llm/claude";\nvoid streamClaude;\n`,
        );
        expect(provider.refy).toEqual({ streamClaude: 1 });
        expect(nieStrzezone(provider)).toHaveLength(1);

        // (b) Straznik ZAKOMENTOWANY: komentarz nie jest wywolaniem.
        const zakomentowany = analizujZrodlo(
            `import { completeText } from "../lib/llm";\n` +
                `import { enforceEgressGuard, appendLlmRouteEvent } from "../lib/routing";\n` +
                `router.post("/x", async () => {\n` +
                `    // const guard = await enforceEgressGuard({ db });\n` +
                `    /* enforceEgressGuard({ db }) */\n` +
                `    const s = "enforceEgressGuard(";\n` +
                `    await completeText({});\n` +
                `    await appendLlmRouteEvent(db, {});\n` +
                `});\n`,
        );
        expect(zakomentowany.straznicy).toBe(0);
        expect(nieStrzezone(zakomentowany)).toHaveLength(1);

        // (c) Import namespace i dynamiczny / require / dostep przez [].
        const namespace = analizujZrodlo(
            `import * as llm from "../lib/llm";\n` +
                `export async function s(t: string) { return llm.completeText({ user: t }); }\n`,
        );
        expect(namespace.importujeLlm).toBe(true);
        expect(namespace.refy).toEqual({ completeText: 1 });
        expect(namespace.uciekajace).toEqual(["s"]);

        const dynamiczny = analizujZrodlo(
            `router.post("/x", async () => {\n` +
                `    const { completeText: ct } = await import("../lib/llm");\n` +
                `    return ct({});\n});\n`,
        );
        expect(dynamiczny.importujeLlm).toBe(true);
        expect(dynamiczny.refy).toEqual({ completeText: 1 });
        expect(nieStrzezone(dynamiczny)).toHaveLength(1);

        const wymagany = analizujZrodlo(
            `router.post("/x", async () => require("../lib/llm").streamGemini({}));\n`,
        );
        expect(wymagany.importujeLlm).toBe(true);
        expect(nieStrzezone(wymagany).map((m) => m.nazwa)).toEqual(["streamGemini"]);

        const nawias = analizujZrodlo(
            `import * as llm from "../lib/llm";\n` +
                `router.post("/x", async () => llm["completeText"]({}));\n`,
        );
        expect(nieStrzezone(nawias).map((m) => m.nazwa)).toEqual(["completeText"]);

        // Sam import namespace (bez widocznego uzycia) tez czyni plik powierzchnia.
        expect(jestPowierzchnia(analizujZrodlo(`import * as llm from "../lib/llm";\nvoid llm;\n`))).toBe(true);

        // (a) Nowa trasa przez ISTNIEJACY lokalny wrapper, bez straznika.
        const wrapper =
            `import { completeText } from "../lib/llm";\n` +
            `import { enforceEgressGuard, appendLlmRouteEvent } from "../lib/routing";\n` +
            `async function zapytaj(t: string) { return completeText({ user: t }); }\n` +
            `router.post("/a", async () => {\n` +
            `    const g = await enforceEgressGuard({});\n` +
            `    await zapytaj("x");\n` +
            `    await appendLlmRouteEvent(db, {});\n` +
            `});\n`;
        const wrapperOk = analizujZrodlo(wrapper);
        expect(wrapperOk.wrappery).toEqual(["zapytaj"]);
        expect(wrapperOk.wejscia).toEqual([
            { nazwa: "zapytaj", linia: 6, strzezony: true, audytowany: true },
        ]);
        const wrapperZly = analizujZrodlo(
            wrapper + `router.post("/b", async () => zapytaj("y"));\n`,
        );
        expect(nieStrzezone(wrapperZly)).toEqual([
            { nazwa: "zapytaj", linia: 9, strzezony: false, audytowany: false },
        ]);

        // Wrapper przekazany jako wartosc (handler trasy) "ucieka" z analizy.
        const wartosc = analizujZrodlo(
            `import { completeText } from "../lib/llm";\n` +
                `async function handler() { await completeText({}); }\n` +
                `router.post("/x", handler);\n`,
        );
        expect(wartosc.uciekajace).toEqual(["handler"]);

        // Straznik PO wywolaniu i straznik w SASIEDNIEJ trasie nie strzega.
        const pozniej = analizujZrodlo(
            `import { completeText } from "../lib/llm";\n` +
                `router.post("/x", async () => { await completeText({}); await enforceEgressGuard({}); });\n` +
                `router.post("/y", async () => { await enforceEgressGuard({}); });\n` +
                `router.post("/z", async () => { await completeText({}); });\n`,
        );
        expect(nieStrzezone(pozniej)).toHaveLength(2);

        // Strzezony, ale bez audytu allow w zakresie straznika.
        const bezAudytu = analizujZrodlo(
            `import { completeText } from "../lib/llm";\n` +
                `router.post("/x", async () => { await enforceEgressGuard({}); await completeText({}); });\n`,
        );
        expect(bezAudytu.wejscia).toEqual([
            { nazwa: "completeText", linia: 2, strzezony: true, audytowany: false },
        ]);
        expect(rozjazdyWpisu(
            { plik: "x.ts", refy: { completeText: 1 }, straznicy: 1, audyty: 0, wejscia: 1, wrappery: [], dlaczego: "" },
            bezAudytu,
        ).length).toBeGreaterThan(0);

        // Wrapper uciekajacy z innego pliku: wolajacy jest sprawdzany po nazwie.
        const zewn = new Map([["lib/pipeline/x.ts", ["runPipeline"]]]);
        const wolajacy = analizujZrodlo(
            `import { runPipeline as rp } from "../lib/pipeline/x";\n` +
                `import * as px from "../lib/pipeline/x";\n` +
                `router.post("/x", async () => rp("t"));\n` +
                `router.post("/y", async () => px.runPipeline("t"));\n` +
                `router.post("/z", async () => (await import("../lib/pipeline/x")).runPipeline("t"));\n`,
            "routes/a.ts",
            zewn,
        );
        expect(nieStrzezone(wolajacy).map((m) => m.nazwa)).toEqual([
            "runPipeline",
            "runPipeline",
            "runPipeline",
        ]);
        // Ta sama nazwa bez importu modulu definiujacego - inna funkcja, cisza.
        const obcaNazwa = analizujZrodlo(
            `function runPipeline() {}\nrunPipeline();\n`,
            "routes/b.ts",
            zewn,
        );
        expect(obcaNazwa.wejscia).toEqual([]);

        // --- znane-dobre (kontrola negatywna) ---
        // Import samego typu / funkcji nie-egress, wzmianka w komentarzu i w
        // napisie, klucz obiektu i typeof nie zapalaja.
        const niewinny = analizujZrodlo(
            `import type { UserApiKeys } from "../llm";\n` +
                `import { resolveModel, type completeText } from "../llm";\n` +
                `// completeText({ model }) - tylko komentarz\n` +
                `const s = "completeText(";\n` +
                `const o = { completeText: 1 };\n` +
                `type T = typeof import("../llm").completeText;\n` +
                `void resolveModel; void s; void o;\n`,
        );
        expect(jestPowierzchnia(niewinny)).toBe(false);
        expect(niewinny.wejscia).toEqual([]);

        // Obejscie przez SDK providera.
        expect(
            SDK_PROVIDERA_RE.test(`import Anthropic from "@anthropic-ai/sdk";`),
        ).toBe(true);
        expect(
            SDK_PROVIDERA_RE.test(`import { GoogleGenAI } from "@google/genai";`),
        ).toBe(true);
    });

    it("zbior plikow referujacych warstwe LLM == REJESTR powierzchni", () => {
        const wykryte = [...analizaDrzewa()]
            .filter(([, a]) => jestPowierzchnia(a))
            .map(([p]) => p)
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

    it("kazde miejsce egressu jest strzezone i audytowane; liczniki zgodne z REJESTREM (dokladnie, nie >=)", () => {
        const drzewoA = analizaDrzewa();
        const rozjazdy: string[] = [];
        for (const wpis of REJESTR) {
            const a = drzewoA.get(wpis.plik);
            if (!a) {
                rozjazdy.push(`${wpis.plik}: brak pliku w skanie`);
                continue;
            }
            rozjazdy.push(...rozjazdyWpisu(wpis, a));
        }
        // Pliki spoza rejestru z niestrzezonym egressem - tez rozjazd (wiadomosc
        // ze wskazaniem linii, nie tylko "plik niezarejestrowany").
        const zarejestrowane = new Set(REJESTR.map((r) => r.plik));
        for (const [plik, a] of drzewoA) {
            if (zarejestrowane.has(plik)) continue;
            for (const m of nieStrzezone(a)) {
                rozjazdy.push(`${plik}:${m.linia}: ${m.nazwa} BEZ straznika (plik spoza REJESTRU)`);
            }
            for (const w of a.uciekajace) {
                rozjazdy.push(`${plik}: wrapper egress ${w} uciekajacy z pliku (plik spoza REJESTRU)`);
            }
        }
        expect(
            rozjazdy,
            "Rozjazd powierzchni egress. Nowe wywolanie LLM (takze przez " +
                "istniejacy wrapper) = straznik PRZED nim ORAZ " +
                "appendLlmRouteEvent(action: 'allow') w tym samym zakresie; " +
                "dopiero potem liczniki w REJESTRZE. Spadek licznika straznika = " +
                "ktos zdjal straznika z powierzchni.",
        ).toEqual([]);
    });

    it("wrapper uciekajacy z pliku ma wolajacego w REJESTRZE, a ten wola go pod straznikiem", () => {
        const rozjazdy: string[] = [];
        const wpisy = new Map(REJESTR.map((r) => [r.plik, r]));
        for (const wpis of REJESTR) {
            for (const [wrapper, wolajacy] of Object.entries(wpis.eksportuje ?? {})) {
                const w = wpisy.get(wolajacy);
                if (!w) {
                    rozjazdy.push(`${wpis.plik}: ${wrapper} -> ${wolajacy} poza REJESTREM`);
                } else if (!w.refy[wrapper]) {
                    rozjazdy.push(`${wolajacy}: nie wola ${wrapper} (rejestr ${wpis.plik})`);
                }
            }
        }
        // Kazdy plik odwolujacy sie do wrappera uciekajacego jest w rejestrze
        // jako jego wolajacy (inaczej: niezadeklarowane drugie uzycie).
        for (const [plik, a] of analizaDrzewa()) {
            for (const wpis of REJESTR) {
                for (const [wrapper, wolajacy] of Object.entries(wpis.eksportuje ?? {})) {
                    if (a.refy[wrapper] && plik !== wolajacy) {
                        rozjazdy.push(`${plik}: wola ${wrapper}, a REJESTR zna tylko ${wolajacy}`);
                    }
                }
            }
        }
        expect(rozjazdy).toEqual([]);
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
            "routes/draft.ts",
        ]) {
            expect(zarejestrowane.has(plik), `${plik} wypadl z REJESTRU`).toBe(
                true,
            );
        }
    });
});
