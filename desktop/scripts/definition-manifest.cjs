#!/usr/bin/env node
// Manifest definicji konektorow wozonych przez instalator (ADR-0162).
//
// Uruchamia kazdy konektor z <backendDir>/mcp-servers.json (takze wylaczone -
// uzytkownik moze je wlaczyc w pickerze), pyta o tools/list i zapisuje hash
// definicji ta sama funkcja, ktorej brama uzywa przy starcie
// (dist/lib/mcp-security/detectors/drift.js, formula v2 z ADR-0159). Wynik:
// <backendDir>/bundled-definitions.json. Brama ufa definicji zgodnej z
// manifestem (koniec blokad dryfu po aktualizacji instalatora), a niezgodna
// znaczy podmiane plikow po instalacji.
//
// Fail-loud: konektor, ktorego nie da sie uruchomic albo zapytac, przerywa build.
// Pusty manifest przy niepustej liscie konektorow to tez blad - inaczej build
// "przeszedlby", a kazda aktualizacja znow blokowalaby konektory.
//
// Uzycie: node definition-manifest.cjs <backendDir> [--hash-from <backendDir2>] [--out <plik>]
//   --hash-from: katalog backendu, ktorego dist liczy hash (domyslnie <backendDir>).

"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TIMEOUT_MS = 60_000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

// Rozwiazanie sciezek jak resolveStdioSpawn w backendzie: wzgledne .js/.py w
// args i wzgledna komenda z separatorem (py-runtime/python.exe) wzgledem backendDir.
function resolveSpawn(entry, backendDir) {
  let command = entry.command;
  if (command && !path.isAbsolute(command) && /[\\/]/.test(command)) {
    command = path.resolve(backendDir, command);
  }
  const args = (entry.args || []).map((a) =>
    (a.endsWith(".js") || a.endsWith(".py")) && !path.isAbsolute(a) ? path.resolve(backendDir, a) : a,
  );
  return { command, args, env: entry.env };
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms} ms: ${what}`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function main() {
  const backendDir = process.argv[2];
  if (!backendDir || backendDir.startsWith("--")) {
    console.error("Uzycie: node definition-manifest.cjs <backendDir> [--hash-from <dir>] [--out <plik>]");
    process.exit(2);
  }
  const hashFrom = arg("--hash-from") || backendDir;
  const out = arg("--out") || path.join(backendDir, "bundled-definitions.json");

  const { computeDefinitionHash } = require(path.resolve(hashFrom, "dist/lib/mcp-security/detectors/drift.js"));
  const sdk = path.resolve(hashFrom, "node_modules/@modelcontextprotocol/sdk/dist/cjs/client");
  const { Client } = require(path.join(sdk, "index.js"));
  const { StdioClientTransport } = require(path.join(sdk, "stdio.js"));

  const entries = JSON.parse(fs.readFileSync(path.join(backendDir, "mcp-servers.json"), "utf8"));
  const stdio = entries.filter((e) => e.transport === "stdio");
  if (stdio.length === 0) {
    console.error("[definition-manifest] BLAD: mcp-servers.json nie ma konektorow stdio - nie ma czego zapisac.");
    process.exit(1);
  }

  const definitions = {};
  const failed = [];
  for (const e of stdio) {
    const spawn = resolveSpawn(e, backendDir);
    const client = new Client({ name: "patron-definition-manifest", version: "1" });
    try {
      await withTimeout(client.connect(new StdioClientTransport(spawn)), TIMEOUT_MS, `${e.name} connect`);
      const { tools } = await withTimeout(client.listTools(), TIMEOUT_MS, `${e.name} tools/list`);
      definitions[e.name] = computeDefinitionHash({
        name: e.name,
        transport: "stdio",
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : undefined,
        })),
      });
      console.log(`[definition-manifest]   ${e.name}: ${tools.length} narzedzi, ${definitions[e.name].slice(0, 12)}...`);
    } catch (err) {
      failed.push(`${e.name} (${err && err.message ? err.message : err})`);
    } finally {
      await client.close().catch(() => {});
    }
  }

  if (failed.length > 0) {
    console.error(`[definition-manifest] BLAD: nie udalo sie odczytac definicji: ${failed.join("; ")}`);
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify({ version: 1, definitions }, null, 2) + "\n", "utf8");
  console.log(`[definition-manifest] OK: ${Object.keys(definitions).length}/${stdio.length} konektorow -> ${out}`);
}

main().catch((err) => {
  console.error("[definition-manifest] BLAD:", err);
  process.exit(1);
});
