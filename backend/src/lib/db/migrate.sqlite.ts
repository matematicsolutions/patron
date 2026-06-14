// Wersjonowany runner migracji SQLite dla trybu desktop (audyt P2 #7).
//
// Desktop nie ma runnera migracji - schema_migrations + backend/migrations/*.sql
// ida TYLKO na Postgres (komentarz w sqlite-connection.ts). Upgrade'y robil
// ad-hoc `ensureSchemaUpgrades` (tylko ALTER ADD COLUMN). Problem: SQLite NIE
// zmienia CHECK ani FK przez ALTER - jedyna droga to rebuild tabeli (12-krokowa
// procedura SQLite). Ten runner daje lekki, idempotentny mechanizm wersjonowany
// po `PRAGMA user_version` do takich zmian.
//
// Konwencja: kolejne kroki maja `version` 1..N (ciagle). Runner aplikuje kroki
// z `version > user_version` w kolejnosci, kazdy w transakcji wraz z bumpem
// user_version. Idempotentny: ponowny start nie re-aplikuje (user_version juz
// podbity); dodatkowo kazdy `up()` ma byc samo-pomijalny (guard), zeby byl
// bezpieczny takze na swiezej bazie zalozonej z aktualnego SQLITE_SCHEMA.
//
// To NIE zastepuje ensureSchemaUpgrades (proste ADD COLUMN) - oba dzialaja
// obok siebie. Runner jest dla zmian, ktorych ALTER nie obsluguje.

import type Database from "better-sqlite3";

export interface SqliteMigration {
    /** Docelowy user_version po zaaplikowaniu (1..N, ciagle). */
    version: number;
    /** Slug do logu/diagnostyki. */
    name: string;
    /** Krok forward. Ma byc idempotentny/samo-pomijalny (guard w srodku). */
    up: (db: Database.Database) => void;
}

/**
 * Rebuild tabeli `user_api_keys` z `openrouter` w CHECK (audyt P1 #3).
 *
 * Warstwa kluczy (lib/userApiKeys.ts) obsluguje provider 'openrouter' i robi
 * upsert z provider='openrouter', ale CHECK dopuszczal tylko ('claude','gemini',
 * 'openai') -> zapis wlasnego klucza OpenRouter z UI rzucal constraint violation.
 * SQLite nie zmienia CHECK przez ALTER, wiec rebuild: nowa tabela -> kopia ->
 * drop -> rename -> odtworzenie indeksu.
 *
 * Samo-pomijalny: jezeli CHECK juz zawiera 'openrouter' (swieza baza z aktualnego
 * SQLITE_SCHEMA), funkcja wychodzi bez zmian.
 */
function rebuildUserApiKeysAddOpenrouter(db: Database.Database): void {
    const row = db
        .prepare(
            "select sql from sqlite_master where type = 'table' and name = 'user_api_keys'",
        )
        .get() as { sql?: string } | undefined;
    // Tabela jeszcze nie istnieje (bootstrap zalozy ja juz z aktualnym CHECK)
    // albo CHECK juz dopuszcza openrouter -> nic do zrobienia.
    if (!row?.sql || row.sql.includes("openrouter")) return;

    db.exec(`
      create table user_api_keys_new (
        id text primary key,
        user_id text not null,
        provider text not null check (provider in ('claude', 'gemini', 'openai', 'openrouter')),
        encrypted_key text not null,
        iv text not null,
        auth_tag text not null,
        created_at text not null,
        updated_at text not null,
        unique(user_id, provider)
      );
      insert into user_api_keys_new
        (id, user_id, provider, encrypted_key, iv, auth_tag, created_at, updated_at)
        select id, user_id, provider, encrypted_key, iv, auth_tag, created_at, updated_at
        from user_api_keys;
      drop table user_api_keys;
      alter table user_api_keys_new rename to user_api_keys;
      create index if not exists idx_user_api_keys_user on user_api_keys(user_id);
    `);
}

/**
 * Rebuild CHECK whitelist `audit_log.event_type` o `project.cloud_consent`
 * (audyt P2 #6 / ADR-0117). SQLite nie zmienia CHECK przez ALTER -> rebuild z
 * ZACHOWANIEM wierszy (id, hash, prev_hash kopiowane verbatim, wiec hash-chain
 * i proof-y Merkle pozostaja wazne) + odtworzenie 3 indeksow. audit_log nie ma
 * incoming FK, wiec drop/rename jest bezpieczny.
 *
 * Lista event_type = lustro EVENT_TYPES (lib/audit.ts) w momencie tej migracji.
 * Kolejne nowe typy = kolejne migracje (jak Postgres migrations/NNN).
 * Samo-pomijalny: jezeli CHECK juz zawiera 'project.cloud_consent', wychodzi.
 */
function rebuildAuditLogEventTypeCheck(db: Database.Database): void {
    const row = db
        .prepare(
            "select sql from sqlite_master where type = 'table' and name = 'audit_log'",
        )
        .get() as { sql?: string } | undefined;
    if (!row?.sql || row.sql.includes("project.cloud_consent")) return;

    db.exec(`
      create table audit_log_new (
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
          'project.cloud_consent'
        )),
        chat_id text,
        document_id text,
        payload text not null,
        prev_hash text not null,
        hash text not null unique
      );
      insert into audit_log_new
        (id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash)
        select id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash
        from audit_log;
      drop table audit_log;
      alter table audit_log_new rename to audit_log;
      create index if not exists idx_audit_log_chat on audit_log(chat_id, ts);
      create index if not exists idx_audit_log_actor on audit_log(actor_user_id, ts);
      create index if not exists idx_audit_log_event_type on audit_log(event_type, ts);
    `);
}

/** Lista migracji SQLite (kolejnosc = version rosnaco). */
export const SQLITE_MIGRATIONS: ReadonlyArray<SqliteMigration> = [
    {
        version: 1,
        name: "user_api_keys_add_openrouter_check",
        up: rebuildUserApiKeysAddOpenrouter,
    },
    {
        version: 2,
        name: "audit_log_add_project_cloud_consent_event_type",
        up: rebuildAuditLogEventTypeCheck,
    },
];

/**
 * Aplikuje pending migracje (version > PRAGMA user_version) w kolejnosci, kazda
 * w transakcji wraz z bumpem user_version. Zwraca docelowa wersje po zakonczeniu.
 *
 * Bezpieczne do wielokrotnego uruchomienia (idempotentne). `foreign_keys` nie
 * jest przelaczany - migracje rebuildujace tabele dotycza tylko tabel bez
 * relacji FK (user_api_keys nic nie referuje i nic jej nie referuje).
 */
export function runSqliteMigrations(
    db: Database.Database,
    migrations: ReadonlyArray<SqliteMigration> = SQLITE_MIGRATIONS,
): number {
    const currentRaw = db.pragma("user_version", { simple: true });
    let current = typeof currentRaw === "number" ? currentRaw : Number(currentRaw) || 0;
    const pending = [...migrations]
        .filter((m) => m.version > current)
        .sort((a, b) => a.version - b.version);
    for (const m of pending) {
        const apply = db.transaction(() => {
            m.up(db);
            // user_version nie przyjmuje bindu parametru - wartosc z naszej listy
            // (int literal), nie z wejscia uzytkownika.
            db.pragma(`user_version = ${m.version}`);
        });
        apply();
        current = m.version;
    }
    return current;
}
