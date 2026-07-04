// Weryfikacja kopii escrow KEK (spec 009, A2-3; runbook
// governance/runbooks/kek-backup-recovery.md).
//
// Sprawdza, czy podany material KEK odwija WSZYSTKIE owiniete DEK-i w tabeli
// `encryption_keys` (ADR-0138). Read-only, zero-cloud - zadnego zapisu do bazy,
// zadnego egress. Dziala w SQLite i Postgres (shim createServerSupabase).
//
//   npm run kek:verify -- --kek-file <plik-z-sekretem>
//   (albo kandydat z env PATRON_FIELD_ENCRYPTION_KEK)
//
// Exit codes:
//   0 = wszystkie DEK odwiniete poprawnie (escrow dziala)
//   1 = co najmniej jeden wiersz nie odwija sie (zly klucz / uszkodzony wiersz)
//   2 = brak wierszy w encryption_keys (szyfrowanie nieaktywowane)
//   3 = blad uzycia (brak kandydata KEK / nieczytelny plik)

import fs from "node:fs";
import { createServerSupabase } from "../src/lib/supabase";
import { loadKek } from "../src/lib/crypto/dek";
import { decryptField, isEncryptedField } from "../src/lib/crypto/field-crypto";

function readKekCandidate(): string | null {
    const idx = process.argv.indexOf("--kek-file");
    if (idx !== -1) {
        const file = process.argv[idx + 1];
        if (!file) {
            console.error("Brak sciezki po --kek-file.");
            process.exit(3);
        }
        try {
            const raw = fs.readFileSync(file, "utf8").trim();
            if (!raw) {
                console.error(`Plik ${file} jest pusty.`);
                process.exit(3);
            }
            return raw;
        } catch (err) {
            console.error(
                `Nie moge odczytac pliku ${file}: ${(err as Error).message}`,
            );
            process.exit(3);
        }
    }
    return process.env.PATRON_FIELD_ENCRYPTION_KEK?.trim() || null;
}

async function main(): Promise<void> {
    const candidate = readKekCandidate();
    if (!candidate) {
        console.error(
            "Podaj kandydata KEK: --kek-file <plik> (zalecane dla kopii escrow) " +
                "albo env PATRON_FIELD_ENCRYPTION_KEK.",
        );
        process.exit(3);
    }
    // loadKek czyta z env - wstrzykujemy kandydata (tylko w tym procesie).
    process.env.PATRON_FIELD_ENCRYPTION_KEK = candidate;
    const kek = loadKek();

    const db = createServerSupabase();
    const { data, error } = await db
        .from("encryption_keys")
        .select("tenant_id, wrapped_dek, kek_version");
    if (error) {
        console.error(`Blad odczytu encryption_keys: ${error.message}`);
        process.exit(1);
    }
    const rows = (data ?? []) as Array<{
        tenant_id: string;
        wrapped_dek: string;
        kek_version: number;
    }>;
    if (rows.length === 0) {
        console.log(
            "encryption_keys jest puste - field-level encryption nigdy nie zostalo " +
                "aktywowane w tej bazie. Nie ma czego weryfikowac.",
        );
        process.exit(2);
    }

    let failures = 0;
    for (const row of rows) {
        try {
            if (!isEncryptedField(row.wrapped_dek)) {
                throw new Error("wrapped_dek nie ma formatu fc1 (uszkodzony wiersz)");
            }
            const dek = Buffer.from(decryptField(row.wrapped_dek, kek), "base64");
            if (dek.length !== 32) {
                throw new Error(`odwiniety DEK ma ${dek.length}B zamiast 32B`);
            }
            console.log(
                `OK    tenant=${row.tenant_id} kek_version=${row.kek_version} - DEK odwiniety`,
            );
        } catch (err) {
            failures += 1;
            console.error(
                `FAIL  tenant=${row.tenant_id} - ${(err as Error).message}`,
            );
        }
    }

    if (failures > 0) {
        console.error(
            `\nWYNIK: ${failures}/${rows.length} DEK nie odwija sie tym kluczem. ` +
                "To NIE jest dzialajaca kopia escrow - patrz runbook, sekcja S1/S3.",
        );
        process.exit(1);
    }
    console.log(
        `\nWYNIK: ${rows.length}/${rows.length} DEK odwiniete poprawnie - kopia escrow dziala.`,
    );
    process.exit(0);
}

main().catch((err) => {
    console.error(`Blad weryfikacji: ${(err as Error).message}`);
    process.exit(1);
});
