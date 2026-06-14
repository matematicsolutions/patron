import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
    runSqliteMigrations,
    SQLITE_MIGRATIONS,
    type SqliteMigration,
} from "./migrate.sqlite";

// CHECK ze STAREGO schematu (przed audytem P1 #3) - bez 'openrouter'.
const LEGACY_USER_API_KEYS = `
  create table user_api_keys (
    id text primary key,
    user_id text not null,
    provider text not null check (provider in ('claude', 'gemini', 'openai')),
    encrypted_key text not null,
    iv text not null,
    auth_tag text not null,
    created_at text not null,
    updated_at text not null,
    unique(user_id, provider)
  );
  create index idx_user_api_keys_user on user_api_keys(user_id);
`;

function checkSql(db: Database.Database): string {
    const row = db
        .prepare(
            "select sql from sqlite_master where type='table' and name='user_api_keys'",
        )
        .get() as { sql: string };
    return row.sql;
}

describe("runSqliteMigrations (P2 #7 runner)", () => {
    it("aplikuje pending wg user_version i podbija wersje", () => {
        const db = new Database(":memory:");
        const applied: number[] = [];
        const migrations: SqliteMigration[] = [
            { version: 1, name: "a", up: () => applied.push(1) },
            { version: 2, name: "b", up: () => applied.push(2) },
        ];
        expect(db.pragma("user_version", { simple: true })).toBe(0);
        const result = runSqliteMigrations(db, migrations);
        expect(result).toBe(2);
        expect(applied).toEqual([1, 2]);
        expect(db.pragma("user_version", { simple: true })).toBe(2);
        db.close();
    });

    it("idempotentny - drugi przebieg nie re-aplikuje", () => {
        const db = new Database(":memory:");
        let runs = 0;
        const migrations: SqliteMigration[] = [
            { version: 1, name: "a", up: () => runs++ },
        ];
        runSqliteMigrations(db, migrations);
        runSqliteMigrations(db, migrations);
        expect(runs).toBe(1);
        db.close();
    });

    it("aplikuje tylko kroki nowsze niz biezacy user_version", () => {
        const db = new Database(":memory:");
        db.pragma("user_version = 1");
        const applied: number[] = [];
        const migrations: SqliteMigration[] = [
            { version: 1, name: "a", up: () => applied.push(1) },
            { version: 2, name: "b", up: () => applied.push(2) },
        ];
        runSqliteMigrations(db, migrations);
        expect(applied).toEqual([2]);
        db.close();
    });
});

describe("migracja v1: openrouter w CHECK user_api_keys (P1 #3)", () => {
    it("rebuilduje stara tabele dodajac 'openrouter' do CHECK i zachowuje dane", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_USER_API_KEYS);
        db.prepare(
            "insert into user_api_keys (id,user_id,provider,encrypted_key,iv,auth_tag,created_at,updated_at) values (?,?,?,?,?,?,?,?)",
        ).run("k1", "u1", "claude", "enc", "iv", "tag", "t0", "t0");

        // Przed migracja: zapis openrouter rzuca CHECK violation.
        expect(() =>
            db
                .prepare(
                    "insert into user_api_keys (id,user_id,provider,encrypted_key,iv,auth_tag,created_at,updated_at) values (?,?,?,?,?,?,?,?)",
                )
                .run("k2", "u1", "openrouter", "enc", "iv", "tag", "t0", "t0"),
        ).toThrow();

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        // Po migracji: CHECK dopuszcza openrouter, stare dane zachowane.
        expect(checkSql(db)).toContain("openrouter");
        expect(
            (db.prepare("select count(*) c from user_api_keys").get() as { c: number })
                .c,
        ).toBe(1);
        expect(() =>
            db
                .prepare(
                    "insert into user_api_keys (id,user_id,provider,encrypted_key,iv,auth_tag,created_at,updated_at) values (?,?,?,?,?,?,?,?)",
                )
                .run("k2", "u1", "openrouter", "enc", "iv", "tag", "t0", "t0"),
        ).not.toThrow();
        // Index odtworzony.
        const idx = db
            .prepare(
                "select name from sqlite_master where type='index' and name='idx_user_api_keys_user'",
            )
            .get();
        expect(idx).toBeTruthy();
        db.close();
    });

    it("samo-pomijalny gdy CHECK juz zawiera openrouter (swieza baza)", () => {
        const db = new Database(":memory:");
        db.exec(
            LEGACY_USER_API_KEYS.replace(
                "'openai')",
                "'openai', 'openrouter')",
            ),
        );
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        expect(checkSql(db)).toContain("openrouter");
        db.close();
    });
});
