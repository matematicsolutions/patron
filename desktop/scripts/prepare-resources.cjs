#!/usr/bin/env node
/**
 * Staging zasobow instalatora desktop (ADR-0091).
 *
 * Sklada do `desktop/dist-resources/{backend,frontend}` komplet gotowy do
 * skopiowania verbatim przez electron-builder (extraResources). Cel: instalator
 * NSIS, ktory wstaje BEZ wymogu Node/npm na maszynie klienta i bez pobierania
 * czegokolwiek przy starcie.
 *
 *   node scripts/prepare-resources.cjs
 *
 * Etapy:
 *   1. Build backendu (tsc -> dist).                      [SKIP_BUILD=1 pomija]
 *   2. Build frontendu (next build, output:standalone)    [SKIP_BUILD=1 pomija]
 *      z NEXT_PUBLIC_* ustawionymi w czasie BUILDU (inline do bundla klienta).
 *   3. Staging backendu: dist + package.json -> dist-resources/backend,
 *      `npm install --omit=dev` (prod node_modules, w tym natywny better-sqlite3),
 *      nastepnie @electron/rebuild better-sqlite3 pod ABI Electrona (bo backend
 *      uruchamiamy przez Node wbudowany w Electron - main.js ELECTRON_RUN_AS_NODE).
 *   4. Staging frontendu standalone: .next/standalone (+ wlasne minimalne
 *      node_modules) + .next/static + public -> dist-resources/frontend.
 *
 * Determinizm/zero-cloud: NEXT_PUBLIC_PATRON_LOCAL_MODE=true wylacza Supabase
 * login; API_BASE celuje w lokalny backend. Embedder NIE jest tu bundlowany
 * (fail-closed bez pobierania, ADR-0071) - retrieval degraduje do BM25+graf,
 * aplikacja startuje. Bundle modelu embeddera + konektorow MCP = osobny krok
 * pilota (rezerwacja ADR-0091).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..");
const BACKEND_SRC = path.join(REPO_ROOT, "backend");
const FRONTEND_SRC = path.join(REPO_ROOT, "frontend");
const OUT_DIR = path.join(DESKTOP_DIR, "dist-resources");
const OUT_BACKEND = path.join(OUT_DIR, "backend");
const OUT_FRONTEND = path.join(OUT_DIR, "frontend");

const SKIP_BUILD = process.env.SKIP_BUILD === "1";
const IS_WIN = process.platform === "win32";

// Locale buildu (ADR-0132): "en" => zestaw konektorow UE-first + samouczek EN,
// "pl" => zachowanie dotychczasowe (PL-first). Czytane z tego samego env co
// frontend (NEXT_PUBLIC_PATRON_LOCALE), wiec jeden build = jeden locale.
const LOCALE = process.env.NEXT_PUBLIC_PATRON_LOCALE === "en" ? "en" : "pl";

// ── Konektory MCP do zbundlowania w instalatorze (ADR-0091) ──────────────────
// Kazdy konektor zyje w osobnym repo (domyslnie obok patron/). Do instalatora
// kopiujemy dist/ + node_modules/ (+ data/ dla eu-compliance, ktory wozi lokalny
// korpus regulacji). Konektor odpalany pod Node wbudowanym w Electron - patrz
// backend lib/mcp/index.ts (resolveStdioSpawn): command "node" -> process.execPath.
const MCP_REPOS_DIR = process.env.MCP_REPOS_DIR
  ? path.resolve(process.env.MCP_REPOS_DIR)
  : path.resolve(REPO_ROOT, "..");
const MCP_SERVERS = [
  { name: "saos", repoDir: "mcp-saos" },
  { name: "nsa", repoDir: "mcp-nsa" },
  { name: "isap", repoDir: "mcp-isap" },
  { name: "krs", repoDir: "mcp-krs" },
  { name: "eu-sparql", repoDir: "mcp-eu-sparql" },
  { name: "eu-compliance", repoDir: "mcp-eu-compliance", needsData: true },
];

// ── Konektory Python (9 krajowych UE) - Opcja C (ADR-0133/0134/0136) ─────────
// de/at/es/fi/ie/nl/se/fr/lu-eli sa JUZ zaufane (APPROVED_PATRON_CONNECTORS, po
// gateway-scan 2026-06-24) i sa w mcp-servers.example.json (dev: `uv run`). Do
// instalatora desktop NIE robimy PyInstaller-freeze per konektor (duplikacja
// runtime x9). Zamiast tego OPCJA C: bundlujemy JEDEN standalone CPython
// (python-build-standalone z uv) i instalujemy 9 konektorow do jego site-packages
// przy buildzie (offline, deterministycznie). Runtime spawnuje
// `py-runtime/python.exe -s -E -c "from <modul>.server import main; main()"`;
// `-s -E` izoluje od user-site (inaczej dociaga stary mcp z %APPDATA%\Python).
// resolveStdioSpawn (backend lib/mcp/index.ts) rozwiazuje wzgledny command do
// BACKEND_ROOT - bez zmian w backendzie. Repo eli zyja w ~/Projects (nie obok
// patron jak konektory Node) - patrz MCP_PY_REPOS_DIR.
const MCP_PY_REPOS_DIR = process.env.MCP_PY_REPOS_DIR
  ? path.resolve(process.env.MCP_PY_REPOS_DIR)
  : path.resolve(REPO_ROOT, "..", "Projects");
// Kolejnosc largest-first (UE-first dla locale EN). Nazwy MUSZA sie zgadzac z
// APPROVED_PATRON_CONNECTORS (pipeline.ts) i JURISDICTION_BY_CONNECTOR
// (connectors.ts) - inaczej bramka typosquat/3-sync blokuje wlasny konektor.
const MCP_SERVERS_PYTHON = [
  { name: "de-eli", repoDir: "de-eli-mcp", module: "de_eli_mcp" },
  { name: "fr-eli", repoDir: "fr-eli-mcp", module: "fr_eli_mcp", needsKey: true },
  { name: "es-eli", repoDir: "es-eli-mcp", module: "es_eli_mcp" },
  { name: "nl-eli", repoDir: "nl-eli-mcp", module: "nl_eli_mcp" },
  { name: "se-eli", repoDir: "se-eli-mcp", module: "se_eli_mcp" },
  { name: "at-eli", repoDir: "at-eli-mcp", module: "at_eli_mcp" },
  { name: "fi-eli", repoDir: "fi-eli-mcp", module: "fi_eli_mcp" },
  { name: "ie-eli", repoDir: "ie-eli-mcp", module: "ie_eli_mcp" },
  { name: "lu-eli", repoDir: "lu-eli-mcp", module: "lu_eli_mcp" },
];
const SKIP_PYTHON_CONNECTORS = process.env.SKIP_PYTHON_CONNECTORS === "1";

// Jurysdykcja per konektor (mirror connectors.ts) - decyduje o defaultach enabled
// i kolejnosci wg locale. Konektory wymagajace klucza (FR-PISTE) = domyslnie OFF.
const JURISDICTION = {
  saos: "PL", nsa: "PL", isap: "PL", krs: "PL",
  "eu-sparql": "EU", "eu-compliance": "EU",
  "de-eli": "DE", "at-eli": "AT", "es-eli": "ES", "fi-eli": "FI", "ie-eli": "IE",
  "nl-eli": "NL", "se-eli": "SE", "fr-eli": "FR", "lu-eli": "LU",
};
const NEEDS_KEY = new Set(["fr-eli"]); // Legifrance/PISTE OAuth - off do podania klucza
// EN: UE-first (largest-first), PL na koncu. PL: dotychczasowe PL-first.
const ORDER_EN = [
  "de-eli", "fr-eli", "es-eli", "nl-eli", "se-eli", "at-eli", "fi-eli", "ie-eli",
  "lu-eli", "eu-sparql", "eu-compliance", "saos", "nsa", "isap", "krs",
];
const ORDER_PL = [
  "saos", "nsa", "isap", "krs", "eu-sparql", "eu-compliance", "de-eli", "fr-eli",
  "es-eli", "nl-eli", "se-eli", "at-eli", "fi-eli", "ie-eli", "lu-eli",
];

// Domyslny stan enabled wg locale. EN: wszystko poza PL wlaczone (FR off - klucz).
// PL: PL + UE-zbiorcze wlaczone, krajowe UE off (obecne, przelaczalne pickerem).
function defaultEnabled(name) {
  if (NEEDS_KEY.has(name)) return false;
  const jur = JURISDICTION[name] || "OTHER";
  if (LOCALE === "en") return jur !== "PL";
  return jur === "PL" || jur === "EU";
}

// Model embeddera (RAG-wektory). Bundlowany lokalnie zeby retrieval semantyczny
// dzialal bez pobierania z sieci na maszynie klienta (ADR-0071 fail-closed).
// Pobierany RAZ przy budowaniu do dist-resources/backend/models; runtime celuje
// w ten katalog przez PATRON_EMBED_MODELS_PATH (main.js).
const EMBED_MODEL = process.env.PATRON_EMBED_MODEL || "Xenova/multilingual-e5-small";
const SKIP_EMBED = process.env.SKIP_EMBED === "1";

// Silnik OCR (Tesseract) bundlowany do instalatora - zeby PATRON czytal SKANY
// akt papierowych z pudelka, bez recznej instalacji u klienta (ADR-0075/0105;
// headline "Libra nie przyjmuje zdjec, my tak"). Zrodlo: lokalna instalacja
// UB-Mannheim (Apache 2.0 - czyste do bundla komercyjnego). main.js wskazuje
// PATRON_OCR_CMD na ten katalog (resolveOcr). tessdata: tylko pol (+osd dla --psm 1).
const TESSERACT_DIR = process.env.PATRON_TESSERACT_DIR
  ? path.resolve(process.env.PATRON_TESSERACT_DIR)
  : IS_WIN
    ? "C:\\Program Files\\Tesseract-OCR"
    : "/usr/bin";
const TESSDATA_SRC = process.env.PATRON_TESSDATA_DIR
  ? path.resolve(process.env.PATRON_TESSDATA_DIR)
  : path.join(process.env.USERPROFILE || process.env.HOME || "", "tessdata");
const SKIP_OCR = process.env.SKIP_OCR === "1";

function log(msg) {
  console.log(`[prepare-resources] ${msg}`);
}

function fail(msg) {
  console.error(`[prepare-resources] FAIL: ${msg}`);
  process.exit(1);
}

// npm/npx przez powloke na Windows (npm.cmd). Dziedziczy stdio - widac postep.
function run(cmd, args, cwd, extraEnv) {
  log(`> ${cmd} ${args.join(" ")}  (cwd=${path.relative(REPO_ROOT, cwd) || "."})`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: IS_WIN,
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

function mustExist(p, what) {
  if (!fs.existsSync(p)) fail(`${what} nie istnieje: ${p}`);
}

// Wersja Electrona do @electron/rebuild - z zainstalowanego pakietu (zrodlo
// prawdy ABI), fallback z devDependencies desktop/package.json.
function electronVersion() {
  const installed = path.join(DESKTOP_DIR, "node_modules", "electron", "package.json");
  if (fs.existsSync(installed)) {
    return JSON.parse(fs.readFileSync(installed, "utf8")).version;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf8"));
  const dep = (pkg.devDependencies && pkg.devDependencies.electron) || "";
  const ver = dep.replace(/^[^0-9]*/, "");
  if (!ver) fail("nie udalo sie ustalic wersji Electrona (zainstaluj electron w desktop/)");
  return ver;
}

