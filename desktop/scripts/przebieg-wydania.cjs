#!/usr/bin/env node
// Przebieg wydania: buduje kolejne edycje i po KAZDEJ sprawdza ARTEFAKT.
//
//   node scripts/przebieg-wydania.cjs [locale ...]      (domyslnie wszystkie 9)
//
// Buduje sekwencyjnie - electron-buildery gryza sie o dist/. Po kazdym buildzie
// zbiera dowody z PACZKI, nie z logu (build konczy sie exit 0 takze wtedy, gdy
// paczka jest niekompletna) i dopisuje wiersz do dist/PRZEBIEG-1.3.0.json.
//
// Zbierane dowody per edycja:
//   - manifest konektorow zgodny z tabela (scripts/connectors-gate.cjs),
//   - pakiet jezykowy OCR TEJ edycji obecny w resources/backend/ocr/tessdata,
//   - resources/{backend,frontend}/node_modules niepuste,
//   - e2e:smoke na spakowanej apce (czysty profil),
//   - .exe + .blockmap + kanal latest[-xx].yml istnieja, rozmiar i sha256.

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const DIST = path.join(DESKTOP, "dist");
const RES = path.join(DIST, "win-unpacked", "resources");
const { ocrLangFor } = require("./ocr-lang.cjs");
const { sprawdzKonektory } = require("./connectors-gate.cjs");

const SUFIKS = { pl: "", en: "-EN", it: "-IT", de: "-DE", es: "-ES", fr: "-FR", pt: "-BR", gb: "-GB", us: "-US" };
const KOLEJNOSC = ["pl", "en", "gb", "us", "de", "fr", "it", "es", "pt"];
const locales = process.argv.slice(2).length ? process.argv.slice(2) : KOLEJNOSC;
const RAPORT = path.join(DIST, "PRZEBIEG-1.3.0.json");

function czas() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(m) { console.log(`\n[przebieg ${czas()}] ${m}`); }

function zapisz(wiersze) {
    fs.writeFileSync(RAPORT, JSON.stringify(wiersze, null, 2) + "\n", "utf8");
}

function policz(dir) {
    try { return fs.readdirSync(dir).length; } catch { return 0; }
}

function sha256(plik) {
    return crypto.createHash("sha256").update(fs.readFileSync(plik)).digest("hex");
}

function uruchom(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: DESKTOP, stdio: "inherit", shell: process.platform === "win32",
        env: { ...process.env, ...(opts.env || {}) },
    });
    return r.status ?? 1;
}

const wyniki = fs.existsSync(RAPORT) ? JSON.parse(fs.readFileSync(RAPORT, "utf8")) : [];

