#!/usr/bin/env node
// Bramka konektorow - kontrola pozytywna I negatywna na znanych-zlych.
//
//   node desktop/scripts/connectors-gate.test.cjs
//
// Bramka, ktorej nie widzialem na CZERWONO na znanym-zlym, nie jest bramka -
// jest funkcja, ktora zawsze zwraca "ok". Kazdy blok nizej buduje syntetyczna
// paczke z JEDNA konkretna usterka i wymaga, zeby bramka ja nazwala.
//
// Znane-zle wziete z realnych zdarzen, nie wymyslone:
//  - eureka jako enabled=false przez brak wpisu w lustrze JURISDICTION
//    (zmierzone 2026-08-17, opisane w AGENTS.md),
//  - edycja rynkowa z doklejonym drugim konektorem (lean jest CELOWE - tak
//    mowi strona /patron/co-potrafie),
//  - pusty manifest, ktory przechodzi kazde "czy wszystko z listy jest ok".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sprawdzKonektory } = require("./connectors-gate.cjs");
const { OCZEKIWANE } = require("./connectors-expected.cjs");

let bledy = 0;
function test(nazwa, warunek, szczegol) {
    if (warunek) {
        console.log(`  OK   ${nazwa}`);
    } else {
        console.error(`  FAIL ${nazwa}${szczegol ? ` -- ${szczegol}` : ""}`);
        bledy += 1;
    }
}

const korzen = fs.mkdtempSync(path.join(os.tmpdir(), "konektory-gate-"));
let licznik = 0;

/** Buduje syntetyczne resources/ i zwraca wynik bramki. */
function paczka({ locale, wpisy, bezManifestu = false, bezLocale = false, surowy = null }) {
    const dir = path.join(korzen, `p${licznik++}`);
    const backend = path.join(dir, "backend");
    fs.mkdirSync(backend, { recursive: true });
    if (!bezLocale) {
        fs.writeFileSync(path.join(backend, "patron-locale.json"), JSON.stringify({ locale }));
    }
    if (!bezManifestu) {
        fs.writeFileSync(
            path.join(backend, "mcp-servers.json"),
            surowy !== null ? surowy : JSON.stringify(wpisy, null, 2),
        );
    }
    return sprawdzKonektory(dir);
}

/** Poprawny manifest dla edycji, prosto z tabeli oczekiwan. */
function poprawny(locale) {
    const o = OCZEKIWANE[locale];
    return o.konektory.map((name) => ({
        name,
        command: "node",
        enabled: o.wlaczone.includes(name),
    }));
}

const mowiO = (w, fragment) => w.problemy.some((p) => p.includes(fragment));

// ── 1. Kontrola pozytywna: poprawna paczka musi byc ZIELONA ──────────────────
console.log("Kontrola pozytywna (paczka zgodna z tabela):");
for (const locale of Object.keys(OCZEKIWANE)) {
    const w = paczka({ locale, wpisy: poprawny(locale) });
    test(`ZIELONO dla edycji ${locale}`, w.ok, w.problemy.join(" | "));
}
{
    // Brak patron-locale.json = edycja PL (tak czyta to runtime i asercja OCR).
    const w = paczka({ locale: "pl", wpisy: poprawny("pl"), bezLocale: true });
    test("ZIELONO gdy brak patron-locale.json, a manifest jest PL", w.ok, w.problemy.join(" | "));
    test("  i bramka mowi, ze edycja jest domyslna", w.podsumowanie.includes("domyslna"));
}

// ── 2. Znane-zle: brak konektora w paczce ────────────────────────────────────
console.log("Znane-zle - usuniety konektor:");
{
    const wpisy = poprawny("pl").filter((e) => e.name !== "krs");
    const w = paczka({ locale: "pl", wpisy });
    test("CZERWONO gdy z manifestu PL zniknal krs", !w.ok);
    test("  i bramka nazywa BRAKUJACY konektor po imieniu", mowiO(w, "krs"), w.problemy.join(" | "));
}

// ── 3. Znane-zle: konektor jedzie WYLACZONY (przypadek eureka 2026-08-17) ────
console.log("Znane-zle - konektor w paczce, ale enabled=false:");
{
    const wpisy = poprawny("pl").map((e) =>
        e.name === "eureka" ? { ...e, enabled: false } : e,
    );
    const w = paczka({ locale: "pl", wpisy });
    test("CZERWONO gdy eureka jedzie jako enabled=false", !w.ok);
    test("  i bramka mowi WYLACZONE, nie 'brakuje'", mowiO(w, "WYLACZONE") && mowiO(w, "eureka"),
        w.problemy.join(" | "));
    test("  liczba konektorow sie zgadza mimo bledu (dlatego sam licznik nie wystarcza)",
        w.podsumowanie.includes("20 konektorow"));
}
{
    // Ten sam blad na edycji rynkowej = instalator bez ZADNEGO zrodla.
    const w = paczka({ locale: "de", wpisy: [{ name: "de-eli", enabled: false }] });
    test("CZERWONO gdy edycja DE wiezie swoj jedyny konektor wylaczony", !w.ok);
    test("  i bramka mowi de-eli", mowiO(w, "de-eli"), w.problemy.join(" | "));
}

