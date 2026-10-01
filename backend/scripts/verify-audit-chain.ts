#!/usr/bin/env tsx
// Weryfikator integralnosci audit trail hash-chain (ADR-0001, ADR-0161).
//
// Uruchomienie:
//   npm run audit:verify                         # zrodlo jak backend (PATRON_DB_BACKEND)
//   npm run audit:verify -- --sqlite [plik.db]   # plik SQLite (domyslnie PATRON_DB_PATH)
//   npm run audit:verify -- --supabase [--guard-after-id N]
//
// Zrodlo bez flagi wybiera ta sama regula co backend (lib/supabase.ts): SQLite,
// chyba ze PATRON_DB_BACKEND=supabase. Weryfikator sprawdza wiec te baze, do
// ktorej aplikacja realnie pisze, i wypisuje ja w pierwszej linii. SQLite
// otwierany TYLKO DO ODCZYTU. Zrodlo i druk: scripts/audit-chain-source.ts,
// rdzen: src/lib/audit-chain-verify.ts.
//
// Kody wyjscia (trojstan + blad):
//   0 = OK       - jeden lancuch, kazdy hash zgodny (potwierdzone rozwidlenia = INFO)
//   3 = UWAGI    - rozwidlenia z sygnatura wyscigu sprzed straznika, niepotwierdzone
//                  (`npm run audit:acknowledge-forks`)
//   1 = BLOKADA  - modyfikacja, usuniecie, wstawka, rozwidlenie bez wyjasnienia,
//                  zniknione ogniwo z potwierdzenia, pusty dziennik
//   2 = blad     - nie da sie odczytac zrodla
// Raport podaje id wierszy, nigdy payloadu (dane sprawy).

import { verifyAuditChain } from "../src/lib/audit-chain-verify";
import { EXIT, loadChain, parseSourceArgs, printReport } from "./audit-chain-source";

async function main() {
    const args = parseSourceArgs(process.argv.slice(2));
    const startedAt = Date.now();
    const { rows, guardAfterId } = await loadChain(args);
    const report = verifyAuditChain(rows, { guardAfterId });
    printReport(report, ((Date.now() - startedAt) / 1000).toFixed(2));
    process.exit(EXIT[report.verdict]);
}

main().catch((err) => {
    console.error("[audit-chain] unhandled error:", err);
    process.exit(EXIT.error);
});
