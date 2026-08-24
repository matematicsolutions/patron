#!/usr/bin/env node
// E2E smoke SPAKOWANEJ aplikacji (spec 013, A3-2).
//
//   cd desktop && npm run e2e:smoke
//
// Bootuje dist/win-unpacked/PATRON.exe (app.isPackaged=true, zbundlowany
// backend/frontend, Node wbudowany w Electron) na CZYSTYM tymczasowym profilu
// (APPDATA/LOCALAPPDATA przekierowane) i sprawdza mechanicznie:
//   1. backend  http://localhost:3001/health -> {ok:true}
//   2. frontend http://localhost:3000/       -> 200 + HTML
// Po tescie ubija cale drzewo procesow (taskkill /T). Realny profil i dane
// uzytkownika sa nietykane.
//
// Exit: 0 = stack wstal; 1 = nie wstal w timeoutcie / check FAIL;
//       2 = brak builda (odpal: npm run build:dir) albo porty zajete.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const EXE = path.join(DESKTOP, "dist", "win-unpacked", "PATRON.exe");
const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3000;
const BOOT_TIMEOUT_MS = 180_000; // zimny start: rozpakowanie asar + boot next

function portInUse(port) {
    return new Promise((resolve) => {
        const sock = net.connect({ host: "127.0.0.1", port }, () => {
            sock.destroy();
            resolve(true);
        });
        sock.on("error", () => resolve(false));
        sock.setTimeout(800, () => {
            sock.destroy();
            resolve(false);
        });
    });
}

