// Kolizja numeracji migracji miedzy liniami (ADR-0163).
//
// Zmierzone 2026-10-01: dwie linie rozeszly sie od 1.2.0 i OBIE nazwaly swoj krok
// SQLite `v6` (publiczna: deliverable.bundle_export, wydana w 1.3.0; linia
// feat/design-system-2-0: audit.chain.legal_break) i OBIE zajely migracje Postgres
// `020`. Runner SQLite pomija kazdy krok z version <= PRAGMA user_version, a runner
// Postgres sledzi migracje po `id` (prefiks NNN) - wiec po scaleniu instalacja z 1.3.0
// (user_version = 6) NIGDY nie dostaje kroku drugiej linii i odrzuca jej event_type
// na CHECK. Kazda migracja "konczy sie sukcesem". Ta sama klasa co luka v5.
//
// Oczekiwania sa tu ZAPISANE RECZNIE z tagu v1.3.0, nie importowane z kodu pod
// testem: bramka liczaca oczekiwanie z migrate.sqlite.ts zdawalaby wlasny egzamin.
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { EVENT_TYPES } from "../audit";
import { SQLITE_SCHEMA } from "./schema.sqlite";
import { runSqliteMigrations, SQLITE_MIGRATIONS } from "./migrate.sqlite";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../migrations");

/**
 * Kroki SQLite, ktore WYSZLY do ludzi (tag v1.3.0). Baza mecenasa ma ktorys z nich
 * zapisany w user_version - zmiana numeru albo tresci ktoregokolwiek oznacza, ze
 * czesc instalacji go pominie. Nowy krok = numer WYZSZY niz kazdy z tej listy.
 * Przy kolejnym wydaniu dopisz jego kroki (z tagu, nie z kodu).
 */
const SHIPPED_SQLITE_STEPS: ReadonlyArray<readonly [number, string]> = [
    [1, "user_api_keys_add_openrouter_check"],
    [2, "audit_log_add_project_cloud_consent_event_type"],
    [3, "audit_log_add_connector_toggle_event_type"],
    [4, "mutation_approvals_table_and_event_type"],
    [5, "audit_log_event_type_parity_cost_cap"],
    [6, "audit_log_add_deliverable_bundle_export_event_type"],
];

/** Migracje Postgres z tagu v1.3.0 (runner sledzi je po prefiksie `id`). */
const SHIPPED_POSTGRES_MIGRATIONS: readonly string[] = [
    "001_audit_log_event_type_check.sql",
    "002_audit_log_admin_access_event_types.sql",
    "003_audit_log_event_type_export.sql",
    "004_audit_log_event_type_compute_now.sql",
    "005_audit_log_event_type_llm_route.sql",
    "006_projects_classification.sql",
    "007_audit_log_event_type_defense_pipeline.sql",
    "008_audit_log_event_type_document_edit.sql",
    "009_audit_log_event_type_tabular_grounding.sql",
    "010_audit_log_event_type_cost_cap.sql",
    "011_installed_skills.sql",
    "012_audit_log_event_type_cloud_consent.sql",
    "013_projects_cloud_consent.sql",
    "014_audit_log_event_type_connector_toggle.sql",
    "015_add_mutation_approvals.sql",
    "016_audit_log_event_type_mutation_approval.sql",
    "017_encryption_keys.sql",
    "018_tabular_cell_review.sql",
    "019_audit_log_event_type_parity_cost_cap.sql",
    "020_audit_log_event_type_deliverable_bundle_export.sql",
];

/** Lista CHECK, ktora krok v6 z 1.3.0 zapisal w bazie (22 wartosci). */
const SHIPPED_V6_EVENT_TYPES: readonly string[] = [
    "chat.message.user",
    "chat.message.assistant",
    "input_security_scan",
    "mcp_security.gateway",
    "ring_policy.decision",
    "rodo.delete",
    "rodo.export",
    "admin.access.audit_viewer",
    "admin.access.audit_export",
    "admin.access.merkle_compute_now",
    "admin.access.security_banner",
    "admin.access.metrics",
    "migrate.rollback",
    "llm_route",
    "defense.pipeline.run",
    "document.edit_resolved",
    "tabular.grounding",
    "project.cloud_consent",
    "connector.toggle",
    "mutation.approval.decision",
    "cost_cap",
    "deliverable.bundle_export",
];

/**
 * Lista CHECK, ktora krok v6 z linii feat/design-system-2-0 (ae7875a) zapisal
 * w bazach deweloperskich tej linii: v5 + legal_break, BEZ deliverable.bundle_export.
 */
const DESIGN_LINE_V6_EVENT_TYPES: readonly string[] = [
    ...SHIPPED_V6_EVENT_TYPES.filter((t) => t !== "deliverable.bundle_export"),
    "audit.chain.legal_break",
];

/**
 * Lista CHECK po kroku v7 linii publicznej (ADR-0161, `fork_acknowledged`):
 * stan instalacji, ktore dostana te prace przed scaleniem linii.
 */
const PUBLIC_V7_EVENT_TYPES: readonly string[] = [
    ...SHIPPED_V6_EVENT_TYPES,
    "audit.chain.fork_acknowledged",
];

const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

/**
 * Baza w stanie "po kroku v6 danej linii": pelny schemat, a audit_log z CHECK
 * dokladnie takim, jaki ten krok zostawil, user_version = 6, jeden wpis w lancuchu.
 */