// ── 1+2. Build zrodel ───────────────────────────────────────────────────────
function buildSources() {
  if (SKIP_BUILD) {
    log("SKIP_BUILD=1 - pomijam build backendu/frontendu (zaklada gotowe dist/.next)");
    return;
  }
  log("Build backendu (tsc)...");
  run(IS_WIN ? "npm.cmd" : "npm", ["run", "build"], BACKEND_SRC);

  log("Build frontendu (next build, standalone)...");
  run(IS_WIN ? "npm.cmd" : "npm", ["run", "build"], FRONTEND_SRC, {
    // BUILD-TIME inline do bundla klienta (NEXT_PUBLIC_*). Bez tego standalone
    // nie wie, ze jest w trybie local i wola Supabase.
    NEXT_PUBLIC_PATRON_LOCAL_MODE: "true",
    NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
  });
}

// ── 3. Staging backendu + electron-rebuild better-sqlite3 ────────────────────
function stageBackend() {
  log("Staging backendu...");
  mustExist(path.join(BACKEND_SRC, "dist", "index.js"), "backend/dist/index.js (zbuduj backend)");

  rmrf(OUT_BACKEND);
  fs.mkdirSync(OUT_BACKEND, { recursive: true });

  copyDir(path.join(BACKEND_SRC, "dist"), path.join(OUT_BACKEND, "dist"));
  fs.copyFileSync(
    path.join(BACKEND_SRC, "package.json"),
    path.join(OUT_BACKEND, "package.json"),
  );
  const lock = path.join(BACKEND_SRC, "package-lock.json");
  if (fs.existsSync(lock)) {
    fs.copyFileSync(lock, path.join(OUT_BACKEND, "package-lock.json"));
  }

  log("Instalacja produkcyjnych node_modules backendu (--omit=dev)...");
  run(IS_WIN ? "npm.cmd" : "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], OUT_BACKEND);

  // better-sqlite3 zainstalowal sie pod ABI lokalnego Node. Backend w produkcji
  // dziala pod Node WBUDOWANYM w Electron (ELECTRON_RUN_AS_NODE) - inny ABI.
  // Przebuduj natywny modul pod Electron, inaczej `require('better-sqlite3')`
  // rzuca ERR_DLOPEN_FAILED i aplikacja nie wstaje.
  const ev = electronVersion();
  log(`@electron/rebuild better-sqlite3 pod Electron ${ev}...`);
  run(
    IS_WIN ? "npx.cmd" : "npx",
    ["--yes", "@electron/rebuild", "-v", ev, "-m", OUT_BACKEND, "-o", "better-sqlite3", "-f"],
    DESKTOP_DIR,
  );

  mustExist(
    path.join(OUT_BACKEND, "node_modules", "better-sqlite3", "build", "Release"),
    "skompilowany better-sqlite3 (build/Release) - electron-rebuild nie wyprodukowal natywnego bindingu",
  );
  log("Backend gotowy.");
}

// ── 3b. Staging konektorow MCP (orzecznictwo + legislacja PL/UE) ─────────────
// Bez tego instalator nie ma dostepu do SAOS/NSA/ISAP/KRS/EUR-Lex/EU-Compliance
// i mecenas nie ma w czacie zadnego zrodla orzeczen ani aktow prawnych.
function stageMcpConnectors() {
  log("Staging konektorow MCP...");
  const bundleRoot = path.join(OUT_BACKEND, "mcp-bundled");
  rmrf(bundleRoot);
  fs.mkdirSync(bundleRoot, { recursive: true });

  const manifest = [];
  for (const s of MCP_SERVERS) {
    const repo = path.resolve(MCP_REPOS_DIR, s.repoDir);
    const distIndex = path.join(repo, "dist", "index.js");
    const nm = path.join(repo, "node_modules");
    mustExist(distIndex, `${s.name}: dist/index.js (zbuduj konektor: npm install && npm run build w ${repo})`);
    mustExist(nm, `${s.name}: node_modules (uruchom: npm install w ${repo})`);

    const target = path.join(bundleRoot, s.name);
    copyDir(path.join(repo, "dist"), path.join(target, "dist"));
    fs.copyFileSync(path.join(repo, "package.json"), path.join(target, "package.json"));
    copyDir(nm, path.join(target, "node_modules"));
    if (s.needsData) {
      const dataDir = path.join(repo, "data");
      mustExist(dataDir, `${s.name}: data/ (korpus - uruchom: npm run fetch-corpus w ${repo})`);
      copyDir(dataDir, path.join(target, "data"));
      log(`  + ${s.name}: data/ (korpus) skopiowany`);
    }
    // args WZGLEDNE wzgledem korzenia backendu - backend (resolveStdioSpawn)
    // rozwiaze je na absolutne pod realna sciezka instalacji.
    manifest.push({
      name: s.name,
      transport: "stdio",
      command: "node",
      args: [`mcp-bundled/${s.name}/dist/index.js`],
    });
    log(`  + ${s.name} zbundlowany`);
  }

  log(`Konektory Node gotowe: ${manifest.length}. (zapis mcp-servers.json: writeMcpManifest)`);
  return manifest;
}

// ── 3b-py. Bundlowany standalone Python + 9 konektorow UE (Opcja C, ADR-0136) ─
// Kopiuje managed python-build-standalone (z uv) do dist-resources/backend/
// py-runtime, usuwa marker EXTERNALLY-MANAGED (to NASZA kopia) i instaluje 9 repo
// eli do jego site-packages (`uv pip install --python`). Offline w runtime: nic
// nie pobiera u klienta. Zwraca wpisy manifestu (lub [] gdy SKIP/niezbudowane).
function stageBundledPython() {
  if (SKIP_PYTHON_CONNECTORS) {
    log("SKIP_PYTHON_CONNECTORS=1 - pomijam bundlowany Python (9 konektorow UE).");
    return [];
  }
  log("Bundlowanie standalone Pythona + 9 konektorow UE (Opcja C)...");
  const uv = "uv";

  // 1. upewnij sie, ze managed standalone cpython-3.13 jest pobrany.
  try {
    run(uv, ["python", "install", "cpython-3.13", "--managed-python"], DESKTOP_DIR);
  } catch {
    log("  (uv python install zwrocil blad linku - sprawdzam czy drzewo i tak jest)");
  }

  // 2. zlokalizuj managed standalone w `uv python dir` (pelna wersja z python.exe).
  const uvPyDir = execFileSync(uv, ["python", "dir"], { shell: IS_WIN })
    .toString().trim();
  let srcRuntime = null;
  for (const name of fs.readdirSync(uvPyDir)) {
    if (!/^cpython-3\.13\.\d+-windows-x86_64/.test(name)) continue;
    const exe = path.join(uvPyDir, name, "python.exe");
    if (fs.existsSync(exe)) { srcRuntime = path.join(uvPyDir, name); break; }
  }
  if (!srcRuntime) {
    fail(`nie znaleziono managed standalone cpython-3.13 w ${uvPyDir} ` +
      `(uruchom: uv python install cpython-3.13 --managed-python)`);
  }

  // 3. kopia -> py-runtime (relokowalna; python-build-standalone jest self-contained).
  const pyRuntime = path.join(OUT_BACKEND, "py-runtime");
  rmrf(pyRuntime);
  copyDir(srcRuntime, pyRuntime);
  const pyExe = path.join(pyRuntime, "python.exe");
  mustExist(pyExe, "py-runtime/python.exe (kopia standalone)");

  // 4. usun EXTERNALLY-MANAGED (blokuje pip; to NASZA kopia, instalujemy do niej).
  const marker = path.join(pyRuntime, "Lib", "EXTERNALLY-MANAGED");
  if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });

  // 5. install 9 konektorow z lokalnych repo do site-packages runtime (jedno
  //    polecenie - wspolne deps rozwiazane raz; zrodlo = repo eli = to co na PyPI).
  const repoArgs = MCP_SERVERS_PYTHON.map((s) => {
    const repo = path.resolve(MCP_PY_REPOS_DIR, s.repoDir);
    mustExist(path.join(repo, "pyproject.toml"), `${s.name}: repo Python w ${repo}`);
    return repo;
  });
  log(`  uv pip install ${MCP_SERVERS_PYTHON.length} konektorow do py-runtime...`);
  run(uv, ["pip", "install", "--python", pyExe, ...repoArgs], DESKTOP_DIR);

  // 6. weryfikacja importu kazdego z -s -E (izolacja od user-site).
  //    BEZ shell - pyExe to absolutny .exe; shell:true na Windows rozbija
  //    `-c "import X"` (cmd gubi cudzyslow -> python dostaje samo "import").
  for (const s of MCP_SERVERS_PYTHON) {
    execFileSync(pyExe, ["-s", "-E", "-c", `import ${s.module}.server`], {
      stdio: "inherit",
    });
    log(`  + ${s.name} (import ${s.module}.server OK)`);
  }

  log(`Standalone Python + ${MCP_SERVERS_PYTHON.length} konektorow UE gotowe.`);
  return MCP_SERVERS_PYTHON.map((s) => ({
    name: s.name,
    transport: "stdio",
    runtime: "python",
    command: IS_WIN ? "py-runtime/python.exe" : "py-runtime/bin/python3",
    args: ["-s", "-E", "-c", `from ${s.module}.server import main; main()`],
  }));
}

