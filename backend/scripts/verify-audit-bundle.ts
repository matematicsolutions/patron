#!/usr/bin/env tsx
// Weryfikator audit bundle JSON - narzedzie WEWNETRZNE (ADR-0066).
//
// Uruchomienie:
//   npx tsx scripts/verify-audit-bundle.ts <plik.json>
//   npm run audit:verify-bundle -- <plik.json>
//
// Nie laczy sie z baza Patrona ani z internetem, ale wymaga TEGO repozytorium
// i zaleznosci npm. Odbiorca artefaktu (sad, regulator, klient) dostaje
// weryfikatory w archiwum eksportu - patrz ADR-0142. Weryfikuje:
//   1. manifest - SHA256 kazdej czesci (deliverable, citation_verification,
//      audit_log_excerpt, model_versions, cost_log); wskazuje, KTORA zmieniono
//   2. integrity.canonical_sha256 - hash calosci wykrywa dowolna modyfikacje
//   3. wyciag z dziennika (audyt 2026-09, D-01): ogniwa w obrebie wyciagu, luki
//      jawnie, numery rosnace, hash przeliczony tam, gdzie tresc niemaskowana
//      (verifyAuditExcerpt - ten sam algorytm co verify.py i HTML z archiwum)
//
//   4. zerwanie z mocy prawa (ADR-0164, decyzja 2026-10-06): wpis wyciagu ze
//      znacznikiem legal_break sprawdzany wobec legal_break_declarations
//
// Exit code (jak verify.py z archiwum): 0 = bundle zdrowy, 1 = integralnosc
// naruszona, 2 = blad I/O / JSON, 3 = bundle zdrowy z wpisem zerwanym z mocy
// prawa (zadeklarowanym i potwierdzonym).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    verifyAuditBundle,
    type DeliverableAuditBundle,
} from "../src/lib/audit-bundle";
import { legalBreakReasonLabel } from "../src/lib/audit-pack";

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

    const wynik = verifyAuditBundle(bundle);
    const res = wynik.integrity;
    const w = wynik.excerpt;
    if (w.ok) {
        process.stdout.write(
            `[verify-audit-bundle] wyciag: ${w.entries} wpisow, ${w.links} ogniw, ${w.recomputed} hashy przeliczonych, ` +
                `${w.masked} zamaskowanych, ${w.gaps} luk${w.gaps > 0 ? " (wyciag, nie pelny lancuch)" : ""}\n`,
        );
    } else {
        for (const p of w.problems) process.stderr.write(`[verify-audit-bundle] wyciag NARUSZONY: ${p}\n`);
    }
    if (wynik.verdict === "legal_break") {
        const powody = [
            ...new Set(
                ((bundle.audit_log_excerpt ?? []) as Array<{ legal_break?: { reason: string } }>)
                    .filter((e) => e.legal_break)
                    .map((e) => legalBreakReasonLabel(e.legal_break!.reason)),
            ),
        ];
        const nr = w.legal_break_declaration_ids.map((id) => `#${id}`).join(", ");
        process.stdout.write(
            `[verify-audit-bundle] OK - zerwanie z mocy prawa (${powody.join(", ")}), zadeklarowane ` +
                `${w.legal_break_declaration_ids.length > 1 ? "zdarzeniami" : "zdarzeniem"} ${nr} ` +
                `(${w.legal_breaks} wpisow; canonical_sha256=${res.actual})\n`,
        );
        process.exit(3);
    }
    if (wynik.ok) {
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
    fail(1, res.ok ? "wyciag z dziennika naruszony" : (res.error ?? "integralnosc naruszona"));
}

main();
