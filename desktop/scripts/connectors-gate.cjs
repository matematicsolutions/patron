#!/usr/bin/env node
// Bramka konektorow MCP per edycja - czyta manifest ze ZBUDOWANEJ paczki.
//
//   node scripts/connectors-gate.cjs [sciezka/do/resources]
//   (domyslnie: desktop/dist/win-unpacked/resources)
//
// Wpieta w desktop/scripts/e2e-smoke.cjs obok asercji node_modules i OCR.
//
// Po co: do 2026-08-24 NIKT nie sprawdzal mechanicznie, czy instalator danej
// edycji wiezie nasze konektory we wlasciwym zestawie i WLACZONE. e2e-smoke
// pilnowal node_modules i pakietu jezykowego OCR, ale manifestu nie. A build
// konczy sie exit 0 takze wtedy, gdy konektor jedzie jako enabled=false -
// paczka jest kompletna, apka wstaje, tylko mecenas nie ma zrodla w czacie
// (zmierzone 2026-08-17 na konektorze eureka).
//
// Oczekiwanie siedzi w connectors-expected.cjs i jest przepisane RECZNIE -
// bramka liczaca oczekiwanie kodem, ktory testuje, zawsze zdaje wlasny egzamin.
//
// Exit: 0 = zgodne; 2 = niezgodne albo nie da sie sprawdzic (brak pliku,
// pusta lista, edycja spoza tabeli). Brak dowodu to NIE jest dowod zgodnosci.

const fs = require("node:fs");
const path = require("node:path");
const { oczekiwanieDla, OCZEKIWANE } = require("./connectors-expected.cjs");

const AKTYWNY = (wpis) => wpis.enabled !== false; // ta sama regula co runtime

function roznica(a, b) {
    return [...a].filter((x) => !b.has(x)).sort();
}

/**
 * Sprawdza manifest konektorow w rozpakowanych zasobach paczki.
 * Zwraca { ok, locale, problemy: string[], podsumowanie: string }.
 * Nigdy nie rzuca - kazdy blad odczytu jest problemem, nie wyjatkiem.
 */