for (const locale of locales) {
    if (!(locale in SUFIKS)) { console.error(`Nieznana edycja: ${locale}`); process.exit(2); }
    const start = Date.now();
    log(`=== EDYCJA ${locale.toUpperCase()} - build startuje ===`);
    const kodBuildu = uruchom("npm", ["run", `build:${locale}`]);

    const wiersz = { edycja: locale, start: czas(), kodBuildu, dowody: {}, problemy: [] };
    if (kodBuildu !== 0) {
        wiersz.problemy.push(`build zakonczony kodem ${kodBuildu}`);
        wiersz.werdykt = "BUILD FAIL";
        wyniki.push(wiersz); zapisz(wyniki);
        console.error(`\nEDYCJA ${locale}: build padl (kod ${kodBuildu}) - przerywam przebieg.`);
        process.exit(1);
    }

    // 1. Manifest konektorow (ten sam modul co e2e-smoke).
    const kon = sprawdzKonektory(RES);
    wiersz.dowody.konektory = kon.podsumowanie;
    if (!kon.ok) wiersz.problemy.push(...kon.problemy.map((p) => `konektory: ${p}`));

    // 2. Pakiet jezykowy OCR TEJ edycji.
    const lang = ocrLangFor(locale);
    const pakiet = path.join(RES, "backend", "ocr", "tessdata", `${lang}.traineddata`);
    const jestPakiet = fs.existsSync(pakiet);
    wiersz.dowody.ocr = `${lang}.traineddata ${jestPakiet ? "obecny" : "BRAK"}` +
        (jestPakiet ? ` (${fs.statSync(pakiet).size} B)` : "");
    if (!jestPakiet) wiersz.problemy.push(`OCR: brak ${lang}.traineddata w paczce`);
    wiersz.dowody.tessdata = fs.existsSync(path.dirname(pakiet))
        ? fs.readdirSync(path.dirname(pakiet)).join(", ") : "BRAK KATALOGU";

    // 3. node_modules w paczce (pulapka electron-builder 26).
    const nb = policz(path.join(RES, "backend", "node_modules"));
    const nf = policz(path.join(RES, "frontend", "node_modules"));
    wiersz.dowody.node_modules = `backend=${nb}, frontend=${nf}`;
    if (nb === 0 || nf === 0) wiersz.problemy.push("node_modules puste w paczce");

    // 4. Artefakty releasowe.
    const exe = path.join(DIST, `PATRON-Setup-Windows${SUFIKS[locale]}.exe`);
    const blockmap = `${exe}.blockmap`;
    const kanal = path.join(DIST, "channels", `latest${SUFIKS[locale].toLowerCase()}.yml`);
    if (fs.existsSync(exe)) {
        wiersz.dowody.exe = `${path.basename(exe)} ${fs.statSync(exe).size} B`;
        wiersz.dowody.sha256 = sha256(exe);
    } else { wiersz.problemy.push(`brak artefaktu ${path.basename(exe)}`); }
    wiersz.dowody.blockmap = fs.existsSync(blockmap) ? "jest" : "BRAK";
    if (!fs.existsSync(blockmap)) wiersz.problemy.push("brak .blockmap (auto-update bez delty)");
    if (fs.existsSync(kanal)) {
        const tresc = fs.readFileSync(kanal, "utf8");
        wiersz.dowody.kanal = path.basename(kanal);
        if (!tresc.includes(path.basename(exe))) {
            wiersz.problemy.push(`${path.basename(kanal)} nie wskazuje ${path.basename(exe)}`);
        }
        const m = tresc.match(/version:\s*([\d.]+)/);
        wiersz.dowody.wersjaWKanale = m ? m[1] : "BRAK";
        if (m && m[1] !== "1.3.0") wiersz.problemy.push(`kanal mowi wersja ${m[1]}, nie 1.3.0`);
    } else { wiersz.problemy.push(`brak kanalu latest${SUFIKS[locale].toLowerCase()}.yml`); }

    // 5. e2e:smoke na spakowanej apce.
    log(`EDYCJA ${locale.toUpperCase()} - e2e:smoke`);
    const kodSmoke = uruchom("npm", ["run", "e2e:smoke"]);
    wiersz.dowody.e2eSmoke = kodSmoke === 0 ? "PASS" : `FAIL (kod ${kodSmoke})`;
    if (kodSmoke !== 0) wiersz.problemy.push(`e2e:smoke kod ${kodSmoke}`);

    wiersz.minut = Math.round((Date.now() - start) / 60000);
    wiersz.werdykt = wiersz.problemy.length === 0 ? "GOTOWA" : "DO POPRAWY";
    wyniki.push(wiersz); zapisz(wyniki);
    log(`EDYCJA ${locale.toUpperCase()}: ${wiersz.werdykt} (${wiersz.minut} min)`);
    if (wiersz.problemy.length) for (const p of wiersz.problemy) console.error(`   - ${p}`);
}

log("PRZEBIEG ZAKONCZONY");
for (const w of wyniki) console.log(`  ${w.edycja.padEnd(3)} ${w.werdykt.padEnd(11)} ${w.minut ?? "?"} min`);
const zle = wyniki.filter((w) => w.werdykt !== "GOTOWA");
process.exit(zle.length ? 1 : 0);
