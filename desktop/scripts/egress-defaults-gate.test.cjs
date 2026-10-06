#!/usr/bin/env node
// Bramka domyslnych ustawien egressu w desktopie (audyt 2026-09, A-01).
//
//   node desktop/scripts/egress-defaults-gate.test.cjs
//
// Sprawy objete tajemnica zawodowa maja domyslnie isc tylko do modelu lokalnego.
// Zgoda na chmure jest per-sprawa (ADR-0128) albo swiadoma, przez env Operatora.
// Domyslne 'true' w main.js zdejmowalo blokade dla wszystkich spraw naraz, a ochrona
// opierala sie na maskowaniu, ktore nie obejmowalo tresci dokumentow.
//
// Kontrola pozytywna i negatywna: wyrazenie musi znalezc wartosc domyslna w obecnym
// pliku i musi zlapac znane-zle 'true' na syntetycznej kopii.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const WZOR = /PATRON_ALLOW_PRIVILEGED_CLOUD:\s*process\.env\.PATRON_ALLOW_PRIVILEGED_CLOUD\s*\?\?\s*'([^']*)'/;

function domyslnaZgoda(zrodlo) {
    const m = zrodlo.match(WZOR);
    if (!m) throw new Error("nie znaleziono domyslnej wartosci PATRON_ALLOW_PRIVILEGED_CLOUD w main.js");
    return m[1];
}

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// Znane-zle: tak bylo przed audytem 2026-09.
assert.equal(
    domyslnaZgoda(main.replace(WZOR, (s, v) => s.replace(`'${v}'`, "'true'"))),
    "true",
    "bramka nie widzi znanego-zlego",
);

// Stan biezacy.
assert.equal(
    domyslnaZgoda(main),
    "false",
    "desktop/main.js: domyslna zgoda na chmure dla spraw objetych tajemnica musi byc 'false' (zgoda per-sprawa: ADR-0128)",
);

console.log("egress-defaults-gate: OK (tajemnica domyslnie tylko lokalnie; znane-zle wykryte)");
