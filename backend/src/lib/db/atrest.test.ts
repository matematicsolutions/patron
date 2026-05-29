import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyEncryptionKey, isCipherActive } from "./atrest";

const ENV = process.env.PATRON_DB_ENCRYPTION_KEY;
afterEach(() => {
    if (ENV === undefined) delete process.env.PATRON_DB_ENCRYPTION_KEY;
    else process.env.PATRON_DB_ENCRYPTION_KEY = ENV;
});

describe("applyEncryptionKey (at-rest, ADR-0072)", () => {
    it("brak klucza -> no-op, baza dziala (plaintext jak dotad)", () => {
        delete process.env.PATRON_DB_ENCRYPTION_KEY;
        const db = new Database(":memory:");
        expect(() => applyEncryptionKey(db)).not.toThrow();
        // baza nadal uzywalna
        db.exec("create table t(x)");
        db.prepare("insert into t values (1)").run();
        expect((db.prepare("select count(*) c from t").get() as { c: number }).c).toBe(1);
        db.close();
    });

    it("klucz ustawiony + vanilla driver (brak cipher) -> FAIL-LOUD (rzuca)", () => {
        // Vanilla better-sqlite3 ignoruje PRAGMA key - bez tej bramki mielibysmy
        // NIEzaszyfrowana baze z falszywym poczuciem bezpieczenstwa.
        process.env.PATRON_DB_ENCRYPTION_KEY = "deadbeef".repeat(8);
        const db = new Database(":memory:");
        expect(() => applyEncryptionKey(db)).toThrow(/falszywym poczuciem/);
        db.close();
    });

    it("isCipherActive: false dla vanilla better-sqlite3", () => {
        const db = new Database(":memory:");
        expect(isCipherActive(db)).toBe(false);
        db.close();
    });
});
