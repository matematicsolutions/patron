import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
    runSqliteMigrations,
    SQLITE_MIGRATIONS,
    type SqliteMigration,
} from "./migrate.sqlite";
import { SQLITE_SCHEMA } from "./schema.sqlite";

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

// audit_log ze STARYM CHECK (bez project.cloud_consent) + indeksy.
const LEGACY_AUDIT_LOG = `
  create table audit_log (
    id integer primary key autoincrement,
    ts text not null,
    actor_user_id text,
    event_type text not null check (event_type in ('chat.message.user','llm_route')),
    chat_id text,
    document_id text,
    payload text not null,
    prev_hash text not null,
    hash text not null unique
  );
  create index idx_audit_log_chat on audit_log(chat_id, ts);
  create index idx_audit_log_actor on audit_log(actor_user_id, ts);
  create index idx_audit_log_event_type on audit_log(event_type, ts);
`;

function auditCheckSql(db: Database.Database): string {
    return (
        db
            .prepare(
                "select sql from sqlite_master where type='table' and name='audit_log'",
            )
            .get() as { sql: string }
    ).sql;
}

describe("migracja v2: project.cloud_consent w CHECK audit_log (P2 #6)", () => {
    it("rebuilduje audit_log ZACHOWUJAC wiersze i hash-chain, dodaje event_type", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG);
        db.prepare(
            "insert into audit_log (id,ts,actor_user_id,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?,?)",
        ).run(1, "t0", "u1", "chat.message.user", "{}", "GENESIS", "h1");
        db.prepare(
            "insert into audit_log (id,ts,actor_user_id,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?,?)",
        ).run(2, "t1", "u1", "llm_route", '{"model":"x"}', "h1", "h2");

        // Przed: nowy event_type lamie CHECK.
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(3, "t2", "project.cloud_consent", "{}", "h2", "h3"),
        ).toThrow();

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        // Po: CHECK ma nowy typ, wiersze + hash-chain zachowane (id/hash/prev_hash).
        expect(auditCheckSql(db)).toContain("project.cloud_consent");
        const rows = db
            .prepare("select id, prev_hash, hash, event_type from audit_log order by id")
            .all() as { id: number; prev_hash: string; hash: string; event_type: string }[];
        expect(rows).toEqual([
            { id: 1, prev_hash: "GENESIS", hash: "h1", event_type: "chat.message.user" },
            { id: 2, prev_hash: "h1", hash: "h2", event_type: "llm_route" },
        ]);
        // Indeksy odtworzone.
        const idx = db
            .prepare(
                "select count(*) c from sqlite_master where type='index' and name in ('idx_audit_log_chat','idx_audit_log_actor','idx_audit_log_event_type')",
            )
            .get() as { c: number };
        expect(idx.c).toBe(3);
        // Nowy event_type teraz przechodzi; nieznany nadal odrzucany.
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(3, "t2", "project.cloud_consent", "{}", "h2", "h3"),
        ).not.toThrow();
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(4, "t3", "totally.bogus", "{}", "h3", "h4"),
        ).toThrow();
        db.close();
    });
});

// Czy w sqlite_master istnieje tabela `mutation_approvals`.
function hasMutationApprovals(db: Database.Database): boolean {
    return Boolean(
        db
            .prepare(
                "select 1 from sqlite_master where type='table' and name='mutation_approvals'",
            )
            .get(),
    );
}

