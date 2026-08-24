// Test PARYTETU whitelist `audit_log.event_type` miedzy pieciu lustrami
// (AGENTS.md: "dodajac nowy event_type: 5 mirrorow"). Powod: rozjazd zmierzony
// 2026-08-18 - `cost_cap` (ADR-0093) byl w CREATE (schema.sql, schema.sqlite.ts),
// ale NIE w listach migracji Postgres 012/014/016 ani w rebuildach SQLite v2-v4;
// kazda migracja konczyla sie sukcesem, baza migrowana odrzucala cost_cap.
//
// Lustra:
//   1. EVENT_TYPES (lib/audit.ts) - zrodlo prawdy dla appendAuditEvent
//   2. schema.sqlite.ts CREATE audit_log (swieza baza desktop)
//   3. schema.sql CREATE audit_log (swieza baza Postgres)
//   4. NAJNOWSZA migracja Postgres dotykajaca whitelist (sekcja UP)
//   5. NAJNOWSZY rebuild SQLite (ostatni krok SQLITE_MIGRATIONS z lista event_type)
// Plus test bojowy: baza SQLite z CHECK BEZ cost_cap po runSqliteMigrations
// przyjmuje wstawienie cost_cap (rebuild v5 zadzialal, wiersze zachowane).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { EVENT_TYPES } from "../audit";
import { SQLITE_SCHEMA } from "./schema.sqlite";
import {
    runSqliteMigrations,
    SQLITE_MIGRATIONS,
    AUDIT_EVENT_TYPES_V6,
} from "./migrate.sqlite";

const BACKEND_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, "migrations");

/** Wyciaga liste literalow z `event_type ... in ( 'a', 'b' )` w podanym tekscie. */
function extractEventTypeList(sql: string): string[] {
    const m = /event_type\s+in\s*\(([\s\S]*?)\)\s*\)/i.exec(sql);
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function sorted(xs: readonly string[]): string[] {
    return [...xs].sort();
}

const expected = sorted(EVENT_TYPES);

describe("parytet whitelist event_type (5 luster)", () => {
    it("EVENT_TYPES nie ma duplikatow", () => {
        expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    });

    it("schema.sqlite.ts CREATE audit_log == EVENT_TYPES", () => {
        const idx = SQLITE_SCHEMA.indexOf("create table if not exists audit_log");
        expect(idx).toBeGreaterThan(-1);
        const list = extractEventTypeList(SQLITE_SCHEMA.slice(idx));
        expect(sorted(list)).toEqual(expected);
    });

    it("schema.sql (Postgres) CREATE audit_log == EVENT_TYPES", () => {
        const sql = readFileSync(path.join(BACKEND_ROOT, "schema.sql"), "utf8");
        const idx = sql.indexOf("audit_log_event_type_whitelist");
        expect(idx).toBeGreaterThan(-1);
        const list = extractEventTypeList(sql.slice(idx));
        expect(sorted(list)).toEqual(expected);
    });

    it("NAJNOWSZA migracja Postgres z whitelist (sekcja UP) == EVENT_TYPES", () => {
        const files = readdirSync(MIGRATIONS_DIR)
            .filter((f) => /^\d{3}_.*\.sql$/.test(f))
            .sort();
        const withWhitelist = files.filter((f) =>
            readFileSync(path.join(MIGRATIONS_DIR, f), "utf8").includes(
                "audit_log_event_type_whitelist",
            ),
        );
        expect(withWhitelist.length).toBeGreaterThan(0);
        const latest = withWhitelist[withWhitelist.length - 1];
        const sql = readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8");
        const up = sql.split(/--\s*DOWN/)[0];
        const list = extractEventTypeList(up);
        expect({ file: latest, list: sorted(list) }).toEqual({ file: latest, list: expected });
    });

    it("NAJNOWSZY rebuild SQLite (AUDIT_EVENT_TYPES_V6) == EVENT_TYPES i jest ostatnim krokiem z lista", () => {
        // Przy KAZDYM nowym event_type podnies te stala do najnowszego V<n>.
        // Ten test padl 2026-08-24 przy dodaniu deliverable.bundle_export - dokladnie
        // po to istnieje: pilnuje, zeby nowy typ dostal wlasny krok rebuildu.
        expect(sorted(AUDIT_EVENT_TYPES_V6)).toEqual(expected);
        // Gdy ktos doda event_type do EVENT_TYPES bez nowego kroku SQLite, powyzsze
        // padnie. Dodatkowo: ostatni krok migracji ma byc tym z parytetem (nie
        // dopisuj kolejnych krokow "obok" bez pelnej listy).
        const last = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1];
        expect(last.name).toContain("event_type");
    });
});