function get(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 3000 }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
                resolve({
                    status: res.statusCode,
                    body,
                    location: res.headers.location,
                }),
            );
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
            req.destroy();
            resolve(null);
        });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    if (process.platform !== "win32") {
        console.error("e2e-smoke: artefakt desktop jest Windows-only.");
        process.exit(2);
    }
    if (!fs.existsSync(EXE)) {
        console.error(
            `Brak ${EXE}\nZbuduj najpierw: cd desktop && npm run build:dir`,
        );
        process.exit(2);
    }
    // Kompletnosc paczki PRZED startem: electron-builder 26 wycina katalog
    // node_modules z korzenia kazdego matchera extraResources (v25 tego nie
    // robil) - build konczy sie sukcesem, a spakowany backend/frontend nie ma
    // zaleznosci i apka pada na starcie (zmierzone 2026-08-18 przy bumpie 25->26).
    // Osobne wpisy extraResources dla node_modules w package.json to obejscie;
    // ta asercja pilnuje, zeby regresja nie wrocila cicho.
    const RESOURCES = path.join(DESKTOP, "dist", "win-unpacked", "resources");
    for (const rel of ["backend/node_modules", "frontend/node_modules"]) {
        const dir = path.join(RESOURCES, rel);
        const n = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
        if (n === 0) {
            console.error(
                `Paczka NIEKOMPLETNA: resources/${rel} pusty lub brak (extraResources ` +
                    "nie skopiowal node_modules - patrz komentarz w e2e-smoke.cjs).",
            );
            process.exit(2);
        }
    }
    // Kompletnosc OCR: silnik + pakiet jezykowy TEJ edycji. Do 2026-08-24 staging
    // OCR byl best-effort (ostrzezenie w logu, build exit 0), a jezyk byl wpisany
    // na sztywno jako 'pol' dla wszystkich dziewieciu edycji. Ta asercja pilnuje
    // obu rzeczy naraz - inaczej brak OCR albo OCR w zlym jezyku wychodzi dopiero
    // u mecenasa, ktory wrzuca skan.
    if (process.env.SKIP_OCR !== "1") {
        const { ocrLangFor } = require("./ocr-lang.cjs");
        let locale = "pl";
        try {
            const raw = fs.readFileSync(
                path.join(RESOURCES, "backend", "patron-locale.json"), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.locale === "string") locale = parsed.locale;
        } catch { /* brak pliku = edycja PL (domyslna) */ }
        const lang = ocrLangFor(locale);
        const tessExe = path.join(RESOURCES, "backend", "ocr", "tesseract", "tesseract.exe");
        const langData = path.join(RESOURCES, "backend", "ocr", "tessdata", `${lang}.traineddata`);
        if (!fs.existsSync(tessExe)) {
            console.error(
                "Paczka NIEKOMPLETNA: brak silnika OCR (resources/backend/ocr/tesseract). " +
                    "Skany beda odrzucane u odbiorcy. SKIP_OCR=1 pomija ta kontrole swiadomie.",
            );
            process.exit(2);
        }
        if (!fs.existsSync(langData)) {
            console.error(
                `Paczka NIEKOMPLETNA: edycja "${locale}" nie ma pakietu jezykowego OCR ` +
                    `${lang}.traineddata. Bez niego skany byly rozpoznawane w zlym jezyku.`,
            );
            process.exit(2);
        }
        console.log(`OCR: silnik + ${lang}.traineddata obecne (edycja ${locale}).`);
    }

    if ((await portInUse(BACKEND_PORT)) || (await portInUse(FRONTEND_PORT))) {
        console.error(
            `Port ${BACKEND_PORT} lub ${FRONTEND_PORT} zajety - dziala inny PATRON? ` +
                "Zamknij go przed smokiem (falszywy wynik = gorszy niz brak wyniku).",
        );
        process.exit(2);
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "patron-e2e-"));
    const localDir = path.join(profile, "local");
    fs.mkdirSync(localDir, { recursive: true });
    console.log(`Profil tymczasowy: ${profile}`);
    console.log(`Start: ${EXE}`);

    const child = spawn(EXE, [], {
        env: {
            ...process.env,
            APPDATA: profile,
            LOCALAPPDATA: localDir,
        },
        stdio: "ignore",
        detached: false,
    });
    let exited = false;
    child.on("exit", (code) => {
        exited = true;
        console.error(`PATRON.exe zakonczyl sie przedwczesnie (code=${code}).`);
    });

    let failures = 0;
    const check = (name, cond, extra) => {
        if (cond) console.log(`  ok   ${name}`);
        else {
            failures++;
            console.error(`  FAIL ${name}`, extra ?? "");
        }
    };

    // Czekaj az /health odpowie {ok:true}
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let health = null;
    while (Date.now() < deadline && !exited) {
        health = await get(`http://localhost:${BACKEND_PORT}/health`);
        if (health?.status === 200) break;
        await sleep(2000);
    }
    check(
        "backend /health -> 200 {ok:true}",
        health?.status === 200 && /"ok"\s*:\s*true/.test(health.body ?? ""),
        health ? `status=${health.status}` : "timeout",
    );

    // Frontend: 200 + HTML. Next przekierowuje / (np. 307 -> /login) -
    // podazaj za Location (max 3 hopy), koncowo oczekuj 200 + HTML.
    let front = null;
    while (Date.now() < deadline && !exited) {
        front = await get(`http://localhost:${FRONTEND_PORT}/`);
        if (front?.status && front.status < 500) break;
        await sleep(2000);
    }
    let frontFinal = front;
    let hops = 0;
    while (
        frontFinal &&
        frontFinal.status >= 300 &&
        frontFinal.status < 400 &&
        frontFinal.location &&
        hops < 3
    ) {
        const loc = frontFinal.location.startsWith("http")
            ? frontFinal.location
            : `http://localhost:${FRONTEND_PORT}${frontFinal.location}`;
        frontFinal = await get(loc);
        hops++;
    }
    check(
        "frontend -> 200 + HTML (po redirectach)",
        frontFinal?.status === 200 && /<html/i.test(frontFinal.body ?? ""),
        frontFinal
            ? `status=${front?.status}->${frontFinal.status} hops=${hops}`
            : "timeout",
    );

    check("proces zyje do konca smoke'a", !exited);

    // Sprzatanie: cale drzewo (PATRON spawnuje backend/frontend jako dzieci)
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
    });

    console.log(
        failures === 0
            ? "\nE2E SMOKE: PASS - spakowany stack wstaje na czystym profilu."
            : `\nE2E SMOKE: FAIL (${failures} check(ow))`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("e2e-smoke: blad:", err);
    process.exit(1);
});
