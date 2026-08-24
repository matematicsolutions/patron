#!/usr/bin/env node
// Kontrola koncowa wydania na ARTEFAKTACH w desktop/dist.
//
//   node scripts/weryfikuj-wydanie.cjs [wersja]      (domyslnie z package.json)
//
// Sprawdza dokladnie te rzeczy, ktore w historii tego pipeline'u zawiodly
// CICHO - kazda z nich konczyla sie sukcesem builda:
//
//  1. latest[-xx].yml wskazywal asset, ktorego w Release nie ma (v1.0.0:
//     auto-update nie mogl zadzialac ani razu),
//  2. kanal PL nadpisywany przez kolejne edycje (po buildzie US "latest.yml"
//     niosl hash US) - dlatego kanaly zyja w dist/channels/,
//  3. CHECKSUMS.txt opisywal artefakty, ktorych w wydaniu NIE MA (v1.2.0:
//     17 wierszy na 9 plikow) - instrukcja bezpieczenstwa dla mecenasa
//     zamieniala sie w zgadywanke.
//
// Mianownik liczony w OBIE strony: czy kazdy plik ma wiersz i czy kazdy
// wiersz ma plik. Exit 0 = wydanie spojne, 1 = niespojne.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const DIST = path.join(DESKTOP, "dist");
const WERSJA = process.argv[2] || require(path.join(DESKTOP, "package.json")).version;

const EDYCJE = [
    { locale: "pl", sufiks: "" },
    { locale: "en", sufiks: "-EN" },
    { locale: "gb", sufiks: "-GB" },
    { locale: "us", sufiks: "-US" },
    { locale: "de", sufiks: "-DE" },
    { locale: "fr", sufiks: "-FR" },
    { locale: "it", sufiks: "-IT" },
    { locale: "es", sufiks: "-ES" },
    { locale: "pt", sufiks: "-BR" },
];

let bledy = 0;
const fail = (m) => { console.error(`  FAIL ${m}`); bledy += 1; };
const ok = (m) => console.log(`  ok   ${m}`);

function sumy(plik) {
    const buf = fs.readFileSync(plik);
    return {
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        sha512: crypto.createHash("sha512").update(buf).digest("base64"),
        rozmiar: buf.length,
    };
}

console.log(`Kontrola wydania ${WERSJA} na artefaktach w ${DIST}\n`);

// ── 1. Komplet plikow per edycja ─────────────────────────────────────────────
console.log("Komplet artefaktow (exe + blockmap + kanal):");
const zmierzone = new Map();
for (const { locale, sufiks } of EDYCJE) {
    const nazwa = `PATRON-Setup-Windows${sufiks}.exe`;
    const exe = path.join(DIST, nazwa);
    if (!fs.existsSync(exe)) { fail(`${locale}: brak ${nazwa}`); continue; }
    const s = sumy(exe);
    zmierzone.set(nazwa, s);
    const braki = [];
    if (!fs.existsSync(`${exe}.blockmap`)) braki.push("blockmap");
    const kanal = path.join(DIST, "channels", `latest${sufiks.toLowerCase()}.yml`);
    if (!fs.existsSync(kanal)) braki.push("kanal yml");
    if (braki.length) fail(`${locale}: brakuje ${braki.join(", ")}`);
    else ok(`${locale}: ${nazwa} (${(s.rozmiar / 1048576).toFixed(0)} MB) + blockmap + kanal`);
}

// ── 2. Kanaly auto-update ────────────────────────────────────────────────────
console.log("\nKanaly auto-update (url, wersja, sha512 wobec PLIKU):");
for (const { locale, sufiks } of EDYCJE) {
    const nazwa = `PATRON-Setup-Windows${sufiks}.exe`;
    const kanal = path.join(DIST, "channels", `latest${sufiks.toLowerCase()}.yml`);
    if (!fs.existsSync(kanal) || !zmierzone.has(nazwa)) continue;
    const tresc = fs.readFileSync(kanal, "utf8");
    const s = zmierzone.get(nazwa);
    const problemy = [];
    if (!tresc.includes(nazwa)) problemy.push(`url nie wskazuje ${nazwa} (auto-update dostalby 404)`);
    const mv = tresc.match(/version:\s*([\d.]+)/);
    if (!mv || mv[1] !== WERSJA) problemy.push(`wersja w yml = ${mv ? mv[1] : "BRAK"}, nie ${WERSJA}`);
    // sha512 z yml musi byc suma TEGO pliku - inaczej updater odrzuci pobrany artefakt
    const mh = tresc.match(/sha512:\s*(\S+)/);
    if (!mh) problemy.push("brak sha512 w yml");
    else if (mh[1] !== s.sha512) problemy.push("sha512 w yml NIE JEST suma pliku exe");
    const mr = tresc.match(/size:\s*(\d+)/);
    if (mr && Number(mr[1]) !== s.rozmiar) problemy.push(`size w yml = ${mr[1]}, plik ma ${s.rozmiar}`);
    if (problemy.length) fail(`latest${sufiks.toLowerCase()}.yml: ${problemy.join("; ")}`);
    else ok(`latest${sufiks.toLowerCase()}.yml -> ${nazwa}, ${WERSJA}, sha512 i rozmiar zgodne`);
}

