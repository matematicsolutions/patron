#!/usr/bin/env tsx
// Offline weryfikator audit pack JSON dla audytora zewnetrznego (ADR-0047).
//
// Uruchomienie:
//   npx tsx scripts/verify-audit-pack.ts <plik.json>
//
// Skrypt jest samowystarczalny - dziala bez polaczenia z baza Patrona ani
// internetem. Audytor moze odpalic na izolowanej maszynie z plikiem JSON
// otrzymanym z UI (ADR-0046, button "Pobierz audit pack").
//
// Weryfikuje dwustopniowo:
//   1. integrity SHA-256 - wykrywa modyfikacje pliku po wyniesieniu
//      z kancelarii (np. ktos zmienil payload_masked po stronie audytora)
//   2. Merkle proof bundle - wykrywa modyfikacje eventu w bazie kancelarii
//      (proof nie odtwarza merkle_root z event_hash)
//
// Exit code:
//   0 = pack zdrowy, oba checki pass
//   1 = jeden z checkow fail (raport stderr)
//   2 = blad I/O / parsowanie JSON / brak argumentu

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    verifyAuditPackIntegrity,
    type AuditPack,
} from "../src/lib/audit-pack";
import { verifyProofBundle } from "../src/lib/audit-merkle-verifier";

function fail(code: number, message: string): never {
    process.stderr.write(`[verify-audit-pack] ${message}\n`);
    process.exit(code);
}

function main(): void {
    const arg = process.argv[2];
    if (!arg) {
        fail(
            2,
            "Uzycie: npx tsx scripts/verify-audit-pack.ts <plik.json>",
        );
    }

    const path = resolve(process.cwd(), arg);
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fail(2, `nie udalo sie odczytac pliku ${path}: ${msg}`);
    }

    let pack: AuditPack;
    try {
        pack = JSON.parse(raw) as AuditPack;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fail(2, `nieprawidlowy JSON: ${msg}`);
    }

    process.stdout.write(`Plik: ${path}\n`);
    process.stdout.write(`schema_version: ${pack.schema_version}\n`);
    process.stdout.write(`pack_kind: ${pack.pack_kind}\n`);
    process.stdout.write(`exported_at: ${pack.exported_at}\n`);
    if (pack.exporter) {
        process.stdout.write(
            `exporter: ${pack.exporter.email ?? "(brak email)"} / ${pack.exporter.user_id ?? "(brak user_id)"}\n`,
        );
    }
    if (pack.event) {
        process.stdout.write(`event_id: ${pack.event.id}\n`);
        process.stdout.write(`event_type: ${pack.event.event_type}\n`);
        process.stdout.write(`event_ts: ${pack.event.ts}\n`);
    }
    process.stdout.write("\n");

    // 1. Integrity SHA-256
    const integrity = verifyAuditPackIntegrity(pack);
    if (!integrity.ok) {
        process.stdout.write("[1/2] integrity SHA-256: FAIL\n");
        process.stdout.write(`      ${integrity.error ?? "unknown error"}\n`);
        if (integrity.expected && integrity.actual) {
            process.stdout.write(`      expected: ${integrity.expected}\n`);
            process.stdout.write(`      actual:   ${integrity.actual}\n`);
        }
        process.exit(1);
    }
    process.stdout.write(
        `[1/2] integrity SHA-256: OK (${integrity.expected})\n`,
    );

    // 2. Merkle proof bundle
    const merkle = verifyProofBundle(pack.merkle_proof_bundle);
    if (!merkle.ok) {
        process.stdout.write("[2/2] Merkle proof: FAIL\n");
        process.stdout.write(`      ${merkle.error ?? "unknown error"}\n`);
        process.exit(1);
    }
    process.stdout.write(
        `[2/2] Merkle proof: OK (event_id=${merkle.event_id} odtwarza merkle_root ${pack.merkle_proof_bundle.merkle_root})\n`,
    );

    process.stdout.write("\nWynik: audit pack zdrowy (oba checki PASS)\n");
    process.exit(0);
}

main();