// ── 4. Znane-zle: konektor spoza zestawu (edycja rynkowa nie jest lean) ──────
console.log("Znane-zle - konektor nadmiarowy:");
{
    const w = paczka({
        locale: "it",
        wpisy: [{ name: "it-eli", enabled: true }, { name: "eu-sparql", enabled: true }],
    });
    test("CZERWONO gdy edycja IT wiezie drugi konektor", !w.ok);
    test("  i bramka mowi SPOZA + eu-sparql", mowiO(w, "SPOZA") && mowiO(w, "eu-sparql"),
        w.problemy.join(" | "));
}
{
    // Literowka w nazwie: jednoczesnie brak oczekiwanego i nadmiar obcego.
    const wpisy = poprawny("pl").map((e) => (e.name === "saos" ? { ...e, name: "sao5" } : e));
    const w = paczka({ locale: "pl", wpisy });
    test("CZERWONO na literowce sao5 zamiast saos", !w.ok);
    test("  i bramka pokazuje OBIE strony (brak saos + nadmiar sao5)",
        mowiO(w, "saos") && mowiO(w, "sao5"), w.problemy.join(" | "));
}

// ── 5. Znane-zle: wlaczone wbrew oczekiwaniu ─────────────────────────────────
console.log("Znane-zle - konektor wlaczony wbrew oczekiwaniu:");
{
    const wpisy = poprawny("pl").map((e) => (e.name === "fr-eli" ? { ...e, enabled: true } : e));
    const w = paczka({ locale: "pl", wpisy });
    test("CZERWONO gdy fr-eli (klucz PISTE) jest ON w edycji PL", !w.ok);
    test("  i bramka mowi WBREW", mowiO(w, "WBREW"), w.problemy.join(" | "));
}

// ── 6. Znane-zle: pusto, brak pliku, zly ksztalt ─────────────────────────────
console.log("Znane-zle - manifest pusty / brak / zly ksztalt:");
{
    const w = paczka({ locale: "pl", wpisy: [] });
    test("CZERWONO na PUSTEJ tablicy (pusta lista przechodzi kazde 'wszystko ok')", !w.ok);
    test("  i bramka mowi PUSTY", mowiO(w, "PUSTY"), w.problemy.join(" | "));
}
{
    const w = paczka({ locale: "pl", wpisy: null, bezManifestu: true });
    test("CZERWONO gdy mcp-servers.json w ogole nie ma", !w.ok);
}
{
    const w = paczka({ locale: "pl", surowy: '{"saos":true}' });
    test("CZERWONO gdy manifest nie jest tablica", !w.ok);
}
{
    const w = paczka({ locale: "pl", surowy: "{to nie jest json" });
    test("CZERWONO gdy manifest to nie-JSON (bramka nie rzuca wyjatkiem)", !w.ok);
}
{
    const wpisy = [...poprawny("us"), { command: "node", enabled: true }];
    const w = paczka({ locale: "us", wpisy });
    test("CZERWONO gdy wpis nie ma pola name", !w.ok);
}
{
    const wpisy = [...poprawny("us"), { name: "us-eli", enabled: true }];
    const w = paczka({ locale: "us", wpisy });
    test("CZERWONO gdy nazwa powtorzona", !w.ok);
    test("  i bramka mowi powtorzone", mowiO(w, "powtorzone"), w.problemy.join(" | "));
}

// ── 7. Znane-zle: edycja spoza tabeli ────────────────────────────────────────
console.log("Znane-zle - edycja, ktorej tabela nie zna:");
{
    const w = paczka({ locale: "nl", wpisy: [{ name: "nl-eli", enabled: true }] });
    test("CZERWONO na edycji 'nl' bez wpisu w tabeli (nie 'przepusc, bo nie wiem')", !w.ok);
    test("  i bramka mowi, ze trzeba dopisac ZMIERZONY zestaw",
        mowiO(w, "connectors-expected.cjs"), w.problemy.join(" | "));
}

fs.rmSync(korzen, { recursive: true, force: true });

if (bledy) {
    console.error(`\nBramka konektorow: ${bledy} bledow.`);
    process.exit(1);
}
console.log(
    "\nBramka konektorow: rozroznia paczke zgodna od dziewieciu rodzajow niezgodnej.",
);