function sprawdzKonektory(resourcesDir) {
    const problemy = [];
    const backend = path.join(resourcesDir, "backend");
    const plikManifest = path.join(backend, "mcp-servers.json");
    const plikLocale = path.join(backend, "patron-locale.json");

    // 1. Edycja. Brak patron-locale.json = edycja PL (tak samo czyta to
    //    asercja OCR w e2e-smoke i main.js w runtime).
    let locale = "pl";
    let localeZPliku = false;
    try {
        const parsed = JSON.parse(fs.readFileSync(plikLocale, "utf8"));
        if (parsed && typeof parsed.locale === "string") {
            locale = parsed.locale;
            localeZPliku = true;
        }
    } catch {
        /* brak pliku = edycja PL (domyslna) */
    }

    // 2. Tabela oczekiwan MUSI znac te edycje. Nieznana edycja nie moze
    //    przechodzic "bo nie ma z czym porownac" - to jest wlasnie moment,
    //    w ktorym nowa edycja wyjechalaby bez zadnej kontroli.
    const oczekiwane = oczekiwanieDla(locale);
    if (!oczekiwane) {
        problemy.push(
            `edycja "${locale}" nie ma wpisu w connectors-expected.cjs ` +
                `(znane: ${Object.keys(OCZEKIWANE).join(", ")}). Dopisz oczekiwany ` +
                "zestaw ZMIERZONY na paczce, zanim ta edycja pojedzie do mecenasa.",
        );
        return {
            ok: false,
            locale,
            problemy,
            podsumowanie: `edycja ${locale}: brak oczekiwania w tabeli`,
        };
    }

    // 3. Manifest: musi istniec, parsowac sie i byc NIEPUSTA tablica.
    //    Pusta lista przechodzi kazde porownanie "czy wszystko z listy jest ok",
    //    dlatego jest jawnie blokujaca.
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(plikManifest, "utf8"));
    } catch (err) {
        problemy.push(
            `nie da sie odczytac ${plikManifest}: ${err.message}. Bez manifestu ` +
                "instalator nie ma ZADNEGO konektora - to nie jest stan do wydania.",
        );
        return { ok: false, locale, problemy, podsumowanie: `edycja ${locale}: brak manifestu` };
    }
    if (!Array.isArray(manifest)) {
        problemy.push(`mcp-servers.json nie jest tablica (jest ${typeof manifest}).`);
        return { ok: false, locale, problemy, podsumowanie: `edycja ${locale}: zly ksztalt manifestu` };
    }
    if (manifest.length === 0) {
        problemy.push("mcp-servers.json jest PUSTY - zero konektorow w instalatorze.");
        return { ok: false, locale, problemy, podsumowanie: `edycja ${locale}: pusty manifest` };
    }

    // 4. Higiena wpisow: kazdy ma nazwe, zadna nazwa sie nie powtarza.
    const bezNazwy = manifest.filter(
        (e) => !e || typeof e.name !== "string" || e.name.trim() === "",
    ).length;
    if (bezNazwy) problemy.push(`${bezNazwy} wpis(ow) bez pola "name".`);
    const nazwy = manifest
        .filter((e) => e && typeof e.name === "string" && e.name.trim() !== "")
        .map((e) => e.name);
    const duplikaty = [...new Set(nazwy.filter((n, i) => nazwy.indexOf(n) !== i))];
    if (duplikaty.length) problemy.push(`nazwy powtorzone w manifescie: ${duplikaty.join(", ")}.`);

    // 5. Pelny mianownik w OBIE strony: czego brakuje I co jest nadmiarowe.
    //    Sam "czy kazdy oczekiwany jest obecny" przepuscilby doklejony obcy
    //    konektor; sam "czy kazdy obecny jest oczekiwany" przepuscilby brak.
    const sa = new Set(nazwy);
    const maBycW = new Set(oczekiwane.konektory);
    const brakuje = roznica(maBycW, sa);
    const nadmiar = roznica(sa, maBycW);
    if (brakuje.length) {
        problemy.push(
            `w paczce BRAKUJE konektorow (${brakuje.length}): ${brakuje.join(", ")}.`,
        );
    }
    if (nadmiar.length) {
        problemy.push(
            `w paczce sa konektory SPOZA oczekiwanego zestawu (${nadmiar.length}): ` +
                `${nadmiar.join(", ")}. Edycja rynkowa jest lean CELOWO - reszta idzie z Boutique.`,
        );
    }

    // 6. Stan wlaczenia. To jest ten blad, ktory nie boli przy buildzie:
    //    konektor jest w paczce, wiec kazda kontrola obecnosci swieci na
    //    zielono, a mecenas i tak nie ma zrodla w czacie.
    const wlaczone = new Set(
        manifest.filter((e) => e && typeof e.name === "string" && AKTYWNY(e)).map((e) => e.name),
    );
    const maBycON = new Set(oczekiwane.wlaczone);
    const niewlaczone = roznica(maBycON, wlaczone).filter((n) => sa.has(n));
    const nadmiarON = roznica(wlaczone, maBycON);
    if (niewlaczone.length) {
        problemy.push(
            `konektory sa w paczce, ale jada WYLACZONE (${niewlaczone.length}): ` +
                `${niewlaczone.join(", ")}. Najczestsza przyczyna: nazwa niezsynchronizowana ` +
                "z lustrem JURISDICTION w prepare-resources.cjs (zmierzone 2026-08-17 na eureka).",
        );
    }
    if (nadmiarON.length) {
        problemy.push(
            `konektory wlaczone WBREW oczekiwaniu (${nadmiarON.length}): ${nadmiarON.join(", ")}.`,
        );
    }

    const podsumowanie =
        `edycja ${locale}${localeZPliku ? "" : " (domyslna - brak patron-locale.json)"}: ` +
        `${manifest.length} konektorow, ${wlaczone.size} ON ` +
        `(oczekiwano ${oczekiwane.konektory.length}/${oczekiwane.wlaczone.length}) - ${oczekiwane.opis}`;

    return { ok: problemy.length === 0, locale, problemy, podsumowanie };
}

module.exports = { sprawdzKonektory };

if (require.main === module) {
    const domyslny = path.resolve(__dirname, "..", "dist", "win-unpacked", "resources");
    const dir = process.argv[2] ? path.resolve(process.argv[2]) : domyslny;
    if (!fs.existsSync(dir)) {
        console.error(
            `Brak katalogu zasobow: ${dir}\nZbuduj najpierw: cd desktop && npm run build:dir`,
        );
        process.exit(2);
    }
    const wynik = sprawdzKonektory(dir);
    if (wynik.ok) {
        console.log(`Konektory: ${wynik.podsumowanie}`);
        process.exit(0);
    }
    console.error(`Konektory NIEZGODNE - ${wynik.podsumowanie}`);
    for (const p of wynik.problemy) console.error(`  - ${p}`);
    process.exit(2);
}
