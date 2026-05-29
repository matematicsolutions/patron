#!/usr/bin/env tsx
// Offline weryfikator audit bundle JSON dla audytora / regulatora / klienta (ADR-0066).
//
// Uruchomienie:
//   npx tsx scripts/verify-audit-bundle.ts <plik.json>
//   npm run audit:verify-bundle -- <plik.json>
//
// Samowystarczalny - bez polaczenia z baza Patrona ani internetem. Weryfikuje:
//   1. manifest - SHA256 kazdej czesci (deliverable, citation_verification,
//      audit_log_excerpt, model_versions, cost_log); wskazuje, KTORA zmieniono
//   2. integrity.canonical_sha256 - hash calosci wykrywa dowolna modyfikacje
//
// Exit code: 0 = bundle zdrowy, 1 = integralnosc naruszona, 2 = blad I/O / JSON.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    verifyAuditBundleIntegrity,
    type DeliverableAuditBundle,
} from "../src/lib/audit-bundle";

function fail(code: number, message: string): never {
    process.stderr.write(`[verify-audit-bundle] ${message}\n`);
    process.exit(code);
}

function main(): void {
    const arg = process.argv[2];
    if (!arg) {
        fail(2, "Uzycie: npx tsx scripts/verify-audit-bundle.ts <plik.json>");
    }

    const path = resolve(process.cwd(), arg);
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (e) {
        fail(2, `nie udalo sie odczytac pliku ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }

    let bundle: DeliverableAuditBundle;
    try {
        bundle = JSON.parse(raw) as DeliverableAuditBundle;
    } catch (e) {
        fail(2, `nieprawidlowy JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    const res = verifyAuditBundleIntegrity(bundle);
    if (res.ok) {
        process.stdout.write(
            `[verify-audit-bundle] OK - bundle nienaruszony (canonical_sha256=${res.actual})\n`,
        );
        process.exit(0);
    }
    if (res.tamperedParts.length > 0) {
        process.stderr.write(
            `[verify-audit-bundle] NARUSZONE czesci: ${res.tamperedParts.join(", ")}\n`,
        );
    }
    fail(1, res.error ?? "integralnosc naruszona");
}

main();
