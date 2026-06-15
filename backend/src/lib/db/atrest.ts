// Szyfrowanie at-rest bazy SQLite (ADR-0072).
//
// Model klucza: OS keychain / DPAPI. Klucz generowany i chroniony w procesie
// Electron (safeStorage = DPAPI na Windows), wstrzykiwany do backendu zmienna
// srodowiskowa PATRON_DB_ENCRYPTION_KEY (wzorzec istniejacych sekretow desktopu).
// Backend NIE zna i NIE persystuje samego materialu klucza poza ta zmienna.
//
// HONEST FAIL-LOUD: vanilla better-sqlite3 IGNORUJE `PRAGMA key` (no-op) - bez
// sterownika cipher-capable dostalibysmy NIEzaszyfrowana baze z falszywym
// poczuciem bezpieczenstwa. Dlatego po zaaplikowaniu klucza weryfikujemy, czy
// sterownik faktycznie szyfruje (PRAGMA cipher_version). Jezeli nie - rzucamy,
// zamiast po cichu pracowac na plaintext.
//
// Aktywacja prawdziwego szyfrowania wymaga podmiany sterownika na
// better-sqlite3-multiple-ciphers (osobny krok infra - patrz ADR-0072).
// Domyslnie (brak PATRON_DB_ENCRYPTION_KEY) baza jest plaintext jak dotad.

import type Database from "better-sqlite3";

/**
 * Aplikuje klucz szyfrujacy do swiezo otwartego polaczenia. MUSI byc wywolane
 * jako PIERWSZA operacja po `new Database()`, przed jakimkolwiek PRAGMA/DDL.
 *
 * - brak PATRON_DB_ENCRYPTION_KEY  -> no-op (baza plaintext, zachowanie dotychczasowe).
 * - klucz ustawiony + sterownik szyfruje -> baza odszyfrowana/zaszyfrowana kluczem.
 * - klucz ustawiony + sterownik NIE szyfruje -> rzuca (fail-loud, bez falszywego
 *   bezpieczenstwa).
 */
export function applyEncryptionKey(db: Database.Database): void {
    const key = process.env.PATRON_DB_ENCRYPTION_KEY;
    if (!key) return; // szyfrowanie wylaczone - plaintext jak dotad

    // PRAGMA key musi poprzedzic odczyt naglowka bazy. Escapujemy apostrofy.
    db.pragma(`key = '${key.replace(/'/g, "''")}'`);

    if (!isCipherActive(db)) {
        throw new Error(
            "PATRON_DB_ENCRYPTION_KEY jest ustawiony, ale sterownik SQLite nie " +
                "szyfruje (brak PRAGMA cipher_version). Zainstaluj " +
                "better-sqlite3-multiple-ciphers (ADR-0072). Odmawiam pracy na " +
                "NIEzaszyfrowanej bazie z falszywym poczuciem bezpieczenstwa.",
        );
    }
}

/**
 * Czy aktywny sterownik faktycznie szyfruje. Cipher-capable build
 * (better-sqlite3-multiple-ciphers / SQLCipher) eksponuje `PRAGMA cipher_version`
 * zwracajace niepusty wynik; vanilla better-sqlite3 - pusty/blad.
 */
export function isCipherActive(db: Database.Database): boolean {
    try {
        const rows = db.pragma("cipher_version") as unknown;
        if (Array.isArray(rows)) {
            // moze byc [{cipher_version: "..."}] albo ["..."] zaleznie od buildu
            return rows.length > 0 && rows[0] != null;
        }
        return rows != null && rows !== "";
    } catch {
        return false;
    }
}
