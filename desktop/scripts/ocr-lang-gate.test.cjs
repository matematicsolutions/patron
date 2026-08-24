#!/usr/bin/env node
// Bramka jezyka OCR - kontrola pozytywna, negatywna i kontrola dryftu.
//
// Po co osobny test: zmiana z 2026-08-24 zamienila ciche ostrzezenie na twardy
// blad builda, a jezyk OCR przestal byc wpisany na sztywno jako "pol". Bramka,
// ktorej nie widzialem na CZERWONO na znanym-zlym, nie jest bramka.
//
// Trzeci blok jest wazniejszy od dwoch pierwszych: main.js NIE MOZE importowac
// scripts/ocr-lang.cjs, bo `build.files` w package.json to jawna allowlista i
// dodatkowy modul nie trafilby do paczki (apka padlaby dopiero po instalacji).
// Kopia literalu w main.js jest wiec swiadoma - i dlatego wymaga pomiaru, ze
// nadal mowi to samo co modul.
//
// Uruchomienie: node desktop/scripts/ocr-lang-gate.test.cjs
// Wpiete w: prepare:resources, build, build:dir (desktop/package.json).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { OCR_LANG, requiredPack } = require("./ocr-lang.cjs");

let bledy = 0;
function test(nazwa, warunek) {
    if (warunek) {
        console.log(`  OK   ${nazwa}`);
    } else {
        console.error(`  FAIL ${nazwa}`);
        bledy += 1;
    }
}

// ── 1. Sama mapa ─────────────────────────────────────────────────────────────
console.log("Mapa locale -> jezyk OCR:");
test("pl -> pol", OCR_LANG.pl === "pol");
test("br/pt -> por (NIE pol)", OCR_LANG.pt === "por");
test("de -> deu (NIE pol)", OCR_LANG.de === "deu");
test("gb i us dziela eng z en", OCR_LANG.gb === "eng" && OCR_LANG.us === "eng");
test("kazda z 9 edycji ma mapowanie", Object.keys(OCR_LANG).length === 9);

// ── 2. Regula na katalogu tessdata ───────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-gate-"));
fs.writeFileSync(path.join(tmp, "pol.traineddata"), "x");
fs.writeFileSync(path.join(tmp, "eng.traineddata"), "x");
const jest = (locale) => fs.existsSync(path.join(tmp, requiredPack(locale)));

console.log("Bramka na katalogu z pol+eng:");
test("ZIELONO dla pl (pakiet jest)", jest("pl") === true);
test("ZIELONO dla en (pakiet jest)", jest("en") === true);
test("CZERWONO dla de (znany-zly: brak deu)", jest("de") === false);
test("CZERWONO dla pt (znany-zly: brak por)", jest("pt") === false);
test("CZERWONO dla it (znany-zly: brak ita)", jest("it") === false);

fs.rmSync(tmp, { recursive: true, force: true });

// ── 3. Dryft: kopia w main.js vs modul ───────────────────────────────────────
console.log("Dryft main.js vs scripts/ocr-lang.cjs:");
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const blok = mainSrc.match(/const OCR_LANG = \{([\s\S]*?)\};/);
if (!blok) {
    console.error("  FAIL nie znalazlem literalu OCR_LANG w main.js (zmienil sie ksztalt?)");
    bledy += 1;
} else {
    const zMain = {};
    for (const m of blok[1].matchAll(/(\w+):\s*'([a-z]{3})'/g)) {
        zMain[m[1]] = m[2];
    }
    const klucze = new Set([...Object.keys(OCR_LANG), ...Object.keys(zMain)]);
    const rozjazdy = [...klucze].filter((k) => OCR_LANG[k] !== zMain[k]);
    test(
        `main.js ma te sama mape co modul (${Object.keys(zMain).length} edycji)`,
        rozjazdy.length === 0,
    );
    if (rozjazdy.length) {
        for (const k of rozjazdy) {
            console.error(`       ${k}: modul="${OCR_LANG[k]}" main.js="${zMain[k]}"`);
        }
    }
}

if (bledy) {
    console.error(`\nBramka jezyka OCR: ${bledy} bledow.`);
    process.exit(1);
}
console.log("\nBramka jezyka OCR: mapa spojna, rozroznia dobry od zlego, brak dryftu main.js.");
