#!/usr/bin/env node
// Budowa instalatora PATRON dla wskazanego locale (ADR-0132/0139).
//
//   npm run build:it        (= node scripts/build-locale.cjs it)
//
// Robi trzy rzeczy, ktorych goly `npm run build` nie robi:
//   1. ustawia NEXT_PUBLIC_PATRON_LOCALE dla prepare-resources.cjs (frontend,
//      mcp-servers.json, patron-locale.json, samouczek),
//   2. ustawia jezyk instalatora NSIS zgodny z rynkiem (LCID),
//   3. zmienia nazwe artefaktu na kanoniczna z GitHub Releases:
//      PL -> PATRON-Setup-Windows.exe, inne -> PATRON-Setup-Windows-<XX>.exe.
//
// Dzieki temu release sklada sie z powtarzalnych komend build:pl / build:en /
// build:it / ... bez recznego zmieniania env i recznego rename.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(DESKTOP_DIR, "dist");

const LOCALES = {
  pl: { nsisLang: "pl-PL", lcid: "1045", suffix: "" },
  en: { nsisLang: "en-US", lcid: "1033", suffix: "-EN" },
  it: { nsisLang: "it-IT", lcid: "1040", suffix: "-IT" },
  de: { nsisLang: "de-DE", lcid: "1031", suffix: "-DE" },
  es: { nsisLang: "es-ES", lcid: "3082", suffix: "-ES" },
  fr: { nsisLang: "fr-FR", lcid: "1036", suffix: "-FR" },
  pt: { nsisLang: "pt-BR", lcid: "1046", suffix: "-BR" },
  // NSIS 3.0.4.1's bundled MUI language table for lcid 2057 (en-GB) is missing
  // MUI_UNTEXT_WELCOME_INFO_TITLE, which electron-builder treats as a fatal
  // warning. Reuse the complete en-US (1033) NSIS language pack instead - this
  // only affects installer chrome text, not the app's own UI/substance.
  gb: { nsisLang: "en-US", lcid: "1033", suffix: "-GB" },
  // Jurysdykcja USA (UI EN, patron-locale.json "us"). NSIS/electron-builder
  // nie ma osobny locale-tag dla "US-market English" poza en-US samym LCID
  // 1033 - to samo, co "en" (locale UE-first) juz uzywa dla jezyka instalatora.
  // Instalator NSIS wiec wyswietli sie identycznie po angielsku dla obu
  // buildow (poprawnie - to i tak ten sam jezyk, en-US). Rozdziela je NAZWA
  // ARTEFAKTU (sufiks "-US" zamiast "-EN") i patron-locale.json wewnatrz
  // instalatora, ktore ustawia PATRON_LOCALE=us w backendzie -> profil
  // jurysdykcyjny USA w prompts.ts, nie profil PL+UE dla "en".
  us: { nsisLang: "en-US", lcid: "1033", suffix: "-US" },
};

const locale = (process.argv[2] || "").toLowerCase();
const cfg = LOCALES[locale];
if (!cfg) {
  console.error(
    `Uzycie: node scripts/build-locale.cjs <${Object.keys(LOCALES).join("|")}>`,
  );
  process.exit(2);
}

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: DESKTOP_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NEXT_PUBLIC_PATRON_LOCALE: locale },
  });
  if (r.status !== 0) {
    console.error(`Komenda zakonczona kodem ${r.status} - przerywam.`);
    process.exit(r.status ?? 1);
  }
}

// 1+2. Zasoby + build z jezykiem NSIS per rynek. --publish=never na sztywno:
// upload assets do GitHub Releases to akt ludzki WM (bramka "push publiczny").
run("node", ["scripts/prepare-resources.cjs"]);
run("npx", [
  "electron-builder",
  "--win",
  "--x64",
  "--publish=never",
  `--config.nsis.installerLanguages=${cfg.nsisLang}`,
  `--config.nsis.language=${cfg.lcid}`,
]);