function dbAtV6(checkList: readonly string[], userVersion = 6): Database.Database {
    const db = new Database(":memory:");
    db.exec(SQLITE_SCHEMA);
    db.exec("drop table audit_log");
    db.exec(`
      create table audit_log (
        id integer primary key autoincrement,
        ts text not null,
        actor_user_id text,
        event_type text not null check (event_type in (
${checkList.map((t) => `          '${t}'`).join(",\n")}
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
    `);
    db.prepare(
        "insert into audit_log (ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?)",
    ).run("t0", "u1", "chat.message.user", null, null, "{}", H0, H1);
    db.pragma(`user_version = ${userVersion}`);
    return db;
}

function accepts(db: Database.Database, eventType: string): boolean {
    db.exec("savepoint probe");
    try {
        db.prepare(
            "insert into audit_log (ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?)",
        ).run("t1", null, eventType, null, null, "{}", H1, H2);
        return true;
    } catch {
        return false;
    } finally {
        db.exec("rollback to probe");
        db.exec("release probe");
    }
}

describe("baza z 1.3.0 (user_version 6, linia publiczna) po scaleniu linii", () => {
    it("przed migracja odrzuca audit.chain.legal_break; po migracji przyjmuje", () => {
        const db = dbAtV6(SHIPPED_V6_EVENT_TYPES);
        expect(accepts(db, "audit.chain.legal_break")).toBe(false);

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        expect(accepts(db, "audit.chain.legal_break")).toBe(true);
        db.close();
    });

    it("po migracji przyjmuje KAZDY typ z EVENT_TYPES, wiersz i hash zachowane", () => {
        const db = dbAtV6(SHIPPED_V6_EVENT_TYPES);
        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        const rejected = EVENT_TYPES.filter((t) => !accepts(db, t));
        expect(rejected).toEqual([]);
        expect(db.prepare("select id, prev_hash, hash from audit_log").all()).toEqual([
            { id: 1, prev_hash: H0, hash: H1 },
        ]);
        db.close();
    });
});

describe("baza linii publicznej po v7 (fork_acknowledged, ADR-0161)", () => {
    it("po migracji przyjmuje audit.chain.legal_break i kazdy typ z EVENT_TYPES", () => {
        const db = dbAtV6(PUBLIC_V7_EVENT_TYPES, 7);
        expect(accepts(db, "audit.chain.legal_break")).toBe(false);

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        const rejected = EVENT_TYPES.filter((t) => !accepts(db, t));
        expect(rejected).toEqual([]);
        db.close();
    });
});

describe("baza deweloperska linii feat/design-system-2-0 (jej wlasny v6)", () => {
    it("po migracji przyjmuje deliverable.bundle_export i kazdy typ z EVENT_TYPES", () => {
        const db = dbAtV6(DESIGN_LINE_V6_EVENT_TYPES);
        expect(accepts(db, "deliverable.bundle_export")).toBe(false);

        runSqliteMigrations(db, SQLITE_MIGRATIONS);

        const rejected = EVENT_TYPES.filter((t) => !accepts(db, t));
        expect(rejected).toEqual([]);
        db.close();
    });
});

describe("numeracja krokow: wydane sa zamrozone, kolejne ida wyzej", () => {
    it("SQLite: numery krokow unikalne i rosnace w kolejnosci listy", () => {
        const versions = SQLITE_MIGRATIONS.map((m) => m.version);
        expect(new Set(versions).size).toBe(versions.length);
        expect(versions).toEqual([...versions].sort((a, b) => a - b));
    });

    it("SQLite: kazdy krok z v1.3.0 ma ten sam numer i nazwe; nowe sa powyzej", () => {
        const byVersion = new Map(SQLITE_MIGRATIONS.map((m) => [m.version, m.name]));
        for (const [version, name] of SHIPPED_SQLITE_STEPS) {
            expect({ version, name: byVersion.get(version) }).toEqual({ version, name });
        }
        const maxShipped = Math.max(...SHIPPED_SQLITE_STEPS.map(([v]) => v));
        const shippedNames = new Set(SHIPPED_SQLITE_STEPS.map(([, n]) => n));
        const added = SQLITE_MIGRATIONS.filter((m) => !shippedNames.has(m.name));
        for (const m of added) {
            expect({ name: m.name, aboveShipped: m.version > maxShipped }).toEqual({
                name: m.name,
                aboveShipped: true,
            });
        }
    });

    it("Postgres: kazdy plik z v1.3.0 istnieje pod tym samym id, zaden id sie nie powtarza", () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f));
        for (const f of SHIPPED_POSTGRES_MIGRATIONS) {
            expect(files).toContain(f);
        }
        const ids = files.map((f) => f.slice(0, 3));
        const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(dup).toEqual([]);
    });
});

describe("ostatni krok SQLite niesie pelna sume (zachowanie, nie nazwa)", () => {
    it("sam ostatni krok, puszczony na bazie z dowolnym niepelnym CHECK, daje pelne EVENT_TYPES", () => {
        // Bramka parytetu porownuje STALA z lista - a krok dopisany "pod" ostatnim
        // albo ostatni krok z niepelna lista przechodzi to porownanie, jesli ktos
        // przestawi alias. Tu sprawdzamy to, co baza naprawde dostanie.
        const last = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1];
        for (const start of [SHIPPED_V6_EVENT_TYPES, PUBLIC_V7_EVENT_TYPES, DESIGN_LINE_V6_EVENT_TYPES]) {
            const db = dbAtV6(start);
            db.pragma(`user_version = ${last.version - 1}`);
            runSqliteMigrations(db, [last]);
            const rejected = EVENT_TYPES.filter((t) => !accepts(db, t));
            expect({ step: last.name, rejected }).toEqual({ step: last.name, rejected: [] });
            db.close();
        }
    });
});
