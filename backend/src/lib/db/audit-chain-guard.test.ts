// Straznik lancucha audytu na poziomie bazy (ADR-0161).
//
// Lustra straznika (jak piec luster event_type, tylko trzy):
//   1. SQLite: ensureAuditChainGuard (migrate.sqlite.ts), wolany na koncu
//      KAZDEGO runSqliteMigrations,
//   2. Postgres: migracja 022 (sekcja UP),
//   3. Postgres: schema.sql (ten sam blok `do`).
// Kontrola pozytywna: na bazie ze straznikiem drugie ogniwo do tego samego
// poprzednika ODBIJA SIE (widziane na czerwono), a bez straznika przechodzi.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA } from "./schema.sqlite";
import {
    AUDIT_CHAIN_GUARD_INDEX,
    ensureAuditChainGuard,
    readAuditChainGuardThreshold,
    runSqliteMigrations,
    SQLITE_MIGRATIONS,
} from "./migrate.sqlite";

const BACKEND_ROOT = path.resolve(__dirname, "../../..");
const H = (c: string) => c.repeat(64);
const GEN = H("0");

function insert(db: Database.Database, prev: string, hash: string): void {
    db.prepare(
        "insert into audit_log (ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?)",
    ).run("2026-01-15T10:00:00.000Z", null, "ring_policy.decision", null, null, "{}", prev, hash);
}

/** Baza w stanie realnej instalacji przed straznikiem: user_version 6, rozwidlenie. */
function forkedLegacyDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(SQLITE_SCHEMA);
    db.pragma("user_version = 6");
    insert(db, GEN, H("1"));
    insert(db, H("1"), H("2"));
    insert(db, H("1"), H("3")); // rozwidlenie: dwa ogniwa do wpisu 1
    insert(db, H("3"), H("4"));
    return db;
}

