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

// 1+2. Zasoby + build z jezykiem NSIS per rynek.
run("node", ["scripts/prepare-resources.cjs"]);
run("npx", [
  "electron-builder",
  "--win",
  "--x64",
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
const { createHash } = require("node:crypto");
const sha256 = createHash("sha256").update(fs.readFileSync(dst)).digest("hex");
fs.appendFileSync(
  path.join(DIST_DIR, "CHECKSUMS.txt"),
  `${sha256}  PATRON-Setup-Windows${cfg.suffix}.exe\n`,
  "utf8",
);
console.log(`\nOK: ${dst}`);
console.log(`SHA256: ${sha256} (dopisane do dist/CHECKSUMS.txt - opublikuj razem z releasem)`);
