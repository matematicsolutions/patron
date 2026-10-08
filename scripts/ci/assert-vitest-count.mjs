#!/usr/bin/env node
// Bramka zera testow dla vitest w CI.
//
// Kod wyjscia vitest NIE wystarcza: filtr, ktory nic nie lapie, albo plik ze
// wszystkimi testami w .skip konczy sie exit 0 - zmierzone 2026-10-06 na
// backend/src/lib/audit.test.ts: `vitest run -t <brak>` -> exit 0, a JSON
// reportera mowi { numPassedTests: 0, numPendingTests: <wszystkie>, success: true }.
// Ta bramka czyta JSON reportera i liczy testy WYKONANE (passed + failed).
//
// Uzycie (katalog roboczy = pakiet):
//   npx vitest run [...] --reporter=default --reporter=json --outputFile=vitest-results.json
//   node ../scripts/ci/assert-vitest-count.mjs vitest-results.json [--min N] [--exact N]
//
// Blokuje (exit 1): brak/zly plik wynikow, porazki, wykonane < min (domyslnie 1),
// wykonane != exact. "Nie wiem" blokuje - brak pliku to porazka, nie sukces.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const plik = args[0];
const opcja = (nazwa) => {
  const i = args.indexOf(nazwa);
  if (i === -1) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n)) throw new Error(`${nazwa} wymaga liczby calkowitej`);
  return n;
};

const powody = [];
let r = null;
let min = 1;
let exact;
try {
  min = opcja("--min") ?? 1;
  exact = opcja("--exact");
  if (min < 1) powody.push("--min < 1 rozbraja bramke");
  if (!plik) throw new Error("podaj plik wynikow vitest (JSON)");
  r = JSON.parse(readFileSync(plik, "utf8"));
} catch (e) {
  powody.push(`nie da sie odczytac wynikow: ${e.message}`);
}

if (r) {
  const passed = r.numPassedTests ?? 0;
  const failed = r.numFailedTests ?? 0;
  const pending = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0);
  const wykonane = passed + failed;
  if (typeof r.numTotalTests !== "number") powody.push("JSON bez numTotalTests - to nie wynik vitest?");
  if (wykonane === 0) powody.push(`WYKONANO 0 testow (pominiete ${pending}) - vitest uznal to za success=${r.success}`);
  else if (wykonane < min) powody.push(`wykonano ${wykonane}, minimum ${min}`);
  if (exact !== undefined && wykonane !== exact)
    powody.push(`wykonano ${wykonane}, pin ${exact} - zmiana liczby testow wymaga swiadomej zmiany pinu`);
  if (failed > 0) powody.push(`${failed} testow nie przeszlo`);
  console.log(
    `bramka-zera-testow: wykonane ${wykonane} (passed ${passed}, failed ${failed}) | pominiete ${pending} | ` +
      `razem ${r.numTotalTests} | min ${min} | pin ${exact ?? "-"}`,
  );
}

if (powody.length) {
  for (const p of powody) console.error(`::error::bramka-zera-testow: ${p}`);
  process.exit(1);
}
console.log("bramka-zera-testow: OK");