describe("straznik SQLite na bazie z istniejacymi rozwidleniami", () => {
    it("pelny unikalny indeks NIE buduje sie na takiej bazie (dlatego prog)", () => {
        const db = forkedLegacyDb();
        expect(() => db.exec("create unique index t on audit_log(prev_hash)")).toThrow(/UNIQUE/);
        db.close();
    });

    it("SQLITE_SCHEMA wykonany ponownie (kazdy start) nie wywraca bazy z rozwidleniem", () => {
        const db = forkedLegacyDb();
        expect(() => db.exec(SQLITE_SCHEMA)).not.toThrow();
        db.close();
    });

    it("migracja przechodzi, prog = max(id), historia nietknieta", () => {
        const db = forkedLegacyDb();
        const before = db.prepare("select id, prev_hash, hash from audit_log order by id").all();
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        expect(readAuditChainGuardThreshold(db)).toBe(4);
        expect(db.prepare("select id, prev_hash, hash from audit_log order by id").all()).toEqual(before);
        db.close();
    });

    it("KONTROLA POZYTYWNA: po migracji drugie ogniwo do tego samego poprzednika odbija sie", () => {
        const db = forkedLegacyDb();
        // Bez straznika: rozwidlenie przechodzi po cichu (stan sprzed ADR-0161).
        insert(db, H("4"), H("5"));
        expect(() => insert(db, H("4"), H("6"))).not.toThrow();
        db.close();

        const guarded = forkedLegacyDb();
        runSqliteMigrations(guarded, SQLITE_MIGRATIONS);
        insert(guarded, H("4"), H("5"));
        let err: unknown;
        try {
            insert(guarded, H("4"), H("6"));
        } catch (e) {
            err = e;
        }
        expect((err as { code?: string })?.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
        guarded.close();
    });

    it("idempotentny: drugi przebieg nie przesuwa progu", () => {
        const db = forkedLegacyDb();
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        insert(db, H("4"), H("5"));
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        ensureAuditChainGuard(db);
        expect(readAuditChainGuardThreshold(db)).toBe(4);
        db.close();
    });
});

describe("straznik SQLite na swiezej bazie i po przyszlym rebuildzie", () => {
    it("swieza baza: prog 0, czyli caly lancuch pod straznikiem", () => {
        const db = new Database(":memory:");
        db.exec(SQLITE_SCHEMA);
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        expect(readAuditChainGuardThreshold(db)).toBe(0);
        insert(db, GEN, H("1"));
        expect(() => insert(db, GEN, H("2"))).toThrow(/UNIQUE/);
        db.close();
    });

    it("przyszly krok rebuildujacy audit_log nie gubi straznika", () => {
        // Rebuild jak v2-v6: nowa tabela, kopia, drop, rename. Kasuje indeksy.
        const futureRebuild = {
            version: SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1].version + 1,
            name: "test_future_audit_log_rebuild",
            up: (db: Database.Database) => {
                const sql = (
                    db.prepare("select sql from sqlite_master where name = 'audit_log'").get() as { sql: string }
                ).sql;
                db.exec(sql.replace(/audit_log/, "audit_log_new"));
                db.exec("insert into audit_log_new select * from audit_log; drop table audit_log;");
                db.exec("alter table audit_log_new rename to audit_log;");
            },
        };
        const db = forkedLegacyDb();
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        expect(readAuditChainGuardThreshold(db)).toBe(4);
        // Wpisy po instalacji straznika: max(id) rosnie, a prog ma ZOSTAC 4.
        insert(db, H("4"), H("5"));
        insert(db, H("5"), H("6"));
        runSqliteMigrations(db, [...SQLITE_MIGRATIONS, futureRebuild]);
        const idx = db
            .prepare("select sql from sqlite_master where type = 'index' and name = ?")
            .get(AUDIT_CHAIN_GUARD_INDEX) as { sql?: string } | undefined;
        expect(idx?.sql).toMatch(/where id > 4$/);
        db.close();
    });

    it("rozwidlenie powyzej progu przy rebuildzie: start nie pada, blad idzie glosno do logu", () => {
        const db = forkedLegacyDb();
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        // Ktos zdjal straznika i dopisal rozwidlenie powyzej progu.
        db.exec(`drop index ${AUDIT_CHAIN_GUARD_INDEX}`);
        db.pragma("user_version = 6");
        insert(db, H("4"), H("5"));
        insert(db, H("4"), H("6"));
        // Prog odczytany przed krokami nie istnieje (indeks zdjety) - odtwarza sie z max(id).
        expect(() => runSqliteMigrations(db, SQLITE_MIGRATIONS)).not.toThrow();
        expect(readAuditChainGuardThreshold(db)).toBe(6);
        // Wariant z zywym indeksem i prog ZACHOWANY, ale budowa z nim niemozliwa:
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        db.exec(`drop index ${AUDIT_CHAIN_GUARD_INDEX}`);
        ensureAuditChainGuard(db, 4);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("sie nie zbudowal"));
        expect(readAuditChainGuardThreshold(db)).toBe(6);
        spy.mockRestore();
        db.close();
    });
});

/** Wyciaga blok `do $$ ... $$;` z naszym indeksem, bez komentarzy i bialych znakow. */
function guardBlock(sql: string): string {
    const blocks = sql.match(/do \$\$[\s\S]*?\$\$;/g) ?? [];
    const b = blocks.find((x) => x.includes("audit_log_prev_hash_unique")) ?? "";
    return b
        .split("\n")
        .map((l) => l.replace(/--.*$/, "").trim())
        .filter(Boolean)
        .join(" ");
}