// 3. Rename na kanoniczna nazwe releasowa (najnowszy .exe z dist/).
const exes = fs
  .readdirSync(DIST_DIR)
  .filter((f) => f.toLowerCase().endsWith(".exe"))
  .map((f) => ({ f, mtime: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (!exes.length) {
  console.error("Brak .exe w desktop/dist - electron-builder nie wyprodukowal artefaktu?");
  process.exit(1);
}
const src = path.join(DIST_DIR, exes[0].f);
const dst = path.join(DIST_DIR, `PATRON-Setup-Windows${cfg.suffix}.exe`);
if (path.resolve(src) !== path.resolve(dst)) {
  fs.copyFileSync(src, dst);
}

// 3b. Code signing (spec 011, bramka B5). Flip samymi env po zakupie certu:
//   PATRON_CODE_SIGNING=on + PATRON_CERT_SHA1 (odcisk w store) albo
//   PATRON_CERT_SUBJECT (/n). Opcjonalnie SIGNTOOL_PATH, PATRON_TIMESTAMP_URL.
// Podpis PO rename (podpisujemy artefakt releasowy), PRZED checksumami i yml -
// sha512/size/blockmap dla auto-update licza sie z PODPISANEGO pliku.
function maybeSign(file) {
  if ((process.env.PATRON_CODE_SIGNING || "").toLowerCase() !== "on") return false;
  const signtool = process.env.SIGNTOOL_PATH || "signtool";
  const args = [
    "sign",
    "/fd", "SHA256",
    "/td", "SHA256",
    "/tr", process.env.PATRON_TIMESTAMP_URL || "http://timestamp.digicert.com",
  ];
  if (process.env.PATRON_CERT_SHA1) {
    args.push("/sha1", process.env.PATRON_CERT_SHA1);
  } else if (process.env.PATRON_CERT_SUBJECT) {
    args.push("/n", process.env.PATRON_CERT_SUBJECT);
  } else {
    // Fail-loud: wlaczony signing bez wskazania certu = przerwij, zadnego
    // cichego builda niepodpisanego.
    console.error(
      "PATRON_CODE_SIGNING=on wymaga PATRON_CERT_SHA1 albo PATRON_CERT_SUBJECT.",
    );
    process.exit(1);
  }
  args.push(file);
  run(signtool, args);
  console.log(`OK: podpisano ${path.basename(file)} (signtool)`);
  return true;
}
const signed = maybeSign(dst);

const { createHash } = require("node:crypto");
const sha256 = createHash("sha256").update(fs.readFileSync(dst)).digest("hex");
fs.appendFileSync(
  path.join(DIST_DIR, "CHECKSUMS.txt"),
  `${sha256}  PATRON-Setup-Windows${cfg.suffix}.exe\n`,
  "utf8",
);
console.log(`\nOK: ${dst}`);
console.log(`SHA256: ${sha256} (dopisane do dist/CHECKSUMS.txt - opublikuj razem z releasem)`);

// 4. Metadane auto-update per edycja (spec 008): electron-builder generuje
// latest.yml z ORYGINALNA nazwa artefaktu - patchujemy URL na kanoniczna nazwe
// releasowa i zapisujemy pod nazwa kanalu edycji (latest[-xx].yml). Kopiujemy
// tez .blockmap (differential update). sha512 w yml pozostaje poprawny -
// exe kopiowany bajt-w-bajt.
const canonicalExe = `PATRON-Setup-Windows${cfg.suffix}.exe`;
const channelFile = `latest${cfg.suffix.toLowerCase()}.yml`;
const latestYml = path.join(DIST_DIR, "latest.yml");
if (fs.existsSync(latestYml)) {
  const originalName = exes[0].f;
  let patched = fs
    .readFileSync(latestYml, "utf8")
    .split(originalName)
    .join(canonicalExe)
    // electron-builder koduje spacje w url jako %20 - podmien tez wariant encoded
    .split(encodeURIComponent(originalName).replace(/%2E/gi, "."))
    .join(canonicalExe)
    // electron-builder 25.x wpisuje do latest.yml nazwe ze spacjami zamienionymi
    // na MYSLNIKI ("PATRON-Setup-1.1.0.exe"). Bez tej podmiany yml wskazywal
    // asset, ktorego w Release nie ma (zmierzone 2026-08-17 na v1.0.0:
    // latest-gb.yml -> PATRON-Setup-1.0.0.exe, 404) - auto-update nigdy nie
    // mogl zadzialac, a build konczyl sie sukcesem.
    .split(originalName.replace(/ /g, "-"))
    .join(canonicalExe);
  if (patched.includes(originalName.replace(/ /g, "-")) || !patched.includes(canonicalExe)) {
    throw new Error(
      `${channelFile}: url nie wskazuje ${canonicalExe} - auto-update dostalby 404. ` +
        "Sprawdz nazwe artefaktu z electron-buildera vs podmiany powyzej.",
    );
  }
  if (signed) {
    // Podpis zmienil bajty exe - sha512/size z electron-buildera sa juz
    // nieaktualne. Przelicz z podpisanego pliku, inaczej auto-update odrzuci
    // pobrany artefakt.
    const buf = fs.readFileSync(dst);
    const sha512 = createHash("sha512").update(buf).digest("base64");
    patched = patched
      .replace(/sha512: .*/g, `sha512: ${sha512}`)
      .replace(/size: \d+/g, `size: ${buf.length}`);
  }
  // Kanal zapisujemy do dist/channels/, NIE do dist/: kanal PL nazywa sie
  // "latest.yml", czyli tak samo jak surowy plik electron-buildera - kazda
  // nastepna edycja nadpisywala go swoimi danymi (zmierzone 2026-08-17: po
  // buildzie US "latest.yml" niosl hash i rozmiar US, a release-all wzialby go
  // jako kanal PL). Osobny katalog = zero kolizji nazw.
  const channelsDir = path.join(DIST_DIR, "channels");
  fs.mkdirSync(channelsDir, { recursive: true });
  fs.writeFileSync(path.join(channelsDir, channelFile), patched, "utf8");
  console.log(`OK: channels/${channelFile} (kanal auto-update edycji ${locale})`);
} else {
  console.warn(
    "UWAGA: brak dist/latest.yml - electron-builder nie wygenerowal metadanych " +
      "auto-update (sprawdz sekcje build.publish w package.json). Edycja bez yml " +
      "nie dostanie auto-update.",
  );
}
const srcBlockmap = `${src}.blockmap`;
if (signed) {
  // Blockmap opisuje bloki exe - po podpisie regenerujemy z podpisanego pliku
  // (app-builder z node_modules electron-buildera, to samo narzedzie ktore
  // generuje blockmapy w buildzie).
  try {
    const appBuilder = require("app-builder-bin").appBuilderPath;
    if (!appBuilder || !fs.existsSync(appBuilder)) {
      throw new Error("app-builder-bin nie znaleziony w node_modules");
    }
    run(appBuilder, [
      "blockmap",
      "--input", dst,
      "--output", path.join(DIST_DIR, `${canonicalExe}.blockmap`),
    ]);
    console.log(`OK: ${canonicalExe}.blockmap (zregenerowany po podpisie)`);
  } catch (err) {
    console.warn(
      `UWAGA: nie zregenerowano blockmapy (${err.message}) - auto-update ` +
        "zadziala pelnym pobraniem, bez delty.",
    );
    fs.rmSync(path.join(DIST_DIR, `${canonicalExe}.blockmap`), { force: true });
  }
} else if (fs.existsSync(srcBlockmap)) {
  fs.copyFileSync(srcBlockmap, path.join(DIST_DIR, `${canonicalExe}.blockmap`));
  console.log(`OK: ${canonicalExe}.blockmap`);
}
console.log(
  `Do releasu wgraj: ${canonicalExe}, ${canonicalExe}.blockmap, ${channelFile}`,
);
