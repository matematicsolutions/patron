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
  stageFrontend();
  log(`OK. Zasoby w ${path.relative(REPO_ROOT, OUT_DIR)} (backend + frontend).`);
  log("Nastepny krok: electron-builder --win --x64 (skrypt build w desktop/package.json).");
}

main();
