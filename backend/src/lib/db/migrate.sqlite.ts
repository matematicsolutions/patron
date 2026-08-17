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
 * (audyt P2 #6 / ADR-0128). SQLite nie zmienia CHECK przez ALTER -> rebuild z
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

/**
 * Rebuild CHECK whitelist `audit_log.event_type` o `connector.toggle` (ADR-0133).
 * Picker konektorow MCP - zmiana `enabled` jest audytowana (AI Act art. 12). Jak
 * v2: rebuild z ZACHOWANIEM wierszy (id/hash/prev_hash kopiowane verbatim, wiec
 * hash-chain i proof-y Merkle pozostaja wazne) + odtworzenie 3 indeksow.
 * Samo-pomijalny: jezeli CHECK juz zawiera 'connector.toggle', wychodzi.
 */
function rebuildAuditLogAddConnectorToggle(db: Database.Database): void {
    const row = db
        .prepare(
            "select sql from sqlite_master where type = 'table' and name = 'audit_log'",
        )
        .get() as { sql?: string } | undefined;
    if (!row?.sql || row.sql.includes("connector.toggle")) return;

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
          'project.cloud_consent',
          'connector.toggle'
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

/**
 * Tworzy tabele `mutation_approvals` dla istniejacych baz (ADR-0137) - kolejka
 * kart zatwierdzenia mutacji. Idempotentny fallback: kanoniczna definicja (z FK
 * chat_id/document_id) zyje w SQLITE_SCHEMA i bootstrap zaklada ja przez
 * `db.exec(SQLITE_SCHEMA)` create-if-not-exists JESZCZE PRZED runSqliteMigrations,
 * wiec w produkcji tabela juz istnieje gdy tu wchodzimy. Wersja ponizej (bez
 * klauzul FK) sluzy tylko gdy migracja biegnie standalone (np. testy) - bez FK,
 * by nie wymagac tabel chats/documents w izolowanej bazie.
 */
function ensureMutationApprovalsTable(db: Database.Database): void {
    db.exec(`
      create table if not exists mutation_approvals (
        id text primary key,
        user_id text not null,
        chat_id text,
        document_id text,
        tool_name text not null,
        tool_payload text not null default '{}',
        status text not null default 'pending'
          check (status in ('pending', 'approved', 'rejected')),
        staged_at text not null,
        staged_by text not null,
        approved_at text,
        approved_by text,
        rejection_reason text,
        executed_at text,
        execution_error text,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_mutation_approvals_user_status on mutation_approvals(user_id, status);
      create index if not exists idx_mutation_approvals_chat on mutation_approvals(chat_id);
      create index if not exists idx_mutation_approvals_document on mutation_approvals(document_id);
    `);
}

/**
 * Rebuild CHECK whitelist `audit_log.event_type` o `mutation.approval.decision`
 * (ADR-0137). Decyzja czlowieka o karcie zatwierdzenia mutacji (AI Act art. 14)
 * idzie w hash-chain (art. 12). Jak v2/v3: rebuild z ZACHOWANIEM wierszy
 * (id/hash/prev_hash kopiowane verbatim, wiec hash-chain i proof-y Merkle
 * pozostaja wazne) + odtworzenie 3 indeksow. Samo-pomijalny: jezeli CHECK juz
 * zawiera 'mutation.approval.decision', wychodzi.
 */
function rebuildAuditLogAddMutationApproval(db: Database.Database): void {
    const row = db
        .prepare(
            "select sql from sqlite_master where type = 'table' and name = 'audit_log'",
        )
        .get() as { sql?: string } | undefined;
    if (!row?.sql || row.sql.includes("mutation.approval.decision")) return;

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

/**
 * Krok v4 (ADR-0137): tabela mutation_approvals (fallback dla istniejacych baz)
 * + nowy event_type w CHECK audit_log. Oba w jednej transakcji (runner).
 */
function migrateV4MutationApprovals(db: Database.Database): void {
    ensureMutationApprovalsTable(db);
    rebuildAuditLogAddMutationApproval(db);
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
    {
        version: 3,
        name: "audit_log_add_connector_toggle_event_type",
        up: rebuildAuditLogAddConnectorToggle,
    },
    {
        version: 4,
        name: "mutation_approvals_table_and_event_type",
        up: migrateV4MutationApprovals,
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
