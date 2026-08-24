// Mapa: edycja instalatora -> jezyk silnika OCR (ADR-0139).
//
// JEDEN dom tego faktu dla wszystkiego, co dziala w czasie BUILDA
// (prepare-resources.cjs, e2e-smoke.cjs, ocr-lang-gate.test.cjs).
//
// main.js NIE importuje tego pliku CELOWO: `build.files` w package.json to
// jawna allowlista ("main.js", "preload.js", "package.json", "assets/**/*"),
// wiec dodatkowy modul nie trafilby do paczki i aplikacja padlaby dopiero po
// instalacji u mecenasa. Zamiast tego main.js ma wlasna kopie literalu, a
// ocr-lang-gate.test.cjs porownuje obie i pada, gdy sie rozjada.

const OCR_LANG = Object.freeze({
    pl: "pol",
    en: "eng",
    gb: "eng",
    us: "eng",
    pt: "por",
    it: "ita",
    de: "deu",
    es: "spa",
    fr: "fra",
});

/** Nazwa pliku pakietu jezykowego wymaganego przez dana edycje. */
function requiredPack(locale) {
    return `${OCR_LANG[locale] || "pol"}.traineddata`;
}

/** Kod jezyka Tesseracta dla edycji (z fallbackiem na polski). */
function ocrLangFor(locale) {
    return OCR_LANG[locale] || "pol";
}

module.exports = { OCR_LANG, requiredPack, ocrLangFor };