// ── 3. CHECKSUMS.txt w OBIE strony ───────────────────────────────────────────
console.log("\nCHECKSUMS.txt (mianownik w obie strony):");
const plikSum = path.join(DIST, "CHECKSUMS.txt");
if (!fs.existsSync(plikSum)) {
    fail("brak CHECKSUMS.txt - strona /pobierz kaze mecenasowi sprawdzic sume, ktorej nie ma");
} else {
    const wiersze = fs.readFileSync(plikSum, "utf8").split("\n")
        .map((l) => l.trim()).filter(Boolean)
        .map((l) => { const [h, n] = l.split(/\s+/); return { hash: h, nazwa: n }; });
    const opisane = new Set(wiersze.map((w) => w.nazwa));
    for (const w of wiersze) {
        if (!zmierzone.has(w.nazwa)) fail(`wiersz opisuje ${w.nazwa}, a takiego artefaktu w wydaniu NIE MA`);
        else if (zmierzone.get(w.nazwa).sha256 !== w.hash) fail(`${w.nazwa}: suma w pliku != suma artefaktu`);
    }
    for (const nazwa of zmierzone.keys()) {
        if (!opisane.has(nazwa)) fail(`${nazwa} jest w wydaniu, ale NIE MA go w CHECKSUMS.txt`);
    }
    const duplikaty = wiersze.map((w) => w.nazwa)
        .filter((n, i, a) => a.indexOf(n) !== i);
    if (duplikaty.length) fail(`wiersze powtorzone: ${[...new Set(duplikaty)].join(", ")}`);
    if (!bledy) ok(`${wiersze.length} wierszy, ${zmierzone.size} artefaktow, zero nadmiarowych`);
}

// ── 3b. Dryft mapy kanalow: main.js vs build-locale.cjs ──────────────────────
// Nazwa kanalu ma DWA domy. build-locale.cjs zapisuje plik latest<sufiks>.yml,
// a main.js w runtime ustawia autoUpdater.channel z wlasnej kopii mapy
// (UPDATE_CHANNEL_SUFFIX) - main.js nie moze importowac modulu, bo build.files
// w package.json to jawna allowlista. Kopia pilnowana pomiarem jest tansza niz
// kopia pilnowana pamiecia: gdyby ktos przemianowal sufiks po jednej stronie,
// aplikacja prosilaby o plik, ktorego w wydaniu nie ma, i auto-update
// przestalby dzialac BEZ zadnego bledu przy buildzie.
console.log("\nMapa kanalow auto-update (main.js vs build-locale.cjs):");
{
    const czytajMape = (plik, wzorzec) => {
        const tresc = fs.readFileSync(path.join(DESKTOP, plik), "utf8");
        const blok = tresc.match(wzorzec);
        if (!blok) return null;
        const mapa = {};
        for (const m of blok[1].matchAll(/(\w+):\s*(?:'([^']*)'|"([^"]*)")/g)) {
            mapa[m[1]] = m[2] ?? m[3];
        }
        return mapa;
    };
    const zMain = czytajMape("main.js", /const UPDATE_CHANNEL_SUFFIX = \{([^}]*)\}/);
    const tresc = fs.readFileSync(path.join(DESKTOP, "scripts", "build-locale.cjs"), "utf8");
    const zBuild = {};
    for (const m of tresc.matchAll(/^\s{2}(\w+):\s*\{[^}]*suffix:\s*"([^"]*)"/gm)) {
        zBuild[m[1]] = m[2].toLowerCase();
    }
    if (!zMain) {
        fail("nie znalazlem UPDATE_CHANNEL_SUFFIX w main.js (zmienil sie ksztalt literalu?)");
    } else if (Object.keys(zBuild).length === 0) {
        fail("nie odczytalem sufiksow z build-locale.cjs");
    } else {
        const klucze = new Set([...Object.keys(zMain), ...Object.keys(zBuild)]);
        const rozjazdy = [...klucze].filter((k) => zMain[k] !== zBuild[k]);
        if (rozjazdy.length) {
            for (const k of rozjazdy) {
                fail(`${k}: main.js prosi o "latest${zMain[k] ?? "?"}.yml", ` +
                    `a build zapisuje "latest${zBuild[k] ?? "?"}.yml"`);
            }
        } else {
            ok(`${klucze.size} edycji: kanal, o ktory prosi aplikacja, to ten, ktory zapisuje build`);
        }
        // Kazdy kanal, o ktory aplikacja poprosi, musi istniec w wydaniu.
        for (const [locale, sufiks] of Object.entries(zMain)) {
            const plik = path.join(DIST, "channels", `latest${sufiks}.yml`);
            if (!fs.existsSync(plik)) {
                fail(`edycja ${locale} poprosi o latest${sufiks}.yml, a takiego pliku w wydaniu NIE MA`);
            }
        }
    }
}

// ── 4. Artefakty, ktorych NIE wolno wgrac ────────────────────────────────────
console.log("\nSurowe artefakty electron-buildera (nie wgrywac do Release):");
const surowe = fs.readdirSync(DIST)
    .filter((f) => f.toLowerCase().endsWith(".exe") && !f.startsWith("PATRON-Setup-Windows"));
if (surowe.length) console.log(`  uwaga: ${surowe.join(", ")} - zostaja lokalnie, poza wydaniem`);
else console.log("  brak");

console.log(bledy === 0
    ? `\nWYDANIE ${WERSJA}: SPOJNE - ${zmierzone.size} edycji, kanaly i sumy zgodne z plikami.`
    : `\nWYDANIE ${WERSJA}: NIESPOJNE (${bledy} bledow).`);
process.exit(bledy === 0 ? 0 : 1);
