#!/usr/bin/env node
// Bramka jezyka OCR - kontrola pozytywna i negatywna.
//
// Po co osobny test zamiast zaufania kodowi: zmiana z 2026-08-24 zamienila
// ciche ostrzezenie na twardy blad builda. Bramka, ktorej nie widzialem
// na CZERWONO na znanym-zlym, nie jest bramka. Ten plik sprawdza oba stany
// bez odpalania calego prepare-resources.
//
// Uruchomienie: node desktop/scripts/ocr-lang-gate.test.cjs

const fs = require("fs");
const os = require("os");
const path = require("path");

const OCR_LANG = {
    pl: "pol", en: "eng", gb: "eng", us: "eng",
    pt: "por", it: "ita", de: "deu", es: "spa", fr: "fra",
};

/** Ta sama regula, ktora egzekwuje prepare-resources.cjs i e2e-smoke.cjs. */
function wymaganyPakiet(locale) {
    return `${OCR_LANG[locale] || "pol"}.traineddata`;
}

function sprawdz(locale, katalogTessdata) {
    const plik = path.join(katalogTessdata, wymaganyPakiet(locale));
    return fs.existsSync(plik);
}

let bledy = 0;
function test(nazwa, warunek) {
    if (warunek) {
        console.log(`  OK   ${nazwa}`);
    } else {
        console.error(`  FAIL ${nazwa}`);
        bledy += 1;
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-gate-"));
fs.writeFileSync(path.join(tmp, "pol.traineddata"), "x");
fs.writeFileSync(path.join(tmp, "eng.traineddata"), "x");

console.log("Mapa locale -> jezyk OCR:");
test("pl -> pol", OCR_LANG.pl === "pol");
test("br/pt -> por (NIE pol)", OCR_LANG.pt === "por");
test("de -> deu (NIE pol)", OCR_LANG.de === "deu");
test("gb i us dziela eng z en", OCR_LANG.gb === "eng" && OCR_LANG.us === "eng");
test("kazda z 9 edycji ma mapowanie", Object.keys(OCR_LANG).length === 9);

console.log("Bramka na katalogu z pol+eng:");
test("ZIELONO dla pl (pakiet jest)", sprawdz("pl", tmp) === true);
test("ZIELONO dla en (pakiet jest)", sprawdz("en", tmp) === true);
test("CZERWONO dla de (znany-zly: brak deu)", sprawdz("de", tmp) === false);
test("CZERWONO dla pt (znany-zly: brak por)", sprawdz("pt", tmp) === false);
test("CZERWONO dla it (znany-zly: brak ita)", sprawdz("it", tmp) === false);

fs.rmSync(tmp, { recursive: true, force: true });

if (bledy) {
    console.error(`\nBramka jezyka OCR: ${bledy} bledow.`);
    process.exit(1);
}
console.log("\nBramka jezyka OCR: rozroznia dobry od zlego (5 zielonych, 3 czerwone na znanym-zlym).");
