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

// Model embeddera (RAG-wektory). Bundlowany lokalnie zeby retrieval semantyczny
// dzialal bez pobierania z sieci na maszynie klienta (ADR-0071 fail-closed).
// Pobierany RAZ przy budowaniu do dist-resources/backend/models; runtime celuje
// w ten katalog przez PATRON_EMBED_MODELS_PATH (main.js).
const EMBED_MODEL = process.env.PATRON_EMBED_MODEL || "Xenova/multilingual-e5-small";
const SKIP_EMBED = process.env.SKIP_EMBED === "1";

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
      enabled: true,
    });
    log(`  + ${s.name} zbundlowany`);
  }

  fs.writeFileSync(
    path.join(OUT_BACKEND, "mcp-servers.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  log(`Konektory MCP gotowe: ${manifest.length} (mcp-servers.json zapisany).`);
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
  log("Staging dokumentacji (baza wiedzy + samouczek)...");
  const outDocs = path.join(OUT_BACKEND, "docs");
  fs.mkdirSync(outDocs, { recursive: true });
  const docs = ["BAZA_WIEDZY.md", "SAMOUCZEK.md"];
  for (const d of docs) {
    const src = path.join(REPO_ROOT, "docs", d);
    if (!fs.existsSync(src)) {
      log(`  UWAGA: brak ${d} w docs/ - pomijam.`);
      continue;
    }
    fs.copyFileSync(src, path.join(outDocs, d));
    log(`  + ${d}`);
  }
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
  stageMcpConnectors();
  stageEmbedModel();
  stageDocs();
  stageFrontend();
  log(`OK. Zasoby w ${path.relative(REPO_ROOT, OUT_DIR)} (backend + konektory MCP + model + docs + frontend).`);
  log("Nastepny krok: electron-builder --win --x64 (skrypt build w desktop/package.json).");
}

main();