describe("lustra straznika Postgres", () => {
    const migration = readFileSync(path.join(BACKEND_ROOT, "migrations", "022_audit_log_prev_hash_guard.sql"), "utf8");
    const [up, down] = migration.split(/--\s*DOWN/);
    const schema = readFileSync(path.join(BACKEND_ROOT, "schema.sql"), "utf8");

    it("migracja 022 UP buduje czesciowy unikalny indeks z progiem max(id)", () => {
        const b = guardBlock(up);
        expect(b).toContain("create unique index audit_log_prev_hash_unique on public.audit_log (prev_hash) where id > %s");
        expect(b).toContain("coalesce(max(id), 0)");
        expect(b).toContain("lock table public.audit_log");
    });

    it("migracja 022 DOWN zdejmuje indeks", () => {
        expect(down).toMatch(/drop index if exists public\.audit_log_prev_hash_unique/);
    });

    it("schema.sql ma TEN SAM blok co migracja (swieza baza == migrowana)", () => {
        expect(guardBlock(schema)).not.toBe("");
        expect(guardBlock(schema)).toBe(guardBlock(up));
    });
});

describe("appendAuditEvent przez dwa polaczenia do jednego pliku (dwa procesy)", () => {
    // Dwie instancje modulow = dwie kolejki zapisu i dwa polaczenia SQLite do tego
    // samego pliku. Kolejka w pamieci nie siega drugiej instancji - dokladnie jak
    // drugi proces w trybie serwerowym albo skrypt CLI obok desktopu.
    const tmp = path.join(os.tmpdir(), `patron-guard-test-${process.pid}-${Date.now()}.db`);
    type Inst = {
        db: Parameters<typeof import("../audit").appendAuditEvent>[0];
        append: typeof import("../audit").appendAuditEvent;
        close: () => void;
    };
    async function instance(): Promise<Inst> {
        vi.resetModules();
        const supa = await import("../supabase");
        const audit = await import("../audit");
        const conn = await import("./sqlite-connection");
        return { db: supa.createServerSupabase(), append: audit.appendAuditEvent, close: conn.closeDb };
    }
    let a: Inst;
    let b: Inst;

    beforeAll(async () => {
        process.env.PATRON_DB_BACKEND = "sqlite";
        process.env.PATRON_DB_PATH = tmp;
        a = await instance();
        b = await instance();
        // Otwarcie obu polaczen TERAZ: bootstrap (runSqliteMigrations) zaklada
        // straznika, a kontrola ponizej zdejmuje go juz po bootstrapie.
        await a.db.from("audit_log").select("id").limit(1);
        await b.db.from("audit_log").select("id").limit(1);
    });

    afterAll(() => {
        a?.close();
        b?.close();
        for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
            try {
                fs.unlinkSync(f);
            } catch {
                /* ignore */
            }
        }
    });

    async function burst(n: number) {
        return Promise.all(
            Array.from({ length: n }, (_, i) =>
                (i % 2 ? a : b).append(i % 2 ? a.db : b.db, {
                    event_type: "ring_policy.decision",
                    payload: { i },
                }),
            ),
        );
    }

    function forks(): number {
        const raw = new Database(tmp, { readonly: true });
        const r = raw
            .prepare("select count(*) as c from (select prev_hash from audit_log group by prev_hash having count(*) > 1)")
            .get() as { c: number };
        raw.close();
        return r.c;
    }

    it("KONTROLA POZYTYWNA: bez straznika dwa polaczenia rozwidlaja lancuch", async () => {
        const raw = new Database(tmp);
        raw.exec(`drop index ${AUDIT_CHAIN_GUARD_INDEX}`);
        raw.close();
        await burst(10);
        expect(forks()).toBeGreaterThan(0);
    });

    it("ze straznikiem: zapisy ida w jeden lancuch od progu, kazdy zapis udany", async () => {
        const raw = new Database(tmp);
        ensureAuditChainGuard(raw);
        const guard = readAuditChainGuardThreshold(raw)!;
        raw.close();
        const before = forks();
        const wyniki = await burst(20);
        expect(wyniki.every((w) => w.ok)).toBe(true);
        expect(forks()).toBe(before);
        const check = new Database(tmp, { readonly: true });
        const rows = check
            .prepare("select id, prev_hash, hash from audit_log where id > ? order by id")
            .all(guard) as { id: number; prev_hash: string; hash: string }[];
        check.close();
        expect(rows).toHaveLength(20);
        for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
    });
});