// Zapis mcp-servers.json: laczy konektory Node + Python, ustala enabled+kolejnosc
// wg LOCALE (UE-first dla EN, PL-first dla PL). enabled!==false => aktywny.
function writeMcpManifest(entries) {
  const order = LOCALE === "en" ? ORDER_EN : ORDER_PL;
  const rank = (n) => {
    const i = order.indexOf(n);
    return i === -1 ? 999 : i;
  };
  const out = entries
    .map((e) => ({ ...e, enabled: defaultEnabled(e.name) }))
    .sort((a, b) => rank(a.name) - rank(b.name));
  fs.writeFileSync(
    path.join(OUT_BACKEND, "mcp-servers.json"),
    JSON.stringify(out, null, 2) + "\n",
    "utf8",
  );
  const on = out.filter((e) => e.enabled !== false).map((e) => e.name);
  log(`mcp-servers.json: ${out.length} konektorow (locale=${LOCALE}), ` +
    `domyslnie ON (${on.length}): ${on.join(", ")}`);
}

// ── 3c. Staging modelu embeddera (RAG-wektory offline) ───────────────────────
// Best-effort: pobiera wagi modelu RAZ do dist-resources/backend/models. Gdy sie
// nie uda (brak sieci), retrieval i tak dziala (degraduje do BM25+graf), wiec
// nie wywalamy buildu - logujemy ostrzezenie. SKIP_EMBED=1 pomija calkowicie.
function stageEmbedModel() {
  if (SKIP_EMBED) {
    log("SKIP_EMBED=1 - pomijam bundlowanie modelu embeddera.");
    return;
  }
  log(`Bundlowanie modelu embeddera (${EMBED_MODEL})...`);
  const modelsDir = path.join(OUT_BACKEND, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  // Pobranie przez @huggingface/transformers z node_modules backendu. cacheDir =
  // modelsDir; layout cache (${modelsDir}/${EMBED_MODEL}/...) jest identyczny z
  // tym, czego runtime szuka przez localModelPath. Skrypt zapisujemy do PLIKU
  // (a nie node -e) - wieloliniowy -e psuje sie pod shell:true na Windows.
  const dlScript = path.join(OUT_BACKEND, ".embed-download.cjs");
  const dl = [
    "const t = require('@huggingface/transformers');",
    "t.env.allowRemoteModels = true;",
    "t.env.allowLocalModels = true;",
    `t.env.cacheDir = ${JSON.stringify(modelsDir)};`,
    `(async()=>{ const p = await t.pipeline('feature-extraction', ${JSON.stringify(EMBED_MODEL)}); await p('rozgrzewka'); console.log('[embed] model pobrany OK'); })().catch(e=>{ console.error('[embed] download failed:', e && e.message ? e.message : e); process.exit(7); });`,
  ].join("\n");
  fs.writeFileSync(dlScript, dl, "utf8");
  try {
    run(IS_WIN ? "node.exe" : "node", [".embed-download.cjs"], OUT_BACKEND);
    fs.rmSync(dlScript, { force: true });
    log("Model embeddera gotowy (offline-ready).");
  } catch {
    fs.rmSync(dlScript, { force: true });
    log("UWAGA: pobranie modelu embeddera nie powiodlo sie - instalator zbuduje sie BEZ wektorow (retrieval degraduje do BM25+graf). Powtorz z dostepem do sieci albo ustaw PATRON_EMBED_MODELS_PATH recznie.");
  }
}

// ── 3d. Staging dokumentacji uzytkownika (baza wiedzy + samouczek) ───────────
// Dwa dokumenty jada z instalatorem: mecenas ma je na dysku, a asystent moze
// do nich odsylac (prompt systemowy o nich wie). Trafiaja do backend/docs/.
function stageDocs() {
  log(`Staging dokumentacji (baza wiedzy + samouczek, locale=${LOCALE})...`);
  const outDocs = path.join(OUT_BACKEND, "docs");
  fs.mkdirSync(outDocs, { recursive: true });

  // BAZA_WIEDZY: na razie tylko PL (tlumaczenie EN poza zakresem spec 003).
  const baza = path.join(REPO_ROOT, "docs", "BAZA_WIEDZY.md");
  if (fs.existsSync(baza)) {
    fs.copyFileSync(baza, path.join(outDocs, "BAZA_WIEDZY.md"));
    log("  + BAZA_WIEDZY.md");
  } else {
    log("  UWAGA: brak BAZA_WIEDZY.md - pomijam.");
  }

  // SAMOUCZEK locale-aware: EN bierze SAMOUCZEK_EN.md, pakowany pod kanoniczna
  // nazwa SAMOUCZEK.md (prompt systemowy odwoluje sie do niej niezaleznie od jezyka).
  const samSrcName = LOCALE === "en" ? "SAMOUCZEK_EN.md" : "SAMOUCZEK.md";
  const samSrc = path.join(REPO_ROOT, "docs", samSrcName);
  const samDst = path.join(outDocs, "SAMOUCZEK.md");
  if (fs.existsSync(samSrc)) {
    fs.copyFileSync(samSrc, samDst);
    log(`  + SAMOUCZEK.md (z ${samSrcName})`);
  } else if (LOCALE === "en") {
    const samPl = path.join(REPO_ROOT, "docs", "SAMOUCZEK.md");
    if (fs.existsSync(samPl)) {
      fs.copyFileSync(samPl, samDst);
      log("  UWAGA: brak SAMOUCZEK_EN.md - pakuje polski fallback (uzupelnij tlumaczenie).");
    } else {
      log("  UWAGA: brak SAMOUCZEK_EN.md i SAMOUCZEK.md - pomijam.");
    }
  } else {
    log("  UWAGA: brak SAMOUCZEK.md - pomijam.");
  }
}

// ── 3e. Staging silnika OCR (Tesseract + tessdata pol) ───────────────────────
// Best-effort jak embedder: gdy brak zrodla, instalator buduje sie BEZ wbudowanego
// OCR (main.js spadnie na recznie zainstalowany Tesseract / PATRON_OCR_CMD), wiec
// nie wywalamy buildu - logujemy ostrzezenie. SKIP_OCR=1 pomija calkowicie.
function stageOcrEngine() {
  if (SKIP_OCR) {
    log("SKIP_OCR=1 - pomijam bundlowanie silnika OCR.");
    return;
  }
  const exe = IS_WIN ? "tesseract.exe" : "tesseract";
  const srcExe = path.join(TESSERACT_DIR, exe);
  const srcPol = path.join(TESSDATA_SRC, "pol.traineddata");
  if (!fs.existsSync(srcExe)) {
    log(
      `UWAGA: brak Tesseract w ${TESSERACT_DIR} - instalator BEZ wbudowanego OCR ` +
        `(skany odrzucane do czasu recznej instalacji silnika). Ustaw PATRON_TESSERACT_DIR by wbudowac.`,
    );
    return;
  }
  if (!fs.existsSync(srcPol)) {
    log(
      `UWAGA: brak pol.traineddata w ${TESSDATA_SRC} - polski OCR nie zadziala. ` +
        `Ustaw PATRON_TESSDATA_DIR. Pomijam bundling OCR.`,
    );
    return;
  }
  log(`Bundlowanie silnika OCR (Tesseract z ${TESSERACT_DIR})...`);
  const ocrRoot = path.join(OUT_BACKEND, "ocr");
  rmrf(ocrRoot);
  const tessOut = path.join(ocrRoot, "tesseract");
  fs.mkdirSync(tessOut, { recursive: true });

  // Kopiujemy katalog Tesseract (exe + DLL leptonica/png/tiff/webp/...) BEZ jego
  // wlasnego tessdata (czesto bez pol i ciezki) - tessdata skladamy osobno.
  for (const entry of fs.readdirSync(TESSERACT_DIR, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === "tessdata") continue;
    const from = path.join(TESSERACT_DIR, entry.name);
    const to = path.join(tessOut, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }

  // tessdata: pol (wymagane) + osd (potrzebne dla --psm 1 z orientacja strony).
  const tessdataOut = path.join(ocrRoot, "tessdata");
  fs.mkdirSync(tessdataOut, { recursive: true });
  fs.copyFileSync(srcPol, path.join(tessdataOut, "pol.traineddata"));
  for (const osdSrc of [
    path.join(TESSDATA_SRC, "osd.traineddata"),
    path.join(TESSERACT_DIR, "tessdata", "osd.traineddata"),
  ]) {
    if (fs.existsSync(osdSrc)) {
      fs.copyFileSync(osdSrc, path.join(tessdataOut, "osd.traineddata"));
      break;
    }
  }
  mustExist(path.join(tessOut, exe), "tesseract.exe w zbundlowanym OCR");
  log("Silnik OCR (Tesseract + pol) gotowy.");
}

// ── 4. Staging frontendu standalone ──────────────────────────────────────────
function stageFrontend() {
  log("Staging frontendu (standalone)...");
  const standalone = path.join(FRONTEND_SRC, ".next", "standalone");
  const staticDir = path.join(FRONTEND_SRC, ".next", "static");
  mustExist(standalone, ".next/standalone (next.config output:standalone + next build)");
  mustExist(path.join(standalone, "server.js"), "standalone/server.js (entry serwera produkcyjnego)");

  rmrf(OUT_FRONTEND);
  fs.mkdirSync(OUT_FRONTEND, { recursive: true });

  // standalone bundluje server.js + wlasne minimalne node_modules + .next/server.
  copyDir(standalone, OUT_FRONTEND);
  // standalone NIE zawiera statycznych assetow - trzeba je dolozyc.
  copyDir(staticDir, path.join(OUT_FRONTEND, ".next", "static"));
  const publicDir = path.join(FRONTEND_SRC, "public");
  if (fs.existsSync(publicDir)) {
    copyDir(publicDir, path.join(OUT_FRONTEND, "public"));
  }
  log("Frontend gotowy.");
}

function main() {
  log(`REPO_ROOT=${REPO_ROOT}`);
  rmrf(OUT_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  buildSources();
  stageBackend();
  const nodeManifest = stageMcpConnectors();
  const pyManifest = stageBundledPython();
  writeMcpManifest([...nodeManifest, ...pyManifest]);
  stageEmbedModel();
  stageOcrEngine();
  stageDocs();
  stageFrontend();
  log(`OK. Zasoby w ${path.relative(REPO_ROOT, OUT_DIR)} (backend + konektory MCP Node+Python + model + OCR + docs + frontend, locale=${LOCALE}).`);
  log("Nastepny krok: electron-builder --win --x64 (skrypt build w desktop/package.json).");
}

main();
