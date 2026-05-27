// Pure helpers dla infrastruktury migracji (ADR-0035).
//
// Storage layer (Supabase, fs IO) w `backend/scripts/run-migrations.ts`.
// Tu trzymamy tylko deterministyczne funkcje bez side effects - latwe
// do testowania bez mockow.
//
// Konwencja nazewnictwa pliku migracji: `NNN_<slug>.sql` gdzie NNN to
// trzycyfrowy identyfikator (000-999). Slug ASCII lowercase z `_`.

import crypto from "crypto";

/** Rekord pliku migracji w katalogu `backend/migrations/`. */
export interface MigrationFile {
    /** Trzycyfrowy id z prefixu pliku, np. "001". */
    id: string;
    /** Slug bez prefixu i bez `.sql`, np. "audit_log_event_type_check". */
    name: string;
    /** Pelna nazwa pliku, np. "001_audit_log_event_type_check.sql". */
    filename: string;
}

/**
 * Parsuje nazwe pliku migracji do `{ id, name, filename }`. Zwraca `null`
 * dla nazw nie pasujacych do konwencji (`NNN_<slug>.sql`).
 */
export function parseMigrationFilename(filename: string): MigrationFile | null {
    const match = filename.match(/^(\d{3})_([a-z0-9_]+)\.sql$/);
    if (!match) {
        return null;
    }
    return {
        id: match[1],
        name: match[2],
        filename,
    };
}

/**
 * Sortuje migracje leksykalnie po `id`. Bezpieczne dla zakresu 000-999,
 * pozniej trzeba przejsc na sort numeryczny (przy >999 migracjach).
 */
export function sortMigrations(files: ReadonlyArray<MigrationFile>): MigrationFile[] {
    return [...files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Liczy SHA-256 hex (lower-case, 64 znaki) dla zawartosci pliku migracji.
 * Sluzy do wykrycia modyfikacji juz zaaplikowanej migracji - zapisany
 * checksum w `schema_migrations` rozni sie od policzonego z pliku =
 * runner zwroci blad zamiast po cichu re-aplikowac.
 */
export function computeMigrationChecksum(content: string): string {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Filtruje migracje na te ktore jeszcze nie zostaly zaaplikowane (brak
 * `id` w mapie `applied`). Zachowuje kolejnosc wejscia (sortowanie przed
 * wywolaniem przez `sortMigrations`).
 */
export function selectPendingMigrations(
    files: ReadonlyArray<MigrationFile>,
    applied: ReadonlySet<string>,
): MigrationFile[] {
    return files.filter((f) => !applied.has(f.id));
}

/**
 * Wykrywa duplikaty po `id` w liscie migracji. Zwraca tablice id ktore
 * wystepuja wiecej niz raz. Pusty array = wszystko ok. Uzywane przez
 * runner do early-exit zanim cokolwiek aplikuje.
 */
export function findDuplicateIds(files: ReadonlyArray<MigrationFile>): string[] {
    const seen = new Map<string, number>();
    for (const f of files) {
        seen.set(f.id, (seen.get(f.id) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}