describe("migracja v4: mutation.approval.decision + tabela mutation_approvals (ADR-0137)", () => {
    it("(1) rebuilduje audit_log ZACHOWUJAC wiersze i hash-chain, dodaje mutation.approval.decision", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG);
        db.prepare(
            "insert into audit_log (id,ts,actor_user_id,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?,?)",
        ).run(1, "t0", "u1", "chat.message.user", "{}", "GENESIS", "h1");
        db.prepare(
            "insert into audit_log (id,ts,actor_user_id,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?,?)",
        ).run(2, "t1", "u1", "llm_route", '{"model":"x"}', "h1", "h2");

        // Przed: nowy event_type lamie CHECK.
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(3, "t2", "mutation.approval.decision", "{}", "h2", "h3"),
        ).toThrow();

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        // Po: CHECK ma nowy typ, wiersze + hash-chain zachowane (id/prev_hash/hash).
        expect(auditCheckSql(db)).toContain("mutation.approval.decision");
        const rows = db
            .prepare("select id, prev_hash, hash, event_type from audit_log order by id")
            .all() as { id: number; prev_hash: string; hash: string; event_type: string }[];
        expect(rows).toEqual([
            { id: 1, prev_hash: "GENESIS", hash: "h1", event_type: "chat.message.user" },
            { id: 2, prev_hash: "h1", hash: "h2", event_type: "llm_route" },
        ]);
        db.close();
    });

    it("(2) po migracji nowy event_type przechodzi CHECK, nieznany nadal odrzucany", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG);
        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(1, "t0", "mutation.approval.decision", "{}", "GENESIS", "h1"),
        ).not.toThrow();
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (id,ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?,?)",
                )
                .run(2, "t1", "totally.bogus", "{}", "h1", "h2"),
        ).toThrow();
        db.close();
    });

    it("(3) tworzy tabele mutation_approvals dla istniejacej bazy (fallback) z indeksami", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG);
        expect(hasMutationApprovals(db)).toBe(false);

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        expect(hasMutationApprovals(db)).toBe(true);
        const idx = db
            .prepare(
                "select count(*) c from sqlite_master where type='index' and name in ('idx_mutation_approvals_user_status','idx_mutation_approvals_chat','idx_mutation_approvals_document')",
            )
            .get() as { c: number };
        expect(idx.c).toBe(3);
        db.close();
    });

    it("(4) mutation_approvals: insert pending OK, status spoza enum odrzucony", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG);
        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        expect(() =>
            db
                .prepare(
                    "insert into mutation_approvals (id,user_id,tool_name,staged_at,staged_by,created_at,updated_at) values (?,?,?,?,?,?,?)",
                )
                .run("m1", "u1", "edit_document", "t0", "u1", "t0", "t0"),
        ).not.toThrow();
        const row = db
            .prepare("select status, tool_payload from mutation_approvals where id='m1'")
            .get() as { status: string; tool_payload: string };
        expect(row.status).toBe("pending");
        expect(row.tool_payload).toBe("{}");
        expect(() =>
            db
                .prepare(
                    "insert into mutation_approvals (id,user_id,tool_name,status,staged_at,staged_by,created_at,updated_at) values (?,?,?,?,?,?,?,?)",
                )
                .run("m2", "u1", "edit_document", "bogus", "t0", "u1", "t0", "t0"),
        ).toThrow();
        db.close();
    });

    it("(5) swieza baza z SQLITE_SCHEMA: nowy event_type przechodzi CHECK, tabela istnieje", () => {
        const db = new Database(":memory:");
        db.exec(SQLITE_SCHEMA);
        // Bootstrap zaklada audit_log z pelna whitelist + mutation_approvals.
        expect(auditCheckSql(db)).toContain("mutation.approval.decision");
        expect(hasMutationApprovals(db)).toBe(true);
        expect(() =>
            db
                .prepare(
                    "insert into audit_log (ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?)",
                )
                .run("t0", "mutation.approval.decision", "{}", "GENESIS", "h1"),
        ).not.toThrow();
        db.close();
    });

    it("(6) samo-pomijalny gdy CHECK juz zawiera mutation.approval.decision (swieza baza, migracje no-op)", () => {
        const db = new Database(":memory:");
        db.exec(SQLITE_SCHEMA);
        db.prepare(
            "insert into audit_log (ts,event_type,payload,prev_hash,hash) values (?,?,?,?,?)",
        ).run("t0", "mutation.approval.decision", "{}", "GENESIS", "h1");

        // Re-run migracji nie rebuilduje (CHECK juz aktualny) - wiersz przezywa.
        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        expect(auditCheckSql(db)).toContain("mutation.approval.decision");
        const c = db
            .prepare("select count(*) c from audit_log")
            .get() as { c: number };
        expect(c.c).toBe(1);
        db.close();
    });
});
