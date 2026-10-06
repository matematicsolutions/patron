// R-AC-06: krok SQLite v7 (migrate.sqlite.ts, `rebuildAuditLogEventTypes(db, AUDIT_EVENT_TYPES_V7)`)
// przepisuje audit_log z CHECK = V7, a V7 NIE zawiera `audit.chain.legal_break`.
// Baza deweloperska linii feat/design-system-2-0 (jej wlasny v6 = v5 + legal_break,
// user_version = 6) dostaje najpierw v7, potem v8. Jesli w tej bazie JEST juz jakikolwiek
// wpis legal_break (to wlasnie robi rodo-delete na tej linii), `insert into audit_log_new
// select ... from audit_log` w v7 lamie CHECK -> wyjatek w runSqliteMigrations -> getDb()
// rzuca -> backend nie startuje. Komentarz przy V8 obiecuje, ze "ten sam krok naprawia
// ... baze deweloperska linii 2.0", ale do v8 nigdy nie dochodzi.
// Test migration-line-collision.test.ts tego nie widzi: jego fikstura linii 2.0 ma jeden
// wpis `chat.message.user`, zaden legal_break.
// Oczekiwane: migracja bazy linii 2.0 z wpisem legal_break przechodzi, wiersz zostaje.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SQLITE_SCHEMA } from "../src/lib/db/schema.sqlite";
import { AUDIT_EVENT_TYPES_V6, SQLITE_MIGRATIONS, runSqliteMigrations } from "../src/lib/db/migrate.sqlite";

const DESIGN_LINE_V6 = [
    ...AUDIT_EVENT_TYPES_V6.filter((t) => t !== "deliverable.bundle_export"),
    "audit.chain.legal_break",
];

describe("R-AC-06 baza linii 2.0 z wpisem legal_break a kroki v7/v8", () => {
    it("migracja nie wywraca startu i zachowuje wpis audit.chain.legal_break", () => {
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
        ins.run("2026-09-20T10:00:00.000Z", null, "chat.message.user", null, null, "{}", "0".repeat(64), "1".repeat(64));
        ins.run(
            "2026-09-20T10:05:00.000Z",
            null,
            "audit.chain.legal_break",
            null,
            null,
            JSON.stringify({ reason: "rodo_art_17_anonymization", field: "actor_user_id", affected_ids: [1] }),
            "1".repeat(64),
            "2".repeat(64),
        );
        db.pragma("user_version = 6");

        let blad: string | null = null;
        try {
            runSqliteMigrations(db, SQLITE_MIGRATIONS);
        } catch (e) {
            blad = e instanceof Error ? e.message : String(e);
        }
        expect(blad, "runSqliteMigrations rzucil - backend nie wystartuje").toBeNull();
        const n = (db.prepare("select count(*) c from audit_log where event_type = 'audit.chain.legal_break'").get() as { c: number }).c;
        expect(n).toBe(1);
        db.close();
    });
});
