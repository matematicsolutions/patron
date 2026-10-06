#!/usr/bin/env tsx
// Weryfikator audit pack JSON - narzedzie WEWNETRZNE (ADR-0047).
//
// Uruchomienie:
//   npx tsx scripts/verify-audit-pack.ts <plik.json>
//
// Skrypt nie laczy sie z baza Patrona ani z internetem, ale wymaga TEGO
// repozytorium i zainstalowanych zaleznosci - jest wiec uzyteczny dla nas
// i dla kancelarii, NIE dla odbiorcy artefaktu.
//
// Audytor zewnetrzny (sad, regulator, klient) uzywa weryfikatorow, ktore jada
// razem z artefaktem w archiwum ZIP (ADR-0142): SPRAWDZ-TEN-PLIK.html albo
// verify.py - bez instalacji, bez tego repozytorium. Zgodnosc werdyktow
// wszystkich trzech pilnuje src/lib/audit-verifier-assets.test.ts.
//
// Weryfikuje dwustopniowo:
//   1. integrity SHA-256 - wykrywa modyfikacje pliku po wyniesieniu
//      z kancelarii (np. ktos zmienil payload_masked po stronie audytora)
//   2. Merkle proof bundle - wykrywa modyfikacje eventu w bazie kancelarii
//      (proof nie odtwarza merkle_root z event_hash)
//
// Wpis zanonimizowany na podstawie RODO art. 17 (ADR-0164, decyzja 2026-10-06)
// niesie znacznik event.legal_break i wiersz deklaracji legal_break_declaration:
// dowod Merkle dotyczy oryginalnego hasha, tresc wpisu ma dawac hash_after z
// deklaracji, a deklaracja ma byc nienaruszona i wymieniac ten wpis
// (verifyAuditPack - ten sam trojstan co verify.py i HTML z archiwum).
//
// Exit code (jak verify.py z archiwum):
//   0 = pack zdrowy, wszystkie checki pass
//   1 = jeden z checkow fail (raport stderr)
//   2 = blad I/O / parsowanie JSON / brak argumentu
//   3 = pack zdrowy, ale wpis zerwany z mocy prawa (zadeklarowany i potwierdzony)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    legalBreakReasonLabel,
    verifyAuditPack,
    type AuditPack,
} from "../src/lib/audit-pack";

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

    const wynik = verifyAuditPack(pack);

    // 1. Integrity SHA-256
    const integrity = wynik.integrity;
    if (!integrity.ok) {
        process.stdout.write("[1/3] integrity SHA-256: FAIL\n");
        process.stdout.write(`      ${integrity.error ?? "unknown error"}\n`);
        if (integrity.expected && integrity.actual) {
            process.stdout.write(`      expected: ${integrity.expected}\n`);
            process.stdout.write(`      actual:   ${integrity.actual}\n`);
        }
        process.exit(1);
    }
    process.stdout.write(
        `[1/3] integrity SHA-256: OK (${integrity.expected})\n`,
    );

    // 2. Zdarzenie = to z dowodu; hash z tresci, gdy payload niemaskowany
    //    (audyt 2026-09, C-04 - lustro kroku [2/3] verify.py); wpis zerwany z mocy
    //    prawa - kontrola znacznika wobec deklaracji z pliku.
    const binding = wynik.binding;
    if (!binding.ok) {
        process.stdout.write("[2/3] zgodnosc zdarzenia z dowodem: FAIL\n");
        for (const p of binding.problems) process.stdout.write(`      - ${p}\n`);
        process.exit(1);
    }
    const lb = binding.legalBreak;
    process.stdout.write(
        lb
            ? `[2/3] zgodnosc zdarzenia z dowodem: OK - ZERWANIE Z MOCY PRAWA (${legalBreakReasonLabel(lb.reason)}, ` +
                  `pole ${lb.field}, deklaracja #${lb.declaration_event_id}, hash po zerwaniu ${lb.hash_after}` +
                  `${binding.recomputed ? " przeliczony z tresci" : ", tresc zamaskowana"})\n`
            : binding.recomputed
              ? "[2/3] zgodnosc zdarzenia z dowodem: OK (hash przeliczony z tresci)\n"
              : "[2/3] zgodnosc zdarzenia z dowodem: OK (tresc zamaskowana - hash nieprzeliczalny z pliku)\n",
    );

    // 3. Merkle proof bundle (dla ORYGINALNEGO hasha wpisu)
    const merkle = wynik.merkle;
    if (!merkle.ok) {
        process.stdout.write("[3/3] Merkle proof: FAIL\n");
        process.stdout.write(`      ${merkle.error ?? "unknown error"}\n`);
        process.exit(1);
    }
    process.stdout.write(
        `[3/3] Merkle proof: OK (event_id=${merkle.event_id} odtwarza merkle_root ${pack.merkle_proof_bundle.merkle_root})\n`,
    );

    if (lb) {
        process.stdout.write(
            `\nWynik: OK - zerwanie z mocy prawa (${legalBreakReasonLabel(lb.reason)}), ` +
                `zadeklarowane zdarzeniem #${lb.declaration_event_id}\n`,
        );
        process.exit(3);
    }
    process.stdout.write("\nWynik: audit pack zdrowy (trzy checki PASS)\n");
    process.exit(0);
}

main();
