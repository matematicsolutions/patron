#!/usr/bin/env node
/**
 * Bundler serwerow MCP do obrazu Docker'a Patrona.
 *
 * Kazdy konektor MCP (mcp-saos, mcp-nsa, mcp-isap, mcp-krs, mcp-eu-sparql) zyje w
 * osobnym repozytorium. Aby zbudowac jeden self-contained kontener backendu,
 * przed `docker build` kopiujemy ich pre-zbudowane `dist/` + odpowiednie
 * fragmenty `node_modules/` do `backend/mcp-bundled/<name>/`.
 *
 * Dodatkowo generujemy `backend/mcp-servers.docker.json` ze sciezkami
 * relatywnymi wewnatrz kontenera (`./mcp-bundled/<name>/index.js`).
 *
 * Wymagania:
 *   - Kazde repo mcp-* musi byc sklonowane w MCP_REPOS_DIR (domyslnie
 *     katalog nadrzedny wzgledem patron/).
 *   - Kazde repo musi miec wykonany `npm install` i `npm run build` (skrypt
 *     to weryfikuje i ostrzega gdy brak).
 *
 * Uruchomienie:
 *   node scripts/bundle-mcp.cjs
 *   node scripts/bundle-mcp.cjs --check         # samo sprawdzenie
 *   MCP_REPOS_DIR=/sciezka node scripts/bundle-mcp.cjs
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Konfiguracja - lista serwerow MCP do zbundlowania.
// Format: { name, repoDir (relatywny od MCP_REPOS_DIR), distSubdir }.
// ---------------------------------------------------------------------------

const SERVERS = [
    { name: "saos", repoDir: "mcp-saos" },
    { name: "nsa", repoDir: "mcp-nsa" },
    { name: "isap", repoDir: "mcp-isap" },
    { name: "krs", repoDir: "mcp-krs" },
    { name: "eu-sparql", repoDir: "mcp-eu-sparql" },
];

const ROOT = path.resolve(__dirname, "..");
const MCP_REPOS_DIR = process.env.MCP_REPOS_DIR
    ? path.resolve(process.env.MCP_REPOS_DIR)
    : path.resolve(ROOT, "..");
const BUNDLE_DIR = path.resolve(ROOT, "backend", "mcp-bundled");
const SERVERS_JSON_OUT = path.resolve(
    ROOT,
    "backend",
    "mcp-servers.docker.json",
);

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(level, msg) {
    const stamp = new Date().toISOString();
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`[${stamp}] [${level}] ${msg}\n`);
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(s, d);
        } else if (entry.isSymbolicLink()) {
            // Resolve symlinks - Docker doesn't follow them.
            const target = fs.readlinkSync(s);
            const resolved = path.isAbsolute(target)
                ? target
                : path.resolve(path.dirname(s), target);
            if (fs.statSync(resolved).isDirectory()) {
                copyDir(resolved, d);
            } else {
                fs.copyFileSync(resolved, d);
            }
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

function rmrf(p) {
    if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Validation pass
// ---------------------------------------------------------------------------

let errors = 0;
const checkedServers = [];

for (const server of SERVERS) {
    const repoPath = path.resolve(MCP_REPOS_DIR, server.repoDir);
    const distPath = path.resolve(repoPath, "dist");
    const indexPath = path.resolve(distPath, "index.js");
    const pkgPath = path.resolve(repoPath, "package.json");
    const nmPath = path.resolve(repoPath, "node_modules");

    if (!fs.existsSync(repoPath)) {
        log(
            "error",
            `Brak repo MCP "${server.name}" w "${repoPath}". Sklonuj lub ustaw MCP_REPOS_DIR.`,
        );
        errors++;
        continue;
    }
    if (!fs.existsSync(indexPath)) {
        log(
            "error",
            `Brak ${distPath}/index.js dla "${server.name}". Uruchom w "${repoPath}": npm install && npm run build`,
        );
        errors++;
        continue;
    }
    if (!fs.existsSync(pkgPath)) {
        log("error", `Brak package.json dla "${server.name}" (${pkgPath}).`);
        errors++;
        continue;
    }
    if (!fs.existsSync(nmPath)) {
        log(
            "error",
            `Brak node_modules dla "${server.name}" (${nmPath}). Uruchom: npm install --omit=dev`,
        );
        errors++;
        continue;
    }

    checkedServers.push({
        ...server,
        repoPath,
        distPath,
        pkgPath,
        nmPath,
    });
}

if (errors > 0) {
    log("error", `Walidacja nieudana: ${errors} blad/y.`);
    process.exit(1);
}
log("info", `Walidacja OK: ${checkedServers.length} serwerow MCP gotowych.`);

if (CHECK_ONLY) {
    log("info", "Tryb --check: nie kopiuje plikow, koncze.");
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Bundle pass
// ---------------------------------------------------------------------------

log("info", `Czyszcze docelowy katalog: ${BUNDLE_DIR}`);
rmrf(BUNDLE_DIR);
fs.mkdirSync(BUNDLE_DIR, { recursive: true });

const manifest = [];

for (const server of checkedServers) {
    const targetDir = path.resolve(BUNDLE_DIR, server.name);
    log("info", `Bundlowanie "${server.name}" -> ${targetDir}`);

    fs.mkdirSync(targetDir, { recursive: true });
    copyDir(server.distPath, path.resolve(targetDir, "dist"));
    fs.copyFileSync(server.pkgPath, path.resolve(targetDir, "package.json"));
    copyDir(server.nmPath, path.resolve(targetDir, "node_modules"));

    manifest.push({
        name: server.name,
        transport: "stdio",
        command: "node",
        args: [`/app/mcp-bundled/${server.name}/dist/index.js`],
        enabled: true,
    });
}

fs.writeFileSync(
    SERVERS_JSON_OUT,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
);
log("info", `Zapisano docker-ready mcp-servers manifest: ${SERVERS_JSON_OUT}`);
log(
    "info",
    `Gotowe. Kontener backendu znajdzie serwery pod /app/mcp-bundled/<name>/dist/index.js.`,
);
