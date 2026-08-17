#!/usr/bin/env node
// Wydanie 9 edycji jedna komenda (spec 014, A3-3): pl en it de es fr pt gb us.
//
//   npm run release:all                     # build 6 edycji + weryfikacja + manifest + smoke
//   npm run release:all -- --locales pl,it  # podzbior edycji
//   npm run release:all -- --no-smoke       # bez e2e smoke
//   npm run release:all -- --draft          # + DRAFT releasu GitHub (gh) z assets
//
// Zasady:
//  - buildy SEKWENCYJNIE (rownolegle electron-buildery sie gryza - playbook),
//  - fail-fast na pierwszym bledzie,
//  - --draft tworzy wylacznie DRAFT (niewidoczny publicznie); publikacja
//    releasu = reczny akt WM w UI GitHub (bramka governance),
//  - wersja NIE jest bumpowana tutaj (decyzja wydawcy przed komenda).

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const DIST = path.join(DESKTOP, "dist");
const ALL_LOCALES = ["pl", "en", "it", "de", "es", "fr", "pt", "gb", "us"];
const SUFFIX = { pl: "", en: "-EN", it: "-IT", de: "-DE", es: "-ES", fr: "-FR", pt: "-BR", gb: "-GB", us: "-US" };
const REPO = "matematicsolutions/patron"; // publiczny mat - draft niewidoczny publicznie

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
};

const locales = (opt("--locales") ?? ALL_LOCALES.join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
for (const l of locales) {
    if (!ALL_LOCALES.includes(l)) {
        console.error(`Nieznane locale: ${l} (dozwolone: ${ALL_LOCALES.join(",")})`);
        process.exit(2);
    }
}

function run(cmd, args, opts = {}) {
    console.log(`\n> ${cmd} ${args.join(" ")}`);
    // shell:true na win32 sklada linie polecen BEZ cytowania - argument ze
    // spacja ("PATRON 1.1.0" w --title) rozpadal sie na dwa tokeny, a gh
    // szukal pliku "1.1.0" (zmierzone 2026-08-17: draft padl po 4 h buildu).
    const useShell = process.platform === "win32";
    const safeArgs = useShell
        ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
        : args;
    const r = spawnSync(cmd, safeArgs, {
        cwd: DESKTOP,
        stdio: "inherit",
        shell: useShell,
        ...opts,
    });
    if (r.status !== 0) {
        console.error(`Komenda zakonczona kodem ${r.status} - przerywam release.`);
        process.exit(r.status ?? 1);
    }
}

function sha256(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const version = require(path.join(DESKTOP, "package.json")).version;
console.log(`RELEASE ALL - wersja ${version}, edycje: ${locales.join(", ")}`);
console.log(
    "(bump wersji to decyzja wydawcy PRZED ta komenda: npm version X.Y.Z --no-git-tag-version)",
);

// Swiezy manifest na ten przebieg
const manifestPath = path.join(DIST, "RELEASE-MANIFEST.md");
fs.mkdirSync(DIST, { recursive: true });
const manifest = [
    `# PATRON ${version} - manifest wydania`,
    "",
    `Data: ${new Date().toISOString()}`,
    "",
    "| Plik | SHA256 | Rozmiar |",
    "|---|---|---|",
];

const assets = [];
let smokeDone = false;

for (const locale of locales) {
    console.log(`\n===== EDYCJA ${locale.toUpperCase()} =====`);
    run("node", ["scripts/build-locale.cjs", locale]);

    const suffix = SUFFIX[locale];
    const exe = path.join(DIST, `PATRON-Setup-Windows${suffix}.exe`);
    const yml = path.join(DIST, "channels", `latest${suffix.toLowerCase()}.yml`);
    const blockmap = `${exe}.blockmap`;

    // Weryfikacja kompletu artefaktow edycji (fail-fast)
    if (!fs.existsSync(exe)) {
        console.error(`BRAK artefaktu: ${exe}`);
        process.exit(1);
    }
    if (!fs.existsSync(yml)) {
        console.error(
            `BRAK metadanych auto-update: ${yml} - edycja ${locale} nie dostanie update'ow.`,
        );
        process.exit(1);
    }
    if (!fs.existsSync(blockmap)) {
        console.warn(
            `UWAGA: brak ${path.basename(blockmap)} - update pelnym pobraniem (bez delty).`,
        );
    }

    for (const f of [exe, yml, ...(fs.existsSync(blockmap) ? [blockmap] : [])]) {
        const st = fs.statSync(f);
        manifest.push(
            `| ${path.basename(f)} | ${sha256(f)} | ${(st.size / 1024 / 1024).toFixed(1)} MB |`,
        );
        assets.push(f);
    }

    // E2E smoke (spec 013) raz, po pierwszym buildzie - win-unpacked jest
    // nadpisywany kazdym buildem, wiec smoke ostatniej zbudowanej edycji
    // tez ma sens; robimy po pierwszej, zeby fail-fast byl szybki.
    if (!smokeDone && !flag("--no-smoke")) {
        run("node", ["scripts/e2e-smoke.cjs"]);
        smokeDone = true;
    }
}

fs.writeFileSync(manifestPath, manifest.join("\n") + "\n", "utf8");
console.log(`\nOK: ${manifestPath} (${assets.length} artefaktow)`);

if (flag("--draft")) {
    // DRAFT releasu na publicznym mat: niewidoczny publicznie do recznej
    // publikacji przez WM (bramka governance "push publiczny = czlowiek").
    const tag = `v${version}`;
    console.log(`\nTworze DRAFT releasu ${tag} na ${REPO} (publikacja = WM)...`);
    run("gh", [
        "release",
        "create",
        tag,
        ...assets,
        manifestPath,
        "--repo", REPO,
        "--draft",
        "--title", `PATRON ${version}`,
        "--notes", `Draft utworzony przez release-all (spec 014). Przejrzyj assets i manifest, potem Publish.`,
    ]);
    console.log("DRAFT gotowy - przejrzyj i opublikuj recznie na GitHub.");
} else {
    console.log(
        "\nBez --draft: artefakty zbudowane i zweryfikowane lokalnie. " +
            "Draft releasu: npm run release:all -- --draft (albo reczny upload wg spec 008).",
    );
}
