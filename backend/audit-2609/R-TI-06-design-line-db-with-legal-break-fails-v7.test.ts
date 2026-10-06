// R-TI-06: ADR-0163 / migrate.sqlite.ts. Baza linii feat/design-system-2-0 ma
// user_version = 6 z WLASNYM v6 (CHECK z `audit.chain.legal_break`, bez
// `deliverable.bundle_export`). Runner puszcza na niej v7 = rebuild z lista
// AUDIT_EVENT_TYPES_V7, ktora NIE zawiera `audit.chain.legal_break` (ten typ
// dochodzi dopiero w v8). Rebuild kopiuje wiersze `insert into audit_log_new ...
// select ... from audit_log` - jezeli baza ma choc jedno zdarzenie legal_break
// (rodo-delete z linii 2.0 je zapisuje), CHECK nowej tabeli je odrzuca i migracja
// pada. Bramka db/migration-line-collision.test.ts sprawdza ten scenariusz na bazie
// z JEDNYM wierszem chat.message.user, wiec go nie widzi.
// Oczekiwane: baza linii 2.0 z zdarzeniem legal_break migruje do v8 bez bledu,
// wiersz zachowany.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA } from "../src/lib/db/schema.sqlite";
import { AUDIT_EVENT_TYPES_V5, runSqliteMigrations, SQLITE_MIGRATIONS } from "../src/lib/db/migrate.sqlite";

const DESIGN_LINE_V6 = [...AUDIT_EVENT_TYPES_V5, "audit.chain.legal_break"];

function designLineDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(SQLITE_SCHEMA);
    db.exec("drop table audit_log");
    db.exec(`
      create table audit_log (
        id integer primary key autoincrement,
        ts text not null,
        actor_user_id text,
        event_type text not null check (event_type in (${DESIGN_LINE_V6.map((t) => `'${t}'`).join(",")})),
        chat_id text,
        document_id text,
        payload text not null,
        prev_hash text not null,
        hash text not null unique
      );
    `);
    const ins = db.prepare(
        "insert into audit_log (ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?)",
    );
    ins.run("t0", "u1", "chat.message.user", null, null, "{}", "0".repeat(64), "1".repeat(64));
    ins.run("t1", null, "audit.chain.legal_break", null, null, '{"field":"actor_user_id"}', "1".repeat(64), "2".repeat(64));
    db.pragma("user_version = 6");
    return db;
}

describe("R-TI-06 baza linii 2.0 z zdarzeniem legal_break", () => {
    it("migracja do v8 przechodzi i zachowuje wiersz legal_break", () => {
        const db = designLineDb();
        let blad: string | null = null;
        try {
            runSqliteMigrations(db, SQLITE_MIGRATIONS);
        } catch (e) {
            blad = e instanceof Error ? e.message : String(e);
        }
        expect(blad, "migracja padla na rebuildzie v7").toBeNull();
        const n = db.prepare("select count(*) c from audit_log where event_type = 'audit.chain.legal_break'").get() as { c: number };
        expect(n.c).toBe(1);
        db.close();
    });
});