// audit_log ze STARYM CHECK z okresu przed ADR-0093 (bez cost_cap) - ale juz z
// mutation.approval.decision, czyli taka, ktora v2/v3/v4 POMIJALY (samo-pomijanie
// po jednej wartosci). Dokladnie ten przypadek przepuszczal luke.
const LEGACY_AUDIT_LOG_WITHOUT_COST_CAP = `
  create table audit_log (
    id integer primary key autoincrement,
    ts text not null,
    actor_user_id text,
    event_type text not null check (event_type in (
      'chat.message.user',
      'chat.message.assistant',
      'input_security_scan',
      'mcp_security.gateway',
      'ring_policy.decision',
      'rodo.delete',
      'rodo.export',
      'admin.access.audit_viewer',
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      'llm_route',
      'defense.pipeline.run',
      'document.edit_resolved',
      'tabular.grounding',
      'project.cloud_consent',
      'connector.toggle',
      'mutation.approval.decision'
    )),
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

const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

describe("rebuild v5: baza migrowana bez cost_cap przyjmuje cost_cap po migracji", () => {
    it("przed: CHECK odrzuca cost_cap; po: przyjmuje, wiersze i hash-chain zachowane", () => {
        const db = new Database(":memory:");
        db.exec(LEGACY_AUDIT_LOG_WITHOUT_COST_CAP);
        // user_api_keys / mutation_approvals nie sa potrzebne do tego kroku, ale runner
        // aplikuje v1..v5 po kolei - v1 rebuilduje user_api_keys, wiec musi istniec.
        db.exec(`
          create table user_api_keys (
            id text primary key, user_id text not null,
            provider text not null check (provider in ('claude','gemini','openai','openrouter')),
            encrypted_key text not null, iv text not null, auth_tag text not null,
            created_at text not null, updated_at text not null, unique(user_id, provider)
          );
        `);
        const ins = db.prepare(
            "insert into audit_log (ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?)",
        );
        ins.run("t0", "u1", "chat.message.user", null, null, "{}", H0, H1);
        expect(() => ins.run("t1", "u1", "cost_cap", null, null, "{}", H1, H2)).toThrow();

        // Baza udaje "juz po v4" (user_version=4) - dokladnie stan, w ktorym v2-v4 nic
        // by nie zrobily, a luka by zostala.
        db.pragma("user_version = 4");
        const v = runSqliteMigrations(db, SQLITE_MIGRATIONS);
        expect(v).toBe(SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1].version);

        expect(() => ins.run("t1", "u1", "cost_cap", null, null, "{}", H1, H2)).not.toThrow();
        const rows = db
            .prepare("select id, event_type, prev_hash, hash from audit_log order by id")
            .all() as { id: number; event_type: string; prev_hash: string; hash: string }[];
        expect(rows.map((r) => r.event_type)).toEqual(["chat.message.user", "cost_cap"]);
        expect(rows[0]).toMatchObject({ id: 1, prev_hash: H0, hash: H1 });
        // Indeksy odtworzone.
        const idx = db
            .prepare("select count(*) c from sqlite_master where type='index' and name like 'idx_audit_log_%'")
            .get() as { c: number };
        expect(idx.c).toBe(3);
        db.close();
    });

    it("samo-pomijalny na swiezej bazie (pelny schemat): zero rebuildu, ta sama definicja", () => {
        const db = new Database(":memory:");
        db.exec(SQLITE_SCHEMA);
        const before = (
            db.prepare("select sql from sqlite_master where type='table' and name='audit_log'").get() as { sql: string }
        ).sql;
        runSqliteMigrations(db, SQLITE_MIGRATIONS);
        const after = (
            db.prepare("select sql from sqlite_master where type='table' and name='audit_log'").get() as { sql: string }
        ).sql;
        expect(after).toBe(before);
        db.close();
    });
});
